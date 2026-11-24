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

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health_check))
        // Auth (3-field Argon2id Register / Login)
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/me", get(auth::get_me))
        // Calendars / Groups
        .route("/api/calendars", get(calendars::list_calendars).post(calendars::create_calendar))
        .route("/api/calendars/join", post(calendars::join_calendar))
        .route("/api/calendars/{calendar_id}/members", get(calendars::list_members))
        .route(
            "/api/calendars/{calendar_id}/members/{member_id}",
            axum::routing::delete(calendars::remove_member),
        )
        // Authenticated Schedule Events
        .route("/api/schedule/{calendar_id}", get(events::get_schedule).post(events::create_event))
        .route(
            "/api/schedule/{calendar_id}/{event_id}",
            axum::routing::put(events::update_event).delete(events::delete_event),
        )
        .route("/api/schedule/{calendar_id}/{event_id}/respond", post(events::respond_event))
        // Public Shareable Event Links (zero-friction RSVP & Push subscribe)
        .route("/api/public/events/{share_token}", get(public_events::get_public_event))
        .route("/api/public/events/{share_token}/respond", post(public_events::respond_public_event))
        .route(
            "/api/public/events/{share_token}/push-subscribe",
            post(public_events::subscribe_public_event_push),
        )
        // Web Push & Live SSE Stream (short-lived single-use ticket auth)
        .route("/api/push/vapid-key", get(notifications::get_vapid_key))
        .route("/api/push/subscribe", post(notifications::subscribe_push))
        .route("/api/push/unsubscribe", post(notifications::unsubscribe_push))
        .route("/api/push/test", post(notifications::send_test_push))
        .route(
            "/api/stream/{calendar_id}/ticket",
            post(notifications::issue_stream_ticket),
        )
        .route("/api/stream/{calendar_id}", get(notifications::stream_calendar))
        .with_state(state)
}

pub fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let auth_val = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok())?;
    let tok = auth_val
        .strip_prefix("Bearer ")
        .or_else(|| auth_val.strip_prefix("bearer "))?;
    let clean = tok.trim();
    if clean.is_empty() {
        None
    } else {
        Some(clean.to_string())
    }
}

pub async fn require_session(headers: &HeaderMap, state: &AppState) -> Result<UserSession, AppError> {
    let token = extract_bearer_token(headers)
        .ok_or_else(|| AppError::Unauthorized("Missing authentication token".to_string()))?;
    state.auth_svc.verify_token(&token).await
}

pub async fn optional_session(headers: &HeaderMap, state: &AppState) -> Option<UserSession> {
    let token = extract_bearer_token(headers)?;
    state.auth_svc.verify_token(&token).await.ok()
}
