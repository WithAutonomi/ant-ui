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
  filesStore.setupProgressListeners()
  updaterStore.checkForUpdate()
  settingsStore.reconnectIndelible()
  // Listen for backend connection-status events so the UI reflects retry state.
  connectionStore.startListening()

  // Initialize autonomi client — when manifest present, pass custom config
  if (settingsStore.devnetActive) {
    // When the manifest supplied a private key, hand it to the Rust client
    // too — that flips uploads onto evmlib's wallet flow (`wallet_upload`),
    // bypassing the JS-side wagmi external-signer dance. evmlib auto-approves
    // the vault on first use, so no separate approval call is needed for the
    // wallet path. The JS-side wallet still gets initialised below for the
    // balance display in the header.
    const { getDevnetWalletKey } = await import('~/stores/settings')
    invoke('init_autonomi_client', {
      bootstrapPeers: settingsStore.devnetBootstrapPeers,
      evmRpcUrl: settingsStore.devnetRpcUrl,
      evmTokenAddress: settingsStore.devnetTokenAddress,
      evmVaultAddress: settingsStore.devnetVaultAddress,
      walletPrivateKey: getDevnetWalletKey(),
    }).catch((e) => {
      console.warn('Autonomi client init failed:', e)
    })

    // Init the JS-side direct wallet for balance display + WalletConnect
    // fallback. The Rust-side wallet (above) is what actually pays for
    // uploads in direct-key mode now, but the wagmi config still drives the
    // header balance widget and any user-initiated WalletConnect interaction.
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
