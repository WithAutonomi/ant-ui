use ant_core::data::{
    Client, ClientConfig, CoreNodeConfig, CustomNetwork, DataMap, EvmNetwork, ExternalPaymentInfo,
    MultiAddr, NodeMode, P2PNode, PreparedUpload, MAX_WIRE_MESSAGE_SIZE,
};
use evmlib::common::{QuoteHash, TxHash};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

#[derive(Deserialize)]
struct BootstrapPeersFile {
    peers: Vec<String>,
}

/// Read the bundled `bootstrap_peers.toml` shipped as a Tauri resource.
///
/// The file lives at `src-tauri/resources/bootstrap_peers.toml` in the repo and
/// is bundled into the app at build time. CI overwrites it from the daemon
/// release archive so the bundled list always matches the daemon being shipped.
fn load_bundled_bootstrap_peers(app: &AppHandle) -> Result<Vec<std::net::SocketAddr>, String> {
    let path = app
        .path()
        .resolve(
            "resources/bootstrap_peers.toml",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("Failed to resolve bootstrap_peers.toml resource: {e}"))?;

    let contents = std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "Failed to read bundled bootstrap_peers.toml at {}: {e}",
            path.display()
        )
    })?;

    let parsed: BootstrapPeersFile = toml::from_str(&contents)
        .map_err(|e| format!("Failed to parse bootstrap_peers.toml: {e}"))?;

    let peers: Vec<std::net::SocketAddr> =
        parsed.peers.iter().filter_map(|s| s.parse().ok()).collect();

    if peers.is_empty() {
        return Err("Bundled bootstrap_peers.toml has no parseable peers".into());
    }
    Ok(peers)
}

// ── Shared state managed by Tauri ──

/// State of the embedded ant-core client connection. Mirrored to the frontend
/// via `connection-status` events so the UI can show progress / retry buttons.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ConnectionStatus {
    /// No connect attempt has run yet (initial state on app start).
    Idle,
    /// A connect attempt is in flight.
    Connecting,
    /// Successfully connected to the network.
    Connected,
    /// Connect failed. `reason` is the error from the backend.
    Failed { reason: String },
}

pub struct AutonomiState {
    pub client: RwLock<Option<Client>>,
    pub pending_uploads: RwLock<HashMap<String, PendingUpload>>,
    pub connection_status: RwLock<ConnectionStatus>,
    /// Holds the last set of args used for `init_autonomi_client`, so a manual
    /// `retry_autonomi_client` can re-run with the same configuration.
    pub last_init_args: RwLock<Option<InitArgs>>,
}

/// Captured arguments from the most recent `init_autonomi_client` call.
#[derive(Clone)]
pub struct InitArgs {
    pub bootstrap_peers: Option<Vec<String>>,
    pub evm_rpc_url: Option<String>,
    pub evm_token_address: Option<String>,
    pub evm_vault_address: Option<String>,
}

/// Pending uploads older than this are garbage-collected.
const PENDING_UPLOAD_TTL: std::time::Duration = std::time::Duration::from_secs(30 * 60);

/// An upload that's been prepared (encrypted + quoted) and is waiting for the
/// frontend to complete its payment step before chunks are stored on the
/// network. `file_name` is the basename of the original file — captured here
/// so `confirm_upload` can name the persisted datamap after it.
pub struct PendingUpload {
    pub prepared: PreparedUpload,
    pub created_at: std::time::Instant,
    pub file_name: String,
}

impl AutonomiState {
    pub fn new() -> Self {
        Self {
            client: RwLock::new(None),
            pending_uploads: RwLock::new(HashMap::new()),
            connection_status: RwLock::new(ConnectionStatus::Idle),
            last_init_args: RwLock::new(None),
        }
    }

    /// Remove pending uploads that have expired.
    pub async fn gc_pending_uploads(&self) {
        let cutoff = std::time::Instant::now() - PENDING_UPLOAD_TTL;
        self.pending_uploads
            .write()
            .await
            .retain(|_, pending| pending.created_at > cutoff);
    }
}

// ── Types exchanged with the frontend ──

/// Payment tuple sent to the frontend: [quoteHash, rewardsAddress, amount]
pub type RawPayment = [String; 3];

/// Serializable candidate node for merkle pool commitments.
#[derive(Serialize, Clone)]
pub struct SerializedCandidateNode {
    pub rewards_address: String,
    pub amount: String,
}

/// Serializable pool commitment for merkle payments.
#[derive(Serialize, Clone)]
pub struct SerializedPoolCommitment {
    pub pool_hash: String,
    pub candidates: Vec<SerializedCandidateNode>,
}

#[derive(Serialize, Clone)]
pub struct UploadQuoteEvent {
    pub upload_id: String,
    /// "wave-batch" or "merkle"
    pub payment_mode: String,
    // ── Wave-batch fields (empty for merkle) ──
    pub payments: Vec<RawPayment>,
    pub total_cost: String,
    pub payment_required: bool,
    // ── Merkle fields (None for wave-batch) ──
    pub merkle_depth: Option<u8>,
    pub merkle_pool_commitments: Option<Vec<SerializedPoolCommitment>>,
    pub merkle_timestamp: Option<u64>,
}

#[derive(Serialize)]
pub struct UploadResult {
    pub upload_id: String,
    /// Serialized DataMap (JSON) — needed for later download.
    pub data_map_json: String,
    /// Hex address derived from the DataMap (for display/sharing).
    pub address: String,
    pub chunks_stored: usize,
    /// Absolute path to the persisted DataMap file on the local filesystem.
    /// This is the user-visible handle for private uploads — without it, the
    /// data is unreachable after the app restarts.
    pub data_map_file: String,
}

#[derive(Deserialize)]
pub struct StartUploadRequest {
    pub files: Vec<String>,
    pub upload_id: String,
}

// ── Tauri commands ──

/// Update the connection status and emit a `connection-status` event for the
/// frontend. Always call this rather than mutating `connection_status` directly
/// so the UI stays in sync.
async fn set_connection_status(app: &AppHandle, new_status: ConnectionStatus) {
    let state = app.state::<AutonomiState>();
    *state.connection_status.write().await = new_status.clone();
    if let Err(e) = app.emit("connection-status", &new_status) {
        eprintln!("Failed to emit connection-status event: {e}");
    }
}

/// Background task: build + start the embedded P2P node once and emit status
/// transitions via `set_connection_status`. Matches `ant-cli`'s behavior —
/// no per-attempt timeout and no retry loop. `P2PNode::start()` blocks on
/// the saorsa-core bootstrap loop (sequential `.await` per peer with a 15s
/// identity-exchange timeout each), so cold start can take 1-4 minutes on
/// a fresh connect. If it genuinely wedges, the user can hit Retry (which
/// calls `retry_autonomi_client`) or restart the app.
async fn run_connection_loop(app: AppHandle, args: InitArgs) {
    let peers: Vec<std::net::SocketAddr> = match &args.bootstrap_peers {
        Some(list) if !list.is_empty() => list.iter().filter_map(|s| s.parse().ok()).collect(),
        _ => match load_bundled_bootstrap_peers(&app) {
            Ok(peers) => peers,
            Err(e) => {
                set_connection_status(
                    &app,
                    ConnectionStatus::Failed {
                        reason: format!("Could not load bootstrap peers: {e}"),
                    },
                )
                .await;
                return;
            }
        },
    };

    if peers.is_empty() {
        set_connection_status(
            &app,
            ConnectionStatus::Failed {
                reason: "No bootstrap peers available".into(),
            },
        )
        .await;
        return;
    }

    let evm_network = if let Some(rpc_url) = &args.evm_rpc_url {
        let Some(token) = &args.evm_token_address else {
            set_connection_status(
                &app,
                ConnectionStatus::Failed {
                    reason: "evm_token_address required with evm_rpc_url".into(),
                },
            )
            .await;
            return;
        };
        let Some(vault) = &args.evm_vault_address else {
            set_connection_status(
                &app,
                ConnectionStatus::Failed {
                    reason: "evm_vault_address required with evm_rpc_url".into(),
                },
            )
            .await;
            return;
        };
        EvmNetwork::Custom(CustomNetwork::new(rpc_url, token, vault))
    } else {
        EvmNetwork::ArbitrumOne
    };

    // Devnet (custom EVM RPC) runs on loopback — opt the saorsa-transport
    // `local` flag in for that case only. Production peers reject the
    // loopback handshake variant, so the default of `false` is correct
    // for mainnet uploads. Matches the `--allow-loopback` semantics in
    // ant-cli (see WithAutonomi/ant-client#40).
    let allow_loopback = args.evm_rpc_url.is_some();

    set_connection_status(&app, ConnectionStatus::Connecting).await;

    let client_config = ClientConfig {
        allow_loopback,
        ..ClientConfig::default()
    };

    // Force IPv4-only on outbound connections. Upstream `Network::new`
    // hardcodes `ipv6(true)` (ant-client PR #33), which dual-stacks the
    // socket and turns every peer send into a `[DUAL SEND]` that wastes
    // ~15s per failing IPv6 leg on home networks where the ISP drops
    // outbound v6. Measured cold-start on this machine was 100s with
    // ipv6(false) vs 218s with ipv6(true).
    //
    // Temporary workaround — remove once upstream ships RFC 8305 happy
    // eyeballs / IPv6 reachability detection so dual-stack is safe to
    // leave on by default (see docs/ipv6-bootstrap-proposal.md in the
    // review thread). Until then we mirror `ant-cli::create_client_node_raw`
    // by building `CoreNodeConfig` directly and calling `Client::from_node`,
    // bypassing `Client::connect` / `Network::new`.
    let mut core_config = match CoreNodeConfig::builder()
        .port(0)
        .ipv6(false)
        .local(allow_loopback)
        .mode(NodeMode::Client)
        .max_message_size(MAX_WIRE_MESSAGE_SIZE)
        .build()
    {
        Ok(cfg) => cfg,
        Err(e) => {
            let reason = format!("core config build failed: {e}");
            eprintln!("Autonomi connect: {reason}");
            set_connection_status(&app, ConnectionStatus::Failed { reason }).await;
            return;
        }
    };
    core_config.bootstrap_peers = peers.iter().map(|addr| MultiAddr::quic(*addr)).collect();

    let node = match P2PNode::new(core_config).await {
        Ok(n) => n,
        Err(e) => {
            let reason = format!("P2PNode::new failed: {e}");
            eprintln!("Autonomi connect: {reason}");
            set_connection_status(&app, ConnectionStatus::Failed { reason }).await;
            return;
        }
    };

    if let Err(e) = node.start().await {
        let reason = format!("P2PNode::start failed: {e}");
        eprintln!("Autonomi connect: {reason}");
        set_connection_status(&app, ConnectionStatus::Failed { reason }).await;
        return;
    }

    let node = std::sync::Arc::new(node);
    let peer_count = node.connected_peers().await.len();
    let client = Client::from_node(node, client_config).with_evm_network(evm_network);
    *app.state::<AutonomiState>().client.write().await = Some(client);
    eprintln!("Autonomi connect succeeded ({peer_count} peers)");
    set_connection_status(&app, ConnectionStatus::Connected).await;
}

/// Spawn the connection loop if no client is already set. Returns immediately —
/// the actual connect runs in the background and reports state via
/// `connection-status` events. `bootstrap_peers` overrides the bundled list
/// (devnet path); when None/empty, falls back to the bundled
/// `resources/bootstrap_peers.toml`. `evm_rpc_url`/`evm_token_address`/
/// `evm_vault_address` together select a custom EVM network; otherwise the
/// client uses Arbitrum One.
#[tauri::command]
pub async fn init_autonomi_client(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    bootstrap_peers: Option<Vec<String>>,
    evm_rpc_url: Option<String>,
    evm_token_address: Option<String>,
    evm_vault_address: Option<String>,
) -> Result<bool, String> {
    if state.client.read().await.is_some() {
        return Ok(true);
    }
    // Don't start a second loop if one is already in flight.
    if matches!(
        *state.connection_status.read().await,
        ConnectionStatus::Connecting
    ) {
        return Ok(false);
    }

    let args = InitArgs {
        bootstrap_peers,
        evm_rpc_url,
        evm_token_address,
        evm_vault_address,
    };
    *state.last_init_args.write().await = Some(args.clone());

    let app_for_task = app.clone();
    tokio::spawn(async move { run_connection_loop(app_for_task, args).await });

    Ok(false)
}

/// Re-run the connection loop with the same arguments as the most recent
/// `init_autonomi_client` call. Used by the frontend Retry button on the
/// "could not connect" screen.
#[tauri::command]
pub async fn retry_autonomi_client(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
) -> Result<(), String> {
    if state.client.read().await.is_some() {
        return Ok(());
    }
    if matches!(
        *state.connection_status.read().await,
        ConnectionStatus::Connecting
    ) {
        return Ok(());
    }

    let args = state
        .last_init_args
        .read()
        .await
        .clone()
        .ok_or("init_autonomi_client has not been called yet")?;

    let app_for_task = app.clone();
    tokio::spawn(async move { run_connection_loop(app_for_task, args).await });
    Ok(())
}

/// Return the current connection status. Used by the frontend on first mount
/// to populate state; subsequent updates arrive via `connection-status` events.
#[tauri::command]
pub async fn get_connection_status(
    state: tauri::State<'_, AutonomiState>,
) -> Result<ConnectionStatus, String> {
    Ok(state.connection_status.read().await.clone())
}

/// Start an upload: encrypts file, collects quotes, emits quote event
/// with payment info for the frontend to pay via wallet.
///
/// The backend auto-selects wave-batch (<64 chunks) or merkle (>=64 chunks).
#[tauri::command]
pub async fn start_upload(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    request: StartUploadRequest,
) -> Result<(), String> {
    let client_lock = state.client.read().await;
    let client = client_lock
        .as_ref()
        .ok_or("Autonomi client not initialized")?;

    // Garbage-collect expired pending uploads before adding new ones
    state.gc_pending_uploads().await;

    // Single file per upload — frontend sends one file at a time
    let path = PathBuf::from(request.files.first().ok_or("No files provided")?);

    // Validate the path is a real file (prevents path traversal / symlink attacks)
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|e| format!("Invalid file path: {e}"))?;
    if !canonical.is_file() {
        return Err("Path is not a regular file".into());
    }
    let path = canonical;

    // Phase 1: Encrypt file and prepare chunks (gets quotes from network)
    let prepared = client
        .file_prepare_upload(&path)
        .await
        .map_err(|e| format!("Failed to prepare upload: {e}"))?;

    let quote_event = match &prepared.payment_info {
        ExternalPaymentInfo::WaveBatch {
            prepared_chunks: _,
            payment_intent,
        } => {
            let payments: Vec<RawPayment> = payment_intent
                .payments
                .iter()
                .map(|(quote_hash, rewards_addr, amount)| {
                    [
                        format!("0x{}", hex::encode(quote_hash)),
                        format!("{rewards_addr}"),
                        amount.to_string(),
                    ]
                })
                .collect();

            let total_cost = payment_intent.total_amount.to_string();
            let payment_required = !payments.is_empty();

            UploadQuoteEvent {
                upload_id: request.upload_id.clone(),
                payment_mode: "wave-batch".into(),
                payments,
                total_cost,
                payment_required,
                merkle_depth: None,
                merkle_pool_commitments: None,
                merkle_timestamp: None,
            }
        }
        ExternalPaymentInfo::Merkle {
            prepared_batch,
            chunk_contents: _,
            chunk_addresses: _,
        } => {
            let pool_commitments: Vec<SerializedPoolCommitment> = prepared_batch
                .pool_commitments
                .iter()
                .map(|pc| SerializedPoolCommitment {
                    pool_hash: format!("0x{}", hex::encode(pc.pool_hash)),
                    candidates: pc
                        .candidates
                        .iter()
                        .map(|c| SerializedCandidateNode {
                            rewards_address: format!("{}", c.rewards_address),
                            amount: c.price.to_string(),
                        })
                        .collect(),
                })
                .collect();

            UploadQuoteEvent {
                upload_id: request.upload_id.clone(),
                payment_mode: "merkle".into(),
                payments: vec![],
                total_cost: "0".into(),
                payment_required: true,
                merkle_depth: Some(prepared_batch.depth),
                merkle_pool_commitments: Some(pool_commitments),
                merkle_timestamp: Some(prepared_batch.merkle_payment_timestamp),
            }
        }
    };

    app.emit("upload-quote", &quote_event)
        .map_err(|e| format!("Failed to emit quote event: {e}"))?;

    // Capture the basename so confirm_upload can name the persisted datamap
    // after the original file.
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload".to_string());

    // Store prepared upload with timestamp for TTL cleanup
    state.pending_uploads.write().await.insert(
        request.upload_id,
        PendingUpload {
            prepared,
            created_at: std::time::Instant::now(),
            file_name,
        },
    );

    Ok(())
}

/// Confirm wave-batch upload after frontend has paid on-chain.
/// Accepts tx hashes from the external signer and uploads chunks.
#[tauri::command]
pub async fn confirm_upload(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    upload_id: String,
    tx_hashes: HashMap<String, String>,
) -> Result<UploadResult, String> {
    let client_lock = state.client.read().await;
    let client = client_lock
        .as_ref()
        .ok_or("Autonomi client not initialized")?;

    let PendingUpload {
        prepared,
        file_name,
        ..
    } = state
        .pending_uploads
        .write()
        .await
        .remove(&upload_id)
        .ok_or("No pending upload found for this ID")?;

    // Convert string hex hashes to typed hashes
    let tx_hash_map: HashMap<QuoteHash, TxHash> = tx_hashes
        .iter()
        .filter_map(|(quote_hex, tx_hex)| {
            let quote_bytes: [u8; 32] = hex::decode(quote_hex.trim_start_matches("0x"))
                .ok()?
                .try_into()
                .ok()?;
            let tx_bytes: [u8; 32] = hex::decode(tx_hex.trim_start_matches("0x"))
                .ok()?
                .try_into()
                .ok()?;
            Some((QuoteHash::from(quote_bytes), TxHash::from(tx_bytes)))
        })
        .collect();

    if tx_hash_map.len() != tx_hashes.len() {
        let failed = tx_hashes.len() - tx_hash_map.len();
        return Err(format!(
            "Failed to parse {failed} of {} transaction hashes",
            tx_hashes.len()
        ));
    }

    // Phase 2: Finalize upload with tx hashes and store chunks
    let result = client
        .finalize_upload(prepared, &tx_hash_map)
        .await
        .map_err(|e| format!("Upload failed: {e}"))?;

    let data_map_json = serde_json::to_string(&result.data_map)
        .map_err(|e| format!("Failed to serialize DataMap: {e}"))?;
    let address = format!("0x{:x}", Sha256::digest(data_map_json.as_bytes()));
    let data_map_file = crate::config::write_datamap_for(&file_name, &data_map_json)?
        .to_string_lossy()
        .into_owned();

    app.emit(
        "upload-progress",
        serde_json::json!({
            "upload_id": upload_id,
            "status": "complete",
            "chunks_stored": result.chunks_stored,
        }),
    )
    .ok();

    Ok(UploadResult {
        upload_id,
        data_map_json,
        address,
        chunks_stored: result.chunks_stored,
        data_map_file,
    })
}

/// Confirm merkle upload after frontend has paid on-chain.
/// Accepts the winner pool hash from the MerklePaymentMade event.
#[tauri::command]
pub async fn confirm_upload_merkle(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    upload_id: String,
    winner_pool_hash: String,
) -> Result<UploadResult, String> {
    let client_lock = state.client.read().await;
    let client = client_lock
        .as_ref()
        .ok_or("Autonomi client not initialized")?;

    let PendingUpload {
        prepared,
        file_name,
        ..
    } = state
        .pending_uploads
        .write()
        .await
        .remove(&upload_id)
        .ok_or("No pending upload found for this ID")?;

    let hash_bytes: [u8; 32] = hex::decode(winner_pool_hash.trim_start_matches("0x"))
        .map_err(|e| format!("Invalid winner pool hash: {e}"))?
        .try_into()
        .map_err(|_| "Winner pool hash must be exactly 32 bytes".to_string())?;

    let result = client
        .finalize_upload_merkle(prepared, hash_bytes)
        .await
        .map_err(|e| format!("Merkle upload failed: {e}"))?;

    let data_map_json = serde_json::to_string(&result.data_map)
        .map_err(|e| format!("Failed to serialize DataMap: {e}"))?;
    let address = format!("0x{:x}", Sha256::digest(data_map_json.as_bytes()));
    let data_map_file = crate::config::write_datamap_for(&file_name, &data_map_json)?
        .to_string_lossy()
        .into_owned();

    app.emit(
        "upload-progress",
        serde_json::json!({
            "upload_id": upload_id,
            "status": "complete",
            "chunks_stored": result.chunks_stored,
        }),
    )
    .ok();

    Ok(UploadResult {
        upload_id,
        data_map_json,
        address,
        chunks_stored: result.chunks_stored,
        data_map_file,
    })
}

/// Download a file from the network using a serialized DataMap.
#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    data_map_json: String,
    dest_path: String,
) -> Result<u64, String> {
    let client_lock = state.client.read().await;
    let client = client_lock
        .as_ref()
        .ok_or("Autonomi client not initialized")?;

    let data_map: DataMap =
        serde_json::from_str(&data_map_json).map_err(|e| format!("Invalid DataMap: {e}"))?;

    download_with_datamap(client, &data_map, &dest_path, &app).await
}

/// Fetch a DataMap from the network by its public chunk address, then
/// download the referenced file. Used by "download by address" when no
/// local datamap is known — the DataMap was stored publicly on the network
/// at the given 32-byte chunk address.
#[tauri::command]
pub async fn download_public(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    address: String,
    dest_path: String,
) -> Result<u64, String> {
    let client_lock = state.client.read().await;
    let client = client_lock
        .as_ref()
        .ok_or("Autonomi client not initialized")?;

    let bytes = hex::decode(address.trim().trim_start_matches("0x"))
        .map_err(|e| format!("Invalid address hex: {e}"))?;
    let addr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Address must be exactly 32 bytes (64 hex chars)".to_string())?;

    let data_map = client
        .data_map_fetch(&addr)
        .await
        .map_err(|e| format!("No data map at that address: {e}"))?;

    download_with_datamap(client, &data_map, &dest_path, &app).await
}

async fn download_with_datamap(
    client: &Client,
    data_map: &DataMap,
    dest_path: &str,
    app: &AppHandle,
) -> Result<u64, String> {
    let dest = expand_tilde(dest_path);

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {e}"))?;

        // Validate the resolved path is under an accessible directory
        let canonical_parent = tokio::fs::canonicalize(parent)
            .await
            .map_err(|e| format!("Invalid destination directory: {e}"))?;
        if !canonical_parent.is_dir() {
            return Err("Destination parent is not a directory".to_string());
        }
    }

    let bytes_written = client
        .file_download(data_map, &dest)
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    app.emit(
        "download-complete",
        serde_json::json!({
            "dest_path": dest.to_string_lossy(),
            "bytes_written": bytes_written,
        }),
    )
    .ok();

    Ok(bytes_written)
}

/// Expand a leading `~` or `~/` to the user's home directory. A literal
/// tilde in `PathBuf::from` is otherwise treated as a directory named `~`
/// in the current working directory — in dev mode that's `src-tauri/`,
/// which the Tauri watcher monitors and reacts to by restarting the app.
fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

/// Read a persisted DataMap file from disk and return its JSON contents.
///
/// Used by the "Download by datamap" flow: the user picks a `.datamap` file
/// via the OS file dialog, and the frontend forwards the returned JSON to
/// `download_file`. The path is trusted (chosen by the user through the
/// native picker); we only validate that the file parses as UTF-8.
#[tauri::command]
pub fn read_datamap_file(path: String) -> Result<String, String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("Invalid datamap path {path}: {e}"))?;
    if !canonical.is_file() {
        return Err(format!("Not a regular file: {path}"));
    }
    std::fs::read_to_string(&canonical).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Check if the data client is currently connected.
#[tauri::command]
pub async fn is_autonomi_connected(state: tauri::State<'_, AutonomiState>) -> Result<bool, String> {
    let client_lock = state.client.read().await;
    Ok(client_lock.is_some())
}
