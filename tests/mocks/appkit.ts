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
}))

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({ address: '0xmock' })),
}))

vi.mock('viem', () => ({
  defineChain: vi.fn((c: any) => c),
  formatEther: vi.fn((v: any) => String(v)),
  parseEther: vi.fn((v: any) => BigInt(v)),
  parseUnits: vi.fn((v: any) => BigInt(v)),
  formatUnits: vi.fn((v: any) => String(v)),
}))
