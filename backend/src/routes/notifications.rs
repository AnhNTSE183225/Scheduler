use crate::error::AppError;
use crate::models::notification::{
    SubscribePushRequest, UnsubscribePushRequest, VapidPublicKeyResponse,
};
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::push_repo::PushRepository;
use crate::routes::{AuthQuery, require_session};
use crate::services::push_service::PushPayload;
use crate::state::AppState;
use async_stream::stream;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{
        IntoResponse,
        sse::{Event, KeepAlive, Sse},
    },
};
use futures::stream::Stream;
use serde_json::json;
use std::convert::Infallible;
use std::time::Duration;
use validator::Validate;

pub async fn get_vapid_key(State(state): State<AppState>) -> Json<VapidPublicKeyResponse> {
    Json(VapidPublicKeyResponse {
        public_key: state.push_svc.public_key().to_string(),
    })
}

pub async fn subscribe_push(
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
    Json(payload): Json<SubscribePushRequest>,
) -> Result<impl IntoResponse, AppError> {
    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Invalid push subscription: {e}")))?;

    let session = require_session(&headers, Some(&q), &state).await?;
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
    State(state): State<AppState>,
    Json(payload): Json<UnsubscribePushRequest>,
) -> Result<impl IntoResponse, AppError> {
    state
        .push_repo
        .delete_subscription_by_endpoint(&payload.endpoint)
        .await?;
    Ok(Json(StateMachineDTO::idle(json!({ "ok": true }), Some("Unsubscribed".to_string()))))
}

pub async fn send_test_push(
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let session = require_session(&headers, Some(&q), &state).await?;
    let subs = state
        .push_repo
        .list_subscriptions_for_users(&[session.user.id.clone()])
        .await?;

    let payload = PushPayload {
        title: "PulsePlan Push Test".to_string(),
        body: format!("Notifications are active for {}!", session.user.name),
        url: state.config.server.frontend_url.clone(),
        tag: "push-test".to_string(),
    };

    let delivered = state.push_svc.dispatch_to_subscriptions(&subs, &payload).await;
    Ok(Json(StateMachineDTO::active(json!({
        "subscriptions": subs.len(),
        "delivered": delivered
    }))))
}

pub async fn stream_calendar(
    Path(calendar_id): Path<String>,
    headers: HeaderMap,
    Query(q): Query<AuthQuery>,
    State(state): State<AppState>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let session = require_session(&headers, Some(&q), &state).await?;
    if !state.cal_repo.is_member(&calendar_id, &session.user.id).await? {
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
