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

## Related

- [ant-client](https://github.com/WithAutonomi/ant-client) — Node management daemon + data client library
- [ant-node](https://github.com/WithAutonomi/ant-node) — Autonomi P2P network node

## License

GPL-3.0
