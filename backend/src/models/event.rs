use serde::{Deserialize, Serialize};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleEventLocation {
    pub kind: String, // "address" | "link"
    pub address: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleEventLink {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleEventRecurrence {
    pub freq: String, // "daily" | "weekly" | "monthly"
    pub interval: i32,
    pub weekdays: Option<Vec<i32>>,
    pub until: Option<String>,
    pub count: Option<i32>,
}

fn default_duration() -> i32 {
    60
}

fn default_true() -> bool {
    true
}

fn default_empty_json() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleEvent {
    #[serde(default)]
    pub id: String,
    #[serde(default, rename = "calendarId")]
    pub calendar_id: String,
    #[serde(default, rename = "shareToken")]
    pub share_token: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub category: Option<String>,
    #[serde(default)]
    pub start: String,
    #[serde(default = "default_duration", rename = "durationMinutes")]
    pub duration_minutes: i32,
    pub recurrence: Option<ScheduleEventRecurrence>,
    pub location: Option<ScheduleEventLocation>,
    #[serde(rename = "imageUrl")]
    pub image_url: Option<String>,
    #[serde(default)]
    pub links: Vec<ScheduleEventLink>,
    #[serde(default, rename = "organizerId")]
    pub organizer_id: String,
    #[serde(rename = "organizerName")]
    pub organizer_name: Option<String>,
    #[serde(rename = "organizerAvatar")]
    pub organizer_avatar: Option<String>,
    #[serde(default = "default_true", rename = "inviteEveryone")]
    pub invite_everyone: bool,
    #[serde(default, rename = "inviteeIds")]
    pub invitee_ids: Vec<String>,
    #[serde(default = "default_empty_json", rename = "seriesResponses")]
    pub series_responses: serde_json::Value,
    #[serde(default = "default_empty_json", rename = "occurrenceResponses")]
    pub occurrence_responses: serde_json::Value,
    #[serde(default = "default_empty_json", rename = "guestNames")]
    pub guest_names: serde_json::Value,
    #[serde(default, rename = "cancelledOccurrences")]
    pub cancelled_occurrences: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<f64>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarMemberInfo {
    pub id: String,
    pub name: String,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct RespondEventRequest {
    pub key: String,
    pub status: String, // "accepted" | "tentative" | "declined"
    pub scope: String,  // "occurrence" | "series"
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct GuestRespondRequest {
    #[validate(length(min = 1, max = 80))]
    pub name: String,
    pub key: String,
    pub status: String, // "accepted" | "tentative" | "declined"
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicEventResponse {
    pub event: ScheduleEvent,
    pub calendar_name: String,
    pub members: Vec<CalendarMemberInfo>,
}
