import { vi } from 'vitest'

// Mock WalletConnect / AppKit modules that use CommonJS and break in ESM test env
vi.mock('@reown/appkit/vue', () => ({
  createAppKit: vi.fn(),
}))

vi.mock('@reown/appkit-adapter-wagmi', () => ({
  WagmiAdapter: vi.fn(),
}))

vi.mock('@reown/appkit/networks', () => ({
  arbitrum: { id: 42161, name: 'Arbitrum One' },
  arbitrumSepolia: { id: 421614, name: 'Arbitrum Sepolia' },
}))

vi.mock('@wagmi/core', () => ({
  getAccount: vi.fn(() => ({ address: undefined })),
  createConfig: vi.fn(),
  http: vi.fn(),
  readContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getBalance: vi.fn(),
  switchChain: vi.fn(),
  getPublicClient: vi.fn(),
}))

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({ address: '0xmock' })),
}))

// Identity shims for the formatters (tests assert flow, not formatting), but
// real ABI event codecs: utils/payment.ts decodes MerklePaymentMade events
// from receipts, and tests feed it real encoded logs. `viem/utils` is not
// mocked, so importing from it inside the factory avoids self-recursion.
vi.mock('viem', async () => {
  const { decodeEventLog } = await import('viem/utils')
  return {
    defineChain: vi.fn((c: any) => c),
    formatEther: vi.fn((v: any) => String(v)),
    parseEther: vi.fn((v: any) => BigInt(v)),
    parseUnits: vi.fn((v: any) => BigInt(v)),
    formatUnits: vi.fn((v: any) => String(v)),
    decodeEventLog,
  }
})
