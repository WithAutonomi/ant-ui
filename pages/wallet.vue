<template>
  <div class="mx-auto max-w-2xl">
    <!-- Earnings Address -->
    <section class="mb-6 rounded-lg border border-autonomi-border p-5">
      <div class="mb-1 flex items-center justify-between">
        <h2 class="font-medium">{{ $t('wallet.earnings_heading') }}</h2>
        <button
          v-if="!editingEarnings"
          class="text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="startEditEarnings"
        >
          {{ $t('wallet.edit') }}
        </button>
      </div>
      <p class="mb-3 text-xs text-autonomi-muted">{{ $t('wallet.earnings_description') }}</p>

      <div v-if="!editingEarnings">
        <span v-if="walletStore.earningsAddress" class="font-mono text-sm">
          {{ walletStore.earningsAddress }}
        </span>
        <span v-else class="text-sm text-autonomi-warning">{{ $t('wallet.earnings_not_configured') }}</span>

        <!-- Suggest using payment wallet address (local mode only) -->
        <div
          v-if="!settingsStore.indelibleConnected && walletStore.connected && walletStore.paymentAddress && walletStore.earningsAddress !== walletStore.paymentAddress"
          class="mt-3 flex items-center justify-between gap-3 rounded-md border border-autonomi-blue/20 bg-autonomi-blue/5 px-3 py-2"
        >
          <span class="text-xs text-autonomi-muted">
            {{ $t('wallet.earnings_use_payment_prompt') }}
          </span>
          <button
            class="shrink-0 rounded-md bg-autonomi-blue px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
            @click="usePaymentAsEarnings"
          >
            {{ $t('wallet.earnings_use_payment_button', { address: truncateAddress(walletStore.paymentAddress) }) }}
          </button>
        </div>
      </div>

      <div v-else class="flex gap-2">
        <input
          ref="earningsInputEl"
          v-model="earningsInput"
          type="text"
          :placeholder="$t('wallet.earnings_placeholder')"
          class="flex-1 rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-sm text-autonomi-text focus:border-autonomi-blue focus:outline-none"
          @keyup.enter="saveEarnings"
          @keyup.escape="editingEarnings = false"
        />
        <button
          class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm text-white hover:opacity-90"
          @click="saveEarnings"
        >
          {{ $t('wallet.save') }}
        </button>
        <button
          class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted"
          @click="editingEarnings = false"
        >
          {{ $t('common.cancel') }}
        </button>
      </div>
    </section>

    <!-- Managed Storage Banner (Indelible mode) -->
    <section v-if="settingsStore.indelibleConnected" class="rounded-lg border border-green-500/20 bg-green-500/5 p-5">
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10 text-lg text-green-400">⬡</span>
        <div>
          <h2 class="font-medium text-green-400">{{ $t('wallet.managed_storage_heading') }}</h2>
          <i18n-t keypath="wallet.managed_storage_org" tag="p" class="text-sm text-autonomi-muted">
            <template #org>
              <span class="font-medium text-autonomi-text">{{ settingsStore.indelibleOrgName }}</span>
            </template>
          </i18n-t>
          <p class="mt-0.5 text-xs text-autonomi-muted">{{ $t('wallet.managed_storage_description') }}</p>
        </div>
      </div>
    </section>

    <!-- Payment Wallet (local mode only) -->
    <section v-if="!settingsStore.indelibleConnected" class="rounded-lg border border-autonomi-border p-5">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="font-medium">{{ $t('wallet.payment_wallet_heading') }}</h2>
          <p v-if="!walletStore.connected" class="text-xs text-autonomi-muted">{{ $t('wallet.payment_optional_hint') }}</p>
        </div>
      </div>

      <div class="mt-4">
        <div v-if="!walletStore.connected" class="flex flex-col items-center py-4">
          <p class="mb-3 text-sm text-autonomi-muted">{{ $t('wallet.connect_prompt') }}</p>
          <button
            class="rounded-md bg-autonomi-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            @click="openModal"
          >
            {{ $t('header.connect_wallet') }}
          </button>
          <p class="mt-2 text-xs text-autonomi-muted">
            {{ settingsStore.devnetChainId === arbitrumSepolia.id ? $t('wallet.network_arbitrum_sepolia') : $t('wallet.network_arbitrum_one') }}
          </p>
          <i18n-t keypath="wallet.import_key_hint" tag="p" class="mt-1 text-xs text-autonomi-muted">
            <template #link>
              <NuxtLink to="/settings" class="text-autonomi-blue hover:underline">{{ $t('wallet.import_key_hint_link_text') }}</NuxtLink>
            </template>
          </i18n-t>
        </div>

        <div v-else class="space-y-3">
          <div class="flex items-center justify-between text-sm">
            <span class="text-autonomi-muted">{{ $t('wallet.address_label') }}</span>
            <span class="font-mono text-xs">{{ walletStore.paymentAddress }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-autonomi-muted">{{ $t('wallet.eth_balance_label') }}</span>
            <span class="font-mono text-xs">{{ walletStore.ethBalance ?? '...' }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-autonomi-muted">{{ $t('wallet.ant_balance_label') }}</span>
            <span class="font-mono text-xs text-autonomi-blue">{{ walletStore.antBalance ?? '...' }}</span>
          </div>
          <div v-if="walletStore.usdcBalance !== ''" class="flex items-center justify-between text-sm">
            <span class="text-autonomi-muted">{{ $t('wallet.usdc_balance_label') }}</span>
            <span class="font-mono text-xs">{{ walletStore.usdcBalance ?? '...' }}</span>
          </div>
          <div class="flex gap-2">
            <button
              class="flex-1 rounded-md border border-autonomi-border py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="refreshBalances"
            >
              {{ $t('wallet.refresh_balances') }}
            </button>
            <button
              class="flex-1 rounded-md border border-autonomi-border py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="disconnect"
            >
              {{ $t('wallet.disconnect') }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { arbitrumSepolia } from 'viem/chains'
import { useI18n } from 'vue-i18n'
import { useWalletStore } from '~/stores/wallet'
import { truncateAddress } from '~/utils/formatters'
import { isValidEthAddress } from '~/utils/validators'
import { useSettingsStore } from '~/stores/settings'
import { useToastStore } from '~/stores/toasts'

const { t } = useI18n()
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
  // AppKit wallet — call refreshBalances directly. Calling useWallet() here
  // would re-install the AppKit watcher and momentarily flicker the wallet
  // into a disconnected state.
  if ($appkitReady) {
    const { refreshBalances: refresh } = await import('~/composables/useWallet')
    await refresh()
  }
}

function openModal() {
  if ($appkitReady && $appkit) {
    $appkit.open()
  } else {
    navigateTo('/settings')
    toastStore.add(t('wallet.toast.import_key_in_settings'), 'info')
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
    toastStore.add(t('wallet.toast.invalid_address'), 'error')
    return
  }
  walletStore.setEarningsAddress(addr)
  editingEarnings.value = false
  toastStore.add(t('wallet.toast.earnings_saved'), 'info')
}

function usePaymentAsEarnings() {
  if (walletStore.paymentAddress) {
    walletStore.setEarningsAddress(walletStore.paymentAddress)
    toastStore.add(t('wallet.toast.earnings_set_to_payment'), 'info')
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
  toastStore.add(t('wallet.toast.wallet_disconnected'), 'info')
}

</script>
