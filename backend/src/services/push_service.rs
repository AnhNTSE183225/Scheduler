use crate::config::AppConfig;
use crate::error::AppError;
use crate::models::notification::PushSubscriptionRecord;
use crate::repositories::push_repo::PushRepository;
use axum::http::Uri;
use base64ct::{Base64UrlUnpadded, Encoding as _};
use futures::stream::{self, StreamExt};
use serde::Serialize;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};
use web_push_native::{
    Auth, WebPushBuilder,
    jwt_simple::{
        algorithms::{ECDSAP256KeyPairLike, ECDSAP256PublicKeyLike, ES256KeyPair},
        claims::Claims,
        prelude::Duration as JwtDuration,
    },
    p256::PublicKey,
};

const VAPID_SECRET_KEY: &str = "vapid_private_key";

/// Strict allowlist of legitimate Web Push service host suffixes (mitigates SSRF & tarpit DoS).
const ALLOWED_PUSH_HOST_SUFFIXES: &[&str] = &[
    "fcm.googleapis.com",
    "android.googleapis.com",
    "push.services.mozilla.com",
    "updates.push.services.mozilla.com",
    "push.apple.com",
    "web.push.apple.com",
    "notify.windows.com",
];

pub fn validate_push_endpoint(endpoint: &str) -> Result<(), AppError> {
    if endpoint.len() > 2048 {
        return Err(AppError::BadRequest("Push endpoint URL is too long".to_string()));
    }
    let uri: Uri = endpoint
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid push endpoint URL".to_string()))?;

    if uri.scheme_str() != Some("https") {
        return Err(AppError::BadRequest(
            "Push endpoint must use HTTPS".to_string(),
        ));
    }

    let authority = uri
        .authority()
        .ok_or_else(|| AppError::BadRequest("Push endpoint missing host".to_string()))?;
    if authority.as_str().contains('@') {
        return Err(AppError::BadRequest(
            "Push endpoint must not contain credentials".to_string(),
        ));
    }

    let host = authority.host().to_ascii_lowercase();
    if host.parse::<IpAddr>().is_ok() || host == "localhost" {
        return Err(AppError::BadRequest(
            "Push endpoint must target a trusted Web Push service host".to_string(),
        ));
    }

    let allowed = ALLOWED_PUSH_HOST_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")));
    if !allowed {
        return Err(AppError::BadRequest(
            "Unsupported Web Push service host".to_string(),
        ));
    }
    Ok(())
}

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

        let results: Vec<usize> = stream::iter(subs.iter().cloned())
            .map(|sub| {
                let payload_ref = json_payload.clone();
                async move {
                    let t0 = Instant::now();
                    match self.send_single(&sub, &payload_ref).await {
                        Ok(true) => {
                            info!(
                                user_id = %sub.user_id,
                                duration_ms = t0.elapsed().as_millis() as u64,
                                "Web Push delivered"
                            );
                            1
                        }
                        Ok(false) => {
                            let _ = self
                                .push_repo
                                .delete_subscription_by_endpoint(&sub.endpoint)
                                .await;
                            0
                        }
                        Err(e) => {
                            warn!(
                                user_id = %sub.user_id,
                                error = %e,
                                duration_ms = t0.elapsed().as_millis() as u64,
                                "Web Push delivery failed"
                            );
                            0
                        }
                    }
                }
            })
            .buffer_unordered(12)
            .collect()
            .await;

        results.into_iter().sum()
    }

    async fn send_single(
        &self,
        sub: &PushSubscriptionRecord,
        json_payload: &str,
    ) -> Result<bool, String> {
        validate_push_endpoint(&sub.endpoint).map_err(|e| e.to_string())?;

        let endpoint_uri: Uri = sub.endpoint.parse().map_err(|e| format!("Bad endpoint URI: {e}"))?;
        let scheme = endpoint_uri
            .scheme_str()
            .ok_or_else(|| "Missing scheme in push endpoint".to_string())?;
        let host = endpoint_uri
            .host()
            .ok_or_else(|| "Missing host in push endpoint".to_string())?;
        let audience = format!("{scheme}://{host}");

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

        let builder = WebPushBuilder::new(endpoint_uri, browser_pub, browser_auth)
            .with_valid_duration(Duration::from_secs(12 * 3600));

        let http_req = builder
            .build(json_payload.as_bytes())
            .map_err(|e| format!("Push encryption error: {e}"))?;

        // Build RFC 8292 VAPID JWT without a strict `nbf` (avoids 403 rejections when local clock leads by a few seconds).
        let mut claims = Claims::create(JwtDuration::from_secs(12 * 3600))
            .with_audience(audience)
            .with_subject(&self.subject);
        claims.invalid_before = None;
        claims.issued_at = None;
        let jwt = self
            .key_pair
            .sign(claims)
            .map_err(|e| format!("VAPID JWT signing error: {e}"))?;
        let auth_header = format!("vapid t={jwt}, k={}", self.public_key_b64);

        let (parts, body) = http_req.into_parts();
        let mut req = self.http.request(parts.method, parts.uri.to_string());
        for (name, val) in parts.headers.iter() {
            req = req.header(name.as_str(), val.as_bytes());
        }
        req = req.header(axum::http::header::AUTHORIZATION, auth_header);
        req = req.body(body);

        let resp = req.send().await.map_err(|e| format!("HTTP send error: {e}"))?;
        let status = resp.status();

        if status.is_success() {
            Ok(true)
        } else if status.as_u16() == 404 || status.as_u16() == 410 {
            warn!(status = %status, "Removing expired Web Push subscription");
            Ok(false)
        } else {
            let err_txt = resp.text().await.unwrap_or_default();
            let snippet: String = err_txt.chars().take(160).collect();
            Err(format!("Push service returned {}: {}", status, snippet))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_endpoint_validation_blocks_ssrf_and_allows_trusted_hosts() {
        assert!(validate_push_endpoint("https://fcm.googleapis.com/fcm/send/abc123").is_ok());
        assert!(validate_push_endpoint("https://web.push.apple.com/Q12345").is_ok());
        assert!(validate_push_endpoint("https://wns2-bn3p.notify.windows.com/w/?token=1").is_ok());

        assert!(validate_push_endpoint("http://fcm.googleapis.com/fcm/send/abc").is_err());
        assert!(validate_push_endpoint("https://127.0.0.1:8080/api/health").is_err());
        assert!(validate_push_endpoint("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_push_endpoint("https://fcm.googleapis.com.evil.com/x").is_err());
        assert!(validate_push_endpoint("https://user:pass@fcm.googleapis.com/x").is_err());
    }
}
