use crate::error::AppError;
use crate::models::auth::{StoredUser, User, UserSession};
use crate::repositories::now_sec;
use sqlx::{Row, SqlitePool};
use std::future::Future;

pub trait AuthRepository: Send + Sync {
    fn create_user(
        &self,
        user: &User,
        password_hash: &str,
    ) -> impl Future<Output = Result<(), AppError>> + Send;
    fn find_by_username(
        &self,
        username: &str,
    ) -> impl Future<Output = Result<Option<StoredUser>, AppError>> + Send;
    fn find_by_id(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Option<StoredUser>, AppError>> + Send;
    fn update_profile(
        &self,
        user_id: &str,
        display_name: &str,
        bank_bin: Option<&str>,
        bank_account_number: Option<&str>,
    ) -> impl Future<Output = Result<User, AppError>> + Send;
    fn update_password_hash(
        &self,
        user_id: &str,
        password_hash: &str,
        keep_session_id: &str,
    ) -> impl Future<Output = Result<(), AppError>> + Send;
    fn create_session(
        &self,
        session_id: &str,
        user: &User,
        ttl_hours: i64,
    ) -> impl Future<Output = Result<UserSession, AppError>> + Send;
    fn get_session(
        &self,
        session_id: &str,
    ) -> impl Future<Output = Result<Option<UserSession>, AppError>> + Send;
    fn delete_session(&self, session_id: &str) -> impl Future<Output = Result<(), AppError>> + Send;
}

#[derive(Clone)]
pub struct SqliteAuthRepository {
    pool: SqlitePool,
}

impl SqliteAuthRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

impl AuthRepository for SqliteAuthRepository {
    async fn create_user(&self, user: &User, password_hash: &str) -> Result<(), AppError> {
        let now = now_sec();
        let res = sqlx::query(
            r#"
            INSERT INTO users (id, username, display_name, password_hash, avatar, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&user.id)
        .bind(&user.username)
        .bind(&user.display_name)
        .bind(password_hash)
        .bind(&user.avatar)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await;

        match res {
            Ok(_) => Ok(()),
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                Err(AppError::Conflict("Username is already taken".to_string()))
            }
            Err(e) => Err(AppError::Database(e)),
        }
    }

    async fn find_by_username(&self, username: &str) -> Result<Option<StoredUser>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT id, username, display_name, password_hash, avatar, bank_bin, bank_account_number
            FROM users
            WHERE username = ?
            LIMIT 1
            "#,
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| StoredUser {
            user: User {
                id: r.get("id"),
                username: r.get("username"),
                display_name: r.get("display_name"),
                avatar: r.get("avatar"),
                bank_bin: r.get("bank_bin"),
                bank_account_number: r.get("bank_account_number"),
            },
            password_hash: r.get("password_hash"),
        }))
    }

    async fn create_session(
        &self,
        session_id: &str,
        user: &User,
        ttl_hours: i64,
    ) -> Result<UserSession, AppError> {
        let now = now_sec();
        let expires_at = if ttl_hours <= 0 {
            0.0
        } else {
            now + (ttl_hours as f64) * 3600.0
        };
        let user_json =
            serde_json::to_string(user).map_err(|e| AppError::Internal(e.to_string()))?;

        sqlx::query(
            r#"
            INSERT INTO sessions (session_id, user_id, user_json, created_at, expires_at, last_active)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(session_id)
        .bind(&user.id)
        .bind(&user_json)
        .bind(now)
        .bind(expires_at)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(UserSession {
            session_id: session_id.to_string(),
            user: user.clone(),
            created_at: now,
            expires_at,
        })
    }

    async fn get_session(&self, session_id: &str) -> Result<Option<UserSession>, AppError> {
        let row = sqlx::query(
            "SELECT session_id, user_json, created_at, expires_at, last_active FROM sessions WHERE session_id = ?",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let expires_at: f64 = row.get("expires_at");
        let last_active: f64 = row.get("last_active");
        let now = now_sec();
        if expires_at > 0.0 && now > expires_at {
            let _ = self.delete_session(session_id).await;
            return Ok(None);
        }

        let user_json: String = row.get("user_json");
        let user: User =
            serde_json::from_str(&user_json).map_err(|e| AppError::Internal(e.to_string()))?;

        // Throttle last_active writes to once every 5 minutes so authenticated reads stay lock-free.
        if now - last_active >= 300.0 {
            let _ = sqlx::query("UPDATE sessions SET last_active = ? WHERE session_id = ?")
                .bind(now)
                .bind(session_id)
                .execute(&self.pool)
                .await;
        }

        Ok(Some(UserSession {
            session_id: row.get("session_id"),
            user,
            created_at: row.get("created_at"),
            expires_at,
        }))
    }

    async fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM sessions WHERE session_id = ?")
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn find_by_id(&self, user_id: &str) -> Result<Option<StoredUser>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT id, username, display_name, password_hash, avatar, bank_bin, bank_account_number
            FROM users
            WHERE id = ?
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| StoredUser {
            user: User {
                id: r.get("id"),
                username: r.get("username"),
                display_name: r.get("display_name"),
                avatar: r.get("avatar"),
                bank_bin: r.get("bank_bin"),
                bank_account_number: r.get("bank_account_number"),
            },
            password_hash: r.get("password_hash"),
        }))
    }

    async fn update_profile(
        &self,
        user_id: &str,
        display_name: &str,
        bank_bin: Option<&str>,
        bank_account_number: Option<&str>,
    ) -> Result<User, AppError> {
        let now = now_sec();
        sqlx::query(
            "UPDATE users SET display_name = ?, bank_bin = ?, bank_account_number = ?, updated_at = ? WHERE id = ?",
        )
        .bind(display_name)
        .bind(bank_bin)
        .bind(bank_account_number)
        .bind(now)
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        let stored = self
            .find_by_id(user_id)
            .await?
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

        let user_json =
            serde_json::to_string(&stored.user).map_err(|e| AppError::Internal(e.to_string()))?;
        sqlx::query("UPDATE sessions SET user_json = ? WHERE user_id = ?")
            .bind(&user_json)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        Ok(stored.user)
    }

    async fn update_password_hash(
        &self,
        user_id: &str,
        password_hash: &str,
        keep_session_id: &str,
    ) -> Result<(), AppError> {
        let now = now_sec();
        sqlx::query("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
            .bind(password_hash)
            .bind(now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM sessions WHERE user_id = ? AND session_id != ?")
            .bind(user_id)
            .bind(keep_session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
