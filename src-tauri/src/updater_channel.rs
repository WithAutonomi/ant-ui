//! Custom updater channel selection.
//!
//! The bundled `tauri-plugin-updater` reads its endpoint from compile-time
//! `tauri.conf.json` config, which always points at the GitHub `/releases/
//! latest/...` redirect. That redirect resolves to the most recent release
//! marked **non-prerelease** — internal testers running RC builds never get
//! auto-updates between RCs.
//!
//! This module bypasses the plugin's static endpoint by building an
//! `UpdaterBuilder` ourselves at check time (see [`UpdaterExt::updater_builder`]
//! and [`UpdaterBuilder::endpoints`] for the API path), pointing it at:
//!
//! - the standard stable redirect when `AppConfig.prerelease_channel == false`
//! - a tag-specific URL resolved via the GitHub releases API when on
//!
//! The resolved URL is cached on `UpdaterChannelState` for the rest of the
//! session — flipping the toggle takes effect on the next check, but the
//! Settings UI still hints "restart to apply" because the boot-time channel
//! is what any auto-check after launch uses.

use crate::config::AppConfig;
use reqwest::Url;
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::RwLock;

const STABLE_ENDPOINT: &str =
    "https://github.com/WithAutonomi/ant-ui/releases/latest/download/latest.json";
const RELEASES_API: &str = "https://api.github.com/repos/WithAutonomi/ant-ui/releases?per_page=10";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

pub struct UpdaterChannelState {
    /// Cached resolved endpoint URL for the prerelease channel. `None` until
    /// the first check fires the GitHub API call. Stable channel never sets
    /// this (the URL is constant).
    cached_prerelease_endpoint: RwLock<Option<Url>>,
    /// Update fetched by [`check_for_update_custom`], awaiting install via
    /// [`install_pending_update`]. We hold it in app state because the JS-side
    /// `Update` instance from `@tauri-apps/plugin-updater` doesn't apply here
    /// (we built the `UpdaterBuilder` ourselves with custom endpoints).
    pending_update: RwLock<Option<Update>>,
}

impl UpdaterChannelState {
    pub fn new() -> Self {
        Self {
            cached_prerelease_endpoint: RwLock::new(None),
            pending_update: RwLock::new(None),
        }
    }
}

/// Frontend-facing summary of an available update.
#[derive(Serialize, Clone)]
pub struct UpdateMetadata {
    pub version: String,
    pub body: Option<String>,
    /// `true` when the resolved release is marked prerelease on GitHub. Lets
    /// the UpdateDialog show a "Pre-release" badge so testers can tell at a
    /// glance which channel they're being offered from.
    pub is_prerelease: bool,
}

/// One-shot wire payload for download progress, mirrors the events the JS
/// plugin emits (`Started` / `Progress` / `Finished`) so the frontend store
/// can reuse its existing handler shape.
#[derive(Serialize, Clone)]
#[serde(tag = "event", content = "data")]
enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

/// Check for an available update on the channel selected in `AppConfig`.
/// Returns `None` if the running version is already current.
#[tauri::command]
pub async fn check_for_update_custom(app: AppHandle) -> Result<Option<UpdateMetadata>, String> {
    let endpoint = resolve_updater_endpoint(&app).await?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to set updater endpoint: {e}"))?
        .build()
        .map_err(|e| format!("Failed to build updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    let state = app.state::<UpdaterChannelState>();
    if let Some(u) = update {
        let is_prerelease = looks_like_prerelease(&u.version);
        let meta = UpdateMetadata {
            version: u.version.clone(),
            body: u.body.clone(),
            is_prerelease,
        };
        *state.pending_update.write().await = Some(u);
        Ok(Some(meta))
    } else {
        *state.pending_update.write().await = None;
        Ok(None)
    }
}

/// Download and install the update fetched by the most recent
/// `check_for_update_custom` call. Tauri restarts the app automatically on
/// completion. Emits `update-download-event` with `Started` / `Progress` /
/// `Finished` payloads matching the JS plugin's event shape.
#[tauri::command]
pub async fn install_pending_update(app: AppHandle) -> Result<(), String> {
    let state = app.state::<UpdaterChannelState>();
    let update = state
        .pending_update
        .write()
        .await
        .take()
        .ok_or("No pending update — call check_for_update_custom first")?;

    let app_for_chunk = app.clone();
    let app_for_finish = app.clone();
    let mut emitted_started = false;

    update
        .download_and_install(
            move |chunk_length, content_length| {
                if !emitted_started {
                    emitted_started = true;
                    let _ = app_for_chunk.emit(
                        "update-download-event",
                        DownloadEvent::Started { content_length },
                    );
                }
                let _ = app_for_chunk.emit(
                    "update-download-event",
                    DownloadEvent::Progress { chunk_length },
                );
            },
            move || {
                let _ = app_for_finish.emit("update-download-event", DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("Update install failed: {e}"))?;

    Ok(())
}

/// Decide which endpoint to use for this check based on the persisted
/// `prerelease_channel` flag. Stable is a constant URL; prerelease is
/// resolved once via GitHub API and cached for the rest of the session.
async fn resolve_updater_endpoint(app: &AppHandle) -> Result<Url, String> {
    let cfg = AppConfig::load().map_err(|e| format!("Failed to load config: {e}"))?;

    if !cfg.prerelease_channel {
        return Url::parse(STABLE_ENDPOINT).map_err(|e| e.to_string());
    }

    let state = app.state::<UpdaterChannelState>();
    if let Some(cached) = state.cached_prerelease_endpoint.read().await.clone() {
        return Ok(cached);
    }

    let url = fetch_latest_prerelease_url().await?;
    *state.cached_prerelease_endpoint.write().await = Some(url.clone());
    Ok(url)
}

/// Query the GitHub releases API and pick the newest release by `published_at`,
/// regardless of its `prerelease` flag (drafts excluded). Constructs the
/// `latest.json` asset URL on that release.
async fn fetch_latest_prerelease_url() -> Result<Url, String> {
    let client = reqwest::Client::builder()
        .user_agent("ant-gui-updater")
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client init: {e}"))?;

    let resp = client
        .get(RELEASES_API)
        .send()
        .await
        .map_err(|e| format!("GitHub releases API: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GitHub releases API returned status {}",
            resp.status()
        ));
    }
    let releases: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse releases JSON: {e}"))?;

    let arr = releases
        .as_array()
        .ok_or("Releases response was not a JSON array")?;

    // Pick newest non-draft release by published_at (lexicographic ordering
    // works because timestamps are ISO-8601 UTC). Drafts excluded; prereleases
    // included — that's the whole point of this code path.
    let latest = arr
        .iter()
        .filter(|r| r["draft"].as_bool() != Some(true))
        .max_by_key(|r| r["published_at"].as_str().unwrap_or("").to_string())
        .ok_or("No releases found")?;

    let tag = latest["tag_name"]
        .as_str()
        .ok_or("Release missing tag_name")?;
    let url_str =
        format!("https://github.com/WithAutonomi/ant-ui/releases/download/{tag}/latest.json");
    Url::parse(&url_str).map_err(|e| format!("Bad asset URL {url_str}: {e}"))
}

/// Heuristic: a version string with `-rc.` / `-beta.` / `-alpha.` is a
/// prerelease. Matches the `release.yml` workflow's `prerelease=true`
/// detection so the badge in the dialog stays accurate.
fn looks_like_prerelease(version: &str) -> bool {
    version.contains("-rc.") || version.contains("-beta.") || version.contains("-alpha.")
}
