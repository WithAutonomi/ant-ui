import { getBalance, readContract } from '@wagmi/core'
import { formatEther, formatUnits, erc20Abi } from 'viem'
import { useWalletStore } from '~/stores/wallet'
import { useSettingsStore } from '~/stores/settings'
import { getTokenAddress, getActiveChainId } from '~/utils/wallet-config'

export function useWallet() {
  const walletStore = useWalletStore()
  const settingsStore = useSettingsStore()
  const { $wagmiAdapter, $appkitReady } = useNuxtApp()

  async function syncFromAppKit() {
    if (!$appkitReady) return
    if (settingsStore._devnetWalletKeySet) return

    const { useAppKitAccount } = await import('@reown/appkit/vue')

    // Re-check after async import — key may have been set during the await
    if (settingsStore._devnetWalletKeySet) return

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

  async function refreshBalances() {
    if (!$appkitReady || !$wagmiAdapter?.wagmiConfig || !walletStore.paymentAddress) return

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
        // ANT token read may fail
      }

      walletStore.ethBalance = `${ethFormatted} ETH`
      walletStore.antBalance = `${antFormatted} ANT`
      walletStore.balance = `${ethFormatted} ETH / ${antFormatted} ANT`
    } catch (err) {
      console.error('Failed to fetch balances:', err)
    }
  }

  // Start syncing
  syncFromAppKit()

  return { refreshBalances }
}
