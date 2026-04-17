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

/// Find the daemon binary. Checks (in order):
/// 1. Adjacent to the current executable (bundled sidecar — works for both
///    macOS `.app/Contents/MacOS/`, Windows install dir, Linux AppImage,
///    AND Tauri dev mode which copies sidecars next to the dev exe).
/// 2. CARGO_MANIFEST_DIR/binaries/ (dev workflow with target-triple suffix)
/// 3. PATH and common install locations (dev fallback)
fn find_daemon_binary() -> Option<PathBuf> {
    let bin_name = if cfg!(windows) { "ant.exe" } else { "ant" };
    let target_triple = std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .unwrap_or_else(|_| env!("TAURI_ENV_TARGET_TRIPLE").to_string());
    let sidecar_name = if cfg!(windows) {
        format!("ant-{target_triple}.exe")
    } else {
        format!("ant-{target_triple}")
    };

    // 1. Adjacent to the current executable. Tauri places `externalBin`
    //    sidecars here in every bundle format AND in dev mode (with the
    //    target-triple suffix stripped). This is how `tauri-plugin-shell`
    //    resolves sidecars internally.
    if let Ok(exe) = std::env::current_exe() {
        // Walk up from `target/.../deps/foo` if running under cargo test.
        let exe_dir = exe.parent().map(|d| {
            if d.ends_with("deps") {
                d.parent().unwrap_or(d)
            } else {
                d
            }
        });
        if let Some(dir) = exe_dir {
            // Bundled name (no triple)
            let adjacent = dir.join(bin_name);
            if adjacent.exists() {
                return Some(adjacent);
            }
            // Dev mode may keep the triple suffix on the copied sidecar
            let adjacent_triple = dir.join(&sidecar_name);
            if adjacent_triple.exists() {
                return Some(adjacent_triple);
            }
        }
    }

    // 2. Dev sidecar — CARGO_MANIFEST_DIR/binaries/ (compile-time path)
    {
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(&sidecar_name);
        if dev_path.exists() {
            return Some(dev_path);
        }
    }

    // 3. PATH fallback (development with ant-cli installed)
    if let Ok(output) = std::process::Command::new("ant").arg("--help").output() {
        if output.status.success() {
            return Some(PathBuf::from(bin_name));
        }
    }

    // 4. Common install locations
    let candidates = [dirs::home_dir().map(|h| h.join(".cargo").join("bin").join(bin_name))];
    candidates
        .into_iter()
        .flatten()
        .find(|candidate| candidate.exists())
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let mut config = AppConfig::load().map_err(|e| e.to_string())?;
    // Persist the platform's default downloads directory on first launch so
    // it's visible in settings and used by downloads without a separate
    // runtime fallback.
    if config.download_dir.is_none() {
        if let Some(default) = config::platform_default_download_dir() {
            config.download_dir = Some(default.to_string_lossy().into_owned());
            config.save().map_err(|e| e.to_string())?;
        }
    }
    Ok(config)
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    config.save().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Load a devnet manifest from the config directory (if one exists).
/// Returns the parsed manifest info for the frontend, or null if no manifest found.
#[tauri::command]
fn load_devnet_manifest() -> Result<Option<serde_json::Value>, String> {
    let manifest_path = config::config_path().join("devnet-manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }

    let data = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read devnet manifest: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse devnet manifest: {e}"))?;

    // Extract and convert bootstrap multiaddrs to socket addresses
    let bootstrap = manifest["bootstrap"]
        .as_array()
        .map(|addrs| {
            addrs
                .iter()
                .filter_map(|addr| {
                    // MultiAddr JSON is a string like "/ip4/127.0.0.1/udp/20000/quic-v1"
                    // Extract the IP and port
                    let s = addr.as_str()?;
                    let parts: Vec<&str> = s.split('/').collect();
                    let ip = parts
                        .iter()
                        .position(|&p| p == "ip4")
                        .and_then(|i| parts.get(i + 1))?;
                    let port = parts
                        .iter()
                        .position(|&p| p == "udp")
                        .and_then(|i| parts.get(i + 1))?;
                    Some(format!("{ip}:{port}"))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let evm = &manifest["evm"];
    if evm.is_null() {
        return Err("Devnet manifest has no EVM configuration".into());
    }

    Ok(Some(serde_json::json!({
        "bootstrap_peers": bootstrap,
        "rpc_url": evm["rpc_url"],
        "wallet_private_key": evm["wallet_private_key"],
        "payment_token_address": evm["payment_token_address"],
        "payment_vault_address": evm["payment_vault_address"],
    })))
}

#[tauri::command]
async fn daemon_status(url: String) -> Result<bool, String> {
    let resp = reqwest::get(format!("{url}/api/v1/status"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.status().is_success())
}

/// Proxy HTTP requests to the daemon, bypassing browser CORS restrictions.
/// Only allows requests to localhost to prevent SSRF.
#[tauri::command]
async fn daemon_request(
    url: String,
    method: String,
    body: Option<String>,
) -> Result<String, String> {
    // Validate URL is localhost only — prevent SSRF
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.host_str() {
        Some("127.0.0.1") | Some("localhost") => {}
        _ => return Err("Only localhost daemon requests allowed".into()),
    }

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
async fn disconnect_daemon_sse(state: tauri::State<'_, Arc<SseState>>) -> Result<(), String> {
    disconnect_daemon_sse_inner(&state).await;
    Ok(())
}

/// Start the daemon if it's not already running.
/// Uses a bundled sidecar binary (production) or PATH fallback (dev).
/// Spawns detached so the daemon survives app close.
#[tauri::command]
async fn ensure_daemon_running() -> Result<String, String> {
    // Check if already running via port file
    if let Some(url) = config::discover_daemon_url() {
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
        // Port file exists but daemon is unresponsive — clean up stale files
        if let Ok(data) = ant_core::config::data_dir() {
            let _ = std::fs::remove_file(data.join("daemon.port"));
            let _ = std::fs::remove_file(data.join("daemon.pid"));
        }
    }

    // Find the daemon binary (sidecar or PATH)
    let bin_path = find_daemon_binary().ok_or_else(|| {
        let target = env!("TAURI_ENV_TARGET_TRIPLE");
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let ext = if cfg!(windows) { ".exe" } else { "" };
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.display().to_string()))
            .unwrap_or_else(|| "<unknown>".into());
        format!(
            "Cannot find daemon binary. Checked: \
             {exe_dir}/ant{ext}, \
             {manifest_dir}/binaries/ant-{target}{ext}, PATH, ~/.cargo/bin"
        )
    })?;

    // Spawn detached — daemon survives app close, nodes keep running
    let mut cmd = std::process::Command::new(&bin_path);
    cmd.args(["node", "daemon", "start"]);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_PROCESS_GROUP — detaches from parent console
        cmd.creation_flags(0x00000200);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to start daemon: {e}"))?;

    // Wait for port file (up to 5 seconds)
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        if let Some(url) = config::discover_daemon_url() {
            return Ok(url);
        }
    }
    Err("Daemon started but port file not found".into())
}

/// Get the data directory path for a node by ID.
/// Reads the node_registry.json to find the actual data_dir.
#[tauri::command]
fn get_node_data_dir(node_id: u32) -> Result<String, String> {
    let registry_path = dirs::data_dir()
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ant")
        .join("node_registry.json");

    if registry_path.exists() {
        let data = std::fs::read_to_string(&registry_path)
            .map_err(|e| format!("Failed to read registry: {e}"))?;
        let registry: serde_json::Value =
            serde_json::from_str(&data).map_err(|e| format!("Failed to parse registry: {e}"))?;

        // Search for the node by ID in the registry
        if let Some(nodes) = registry["nodes"].as_array() {
            for node in nodes {
                if node["id"].as_u64() == Some(node_id as u64) {
                    if let Some(dir) = node["data_dir"].as_str() {
                        return Ok(dir.to_string());
                    }
                }
            }
        }
    }

    // Fallback: conventional path
    let base = dirs::data_dir()
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ant")
        .join("nodes")
        .join(format!("node-{node_id}"));

    Ok(base.to_string_lossy().into_owned())
}

/// Return the OS-appropriate default downloads directory. The frontend
/// uses this to offer a "reset to default" affordance; on first launch
/// `load_config` already persists this value into the config.
#[tauri::command]
fn get_default_download_dir() -> Result<String, String> {
    config::platform_default_download_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Could not determine default download directory".to_string())
}

/// Get the size of a single file in bytes.
#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("{e}"))?;
    Ok(meta.len())
}

/// Report the actual on-disk bytes consumed by a file, not its logical size.
///
/// This matters for LMDB's `data.mdb`: when ant-node grows its store, the file
/// may be sparse — a logical size equal to the configured `map_size` (dozens
/// of MB to many GB) backed by only the pages that actually hold chunks.
/// `get_file_size` returns the logical size, which would over-report storage
/// used; this command returns the bytes the filesystem has actually allocated.
///
/// - **Unix (Linux / macOS):** `stat.st_blocks * 512`. Matches `du -B1`. Works
///   on all UNIX filesystems, including APFS, ext4, btrfs, ZFS.
/// - **Windows:** falls back to `metadata.len()` for now. NTFS doesn't flag
///   LMDB `data.mdb` as sparse by default — LMDB extends the file as chunks
///   are written, so logical == on-disk in practice. If that changes we'll
///   need `GetCompressedFileSizeW` via `windows-sys` (tracked as upstream
///   TODO: expose node storage via the daemon status endpoint instead).
#[tauri::command]
fn get_disk_usage(path: String) -> Result<u64, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("{e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(meta.blocks() * 512)
    }

    #[cfg(not(unix))]
    {
        Ok(meta.len())
    }
}

#[tauri::command]
fn get_file_sizes(paths: Vec<String>) -> Result<Vec<FileMetaResult>, String> {
    config::get_file_metas(&paths)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("Invalid path {path}: {e}"))?;

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
    // Pipe ant-core / ant-node tracing events to stderr so the dev console
    // surfaces upload progress (encrypt → quote → store → finalize). Without
    // a subscriber installed every `tracing::info!()` from those crates is
    // silently dropped, which makes long-running operations look hung.
    //
    // Filter defaults are conservative — `ant_core=info` is the sweet spot
    // for upload visibility; `ant_node=warn` keeps peer-discovery noise low.
    // Override at runtime with the standard `RUST_LOG` env var, e.g.
    // `RUST_LOG=ant_core=debug,ant_node=info` for deeper investigation.
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new("ant_core=info,ant_node=warn,ant_gui=info,warn")
    });
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_writer(std::io::stderr)
        .try_init();

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
            load_devnet_manifest,
            get_app_version,
            daemon_status,
            daemon_request,
            get_file_sizes,
            get_file_size,
            get_disk_usage,
            get_dir_size,
            get_node_data_dir,
            get_default_download_dir,
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
            autonomi_ops::download_public,
            autonomi_ops::read_datamap_file,
            autonomi_ops::is_autonomi_connected,
            autonomi_ops::retry_autonomi_client,
            autonomi_ops::get_connection_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
