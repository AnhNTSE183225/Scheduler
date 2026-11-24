use crate::error::AppError;
use crate::models::event::{GuestRespondRequest, PublicEventResponse};
use crate::models::notification::SubscribePushRequest;
use crate::models::state::StateMachineDTO;
use crate::repositories::calendar_repo::CalendarRepository;
use crate::repositories::event_repo::EventRepository;
use crate::repositories::push_repo::PushRepository;
use crate::routes::optional_session;
use crate::services::push_service::validate_push_endpoint;
use crate::state::AppState;
use axum::{
    Json,
    extract::{ConnectInfo, Path, State},
    http::HeaderMap,
    response::IntoResponse,
};
use serde_json::json;
use std::collections::HashSet;
use std::net::SocketAddr;
use validator::Validate;

fn is_valid_guest_id(raw: &str) -> bool {
    let Some(hex) = raw.strip_prefix("guest:") else {
        return false;
    };
    hex.len() == 32 && hex.chars().all(|c| c.is_ascii_hexdigit())
}

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
    let all_members = state.cal_repo.list_member_infos(&event.calendar_id).await?;

    let members = if event.invite_everyone {
        all_members
    } else {
        let mut visible: HashSet<String> = HashSet::new();
        visible.insert(event.organizer_id.clone());
        for id in &event.invitee_ids {
            visible.insert(id.clone());
        }
        if let Some(map) = event.series_responses.as_object() {
            for id in map.keys() {
                visible.insert(id.clone());
            }
        }
        if let Some(occ_map) = event.occurrence_responses.as_object() {
            for inner in occ_map.values() {
                if let Some(m) = inner.as_object() {
                    for id in m.keys() {
                        visible.insert(id.clone());
                    }
                }
            }
        }
        all_members
            .into_iter()
            .filter(|m| visible.contains(&m.id))
            .collect()
    };

    Ok(Json(StateMachineDTO::active(PublicEventResponse {
        event,
        calendar_name,
        members,
    })))
}

pub async fn respond_public_event(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(share_token): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<GuestRespondRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !state
        .public_limiter
        .check(&format!("{}:rsvp:{}", addr.ip(), share_token))
    {
        return Err(AppError::TooManyRequests(
            "Too many RSVP updates for this event right now. Please try again shortly.".to_string(),
        ));
    }

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
    let session = optional_session(&headers, &state).await;

    let (responder_id, guest_name) = if let Some(sess) = session {
        (sess.user.id, None)
    } else {
        payload
            .validate()
            .map_err(|e| AppError::BadRequest(format!("Please enter your name: {e}")))?;
        let trimmed_name = payload.name.trim();
        if trimmed_name.is_empty() {
            return Err(AppError::BadRequest("Please enter your name".to_string()));
        }
        let gid = payload
            .guest_id
            .as_deref()
            .filter(|id| is_valid_guest_id(id))
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("guest:{}", uuid::Uuid::new_v4().simple()));
        (gid, Some(trimmed_name))
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
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(share_token): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<SubscribePushRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !state
        .public_limiter
        .check(&format!("{}:push:{}", addr.ip(), share_token))
    {
        return Err(AppError::TooManyRequests(
            "Too many push subscriptions for this link right now.".to_string(),
        ));
    }

    payload
        .validate()
        .map_err(|e| AppError::BadRequest(format!("Invalid push subscription: {e}")))?;
    validate_push_endpoint(&payload.endpoint)?;

    let event = state
        .event_repo
        .get_event_by_share_token(&share_token)
        .await?
        .ok_or_else(|| AppError::NotFound("Event invite link not found".to_string()))?;

    let session = optional_session(&headers, &state).await;
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
