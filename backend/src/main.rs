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
use crate::repositories::bill_repo::SqliteBillRepository;
use crate::repositories::calendar_repo::SqliteCalendarRepository;
use crate::repositories::event_repo::SqliteEventRepository;
use crate::repositories::init_pool;
use crate::repositories::push_repo::SqlitePushRepository;
use crate::services::auth_service::AuthService;
use crate::services::fsm::FsmState;
use crate::services::push_service::PushService;
use crate::services::rate_limiter::RateLimiter;
use crate::services::reminder_scheduler::ReminderScheduler;
use crate::services::sse_service::SseService;
use crate::state::AppState;
use axum::http::{HeaderValue, Method, Request, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

async fn add_security_headers(req: Request<axum::body::Body>, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        header::HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    res
}

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
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()?;

    let auth_repo = SqliteAuthRepository::new(pool.clone());
    let cal_repo = SqliteCalendarRepository::new(pool.clone());
    let event_repo = SqliteEventRepository::new(pool.clone());
    let push_repo = SqlitePushRepository::new(pool.clone());
    let bill_repo = SqliteBillRepository::new(pool.clone());

    let auth_svc = AuthService::new(auth_repo, cal_repo.clone(), cfg.clone());
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
        bill_repo,
        auth_svc,
        push_svc,
        sse_svc,
        reminder_svc,
        auth_limiter: RateLimiter::new(15, 60),
        public_limiter: RateLimiter::new(30, 60),
        sse_tickets: Arc::new(RwLock::new(HashMap::new())),
    };

    let mut origins: Vec<HeaderValue> = cfg
        .server
        .cors_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    if let Ok(frontend_origin) = cfg.server.frontend_url.trim_end_matches('/').parse::<HeaderValue>() {
        if !origins.contains(&frontend_origin) {
            origins.push(frontend_origin);
        }
    }
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    let trace_layer = TraceLayer::new_for_http().make_span_with(|req: &Request<_>| {
        tracing::info_span!(
            "http_request",
            method = %req.method(),
            path = %req.uri().path(),
        )
    });

    let app = routes::build_router(state)
        .layer(middleware::from_fn(add_security_headers))
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(20),
        ))
        .layer(trace_layer)
        .layer(cors);

    let addr: SocketAddr = format!("{}:{}", cfg.server.host, cfg.server.port).parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    app_fsm.transition_to(EntityStatus::Active, &format!("Listening on http://{}", addr));
    info!(address = %addr, "PulsePlan Scheduler backend ready");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
