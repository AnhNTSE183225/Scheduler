use serde::{Deserialize, Serialize};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct SubscribePushRequest {
    #[validate(url)]
    pub endpoint: String,
    pub keys: PushSubscriptionKeys,
    #[serde(rename = "userAgent")]
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UnsubscribePushRequest {
    pub endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSubscriptionRecord {
    pub id: String,
    pub user_id: String,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub user_agent: Option<String>,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct VapidPublicKeyResponse {
    #[serde(rename = "publicKey")]
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SseNotificationEvent {
    pub kind: String, // "event_created" | "event_updated" | "event_deleted" | "rsvp_updated" | "reminder"
    #[serde(rename = "calendarId")]
    pub calendar_id: String,
    #[serde(rename = "eventId")]
    pub event_id: String,
    pub title: Option<String>,
    pub message: Option<String>,
    pub timestamp: f64,
}
