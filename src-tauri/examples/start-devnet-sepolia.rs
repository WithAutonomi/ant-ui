//! Start a local devnet with 25 nodes using Arbitrum Sepolia for payments.
//!
//! Uses the existing deployed contracts on Arbitrum Sepolia (from evmlib).
//! Nodes verify payments against the real Sepolia PaymentVault.
//!
//! # Usage
//!
//! ```powershell
//! cd src-tauri
//! cargo run --release --example start-devnet-sepolia
//! ```

use ant_core::data::EvmNetwork;
use ant_node::devnet::{Devnet, DevnetConfig};
use std::path::PathBuf;

fn config_dir() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("autonomi")
        .join("ant-gui");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(8 * 1024 * 1024)
        .build()?;

    runtime.block_on(async_main())
}

async fn async_main() -> Result<(), Box<dyn std::error::Error>> {
    let evm_network = EvmNetwork::ArbitrumSepoliaTest;

    let rpc_url = evm_network.rpc_url().to_string();
    let token_addr = format!("{}", evm_network.payment_token_address());
    let vault_addr = format!("{}", evm_network.payment_vault_address());

    println!("Starting Sepolia devnet...");
    println!("RPC:   {rpc_url}");
    println!("Token: {token_addr}");
    println!("Vault: {vault_addr}");

    let mut config = DevnetConfig::default(); // 25 nodes
    config.evm_network = Some(evm_network.clone());

    println!("Starting {} nodes...", config.node_count);

    let mut devnet = Devnet::new(config).await?;
    devnet.start().await?;

    let bootstrap_addrs: Vec<String> = devnet
        .bootstrap_addrs()
        .iter()
        .filter_map(|ma| {
            let s = ma.to_string();
            let parts: Vec<&str> = s.split('/').collect();
            let ip = parts.iter().position(|&p| p == "ip4").and_then(|i| parts.get(i + 1))?;
            let port = parts.iter().position(|&p| p == "udp").and_then(|i| parts.get(i + 1))?;
            Some(format!("{ip}:{port}"))
        })
        .collect();

    // Write manifest for the GUI
    let manifest = serde_json::json!({
        "base_port": 0,
        "node_count": devnet.config().node_count,
        "bootstrap": devnet.bootstrap_addrs().iter().map(|a| a.to_string()).collect::<Vec<_>>(),
        "data_dir": devnet.config().data_dir.to_string_lossy(),
        "created_at": "",
        "evm": {
            "rpc_url": rpc_url,
            "wallet_private_key": "",
            "payment_token_address": token_addr,
            "payment_vault_address": vault_addr,
        }
    });

    let manifest_path = config_dir().join("devnet-manifest.json");
    std::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)?;

    println!();
    println!("=== Sepolia Devnet is running! ===");
    println!();
    println!("Nodes:           {}", devnet.config().node_count);
    println!("Bootstrap peers: {:?}", bootstrap_addrs);
    println!("Manifest:        {}", manifest_path.display());
    println!();
    println!("Start the GUI with:");
    println!("  $env:VITE_NETWORK=\"sepolia\"; npm run tauri:dev");
    println!();
    println!("Connect your wallet to Arbitrum Sepolia (chain 421614).");
    println!();
    println!("Press Ctrl+C to stop.");

    tokio::signal::ctrl_c().await?;
    println!("Shutting down...");

    if manifest_path.exists() {
        std::fs::remove_file(&manifest_path).ok();
    }

    Ok(())
}
