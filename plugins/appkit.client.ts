import { createAppKit } from '@reown/appkit/vue'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { arbitrumSepolia } from '@reown/appkit/networks'
import { WALLETCONNECT_PROJECT_ID, SUPPORTED_CHAIN, APPKIT_METADATA } from '~/utils/wallet-config'

export default defineNuxtPlugin(async () => {
  // In local Anvil devnet mode, skip AppKit entirely — use direct wagmi config.
  // Detected by VITE_DEVNET env var since manifest isn't loaded yet at plugin time.
  if (import.meta.env.VITE_DEVNET === '1') {
    return {
      provide: {
        appkit: null as any,
        wagmiAdapter: null as any,
        appkitReady: false,
        devnetMode: true,
      },
    }
  }

  try {
    // Include both Arbitrum mainnet and Sepolia so WalletConnect works on either.
    // The user's wallet determines which chain is active.
    const wagmiAdapter = new WagmiAdapter({
      projectId: WALLETCONNECT_PROJECT_ID,
      networks: [SUPPORTED_CHAIN, arbitrumSepolia],
    })

    const appkit = createAppKit({
      adapters: [wagmiAdapter],
      networks: [SUPPORTED_CHAIN, arbitrumSepolia],
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: APPKIT_METADATA,
      features: {
        analytics: false,
        email: false,
        socials: false,
      },
      // Tauri's webview has no browser extensions, so the legacy injected
      // (window.ethereum) and the EIP-6963 multi-wallet discovery channels
      // can never resolve a wallet — disable both so the modal doesn't
      // advertise an unreachable "Browser" option.
      enableInjected: false,
      enableEIP6963: false,
      themeMode: 'dark',
    })

    return {
      provide: {
        appkit,
        wagmiAdapter,
        appkitReady: true,
        devnetMode: false,
      },
    }
  } catch (err) {
    console.error('AppKit initialization failed:', err)
    return {
      provide: {
        appkit: null as any,
        wagmiAdapter: null as any,
        appkitReady: false,
        devnetMode: false,
      },
    }
  }
})
