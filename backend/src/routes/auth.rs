use crate::error::AppError;
use crate::models::auth::{AuthConfigResponse, DevLoginRequest};
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::routes::{AuthQuery, extract_bearer_token, require_session};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Redirect, Response},
};
use serde::Deserialize;
use serde_json::json;
use std::time::{Duration, Instant};
use validator::Validate;

#[derive(Debug, Deserialize)]
pub struct GoogleLoginQuery {
    pub next: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GoogleCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

pub async fn get_auth_config(State(state): State<AppState>) -> Json<AuthConfigResponse> {
    Json(AuthConfigResponse {
        google_enabled: state.config.google_oauth_configured(),
        dev_login_enabled: state.config.auth.allow_dev_login,
    })
}

pub async fn google_login(
    Query(q): Query<GoogleLoginQuery>,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let csrf_key = uuid::Uuid::new_v4().simple().to_string();
    let next_path = q
        .next
        .as_deref()
        .filter(|n| n.starts_with('/') && !n.starts_with("//"))
        .unwrap_or("/");

    let state_payload = format!("{}|{}", csrf_key, next_path);

    if let Ok(mut map) = state.oauth_states.write() {
        let now = Instant::now();
        map.retain(|_, created| now.duration_since(*created) < Duration::from_secs(600));
        map.insert(csrf_key, now);
    }

    let url = state.auth_svc.build_google_authorize_url(&state_payload)?;
    Ok(Redirect::temporary(&url).into_response())
}

pub async fn google_callback(
    Query(q): Query<GoogleCallbackQuery>,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    if let Some(err) = q.error {
        return Err(AppError::BadRequest(format!("Google login cancelled: {err}")));
    }

    let code = q
        .code
        .as_deref()
        .filter(|c| !c.is_empty())
        .ok_or_else(|| AppError::BadRequest("Missing authorization code".to_string()))?;

    let state_raw = q
        .state
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("Missing OAuth state".to_string()))?;

    let (csrf_key, next_path) = state_raw.split_once('|').unwrap_or((state_raw, "/"));
    let valid_state = state
        .oauth_states
        .write()
        .ok()
        .and_then(|mut map| map.remove(csrf_key))
        .map(|ts| ts.elapsed() < Duration::from_secs(600))
        .unwrap_or(false);

    if !valid_state {
        return Err(AppError::BadRequest("Invalid or expired OAuth state".to_string()));
    }

    let session = state.auth_svc.exchange_google_code(code).await?;
    let base = state.config.server.frontend_url.trim_end_matches('/');
    let clean_next = if next_path.starts_with('/') && !next_path.starts_with("//") {
        next_path
    } else {
        "/"
    };
    let sep = if clean_next.contains('?') { '&' } else { '?' };
    let redirect_url = format!("{}{}{}token={}", base, clean_next, sep, session.session_id);

    Ok(Redirect::temporary(&redirect_url).into_response())
}

pub async fn dev_login(
    State(state): State<AppState>,
    Json(payload): Json<DevLoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Validation error: {e}")))?;

    let session = state
        .auth_svc
        .dev_login(&payload.name, payload.email)
        .await?;
    let calendars = state.cal_repo.list_user_calendars(&session.user.id).await?;

    Ok(Json(StateMachineDTO::active(json!({
        "token": session.session_id,
        "user": session.user,
        "calendars": calendars
    }))))
}

pub async fn logout(
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    if let Some(token) = extract_bearer_token(&headers, Some(&q)) {
        state.auth_svc.logout(&token).await?;
    }
    Ok(Json(StateMachineDTO::idle(json!({ "ok": true }), Some("Logged out".to_string()))))
}

pub async fn get_me(
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, Some(&q), &state).await?;
    let _ = state.cal_repo.ensure_personal_calendar(&session.user).await?;
    let calendars = state.cal_repo.list_user_calendars(&session.user.id).await?;
    let is_admin = state.auth_svc.is_admin(&session.user);

    Ok(Json(StateMachineDTO::active(json!({
        "user": session.user,
        "calendars": calendars,
        "isAdmin": is_admin
    }))))
}
