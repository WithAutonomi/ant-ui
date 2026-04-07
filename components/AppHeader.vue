<template>
  <header class="flex h-12 items-center justify-between border-b border-autonomi-border bg-autonomi-surface px-4">
    <!-- Page title -->
    <h1 class="text-sm font-medium text-autonomi-text">{{ pageTitle }}</h1>

    <!-- Right side: status indicators + wallet -->
    <div class="flex items-center gap-4">
      <!-- Active transfers indicator -->
      <div v-if="filesStore.hasActiveTransfers" class="flex items-center gap-2 text-xs">
        <span class="text-autonomi-blue">↑↓</span>
        <span class="text-autonomi-muted">
          {{ filesStore.pinnedFiles.length }} active
        </span>
      </div>

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
          Connect Wallet
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

const route = useRoute()
const nodesStore = useNodesStore()
const filesStore = useFilesStore()
const walletStore = useWalletStore()
const settingsStore = useSettingsStore()
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

const pageTitle = computed(() => {
  const titles: Record<string, string> = {
    '/': 'Nodes',
    '/files': 'Files',
    '/wallet': 'Wallet',
    '/settings': 'Settings',
  }
  return titles[route.path] ?? 'Autonomi'
})

</script>
