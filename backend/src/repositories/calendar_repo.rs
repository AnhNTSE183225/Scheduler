use crate::error::AppError;
use crate::models::auth::User;
use crate::models::calendar::{CalendarMember, CalendarSpace};
use crate::models::event::CalendarMemberInfo;
use crate::repositories::now_sec;
use sqlx::{Row, SqlitePool};
use std::future::Future;

pub trait CalendarRepository: Send + Sync {
    fn ensure_personal_calendar(&self, user: &User) -> impl Future<Output = Result<CalendarSpace, AppError>> + Send;
    fn list_user_calendars(&self, user_id: &str) -> impl Future<Output = Result<Vec<CalendarSpace>, AppError>> + Send;
    fn get_calendar(&self, calendar_id: &str) -> impl Future<Output = Result<Option<CalendarSpace>, AppError>> + Send;
    fn is_member(&self, calendar_id: &str, user_id: &str) -> impl Future<Output = Result<bool, AppError>> + Send;
    fn create_calendar(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
    ) -> impl Future<Output = Result<CalendarSpace, AppError>> + Send;
    fn join_by_invite_code(
        &self,
        user_id: &str,
        invite_code: &str,
    ) -> impl Future<Output = Result<Option<CalendarSpace>, AppError>> + Send;
    fn list_members(&self, calendar_id: &str) -> impl Future<Output = Result<Vec<CalendarMember>, AppError>> + Send;
    fn list_member_infos(&self, calendar_id: &str) -> impl Future<Output = Result<Vec<CalendarMemberInfo>, AppError>> + Send;
}

#[derive(Clone)]
pub struct SqliteCalendarRepository {
    pool: SqlitePool,
}

impl SqliteCalendarRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    fn map_calendar_row(row: &sqlx::sqlite::SqliteRow) -> CalendarSpace {
        let is_personal_int: i64 = row.get("is_personal");
        CalendarSpace {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            invite_code: row.get("invite_code"),
            owner_id: row.get("owner_id"),
            is_personal: is_personal_int == 1,
            created_at: row.get("created_at"),
        }
    }
}

impl CalendarRepository for SqliteCalendarRepository {
    async fn ensure_personal_calendar(&self, user: &User) -> Result<CalendarSpace, AppError> {
        let existing = sqlx::query(
            r#"
            SELECT c.id, c.name, c.description, c.invite_code, c.owner_id, c.is_personal, c.created_at
            FROM calendars c
            INNER JOIN calendar_members m ON m.calendar_id = c.id
            WHERE m.user_id = ? AND c.is_personal = 1
            LIMIT 1
            "#,
        )
        .bind(&user.id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = existing {
            return Ok(Self::map_calendar_row(&row));
        }

        let now = now_sec();
        let cal_id = format!("cal-{}", uuid::Uuid::new_v4().simple());
        let invite_code = format!("per-{}", uuid::Uuid::new_v4().simple());
        let name = format!("{}'s Schedule", user.display_name);

        sqlx::query(
            r#"
            INSERT INTO calendars (id, name, description, invite_code, owner_id, is_personal, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            "#,
        )
        .bind(&cal_id)
        .bind(&name)
        .bind("Personal & shared events")
        .bind(&invite_code)
        .bind(&user.id)
        .bind(now)
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "INSERT OR IGNORE INTO calendar_members (calendar_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
        )
        .bind(&cal_id)
        .bind(&user.id)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(CalendarSpace {
            id: cal_id,
            name,
            description: "Personal & shared events".to_string(),
            invite_code,
            owner_id: user.id.clone(),
            is_personal: true,
            created_at: now,
        })
    }

    async fn list_user_calendars(&self, user_id: &str) -> Result<Vec<CalendarSpace>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT c.id, c.name, c.description, c.invite_code, c.owner_id, c.is_personal, c.created_at
            FROM calendars c
            INNER JOIN calendar_members m ON m.calendar_id = c.id
            WHERE m.user_id = ?
            ORDER BY c.is_personal DESC, c.created_at ASC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.iter().map(Self::map_calendar_row).collect())
    }

    async fn get_calendar(&self, calendar_id: &str) -> Result<Option<CalendarSpace>, AppError> {
        let row = sqlx::query(
            "SELECT id, name, description, invite_code, owner_id, is_personal, created_at FROM calendars WHERE id = ?",
        )
        .bind(calendar_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.as_ref().map(Self::map_calendar_row))
    }

    async fn is_member(&self, calendar_id: &str, user_id: &str) -> Result<bool, AppError> {
        let row = sqlx::query(
            "SELECT 1 FROM calendar_members WHERE calendar_id = ? AND user_id = ? LIMIT 1",
        )
        .bind(calendar_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some())
    }

    async fn create_calendar(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
    ) -> Result<CalendarSpace, AppError> {
        let now = now_sec();
        let cal_id = format!("cal-{}", uuid::Uuid::new_v4().simple());
        let invite_code = format!("grp-{}", uuid::Uuid::new_v4().simple());

        sqlx::query(
            r#"
            INSERT INTO calendars (id, name, description, invite_code, owner_id, is_personal, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            "#,
        )
        .bind(&cal_id)
        .bind(name.trim())
        .bind(description.trim())
        .bind(&invite_code)
        .bind(user_id)
        .bind(now)
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "INSERT INTO calendar_members (calendar_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
        )
        .bind(&cal_id)
        .bind(user_id)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(CalendarSpace {
            id: cal_id,
            name: name.trim().to_string(),
            description: description.trim().to_string(),
            invite_code,
            owner_id: user_id.to_string(),
            is_personal: false,
            created_at: now,
        })
    }

    async fn join_by_invite_code(
        &self,
        user_id: &str,
        invite_code: &str,
    ) -> Result<Option<CalendarSpace>, AppError> {
        let row = sqlx::query(
            "SELECT id, name, description, invite_code, owner_id, is_personal, created_at FROM calendars WHERE invite_code = ? AND is_personal = 0",
        )
        .bind(invite_code.trim())
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let cal = Self::map_calendar_row(&row);
        let now = now_sec();
        sqlx::query(
            "INSERT OR IGNORE INTO calendar_members (calendar_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
        )
        .bind(&cal.id)
        .bind(user_id)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(Some(cal))
    }

    async fn list_members(&self, calendar_id: &str) -> Result<Vec<CalendarMember>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT u.id, u.display_name, u.username, u.avatar, m.role
            FROM calendar_members m
            INNER JOIN users u ON u.id = m.user_id
            WHERE m.calendar_id = ?
            ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, u.display_name ASC
            "#,
        )
        .bind(calendar_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| CalendarMember {
                id: r.get("id"),
                name: r.get("display_name"),
                username: r.get("username"),
                avatar: r.get("avatar"),
                role: r.get("role"),
            })
            .collect())
    }

    async fn list_member_infos(
        &self,
        calendar_id: &str,
    ) -> Result<Vec<CalendarMemberInfo>, AppError> {
        let members = self.list_members(calendar_id).await?;
        Ok(members
            .into_iter()
            .map(|m| CalendarMemberInfo {
                id: m.id,
                name: m.name,
                avatar: m.avatar,
            })
            .collect())
    }
}
