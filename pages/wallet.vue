<template>
  <div class="mx-auto max-w-2xl">
    <!-- Earnings Address -->
    <section class="mb-6 rounded-lg border border-autonomi-border p-5">
      <div class="mb-1 flex items-center justify-between">
        <h2 class="font-medium">Earnings Address</h2>
        <button
          v-if="!editingEarnings"
          class="text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="startEditEarnings"
        >
          Edit
        </button>
      </div>
      <p class="mb-3 text-xs text-autonomi-muted">Where your node earnings are sent</p>

      <div v-if="!editingEarnings">
        <span v-if="walletStore.earningsAddress" class="font-mono text-sm">
          {{ walletStore.earningsAddress }}
        </span>
        <span v-else class="text-sm text-autonomi-warning">Not configured</span>

        <!-- Suggest using payment wallet address (local mode only) -->
        <div
          v-if="!settingsStore.indelibleConnected && walletStore.connected && walletStore.paymentAddress && walletStore.earningsAddress !== walletStore.paymentAddress"
          class="mt-3 flex items-center gap-3 rounded-md border border-autonomi-blue/20 bg-autonomi-blue/5 px-3 py-2"
        >
          <span class="text-xs text-autonomi-muted">
            Use your connected wallet address for earnings?
          </span>
          <button
            class="rounded-md bg-autonomi-blue px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
            @click="usePaymentAsEarnings"
          >
            Use {{ truncateAddress(walletStore.paymentAddress) }}
          </button>
        </div>
      </div>

      <div v-else class="flex gap-2">
        <input
          ref="earningsInputEl"
          v-model="earningsInput"
          type="text"
          placeholder="0x..."
          class="flex-1 rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-sm text-autonomi-text focus:border-autonomi-blue focus:outline-none"
          @keyup.enter="saveEarnings"
          @keyup.escape="editingEarnings = false"
        />
        <button
          class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm text-white hover:opacity-90"
          @click="saveEarnings"
        >
          Save
        </button>
        <button
          class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted"
          @click="editingEarnings = false"
        >
          Cancel
        </button>
      </div>
    </section>

    <!-- Managed Storage Banner (Indelible mode) -->
    <section v-if="settingsStore.indelibleConnected" class="rounded-lg border border-green-500/20 bg-green-500/5 p-5">
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10 text-lg text-green-400">⬡</span>
        <div>
          <h2 class="font-medium text-green-400">Managed Storage</h2>
          <p class="text-sm text-autonomi-muted">
            Storage managed by <span class="font-medium text-autonomi-text">{{ settingsStore.indelibleOrgName }}</span>
          </p>
          <p class="mt-0.5 text-xs text-autonomi-muted">Uploads are routed through your organisation's Indelible gateway. No local wallet required.</p>
        </div>
      </div>
    </section>

    <!-- Payment Wallet (local mode only) -->
    <section v-if="!settingsStore.indelibleConnected" class="rounded-lg border border-autonomi-border p-5">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="font-medium">Payment Wallet</h2>
          <p v-if="!walletStore.connected" class="text-xs text-autonomi-muted">Optional — required for file uploads</p>
        </div>
      </div>

      <div class="mt-4">
        <div v-if="!walletStore.connected" class="flex flex-col items-center py-4">
          <p class="mb-3 text-sm text-autonomi-muted">Connect a wallet to pay for file storage</p>
          <button
            class="rounded-md bg-autonomi-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            @click="openModal"
          >
            Connect Wallet
          </button>
          <p class="mt-2 text-xs text-autonomi-muted">
            {{ settingsStore.devnetIsSepolia ? 'Arbitrum Sepolia testnet' : 'Arbitrum One network required' }}
          </p>
          <p class="mt-1 text-xs text-autonomi-muted">
            Or import a private key in <NuxtLink to="/settings" class="text-autonomi-blue hover:underline">Settings &gt; Advanced</NuxtLink>
          </p>
        </div>

        <div v-else class="space-y-3">
          <div class="flex items-center justify-between text-sm">
            <span class="text-autonomi-muted">Address</span>
            <span class="font-mono text-xs">{{ walletStore.paymentAddress }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-autonomi-muted">ETH Balance</span>
            <span class="font-mono text-xs">{{ walletStore.ethBalance ?? '...' }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-autonomi-muted">ANT Balance</span>
            <span class="font-mono text-xs text-autonomi-blue">{{ walletStore.antBalance ?? '...' }}</span>
          </div>
          <div class="flex gap-2">
            <button
              class="flex-1 rounded-md border border-autonomi-border py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="refreshBalances"
            >
              Refresh Balances
            </button>
            <button
              class="flex-1 rounded-md border border-autonomi-border py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="disconnect"
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useWalletStore } from '~/stores/wallet'
import { truncateAddress } from '~/utils/formatters'
import { isValidEthAddress } from '~/utils/validators'
import { useSettingsStore } from '~/stores/settings'
import { useToastStore } from '~/stores/toasts'
const walletStore = useWalletStore()
const settingsStore = useSettingsStore()
const toastStore = useToastStore()
const { $appkit, $appkitReady } = useNuxtApp()

async function refreshBalances() {
  // Direct wallet — use the devnet wallet's refresh
  const devnetConfig = getDevnetWagmiConfig?.()
  if (devnetConfig && walletStore.paymentAddress) {
    const { initDevnetWallet } = await import('~/composables/useDevnetWallet')
    initDevnetWallet() // re-fetches balances
    return
  }
  // AppKit wallet
  if ($appkitReady) {
    const { useWallet } = await import('~/composables/useWallet')
    const wallet = useWallet()
    wallet.refreshBalances()
  }
}

function openModal() {
  if ($appkitReady && $appkit) {
    $appkit.open()
  } else {
    navigateTo('/settings')
    toastStore.add('Import a private key in Settings > Advanced', 'info')
  }
}

const editingEarnings = ref(false)
const earningsInput = ref('')
const earningsInputEl = ref<HTMLInputElement | null>(null)

function startEditEarnings() {
  earningsInput.value = walletStore.earningsAddress ?? ''
  editingEarnings.value = true
  nextTick(() => earningsInputEl.value?.focus())
}

function saveEarnings() {
  const addr = earningsInput.value.trim()
  if (!isValidEthAddress(addr)) {
    toastStore.add('Invalid address: must be 0x + 40 hex characters', 'error')
    return
  }
  walletStore.setEarningsAddress(addr)
  editingEarnings.value = false
  toastStore.add('Earnings address saved', 'info')
}

function usePaymentAsEarnings() {
  if (walletStore.paymentAddress) {
    walletStore.setEarningsAddress(walletStore.paymentAddress)
    toastStore.add('Earnings address set to payment wallet', 'info')
  }
}

async function disconnect() {
  if ($appkitReady && $appkit) {
    try {
      const { useDisconnect } = await import('@reown/appkit/vue')
      const { disconnect: doDisconnect } = useDisconnect()
      await doDisconnect()
    } catch {}
  }
  walletStore.disconnectWallet()
  toastStore.add('Wallet disconnected', 'info')
}

</script>
