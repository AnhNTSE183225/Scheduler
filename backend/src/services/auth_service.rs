use crate::config::AppConfig;
use crate::error::AppError;
use crate::models::auth::{User, UserSession};
use crate::repositories::auth_repo::AuthRepository;
use crate::repositories::calendar_repo::CalendarRepository;
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use std::sync::LazyLock;
use std::time::Instant;
use tracing::{info, warn};

/// Genuine runtime-generated Argon2id hash used when username does not exist (constant-time defense).
static DUMMY_ARGON2_HASH: LazyLock<String> = LazyLock::new(|| {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(b"pulseplan-constant-time-guard", &salt)
        .expect("Argon2id dummy hash generation must succeed")
        .to_string()
});

#[derive(Clone)]
pub struct AuthService<AR: AuthRepository, CR: CalendarRepository> {
    auth_repo: AR,
    cal_repo: CR,
    config: AppConfig,
}

impl<AR: AuthRepository, CR: CalendarRepository> AuthService<AR, CR> {
    pub fn new(auth_repo: AR, cal_repo: CR, config: AppConfig) -> Self {
        Self {
            auth_repo,
            cal_repo,
            config,
        }
    }

    pub fn normalize_username(raw: &str) -> Result<String, AppError> {
        let normalized = raw.trim().to_lowercase();
        if normalized.len() < 3 || normalized.len() > 32 {
            return Err(AppError::BadRequest(
                "Username must be between 3 and 32 characters".to_string(),
            ));
        }
        if !normalized
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' || c == '.')
        {
            return Err(AppError::BadRequest(
                "Username may only contain letters, numbers, '.', '_', and '-'".to_string(),
            ));
        }
        Ok(normalized)
    }

    async fn hash_password(password: String) -> Result<String, AppError> {
        tokio::task::spawn_blocking(move || {
            let salt = SaltString::generate(&mut OsRng);
            Argon2::default()
                .hash_password(password.as_bytes(), &salt)
                .map(|h| h.to_string())
                .map_err(|e| AppError::Internal(format!("Password hashing failed: {e}")))
        })
        .await
        .map_err(|e| AppError::Internal(format!("Password hash worker failed: {e}")))?
    }

    async fn verify_password(password: String, hash: String) -> Result<bool, AppError> {
        tokio::task::spawn_blocking(move || {
            let Ok(parsed) = PasswordHash::new(&hash) else {
                return false;
            };
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .await
        .map_err(|e| AppError::Internal(format!("Password verify worker failed: {e}")))
    }

    pub async fn register(
        &self,
        display_name: &str,
        username: &str,
        password: &str,
    ) -> Result<UserSession, AppError> {
        let t0 = Instant::now();
        let clean_display: String = display_name.split_whitespace().collect::<Vec<_>>().join(" ");
        let display_chars = clean_display.chars().count();
        if display_chars == 0 || display_chars > 80 {
            return Err(AppError::BadRequest(
                "Display name must be between 1 and 80 characters".to_string(),
            ));
        }
        let clean_username = Self::normalize_username(username)?;
        let pass_chars = password.chars().count();
        if pass_chars < 8 || pass_chars > 128 {
            return Err(AppError::BadRequest(
                "Password must be between 8 and 128 characters".to_string(),
            ));
        }

        let password_hash = Self::hash_password(password.to_string()).await?;
        let user = User {
            id: format!("usr-{}", uuid::Uuid::new_v4().simple()),
            username: clean_username,
            display_name: clean_display,
            avatar: None,
        };

        self.auth_repo.create_user(&user, &password_hash).await?;
        let _ = self.cal_repo.ensure_personal_calendar(&user).await?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let session = self
            .auth_repo
            .create_session(&session_id, &user, self.config.auth.session_ttl_hours)
            .await?;

        info!(
            user_id = %session.user.id,
            username = %session.user.username,
            duration_ms = t0.elapsed().as_millis() as u64,
            "New user registered"
        );
        Ok(session)
    }

    pub async fn login(&self, username: &str, password: &str) -> Result<UserSession, AppError> {
        let t0 = Instant::now();
        let clean_username = Self::normalize_username(username)
            .map_err(|_| AppError::Unauthorized("Invalid username or password".to_string()))?;

        let stored = self.auth_repo.find_by_username(&clean_username).await?;
        let Some(stored) = stored else {
            let _ = Self::verify_password(password.to_string(), DUMMY_ARGON2_HASH.clone()).await;
            warn!(username = %clean_username, "Login failed: unknown username");
            return Err(AppError::Unauthorized("Invalid username or password".to_string()));
        };

        let valid = Self::verify_password(password.to_string(), stored.password_hash).await?;
        if !valid {
            warn!(
                user_id = %stored.user.id,
                duration_ms = t0.elapsed().as_millis() as u64,
                "Login failed: invalid password"
            );
            return Err(AppError::Unauthorized("Invalid username or password".to_string()));
        }

        let _ = self.cal_repo.ensure_personal_calendar(&stored.user).await?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let session = self
            .auth_repo
            .create_session(&session_id, &stored.user, self.config.auth.session_ttl_hours)
            .await?;

        info!(
            user_id = %session.user.id,
            duration_ms = t0.elapsed().as_millis() as u64,
            "User login succeeded"
        );
        Ok(session)
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

    pub async fn update_display_name(
        &self,
        user_id: &str,
        display_name: &str,
    ) -> Result<User, AppError> {
        let clean_name = display_name.trim();
        let name_chars = clean_name.chars().count();
        if name_chars == 0 || name_chars > 80 {
            return Err(AppError::BadRequest(
                "Display name must be between 1 and 80 characters".to_string(),
            ));
        }
        let user = self
            .auth_repo
            .update_display_name(user_id, clean_name)
            .await?;
        info!(user_id = %user.id, "User display name updated");
        Ok(user)
    }

    pub async fn change_password(
        &self,
        user_id: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), AppError> {
        let stored = self
            .auth_repo
            .find_by_id(user_id)
            .await?
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

        let valid = Self::verify_password(current_password.to_string(), stored.password_hash).await?;
        if !valid {
            return Err(AppError::Unauthorized(
                "Current password is incorrect".to_string(),
            ));
        }

        let new_chars = new_password.chars().count();
        if !(8..=128).contains(&new_chars) {
            return Err(AppError::BadRequest(
                "New password must be between 8 and 128 characters".to_string(),
            ));
        }
        if current_password == new_password {
            return Err(AppError::BadRequest(
                "New password must be different from your current password".to_string(),
            ));
        }

        let new_hash = Self::hash_password(new_password.to_string()).await?;
        self.auth_repo.update_password_hash(user_id, &new_hash).await?;
        info!(user_id = %user_id, "User password changed");
        Ok(())
    }

    pub fn is_admin(&self, user: &User) -> bool {
        let admin_username = self.config.auth.admin_username.trim();
        !admin_username.is_empty() && user.username.eq_ignore_ascii_case(admin_username)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::auth_repo::SqliteAuthRepository;
    use crate::repositories::calendar_repo::SqliteCalendarRepository;

    #[test]
    fn dummy_argon2_hash_parses_cleanly() {
        assert!(PasswordHash::new(&DUMMY_ARGON2_HASH).is_ok());
    }

    #[test]
    fn normalize_username_enforces_charset_and_length() {
        assert_eq!(
            AuthService::<SqliteAuthRepository, SqliteCalendarRepository>::normalize_username("  Alex_99  ").unwrap(),
            "alex_99"
        );
        assert!(AuthService::<SqliteAuthRepository, SqliteCalendarRepository>::normalize_username("ab").is_err());
        assert!(AuthService::<SqliteAuthRepository, SqliteCalendarRepository>::normalize_username("bad user!").is_err());
    }

    #[tokio::test]
    async fn argon2_hash_and_verify_roundtrip() {
        let hash = AuthService::<SqliteAuthRepository, SqliteCalendarRepository>::hash_password(
            "SuperSecret123!".to_string(),
        )
        .await
        .unwrap();
        assert!(hash.starts_with("$argon2id$"), "Expected Argon2id hash: {hash}");
        assert!(!hash.contains("SuperSecret123!"));

        let ok = AuthService::<SqliteAuthRepository, SqliteCalendarRepository>::verify_password(
            "SuperSecret123!".to_string(),
            hash.clone(),
        )
        .await
        .unwrap();
        assert!(ok);

        let bad = AuthService::<SqliteAuthRepository, SqliteCalendarRepository>::verify_password(
            "WrongPass999!".to_string(),
            hash,
        )
        .await
        .unwrap();
        assert!(!bad);
    }
}
