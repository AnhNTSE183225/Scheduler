use crate::error::AppError;
use crate::models::calendar::{CreateCalendarRequest, JoinCalendarRequest};
use crate::models::notification::SseNotificationEvent;
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::now_sec;
use crate::routes::require_session;
use crate::state::AppState;
use axum::{
    Json,
    extract::{ConnectInfo, Path, State},
    http::HeaderMap,
    response::IntoResponse,
};
use serde_json::json;
use std::net::SocketAddr;
use validator::Validate;

pub async fn list_calendars(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    let calendars = state.cal_repo.list_user_calendars(&session.user.id).await?;
    Ok(Json(StateMachineDTO::active(json!({ "calendars": calendars }))))
}

pub async fn create_calendar(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<CreateCalendarRequest>,
) -> Result<impl IntoResponse, AppError> {
    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Validation error: {e}")))?;

    let session = require_session(&headers, &state).await?;
    let cal = state
        .cal_repo
        .create_calendar(
            &session.user.id,
            &payload.name,
            payload.description.as_deref().unwrap_or(""),
        )
        .await?;

    Ok(Json(StateMachineDTO::active(json!({ "calendar": cal }))))
}

pub async fn join_calendar(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<JoinCalendarRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !state.auth_limiter.check(&format!("{}:join", addr.ip())) {
        return Err(AppError::TooManyRequests(
            "Too many join attempts. Please wait a minute.".to_string(),
        ));
    }

    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Validation error: {e}")))?;

    let session = require_session(&headers, &state).await?;
    let cal = state
        .cal_repo
        .join_by_invite_code(&session.user.id, &payload.invite_code)
        .await?
        .ok_or_else(|| AppError::NotFound("Invalid calendar invite code".to_string()))?;

    state.sse_svc.broadcast(SseNotificationEvent {
        kind: "member_joined".to_string(),
        calendar_id: cal.id.clone(),
        event_id: String::new(),
        title: Some(session.user.display_name.clone()),
        message: Some("Joined the group".to_string()),
        timestamp: now_sec(),
    });

    Ok(Json(StateMachineDTO::active(json!({ "calendar": cal }))))
}

pub async fn list_members(
    Path(calendar_id): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }
    let members = state.cal_repo.list_members(&calendar_id).await?;
    Ok(Json(StateMachineDTO::active(json!({ "members": members }))))
}

pub async fn remove_member(
    Path((calendar_id, member_id)): Path<(String, String)>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let cal = state
        .cal_repo
        .get_calendar(&calendar_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Calendar not found".to_string()))?;
    if cal.is_personal {
        return Err(AppError::BadRequest(
            "Cannot remove members from a personal calendar".to_string(),
        ));
    }

    let is_owner = cal.owner_id == session.user.id;
    let is_self = session.user.id == member_id;
    if !is_owner && !is_self {
        return Err(AppError::Forbidden(
            "Only the group owner can remove other members".to_string(),
        ));
    }
    if cal.owner_id == member_id {
        return Err(AppError::BadRequest(
            "The group owner cannot be removed".to_string(),
        ));
    }

    let removed = state.cal_repo.remove_member(&calendar_id, &member_id).await?;
    if !removed {
        return Err(AppError::NotFound("Member not found in this group".to_string()));
    }

    state.sse_svc.broadcast(SseNotificationEvent {
        kind: "member_removed".to_string(),
        calendar_id,
        event_id: String::new(),
        title: None,
        message: Some("Member updated".to_string()),
        timestamp: now_sec(),
    });

    Ok(Json(StateMachineDTO::active(json!({ "removed": true }))))
}
