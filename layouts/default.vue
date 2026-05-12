<template>
  <div class="flex h-screen overflow-hidden">
    <AppSidebar />
    <div class="flex flex-1 flex-col overflow-hidden">
      <AppHeader />
      <div
        v-if="settingsStore.storageDirProbeError"
        class="border-b border-autonomi-error/40 bg-autonomi-error/10 px-6 py-2 text-xs text-autonomi-error"
        role="alert"
      >
        <span class="font-medium">Storage directory unwritable.</span>
        Adding a node will fail until you pick a working folder in
        <NuxtLink to="/settings" class="underline hover:text-autonomi-error/80">Settings</NuxtLink>.
        <span class="ml-2 font-mono text-autonomi-error/80">{{ settingsStore.storageDirProbeError }}</span>
      </div>
      <main class="flex-1 overflow-auto p-6">
        <slot />
      </main>
    </div>
    <ToastContainer />
    <UpdateDialog />
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'

const settingsStore = useSettingsStore()
</script>
