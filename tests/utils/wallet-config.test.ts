import { describe, it, expect, beforeEach } from 'vitest'
import { resetTauriMocks } from '../mocks/tauri'
import { useSettingsStore } from '~/stores/settings'
import {
  getTokenAddress,
  getVaultAddress,
  getActiveChainId,
  ANT_TOKEN_ADDRESS,
  PAYMENT_VAULT_ADDRESS,
} from '~/utils/wallet-config'

describe('wallet-config', () => {
  let settings: ReturnType<typeof useSettingsStore>

  beforeEach(() => {
    resetTauriMocks()
    settings = useSettingsStore()
    settings.$reset()
  })

  describe('getTokenAddress', () => {
    it('returns mainnet address in production mode', () => {
      expect(getTokenAddress()).toBe(ANT_TOKEN_ADDRESS)
    })

    it('returns devnet override when active', () => {
      settings.devnetActive = true
      settings.devnetTokenAddress = '0xdevtoken'

      expect(getTokenAddress()).toBe('0xdevtoken')
    })
  })

  describe('getVaultAddress', () => {
    it('returns mainnet address in production mode', () => {
      expect(getVaultAddress()).toBe(PAYMENT_VAULT_ADDRESS)
    })

    it('returns devnet override when active', () => {
      settings.devnetActive = true
      settings.devnetVaultAddress = '0xdevvault'

      expect(getVaultAddress()).toBe('0xdevvault')
    })
  })

  describe('getActiveChainId', () => {
    it('returns Arbitrum mainnet (42161) in production', () => {
      expect(getActiveChainId()).toBe(42161)
    })

    it('returns Anvil (31337) in local devnet', () => {
      settings.devnetActive = true
      settings.devnetIsSepolia = false

      expect(getActiveChainId()).toBe(31337)
    })

    it('returns Sepolia (421614) in Sepolia mode', () => {
      settings.devnetActive = true
      settings.devnetIsSepolia = true

      expect(getActiveChainId()).toBe(421614)
    })
  })
})
