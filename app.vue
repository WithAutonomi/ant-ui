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

onMounted(async () => {
  await settingsStore.loadConfig()
  nodesStore.init()
  filesStore.loadHistory()
  updaterStore.checkForUpdate()
  // Reconnect to Indelible if credentials are stored
  settingsStore.reconnectIndelible()
  // Initialize autonomi client (non-blocking — file ops degrade gracefully if unavailable)
  invoke('init_autonomi_client').catch((e) => {
    console.warn('Autonomi client init failed (file ops will use mock):', e)
  })
})

onUnmounted(() => {
  nodesStore.cleanup()
})

// Initialize wallet watcher at app level so balance sync runs globally
useWallet()
</script>
