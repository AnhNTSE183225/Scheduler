use crate::error::AppError;
use crate::models::auth::{LoginRequest, RegisterRequest};
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::routes::{extract_bearer_token, require_session};
use crate::state::AppState;
use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::HeaderMap,
    response::IntoResponse,
};
use serde_json::json;
use std::net::SocketAddr;
use validator::Validate;

pub async fn register(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<impl IntoResponse, AppError> {
    let key = format!("{}:register", addr.ip());
    if !state.auth_limiter.check(&key) {
        return Err(AppError::TooManyRequests(
            "Too many registration attempts. Please wait a minute.".to_string(),
        ));
    }

    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Validation error: {e}")))?;

    let session = state
        .auth_svc
        .register(&payload.display_name, &payload.username, &payload.password)
        .await?;
    let calendars = state.cal_repo.list_user_calendars(&session.user.id).await?;
    let is_admin = state.auth_svc.is_admin(&session.user);

    Ok(Json(StateMachineDTO::active(json!({
        "token": session.session_id,
        "user": session.user,
        "calendars": calendars,
        "isAdmin": is_admin
    }))))
}

pub async fn login(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let ip_key = format!("{}:login", addr.ip());
    if !state.auth_limiter.check(&ip_key) {
        return Err(AppError::TooManyRequests(
            "Too many login attempts. Please wait a minute.".to_string(),
        ));
    }

    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Validation error: {e}")))?;

    let session = state
        .auth_svc
        .login(&payload.username, &payload.password)
        .await?;
    let calendars = state.cal_repo.list_user_calendars(&session.user.id).await?;
    let is_admin = state.auth_svc.is_admin(&session.user);

    Ok(Json(StateMachineDTO::active(json!({
        "token": session.session_id,
        "user": session.user,
        "calendars": calendars,
        "isAdmin": is_admin
    }))))
}

pub async fn logout(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    if let Some(token) = extract_bearer_token(&headers) {
        state.auth_svc.logout(&token).await?;
    }
    Ok(Json(StateMachineDTO::idle(
        json!({ "ok": true }),
        Some("Logged out".to_string()),
    )))
}

pub async fn get_me(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    let _ = state.cal_repo.ensure_personal_calendar(&session.user).await?;
    let calendars = state.cal_repo.list_user_calendars(&session.user.id).await?;
    let is_admin = state.auth_svc.is_admin(&session.user);

    Ok(Json(StateMachineDTO::active(json!({
        "user": session.user,
        "calendars": calendars,
        "isAdmin": is_admin
    }))))
}
