use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use thiserror::Error;
use tracing::error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Unauthorized: {0}")]
    Unauthorized(String),
    #[error("Forbidden: {0}")]
    Forbidden(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("External service error: {0}")]
    External(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "unauthorized", msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "forbidden", msg.clone()),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.clone()),
            AppError::Database(e) => {
                error!(error = %e, "Database failure");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "database_error",
                    "Internal database error".to_string(),
                )
            }
            AppError::External(msg) => {
                error!(error = %msg, "External dependency failure");
                (StatusCode::BAD_GATEWAY, "external_error", msg.clone())
            }
            AppError::Internal(msg) => {
                error!(error = %msg, "Internal application failure");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    msg.clone(),
                )
            }
        };

        (status, Json(json!({ "detail": message, "code": code }))).into_response()
    }
}
