import { arbitrum, arbitrumSepolia } from '@reown/appkit/networks'
import { ANVIL_CHAIN_ID } from '~/utils/constants'
import { useSettingsStore } from '~/stores/settings'

// Project ID from cloud.reown.com (shared with project-dave)
export const WALLETCONNECT_PROJECT_ID = 'c57e0bb001a4dc96b54b9ced656a3cb8'

// Mainnet defaults
export const ANT_TOKEN_ADDRESS = '0xa78d8321B20c4Ef90eCd72f2588AA985A4BDb684' as const
export const PAYMENT_VAULT_ADDRESS = '0x9A3EcAc693b699Fc0B2B6A50B5549e50c2320A26' as const

export const SUPPORTED_CHAIN = arbitrum

export const APPKIT_METADATA = {
  name: 'Autonomi',
  description: 'Autonomi Node Manager',
  url: 'https://autonomi.com',
  icons: ['https://autonomi.com/favicon.ico'],
}

/** Token address — devnet override when active, mainnet otherwise. */
export function getTokenAddress(): `0x${string}` {
  const settings = useSettingsStore()
  if (settings.devnetActive && settings.devnetTokenAddress) {
    return settings.devnetTokenAddress as `0x${string}`
  }
  return ANT_TOKEN_ADDRESS
}

/** Vault address — devnet override when active, mainnet otherwise. */
export function getVaultAddress(): `0x${string}` {
  const settings = useSettingsStore()
  if (settings.devnetActive && settings.devnetVaultAddress) {
    return settings.devnetVaultAddress as `0x${string}`
  }
  return PAYMENT_VAULT_ADDRESS
}

/** Active chain ID — Anvil (31337) in local devnet, Sepolia (421614) in Sepolia mode, Arbitrum (42161) in production. */
export function getActiveChainId(): number {
  const settings = useSettingsStore()
  if (settings.devnetActive && settings.devnetIsSepolia) return arbitrumSepolia.id as number
  if (settings.devnetActive) return ANVIL_CHAIN_ID
  return arbitrum.id
}
