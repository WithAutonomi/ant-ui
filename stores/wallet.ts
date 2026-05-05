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
    },
  },
})
