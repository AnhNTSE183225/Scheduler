use crate::error::AppError;
use crate::models::event::RespondEventRequest;
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::event_repo::EventRepository;
use crate::routes::{AuthQuery, require_session};
use crate::services::ics_service;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, header},
    response::IntoResponse,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize, Default)]
pub struct DeleteOccurrenceQuery {
    pub occurrence: Option<String>,
}

fn parse_future_start(start_str: &str) -> Result<DateTime<Utc>, AppError> {
    let dt = DateTime::parse_from_rfc3339(start_str)
        .map(|d| d.with_timezone(&Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(start_str, "%Y-%m-%dT%H:%M:%S")
                .map(|ndt| ndt.and_utc())
        })
        .map_err(|e| AppError::BadRequest(format!("Invalid start time format: {e}")))?;

    if dt < Utc::now() - Duration::minutes(1) {
        return Err(AppError::BadRequest(
            "Cannot schedule an event in the past.".to_string(),
        ));
    }
    Ok(dt)
}

pub async fn get_schedule(
    Path(calendar_id): Path<String>,
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, Some(&q), &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let events = state.event_repo.list_calendar_events(&calendar_id).await?;
    let members = state.cal_repo.list_member_infos(&calendar_id).await?;
    let calendar = state.cal_repo.get_calendar(&calendar_id).await?;

    Ok(Json(StateMachineDTO::active(json!({
        "events": events,
        "members": members,
        "calendar": calendar
    }))))
}

pub async fn create_event(
    Path(calendar_id): Path<String>,
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, Some(&q), &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let start_str = payload
        .get("start")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("Missing start time for event".to_string()))?;
    let _ = parse_future_start(start_str)?;

    let ev = state
        .event_repo
        .create_event(
            &calendar_id,
            &payload,
            &session.user.id,
            &session.user.name,
            session.user.avatar.as_deref(),
        )
        .await?;

    let svc = state.reminder_svc.clone();
    let ev_clone = ev.clone();
    tokio::spawn(async move {
        svc.notify_event_created(&ev_clone).await;
    });

    Ok(Json(StateMachineDTO::active(json!({ "event": ev }))))
}

pub async fn update_event(
    Path((calendar_id, event_id)): Path<(String, String)>,
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, Some(&q), &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let existing = state
        .event_repo
        .get_event(&event_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Event not found".to_string()))?;

    if let Some(start_str) = payload.get("start").and_then(|v| v.as_str()) {
        if start_str != existing.start {
            let _ = parse_future_start(start_str)?;
        }
    }

    let is_admin = state.auth_svc.is_admin(&session.user);
    let updated = state
        .event_repo
        .update_event(&event_id, &payload, &session.user.id, is_admin)
        .await?
        .ok_or_else(|| AppError::NotFound("Event not found".to_string()))?;

    let svc = state.reminder_svc.clone();
    let updated_clone = updated.clone();
    let editor_id = session.user.id.clone();
    tokio::spawn(async move {
        svc.notify_event_updated(&existing, &updated_clone, &editor_id).await;
    });

    Ok(Json(StateMachineDTO::active(json!({ "event": updated }))))
}

pub async fn delete_event(
    Path((calendar_id, event_id)): Path<(String, String)>,
    Query(del_q): Query<DeleteOccurrenceQuery>,
    headers: HeaderMap,
    Query(auth_q): Query<AuthQuery>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, Some(&auth_q), &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let is_admin = state.auth_svc.is_admin(&session.user);
    let deleted = state
        .event_repo
        .delete_event(&event_id, &session.user.id, is_admin, del_q.occurrence.as_deref())
        .await?;

    if !deleted {
        return Err(AppError::NotFound("Event not found".to_string()));
    }

    state.reminder_svc.notify_event_deleted(&calendar_id, &event_id);
    Ok(Json(StateMachineDTO::active(json!({ "deleted": true }))))
}

pub async fn respond_event(
    Path((calendar_id, event_id)): Path<(String, String)>,
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
    Json(payload): Json<RespondEventRequest>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, Some(&q), &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let status = match payload.status.as_str() {
        "accepted" | "tentative" | "declined" => payload.status.as_str(),
        _ => return Err(AppError::BadRequest("Invalid RSVP status".to_string())),
    };

    let updated = state
        .event_repo
        .respond_event(
            &event_id,
            &session.user.id,
            None,
            &payload.key,
            status,
            &payload.scope,
        )
        .await?
        .ok_or_else(|| AppError::NotFound("Event not found".to_string()))?;

    state.reminder_svc.notify_rsvp_updated(&updated);
    Ok(Json(StateMachineDTO::active(json!({ "event": updated }))))
}

pub async fn download_ics(
    Path((calendar_id, event_id)): Path<(String, String)>,
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, Some(&q), &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let ev = state
        .event_repo
        .get_event(&event_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Event not found".to_string()))?;

    let url = format!(
        "{}/e/{}",
        state.config.server.frontend_url.trim_end_matches('/'),
        ev.share_token
    );
    let ics = ics_service::build_ics(&ev, &url);
    let filename = format!("attachment; filename=\"{}.ics\"", ev.id);

    Ok((
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8".to_string()),
            (header::CONTENT_DISPOSITION, filename),
        ],
        ics,
    ))
}
