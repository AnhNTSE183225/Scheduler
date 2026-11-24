use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_BUCKETS: usize = 4096;

/// Bounded in-memory sliding-window rate limiter protecting auth and public endpoints.
#[derive(Clone)]
pub struct RateLimiter {
    buckets: Arc<Mutex<HashMap<String, VecDeque<Instant>>>>,
    window: Duration,
    max_requests: usize,
}

impl RateLimiter {
    pub fn new(max_requests: usize, window_secs: u64) -> Self {
        Self {
            buckets: Arc::new(Mutex::new(HashMap::new())),
            window: Duration::from_secs(window_secs),
            max_requests,
        }
    }

    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let Ok(mut map) = self.buckets.lock() else {
            return true;
        };

        if map.len() >= MAX_BUCKETS && !map.contains_key(key) {
            map.retain(|_, dq| {
                dq.back()
                    .map(|ts| now.duration_since(*ts) < self.window)
                    .unwrap_or(false)
            });
            // If still at hard cap under active attack, fail closed for brand-new keys
            if map.len() >= MAX_BUCKETS {
                return false;
            }
        }

        let dq = map.entry(key.to_string()).or_default();
        while let Some(&front) = dq.front() {
            if now.duration_since(front) >= self.window {
                dq.pop_front();
            } else {
                break;
            }
        }

        if dq.len() >= self.max_requests {
            return false;
        }

        dq.push_back(now);
        true
    }
}
