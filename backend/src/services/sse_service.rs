use crate::models::notification::SseNotificationEvent;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct SseService {
    tx: broadcast::Sender<SseNotificationEvent>,
}

impl SseService {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SseNotificationEvent> {
        self.tx.subscribe()
    }

    pub fn broadcast(&self, event: SseNotificationEvent) {
        let _ = self.tx.send(event);
    }
}
