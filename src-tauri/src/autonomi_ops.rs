use ant_core::data::{
    Client, ClientConfig, CustomNetwork, DataMap, DownloadEvent, EvmNetwork, ExternalPaymentInfo,
    PaymentMode, PreparedUpload, UploadCostEstimate, UploadEvent, Visibility,
};
use evmlib::common::{QuoteHash, TxHash};
use evmlib::wallet::Wallet;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, RwLock};

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
    /// Optional hex-encoded private key. When present (devnet manifest path
    /// only — never WalletConnect), the Rust client gets a wallet attached
    /// via `Client::with_wallet`, unlocking the wallet-flow upload path.
    pub wallet_private_key: Option<String>,
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

/// One prepared merkle sub-batch the external signer pays with a single
/// `payForMerkleTree` transaction (ADR-0003 in ant-client). Uploads above
/// `MAX_LEAVES` chunks prepare as several of these; the frontend collects
/// one winner hash per batch, in order.
#[derive(Serialize, Clone)]
pub struct SerializedMerkleBatch {
    pub depth: u8,
    pub pool_commitments: Vec<SerializedPoolCommitment>,
    pub timestamp: u64,
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
    // ── Merkle field (None for wave-batch): one entry per sub-batch ──
    pub merkle_batches: Option<Vec<SerializedMerkleBatch>>,
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
    /// On-network chunk address of the published `DataMap`, set only for
    /// public uploads. A shareable 32-byte hex string anyone can pass to
    /// `download_public` to retrieve the file without a local datamap.
    pub public_address: Option<String>,
}

#[derive(Deserialize)]
pub struct StartUploadRequest {
    pub files: Vec<String>,
    pub upload_id: String,
    /// Upload visibility — "private" (default) keeps the data map local,
    /// "public" bundles the serialized data map into the payment batch so
    /// a single on-network chunk address can be shared for retrieval.
    #[serde(default)]
    pub visibility: Option<String>,
}

// ── Progress forwarders ──
//
// Spawn a tokio task that drains an mpsc receiver of UploadEvent / DownloadEvent
// and re-emits them as Tauri events. The frontend listens for `upload-progress`
// / `download-progress` keyed by `transfer_id` and updates the row in place.
//
// Channels are bounded — the receiver task is the only consumer, so back-pressure
// just slows the upload/download loop. The senders inside ant-core use try_send
// for high-volume events so we never block the network futures on a busy UI.

/// Wire-shape of the `upload-progress` Tauri event. The `percent` field is
/// pre-computed so the UI can drive the progress bar without re-deriving it,
/// and is `None` while the chunk total is still unknown (encryption phase).
#[derive(Serialize, Clone, Debug)]
struct UploadProgressPayload {
    transfer_id: String,
    stage: &'static str,
    done: usize,
    total: Option<usize>,
    percent: Option<f32>,
}

#[derive(Serialize, Clone, Debug)]
struct DownloadProgressPayload {
    transfer_id: String,
    stage: &'static str,
    done: usize,
    total: Option<usize>,
    percent: Option<f32>,
}

/// Map an UploadEvent into the wire payload. Quoting is treated as the first
/// half of the bar (0..50%) and storage as the second half (50..100%) so the
/// user sees continuous forward motion across both phases.
fn map_upload_event(transfer_id: &str, ev: UploadEvent) -> Option<UploadProgressPayload> {
    let id = transfer_id.to_string();
    Some(match ev {
        UploadEvent::Encrypting { chunks_done } => UploadProgressPayload {
            transfer_id: id,
            stage: "encrypting",
            done: chunks_done,
            total: None,
            percent: None,
        },
        UploadEvent::Encrypted { total_chunks } => UploadProgressPayload {
            transfer_id: id,
            stage: "quoting",
            done: 0,
            total: Some(total_chunks),
            percent: Some(0.0),
        },
        UploadEvent::QuotingChunks { .. } => return None,
        UploadEvent::ChunkQuoted { quoted, total } => UploadProgressPayload {
            transfer_id: id,
            stage: "quoting",
            done: quoted,
            total: Some(total),
            percent: Some(percent_of(quoted, total) * 0.5),
        },
        UploadEvent::ChunkStored { stored, total } => UploadProgressPayload {
            transfer_id: id,
            stage: "uploading",
            done: stored,
            total: Some(total),
            percent: Some(50.0 + percent_of(stored, total) * 0.5),
        },
    })
}

fn map_download_event(transfer_id: &str, ev: DownloadEvent) -> DownloadProgressPayload {
    let id = transfer_id.to_string();
    match ev {
        DownloadEvent::ResolvingDataMap { total_map_chunks } => DownloadProgressPayload {
            transfer_id: id,
            stage: "resolving",
            done: 0,
            total: Some(total_map_chunks),
            percent: None,
        },
        DownloadEvent::MapChunkFetched { fetched } => DownloadProgressPayload {
            transfer_id: id,
            stage: "resolving",
            done: fetched,
            total: None,
            percent: None,
        },
        DownloadEvent::DataMapResolved { total_chunks } => DownloadProgressPayload {
            transfer_id: id,
            stage: "downloading",
            done: 0,
            total: Some(total_chunks),
            percent: Some(0.0),
        },
        DownloadEvent::ChunksFetched { fetched, total } => DownloadProgressPayload {
            transfer_id: id,
            stage: "downloading",
            done: fetched,
            total: Some(total),
            percent: Some(percent_of(fetched, total)),
        },
    }
}

fn percent_of(done: usize, total: usize) -> f32 {
    if total == 0 {
        0.0
    } else {
        (done as f32 / total as f32) * 100.0
    }
}

/// Spawn a forwarder task that re-emits UploadEvents as `upload-progress`.
/// Returns the sender end — drop it (or let the upload future drop it) to
/// shut the forwarder down cleanly.
fn spawn_upload_progress_forwarder(
    app: AppHandle,
    transfer_id: String,
) -> mpsc::Sender<UploadEvent> {
    let (tx, mut rx) = mpsc::channel::<UploadEvent>(64);
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if let Some(payload) = map_upload_event(&transfer_id, ev) {
                let _ = app.emit("upload-progress", &payload);
            }
        }
    });
    tx
}

fn spawn_download_progress_forwarder(
    app: AppHandle,
    transfer_id: String,
) -> mpsc::Sender<DownloadEvent> {
    let (tx, mut rx) = mpsc::channel::<DownloadEvent>(64);
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            let payload = map_download_event(&transfer_id, ev);
            let _ = app.emit("download-progress", &payload);
        }
    });
    tx
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

/// Background task: run a single `Client::connect` and emit status
/// transitions via `set_connection_status`. Matches `ant-cli`'s behavior —
/// no per-attempt timeout and no retry loop. The saorsa-core bootstrap
/// loop inside `Client::connect` walks peers sequentially (one `.await`
/// per peer with a 15s identity-exchange timeout each), so cold start
/// can take 1-4 minutes on a fresh connect. If it genuinely wedges, the
/// user can hit Retry (which calls `retry_autonomi_client`) or restart
/// the app.
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

    // `allow_loopback` changes the saorsa-transport QUIC handshake variant;
    // enabling it on a client that dials remote peers makes those peers
    // reject the connection (`found 0 peers` despite a successful dial).
    // Enable only when the bootstrap peers themselves are on loopback —
    // i.e. a genuine local Anvil + local ant-node setup. Remote devnets
    // (a Sepolia manifest with public DigitalOcean peers) must not flip
    // this on just because a custom EVM RPC is configured. Matches the
    // `--allow-loopback` semantics in ant-cli, which is explicit-opt-in.
    let allow_loopback = peers.iter().any(|p| p.ip().is_loopback());

    set_connection_status(&app, ConnectionStatus::Connecting).await;

    let client_config = ClientConfig {
        allow_loopback,
        ..ClientConfig::default()
    };

    match Client::connect(&peers, client_config).await {
        Ok(client) => {
            let peer_count = client.network().connected_peers().await.len();
            // When the manifest supplies a wallet key, attach a wallet so the
            // Rust client can drive payments end-to-end via evmlib (the same
            // path ant-cli uses). This bypasses the JS-side wagmi flow for
            // direct-key mode — useful when devops manifests and on-chain
            // contracts can drift, since one Rust path is easier to keep
            // aligned than two parallel client implementations. Skip the
            // wallet when no key is provided (WalletConnect / production):
            // those flows still go through the external-signer path.
            let client = if let Some(key) = args.wallet_private_key.as_deref() {
                let key = if let Some(rest) = key.strip_prefix("0x") {
                    rest
                } else {
                    key
                };
                match Wallet::new_from_private_key(evm_network.clone(), key) {
                    Ok(wallet) => {
                        eprintln!("Wallet attached to Client (address {})", wallet.address());
                        client.with_wallet(wallet)
                    }
                    Err(e) => {
                        eprintln!(
                            "Wallet from manifest key rejected, falling back to external-signer mode: {e}"
                        );
                        client.with_evm_network(evm_network)
                    }
                }
            } else {
                client.with_evm_network(evm_network)
            };
            *app.state::<AutonomiState>().client.write().await = Some(client);
            eprintln!("Autonomi connect succeeded ({peer_count} peers)");
            set_connection_status(&app, ConnectionStatus::Connected).await;
        }
        Err(e) => {
            let reason = format!("connect failed: {e}");
            eprintln!("Autonomi connect: {reason}");
            set_connection_status(&app, ConnectionStatus::Failed { reason }).await;
        }
    }
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
    wallet_private_key: Option<String>,
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
        wallet_private_key,
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

    let visibility = match request.visibility.as_deref() {
        Some("public") => Visibility::Public,
        _ => Visibility::Private,
    };

    // Phase 1: Encrypt file and prepare chunks (gets quotes from network).
    // For a public upload, ant-core bundles the serialized DataMap into the
    // payment batch as one extra chunk so it's paid for and stored alongside
    // the data chunks. The resulting chunk address is surfaced via
    // `FileUploadResult.data_map_address` after finalize.
    // The forwarder turns ant-core's UploadEvent stream (Encrypting / Encrypted /
    // ChunkQuoted) into Tauri `upload-progress` events keyed by the row id.
    let progress_tx = spawn_upload_progress_forwarder(app.clone(), request.upload_id.clone());
    let prepared = client
        .file_prepare_upload_with_progress(&path, visibility, Some(progress_tx))
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
                merkle_batches: None,
            }
        }
        ExternalPaymentInfo::Merkle {
            prepared_batches, ..
        } => {
            let batches: Vec<SerializedMerkleBatch> = prepared_batches
                .iter()
                .map(|batch| SerializedMerkleBatch {
                    depth: batch.depth,
                    pool_commitments: batch
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
                        .collect(),
                    timestamp: batch.merkle_payment_timestamp,
                })
                .collect();

            UploadQuoteEvent {
                upload_id: request.upload_id.clone(),
                payment_mode: "merkle".into(),
                payments: vec![],
                total_cost: "0".into(),
                payment_required: true,
                merkle_batches: Some(batches),
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

/// Estimate the cost of uploading a file without parking any chunks.
///
/// Wraps `Client::estimate_upload_cost` (ant-core #44): encrypts the file to a
/// local spill, samples a single network quote for a representative chunk, and
/// extrapolates total storage cost. Gas is a documented heuristic. No wallet
/// required, no `PreparedUpload` parked in `pending_uploads`.
///
/// `mode` accepts "auto" (default), "single", or "merkle". Unknown values
/// fall back to "auto".
#[tauri::command]
pub async fn estimate_file_cost(
    state: tauri::State<'_, AutonomiState>,
    path: String,
    mode: Option<String>,
) -> Result<UploadCostEstimate, String> {
    let client_lock = state.client.read().await;
    let client = client_lock
        .as_ref()
        .ok_or("Autonomi client not initialized")?;

    let path_buf = PathBuf::from(&path);
    let canonical = tokio::fs::canonicalize(&path_buf)
        .await
        .map_err(|e| format!("Invalid file path: {e}"))?;
    if !canonical.is_file() {
        return Err("Path is not a regular file".into());
    }

    let payment_mode = match mode.as_deref().unwrap_or("auto") {
        "single" => PaymentMode::Single,
        "merkle" => PaymentMode::Merkle,
        _ => PaymentMode::Auto,
    };

    client
        .estimate_upload_cost(&canonical, payment_mode, None)
        .await
        .map_err(|e| format!("Failed to estimate upload cost: {e}"))
}

/// Reject a finalize result that stored fewer chunks than the file needs.
///
/// ant-core's external-signer merkle path reports quorum shortfalls via
/// `chunks_failed` on an `Ok` result instead of an error
/// (WithAutonomi/ant-client#166), so without this check a partially stored —
/// and unretrievable — file would be reported to the user as complete.
/// Called after the DataMap is persisted: payment has already happened, and
/// re-uploading the same file skips chunks that are already stored.
fn ensure_all_chunks_stored(
    chunks_stored: usize,
    chunks_failed: usize,
    total_chunks: usize,
    data_map_file: &str,
) -> Result<(), String> {
    if chunks_failed == 0 && chunks_stored >= total_chunks {
        return Ok(());
    }
    Err(format!(
        "Upload incomplete: {chunks_stored} of {total_chunks} chunks reached the network \
         ({chunks_failed} failed after retries), so the file is not retrievable yet. \
         Payment was made and the DataMap was saved to {data_map_file}; uploading the \
         same file again will store only the missing chunks."
    ))
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

    // Phase 2: Finalize upload with tx hashes and store chunks.
    // The forwarder emits ChunkStored events as each chunk is stored on the
    // network so the row's bar climbs from 50% to 100%.
    let progress_tx = spawn_upload_progress_forwarder(app.clone(), upload_id.clone());
    let result = client
        .finalize_upload_with_progress(prepared, &tx_hash_map, Some(progress_tx))
        .await
        .map_err(|e| format!("Upload failed: {e}"))?;

    let data_map_json = serde_json::to_string(&result.data_map)
        .map_err(|e| format!("Failed to serialize DataMap: {e}"))?;
    let address = format!("0x{:x}", Sha256::digest(data_map_json.as_bytes()));
    let data_map_file = crate::config::write_datamap_for(&file_name, &result.data_map)?
        .to_string_lossy()
        .into_owned();
    ensure_all_chunks_stored(
        result.chunks_stored,
        result.chunks_failed,
        result.total_chunks,
        &data_map_file,
    )?;
    let public_address = result
        .data_map_address
        .map(|addr| format!("0x{}", hex::encode(addr)));

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
        public_address,
    })
}

/// Confirm merkle upload after frontend has paid on-chain.
/// Accepts one winner pool hash (from each `MerklePaymentMade` event) per
/// prepared sub-batch, in batch order; `None` marks a batch the user never
/// paid (abandoned mid-flow). Paid batches store; unpaid batches' chunks are
/// reported through the incomplete-upload error, so partial payments still
/// make forward progress (ADR-0003 in ant-client).
#[tauri::command]
pub async fn confirm_upload_merkle(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    upload_id: String,
    winner_pool_hashes: Vec<Option<String>>,
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

    let hashes: Vec<Option<[u8; 32]>> = winner_pool_hashes
        .iter()
        .map(|entry| {
            entry
                .as_ref()
                .map(|hash| {
                    let bytes: [u8; 32] = hex::decode(hash.trim_start_matches("0x"))
                        .map_err(|e| format!("Invalid winner pool hash: {e}"))?
                        .try_into()
                        .map_err(|_| "Winner pool hash must be exactly 32 bytes".to_string())?;
                    Ok::<[u8; 32], String>(bytes)
                })
                .transpose()
        })
        .collect::<Result<_, _>>()?;

    let progress_tx = spawn_upload_progress_forwarder(app.clone(), upload_id.clone());
    let result = client
        .finalize_upload_merkle_multi_with_progress(prepared, hashes, Some(progress_tx))
        .await
        .map_err(|e| format!("Merkle upload failed: {e}"))?;

    let data_map_json = serde_json::to_string(&result.data_map)
        .map_err(|e| format!("Failed to serialize DataMap: {e}"))?;
    let address = format!("0x{:x}", Sha256::digest(data_map_json.as_bytes()));
    let data_map_file = crate::config::write_datamap_for(&file_name, &result.data_map)?
        .to_string_lossy()
        .into_owned();
    ensure_all_chunks_stored(
        result.chunks_stored,
        result.chunks_failed,
        result.total_chunks,
        &data_map_file,
    )?;
    let public_address = result
        .data_map_address
        .map(|addr| format!("0x{}", hex::encode(addr)));

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
        public_address,
    })
}

/// Hot-attach a wallet to the running Client.
///
/// Used by the runtime direct-key path (Settings → Connect with private key)
/// where the user supplies a key after the app already booted and called
/// `init_autonomi_client` without one. Without this, uploads in that path
/// hit `wallet_upload` against a wallet-less client and get an error.
///
/// Builds the EVM network the same way `init_autonomi_client` does: when an
/// `evm_rpc_url` is supplied, all three custom fields are required and a
/// `Custom` network is built; otherwise the `ArbitrumOne` preset is used so
/// the wallet sits on the same chain as the bootstrap peers (mainnet by
/// default when no manifest is present).
///
/// `Client::with_wallet` consumes the client by value, so we take it out of
/// the `RwLock<Option<Client>>`, transform it, and put it back. The network
/// connection (saorsa-transport peers) is preserved — no re-bootstrap.
#[tauri::command]
pub async fn attach_wallet(
    state: tauri::State<'_, AutonomiState>,
    wallet_private_key: String,
    evm_rpc_url: Option<String>,
    evm_token_address: Option<String>,
    evm_vault_address: Option<String>,
) -> Result<(), String> {
    let evm_network = if let Some(rpc_url) = &evm_rpc_url {
        let token = evm_token_address
            .as_deref()
            .ok_or("evm_token_address required when evm_rpc_url is provided")?;
        let vault = evm_vault_address
            .as_deref()
            .ok_or("evm_vault_address required when evm_rpc_url is provided")?;
        EvmNetwork::Custom(CustomNetwork::new(rpc_url, token, vault))
    } else {
        EvmNetwork::ArbitrumOne
    };

    let key = wallet_private_key
        .strip_prefix("0x")
        .unwrap_or(&wallet_private_key);
    let wallet = Wallet::new_from_private_key(evm_network, key)
        .map_err(|e| format!("Failed to build wallet from private key: {e}"))?;
    let address = wallet.address();

    let mut client_lock = state.client.write().await;
    let client = client_lock
        .take()
        .ok_or("Autonomi client not initialized — wait for connection before attaching a wallet")?;
    *client_lock = Some(client.with_wallet(wallet));

    eprintln!("Wallet attached to Client (address {address})");
    Ok(())
}

/// One-shot wallet-flow upload for direct-key mode.
///
/// Uses ant-core's `Client::file_upload` (the wallet flow that ant-cli runs)
/// instead of the two-phase external-signer dance (`start_upload` → frontend
/// payForQuotes → `confirm_upload`). The Rust client must have been
/// initialised with `wallet_private_key` so it has an attached wallet.
///
/// `upload_id` is the frontend-supplied tracking id, included in the result
/// so the upload row can be reconciled on receive.
#[tauri::command]
pub async fn wallet_upload(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    upload_id: String,
    file_path: String,
    visibility: Option<String>,
) -> Result<UploadResult, String> {
    let client_lock = state.client.read().await;
    let client = client_lock
        .as_ref()
        .ok_or("Autonomi client not initialized")?;
    if client.wallet().is_none() {
        return Err(
            "Autonomi client has no wallet — wallet_upload requires direct-key (manifest) mode"
                .into(),
        );
    }

    let path = PathBuf::from(&file_path);
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|e| format!("Invalid file path: {e}"))?;
    if !canonical.is_file() {
        return Err("Path is not a regular file".into());
    }
    let file_name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload".to_string());

    let progress_tx = spawn_upload_progress_forwarder(app.clone(), upload_id.clone());

    // Public uploads bundle the serialized DataMap into the payment batch so
    // it's stored on-network; the resulting chunk address comes back via
    // `FileUploadResult.data_map_address` and is surfaced as `public_address`.
    // Private uploads keep the DataMap local only. Default to private.
    let is_public = matches!(visibility.as_deref(), Some("public"));
    let result = if is_public {
        client
            .file_upload_public_with_progress(&canonical, PaymentMode::Auto, Some(progress_tx))
            .await
    } else {
        client
            .file_upload_with_progress(&canonical, PaymentMode::Auto, Some(progress_tx))
            .await
    }
    .map_err(|e| format!("Upload failed: {e}"))?;

    let data_map_json = serde_json::to_string(&result.data_map)
        .map_err(|e| format!("Failed to serialize DataMap: {e}"))?;
    let address = format!("0x{:x}", Sha256::digest(data_map_json.as_bytes()));
    let data_map_file = crate::config::write_datamap_for(&file_name, &result.data_map)?
        .to_string_lossy()
        .into_owned();
    ensure_all_chunks_stored(
        result.chunks_stored,
        result.chunks_failed,
        result.total_chunks,
        &data_map_file,
    )?;
    let public_address = result
        .data_map_address
        .map(|addr| format!("0x{}", hex::encode(addr)));

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
        public_address,
    })
}

/// Download a file from the network using a serialized DataMap.
#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    transfer_id: String,
    data_map_json: String,
    dest_path: String,
) -> Result<u64, String> {
    let client_lock = state.client.read().await;
    let client = client_lock
        .as_ref()
        .ok_or("Autonomi client not initialized")?;

    let data_map: DataMap =
        serde_json::from_str(&data_map_json).map_err(|e| format!("Invalid DataMap: {e}"))?;

    download_with_datamap(client, &data_map, &dest_path, &app, transfer_id).await
}

/// Fetch a DataMap from the network by its public chunk address, then
/// download the referenced file. Used by "download by address" when no
/// local datamap is known — the DataMap was stored publicly on the network
/// at the given 32-byte chunk address.
#[tauri::command]
pub async fn download_public(
    app: AppHandle,
    state: tauri::State<'_, AutonomiState>,
    transfer_id: String,
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

    download_with_datamap(client, &data_map, &dest_path, &app, transfer_id).await
}

async fn download_with_datamap(
    client: &Client,
    data_map: &DataMap,
    dest_path: &str,
    app: &AppHandle,
    transfer_id: String,
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

    let progress_tx = spawn_download_progress_forwarder(app.clone(), transfer_id);

    let bytes_written = client
        .file_download_with_progress(data_map, &dest, Some(progress_tx))
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
/// `download_file`. Delegates format detection to `ant_core::data::read_datamap`
/// (msgpack canonical, JSON legacy — sniffed by first byte), then re-encodes as
/// JSON so the JS side keeps a single `data_map_json` contract.
#[tauri::command]
pub fn read_datamap_file(path: String) -> Result<String, String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("Invalid datamap path {path}: {e}"))?;
    if !canonical.is_file() {
        return Err(format!("Not a regular file: {path}"));
    }
    let data_map = ant_core::data::read_datamap(&canonical)
        .map_err(|e| format!("Failed to read datamap at {path}: {e}"))?;
    serde_json::to_string(&data_map).map_err(|e| format!("Failed to encode datamap at {path}: {e}"))
}

/// Fetch a persisted DataMap from an `http(s)://` URL and return its JSON.
///
/// The URL-based sibling of [`read_datamap_file`]: used by the Download dialog
/// when the user pastes a URL ending in `.datamap`. The fetched bytes are only
/// a DataMap (a list of chunk addresses); the file's data is still pulled from
/// the Autonomi network by `download_file`, so a hostile URL cannot substitute
/// file content — at worst it points the download at other on-network chunks,
/// no different from any datamap the user might paste.
///
/// Guardrails: a 15s total timeout and a 5 MiB streamed cap. A datamap is a few
/// KB, so anything larger is treated as a wrong/hostile URL, not a datamap. The
/// cap is enforced while streaming so a server with no (or a lying)
/// `Content-Length` can't balloon memory.
#[tauri::command]
pub async fn read_datamap_url(url: String) -> Result<String, String> {
    const MAX_BYTES: usize = 5 * 1024 * 1024;

    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Datamap URL must start with http:// or https://".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch datamap: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Datamap URL returned HTTP {}",
            resp.status().as_u16()
        ));
    }
    // Fast-fail when the server declares an oversized body up front.
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_BYTES {
            return Err(format!("Datamap response too large ({len} bytes)"));
        }
    }

    // Stream the body, enforcing the cap as we go — never trust Content-Length.
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Failed to read datamap response: {e}"))?
    {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err(format!("Datamap response too large (> {MAX_BYTES} bytes)"));
        }
        bytes.extend_from_slice(&chunk);
    }

    // Reuse ant-core's format-sniffing reader (msgpack canonical / legacy JSON,
    // plus any future envelope) by round-tripping through a temp file keyed on
    // the content hash so concurrent fetches don't collide.
    let digest = Sha256::digest(&bytes);
    let tmp = std::env::temp_dir().join(format!("ant-gui-datamap-{digest:x}.datamap"));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("Failed to buffer datamap: {e}"))?;
    let parsed = ant_core::data::read_datamap(&tmp);
    let _ = std::fs::remove_file(&tmp);
    let data_map = parsed.map_err(|e| format!("Not a valid datamap: {e}"))?;

    serde_json::to_string(&data_map).map_err(|e| format!("Failed to encode datamap: {e}"))
}

/// Check if the data client is currently connected.
#[tauri::command]
pub async fn is_autonomi_connected(state: tauri::State<'_, AutonomiState>) -> Result<bool, String> {
    let client_lock = state.client.read().await;
    Ok(client_lock.is_some())
}

#[cfg(test)]
mod tests {
    use super::ensure_all_chunks_stored;

    #[test]
    fn complete_upload_passes() {
        assert!(ensure_all_chunks_stored(100, 0, 100, "/cfg/a.datamap").is_ok());
    }

    #[test]
    fn quorum_shortfall_is_rejected_with_counts_and_datamap_path() {
        let err = ensure_all_chunks_stored(97, 3, 100, "/cfg/a.datamap").unwrap_err();
        assert!(err.contains("97 of 100"), "unexpected message: {err}");
        assert!(err.contains("3 failed"), "unexpected message: {err}");
        assert!(err.contains("/cfg/a.datamap"), "unexpected message: {err}");
    }

    #[test]
    fn shortfall_with_zero_failed_count_is_still_rejected() {
        // chunks_failed can be 0 while chunks_stored still falls short (a core
        // path that aborts without accounting every chunk) — never report
        // such an upload as complete.
        assert!(ensure_all_chunks_stored(99, 0, 100, "/cfg/a.datamap").is_err());
    }
}
