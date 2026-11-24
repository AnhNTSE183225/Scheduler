use serde::{Deserialize, Serialize};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub name: String,
    pub avatar: Option<String>,
    pub provider: String, // "google" | "dev" | "guest"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSession {
    pub session_id: String,
    pub user: User,
    pub created_at: f64,
    pub expires_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleUserInfo {
    pub sub: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct DevLoginRequest {
    #[validate(length(min = 1, max = 80))]
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthConfigResponse {
    pub google_enabled: bool,
    pub dev_login_enabled: bool,
}
