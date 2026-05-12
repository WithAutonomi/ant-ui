<template>
  <header class="flex h-12 items-center justify-between border-b border-autonomi-border bg-autonomi-surface px-4">
    <!-- Page title -->
    <h1 class="text-sm font-medium text-autonomi-text">{{ $t(pageTitleKey) }}</h1>

    <!-- Right side: status indicators + wallet -->
    <div class="flex items-center gap-4">
      <!-- Active transfers indicator -->
      <div v-if="filesStore.hasActiveTransfers" class="flex items-center gap-2 text-xs">
        <span class="text-autonomi-blue">↑↓</span>
        <span class="text-autonomi-muted">
          {{ $t('header.active_transfers', { count: filesStore.pinnedFiles.length }) }}
        </span>
      </div>

      <!-- Network connection indicator -->
      <div
        v-if="connectionStore.isConnecting"
        class="flex items-center gap-2 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted"
        :title="$t('header.connecting_tooltip')"
      >
        <div class="h-2.5 w-2.5 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
        <span>{{ $t('header.connecting') }}</span>
      </div>
      <div
        v-else-if="connectionStore.isConnected"
        class="flex items-center gap-2 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-text"
        :title="$t('header.connected_tooltip')"
      >
        <span class="text-autonomi-success">●</span>
        <span>{{ $t('header.connected') }}</span>
      </div>
      <button
        v-else-if="connectionStore.hasFailed"
        class="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
        :title="$t('header.offline_tooltip')"
        @click="connectionStore.retry()"
      >
        <span>●</span>
        <span>{{ $t('header.offline') }}</span>
      </button>

      <!-- Indelible indicator (replaces wallet when connected) -->
      <div
        v-if="settingsStore.indelibleConnected"
        class="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-2.5 py-1 text-xs"
      >
        <span class="text-green-400">●</span>
        <span class="text-green-400 font-medium">{{ settingsStore.indelibleOrgName }}</span>
      </div>

      <!-- Wallet button (local mode only) -->
      <template v-else>
        <button
          v-if="walletStore.connected"
          class="flex items-center gap-2 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-text hover:bg-autonomi-border/50"
          @click="openModal"
        >
          <span class="text-autonomi-success">●</span>
          <span class="font-mono">{{ truncateAddress(walletStore.paymentAddress ?? '') }}</span>
        </button>
        <button
          v-else
          class="rounded-md bg-autonomi-blue px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
          @click="openModal"
        >
          {{ $t('header.connect_wallet') }}
        </button>
      </template>
    </div>
  </header>
</template>

<script setup lang="ts">
import { truncateAddress } from '~/utils/formatters'
import { useNodesStore } from '~/stores/nodes'
import { useFilesStore } from '~/stores/files'
import { useWalletStore } from '~/stores/wallet'
import { useSettingsStore } from '~/stores/settings'
import { useConnectionStore } from '~/stores/connection'

const route = useRoute()
const nodesStore = useNodesStore()
const filesStore = useFilesStore()
const walletStore = useWalletStore()
const settingsStore = useSettingsStore()
const connectionStore = useConnectionStore()
const { $appkit, $appkitReady } = useNuxtApp()

function openModal() {
  // Direct wallet — navigate to wallet page instead of AppKit modal
  if (walletStore.connected && !$appkitReady) {
    navigateTo('/wallet')
    return
  }
  if ($appkitReady && $appkit) {
    $appkit.open()
  }
}

const pageTitleKey = computed(() => {
  const keys: Record<string, string> = {
    '/': 'nav.nodes',
    '/files': 'nav.files',
    '/wallet': 'nav.wallet',
    '/settings': 'nav.settings',
  }
  return keys[route.path] ?? 'header.title'
})

</script>
