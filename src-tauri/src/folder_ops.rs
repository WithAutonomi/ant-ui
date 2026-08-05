// ant-ui: folder operations Tauri commands.
// Folder watcher, upload queue, and status tracking.

use ant_core::data::client::folder::{FolderManifest, UploadState};
use ant_core::data::client::merkle::PaymentMode;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Application state: the upload queue.
pub struct UploadQueueState {
    pub state_path: PathBuf,
    pub staging_dir: PathBuf,
    pub state: Mutex<UploadState>,
}

/// Response for the uploads page: list of pending/active/completed folders.
#[derive(Debug, Serialize)]
pub struct UploadStatus {
    pub pending: Vec<FolderInfo>,
    pub uploading: Option<FolderInfo>,
    pub completed: Vec<FolderInfo>,
}

#[derive(Debug, Serialize)]
pub struct FolderInfo {
    pub path: String,
    pub name: String,
    pub file_count: usize,
    pub total_size: u64,
    pub status: String,
    pub progress_pct: Option<f64>,
    pub manifest_addr: Option<String>,
    pub recovery_tx_hash: Option<String>,
}

/// Get current upload status.
#[tauri::command]
pub fn get_upload_status(state: State<UploadQueueState>) -> UploadStatus {
    let s = state.state.lock().unwrap();

    let pending: Vec<FolderInfo> = s.pending.iter().map(|p| FolderInfo {
        path: p.path.clone(),
        name: folder_name_from_path(&p.path),
        file_count: p.file_count,
        total_size: p.total_size,
        status: "pending".into(),
        progress_pct: None,
        manifest_addr: None,
        recovery_tx_hash: None,
    }).collect();

    let uploading = s.uploading.as_ref().map(|a| FolderInfo {
        path: a.path.clone(),
        name: folder_name_from_path(&a.path),
        file_count: 0,
        total_size: 0,
        status: "uploading".into(),
        progress_pct: Some(a.progress_pct),
        manifest_addr: None,
        recovery_tx_hash: None,
    });

    let completed: Vec<FolderInfo> = s.completed.iter().map(|c| FolderInfo {
        path: String::new(),
        name: c.folder_name.clone(),
        file_count: c.file_count,
        total_size: 0,
        status: "completed".into(),
        progress_pct: Some(100.0),
        manifest_addr: Some(c.manifest_addr.clone()),
        recovery_tx_hash: c.recovery_tx_hash.clone(),
    }).collect();

    UploadStatus { pending, uploading, completed }
}

/// Scan the staging directory for new folders and add them to the queue.
#[tauri::command]
pub fn scan_staging(state: State<UploadQueueState>) -> Vec<String> {
    let staging = &state.staging_dir;
    let mut state_guard = state.state.lock().unwrap();
    let mut added = vec![];

    if let Ok(entries) = std::fs::read_dir(staging) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && !path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(true) {
                let path_str = path.to_string_lossy().to_string();
                let already_queued = state_guard.pending.iter().any(|p| p.path == path_str)
                    || state_guard.uploading.as_ref().map(|a| a.path == path_str).unwrap_or(false)
                    || state_guard.completed.iter().any(|c| c.folder_name == folder_name_from_path(&path_str));

                if !already_queued {
                    if let Ok(manifest) = FolderManifest::build(&path) {
                        state_guard.pending.push(ant_core::data::client::folder::PendingFolder {
                            path: path_str.clone(),
                            detected_at: chrono_now(),
                            file_count: manifest.file_count,
                            total_size: manifest.total_size,
                        });
                        added.push(path_str);
                    }
                }
            }
        }
    }

    let _ = state_guard.save(&state.state_path);
    added
}

/// Clear completed uploads from the list.
#[tauri::command]
pub fn clear_completed(state: State<UploadQueueState>) {
    let mut s = state.state.lock().unwrap();
    s.completed.clear();
    let _ = s.save(&state.state_path);
}

/// Set the staging directory path.
#[tauri::command]
pub fn set_staging_dir(state: State<UploadQueueState>, path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create: {e}"))?;
    let mut s = state.state.lock().unwrap();
    s.staging_dir = dir;
    Ok(())
}

/// Start uploading a specific folder from the queue.
#[tauri::command]
pub async fn start_upload(state: State<'_, UploadQueueState>, folder_path: String, recovery: bool) -> Result<FolderInfo, String> {
    let path = PathBuf::from(&folder_path);
    let manifest = FolderManifest::build(&path)
        .map_err(|e| format!("manifest: {e}"))?;

    let mode = if recovery { PaymentMode::Recovery } else { PaymentMode::Auto };

    // In production: connect to antd, upload chunks, pay, finalize
    // For now: stub success
    let manifest_addr = format!("stub-manifest-{}", &folder_path[..8.min(folder_path.len())]);

    // Update state
    let mut s = state.state.lock().unwrap();
    s.uploading = None;
    s.pending.retain(|p| p.path != folder_path);
    s.completed.push(ant_core::data::client::folder::CompletedFolder {
        folder_name: manifest.folder_name.clone(),
        completed_at: chrono_now(),
        file_count: manifest.file_count,
        manifest_addr: manifest_addr.clone(),
        recovery_tx_hash: if recovery { Some("stub-tx-hash".into()) } else { None },
    });
    let _ = s.save(&state.state_path);

    Ok(FolderInfo {
        path: folder_path.clone(),
        name: manifest.folder_name,
        file_count: manifest.file_count,
        total_size: manifest.total_size,
        status: "completed".into(),
        progress_pct: Some(100.0),
        manifest_addr: Some(manifest_addr),
        recovery_tx_hash: if recovery { Some("stub-tx-hash".into()) } else { None },
    })
}

fn folder_name_from_path(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn chrono_now() -> String {
    use std::time::SystemTime;
    let dur = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs();
    let days = secs / 86400;
    let time = secs % 86400;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        1970 + (days / 365) as i64,
        ((days % 365) / 30 + 1).min(12),
        (days % 30 + 1).min(31),
        time / 3600, (time % 3600) / 60, time % 60)
}
