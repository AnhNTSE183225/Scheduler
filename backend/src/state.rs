use crate::config::AppConfig;
use crate::repositories::auth_repo::SqliteAuthRepository;
use crate::repositories::calendar_repo::SqliteCalendarRepository;
use crate::repositories::event_repo::SqliteEventRepository;
use crate::repositories::push_repo::SqlitePushRepository;
use crate::services::auth_service::AuthService;
use crate::services::push_service::PushService;
use crate::services::reminder_scheduler::ReminderScheduler;
use crate::services::sse_service::SseService;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;

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
    pub oauth_states: Arc<RwLock<HashMap<String, Instant>>>,
}
