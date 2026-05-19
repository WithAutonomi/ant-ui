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
  - **Linux**: see [Building on Linux](#building-on-linux) below — Debian/Ubuntu is the tested path; Arch, Fedora and other distros need different packages and the AppImage step has known upstream issues on Arch.

## Development

```bash
# Install frontend dependencies
npm install

# Run in development mode (starts both Nuxt dev server and Tauri)
npm run tauri dev
```

The app will open automatically. The node daemon is started on first launch.

## Building

The Tauri bundle expects an `ant` daemon binary at
`src-tauri/binaries/ant-<host-triple>` (its [externalBin sidecar][sidecar]).
Fetch a prebuilt one from the latest [`ant-client`][ant-client] release before
your first build:

```bash
# Linux/macOS
scripts/download-sidecar.sh

# Windows
.\scripts\download-sidecar.ps1
```

Pin a specific version with `ANT_TAG=ant-cli-vX.Y.Z` if needed. If you have a
local `ant-client` checkout next to this repo, `scripts/setup-sidecar.sh` (or
`.ps1`) will build the binary from source instead.

```bash
# Build for production
npm run tauri build
```

Produces platform-specific installers in `src-tauri/target/release/bundle/`.

[sidecar]: https://v2.tauri.app/develop/sidecar/
[ant-client]: https://github.com/WithAutonomi/ant-client/releases

## Building on Linux

The `.deb` and `.rpm` bundles build cleanly on every distro we've tried.
The AppImage step runs `linuxdeploy` + `linuxdeploy-plugin-gtk`, which work
on Ubuntu (where our CI builds the release AppImage) but break on Arch
because of hard-coded paths upstream. If you only need to run the app
locally, the `.deb`/`.rpm`/portable archive are the supported paths from
source; if you need an AppImage specifically, grab the prebuilt one from
[Releases](https://github.com/WithAutonomi/ant-ui/releases).

### Debian / Ubuntu

```bash
sudo apt update
sudo apt install build-essential curl wget file libssl-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf libfuse2 xdg-utils desktop-file-utils
npm install
scripts/download-sidecar.sh
npm run tauri build
```

### Fedora / RHEL

```bash
sudo dnf install gcc gcc-c++ make openssl-devel \
  webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel \
  patchelf fuse-libs xdg-utils desktop-file-utils file wget
```

### Arch / Manjaro

Skip the AppImage bundle — the `.deb` and `.rpm` build fine:

```bash
sudo pacman -S --needed base-devel rust nodejs npm git wget file patchelf \
  desktop-file-utils webkit2gtk-4.1 libappindicator-gtk3 librsvg \
  fuse2 xdg-utils
npm install
scripts/download-sidecar.sh
npm run tauri build -- --bundles deb,rpm
```

If you try to bundle the AppImage on Arch you'll hit a cascade of
upstream issues — `xdg-open` missing, `linuxdeploy` failing without
`libfuse.so.2`, its bundled `strip` not recognising `.relr.dyn` sections
on modern libraries, and finally `linuxdeploy-plugin-gtk` failing because
modern Arch's `gdk-pixbuf2` deliberately ships no loaders at
`/usr/lib/gdk-pixbuf-2.0/2.10.0/`. The first three are fixable with
`NO_STRIP=true` plus the packages above; the last one is upstream's bug.
Use the prebuilt AppImage from Releases instead.

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

## Localization

The app ships with two locales today — English and Japanese (machine-translated
baseline, see [`locales/ja.json`](./locales/ja.json)'s `_translator_notes`
field). Strings live in JSON files under [`locales/`](./locales/) and are wired
to [vue-i18n](https://vue-i18n.intlify.dev) via
[`plugins/i18n.client.ts`](./plugins/i18n.client.ts).

**How the active locale is chosen**, in order:

1. The `i18n_locale` field in the user's `config.toml` (set via Settings →
   Language).
2. The OS locale, via `tauri-plugin-os` (e.g. `ja-JP` matches `ja`).
3. English.

The user can override at any time with **Settings → Language → System default**
or pick a specific locale.

**Linux CJK rendering note.** The AppImage / `.deb` does not bundle Noto CJK
(~80 MB). On a clean Linux desktop without `noto-cjk` installed, Japanese
renders as tofu boxes. Install your distro's `fonts-noto-cjk` /
`noto-fonts-cjk` package, or stay on English. A runtime probe + install
banner is a planned follow-up.

To add a new locale or polish translations, see
[`CONTRIBUTING-i18n.md`](./CONTRIBUTING-i18n.md).

## Related

- [ant-client](https://github.com/WithAutonomi/ant-client) — Node management daemon + data client library
- [ant-node](https://github.com/WithAutonomi/ant-node) — Autonomi P2P network node

## License

GPL-3.0
