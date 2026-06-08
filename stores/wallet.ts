import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    paymentAddress: null as string | null,
    balance: null as string | null,
    ethBalance: null as string | null,
    antBalance: null as string | null,
    /** USDC balance read from the active chain. `null` while the read is in
     *  flight; an empty string ("") when the chain has no known USDC contract
     *  (e.g. Anvil devnet) so the UI can hide the row instead of showing 0. */
    usdcBalance: null as string | null,
    connected: false,
    /** True when the connected wallet is on a different chain than the one we
     *  read balances from / pay on (see `getActiveChainId`). The balance panel
     *  shows a "wrong network" banner so the user isn't confused by a figure
     *  that disagrees with their wallet's own (active-chain) balance — the
     *  root cause of GH #85 / V2-474. Only the AppKit/WalletConnect path sets
     *  this; the direct-key devnet wallet is always on the manifest chain. */
    wrongNetwork: false,
  }),

  getters: {
    earningsAddress(): string | null {
      const settings = useSettingsStore()
      return settings.earningsAddress
    },
  },

  actions: {
    async setEarningsAddress(address: string) {
      const settings = useSettingsStore()
      await settings.setEarningsAddress(address)
    },

    async disconnectWallet() {
      this.paymentAddress = null
      this.balance = null
      this.ethBalance = null
      this.antBalance = null
      this.usdcBalance = null
      this.connected = false
      this.wrongNetwork = false
    },
  },
})
