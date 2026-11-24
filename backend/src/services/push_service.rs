use crate::config::AppConfig;
use crate::error::AppError;
use crate::models::notification::PushSubscriptionRecord;
use crate::repositories::push_repo::PushRepository;
use base64ct::{Base64UrlUnpadded, Encoding as _};
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;
use tracing::{info, warn};
use web_push_native::{
    Auth, WebPushBuilder,
    jwt_simple::algorithms::{ECDSAP256PublicKeyLike, ES256KeyPair},
    p256::PublicKey,
};

const VAPID_SECRET_KEY: &str = "vapid_private_key";

#[derive(Debug, Clone, Serialize)]
pub struct PushPayload {
    pub title: String,
    pub body: String,
    pub url: String,
    pub tag: String,
}

#[derive(Clone)]
pub struct PushService<PR: PushRepository> {
    push_repo: PR,
    http: reqwest::Client,
    key_pair: Arc<ES256KeyPair>,
    public_key_b64: String,
    subject: String,
}

impl<PR: PushRepository> PushService<PR> {
    pub async fn initialize(
        push_repo: PR,
        http: reqwest::Client,
        config: &AppConfig,
    ) -> Result<Self, AppError> {
        let key_pair = Self::load_or_generate_keypair(&push_repo, &config.push.vapid_private_key).await?;
        let uncompressed_pub = key_pair.public_key().public_key().to_bytes_uncompressed();
        let public_key_b64 = Base64UrlUnpadded::encode_string(&uncompressed_pub);

        info!(
            public_key_len = public_key_b64.len(),
            "Web Push VAPID keypair initialized"
        );

        Ok(Self {
            push_repo,
            http,
            key_pair: Arc::new(key_pair),
            public_key_b64,
            subject: config.push.subject.clone(),
        })
    }

    async fn load_or_generate_keypair(
        push_repo: &PR,
        configured_key: &str,
    ) -> Result<ES256KeyPair, AppError> {
        let trimmed = configured_key.trim();
        if !trimmed.is_empty() {
            let bytes = Base64UrlUnpadded::decode_vec(trimmed)
                .map_err(|e| AppError::Internal(format!("Invalid configured VAPID private key: {e}")))?;
            return ES256KeyPair::from_bytes(&bytes)
                .map_err(|e| AppError::Internal(format!("Invalid ES256 VAPID key bytes: {e}")));
        }

        if let Some(stored) = push_repo.get_secret(VAPID_SECRET_KEY).await? {
            if let Ok(bytes) = Base64UrlUnpadded::decode_vec(stored.trim()) {
                if let Ok(kp) = ES256KeyPair::from_bytes(&bytes) {
                    return Ok(kp);
                }
            }
            warn!("Stored VAPID private key was invalid; regenerating new keypair");
        }

        let kp = ES256KeyPair::generate();
        let encoded = Base64UrlUnpadded::encode_string(&kp.to_bytes());
        push_repo.set_secret(VAPID_SECRET_KEY, &encoded).await?;
        info!("Generated and persisted new VAPID P-256 keypair in SQLite");
        Ok(kp)
    }

    pub fn public_key(&self) -> &str {
        &self.public_key_b64
    }

    pub async fn dispatch_to_subscriptions(
        &self,
        subs: &[PushSubscriptionRecord],
        payload: &PushPayload,
    ) -> usize {
        if subs.is_empty() {
            return 0;
        }

        let json_payload = match serde_json::to_string(payload) {
            Ok(s) => s,
            Err(e) => {
                warn!(error = %e, "Failed to serialize push payload");
                return 0;
            }
        };

        let mut sent = 0usize;
        for sub in subs {
            let t0 = Instant::now();
            match self.send_single(sub, &json_payload).await {
                Ok(true) => {
                    sent += 1;
                    info!(
                        user_id = %sub.user_id,
                        duration_ms = t0.elapsed().as_millis() as u64,
                        "Web Push delivered"
                    );
                }
                Ok(false) => {
                    // Subscription expired / 410 Gone
                    let _ = self.push_repo.delete_subscription_by_endpoint(&sub.endpoint).await;
                }
                Err(e) => {
                    warn!(
                        user_id = %sub.user_id,
                        error = %e,
                        duration_ms = t0.elapsed().as_millis() as u64,
                        "Web Push delivery failed"
                    );
                }
            }
        }
        sent
    }

    async fn send_single(
        &self,
        sub: &PushSubscriptionRecord,
        json_payload: &str,
    ) -> Result<bool, String> {
        let endpoint = sub.endpoint.parse().map_err(|e| format!("Bad endpoint URI: {e}"))?;
        let p256dh_bytes = Base64UrlUnpadded::decode_vec(&sub.p256dh)
            .map_err(|e| format!("Bad p256dh base64: {e}"))?;
        let auth_bytes = Base64UrlUnpadded::decode_vec(&sub.auth)
            .map_err(|e| format!("Bad auth base64: {e}"))?;

        let browser_pub = PublicKey::from_sec1_bytes(&p256dh_bytes)
            .map_err(|e| format!("Invalid SEC1 p256dh key: {e}"))?;
        if auth_bytes.len() != 16 {
            return Err(format!("Invalid auth length: {}", auth_bytes.len()));
        }
        let browser_auth = Auth::clone_from_slice(&auth_bytes);

        let builder = WebPushBuilder::new(endpoint, browser_pub, browser_auth)
            .with_vapid(self.key_pair.as_ref(), &self.subject);

        let http_req = builder
            .build(json_payload.as_bytes())
            .map_err(|e| format!("Push encryption error: {e}"))?;

        let (parts, body) = http_req.into_parts();
        let mut req = self.http.request(parts.method, parts.uri.to_string());
        for (name, val) in parts.headers.iter() {
            req = req.header(name.as_str(), val.as_bytes());
        }
        req = req.body(body);

        let resp = req.send().await.map_err(|e| format!("HTTP send error: {e}"))?;
        let status = resp.status();

        if status.is_success() {
            Ok(true)
        } else if status.as_u16() == 404 || status.as_u16() == 410 {
            warn!(status = %status, endpoint = %sub.endpoint, "Removing expired Web Push subscription");
            Ok(false)
        } else {
            let err_txt = resp.text().await.unwrap_or_default();
            Err(format!("Push service returned {}: {}", status, err_txt))
        }
    }
}
