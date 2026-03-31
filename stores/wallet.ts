import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    paymentAddress: null as string | null,
    balance: null as string | null,
    ethBalance: null as string | null,
    antBalance: null as string | null,
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
      this.connected = false
    },
  },
})
