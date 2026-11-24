use crate::error::AppError;
use crate::models::event::{GuestRespondRequest, PublicEventResponse};
use crate::models::notification::SubscribePushRequest;
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::event_repo::EventRepository;
use crate::repositories::push_repo::PushRepository;
use crate::routes::{AuthQuery, optional_session};
use crate::services::ics_service;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, header},
    response::IntoResponse,
};
use serde_json::json;
use validator::Validate;

pub async fn get_public_event(
    Path(share_token): Path<String>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let event = state
        .event_repo
        .get_event_by_share_token(&share_token)
        .await?
        .ok_or_else(|| AppError::NotFound("Event invite link not found".to_string()))?;

    let calendar_name = state
        .cal_repo
        .get_calendar(&event.calendar_id)
        .await?
        .map(|c| c.name)
        .unwrap_or_else(|| "Shared Event".to_string());
    let members = state.cal_repo.list_member_infos(&event.calendar_id).await?;

    Ok(Json(StateMachineDTO::active(PublicEventResponse {
        event,
        calendar_name,
        members,
    })))
}

pub async fn respond_public_event(
    Path(share_token): Path<String>,
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
    Json(payload): Json<GuestRespondRequest>,
) -> Result<impl IntoResponse, AppError> {
    let event = state
        .event_repo
        .get_event_by_share_token(&share_token)
        .await?
        .ok_or_else(|| AppError::NotFound("Event invite link not found".to_string()))?;

    let status = match payload.status.as_str() {
        "accepted" | "tentative" | "declined" => payload.status.as_str(),
        _ => return Err(AppError::BadRequest("Invalid RSVP status".to_string())),
    };

    let scope = payload.scope.as_deref().unwrap_or("occurrence");
    let session = optional_session(&headers, Some(&q), &state).await;

    let (responder_id, guest_name) = if let Some(sess) = session {
        (sess.user.id, None)
    } else {
        payload
            .validate()
            .map_err(|e| AppError::BadRequest(format!("Please enter your name: {e}")))?;
        let slug = payload
            .name
            .trim()
            .to_lowercase()
            .replace(|c: char| !c.is_ascii_alphanumeric(), "_");
        (format!("guest:{}", slug), Some(payload.name.trim()))
    };

    let updated = state
        .event_repo
        .respond_event(
            &event.id,
            &responder_id,
            guest_name,
            &payload.key,
            status,
            scope,
        )
        .await?
        .ok_or_else(|| AppError::NotFound("Event not found".to_string()))?;

    state.reminder_svc.notify_rsvp_updated(&updated);
    Ok(Json(StateMachineDTO::active(json!({
        "event": updated,
        "responderId": responder_id
    }))))
}

pub async fn subscribe_public_event_push(
    Path(share_token): Path<String>,
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
    Json(payload): Json<SubscribePushRequest>,
) -> Result<impl IntoResponse, AppError> {
    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Invalid push subscription: {e}")))?;

    let event = state
        .event_repo
        .get_event_by_share_token(&share_token)
        .await?
        .ok_or_else(|| AppError::NotFound("Event invite link not found".to_string()))?;

    let session = optional_session(&headers, Some(&q), &state).await;
    let user_id = session
        .map(|s| s.user.id)
        .unwrap_or_else(|| format!("guest-push:{}", uuid::Uuid::new_v4().simple()));

    let sub = state
        .push_repo
        .upsert_subscription(
            &user_id,
            Some(&event.id),
            &payload.endpoint,
            &payload.keys.p256dh,
            &payload.keys.auth,
            payload.user_agent.as_deref(),
        )
        .await?;

    Ok(Json(StateMachineDTO::active(json!({ "subscriptionId": sub.id }))))
}

pub async fn download_public_ics(
    Path(share_token): Path<String>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let ev = state
        .event_repo
        .get_event_by_share_token(&share_token)
        .await?
        .ok_or_else(|| AppError::NotFound("Event invite link not found".to_string()))?;

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
