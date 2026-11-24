use crate::config::AppConfig;
use crate::error::AppError;
use crate::models::auth::{GoogleUserInfo, User, UserSession};
use crate::repositories::auth_repo::AuthRepository;
use crate::repositories::calendar_repo::CalendarRepository;
use std::time::Instant;
use tracing::{info, warn};

#[derive(Clone)]
pub struct AuthService<AR: AuthRepository, CR: CalendarRepository> {
    auth_repo: AR,
    cal_repo: CR,
    http: reqwest::Client,
    config: AppConfig,
}

impl<AR: AuthRepository, CR: CalendarRepository> AuthService<AR, CR> {
    pub fn new(auth_repo: AR, cal_repo: CR, http: reqwest::Client, config: AppConfig) -> Self {
        Self {
            auth_repo,
            cal_repo,
            http,
            config,
        }
    }

    pub fn build_google_authorize_url(&self, state_token: &str) -> Result<String, AppError> {
        if !self.config.google_oauth_configured() {
            return Err(AppError::BadRequest(
                "Google OAuth is not configured in backend/config/default.yaml".to_string(),
            ));
        }

        let redirect_encoded: String = url::form_urlencoded::byte_serialize(
            self.config.auth.google_redirect_uri.as_bytes(),
        )
        .collect();
        let state_encoded: String =
            url::form_urlencoded::byte_serialize(state_token.as_bytes()).collect();

        Ok(format!(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=openid%20email%20profile&state={}&prompt=select_account",
            self.config.auth.google_client_id, redirect_encoded, state_encoded
        ))
    }

    pub async fn exchange_google_code(&self, code: &str) -> Result<UserSession, AppError> {
        if !self.config.google_oauth_configured() {
            return Err(AppError::BadRequest("Google OAuth is not configured".to_string()));
        }

        let t0 = Instant::now();
        let params = [
            ("code", code),
            ("client_id", self.config.auth.google_client_id.as_str()),
            ("client_secret", self.config.auth.google_client_secret.as_str()),
            ("redirect_uri", self.config.auth.google_redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ];

        let token_res = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&params)
            .send()
            .await
            .map_err(|e| AppError::External(format!("Google token exchange failed: {e}")))?;

        if !token_res.status().is_success() {
            let status = token_res.status();
            let err_body = token_res.text().await.unwrap_or_default();
            warn!(status = %status, body = %err_body, "Google OAuth token exchange rejected");
            return Err(AppError::BadRequest("Google OAuth authorization failed".to_string()));
        }

        let token_val: serde_json::Value = token_res
            .json()
            .await
            .map_err(|e| AppError::External(format!("Invalid Google token payload: {e}")))?;

        let access_token = token_val
            .get("access_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::External("Missing access_token from Google".to_string()))?;

        let user_res = self
            .http
            .get("https://openidconnect.googleapis.com/v1/userinfo")
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| AppError::External(format!("Google userinfo request failed: {e}")))?;

        if !user_res.status().is_success() {
            return Err(AppError::External("Failed to fetch Google user profile".to_string()));
        }

        let g_user: GoogleUserInfo = user_res
            .json()
            .await
            .map_err(|e| AppError::External(format!("Invalid Google userinfo JSON: {e}")))?;

        let display_name = g_user
            .name
            .filter(|n| !n.trim().is_empty())
            .or_else(|| g_user.email.clone())
            .unwrap_or_else(|| "Google User".to_string());

        let user = User {
            id: format!("google:{}", g_user.sub),
            email: g_user.email,
            name: display_name,
            avatar: g_user.picture,
            provider: "google".to_string(),
        };

        let session = self.persist_user_session(user).await?;
        info!(
            user_id = %session.user.id,
            duration_ms = t0.elapsed().as_millis() as u64,
            "Google OAuth login succeeded"
        );
        Ok(session)
    }

    pub async fn dev_login(&self, name: &str, email: Option<String>) -> Result<UserSession, AppError> {
        if !self.config.auth.allow_dev_login {
            return Err(AppError::Forbidden("Dev login is disabled in this environment".to_string()));
        }

        let clean_name = name.trim();
        let clean_email = email
            .map(|e| e.trim().to_lowercase())
            .filter(|e| !e.is_empty());
        let id_seed = clean_email
            .as_deref()
            .unwrap_or(clean_name)
            .to_lowercase()
            .replace(|c: char| !c.is_ascii_alphanumeric(), "_");

        let user = User {
            id: format!("dev:{}", id_seed),
            email: clean_email,
            name: clean_name.to_string(),
            avatar: None,
            provider: "dev".to_string(),
        };

        self.persist_user_session(user).await
    }

    async fn persist_user_session(&self, user: User) -> Result<UserSession, AppError> {
        self.auth_repo.upsert_user(&user).await?;
        let _ = self.cal_repo.ensure_personal_calendar(&user).await?;
        let session_id = uuid::Uuid::new_v4().to_string();
        self.auth_repo
            .create_session(&session_id, &user, self.config.auth.session_ttl_hours)
            .await
    }

    pub async fn verify_token(&self, token: &str) -> Result<UserSession, AppError> {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            return Err(AppError::Unauthorized("Missing authentication token".to_string()));
        }
        self.auth_repo
            .get_session(trimmed)
            .await?
            .ok_or_else(|| AppError::Unauthorized("Invalid or expired session".to_string()))
    }

    pub async fn logout(&self, token: &str) -> Result<(), AppError> {
        self.auth_repo.delete_session(token).await
    }

    pub fn is_admin(&self, user: &User) -> bool {
        let admin_email = self.config.auth.admin_email.trim();
        !admin_email.is_empty()
            && user
                .email
                .as_deref()
                .map(|e| e.eq_ignore_ascii_case(admin_email))
                .unwrap_or(false)
    }
}
