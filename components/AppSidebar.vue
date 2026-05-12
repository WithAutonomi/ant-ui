<template>
  <aside class="flex h-full w-56 flex-col border-r border-autonomi-border bg-autonomi-surface">
    <!-- Logo / Brand -->
    <div class="flex items-center gap-3 px-4 py-5">
      <IconsAutonomiLogo :size="28" />
      <span class="text-lg font-semibold tracking-tight text-autonomi-text">Autonomi</span>
    </div>

    <!-- Main navigation -->
    <nav class="flex-1 px-2 py-2">
      <!-- Pre-release build indicator. Shown whenever the running version
           contains an -rc./-beta./-alpha. suffix, regardless of whether the
           pre-release auto-update channel is enabled. Distinct teal palette
           so it doesn't clash with the amber DEVNET / SEPOLIA TESTNET badge
           when both apply. -->
      <div
        v-if="isPrereleaseBuild"
        class="mb-2 rounded-md bg-teal-500/10 border border-teal-500/20 px-3 py-1.5 text-center text-xs font-medium text-teal-400"
      >
        {{ $t('sidebar.pre_release') }}
      </div>

      <!-- Network mode indicator -->
      <div
        v-if="settingsStore.devnetActive && networkLabelKey"
        class="mb-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-center text-xs font-medium text-amber-400"
      >
        {{ $t(networkLabelKey) }}
      </div>

      <!-- Update banner -->
      <button
        v-if="updaterStore.available"
        class="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-gray-900 shadow-md transition-all active:scale-[0.98]"
        :class="updaterStore.isPrerelease
          ? 'bg-teal-400 shadow-teal-400/25 hover:bg-teal-300'
          : 'bg-amber-400 shadow-amber-400/25 hover:bg-amber-300'"
        @click="onUpdateClick"
      >
        <div class="min-w-0 flex-1">
          <div
            v-if="updaterStore.isPrerelease"
            class="text-[10px] font-bold uppercase tracking-wider opacity-70"
          >
            {{ $t('sidebar.update_pre_release_tag') }}
          </div>
          <div class="text-xs font-bold uppercase tracking-wide">{{ $t('sidebar.update_available') }}</div>
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
        <span>{{ $t(item.labelKey) }}</span>
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
        <span>{{ $t('nav.settings') }}</span>
      </NuxtLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { arbitrumSepolia } from 'viem/chains'
import { invoke } from '@tauri-apps/api/core'
import { useNodesStore } from '~/stores/nodes'
import { useFilesStore } from '~/stores/files'
import { useUpdaterStore } from '~/stores/updater'
import { ANVIL_CHAIN_ID } from '~/utils/constants'

const route = useRoute()
const nodesStore = useNodesStore()
const filesStore = useFilesStore()
const updaterStore = useUpdaterStore()
const settingsStore = useSettingsStore()

const currentVersion = ref<string | null>(null)
onMounted(async () => {
  try {
    currentVersion.value = await invoke<string>('get_app_version')
  } catch {
    currentVersion.value = null
  }
})

// Mirror the `release.yml` and `updater_channel::looks_like_prerelease`
// detection — anything tagged -rc.N / -beta.N / -alpha.N is a pre-release.
const isPrereleaseBuild = computed(() =>
  /-(?:rc|beta|alpha)\./.test(currentVersion.value ?? ''),
)

const networkLabelKey = computed<string | null>(() => {
  switch (settingsStore.devnetChainId) {
    case arbitrumSepolia.id: return 'sidebar.network_sepolia'
    case ANVIL_CHAIN_ID: return 'sidebar.network_devnet'
    default: return null  // mainnet or unset — no badge
  }
})

const mainNav = computed(() => [
  { path: '/', labelKey: 'nav.nodes', icon: '⬡' },
  { path: '/files', labelKey: 'nav.files', icon: '◫' },
  { path: '/wallet', labelKey: 'nav.wallet', icon: '◎' },
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
