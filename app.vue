<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { useWallet } from '~/composables/useWallet'
import { useSettingsStore } from '~/stores/settings'
import { useUpdaterStore } from '~/stores/updater'
import { useNodesStore } from '~/stores/nodes'
import { useFilesStore } from '~/stores/files'
import { useConnectionStore } from '~/stores/connection'

useHead({
  title: 'Autonomi',
  htmlAttrs: { class: 'dark' },
  bodyAttrs: { class: 'bg-autonomi-dark text-autonomi-text' },
})

// Load persisted config on startup, then init nodes (needs daemon URL from config)
const settingsStore = useSettingsStore()
const updaterStore = useUpdaterStore()
const nodesStore = useNodesStore()
const filesStore = useFilesStore()
const connectionStore = useConnectionStore()

onMounted(async () => {
  await settingsStore.loadConfig()
  await settingsStore.loadDevnetManifest()
  nodesStore.init()
  filesStore.loadHistory()
  updaterStore.checkForUpdate()
  settingsStore.reconnectIndelible()
  // Listen for backend connection-status events so the UI reflects retry state.
  connectionStore.startListening()

  // Initialize autonomi client — when manifest present, pass custom config
  if (settingsStore.devnetActive) {
    invoke('init_autonomi_client', {
      bootstrapPeers: settingsStore.devnetBootstrapPeers,
      evmRpcUrl: settingsStore.devnetRpcUrl,
      evmTokenAddress: settingsStore.devnetTokenAddress,
      evmVaultAddress: settingsStore.devnetVaultAddress,
    }).catch((e) => {
      console.warn('Autonomi client init failed:', e)
    })

    // Only bypass WalletConnect for local Anvil devnet, not Sepolia
    if (!settingsStore.devnetIsSepolia) {
      const { initDevnetWallet } = await import('~/composables/useDevnetWallet')
      initDevnetWallet()
    }
  } else {
    invoke('init_autonomi_client').catch((e) => {
      console.warn('Autonomi client init failed:', e)
    })
  }
})

onUnmounted(() => {
  nodesStore.cleanup()
})

// Initialize wallet watcher at app level so balance sync runs globally
useWallet()
</script>
