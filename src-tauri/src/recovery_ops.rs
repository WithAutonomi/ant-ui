// ant-ui: recovery operations Tauri commands.
// List and display on-chain DataMap backups.

use ant_core::data::client::recovery::{list_recoveries, RecoveryEntry};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RecoveryListResponse {
    pub entries: Vec<RecoveryInfo>,
}

#[derive(Debug, Serialize)]
pub struct RecoveryInfo {
    pub tx_hash: String,
    pub block_number: u64,
    pub timestamp: String,
    pub folder_hash: String,
    pub datamap_size: usize,
}

/// List all recovery backups for the configured wallet.
#[tauri::command]
pub async fn list_recovery_entries(wallet: String) -> Result<RecoveryListResponse, String> {
    let entries = list_recoveries(&wallet, "https://arb1.arbitrum.io/rpc").await
        .map_err(|e| format!("list: {e}"))?;

    let infos: Vec<RecoveryInfo> = entries.into_iter().map(|e| RecoveryInfo {
        tx_hash: e.tx_hash,
        block_number: e.block_number,
        timestamp: e.timestamp,
        folder_hash: e.folder_hash,
        datamap_size: e.datamap_size,
    }).collect();

    Ok(RecoveryListResponse { entries: infos })
}
