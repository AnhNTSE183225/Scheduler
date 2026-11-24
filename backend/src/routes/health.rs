use crate::models::state::{EntityStatus, StateMachineDTO};
use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthInfo {
    pub service: &'static str,
    pub version: &'static str,
}

pub async fn health_check() -> Json<StateMachineDTO<HealthInfo>> {
    Json(StateMachineDTO {
        status: EntityStatus::Active,
        reason: None,
        data: HealthInfo {
            service: "scheduler-backend",
            version: env!("CARGO_PKG_VERSION"),
        },
    })
}
