<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { useWallet } from '~/composables/useWallet'
import { useTheme } from '~/composables/useTheme'
import { useSettingsStore } from '~/stores/settings'
import { useUpdaterStore } from '~/stores/updater'
import { useNodesStore } from '~/stores/nodes'
import { useFilesStore } from '~/stores/files'
import { useConnectionStore } from '~/stores/connection'

useHead({
  title: 'Autonomi',
  bodyAttrs: { class: 'bg-autonomi-dark text-autonomi-text' },
})

// Reactively sync html class + AppKit theme with settingsStore.themeMode.
// Dark is the default — the class only flips once loadConfig resolves with
// a persisted light preference, so the first paint always uses dark values.
useTheme()

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

    // Auto-activate the direct-key wallet whenever the manifest supplied a
    // `wallet_private_key` (loadDevnetManifest stashes it and flips
    // _devnetWalletKeySet). Previously gated on ANVIL_CHAIN_ID only, so a
    // Sepolia manifest with a pre-funded key silently left the wallet
    // disconnected — the key sat in storage and every upload hit the
    // no-wallet path. Manifests *without* a key still fall through to
    // WalletConnect, and no-manifest (production) is unaffected since this
    // entire block is gated on `devnetActive`.
    if (settingsStore._devnetWalletKeySet) {
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
