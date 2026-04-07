# Autonomi Desktop UI

Desktop application for managing [Autonomi](https://autonomi.com) network nodes and file operations.

Built with Nuxt 3 + Vue 3 + Tauri 2.

## Features

**Node Management**
- Add, start, stop, and remove nodes
- Real-time status with PID and uptime
- Auto-starts the node daemon on launch
- Dynamic port discovery (no manual configuration)

**File Operations**
- Upload files to the Autonomi network
- Download files by address
- Drag-and-drop upload
- Upload history persistence
- Optional Indelible server integration (Settings > Advanced)

**Wallet**
- Connect via WalletConnect (mobile/hardware wallets)
- ETH + ANT balance display on Arbitrum
- Split payment flow — private keys never leave your wallet

## Architecture

```
Frontend (Nuxt 3 SPA)
  Pinia stores ── daemon-api.ts ── Tauri invoke ── daemon REST API (ant-core)
                   payment.ts ──── WalletConnect ── PaymentVault contract
                   files store ─── Tauri invoke ── ant-core data client
Backend (Tauri 2 / Rust)
  autonomi_ops.rs ── ant-core data client (file encrypt/upload/download)
  config.rs ──────── settings persistence, daemon port discovery
  lib.rs ─────────── daemon proxy, ensure_daemon_running
```

The node management daemon (`ant-core`) runs as a background process, auto-started by the GUI. It manages node binaries, process lifecycle, and exposes a REST API on localhost.

File operations use `ant-core`'s data client with an external signer flow — the Rust backend encrypts and collects quotes, the frontend pays via the user's wallet, and the backend finalizes the upload.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.75+
- Platform build tools:
  - **Windows**: Visual Studio Build Tools (C++ workload)
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev`, `libayatana-appindicator3-dev`

## Development

```bash
# Install frontend dependencies
npm install

# Run in development mode (starts both Nuxt dev server and Tauri)
npm run tauri dev
```

The app will open automatically. The node daemon is started on first launch.

## Building

```bash
# Build for production
npm run tauri build
```

Produces platform-specific installers in `src-tauri/target/release/bundle/`.

## Project Structure

```
pages/              Vue pages (nodes, files, wallet, settings)
components/         Vue components (tiles, dialogs, sidebar, header)
stores/             Pinia stores (nodes, files, wallet, settings, toasts)
utils/              API clients (daemon, payment, indelible, wallet config)
composables/        Vue composables (wallet sync)
plugins/            Nuxt plugins (AppKit/WalletConnect)
assets/             CSS, contract ABIs
src-tauri/
  src/
    lib.rs          Tauri commands (config, daemon proxy, ensure_daemon_running)
    autonomi_ops.rs Data client (upload/download via ant-core)
    config.rs       Settings persistence, daemon port discovery
```

## Testing Against a Local or Sepolia Network

The GUI can target a local devnet or Arbitrum Sepolia for E2E testing. Both modes auto-detect from a manifest file written by the devnet launcher in [ant-client](https://github.com/WithAutonomi/ant-client).

### Option A: Local Devnet (Anvil)

Starts 25 P2P nodes with an embedded Anvil blockchain. No external accounts needed.

```powershell
# Terminal 1: Start devnet from ant-client (wait for "=== Devnet is running! ===")
cd path/to/ant-client
cargo run --release --example start-local-devnet

# Terminal 2: Start GUI in devnet mode
$env:VITE_DEVNET="1"; npm run tauri:dev
```

The GUI detects the manifest, bypasses WalletConnect, and uses the devnet wallet directly. Sidebar shows "DEVNET".

### Option B: Arbitrum Sepolia

Starts 25 P2P nodes that verify payments against existing Sepolia contracts. You can connect via WalletConnect or import a private key directly in Settings > Advanced.

**Prerequisites:**
- A wallet with Arbitrum Sepolia ETH (faucet: https://faucet.quicknode.com/arbitrum/sepolia)
- Test ANT tokens on the Sepolia token contract (`0x4bc1aCE0E66170375462cB4E6Af42Ad4D5EC689C`)

```powershell
# Terminal 1: Start devnet from ant-client
cd path/to/ant-client
cargo run --release --example start-devnet-sepolia

# Terminal 2: Start GUI (Sepolia detected from manifest)
npm run tauri:dev
```

In the app: Settings > Advanced > Import Private Key > select "Arbitrum Sepolia" > paste key. Sidebar shows "SEPOLIA TESTNET".

### How it works

The devnet launcher writes a `devnet-manifest.json` to the app config directory (`~/.config/autonomi/ant-gui/`). The GUI reads this on startup to configure bootstrap peers, EVM network, and contract addresses. The manifest is cleaned up when the devnet stops.

### Payment modes

Uploads automatically select the payment method based on file size:
- **Regular (wave-batch)**: Files under ~16MB (< 64 chunks). Pays per batch of chunks.
- **Merkle tree**: Files over ~16MB (>= 64 chunks). Single transaction for all chunks, lower gas.

## Related

- [ant-client](https://github.com/WithAutonomi/ant-client) — Node management daemon + data client library
- [ant-node](https://github.com/WithAutonomi/ant-node) — Autonomi P2P network node

## License

GPL-3.0
