mod autonomi_ops;
mod config;

use autonomi_ops::AutonomiState;
use config::{AppConfig, FileMetaResult, UploadHistory, UploadHistoryEntry};
use std::path::PathBuf;

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
    std::fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))
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
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            get_app_version,
            daemon_status,
            daemon_request,
            get_file_sizes,
            read_file_bytes,
            load_upload_history,
            save_upload_history,
            discover_daemon_url,
            ensure_daemon_running,
            autonomi_ops::init_autonomi_client,
            autonomi_ops::start_upload,
            autonomi_ops::confirm_upload,
            autonomi_ops::download_file,
            autonomi_ops::is_autonomi_connected,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
