use config::{Config, Environment, File};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub frontend_url: String,
    pub cors_origins: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    pub google_client_id: String,
    pub google_client_secret: String,
    pub google_redirect_uri: String,
    pub allow_dev_login: bool,
    pub session_ttl_hours: i64,
    pub admin_email: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PushConfig {
    pub subject: String,
    pub vapid_private_key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
    pub push: PushConfig,
}

impl AppConfig {
    /// Loads hierarchical YAML configuration (`default.yaml`, optional `prod.yaml`, optional `local.yaml`, and `APP__*` env overrides).
    pub fn load() -> Result<Self, config::ConfigError> {
        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "DEV".to_string());
        let mut builder = Config::builder().add_source(File::with_name("config/default"));

        if profile.eq_ignore_ascii_case("PROD") {
            builder = builder.add_source(File::with_name("config/prod").required(false));
        }

        builder = builder
            .add_source(File::with_name("config/local").required(false))
            .add_source(Environment::with_prefix("APP").separator("__"));

        builder.build()?.try_deserialize()
    }

    pub fn google_oauth_configured(&self) -> bool {
        !self.auth.google_client_id.trim().is_empty()
            && !self.auth.google_client_secret.trim().is_empty()
    }
}
