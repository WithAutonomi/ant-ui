import { describe, it, expect, beforeEach } from 'vitest'
import { setMockInvokeHandler, resetTauriMocks } from '../mocks/tauri'
import { useSettingsStore } from '~/stores/settings'

describe('settings store', () => {
  let store: ReturnType<typeof useSettingsStore>

  beforeEach(() => {
    resetTauriMocks()
    store = useSettingsStore()
    store.$reset()
  })

  describe('loadConfig', () => {
    it('loads config from Tauri backend', async () => {
      setMockInvokeHandler((cmd) => {
        if (cmd === 'load_config') {
          return {
            storage_dir: '/data/storage',
            download_dir: '/data/downloads',
            daemon_url: 'http://127.0.0.1:54321',
            bell_on_critical: true,
            earnings_address: '0xabc123',
            indelible_url: null,
            indelible_api_key: null,
          }
        }
      })

      await store.loadConfig()

      expect(store.loaded).toBe(true)
      expect(store.storageDir).toBe('/data/storage')
      expect(store.downloadDir).toBe('/data/downloads')
      expect(store.daemonUrl).toBe('http://127.0.0.1:54321')
      expect(store.bellOnCritical).toBe(true)
      expect(store.earningsAddress).toBe('0xabc123')
    })

    it('handles load failure gracefully', async () => {
      setMockInvokeHandler(() => {
        throw new Error('config file corrupt')
      })

      await store.loadConfig()

      // Should not crash, loaded stays false
      expect(store.loaded).toBe(false)
    })
  })

  describe('loadDevnetManifest', () => {
    it('activates devnet mode when manifest exists', async () => {
      setMockInvokeHandler((cmd) => {
        if (cmd === 'load_devnet_manifest') {
          return {
            rpc_url: 'http://127.0.0.1:8545',
            payment_token_address: '0xtoken',
            payment_vault_address: '0xvault',
            bootstrap_peers: ['127.0.0.1:20000'],
            wallet_private_key: '0xdeadbeef',
          }
        }
      })

      await store.loadDevnetManifest()

      expect(store.devnetActive).toBe(true)
      expect(store.devnetIsSepolia).toBe(false)
      expect(store.devnetRpcUrl).toBe('http://127.0.0.1:8545')
      expect(store.devnetTokenAddress).toBe('0xtoken')
      expect(store.devnetVaultAddress).toBe('0xvault')
      expect(store.devnetBootstrapPeers).toEqual(['127.0.0.1:20000'])
    })

    it('detects Sepolia from RPC URL', async () => {
      setMockInvokeHandler((cmd) => {
        if (cmd === 'load_devnet_manifest') {
          return {
            rpc_url: 'https://sepolia-rollup.arbitrum.io/rpc',
            payment_token_address: '0xtoken',
            payment_vault_address: '0xvault',
            bootstrap_peers: ['127.0.0.1:20000'],
          }
        }
      })

      await store.loadDevnetManifest()

      expect(store.devnetActive).toBe(true)
      expect(store.devnetIsSepolia).toBe(true)
    })

    it('stays in production mode when no manifest', async () => {
      setMockInvokeHandler((cmd) => {
        if (cmd === 'load_devnet_manifest') return null
      })

      await store.loadDevnetManifest()

      expect(store.devnetActive).toBe(false)
    })
  })

  describe('saveConfig', () => {
    it('sends current state to Tauri backend', async () => {
      let savedConfig: any = null
      setMockInvokeHandler((cmd, args) => {
        if (cmd === 'load_config') {
          return {
            storage_dir: null,
            download_dir: null,
            daemon_url: 'http://127.0.0.1:12500',
            bell_on_critical: false,
            earnings_address: null,
            indelible_url: null,
            indelible_api_key: null,
          }
        }
        if (cmd === 'save_config') {
          savedConfig = args.config
        }
      })

      await store.loadConfig()
      store.earningsAddress = '0xnewaddr'
      await store.saveConfig()

      expect(savedConfig).toBeTruthy()
      expect(savedConfig.earnings_address).toBe('0xnewaddr')
      expect(savedConfig.daemon_url).toBe('http://127.0.0.1:12500')
    })
  })
})
