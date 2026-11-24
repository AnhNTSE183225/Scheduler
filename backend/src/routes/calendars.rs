use crate::error::AppError;
use crate::models::calendar::{CreateCalendarRequest, JoinCalendarRequest};
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
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
