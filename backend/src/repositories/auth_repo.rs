use crate::error::AppError;
use crate::models::auth::{User, UserSession};
use crate::repositories::now_sec;
use sqlx::{Row, SqlitePool};
use std::future::Future;

pub trait AuthRepository: Send + Sync {
    fn upsert_user(&self, user: &User) -> impl Future<Output = Result<(), AppError>> + Send;
    fn create_session(
        &self,
        session_id: &str,
        user: &User,
        ttl_hours: i64,
    ) -> impl Future<Output = Result<UserSession, AppError>> + Send;
    fn get_session(&self, session_id: &str) -> impl Future<Output = Result<Option<UserSession>, AppError>> + Send;
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
    async fn upsert_user(&self, user: &User) -> Result<(), AppError> {
        let now = now_sec();
        sqlx::query(
            r#"
            INSERT INTO users (id, email, name, avatar, provider, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                email = COALESCE(excluded.email, users.email),
                name = excluded.name,
                avatar = COALESCE(excluded.avatar, users.avatar),
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&user.id)
        .bind(&user.email)
        .bind(&user.name)
        .bind(&user.avatar)
        .bind(&user.provider)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn create_session(
        &self,
        session_id: &str,
        user: &User,
        ttl_hours: i64,
    ) -> Result<UserSession, AppError> {
        let now = now_sec();
        let expires_at = now + (ttl_hours as f64) * 3600.0;
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
            "SELECT session_id, user_json, created_at, expires_at FROM sessions WHERE session_id = ?",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let expires_at: f64 = row.get("expires_at");
        let now = now_sec();
        if now > expires_at {
            let _ = self.delete_session(session_id).await;
            return Ok(None);
        }

        let user_json: String = row.get("user_json");
        let user: User =
            serde_json::from_str(&user_json).map_err(|e| AppError::Internal(e.to_string()))?;

        let _ = sqlx::query("UPDATE sessions SET last_active = ? WHERE session_id = ?")
            .bind(now)
            .bind(session_id)
            .execute(&self.pool)
            .await;

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
}
