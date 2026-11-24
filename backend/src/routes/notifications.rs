use crate::error::AppError;
use crate::models::notification::{
    SubscribePushRequest, UnsubscribePushRequest, VapidPublicKeyResponse,
};
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::push_repo::PushRepository;
use crate::routes::require_session;
use crate::services::push_service::{PushPayload, validate_push_endpoint};
use crate::state::AppState;
use async_stream::stream;
use axum::{
    Json,
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
    response::{
        IntoResponse,
        sse::{Event, KeepAlive, Sse},
    },
};
use futures::stream::Stream;
use serde::Deserialize;
use serde_json::json;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use validator::Validate;

const SSE_TICKET_TTL_SECS: u64 = 30;
const MAX_SSE_TICKETS: usize = 2048;

#[derive(Debug, Deserialize, Default)]
pub struct StreamTicketQuery {
    pub ticket: Option<String>,
}

pub async fn get_vapid_key(State(state): State<AppState>) -> Json<VapidPublicKeyResponse> {
    Json(VapidPublicKeyResponse {
        public_key: state.push_svc.public_key().to_string(),
    })
}

pub async fn subscribe_push(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<SubscribePushRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !state.auth_limiter.check(&format!("{}:push_sub", addr.ip())) {
        return Err(AppError::TooManyRequests(
            "Too many push subscription updates. Please wait a minute.".to_string(),
        ));
    }

    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Invalid push subscription: {e}")))?;
    validate_push_endpoint(&payload.endpoint)?;

    let session = require_session(&headers, &state).await?;
    let sub = state
        .push_repo
        .upsert_subscription(
            &session.user.id,
            None,
            &payload.endpoint,
            &payload.keys.p256dh,
            &payload.keys.auth,
            payload.user_agent.as_deref(),
        )
        .await?;

    Ok(Json(StateMachineDTO::active(json!({ "subscriptionId": sub.id }))))
}

pub async fn unsubscribe_push(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<UnsubscribePushRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !state.auth_limiter.check(&format!("{}:push_unsub", addr.ip())) {
        return Err(AppError::TooManyRequests(
            "Too many push unsubscribe requests. Please wait a minute.".to_string(),
        ));
    }

    let session = require_session(&headers, &state).await?;
    state
        .push_repo
        .delete_subscription_for_user(&payload.endpoint, &session.user.id)
        .await?;
    Ok(Json(StateMachineDTO::idle(
        json!({ "ok": true }),
        Some("Unsubscribed".to_string()),
    )))
}

pub async fn send_test_push(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    if !state.auth_limiter.check(&format!("{}:push_test", addr.ip())) {
        return Err(AppError::TooManyRequests(
            "Too many test push requests. Please wait a minute.".to_string(),
        ));
    }

    let session = require_session(&headers, &state).await?;
    let subs = state
        .push_repo
        .list_subscriptions_for_users(&[session.user.id.clone()])
        .await?;

    let payload = PushPayload {
        title: "PulsePlan Push Test".to_string(),
        body: format!("Notifications are active for {}!", session.user.display_name),
        url: state.config.server.frontend_url.clone(),
        tag: "push-test".to_string(),
    };

    let delivered = state.push_svc.dispatch_to_subscriptions(&subs, &payload).await;
    Ok(Json(StateMachineDTO::active(json!({
        "subscriptions": subs.len(),
        "delivered": delivered
    }))))
}

pub async fn issue_stream_ticket(
    Path(calendar_id): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let ticket = uuid::Uuid::new_v4().simple().to_string();
    let now = Instant::now();
    let ttl = Duration::from_secs(SSE_TICKET_TTL_SECS);

    {
        let mut guard = state
            .sse_tickets
            .write()
            .unwrap_or_else(|e| e.into_inner());
        guard.retain(|_, (_, _, issued_at)| now.duration_since(*issued_at) < ttl);
        if guard.len() >= MAX_SSE_TICKETS {
            if let Some(oldest_key) = guard
                .iter()
                .min_by_key(|(_, (_, _, issued_at))| *issued_at)
                .map(|(k, _)| k.clone())
            {
                guard.remove(&oldest_key);
            }
        }
        guard.insert(ticket.clone(), (session.user.id, calendar_id, now));
    }

    Ok(Json(StateMachineDTO::active(json!({
        "ticket": ticket,
        "expiresInSeconds": SSE_TICKET_TTL_SECS
    }))))
}

pub async fn stream_calendar(
    Path(calendar_id): Path<String>,
    Query(q): Query<StreamTicketQuery>,
    State(state): State<AppState>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let ticket = q
        .ticket
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Unauthorized("Missing stream ticket".to_string()))?;

    let (user_id, ticket_cal_id, issued_at) = {
        let mut guard = state
            .sse_tickets
            .write()
            .unwrap_or_else(|e| e.into_inner());
        guard.remove(ticket)
    }
    .ok_or_else(|| AppError::Unauthorized("Invalid or expired stream ticket".to_string()))?;

    if issued_at.elapsed() >= Duration::from_secs(SSE_TICKET_TTL_SECS)
        || ticket_cal_id != calendar_id
    {
        return Err(AppError::Unauthorized(
            "Invalid or expired stream ticket".to_string(),
        ));
    }

    if !state.cal_repo.is_member(&calendar_id, &user_id).await? {
        return Err(AppError::Forbidden("You do not belong to this calendar".to_string()));
    }

    let mut rx = state.sse_svc.subscribe();

    let s = stream! {
        let hello = json!({
            "kind": "connected",
            "calendarId": calendar_id,
            "status": "active"
        });
        yield Ok(Event::default().event("schedule").data(hello.to_string()));

        loop {
            match rx.recv().await {
                Ok(ev) if ev.calendar_id == calendar_id => {
                    if let Ok(data) = serde_json::to_string(&ev) {
                        yield Ok(Event::default().event("schedule").data(data));
                    }
                }
                Ok(_) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Ok(Sse::new(s).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}
