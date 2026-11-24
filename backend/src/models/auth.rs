use serde::{Deserialize, Serialize};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub avatar: Option<String>,
}

/// Internal DB representation including the Argon2id password hash (never serialized to HTTP).
#[derive(Debug, Clone)]
pub struct StoredUser {
    pub user: User,
    pub password_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSession {
    pub session_id: String,
    pub user: User,
    pub created_at: f64,
    pub expires_at: f64,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct RegisterRequest {
    #[serde(rename = "displayName")]
    #[validate(length(min = 1, max = 80))]
    pub display_name: String,
    #[validate(length(min = 3, max = 32))]
    pub username: String,
    #[validate(length(min = 8, max = 128))]
    pub password: String,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(length(min = 3, max = 32))]
    pub username: String,
    #[validate(length(min = 1, max = 128))]
    pub password: String,
}
