import { createAppKit } from '@reown/appkit/vue'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { WALLETCONNECT_PROJECT_ID, SUPPORTED_CHAIN, APPKIT_METADATA } from '~/utils/wallet-config'

export default defineNuxtPlugin(() => {
  try {
    const wagmiAdapter = new WagmiAdapter({
      projectId: WALLETCONNECT_PROJECT_ID,
      networks: [SUPPORTED_CHAIN],
    })

    const appkit = createAppKit({
      adapters: [wagmiAdapter],
      networks: [SUPPORTED_CHAIN],
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: APPKIT_METADATA,
      features: {
        analytics: false,
        email: false,
        socials: false,
      },
      themeMode: 'dark',
    })

    return {
      provide: {
        appkit,
        wagmiAdapter,
        appkitReady: true,
      },
    }
  } catch (err) {
    console.error('AppKit initialization failed:', err)
    return {
      provide: {
        appkit: null as any,
        wagmiAdapter: null as any,
        appkitReady: false,
      },
    }
  }
})
