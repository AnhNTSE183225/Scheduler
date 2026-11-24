pub mod auth_repo;
pub mod calendar_repo;
pub mod event_repo;
pub mod push_repo;

use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use std::fs;
use std::path::Path;
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn now_sec() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Initializes SQLite connection pool in WAL mode and ensures all tables exist.
pub async fn init_pool(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let _ = fs::create_dir_all(Path::new("data"));

    let connect_opts = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(10));

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect_with(connect_opts)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            avatar TEXT,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            user_json TEXT NOT NULL,
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL,
            last_active REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

        CREATE TABLE IF NOT EXISTS calendars (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            invite_code TEXT UNIQUE NOT NULL,
            owner_id TEXT NOT NULL,
            is_personal INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS calendar_members (
            calendar_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at REAL NOT NULL,
            PRIMARY KEY (calendar_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_members_user ON calendar_members(user_id);

        CREATE TABLE IF NOT EXISTS schedule_events (
            id TEXT PRIMARY KEY,
            calendar_id TEXT NOT NULL,
            share_token TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'other',
            start TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL DEFAULT 60,
            recurrence_json TEXT,
            location_json TEXT,
            image_url TEXT,
            links_json TEXT NOT NULL DEFAULT '[]',
            organizer_id TEXT NOT NULL,
            organizer_name TEXT NOT NULL DEFAULT '',
            organizer_avatar TEXT,
            invite_everyone INTEGER NOT NULL DEFAULT 1,
            invitee_ids_json TEXT NOT NULL DEFAULT '[]',
            series_responses_json TEXT NOT NULL DEFAULT '{}',
            occurrence_responses_json TEXT NOT NULL DEFAULT '{}',
            guest_names_json TEXT NOT NULL DEFAULT '{}',
            cancelled_occurrences_json TEXT NOT NULL DEFAULT '[]',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_schedule_events_cal ON schedule_events(calendar_id);
        CREATE INDEX IF NOT EXISTS idx_schedule_events_share ON schedule_events(share_token);

        CREATE TABLE IF NOT EXISTS schedule_reminders (
            event_id TEXT NOT NULL,
            occurrence_key TEXT NOT NULL,
            reminder_type TEXT NOT NULL DEFAULT 'lead',
            reminded_at REAL NOT NULL,
            PRIMARY KEY (event_id, occurrence_key, reminder_type)
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            event_id TEXT,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            user_agent TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_push_subs_event ON push_subscriptions(event_id);

        CREATE TABLE IF NOT EXISTS app_secrets (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            created_at REAL NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}
