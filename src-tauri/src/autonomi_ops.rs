use ant_core::data::{
    Client, ClientConfig, CustomNetwork, DataMap, EvmNetwork, ExternalPaymentInfo, PreparedUpload,
};
use evmlib::common::{QuoteHash, TxHash};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

// ── Shared state managed by Tauri ──

pub struct AutonomiState {
    pub client: RwLock<Option<Client>>,
    pub pending_uploads: RwLock<HashMap<String, (PreparedUpload, std::time::Instant)>>,
}

/// Pending uploads older than this are garbage-collected.
const PENDING_UPLOAD_TTL: std::time::Duration = std::time::Duration::from_secs(30 * 60);

impl AutonomiState {
    pub fn new() -> Self {
        Self {
            client: RwLock::new(None),
            pending_uploads: RwLock::new(HashMap::new()),
        }
    }

    /// Remove pending uploads that have expired.
    pub async fn gc_pending_uploads(&self) {
        let cutoff = std::time::Instant::now() - PENDING_UPLOAD_TTL;
        self.pending_uploads
            .write()
            .await
            .retain(|_, (_, created_at)| *created_at > cutoff);
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
}

#[derive(Deserialize)]
pub struct StartUploadRequest {
    pub files: Vec<String>,
    pub upload_id: String,
}

// ── Tauri commands ──

/// Initialize the data client. Connects to the Autonomi network via bootstrap peers.
///
/// When `evm_rpc_url` is provided, uses a custom EVM network (for devnet/testnet).
/// Otherwise defaults to Arbitrum One.
#[tauri::command]
pub async fn init_autonomi_client(
    state: tauri::State<'_, AutonomiState>,
    bootstrap_peers: Option<Vec<String>>,
    evm_rpc_url: Option<String>,
    evm_token_address: Option<String>,
    evm_vault_address: Option<String>,
) -> Result<bool, String> {
    let mut client_lock = state.client.write().await;
    if client_lock.is_some() {
        return Ok(true);
    }

    let peers: Vec<std::net::SocketAddr> = bootstrap_peers
        .unwrap_or_default()
        .iter()
        .filter_map(|s| s.parse().ok())
        .collect();

    if peers.is_empty() {
        return Err("No bootstrap peers provided".into());
    }

    let config = ClientConfig::default();
    let client = Client::connect(&peers, config)
        .await
        .map_err(|e| format!("Failed to connect to Autonomi network: {e}"))?;

    let evm_network = if let Some(rpc_url) = evm_rpc_url {
        let token = evm_token_address.ok_or("evm_token_address required with evm_rpc_url")?;
        let vault = evm_vault_address.ok_or("evm_vault_address required with evm_rpc_url")?;
        EvmNetwork::Custom(CustomNetwork::new(&rpc_url, &token, &vault))
    } else {
        EvmNetwork::ArbitrumOne
    };

    let client = client.with_evm_network(evm_network);

    *client_lock = Some(client);
    Ok(true)
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

    // Store prepared upload with timestamp for TTL cleanup
    state
        .pending_uploads
        .write()
        .await
        .insert(request.upload_id, (prepared, std::time::Instant::now()));

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

    let (prepared, _created_at) = state
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

    let (prepared, _created_at) = state
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

    let dest = PathBuf::from(&dest_path);

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
        .file_download(&data_map, &dest)
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    app.emit(
        "download-complete",
        serde_json::json!({
            "dest_path": dest_path,
            "bytes_written": bytes_written,
        }),
    )
    .ok();

    Ok(bytes_written)
}

/// Check if the data client is currently connected.
#[tauri::command]
pub async fn is_autonomi_connected(state: tauri::State<'_, AutonomiState>) -> Result<bool, String> {
    let client_lock = state.client.read().await;
    Ok(client_lock.is_some())
}
