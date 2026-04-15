import { getBalance, readContract } from '@wagmi/core'
import { formatEther, formatUnits, erc20Abi } from 'viem'
import { useWalletStore } from '~/stores/wallet'
import { useSettingsStore } from '~/stores/settings'
import { getTokenAddress, getActiveChainId } from '~/utils/wallet-config'

// Module-level guard so the AppKit→walletStore watcher is only installed once
// across the app's lifetime, no matter how many call sites import useWallet().
// Calling useWallet() a second time used to set up a duplicate `watch` with
// `immediate: true`, which fired with a momentarily-undefined `connected` and
// briefly nulled walletStore.connected/balances — visible in the UI as a
// "wallet disconnected" flicker on Refresh Balances.
let syncStarted = false

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

    walletStore.ethBalance = `${ethFormatted} ETH`
    walletStore.antBalance = `${antFormatted} ANT`
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
    ([connected, addr]) => {
      if (settingsStore._devnetWalletKeySet) return
      walletStore.connected = !!connected
      walletStore.paymentAddress = addr ?? null
      if (connected && addr) {
        refreshBalances()
      } else {
        walletStore.balance = null
        walletStore.ethBalance = null
        walletStore.antBalance = null
      }
    },
    { immediate: true },
  )
}
