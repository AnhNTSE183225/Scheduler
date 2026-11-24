use crate::models::state::EntityStatus;
use tracing::info;

/// Deterministic FSM state container with structured transition logging.
#[derive(Debug, Clone)]
pub struct FsmState {
    entity_id: String,
    status: EntityStatus,
}

impl FsmState {
    pub fn new(entity_id: impl Into<String>, initial: EntityStatus) -> Self {
        Self {
            entity_id: entity_id.into(),
            status: initial,
        }
    }

    #[allow(dead_code)]
    pub fn status(&self) -> EntityStatus {
        self.status
    }

    pub fn transition_to(&mut self, next: EntityStatus, reason: &str) {
        if self.status == next {
            return;
        }
        let prev = self.status;
        self.status = next;
        info!(
            entity_id = %self.entity_id,
            old = %prev,
            new = %next,
            reason = %reason,
            "[FSM] Entity {}: {} -> {} (Reason: {})",
            self.entity_id,
            prev,
            next,
            reason
        );
    }
}
