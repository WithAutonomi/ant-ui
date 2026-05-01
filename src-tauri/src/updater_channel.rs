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
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{Notify, RwLock};

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
    /// Set while a download is in flight. [`cancel_pending_install`] notifies
    /// waiters to break the `tokio::select!` in `install_pending_update`. Only
    /// honoured during download — once `install` starts, cancel becomes a
    /// no-op because aborting mid-install would leave the user's `.app` in a
    /// tempdir on macOS and brick their install.
    cancel_notify: RwLock<Option<Arc<Notify>>>,
}

impl UpdaterChannelState {
    pub fn new() -> Self {
        Self {
            cached_prerelease_endpoint: RwLock::new(None),
            pending_update: RwLock::new(None),
            cancel_notify: RwLock::new(None),
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

#[derive(Serialize, Clone)]
struct RestartFailedEvent {
    version: String,
}

/// How long to wait after `app.restart()` before assuming the restart silently
/// failed. A successful restart terminates the process within ~1-2s, so 10s is
/// a comfortable buffer that won't false-positive on a slow main loop.
const RESTART_WATCHDOG_DELAY: Duration = Duration::from_secs(10);

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
/// `check_for_update_custom` call. Emits `update-download-event` with
/// `Started` / `Progress` / `Finished` payloads matching the JS plugin's
/// event shape, then restarts the app so the new binary is picked up.
///
/// We deliberately split `download` from `install` (rather than calling the
/// combined `download_and_install`) so [`cancel_pending_install`] can drop
/// the in-flight download future via `tokio::select!`. Once `install` starts
/// we're past the cancel window — on macOS `install_inner` moves the running
/// `.app` to a temp backup before extracting the new bundle into place, and
/// aborting between those steps would leave the user with no app.
///
/// The plugin only triggers a process restart on Windows (its NSIS/MSI path
/// calls `process::exit(0)` directly). Linux (AppImage) and macOS write the
/// new binary to disk and return, so we call `app.restart()` ourselves.
///
/// `app.restart()` can silently fail on macOS: when invoked from a non-main
/// thread (Tauri commands run on the tokio runtime), it asks the main loop
/// to exit and sleeps forever. If the main loop doesn't honour the exit, the
/// task hangs and the frontend never hears back. The watchdog spawned just
/// before the restart catches that case and emits `update-restart-failed` so
/// the UI can prompt the user to quit and reopen manually.
#[tauri::command]
pub async fn install_pending_update(app: AppHandle) -> Result<(), String> {
    let state = app.state::<UpdaterChannelState>();
    let update = state
        .pending_update
        .write()
        .await
        .take()
        .ok_or("No pending update — call check_for_update_custom first")?;

    let cancel_notify = Arc::new(Notify::new());
    *state.cancel_notify.write().await = Some(cancel_notify.clone());

    let app_for_chunk = app.clone();
    let app_for_finish = app.clone();
    let mut emitted_started = false;
    let update_version = update.version.clone();

    let download_fut = update.download(
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
    );

    let bytes = tokio::select! {
        res = download_fut => {
            // Clear cancel handle as soon as download resolves — install is
            // past the cancel window.
            *state.cancel_notify.write().await = None;
            res.map_err(|e| format!("Update download failed: {e}"))?
        }
        _ = cancel_notify.notified() => {
            *state.cancel_notify.write().await = None;
            return Err("CANCELLED".to_string());
        }
    };

    update
        .install(bytes)
        .map_err(|e| format!("Update install failed: {e}"))?;

    // Watchdog: if `app.restart()` actually terminates the process, this
    // thread dies with it before the sleep ends. If we're still alive after
    // the delay, restart silently failed — surface to the UI.
    let app_for_watchdog = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(RESTART_WATCHDOG_DELAY);
        let _ = app_for_watchdog.emit(
            "update-restart-failed",
            RestartFailedEvent {
                version: update_version,
            },
        );
    });

    app.restart()
}

/// Cancel an in-flight download started by [`install_pending_update`]. No-op
/// if no download is in flight. Returns `Err` if the install has already
/// crossed into the uncancellable `install` step.
#[tauri::command]
pub async fn cancel_pending_install(app: AppHandle) -> Result<(), String> {
    let state = app.state::<UpdaterChannelState>();
    let notify = state
        .cancel_notify
        .read()
        .await
        .clone()
        .ok_or("No cancellable install in progress")?;
    notify.notify_waiters();
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
