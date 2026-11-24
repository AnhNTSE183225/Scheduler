use serde::{Deserialize, Serialize};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarSpace {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "inviteCode")]
    pub invite_code: String,
    #[serde(rename = "ownerId")]
    pub owner_id: String,
    #[serde(rename = "isPersonal")]
    pub is_personal: bool,
    #[serde(rename = "createdAt")]
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarMember {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub avatar: Option<String>,
    pub role: String, // "owner" | "member" | "guest"
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct CreateCalendarRequest {
    #[validate(length(min = 1, max = 80))]
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct JoinCalendarRequest {
    #[serde(rename = "inviteCode")]
    #[validate(length(min = 3, max = 64))]
    pub invite_code: String,
}
