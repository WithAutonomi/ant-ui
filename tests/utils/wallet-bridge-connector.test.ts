import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockInvoke, resetTauriMocks, setMockInvokeHandler } from '../mocks/tauri'
import { browserBridge, BRIDGE_CONNECTOR_ID } from '~/utils/wallet-bridge-connector'

// The global setup (tests/mocks/appkit.ts) stubs these modules for the
// AppKit-heavy store tests. This file needs the real behavior instead:
// wagmi's createConnector is an identity helper, and viem's getAddress /
// numberToHex do real encoding the assertions depend on.
vi.mock('@wagmi/core', () => ({ createConnector: (fn: any) => fn }))
vi.mock('viem', async (importOriginal) => await importOriginal())

// Minimal chain shape — only the fields the connector reads.
const arbitrumOne = {
  id: 42161,
  name: 'Arbitrum One',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://arb1.arbitrum.io/rpc'] } },
  blockExplorers: { default: { name: 'Arbiscan', url: 'https://arbiscan.io' } },
}

const TEST_ACCOUNT = '0x8ba1f109551bd432803012645ac136ddd64dba72'
const TEST_ACCOUNT_CHECKSUMMED = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'

function makeConnector() {
  const emitter = { emit: vi.fn() }
  const config = { chains: [arbitrumOne], emitter } as any
  // createConnector is an identity helper: browserBridge() returns the
  // factory wagmi would call with its config.
  const connector = (browserBridge() as any)(config)
  return { connector, emitter }
}

/** Route invoke('bridge_request') by method name; other commands get infra
 *  defaults. Outcomes use the Rust BridgeRpcOutcome shape. */
function routeBridge(byMethod: Record<string, { result?: unknown; error?: { code: number; message: string } }>) {
  setMockInvokeHandler((cmd: string, args?: any) => {
    if (cmd === 'bridge_start') return { port: 17423, url: 'http://127.0.0.1:17423/#t', signer_connected: false }
    if (cmd === 'bridge_stop') return null
    if (cmd === 'bridge_request') {
      const spec = byMethod[args.method]
      if (!spec) throw new Error(`unexpected bridge method: ${args.method}`)
      return { result: spec.result ?? null, error: spec.error ?? null }
    }
    throw new Error(`unexpected command: ${cmd}`)
  })
}

describe('wallet-bridge-connector', () => {
  beforeEach(() => {
    resetTauriMocks()
  })

  it('exposes the stable id AppKit config refers to', () => {
    const { connector } = makeConnector()
    expect(connector.id).toBe(BRIDGE_CONNECTOR_ID)
    expect(connector.name).toBe('Browser extension')
  })

  it('connect starts the bridge, then returns checksummed accounts and numeric chain id', async () => {
    routeBridge({
      eth_requestAccounts: { result: [TEST_ACCOUNT] },
      eth_chainId: { result: '0xa4b1' },
    })
    const { connector } = makeConnector()

    const res = await connector.connect({})

    expect(res.accounts).toEqual([TEST_ACCOUNT_CHECKSUMMED])
    expect(res.chainId).toBe(42161)
    // bridge_start must run before any relayed request.
    expect(mockInvoke.mock.calls[0][0]).toBe('bridge_start')
  })

  it('preserves the EIP-1193 error code when the wallet rejects', async () => {
    routeBridge({
      eth_requestAccounts: { error: { code: 4001, message: 'User rejected the request.' } },
    })
    const { connector } = makeConnector()

    await expect(connector.connect({})).rejects.toMatchObject({
      code: 4001,
      message: 'User rejected the request.',
    })
  })

  it('defaults params to an empty array', async () => {
    routeBridge({ eth_accounts: { result: [TEST_ACCOUNT] } })
    const { connector } = makeConnector()

    await connector.getAccounts()

    expect(mockInvoke).toHaveBeenCalledWith('bridge_request', {
      method: 'eth_accounts',
      params: [],
    })
  })

  it('switchChain falls back to wallet_addEthereumChain on 4902', async () => {
    let switchCalls = 0
    setMockInvokeHandler((cmd: string, args?: any) => {
      if (cmd === 'bridge_request' && args.method === 'wallet_switchEthereumChain') {
        switchCalls += 1
        return { result: null, error: { code: 4902, message: 'Unrecognized chain ID' } }
      }
      if (cmd === 'bridge_request' && args.method === 'wallet_addEthereumChain') {
        return { result: null, error: null }
      }
      throw new Error(`unexpected: ${cmd} ${args?.method}`)
    })
    const { connector, emitter } = makeConnector()

    const chain = await connector.switchChain({ chainId: 42161 })

    expect(switchCalls).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith('bridge_request', {
      method: 'wallet_addEthereumChain',
      params: [
        expect.objectContaining({
          chainId: '0xa4b1',
          chainName: 'Arbitrum One',
          rpcUrls: ['https://arb1.arbitrum.io/rpc'],
          blockExplorerUrls: ['https://arbiscan.io'],
        }),
      ],
    })
    expect(chain.id).toBe(42161)
    expect(emitter.emit).toHaveBeenCalledWith('change', { chainId: 42161 })
  })

  it('switchChain rethrows non-4902 wallet errors untouched', async () => {
    routeBridge({
      wallet_switchEthereumChain: { error: { code: 4001, message: 'User rejected the request.' } },
    })
    const { connector } = makeConnector()

    await expect(connector.switchChain({ chainId: 42161 })).rejects.toMatchObject({ code: 4001 })
  })

  it('disconnect tears the bridge session down', async () => {
    routeBridge({})
    const { connector } = makeConnector()

    await connector.disconnect()

    expect(mockInvoke).toHaveBeenCalledWith('bridge_stop')
  })

  it('never claims prior authorization (no silent reconnect across restarts)', async () => {
    const { connector } = makeConnector()
    await expect(connector.isAuthorized()).resolves.toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
