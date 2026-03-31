use ant_core::data::{Client, ClientConfig, DataMap, EvmNetwork, PreparedUpload};
use evmlib::common::{QuoteHash, TxHash};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

// ── Shared state managed by Tauri ──

pub struct AutonomiState {
    pub client: RwLock<Option<Client>>,
    pub pending_uploads: RwLock<HashMap<String, PreparedUpload>>,
}

impl AutonomiState {
    pub fn new() -> Self {
        Self {
            client: RwLock::new(None),
            pending_uploads: RwLock::new(HashMap::new()),
        }
    }
}

// ── Types exchanged with the frontend ──

/// Payment tuple sent to the frontend: [quoteHash, rewardsAddress, amount]
pub type RawPayment = [String; 3];

#[derive(Serialize, Clone)]
pub struct UploadQuoteEvent {
    pub upload_id: String,
    pub payments: Vec<RawPayment>,
    pub total_cost: String,
    pub payment_required: bool,
}

#[derive(Serialize)]
pub struct UploadResult {
    pub upload_id: String,
    /// Serialized DataMap (JSON) — needed for later download.
    pub data_map_json: String,
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
/// `bootstrap_peers`: list of "host:port" strings. If empty, uses defaults.
/// `evm_network`: "arbitrum-one" or "arbitrum-sepolia" (for price queries).
#[tauri::command]
pub async fn init_autonomi_client(
    state: tauri::State<'_, AutonomiState>,
    bootstrap_peers: Option<Vec<String>>,
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

    // Set up EVM network for price queries (external signer flow — no wallet needed)
    let evm_network = EvmNetwork::ArbitrumOne;
    let client = client.with_evm_network(evm_network);

    *client_lock = Some(client);
    Ok(true)
}

/// Start an upload: encrypts file, collects quotes, emits quote event
/// with payment tuples for the frontend to pay via wallet.
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

    let path = PathBuf::from(
        request.files.first().ok_or("No files provided")?,
    );

    // Phase 1: Encrypt file and prepare chunks (gets quotes from network)
    let prepared = client
        .file_prepare_upload(&path)
        .await
        .map_err(|e| format!("Failed to prepare upload: {e}"))?;

    // Extract payment tuples for the frontend
    let payments: Vec<RawPayment> = prepared
        .payment_intent
        .payments
        .iter()
        .map(|(quote_hash, rewards_addr, amount)| {
            [
                format!("{quote_hash:?}"),
                format!("{rewards_addr:?}"),
                amount.to_string(),
            ]
        })
        .collect();

    let total_cost = prepared.payment_intent.total_amount.to_string();
    let payment_required = !payments.is_empty();

    let quote_event = UploadQuoteEvent {
        upload_id: request.upload_id.clone(),
        payments,
        total_cost,
        payment_required,
    };

    app.emit("upload-quote", &quote_event)
        .map_err(|e| format!("Failed to emit quote event: {e}"))?;

    // Store prepared upload for finalization after payment
    state
        .pending_uploads
        .write()
        .await
        .insert(request.upload_id, prepared);

    Ok(())
}

/// Confirm upload after frontend has paid on-chain.
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

    let prepared = state
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

    // Phase 2: Finalize upload with tx hashes and store chunks
    let result = client
        .finalize_upload(prepared, &tx_hash_map)
        .await
        .map_err(|e| format!("Upload failed: {e}"))?;

    // Serialize the DataMap for persistence (needed for later download)
    let data_map_json = serde_json::to_string(&result.data_map)
        .map_err(|e| format!("Failed to serialize DataMap: {e}"))?;

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

    let data_map: DataMap = serde_json::from_str(&data_map_json)
        .map_err(|e| format!("Invalid DataMap: {e}"))?;

    let dest = PathBuf::from(&dest_path);

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {e}"))?;
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
pub async fn is_autonomi_connected(
    state: tauri::State<'_, AutonomiState>,
) -> Result<bool, String> {
    let client_lock = state.client.read().await;
    Ok(client_lock.is_some())
}
