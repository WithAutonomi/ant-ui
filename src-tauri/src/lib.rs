mod autonomi_ops;
mod config;

use autonomi_ops::AutonomiState;
use config::{AppConfig, FileMetaResult, UploadHistory, UploadHistoryEntry};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{watch, RwLock};

// ── SSE proxy state ──

pub struct SseState {
    /// Sender to signal the SSE background task to stop.
    stop_tx: watch::Sender<bool>,
    /// Handle to the spawned SSE task (if any).
    task_handle: RwLock<Option<tokio::task::JoinHandle<()>>>,
}

impl SseState {
    fn new() -> Self {
        let (stop_tx, _) = watch::channel(false);
        Self {
            stop_tx,
            task_handle: RwLock::new(None),
        }
    }
}

/// Attempt to stop a stale daemon (ignores errors).
async fn try_stop_daemon() {
    if let Some(ant_bin) = which_ant() {
        let _ = tokio::process::Command::new(&ant_bin)
            .args(["node", "daemon", "stop"])
            .output()
            .await;
        // Brief pause for PID/port files to be cleaned up
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// Find the `ant` binary, checking PATH and common install locations.
fn which_ant() -> Option<PathBuf> {
    // Check PATH first
    if let Ok(output) = std::process::Command::new("ant").arg("--help").output() {
        if output.status.success() {
            return Some(PathBuf::from("ant"));
        }
    }

    // Check common install locations
    let candidates = [
        dirs::home_dir().map(|h| h.join(".cargo").join("bin").join(if cfg!(windows) { "ant.exe" } else { "ant" })),
        Some(PathBuf::from(if cfg!(windows) { r"C:\Program Files\Autonomi\ant.exe" } else { "/usr/local/bin/ant" })),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    AppConfig::load().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    config.save().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
async fn daemon_status(url: String) -> Result<bool, String> {
    let resp = reqwest::get(format!("{url}/api/v1/status"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.status().is_success())
}

/// Proxy HTTP requests to the daemon, bypassing browser CORS restrictions.
/// The daemon only allows same-origin requests, so all API calls must go through Tauri.
#[tauri::command]
async fn daemon_request(
    url: String,
    method: String,
    body: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        "PUT" => client.put(&url),
        _ => return Err(format!("Unsupported method: {method}")),
    };

    req = req.header("Content-Type", "application/json");
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "Request timed out — daemon may be unresponsive".to_string()
        } else if e.is_connect() {
            "Cannot connect to daemon — is it running?".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if status >= 400 {
        return Err(text);
    }
    Ok(text)
}

#[tauri::command]
fn discover_daemon_url() -> Option<String> {
    config::discover_daemon_url()
}

/// Start streaming SSE events from the daemon, forwarding them to the frontend.
#[tauri::command]
async fn connect_daemon_sse(
    url: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SseState>>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    // Stop any existing SSE task first.
    disconnect_daemon_sse_inner(&state).await;

    // Reset the stop signal.
    let _ = state.stop_tx.send(false);
    let mut stop_rx = state.stop_tx.subscribe();

    let sse_url = format!("{url}/api/v1/events");

    let handle = tokio::spawn(async move {
        loop {
            // Check if we should stop before (re)connecting.
            if *stop_rx.borrow() {
                break;
            }

            let client = match reqwest::Client::builder()
                .no_proxy() // SSE is always local daemon
                .build()
            {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[SSE] Failed to build HTTP client: {e}");
                    break;
                }
            };

            let resp = client
                .get(&sse_url)
                .header("Accept", "text/event-stream")
                .send()
                .await;

            let resp = match resp {
                Ok(r) if r.status().is_success() => r,
                Ok(r) => {
                    eprintln!("[SSE] Daemon returned status {}", r.status());
                    // Wait before retrying, but respect stop signal.
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => continue,
                        _ = stop_rx.changed() => break,
                    }
                }
                Err(e) => {
                    eprintln!("[SSE] Connection failed: {e}");
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => continue,
                        _ = stop_rx.changed() => break,
                    }
                }
            };

            let mut stream = resp.bytes_stream();
            let mut buffer = String::new();

            loop {
                tokio::select! {
                    chunk = stream.next() => {
                        match chunk {
                            Some(Ok(bytes)) => {
                                buffer.push_str(&String::from_utf8_lossy(&bytes));

                                // Process complete lines from the buffer.
                                while let Some(pos) = buffer.find('\n') {
                                    let line = buffer[..pos].trim_end_matches('\r').to_string();
                                    buffer = buffer[pos + 1..].to_string();

                                    if let Some(data) = line.strip_prefix("data:") {
                                        let data = data.trim().to_string();
                                        if !data.is_empty() {
                                            let _ = app.emit("daemon-sse-event", &data);
                                        }
                                    }
                                    // Ignore other SSE fields (event:, id:, retry:, comments)
                                }
                            }
                            Some(Err(e)) => {
                                eprintln!("[SSE] Stream error: {e}");
                                break; // Will reconnect via outer loop
                            }
                            None => {
                                eprintln!("[SSE] Stream ended");
                                break; // Will reconnect via outer loop
                            }
                        }
                    }
                    _ = stop_rx.changed() => {
                        return; // Stop signal received
                    }
                }
            }

            // Brief pause before reconnecting after stream end/error.
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
                _ = stop_rx.changed() => break,
            }
        }
    });

    *state.task_handle.write().await = Some(handle);
    Ok(())
}

/// Internal helper to stop the SSE task.
async fn disconnect_daemon_sse_inner(state: &SseState) {
    // Signal the task to stop.
    let _ = state.stop_tx.send(true);

    // Wait for the task to finish (with a timeout).
    let handle = state.task_handle.write().await.take();
    if let Some(h) = handle {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), h).await;
    }
}

/// Stop the SSE background task.
#[tauri::command]
async fn disconnect_daemon_sse(
    state: tauri::State<'_, Arc<SseState>>,
) -> Result<(), String> {
    disconnect_daemon_sse_inner(&state).await;
    Ok(())
}

/// Start the ant daemon if it's not already running.
/// Returns the daemon URL on success.
#[tauri::command]
async fn ensure_daemon_running() -> Result<String, String> {
    // Check if already running via port file
    if let Some(url) = config::discover_daemon_url() {
        // Verify it's actually responsive (short timeout)
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap_or_default();
        if client
            .get(format!("{url}/api/v1/status"))
            .send()
            .await
            .is_ok()
        {
            return Ok(url);
        }
        // Port file exists but daemon is unresponsive — stale PID.
        // Stop the stale daemon first so a fresh start can succeed.
        let _ = try_stop_daemon().await;
    }

    // Start the daemon
    let ant_bin = which_ant().ok_or("Cannot find 'ant' binary — is ant-cli installed?")?;
    let output = tokio::process::Command::new(&ant_bin)
        .args(["node", "daemon", "start"])
        .output()
        .await
        .map_err(|e| format!("Failed to start daemon: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{stdout}{stderr}");
        if !combined.contains("already running") {
            return Err(format!("Daemon start failed: {combined}"));
        }
    }

    // Wait briefly for the port file to be written
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    config::discover_daemon_url()
        .ok_or_else(|| "Daemon started but port file not found".to_string())
}

#[tauri::command]
fn get_file_sizes(paths: Vec<String>) -> Result<Vec<FileMetaResult>, String> {
    config::get_file_metas(&paths)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Invalid path {path}: {e}"))?;

    if !canonical.is_file() {
        return Err(format!("Not a regular file: {path}"));
    }

    std::fs::read(&canonical).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Recursively calculate the total size of a directory in bytes.
#[tauri::command]
async fn get_dir_size(path: String) -> Result<u64, String> {
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|e| format!("Invalid path {path}: {e}"))?;

    if !canonical.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    // Run the recursive walk on a blocking thread to avoid blocking the async runtime
    tokio::task::spawn_blocking(move || {
        let mut total: u64 = 0;
        let mut stack = vec![canonical];
        while let Some(dir) = stack.pop() {
            let entries = match std::fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue, // skip dirs we can't read
            };
            for entry in entries.flatten() {
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.is_dir() {
                    stack.push(entry.path());
                } else {
                    total += meta.len();
                }
            }
        }
        Ok(total)
    })
    .await
    .map_err(|e| format!("Directory scan failed: {e}"))?
}

#[tauri::command]
fn load_upload_history() -> Result<Vec<UploadHistoryEntry>, String> {
    let history = UploadHistory::load().map_err(|e| e.to_string())?;
    Ok(history.entries)
}

#[tauri::command]
fn save_upload_history(entries: Vec<UploadHistoryEntry>) -> Result<(), String> {
    let history = UploadHistory { entries };
    history.save().map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AutonomiState::new())
        .manage(Arc::new(SseState::new()))
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            get_app_version,
            daemon_status,
            daemon_request,
            get_file_sizes,
            get_dir_size,
            read_file_bytes,
            load_upload_history,
            save_upload_history,
            discover_daemon_url,
            ensure_daemon_running,
            connect_daemon_sse,
            disconnect_daemon_sse,
            autonomi_ops::init_autonomi_client,
            autonomi_ops::start_upload,
            autonomi_ops::confirm_upload,
            autonomi_ops::confirm_upload_merkle,
            autonomi_ops::download_file,
            autonomi_ops::is_autonomi_connected,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
