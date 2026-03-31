<template>
  <aside class="flex h-full w-56 flex-col border-r border-autonomi-border bg-autonomi-surface">
    <!-- Logo / Brand -->
    <div class="flex items-center gap-3 px-4 py-5">
      <IconsAutonomiLogo :size="28" />
      <span class="text-lg font-semibold tracking-tight text-autonomi-text">Autonomi</span>
    </div>

    <!-- Main navigation -->
    <nav class="flex-1 px-2 py-2">
      <!-- Update banner -->
      <button
        v-if="updaterStore.available"
        class="mb-2 flex w-full items-center gap-2 rounded-lg bg-amber-400 px-3 py-2.5 text-left text-sm font-semibold text-gray-900 shadow-md shadow-amber-400/25 transition-all hover:bg-amber-300 active:scale-[0.98]"
        @click="onUpdateClick"
      >
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold uppercase tracking-wide">Update Available</div>
          <div class="truncate text-xs font-medium opacity-80">v{{ updaterStore.version }}</div>
        </div>
        <span v-if="updaterStore.installing" class="h-4 w-4 animate-spin rounded-full border-2 border-gray-900/30 border-t-gray-900" />
      </button>

      <NuxtLink
        v-for="item in mainNav"
        :key="item.path"
        :to="item.path"
        class="mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
        :class="isActive(item.path)
          ? 'bg-autonomi-blue/10 text-autonomi-blue font-medium'
          : 'text-autonomi-muted hover:bg-autonomi-border/50 hover:text-autonomi-text'"
      >
        <span class="text-base">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </NuxtLink>
    </nav>

    <!-- Settings at bottom -->
    <div class="border-t border-autonomi-border px-2 py-2">
      <NuxtLink
        to="/settings"
        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
        :class="isActive('/settings')
          ? 'bg-autonomi-blue/10 text-autonomi-blue font-medium'
          : 'text-autonomi-muted hover:bg-autonomi-border/50 hover:text-autonomi-text'"
      >
        <span class="text-base">⚙</span>
        <span>Settings</span>
      </NuxtLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useNodesStore } from '~/stores/nodes'
import { useFilesStore } from '~/stores/files'
import { useUpdaterStore } from '~/stores/updater'

const route = useRoute()
const nodesStore = useNodesStore()
const filesStore = useFilesStore()
const updaterStore = useUpdaterStore()

const mainNav = computed(() => [
  { path: '/', label: 'Nodes', icon: '⬡' },
  { path: '/files', label: 'Files', icon: '◫' },
  { path: '/wallet', label: 'Wallet', icon: '◎' },
])

function isActive(path: string) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

function onUpdateClick() {
  if (updaterStore.installing) return
  updaterStore.showDialog = true
}
</script>
