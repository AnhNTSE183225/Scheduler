#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod config;
mod error;
mod models;
mod repositories;
mod routes;
mod services;
mod state;

use crate::config::AppConfig;
use crate::models::state::EntityStatus;
use crate::repositories::auth_repo::SqliteAuthRepository;
use crate::repositories::calendar_repo::SqliteCalendarRepository;
use crate::repositories::event_repo::SqliteEventRepository;
use crate::repositories::init_pool;
use crate::repositories::push_repo::SqlitePushRepository;
use crate::services::auth_service::AuthService;
use crate::services::fsm::FsmState;
use crate::services::push_service::PushService;
use crate::services::reminder_scheduler::ReminderScheduler;
use crate::services::sse_service::SseService;
use crate::state::AppState;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "DEV".to_string());
    let log_format = std::env::var("LOG_FORMAT").unwrap_or_default();

    if profile.eq_ignore_ascii_case("PROD") || log_format.eq_ignore_ascii_case("json") {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .json()
            .with_current_span(false)
            .with_span_list(false)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    std::panic::set_hook(Box::new(|info| {
        let bt = std::backtrace::Backtrace::force_capture();
        error!(panic = %info, backtrace = %bt, "Unhandled backend panic");
    }));

    let mut app_fsm = FsmState::new("scheduler-backend", EntityStatus::Loading);
    app_fsm.transition_to(EntityStatus::Loading, "Loading cascading YAML config & SQLite pool");

    let cfg = AppConfig::load()?;
    let pool = init_pool(&cfg.database.url).await?;

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    let auth_repo = SqliteAuthRepository::new(pool.clone());
    let cal_repo = SqliteCalendarRepository::new(pool.clone());
    let event_repo = SqliteEventRepository::new(pool.clone());
    let push_repo = SqlitePushRepository::new(pool.clone());

    let auth_svc = AuthService::new(auth_repo.clone(), cal_repo.clone(), http.clone(), cfg.clone());
    let push_svc = PushService::initialize(push_repo.clone(), http, &cfg).await?;
    let sse_svc = SseService::new();
    let reminder_svc = Arc::new(ReminderScheduler::new(
        event_repo.clone(),
        cal_repo.clone(),
        push_repo.clone(),
        push_svc.clone(),
        sse_svc.clone(),
        cfg.server.frontend_url.clone(),
    ));
    reminder_svc.clone().start_background_loop();

    let state = AppState {
        config: cfg.clone(),
        cal_repo,
        event_repo,
        push_repo,
        auth_svc,
        push_svc,
        sse_svc,
        reminder_svc,
        oauth_states: Arc::new(RwLock::new(HashMap::new())),
    };

    let cors = if cfg.server.cors_origins.is_empty() {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let origins: Vec<axum::http::HeaderValue> = cfg
            .server
            .cors_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(Any)
            .allow_headers(Any)
    };

    let app = routes::build_router(state)
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(20),
        ))
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    let addr: SocketAddr = format!("{}:{}", cfg.server.host, cfg.server.port).parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    app_fsm.transition_to(EntityStatus::Active, &format!("Listening on http://{}", addr));
    info!(address = %addr, "PulsePlan Scheduler backend ready");

    axum::serve(listener, app).await?;
    Ok(())
}
