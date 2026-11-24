use crate::error::AppError;
use crate::models::event::{
    ScheduleEvent, ScheduleEventLink, ScheduleEventLocation, ScheduleEventRecurrence,
};
use crate::repositories::now_sec;
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use std::future::Future;

const MAX_TITLE_LEN: usize = 160;
const MAX_DESC_LEN: usize = 4000;
const MAX_CATEGORY_LEN: usize = 40;
const MAX_URL_LEN: usize = 1024;
const MAX_ADDRESS_LEN: usize = 300;
const MAX_LINKS: usize = 15;
const MAX_LINK_LABEL_LEN: usize = 80;
const MAX_INVITEES: usize = 200;
const MAX_CANCELLED_OCCURRENCES: usize = 365;
const MAX_RESPONDERS: usize = 500;
const MAX_OCCURRENCE_KEYS: usize = 365;

pub fn validate_http_url(raw: &str, field: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_URL_LEN {
        return Err(AppError::BadRequest(format!(
            "{field} must be a valid HTTP(S) URL up to {MAX_URL_LEN} characters"
        )));
    }
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| AppError::BadRequest(format!("{field} must be a valid HTTP(S) URL")))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(AppError::BadRequest(format!(
            "{field} must use the http:// or https:// scheme"
        )));
    }
    Ok(trimmed.to_string())
}

fn validate_date_key(key: &str, field: &str) -> Result<(), AppError> {
    if key.len() != 10 || chrono::NaiveDate::parse_from_str(key, "%Y-%m-%d").is_err() {
        return Err(AppError::BadRequest(format!(
            "{field} must be a valid YYYY-MM-DD date"
        )));
    }
    Ok(())
}

fn sanitize_location(val: &serde_json::Value) -> Result<Option<String>, AppError> {
    if val.is_null() {
        return Ok(None);
    }
    let mut loc: ScheduleEventLocation = serde_json::from_value(val.clone())
        .map_err(|_| AppError::BadRequest("Invalid location payload".to_string()))?;
    if !matches!(loc.kind.as_str(), "address" | "link") {
        return Err(AppError::BadRequest(
            "Location kind must be 'address' or 'link'".to_string(),
        ));
    }
    loc.address = loc
        .address
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref addr) = loc.address {
        if addr.chars().count() > MAX_ADDRESS_LEN {
            return Err(AppError::BadRequest(format!(
                "Location address must be at most {MAX_ADDRESS_LEN} characters"
            )));
        }
    }
    loc.url = match loc.url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(u) => Some(validate_http_url(&u, "location.url")?),
        None => None,
    };
    serde_json::to_string(&loc)
        .map(Some)
        .map_err(|e| AppError::Internal(format!("Failed to serialize location: {e}")))
}

fn sanitize_links(val: &serde_json::Value) -> Result<String, AppError> {
    if val.is_null() {
        return Ok("[]".to_string());
    }
    let links: Vec<ScheduleEventLink> = serde_json::from_value(val.clone())
        .map_err(|_| AppError::BadRequest("Invalid links payload".to_string()))?;
    if links.len() > MAX_LINKS {
        return Err(AppError::BadRequest(format!(
            "At most {MAX_LINKS} links are allowed per event"
        )));
    }
    let mut cleaned = Vec::with_capacity(links.len());
    for link in links {
        let label = link.label.trim().to_string();
        if label.is_empty() || label.chars().count() > MAX_LINK_LABEL_LEN {
            return Err(AppError::BadRequest(format!(
                "Link label must be 1-{MAX_LINK_LABEL_LEN} characters"
            )));
        }
        let url = validate_http_url(&link.url, "links[].url")?;
        cleaned.push(ScheduleEventLink { label, url });
    }
    serde_json::to_string(&cleaned)
        .map_err(|e| AppError::Internal(format!("Failed to serialize links: {e}")))
}

fn sanitize_invitee_ids(val: &serde_json::Value) -> Result<String, AppError> {
    if val.is_null() {
        return Ok("[]".to_string());
    }
    let raw: Vec<String> = serde_json::from_value(val.clone())
        .map_err(|_| AppError::BadRequest("Invalid inviteeIds payload".to_string()))?;
    if raw.len() > MAX_INVITEES {
        return Err(AppError::BadRequest(format!(
            "At most {MAX_INVITEES} invitees are allowed per event"
        )));
    }
    let mut seen = HashSet::new();
    let mut cleaned = Vec::with_capacity(raw.len());
    for id in raw {
        let trimmed = id.trim().to_string();
        if !trimmed.is_empty() && trimmed.len() <= 128 && seen.insert(trimmed.clone()) {
            cleaned.push(trimmed);
        }
    }
    serde_json::to_string(&cleaned)
        .map_err(|e| AppError::Internal(format!("Failed to serialize inviteeIds: {e}")))
}

fn sanitize_recurrence(val: &serde_json::Value) -> Result<Option<String>, AppError> {
    if val.is_null() {
        return Ok(None);
    }
    let mut rec: ScheduleEventRecurrence = serde_json::from_value(val.clone())
        .map_err(|_| AppError::BadRequest("Invalid recurrence payload".to_string()))?;
    if !matches!(rec.freq.as_str(), "daily" | "weekly" | "monthly") {
        return Err(AppError::BadRequest(
            "Recurrence freq must be 'daily', 'weekly', or 'monthly'".to_string(),
        ));
    }
    rec.interval = rec.interval.clamp(1, 52);
    if let Some(ref until) = rec.until {
        let trimmed = until.trim();
        if !trimmed.is_empty()
            && chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").is_err()
            && chrono::DateTime::parse_from_rfc3339(trimmed).is_err()
        {
            return Err(AppError::BadRequest(
                "Invalid recurrence until date".to_string(),
            ));
        }
    }
    if let Some(c) = rec.count {
        rec.count = Some(c.clamp(1, 365));
    }
    serde_json::to_string(&rec)
        .map(Some)
        .map_err(|e| AppError::Internal(format!("Failed to serialize recurrence: {e}")))
}

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
        if title.is_empty() || title.chars().count() > MAX_TITLE_LEN {
            return Err(AppError::BadRequest(format!(
                "Event title must be 1-{MAX_TITLE_LEN} characters"
            )));
        }

        let description = payload
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if description.chars().count() > MAX_DESC_LEN {
            return Err(AppError::BadRequest(format!(
                "Description must be at most {MAX_DESC_LEN} characters"
            )));
        }

        let category = payload
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("other")
            .trim()
            .to_string();
        if category.chars().count() > MAX_CATEGORY_LEN {
            return Err(AppError::BadRequest(format!(
                "Category must be at most {MAX_CATEGORY_LEN} characters"
            )));
        }

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

        let rec_json = match payload.get("recurrence") {
            Some(v) => sanitize_recurrence(v)?,
            None => None,
        };
        let loc_json = match payload.get("location") {
            Some(v) => sanitize_location(v)?,
            None => None,
        };
        let image_url = match payload
            .get("imageUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            Some(u) => Some(validate_http_url(u, "imageUrl")?),
            None => None,
        };
        let links_json = match payload.get("links") {
            Some(v) => sanitize_links(v)?,
            None => "[]".to_string(),
        };
        let invite_everyone = if payload
            .get("inviteEveryone")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
        {
            1
        } else {
            0
        };
        let invitees_json = match payload.get("inviteeIds") {
            Some(v) => sanitize_invitee_ids(v)?,
            None => "[]".to_string(),
        };

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
        if title.chars().count() > MAX_TITLE_LEN {
            return Err(AppError::BadRequest(format!(
                "Event title must be at most {MAX_TITLE_LEN} characters"
            )));
        }
        let description = payload
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .unwrap_or(&existing.description);
        if description.chars().count() > MAX_DESC_LEN {
            return Err(AppError::BadRequest(format!(
                "Description must be at most {MAX_DESC_LEN} characters"
            )));
        }
        let category = payload
            .get("category")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .or(existing.category.as_deref());
        if let Some(cat) = category {
            if cat.chars().count() > MAX_CATEGORY_LEN {
                return Err(AppError::BadRequest(format!(
                    "Category must be at most {MAX_CATEGORY_LEN} characters"
                )));
            }
        }
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
            Some(v) => sanitize_recurrence(v)?,
            None => existing
                .recurrence
                .as_ref()
                .map(|r| serde_json::to_string(r).unwrap_or_default()),
        };

        let location_json = match payload.get("location") {
            Some(v) => sanitize_location(v)?,
            None => existing
                .location
                .as_ref()
                .map(|l| serde_json::to_string(l).unwrap_or_default()),
        };

        let image_url = match payload.get("imageUrl") {
            Some(v) if v.is_null() => None,
            Some(v) => match v.as_str().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                Some(u) => Some(validate_http_url(u, "imageUrl")?),
                None => None,
            },
            None => existing.image_url,
        };

        let links_json = match payload.get("links") {
            Some(v) => sanitize_links(v)?,
            None => serde_json::to_string(&existing.links).unwrap_or_else(|_| "[]".to_string()),
        };

        let invite_everyone = match payload.get("inviteEveryone").and_then(|v| v.as_bool()) {
            Some(b) => if b { 1 } else { 0 },
            None => if existing.invite_everyone { 1 } else { 0 },
        };

        let invitees_json = match payload.get("inviteeIds") {
            Some(v) => sanitize_invitee_ids(v)?,
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
            validate_date_key(occ, "occurrence")?;
            let mut canc = existing.cancelled_occurrences;
            if !canc.iter().any(|c| c == occ) {
                if canc.len() >= MAX_CANCELLED_OCCURRENCES {
                    return Err(AppError::BadRequest(
                        "Maximum cancelled occurrence limit reached for this series".to_string(),
                    ));
                }
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
        if !matches!(scope, "series" | "occurrence") {
            return Err(AppError::BadRequest(
                "RSVP scope must be 'series' or 'occurrence'".to_string(),
            ));
        }
        if scope == "occurrence" {
            validate_date_key(key, "key")?;
        }

        let Some(existing) = self.get_event(event_id).await? else {
            return Ok(None);
        };

        if let Some(name) = guest_name {
            let mut guests = existing.guest_names;
            if let Some(obj) = guests.as_object_mut() {
                if !obj.contains_key(responder_id) && obj.len() >= MAX_RESPONDERS {
                    return Err(AppError::BadRequest(
                        "Guest RSVP limit reached for this event".to_string(),
                    ));
                }
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
                if !obj.contains_key(responder_id) && obj.len() >= MAX_RESPONDERS {
                    return Err(AppError::BadRequest(
                        "Responder limit reached for this event".to_string(),
                    ));
                }
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
                if !obj.contains_key(key) && obj.len() >= MAX_OCCURRENCE_KEYS {
                    return Err(AppError::BadRequest(
                        "Occurrence RSVP limit reached for this event".to_string(),
                    ));
                }
                let occ_map = obj
                    .entry(key.to_string())
                    .or_insert_with(|| serde_json::json!({}));
                if let Some(map) = occ_map.as_object_mut() {
                    if !map.contains_key(responder_id) && map.len() >= MAX_RESPONDERS {
                        return Err(AppError::BadRequest(
                            "Responder limit reached for this occurrence".to_string(),
                        ));
                    }
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
