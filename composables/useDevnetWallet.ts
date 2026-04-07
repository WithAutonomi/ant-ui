import { createConfig, http } from '@wagmi/core'
import { defineChain } from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { arbitrumSepolia } from 'viem/chains'
import { useWalletStore } from '~/stores/wallet'
import { useSettingsStore, getDevnetWalletKey } from '~/stores/settings'
import { getTokenAddress, getActiveChainId } from '~/utils/wallet-config'
import { ANVIL_CHAIN_ID } from '~/utils/constants'
import { formatEther, formatUnits, erc20Abi } from 'viem'
import { getBalance, readContract } from '@wagmi/core'

let devnetWagmiConfig: any = null
let devnetAccount: PrivateKeyAccount | null = null

/** Build the Anvil chain definition from the devnet RPC URL. */
function buildAnvilChain(rpcUrl: string) {
  return defineChain({
    id: ANVIL_CHAIN_ID,
    name: 'Anvil Devnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
    testnet: true,
  })
}

/** Initialize the devnet/direct wallet — creates a wagmi config with the private key account. */
export function initDevnetWallet() {
  const settings = useSettingsStore()
  const walletStore = useWalletStore()

  const key = getDevnetWalletKey()
  if (!key) return null

  devnetAccount = privateKeyToAccount(key as `0x${string}`)

  // Determine which chain to use
  if (settings.devnetIsSepolia || (!settings.devnetRpcUrl && !settings.devnetActive)) {
    // Sepolia mode or direct key import (no manifest) — use Arbitrum Sepolia
    devnetWagmiConfig = createConfig({
      chains: [arbitrumSepolia],
      transports: {
        [arbitrumSepolia.id]: http(settings.devnetRpcUrl ?? 'https://sepolia-rollup.arbitrum.io/rpc'),
      },
      connectors: [],
    })
  } else {
    // Local Anvil devnet
    const chain = buildAnvilChain(settings.devnetRpcUrl!)
    devnetWagmiConfig = createConfig({
      chains: [chain],
      transports: {
        [ANVIL_CHAIN_ID]: http(settings.devnetRpcUrl!),
      },
      connectors: [],
    })
  }

  walletStore.connected = true
  walletStore.paymentAddress = devnetAccount.address

  refreshDevnetBalances()
  return devnetWagmiConfig
}

/** Get the devnet wagmi config (if initialized). */
export function getDevnetWagmiConfig() {
  return devnetWagmiConfig
}

/** Get the devnet viem Account (for passing to writeContract/readContract). */
export function getDevnetAccount(): PrivateKeyAccount | null {
  return devnetAccount
}

/** Refresh balances for the devnet wallet. */
async function refreshDevnetBalances() {
  const walletStore = useWalletStore()
  if (!devnetWagmiConfig || !walletStore.paymentAddress) return

  try {
    const addr = walletStore.paymentAddress as `0x${string}`

    const ethResult = await getBalance(devnetWagmiConfig, {
      address: addr,
      chainId: getActiveChainId(),
    })
    const ethFormatted = parseFloat(formatEther(ethResult.value)).toFixed(4)

    let antFormatted = '0.00'
    try {
      const antResult = await readContract(devnetWagmiConfig, {
        address: getTokenAddress(),
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [addr],
        chainId: getActiveChainId(),
      })
      antFormatted = parseFloat(formatUnits(antResult as bigint, 18)).toFixed(2)
    } catch {
      // Token contract may not exist on this chain
    }

    walletStore.ethBalance = `${ethFormatted} ETH`
    walletStore.antBalance = `${antFormatted} ANT`
    walletStore.balance = `${ethFormatted} ETH / ${antFormatted} ANT`
  } catch (err) {
    console.error('Failed to fetch devnet balances:', err)
  }
}
