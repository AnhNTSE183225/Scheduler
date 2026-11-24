pub mod auth;
pub mod calendars;
pub mod events;
pub mod health;
pub mod notifications;
pub mod public_events;

use crate::error::AppError;
use crate::models::auth::UserSession;
use crate::state::AppState;
use axum::{
    Router,
    http::{HeaderMap, header},
    routing::{get, post},
};
use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
pub struct AuthQuery {
    pub token: Option<String>,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health_check))
        // Auth
        .route("/api/auth/config", get(auth::get_auth_config))
        .route("/api/auth/google/login", get(auth::google_login))
        .route("/api/auth/google/callback", get(auth::google_callback))
        .route("/api/auth/dev-login", post(auth::dev_login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/me", get(auth::get_me))
        // Calendars / Groups
        .route("/api/calendars", get(calendars::list_calendars).post(calendars::create_calendar))
        .route("/api/calendars/join", post(calendars::join_calendar))
        .route("/api/calendars/{calendar_id}/members", get(calendars::list_members))
        // Authenticated Schedule Events
        .route("/api/schedule/{calendar_id}", get(events::get_schedule).post(events::create_event))
        .route(
            "/api/schedule/{calendar_id}/{event_id}",
            axum::routing::put(events::update_event).delete(events::delete_event),
        )
        .route("/api/schedule/{calendar_id}/{event_id}/respond", post(events::respond_event))
        .route("/api/schedule/{calendar_id}/{event_id}/ics", get(events::download_ics))
        // Public Shareable Event Links (zero-friction RSVP & Push subscribe)
        .route("/api/public/events/{share_token}", get(public_events::get_public_event))
        .route("/api/public/events/{share_token}/respond", post(public_events::respond_public_event))
        .route(
            "/api/public/events/{share_token}/push-subscribe",
            post(public_events::subscribe_public_event_push),
        )
        .route("/api/public/events/{share_token}/ics", get(public_events::download_public_ics))
        // Web Push & Live SSE Stream
        .route("/api/push/vapid-key", get(notifications::get_vapid_key))
        .route("/api/push/subscribe", post(notifications::subscribe_push))
        .route("/api/push/unsubscribe", post(notifications::unsubscribe_push))
        .route("/api/push/test", post(notifications::send_test_push))
        .route("/api/stream/{calendar_id}", get(notifications::stream_calendar))
        .with_state(state)
}

pub fn extract_bearer_token(headers: &HeaderMap, query: Option<&AuthQuery>) -> Option<String> {
    if let Some(auth_val) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(tok) = auth_val.strip_prefix("Bearer ").or_else(|| auth_val.strip_prefix("bearer ")) {
            let clean = tok.trim();
            if !clean.is_empty() {
                return Some(clean.to_string());
            }
        }
    }
    query
        .and_then(|q| q.token.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

pub async fn require_session(
    headers: &HeaderMap,
    query: Option<&AuthQuery>,
    state: &AppState,
) -> Result<UserSession, AppError> {
    let token = extract_bearer_token(headers, query)
        .ok_or_else(|| AppError::Unauthorized("Missing authentication token".to_string()))?;
    state.auth_svc.verify_token(&token).await
}

pub async fn optional_session(
    headers: &HeaderMap,
    query: Option<&AuthQuery>,
    state: &AppState,
) -> Option<UserSession> {
    let token = extract_bearer_token(headers, query)?;
    state.auth_svc.verify_token(&token).await.ok()
}
