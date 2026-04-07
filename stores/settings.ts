import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'

interface AppConfig {
  storage_dir: string | null
  download_dir: string | null
  daemon_url: string
  bell_on_critical: boolean
  earnings_address: string | null
  indelible_url: string | null
  indelible_api_key: string | null
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
    loaded: false,
    // Devnet/testnet mode (auto-detected from manifest file)
    devnetActive: false,
    devnetIsSepolia: false,
    devnetRpcUrl: null as string | null,
    devnetTokenAddress: null as string | null,
    devnetVaultAddress: null as string | null,
    devnetBootstrapPeers: null as string[] | null,
    devnetWalletKey: null as string | null,
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
        }
        await invoke('save_config', { config })
      } catch (e) {
        console.error('Failed to save config:', e)
      }
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
          this.devnetIsSepolia = (result.rpc_url ?? '').includes('sepolia')
          this.devnetRpcUrl = result.rpc_url
          this.devnetTokenAddress = result.payment_token_address
          this.devnetVaultAddress = result.payment_vault_address
          this.devnetBootstrapPeers = result.bootstrap_peers
          this.devnetWalletKey = result.wallet_private_key
          console.info(`${this.devnetIsSepolia ? 'Sepolia' : 'Devnet'} mode active:`, result.rpc_url)
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
