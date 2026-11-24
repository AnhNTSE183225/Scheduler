use crate::error::AppError;
use crate::models::event::ScheduleEvent;
use crate::repositories::now_sec;
use sqlx::{Row, SqlitePool};
use std::future::Future;

pub trait EventRepository: Send + Sync {
    fn list_calendar_events(&self, calendar_id: &str) -> impl Future<Output = Result<Vec<ScheduleEvent>, AppError>> + Send;
    fn list_all_active_events(&self) -> impl Future<Output = Result<Vec<ScheduleEvent>, AppError>> + Send;
    fn get_event(&self, event_id: &str) -> impl Future<Output = Result<Option<ScheduleEvent>, AppError>> + Send;
    fn get_event_by_share_token(&self, share_token: &str) -> impl Future<Output = Result<Option<ScheduleEvent>, AppError>> + Send;
    fn create_event(
        &self,
        calendar_id: &str,
        payload: &serde_json::Value,
        organizer_id: &str,
        organizer_name: &str,
        organizer_avatar: Option<&str>,
    ) -> impl Future<Output = Result<ScheduleEvent, AppError>> + Send;
    fn update_event(
        &self,
        event_id: &str,
        payload: &serde_json::Value,
        user_id: &str,
        is_admin: bool,
    ) -> impl Future<Output = Result<Option<ScheduleEvent>, AppError>> + Send;
    fn delete_event(
        &self,
        event_id: &str,
        user_id: &str,
        is_admin: bool,
        occurrence: Option<&str>,
    ) -> impl Future<Output = Result<bool, AppError>> + Send;
    fn respond_event(
        &self,
        event_id: &str,
        responder_id: &str,
        guest_name: Option<&str>,
        key: &str,
        status: &str,
        scope: &str,
    ) -> impl Future<Output = Result<Option<ScheduleEvent>, AppError>> + Send;
}

#[derive(Clone)]
pub struct SqliteEventRepository {
    pool: SqlitePool,
}

impl SqliteEventRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    fn parse_row(r: &sqlx::sqlite::SqliteRow) -> Option<ScheduleEvent> {
        let recurrence_str: Option<String> = r.get("recurrence_json");
        let recurrence = recurrence_str.and_then(|s| serde_json::from_str(&s).ok());

        let location_str: Option<String> = r.get("location_json");
        let location = location_str.and_then(|s| serde_json::from_str(&s).ok());

        let links_str: String = r.get("links_json");
        let links = serde_json::from_str(&links_str).unwrap_or_default();

        let invitee_ids_str: String = r.get("invitee_ids_json");
        let invitee_ids = serde_json::from_str(&invitee_ids_str).unwrap_or_default();

        let series_str: String = r.get("series_responses_json");
        let series_responses =
            serde_json::from_str(&series_str).unwrap_or_else(|_| serde_json::json!({}));

        let occ_str: String = r.get("occurrence_responses_json");
        let occurrence_responses =
            serde_json::from_str(&occ_str).unwrap_or_else(|_| serde_json::json!({}));

        let guest_names_str: String = r.get("guest_names_json");
        let guest_names =
            serde_json::from_str(&guest_names_str).unwrap_or_else(|_| serde_json::json!({}));

        let canc_str: String = r.get("cancelled_occurrences_json");
        let cancelled_occurrences = serde_json::from_str(&canc_str).unwrap_or_default();

        let invite_everyone_int: i64 = r.get("invite_everyone");

        Some(ScheduleEvent {
            id: r.get("id"),
            calendar_id: r.get("calendar_id"),
            share_token: r.get("share_token"),
            title: r.get("title"),
            description: r.get("description"),
            category: r.get("category"),
            start: r.get("start"),
            duration_minutes: r.get("duration_minutes"),
            recurrence,
            location,
            image_url: r.get("image_url"),
            links,
            organizer_id: r.get("organizer_id"),
            organizer_name: r.get("organizer_name"),
            organizer_avatar: r.get("organizer_avatar"),
            invite_everyone: invite_everyone_int == 1,
            invitee_ids,
            series_responses,
            occurrence_responses,
            guest_names,
            cancelled_occurrences,
            created_at: r.get("created_at"),
            updated_at: r.get("updated_at"),
        })
    }
}

const SELECT_EVENT_COLS: &str = r#"
    id, calendar_id, share_token, title, description, category, start, duration_minutes,
    recurrence_json, location_json, image_url, links_json, organizer_id, organizer_name,
    organizer_avatar, invite_everyone, invitee_ids_json, series_responses_json,
    occurrence_responses_json, guest_names_json, cancelled_occurrences_json, created_at, updated_at
"#;

impl EventRepository for SqliteEventRepository {
    async fn list_calendar_events(&self, calendar_id: &str) -> Result<Vec<ScheduleEvent>, AppError> {
        let query = format!(
            "SELECT {} FROM schedule_events WHERE calendar_id = ? ORDER BY start ASC",
            SELECT_EVENT_COLS
        );
        let rows = sqlx::query(&query)
            .bind(calendar_id)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows.iter().filter_map(Self::parse_row).collect())
    }

    async fn list_all_active_events(&self) -> Result<Vec<ScheduleEvent>, AppError> {
        let query = format!("SELECT {} FROM schedule_events ORDER BY start ASC", SELECT_EVENT_COLS);
        let rows = sqlx::query(&query).fetch_all(&self.pool).await?;
        Ok(rows.iter().filter_map(Self::parse_row).collect())
    }

    async fn get_event(&self, event_id: &str) -> Result<Option<ScheduleEvent>, AppError> {
        let query = format!("SELECT {} FROM schedule_events WHERE id = ?", SELECT_EVENT_COLS);
        let row = sqlx::query(&query)
            .bind(event_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().and_then(Self::parse_row))
    }

    async fn get_event_by_share_token(
        &self,
        share_token: &str,
    ) -> Result<Option<ScheduleEvent>, AppError> {
        let query = format!(
            "SELECT {} FROM schedule_events WHERE share_token = ?",
            SELECT_EVENT_COLS
        );
        let row = sqlx::query(&query)
            .bind(share_token)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().and_then(Self::parse_row))
    }

    async fn create_event(
        &self,
        calendar_id: &str,
        payload: &serde_json::Value,
        organizer_id: &str,
        organizer_name: &str,
        organizer_avatar: Option<&str>,
    ) -> Result<ScheduleEvent, AppError> {
        let now = now_sec();
        let event_id = format!("ev-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let share_token = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();

        let title = payload
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if title.is_empty() {
            return Err(AppError::BadRequest("Event title is required".to_string()));
        }

        let description = payload
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let category = payload
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("other")
            .trim()
            .to_string();
        let start = payload
            .get("start")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let duration_minutes = payload
            .get("durationMinutes")
            .and_then(|v| v.as_i64())
            .unwrap_or(60)
            .clamp(15, 1440) as i32;
        let rec_json = payload
            .get("recurrence")
            .filter(|v| !v.is_null())
            .map(|r| serde_json::to_string(r).unwrap_or_default());
        let loc_json = payload
            .get("location")
            .filter(|v| !v.is_null())
            .map(|l| serde_json::to_string(l).unwrap_or_default());
        let image_url = payload
            .get("imageUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let links_json = payload
            .get("links")
            .filter(|v| !v.is_null())
            .map(|l| serde_json::to_string(l).unwrap_or_default())
            .unwrap_or_else(|| "[]".to_string());
        let invite_everyone = if payload
            .get("inviteEveryone")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
        {
            1
        } else {
            0
        };
        let invitees_json = payload
            .get("inviteeIds")
            .filter(|v| !v.is_null())
            .map(|i| serde_json::to_string(i).unwrap_or_default())
            .unwrap_or_else(|| "[]".to_string());

        let series_responses = serde_json::json!({ organizer_id: "accepted" });
        let series_json = serde_json::to_string(&series_responses).unwrap_or_default();

        sqlx::query(
            r#"
            INSERT INTO schedule_events (
                id, calendar_id, share_token, title, description, category, start, duration_minutes,
                recurrence_json, location_json, image_url, links_json, organizer_id, organizer_name,
                organizer_avatar, invite_everyone, invitee_ids_json, series_responses_json,
                occurrence_responses_json, guest_names_json, cancelled_occurrences_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', '[]', ?, ?)
            "#,
        )
        .bind(&event_id)
        .bind(calendar_id)
        .bind(&share_token)
        .bind(&title)
        .bind(&description)
        .bind(&category)
        .bind(&start)
        .bind(duration_minutes)
        .bind(rec_json)
        .bind(loc_json)
        .bind(&image_url)
        .bind(links_json)
        .bind(organizer_id)
        .bind(organizer_name)
        .bind(organizer_avatar)
        .bind(invite_everyone)
        .bind(invitees_json)
        .bind(series_json)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        self.get_event(&event_id)
            .await?
            .ok_or_else(|| AppError::Internal("Created event disappeared".to_string()))
    }

    async fn update_event(
        &self,
        event_id: &str,
        payload: &serde_json::Value,
        user_id: &str,
        is_admin: bool,
    ) -> Result<Option<ScheduleEvent>, AppError> {
        let Some(existing) = self.get_event(event_id).await? else {
            return Ok(None);
        };

        if existing.organizer_id != user_id && !is_admin {
            return Err(AppError::Forbidden(
                "Only the event organizer or admin can edit this event".to_string(),
            ));
        }

        let now = now_sec();
        let title = payload
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(&existing.title);
        let description = payload
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or(&existing.description);
        let category = payload
            .get("category")
            .and_then(|v| v.as_str())
            .or(existing.category.as_deref());
        let start = payload
            .get("start")
            .and_then(|v| v.as_str())
            .unwrap_or(&existing.start);
        let duration_minutes = payload
            .get("durationMinutes")
            .and_then(|v| v.as_i64())
            .map(|n| n.clamp(15, 1440) as i32)
            .unwrap_or(existing.duration_minutes);

        let recurrence_json = match payload.get("recurrence") {
            Some(v) if v.is_null() => None,
            Some(v) => Some(serde_json::to_string(v).unwrap_or_default()),
            None => existing
                .recurrence
                .as_ref()
                .map(|r| serde_json::to_string(r).unwrap_or_default()),
        };

        let location_json = match payload.get("location") {
            Some(v) if v.is_null() => None,
            Some(v) => Some(serde_json::to_string(v).unwrap_or_default()),
            None => existing
                .location
                .as_ref()
                .map(|l| serde_json::to_string(l).unwrap_or_default()),
        };

        let image_url = match payload.get("imageUrl") {
            Some(v) if v.is_null() => None,
            Some(v) => v.as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            None => existing.image_url,
        };

        let links_json = match payload.get("links") {
            Some(v) => serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()),
            None => serde_json::to_string(&existing.links).unwrap_or_else(|_| "[]".to_string()),
        };

        let invite_everyone = match payload.get("inviteEveryone").and_then(|v| v.as_bool()) {
            Some(b) => if b { 1 } else { 0 },
            None => if existing.invite_everyone { 1 } else { 0 },
        };

        let invitees_json = match payload.get("inviteeIds") {
            Some(v) => serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()),
            None => serde_json::to_string(&existing.invitee_ids).unwrap_or_else(|_| "[]".to_string()),
        };

        sqlx::query(
            r#"
            UPDATE schedule_events SET
                title = ?, description = ?, category = ?, start = ?, duration_minutes = ?,
                recurrence_json = ?, location_json = ?, image_url = ?, links_json = ?,
                invite_everyone = ?, invitee_ids_json = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(title)
        .bind(description)
        .bind(category)
        .bind(start)
        .bind(duration_minutes)
        .bind(recurrence_json)
        .bind(location_json)
        .bind(image_url)
        .bind(links_json)
        .bind(invite_everyone)
        .bind(invitees_json)
        .bind(now)
        .bind(event_id)
        .execute(&self.pool)
        .await?;

        self.get_event(event_id).await
    }

    async fn delete_event(
        &self,
        event_id: &str,
        user_id: &str,
        is_admin: bool,
        occurrence: Option<&str>,
    ) -> Result<bool, AppError> {
        let Some(existing) = self.get_event(event_id).await? else {
            return Ok(false);
        };

        if existing.organizer_id != user_id && !is_admin {
            return Err(AppError::Forbidden(
                "Only the event organizer or admin can delete this event".to_string(),
            ));
        }

        if let Some(occ) = occurrence {
            let mut canc = existing.cancelled_occurrences;
            if !canc.iter().any(|c| c == occ) {
                canc.push(occ.to_string());
            }
            let canc_json = serde_json::to_string(&canc).unwrap_or_else(|_| "[]".to_string());
            sqlx::query("UPDATE schedule_events SET cancelled_occurrences_json = ? WHERE id = ?")
                .bind(canc_json)
                .bind(event_id)
                .execute(&self.pool)
                .await?;
            return Ok(true);
        }

        let res = sqlx::query("DELETE FROM schedule_events WHERE id = ?")
            .bind(event_id)
            .execute(&self.pool)
            .await?;

        let _ = sqlx::query("DELETE FROM schedule_reminders WHERE event_id = ?")
            .bind(event_id)
            .execute(&self.pool)
            .await;

        Ok(res.rows_affected() > 0)
    }

    async fn respond_event(
        &self,
        event_id: &str,
        responder_id: &str,
        guest_name: Option<&str>,
        key: &str,
        status: &str,
        scope: &str,
    ) -> Result<Option<ScheduleEvent>, AppError> {
        let Some(existing) = self.get_event(event_id).await? else {
            return Ok(None);
        };

        if let Some(name) = guest_name {
            let mut guests = existing.guest_names;
            if let Some(obj) = guests.as_object_mut() {
                obj.insert(
                    responder_id.to_string(),
                    serde_json::Value::String(name.trim().to_string()),
                );
            }
            let guest_json = serde_json::to_string(&guests).unwrap_or_else(|_| "{}".to_string());
            sqlx::query("UPDATE schedule_events SET guest_names_json = ? WHERE id = ?")
                .bind(guest_json)
                .bind(event_id)
                .execute(&self.pool)
                .await?;
        }

        if scope == "series" {
            let mut series = existing.series_responses;
            if let Some(obj) = series.as_object_mut() {
                obj.insert(
                    responder_id.to_string(),
                    serde_json::Value::String(status.to_string()),
                );
            }
            let series_json = serde_json::to_string(&series).unwrap_or_else(|_| "{}".to_string());
            sqlx::query("UPDATE schedule_events SET series_responses_json = ? WHERE id = ?")
                .bind(series_json)
                .bind(event_id)
                .execute(&self.pool)
                .await?;
        } else {
            let mut occ = existing.occurrence_responses;
            if let Some(obj) = occ.as_object_mut() {
                let occ_map = obj
                    .entry(key.to_string())
                    .or_insert_with(|| serde_json::json!({}));
                if let Some(map) = occ_map.as_object_mut() {
                    map.insert(
                        responder_id.to_string(),
                        serde_json::Value::String(status.to_string()),
                    );
                }
            }
            let occ_json = serde_json::to_string(&occ).unwrap_or_else(|_| "{}".to_string());
            sqlx::query("UPDATE schedule_events SET occurrence_responses_json = ? WHERE id = ?")
                .bind(occ_json)
                .bind(event_id)
                .execute(&self.pool)
                .await?;
        }

        self.get_event(event_id).await
    }
}
