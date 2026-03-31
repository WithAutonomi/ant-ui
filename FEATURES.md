# ant-gui Feature Spec

## Current Features

### 1. Node Management (Dashboard)
- Tile and hexagon grid views for nodes
- Add, start, stop, remove nodes via local antd daemon
- Real-time status updates via SSE
- Status summary (running/stopped/errored)
- Filter and search

### 2. File Operations
- Upload tab with drag-drop zone
- Cost estimation dialog before upload
- Download tab with progress tracking
- Vault: persistent upload history (last 500 entries)
- Files stored locally in `~/.config/autonomi/ant-gui/upload_history.json`

### 3. Wallet
- Connect via Reown AppKit (Web3 wallet)
- Arbitrum network — ETH + ANT token balances
- Set earnings address for node rewards
- Payment required for uploads

### 4. Settings
- Storage directory (node data)
- Download directory
- Earnings address
- Alert sound toggle (bell on critical node events)
- Advanced: daemon URL (default `http://127.0.0.1:12500`)
- App version and links

---

## Planned: Indelible Enterprise Integration

Optional feature allowing ant-gui to connect to a self-hosted Indelible instance. When enabled, the app acts as a thin client for the organisation's Indelible gateway instead of interacting directly with the Autonomi network.

### Purpose
Companies running Indelible can distribute ant-gui to their users. Users sign in with their organisation's Indelible URL + API key, and all storage is routed through the company's gateway with centralised payment and management.

### 5. Indelible Connection (Advanced Settings)
- New fields in advanced settings pane:
  - **Indelible URL** — base URL of the Indelible instance (e.g. `https://files.acme.com`)
  - **API Key** — user's Indelible API token
- "Test Connection" button — validates credentials against `/api/v2/auth/me`
- Stores connection status + organisation name from API response
- Persisted in config TOML (`indelible_url`, `indelible_api_key`)
- Disconnect button to revert to local mode

### 6. Managed File Operations (Indelible Mode)
When connected to Indelible, the files page switches data source:

- **Uploads list** — fetched from `/api/v2/uploads` instead of local history
- **Upload flow** — file posted to Indelible's `/api/v2/uploads` multipart endpoint
  - Server handles network storage, caching, and payment
  - Cost estimation comes from Indelible (no local wallet needed)
  - Progress tracking via polling upload status
- **Downloads** — proxied through Indelible's download endpoint
- **Vault** — shows server-side upload history with search/filter
- Local upload history remains separate and intact

### 7. Managed Wallet (Indelible Mode)
When connected to Indelible, the wallet page changes:

- AppKit wallet connection UI is **hidden**
- Replaced with a banner: **"Storage managed by {organisation name}"**
- Earnings address remains available but **manual entry only** (no wallet connect suggestion)
- Optional: show user's quota usage if quotas are configured on the server
- Switching back to local mode restores normal wallet UI

### 8. Dashboard Indicator
- "Connected to Indelible" badge in header or sidebar when in managed mode
- Node management remains fully local and unaffected

### Design Principles
- **Fully optional** — zero impact when not configured
- **No changes to Indelible** — uses existing API endpoints and token auth
- **Graceful degradation** — if Indelible is unreachable, show error and allow switching back to local mode
- **Clear mode distinction** — user always knows whether they're in local or managed mode
- **Existing web interface unaffected** — this is purely an ant-gui integration
