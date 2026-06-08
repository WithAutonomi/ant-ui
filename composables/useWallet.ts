import { getBalance, readContract, getAccount, switchChain } from '@wagmi/core'
import { formatEther, formatUnits, erc20Abi } from 'viem'
import { useWalletStore } from '~/stores/wallet'
import { useSettingsStore } from '~/stores/settings'
import { getTokenAddress, getUsdcAddress, getActiveChainId, USDC_DECIMALS } from '~/utils/wallet-config'

// Module-level guard so the AppKit→walletStore watcher is only installed once
// across the app's lifetime, no matter how many call sites import useWallet().
// Calling useWallet() a second time used to set up a duplicate `watch` with
// `immediate: true`, which fired with a momentarily-undefined `connected` and
// briefly nulled walletStore.connected/balances — visible in the UI as a
// "wallet disconnected" flicker on Refresh Balances.
let syncStarted = false

/**
 * Make sure the connected AppKit/WalletConnect wallet is on the chain we read
 * balances from and pay on (`getActiveChainId()` — Arbitrum One on mainnet, or
 * the manifest's chain on devnet). Mirrors `ensureActiveChain` in
 * `utils/payment.ts`, but runs at *connect* time rather than only at payment
 * time — that gap was the root cause of GH #85 / V2-474, where our balance
 * panel (pinned to Arbitrum One) disagreed with the AppKit account modal
 * (which shows the wallet's actually-connected chain).
 *
 * Returns `true` if the wallet is on the target chain (already, or after a
 * successful switch), `false` if a mismatch persists (wallet declined the
 * `wallet_switchEthereumChain` request, or the target chain isn't one AppKit
 * knows about). Never throws — a `false` return drives the "wrong network"
 * banner instead of breaking the connect flow.
 *
 * The direct-key devnet wallet always sits on the manifest's chain, so it's
 * skipped via the same `_devnetWalletKeySet` guard the watcher uses.
 */
export async function ensureActiveChain(): Promise<boolean> {
  const { $appkitReady, $wagmiAdapter } = useNuxtApp()
  if (!$appkitReady || !$wagmiAdapter?.wagmiConfig) return true

  const settingsStore = useSettingsStore()
  if (settingsStore._devnetWalletKeySet) return true

  const config = $wagmiAdapter.wagmiConfig
  const target = getActiveChainId()
  const account = getAccount(config)
  if (account.chainId === target) return true

  try {
    await switchChain(config, { chainId: target })
    return true
  } catch (err) {
    console.warn('Wallet is on the wrong network; switch was not completed:', err)
    return false
  }
}

/**
 * Fetch wallet balances and update the store. Safe to call repeatedly from
 * anywhere — does not touch the AppKit watcher or any reactive setup.
 */
export async function refreshBalances() {
  const { $appkitReady, $wagmiAdapter } = useNuxtApp()
  if (!$appkitReady || !$wagmiAdapter?.wagmiConfig) return

  const walletStore = useWalletStore()
  if (!walletStore.paymentAddress) return

  try {
    const addr = walletStore.paymentAddress as `0x${string}`
    const config = $wagmiAdapter.wagmiConfig

    const ethResult = await getBalance(config, {
      address: addr,
      chainId: getActiveChainId(),
    })
    const ethFormatted = parseFloat(formatEther(ethResult.value)).toFixed(4)

    let antFormatted = '0.00'
    try {
      const antResult = await readContract(config, {
        address: getTokenAddress(),
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [addr],
        chainId: getActiveChainId(),
      })
      antFormatted = parseFloat(formatUnits(antResult as bigint, 18)).toFixed(2)
    } catch {
      // ANT token read may fail on chains without the contract deployed.
    }

    let usdcFormatted: string | null = null
    const usdcAddr = getUsdcAddress()
    if (usdcAddr) {
      try {
        const usdcResult = await readContract(config, {
          address: usdcAddr,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [addr],
          chainId: getActiveChainId(),
        })
        usdcFormatted = parseFloat(formatUnits(usdcResult as bigint, USDC_DECIMALS)).toFixed(2)
      } catch {
        // USDC read failed — leave null; the panel hides the row in that case.
      }
    }

    walletStore.ethBalance = `${ethFormatted} ETH`
    walletStore.antBalance = `${antFormatted} ANT`
    walletStore.usdcBalance = usdcFormatted ? `${usdcFormatted} USDC` : ''
    walletStore.balance = `${ethFormatted} ETH / ${antFormatted} ANT`
  } catch (err) {
    console.error('Failed to fetch balances:', err)
  }
}

/**
 * Install the AppKit→walletStore sync watcher. Idempotent — additional calls
 * are no-ops. Intended to be invoked once at app startup (see app.vue).
 */
export function useWallet() {
  if (syncStarted) return
  syncStarted = true

  void syncFromAppKit()
}

async function syncFromAppKit() {
  const { $appkitReady } = useNuxtApp()
  if (!$appkitReady) return

  const settingsStore = useSettingsStore()
  if (settingsStore._devnetWalletKeySet) return

  const { useAppKitAccount } = await import('@reown/appkit/vue')

  // Re-check after async import — key may have been set during the await.
  if (settingsStore._devnetWalletKeySet) return

  const walletStore = useWalletStore()
  const account = useAppKitAccount()
  const address = computed(() => (account.value as any)?.address as string | undefined)
  const isConnected = computed(() => (account.value as any)?.isConnected as boolean | undefined)

  watch(
    [isConnected, address],
    async ([connected, addr]) => {
      if (settingsStore._devnetWalletKeySet) return
      walletStore.connected = !!connected
      walletStore.paymentAddress = addr ?? null
      if (connected && addr) {
        // Move the wallet onto our target chain before reading balances, so
        // our panel and the AppKit modal agree (GH #85 / V2-474). If the
        // switch doesn't complete, flag it for the "wrong network" banner.
        walletStore.wrongNetwork = !(await ensureActiveChain())
        refreshBalances()
      } else {
        walletStore.balance = null
        walletStore.ethBalance = null
        walletStore.antBalance = null
        walletStore.usdcBalance = null
        walletStore.wrongNetwork = false
      }
    },
    { immediate: true },
  )
}
