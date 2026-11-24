use serde::{Deserialize, Serialize};
use std::fmt;

/// Singular deterministic FSM status contract enforced across Backend and Frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityStatus {
    Disconnected,
    Idle,
    Loading,
    Active,
    Paused,
    Error,
    Terminated,
}

impl fmt::Display for EntityStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Self::Disconnected => "disconnected",
            Self::Idle => "idle",
            Self::Loading => "loading",
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Error => "error",
            Self::Terminated => "terminated",
        };
        f.write_str(s)
    }
}

/// Standardized DTO envelope carrying a deterministic `status` discriminant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateMachineDTO<T> {
    pub status: EntityStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub data: T,
}

impl<T> StateMachineDTO<T> {
    pub fn active(data: T) -> Self {
        Self {
            status: EntityStatus::Active,
            reason: None,
            data,
        }
    }

    pub fn idle(data: T, reason: Option<String>) -> Self {
        Self {
            status: EntityStatus::Idle,
            reason,
            data,
        }
    }
}
