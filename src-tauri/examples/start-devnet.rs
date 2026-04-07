//! Start a local devnet with 25 nodes and EVM payments.
//!
//! Launches an Autonomi network with an embedded Anvil blockchain,
//! writes a manifest to the ant-gui config directory, and waits for Ctrl+C.
//!
//! The GUI detects the manifest on startup and automatically enters devnet mode.
//!
//! # Usage
//!
//! ```bash
//! cd src-tauri
//! cargo run --release --example start-devnet
//! ```

use ant_core::data::LocalDevnet;
use ant_node::devnet::DevnetConfig;
use std::path::PathBuf;

fn manifest_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("autonomi")
        .join("ant-gui");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.join("devnet-manifest.json")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    // Build runtime with 8MB thread stacks — P2P node frames are deep
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(8 * 1024 * 1024)
        .build()?;

    runtime.block_on(async_main())
}

async fn async_main() -> Result<(), Box<dyn std::error::Error>> {
    let config = DevnetConfig::default(); // 25 nodes, 3 bootstrap
    println!("Starting devnet with {} nodes...", config.node_count);

    let devnet = LocalDevnet::start(config).await?;

    let path = manifest_path();
    devnet.write_manifest(&path).await?;

    let manifest = devnet.manifest();
    let evm = manifest.evm.as_ref().expect("EVM info present");

    println!();
    println!("=== Devnet is running! ===");
    println!();
    println!("Nodes:           {}", manifest.node_count);
    println!("Bootstrap peers: {:?}", devnet.bootstrap_addrs());
    println!("Manifest:        {}", path.display());
    println!();
    println!("EVM RPC:         {}", evm.rpc_url);
    println!("Wallet key:      {}", evm.wallet_private_key);
    println!("Token contract:  {}", evm.payment_token_address);
    println!("Vault contract:  {}", evm.payment_vault_address);
    println!();
    println!("The GUI will detect this manifest automatically.");
    println!("Start the GUI with: $env:VITE_DEVNET=\"1\"; npm run tauri:dev");
    println!();
    println!("Press Ctrl+C to stop.");

    tokio::signal::ctrl_c().await?;
    println!("Shutting down...");

    // Clean up manifest so the GUI doesn't start in devnet mode next time
    if path.exists() {
        std::fs::remove_file(&path).ok();
        println!("Removed manifest: {}", path.display());
    }

    Ok(())
}
