import { arbitrum } from '@reown/appkit/networks'
import { useSettingsStore } from '~/stores/settings'

// Project ID from cloud.reown.com (shared with project-dave)
export const WALLETCONNECT_PROJECT_ID = 'c57e0bb001a4dc96b54b9ced656a3cb8'

// Mainnet defaults
export const ANT_TOKEN_ADDRESS = '0xa78d8321B20c4Ef90eCd72f2588AA985A4BDb684' as const
export const PAYMENT_VAULT_ADDRESS = '0x9A3EcAc693b699Fc0B2B6A50B5549e50c2320A26' as const

// Native (non-bridged) USDC ERC-20 contracts by chain id. Display-only —
// USDC is not a payment route, just shown on the wallet panel for users
// who hold their stable balance there. 6 decimals.
export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum One
  421614: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Arbitrum Sepolia
}
export const USDC_DECIMALS = 6

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

/** Active chain ID — uses devnetChainId when set, falls back to Arbitrum One mainnet. */
export function getActiveChainId(): number {
  const settings = useSettingsStore()
  if (settings.devnetActive && settings.devnetChainId !== null) {
    return settings.devnetChainId
  }
  return arbitrum.id
}

/** USDC contract address for the active chain, or null on chains without
 *  a known USDC deployment (e.g. local Anvil devnet). */
export function getUsdcAddress(): `0x${string}` | null {
  return USDC_ADDRESSES[getActiveChainId()] ?? null
}
