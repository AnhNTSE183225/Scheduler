use crate::error::AppError;
use crate::models::notification::PushSubscriptionRecord;
use crate::repositories::now_sec;
use sqlx::{Row, SqlitePool};
use std::future::Future;

const MAX_SUBS_PER_USER: i64 = 10;
const MAX_SUBS_PER_EVENT: i64 = 50;

pub trait PushRepository: Send + Sync {
    fn get_secret(&self, key: &str) -> impl Future<Output = Result<Option<String>, AppError>> + Send;
    fn set_secret(&self, key: &str, value: &str) -> impl Future<Output = Result<(), AppError>> + Send;
    fn upsert_subscription(
        &self,
        user_id: &str,
        event_id: Option<&str>,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
        user_agent: Option<&str>,
    ) -> impl Future<Output = Result<PushSubscriptionRecord, AppError>> + Send;
    fn delete_subscription_by_endpoint(&self, endpoint: &str) -> impl Future<Output = Result<(), AppError>> + Send;
    fn delete_subscription_for_user(
        &self,
        endpoint: &str,
        user_id: &str,
    ) -> impl Future<Output = Result<(), AppError>> + Send;
    fn list_subscriptions_for_users(&self, user_ids: &[String]) -> impl Future<Output = Result<Vec<PushSubscriptionRecord>, AppError>> + Send;
    fn list_subscriptions_for_event(&self, event_id: &str) -> impl Future<Output = Result<Vec<PushSubscriptionRecord>, AppError>> + Send;
    fn is_occurrence_reminded(
        &self,
        event_id: &str,
        occurrence_key: &str,
        reminder_type: &str,
    ) -> impl Future<Output = Result<bool, AppError>> + Send;
    fn mark_occurrence_reminded(
        &self,
        event_id: &str,
        occurrence_key: &str,
        reminder_type: &str,
    ) -> impl Future<Output = Result<(), AppError>> + Send;
    fn clear_event_reminders(&self, event_id: &str) -> impl Future<Output = Result<(), AppError>> + Send;
}

#[derive(Clone)]
pub struct SqlitePushRepository {
    pool: SqlitePool,
}

impl SqlitePushRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    fn map_sub(r: &sqlx::sqlite::SqliteRow) -> PushSubscriptionRecord {
        PushSubscriptionRecord {
            id: r.get("id"),
            user_id: r.get("user_id"),
            endpoint: r.get("endpoint"),
            p256dh: r.get("p256dh"),
            auth: r.get("auth"),
            user_agent: r.get("user_agent"),
            created_at: r.get("created_at"),
        }
    }
}

impl PushRepository for SqlitePushRepository {
    async fn get_secret(&self, key: &str) -> Result<Option<String>, AppError> {
        let row = sqlx::query("SELECT value FROM app_secrets WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.get("value")))
    }

    async fn set_secret(&self, key: &str, value: &str) -> Result<(), AppError> {
        let now = now_sec();
        sqlx::query(
            "INSERT OR REPLACE INTO app_secrets (key, value, created_at) VALUES (?, ?, ?)",
        )
        .bind(key)
        .bind(value)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn upsert_subscription(
        &self,
        user_id: &str,
        event_id: Option<&str>,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
        user_agent: Option<&str>,
    ) -> Result<PushSubscriptionRecord, AppError> {
        // Check existing owner to prevent unauthenticated guest takeover of an authenticated user's endpoint
        let existing_owner: Option<String> = sqlx::query("SELECT user_id FROM push_subscriptions WHERE endpoint = ?")
            .bind(endpoint)
            .fetch_optional(&self.pool)
            .await?
            .map(|r| r.get("user_id"));

        if let Some(ref owner) = existing_owner {
            if user_id.starts_with("guest-push:") && !owner.starts_with("guest-push:") {
                return Err(AppError::Forbidden(
                    "This device is already registered to a signed-in account".to_string(),
                ));
            }
        } else {
            // Enforce per-user and per-event subscription caps on new rows
            if !user_id.starts_with("guest-push:") {
                let count: i64 = sqlx::query("SELECT COUNT(*) as c FROM push_subscriptions WHERE user_id = ?")
                    .bind(user_id)
                    .fetch_one(&self.pool)
                    .await?
                    .get("c");
                if count >= MAX_SUBS_PER_USER {
                    return Err(AppError::TooManyRequests(
                        "Maximum push devices reached for this account".to_string(),
                    ));
                }
            }
            if let Some(eid) = event_id {
                let count: i64 = sqlx::query("SELECT COUNT(*) as c FROM push_subscriptions WHERE event_id = ?")
                    .bind(eid)
                    .fetch_one(&self.pool)
                    .await?
                    .get("c");
                if count >= MAX_SUBS_PER_EVENT {
                    return Err(AppError::TooManyRequests(
                        "Maximum guest push subscriptions reached for this event".to_string(),
                    ));
                }
            }
        }

        let now = now_sec();
        let id = format!("sub-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);

        sqlx::query(
            r#"
            INSERT INTO push_subscriptions (id, user_id, event_id, endpoint, p256dh, auth, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                user_id = excluded.user_id,
                event_id = excluded.event_id,
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                user_agent = excluded.user_agent
            "#,
        )
        .bind(&id)
        .bind(user_id)
        .bind(event_id)
        .bind(endpoint)
        .bind(p256dh)
        .bind(auth)
        .bind(user_agent)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(PushSubscriptionRecord {
            id,
            user_id: user_id.to_string(),
            endpoint: endpoint.to_string(),
            p256dh: p256dh.to_string(),
            auth: auth.to_string(),
            user_agent: user_agent.map(ToString::to_string),
            created_at: now,
        })
    }

    async fn delete_subscription_by_endpoint(&self, endpoint: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = ?")
            .bind(endpoint)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_subscription_for_user(
        &self,
        endpoint: &str,
        user_id: &str,
    ) -> Result<(), AppError> {
        sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
            .bind(endpoint)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_subscriptions_for_users(
        &self,
        user_ids: &[String],
    ) -> Result<Vec<PushSubscriptionRecord>, AppError> {
        if user_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = vec!["?"; user_ids.len()].join(",");
        let query = format!(
            "SELECT id, user_id, endpoint, p256dh, auth, user_agent, created_at FROM push_subscriptions WHERE user_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&query);
        for uid in user_ids {
            q = q.bind(uid);
        }
        let rows = q.fetch_all(&self.pool).await?;
        Ok(rows.iter().map(Self::map_sub).collect())
    }

    async fn list_subscriptions_for_event(
        &self,
        event_id: &str,
    ) -> Result<Vec<PushSubscriptionRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT id, user_id, endpoint, p256dh, auth, user_agent, created_at FROM push_subscriptions WHERE event_id = ?",
        )
        .bind(event_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(Self::map_sub).collect())
    }

    async fn is_occurrence_reminded(
        &self,
        event_id: &str,
        occurrence_key: &str,
        reminder_type: &str,
    ) -> Result<bool, AppError> {
        let row = sqlx::query(
            "SELECT 1 FROM schedule_reminders WHERE event_id = ? AND occurrence_key = ? AND reminder_type = ?",
        )
        .bind(event_id)
        .bind(occurrence_key)
        .bind(reminder_type)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some())
    }

    async fn mark_occurrence_reminded(
        &self,
        event_id: &str,
        occurrence_key: &str,
        reminder_type: &str,
    ) -> Result<(), AppError> {
        let now = now_sec();
        sqlx::query(
            "INSERT OR REPLACE INTO schedule_reminders (event_id, occurrence_key, reminder_type, reminded_at) VALUES (?, ?, ?, ?)",
        )
        .bind(event_id)
        .bind(occurrence_key)
        .bind(reminder_type)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn clear_event_reminders(&self, event_id: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM schedule_reminders WHERE event_id = ?")
            .bind(event_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
