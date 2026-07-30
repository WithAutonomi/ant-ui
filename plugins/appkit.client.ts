import { createAppKit } from '@reown/appkit/vue'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { arbitrumSepolia } from '@reown/appkit/networks'
import { WALLETCONNECT_PROJECT_ID, SUPPORTED_CHAIN, APPKIT_METADATA } from '~/utils/wallet-config'

// Default chain `name` values from @reown/appkit/networks (= viem) are
// "Arbitrum One" and "Arbitrum Sepolia" — bare names with no Mainnet /
// Testnet hint. The WalletConnect / AppKit chain picker renders this
// `name` field directly, so non-crypto-native users on the wrong chain
// can't tell at a glance which one is real money. Spread + override
// before passing to AppKit so the picker shows the labelled version.
// (The Settings direct-wallet dropdown is a separate <select> that
// already has these labels hard-coded.)
const labelledArbitrumOne = { ...SUPPORTED_CHAIN, name: 'Arbitrum One (Mainnet)' }
const labelledArbitrumSepolia = { ...arbitrumSepolia, name: 'Arbitrum Sepolia (Testnet)' }

// WalletConnect explorer id for MetaMask (verified against
// explorer-api.walletconnect.com). Pinned as the only featured wallet so the
// connect modal presents just: the QR/URI option, MetaMask, and search —
// instead of the default explorer spread of recommended wallets. Any other
// wallet stays reachable via search or by scanning the QR.
const METAMASK_WALLET_ID = 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96'

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
      networks: [labelledArbitrumOne, labelledArbitrumSepolia],
    })

    const appkit = createAppKit({
      adapters: [wagmiAdapter],
      networks: [labelledArbitrumOne, labelledArbitrumSepolia],
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
      // Pin MetaMask as the sole featured wallet (see METAMASK_WALLET_ID
      // above). Deliberately NOT includeWalletIds — that would restrict the
      // All Wallets / search results to the listed ids and break search.
      featuredWalletIds: [METAMASK_WALLET_ID],
      // Drop the "Haven't got a wallet?" onboarding footer — one less block
      // between the user and the three things we present (QR, MetaMask,
      // search).
      enableWalletGuide: false,
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
    const { OptionsController, ApiController } = await import('@reown/appkit-controllers')
    OptionsController.setIsUniversalProvider(true)

    // Suppress the explorer "recommended wallets" rows so the connect list is
    // just the QR option + MetaMask. There is no public option for this:
    // AppKit fills a hard-coded budget of 4 wallet rows (ConnectorUtil
    // DISPLAYED_WALLETS_AMOUNT) with explorer recommendations after our one
    // featured wallet, and `includeWalletIds` — the only official filter —
    // would also restrict the All Wallets / search results, which must keep
    // finding any wallet. So blank the recommended state whenever a fetch
    // repopulates it (guarded, so the reset itself doesn't re-trigger).
    // `allRecommended` too: namespace filtering restores `recommended` from it.
    ApiController.subscribeKey('recommended', (wallets) => {
      if (wallets?.length) {
        ApiController.state.recommended = []
        ApiController.state.allRecommended = []
      }
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
