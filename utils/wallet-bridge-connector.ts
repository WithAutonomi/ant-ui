import { createConnector } from '@wagmi/core'
import { invoke } from '@tauri-apps/api/core'
import { getAddress, numberToHex } from 'viem'

/**
 * Wagmi connector for the browser-wallet signing bridge.
 *
 * The Tauri webview hosts no browser extensions, so `window.ethereum` can
 * never exist here. This connector routes every EIP-1193 wallet request over
 * Tauri IPC to the Rust `wallet_bridge` module, which relays it to a signing
 * page opened in the user's *system default browser* — where MetaMask/Rabby
 * do inject. Responses travel back the same way. Public reads (balances,
 * receipts) never touch this connector; wagmi sends those through the
 * per-chain HTTP transports as usual.
 *
 * Registered on the WagmiAdapter so AppKit renders it as a wallet card in
 * the connect modal ("Browser extension"), alongside the WalletConnect QR.
 */

/** Mirrors Rust `BridgeRpcOutcome` — exactly one of the two is set. */
interface BridgeRpcOutcome {
  result: unknown
  error: { code: number; message: string } | null
}

export const BRIDGE_CONNECTOR_ID = 'autonomiBrowserBridge'

/** EIP-1193 error the wallet reported, code preserved so viem/wagmi map
 *  4001 → user-rejected, 4902 → unknown chain, etc. */
class BridgeRpcError extends Error {
  code: number
  details: string
  constructor(code: number, message: string) {
    super(message)
    this.name = 'BridgeRpcError'
    this.code = code
    this.details = message
  }
}

async function bridgeRequest(method: string, params?: unknown): Promise<unknown> {
  const outcome = await invoke<BridgeRpcOutcome>('bridge_request', {
    method,
    params: params ?? [],
  })
  if (outcome.error) {
    throw new BridgeRpcError(outcome.error.code, outcome.error.message)
  }
  return outcome.result
}

export function browserBridge() {
  // Single stable provider object — wagmi builds viem wallet clients around
  // it with a `custom()` transport, so `request` is the whole contract.
  const provider = {
    request: ({ method, params }: { method: string; params?: unknown }) =>
      bridgeRequest(method, params),
  }

  return createConnector<typeof provider>((config) => ({
    id: BRIDGE_CONNECTOR_ID,
    name: 'Browser extension',
    type: 'browserBridge' as const,

    async setup() {},

    async connect({ chainId, withCapabilities } = {} as {
      chainId?: number
      isReconnecting?: boolean
      withCapabilities?: boolean
    }) {
      // Starts the loopback server (idempotent) and opens the signing page
      // in the default browser unless one is already connected.
      await invoke('bridge_start')

      const raw = (await bridgeRequest('eth_requestAccounts')) as string[]
      const accounts = raw.map((a) => getAddress(a))
      let currentChainId = await this.getChainId()

      if (chainId && currentChainId !== chainId) {
        const switched = await this.switchChain?.({ chainId }).catch(() => null)
        if (switched) currentChainId = switched.id
      }

      return {
        // wagmi's conditional return type (plain addresses vs address +
        // capabilities records, keyed on the generic `withCapabilities`)
        // can't be expressed from an implementation — same cast wagmi's own
        // connectors use.
        accounts: (withCapabilities
          ? accounts.map((address) => ({ address, capabilities: {} }))
          : accounts) as never,
        chainId: currentChainId,
      }
    },

    async disconnect() {
      await invoke('bridge_stop')
    },

    async getAccounts() {
      const raw = (await bridgeRequest('eth_accounts')) as string[]
      return raw.map((a) => getAddress(a))
    },

    async getChainId() {
      const hex = (await bridgeRequest('eth_chainId')) as string
      return Number(BigInt(hex))
    },

    async getProvider() {
      return provider
    },

    async isAuthorized() {
      // Bridge sessions are per-app-run; never silently reconnect at boot.
      return false
    },

    async switchChain({ chainId }) {
      const chain = config.chains.find((c) => c.id === chainId)
      if (!chain) throw new BridgeRpcError(4901, `Chain ${chainId} not configured`)

      try {
        await bridgeRequest('wallet_switchEthereumChain', [
          { chainId: numberToHex(chainId) },
        ])
      } catch (err: any) {
        // 4902: the wallet doesn't know this chain — offer to add it, then
        // the add prompt doubles as the switch in MetaMask/Rabby.
        if (err?.code !== 4902) throw err
        await bridgeRequest('wallet_addEthereumChain', [
          {
            chainId: numberToHex(chainId),
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http,
            blockExplorerUrls: chain.blockExplorers
              ? [chain.blockExplorers.default.url]
              : [],
          },
        ])
      }

      config.emitter.emit('change', { chainId })
      return chain
    },

    // No push channel from the page in v1 — the app re-checks account and
    // chain around every payment (`ensureActiveChain`), so drift is caught
    // at the moment it matters. These satisfy the connector interface and
    // become live if a bridge event stream is added later.
    onAccountsChanged(accounts) {
      if (accounts.length === 0) {
        config.emitter.emit('disconnect')
      } else {
        config.emitter.emit('change', {
          accounts: accounts.map((a) => getAddress(a)),
        })
      }
    },

    onChainChanged(chainId) {
      config.emitter.emit('change', { chainId: Number(chainId) })
    },

    onDisconnect() {
      config.emitter.emit('disconnect')
    },
  }))
}
