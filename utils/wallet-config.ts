import { arbitrum } from '@reown/appkit/networks'

// Project ID from cloud.reown.com (shared with project-dave)
export const WALLETCONNECT_PROJECT_ID = 'c57e0bb001a4dc96b54b9ced656a3cb8'

export const ANT_TOKEN_ADDRESS = '0xa78d8321B20c4Ef90eCd72f2588AA985A4BDb684' as const
// Unified PaymentVault — handles both payForQuotes (wave-batch) and payForMerkleTree
export const PAYMENT_VAULT_ADDRESS = '0x9A3EcAc693b699Fc0B2B6A50B5549e50c2320A26' as const

export const SUPPORTED_CHAIN = arbitrum

export const APPKIT_METADATA = {
  name: 'Autonomi',
  description: 'Autonomi Node Manager',
  url: 'https://autonomi.com',
  icons: ['https://autonomi.com/favicon.ico'],
}
