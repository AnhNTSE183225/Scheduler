use crate::error::AppError;
use crate::models::event::RespondEventRequest;
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::event_repo::EventRepository;
use crate::routes::require_session;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;

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

async fn filter_invitees_to_calendar_members(
    state: &AppState,
    calendar_id: &str,
    payload: &mut serde_json::Value,
) -> Result<(), AppError> {
    let Some(obj) = payload.as_object_mut() else {
        return Ok(());
    };
    let Some(val) = obj.get("inviteeIds") else {
        return Ok(());
    };
    if val.is_null() {
        return Ok(());
    }
    let Some(arr) = val.as_array() else {
        return Err(AppError::BadRequest(
            "inviteeIds must be an array of member IDs".to_string(),
        ));
    };

    let member_ids: HashSet<String> = state
        .cal_repo
        .list_member_infos(calendar_id)
        .await?
        .into_iter()
        .map(|m| m.id)
        .collect();

    let filtered: Vec<serde_json::Value> = arr
        .iter()
        .filter_map(|v| v.as_str())
        .filter(|id| member_ids.contains(*id))
        .map(|id| serde_json::Value::String(id.to_string()))
        .collect();

    obj.insert("inviteeIds".to_string(), serde_json::Value::Array(filtered));
    Ok(())
}

pub async fn get_schedule(
    Path(calendar_id): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
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
    State(state): State<AppState>,
    Json(mut payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let start_str = payload
        .get("start")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("Missing start time for event".to_string()))?;
    let _ = parse_future_start(start_str)?;

    filter_invitees_to_calendar_members(&state, &calendar_id, &mut payload).await?;

    let ev = state
        .event_repo
        .create_event(
            &calendar_id,
            &payload,
            &session.user.id,
            &session.user.display_name,
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
    State(state): State<AppState>,
    Json(mut payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let existing = state
        .event_repo
        .get_event(&event_id)
        .await?
        .filter(|e| e.calendar_id == calendar_id)
        .ok_or_else(|| AppError::NotFound("Event not found".to_string()))?;

    if let Some(start_str) = payload.get("start").and_then(|v| v.as_str()) {
        if start_str != existing.start {
            let _ = parse_future_start(start_str)?;
        }
    }

    filter_invitees_to_calendar_members(&state, &calendar_id, &mut payload).await?;

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
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let existing = state
        .event_repo
        .get_event(&event_id)
        .await?
        .filter(|e| e.calendar_id == calendar_id)
        .ok_or_else(|| AppError::NotFound("Event not found".to_string()))?;

    let is_admin = state.auth_svc.is_admin(&session.user);
    let deleted = state
        .event_repo
        .delete_event(&existing.id, &session.user.id, is_admin, del_q.occurrence.as_deref())
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
    State(state): State<AppState>,
    Json(payload): Json<RespondEventRequest>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let existing = state
        .event_repo
        .get_event(&event_id)
        .await?
        .filter(|e| e.calendar_id == calendar_id)
        .ok_or_else(|| AppError::NotFound("Event not found".to_string()))?;

    let status = match payload.status.as_str() {
        "accepted" | "tentative" | "declined" => payload.status.as_str(),
        _ => return Err(AppError::BadRequest("Invalid RSVP status".to_string())),
    };

    let updated = state
        .event_repo
        .respond_event(
            &existing.id,
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
