use crate::config::AppConfig;
use crate::repositories::auth_repo::SqliteAuthRepository;
use crate::repositories::calendar_repo::SqliteCalendarRepository;
use crate::repositories::event_repo::SqliteEventRepository;
use crate::repositories::push_repo::SqlitePushRepository;
use crate::services::auth_service::AuthService;
use crate::services::push_service::PushService;
use crate::services::rate_limiter::RateLimiter;
use crate::services::reminder_scheduler::ReminderScheduler;
use crate::services::sse_service::SseService;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;

/// Single-use short-lived SSE ticket mapping: ticket -> (user_id, calendar_id, issued_at).
pub type SseTicketStore = Arc<RwLock<HashMap<String, (String, String, Instant)>>>;

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub cal_repo: SqliteCalendarRepository,
    pub event_repo: SqliteEventRepository,
    pub push_repo: SqlitePushRepository,
    pub auth_svc: AuthService<SqliteAuthRepository, SqliteCalendarRepository>,
    pub push_svc: PushService<SqlitePushRepository>,
    pub sse_svc: SseService,
    pub reminder_svc: Arc<ReminderScheduler<SqliteEventRepository, SqliteCalendarRepository, SqlitePushRepository>>,
    pub auth_limiter: RateLimiter,
    pub public_limiter: RateLimiter,
    pub sse_tickets: SseTicketStore,
}
