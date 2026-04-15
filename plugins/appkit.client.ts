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
      // advertise an unreachable "Browser" connector card.
      enableInjected: false,
      enableEIP6963: false,
      themeMode: 'dark',
    })

    // Mark the modal as a "universal provider" client. Two effects:
    //   1. Suppresses the per-wallet "Browser" platform option (e.g. the
    //      Browser tab inside MetaMask's connect view) — that path requires
    //      a browser extension we don't have.
    //   2. Filters the explorer wallet list down to wallets that have at
    //      least one of mobile_link / desktop_link / webapp_link — pure
    //      extension-only wallets are unreachable from Tauri.
    // Set via OptionsController directly because `isUniversalProvider` lives
    // in OptionsControllerStateInternal, which Reown does not expose on the
    // createAppKit options type even though setIsUniversalProvider is the
    // setter the SDK itself uses.
    const { OptionsController } = await import('@reown/appkit-controllers')
    OptionsController.setIsUniversalProvider(true)

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
