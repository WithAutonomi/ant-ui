import { acceptHMRUpdate, defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { arbitrumSepolia } from 'viem/chains'
import { ANVIL_CHAIN_ID } from '~/utils/constants'

// Private key stored outside reactive state — not visible in Vue DevTools.
let _walletKey: string | null = null
export function setDevnetWalletKey(key: string | null) {
  // viem's `privateKeyToAccount` requires a `0x`-prefixed hex string.
  // The manual settings.vue entry path normalises prefix explicitly, but
  // devnet manifests from devops ship the key without `0x` — store it
  // normalised here so both entry paths converge. Missing this caused
  // the manifest-driven wallet to silently fail to init: viem would
  // derive a junk address (or throw) from the unprefixed bytes.
  if (key && !key.startsWith('0x')) {
    _walletKey = `0x${key}`
  } else {
    _walletKey = key
  }
}
export function getDevnetWalletKey(): string | null { return _walletKey }

export type ThemeMode = 'dark' | 'light'

interface AppConfig {
  storage_dir: string | null
  download_dir: string | null
  daemon_url: string
  bell_on_critical: boolean
  earnings_address: string | null
  indelible_url: string | null
  indelible_api_key: string | null
  theme_mode: string
  upload_concurrency: number
  prerelease_channel: boolean
}

/** Allowed range for upload_concurrency (see AppConfig in Rust). */
export const UPLOAD_CONCURRENCY_MIN = 1
export const UPLOAD_CONCURRENCY_MAX = 8

function clampConcurrency(n: number): number {
  if (!Number.isFinite(n)) return UPLOAD_CONCURRENCY_MIN
  return Math.max(UPLOAD_CONCURRENCY_MIN, Math.min(UPLOAD_CONCURRENCY_MAX, Math.floor(n)))
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    storageDir: null as string | null,
    downloadDir: null as string | null,
    daemonUrl: 'http://127.0.0.1:12500',
    bellOnCritical: false,
    earningsAddress: null as string | null,
    indelibleUrl: null as string | null,
    indelibleApiKey: null as string | null,
    indelibleConnected: false,
    indelibleOrgName: null as string | null,
    indelibleUserEmail: null as string | null,
    themeMode: 'dark' as ThemeMode,
    uploadConcurrency: 1,
    /** Auto-update channel selector. Off → stable releases only.
     *  On → next app launch resolves the latest release including pre-releases
     *  (rc/beta) via the GitHub API. The endpoint is captured at app init, so
     *  toggling this requires an app restart to take effect — the Settings UI
     *  shows a hint banner when the live value differs from the boot value. */
    prereleaseChannel: false,
    /** Snapshot of `prereleaseChannel` at app boot — drives the "restart to
     *  apply" hint banner. Set once during loadConfig. */
    prereleaseChannelBootValue: false,
    loaded: false,
    // Devnet/testnet/direct-key mode (set by manifest or settings form).
    // devnetChainId picks the chain:
    //   - null / not set   → production mainnet (WalletConnect)
    //   - ANVIL_CHAIN_ID   → local Anvil devnet (manifest)
    //   - arbitrumSepolia.id → Arbitrum Sepolia testnet
    //   - arbitrum.id      → Arbitrum One mainnet via direct key
    devnetActive: false,
    devnetChainId: null as number | null,
    devnetRpcUrl: null as string | null,
    devnetTokenAddress: null as string | null,
    devnetVaultAddress: null as string | null,
    devnetBootstrapPeers: null as string[] | null,
    // Private key stored in composable module scope only — not in reactive state.
    // Use setDevnetWalletKey() / getDevnetWalletKey() instead.
    _devnetWalletKeySet: false,
  }),

  actions: {
    async loadConfig() {
      try {
        const config = await invoke<AppConfig>('load_config')
        this.storageDir = config.storage_dir
        this.downloadDir = config.download_dir
        this.daemonUrl = config.daemon_url
        this.bellOnCritical = config.bell_on_critical
        this.earningsAddress = config.earnings_address
        this.indelibleUrl = config.indelible_url
        this.indelibleApiKey = config.indelible_api_key
        this.themeMode = config.theme_mode === 'light' ? 'light' : 'dark'
        this.uploadConcurrency = clampConcurrency(config.upload_concurrency)
        this.prereleaseChannel = config.prerelease_channel ?? false
        // Capture once on first load — represents the value the Rust side
        // resolved its updater endpoint URL from. Subsequent toggles diverge
        // from this until the next app restart.
        if (!this.loaded) this.prereleaseChannelBootValue = this.prereleaseChannel
        this.loaded = true
      } catch (e) {
        console.error('Failed to load config:', e)
      }
    },

    async saveConfig() {
      try {
        const config: AppConfig = {
          storage_dir: this.storageDir,
          download_dir: this.downloadDir,
          daemon_url: this.daemonUrl,
          bell_on_critical: this.bellOnCritical,
          earnings_address: this.earningsAddress,
          indelible_url: this.indelibleUrl,
          indelible_api_key: this.indelibleApiKey,
          theme_mode: this.themeMode,
          upload_concurrency: this.uploadConcurrency,
          prerelease_channel: this.prereleaseChannel,
        }
        await invoke('save_config', { config })
      } catch (e) {
        console.error('Failed to save config:', e)
      }
    },

    async setUploadConcurrency(n: number) {
      this.uploadConcurrency = clampConcurrency(n)
      await this.saveConfig()
    },

    async setPrereleaseChannel(enabled: boolean) {
      this.prereleaseChannel = enabled
      await this.saveConfig()
    },

    async setStorageDir(path: string) {
      this.storageDir = path
      await this.saveConfig()
    },

    async setDownloadDir(path: string) {
      this.downloadDir = path
      await this.saveConfig()
    },

    async setDaemonUrl(url: string) {
      this.daemonUrl = url
      await this.saveConfig()
    },

    async setEarningsAddress(address: string | null) {
      this.earningsAddress = address
      await this.saveConfig()
    },

    async toggleBell() {
      this.bellOnCritical = !this.bellOnCritical
      await this.saveConfig()
    },

    async setThemeMode(mode: ThemeMode) {
      this.themeMode = mode
      await this.saveConfig()
    },

    async testIndelibleConnection(url: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
      try {
        const baseUrl = url.replace(/\/+$/, '').replace(/\/api\/v2.*$/, '')
        const res = await fetch(`${baseUrl}/api/v2/me`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          let msg = `HTTP ${res.status}`
          try {
            const json = JSON.parse(text)
            if (json.error) msg = json.error
          } catch { /* use default */ }
          return { ok: false, error: msg }
        }
        const user = await res.json()
        this.indelibleUrl = baseUrl
        this.indelibleApiKey = apiKey
        this.indelibleConnected = true
        this.indelibleOrgName = `${user.first_name} ${user.last_name}`.trim() || user.email
        this.indelibleUserEmail = user.email
        await this.saveConfig()
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: e.message || 'Connection failed' }
      }
    },

    async disconnectIndelible() {
      this.indelibleUrl = null
      this.indelibleApiKey = null
      this.indelibleConnected = false
      this.indelibleOrgName = null
      this.indelibleUserEmail = null
      await this.saveConfig()
    },

    /** Load devnet manifest if present. Sets devnetActive if found. */
    async loadDevnetManifest() {
      try {
        const result = await invoke<any>('load_devnet_manifest')
        if (result) {
          this.devnetActive = true
          this.devnetChainId = (result.rpc_url ?? '').includes('sepolia')
            ? arbitrumSepolia.id
            : ANVIL_CHAIN_ID
          this.devnetRpcUrl = result.rpc_url
          this.devnetTokenAddress = result.payment_token_address
          this.devnetVaultAddress = result.payment_vault_address
          this.devnetBootstrapPeers = result.bootstrap_peers
          if (result.wallet_private_key) {
            setDevnetWalletKey(result.wallet_private_key)
            this._devnetWalletKeySet = true
          }
          const modeLabel = this.devnetChainId === arbitrumSepolia.id ? 'Sepolia' : 'Devnet'
          console.info(`${modeLabel} mode active:`, result.rpc_url)
        }
      } catch (e) {
        // No manifest or invalid — stay in production mode
        this.devnetActive = false
      }
    },

    /** Re-validate stored credentials on app load */
    async reconnectIndelible() {
      if (!this.indelibleUrl || !this.indelibleApiKey) return
      const result = await this.testIndelibleConnection(this.indelibleUrl, this.indelibleApiKey)
      if (!result.ok) {
        // Credentials are stale but don't wipe them — let user see the error
        this.indelibleConnected = false
      }
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot))
}
