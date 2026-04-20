<template>
  <div class="mx-auto max-w-2xl space-y-4">
    <!-- Indelible Enterprise (shown at top when connected) -->
    <div v-if="settingsStore.indelibleConnected" class="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
      <div class="flex items-center justify-between">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-medium text-green-400">Indelible Enterprise</h3>
          <p class="text-xs text-autonomi-muted">Connected to managed storage gateway</p>
        </div>
        <span class="ml-3 shrink-0 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400">
          Connected
        </span>
      </div>
      <div class="mt-3 space-y-2">
        <div class="rounded-md bg-autonomi-dark px-3 py-2">
          <p class="text-xs text-autonomi-muted">Server</p>
          <p class="truncate font-mono text-xs text-autonomi-text">{{ settingsStore.indelibleUrl }}</p>
        </div>
        <div class="rounded-md bg-autonomi-dark px-3 py-2">
          <p class="text-xs text-autonomi-muted">Signed in as</p>
          <p class="text-xs text-autonomi-text">{{ settingsStore.indelibleOrgName }}</p>
          <p class="text-xs text-autonomi-muted">{{ settingsStore.indelibleUserEmail }}</p>
        </div>
        <button
          class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="disconnectIndelible"
        >
          Disconnect
        </button>
      </div>
    </div>

    <!-- Storage Directory -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium">Storage Directory</h3>
        <p class="text-xs text-autonomi-muted">Where node data is stored on disk</p>
        <p class="mt-0.5 truncate font-mono text-xs text-autonomi-muted">{{ settingsStore.storageDir ?? 'Default' }}</p>
      </div>
      <button
        class="ml-3 shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
        @click="pickStorageDir"
      >
        Browse
      </button>
    </div>

    <!-- Downloads Directory -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium">Downloads Directory</h3>
        <p class="text-xs text-autonomi-muted">Where downloaded files are saved</p>
        <p class="mt-0.5 truncate font-mono text-xs text-autonomi-muted">{{ settingsStore.downloadDir ?? 'Not set' }}</p>
      </div>
      <button
        class="ml-3 shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
        @click="pickDownloadDir"
      >
        Browse
      </button>
    </div>

    <!-- Bell on Critical -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div>
        <h3 class="text-sm font-medium">Alert Sound</h3>
        <p class="text-xs text-autonomi-muted">Play sound on critical node failures</p>
      </div>
      <button
        role="switch"
        :aria-checked="settingsStore.bellOnCritical"
        aria-label="Toggle alert sound"
        class="relative h-6 w-11 rounded-full transition-colors"
        :class="settingsStore.bellOnCritical ? 'bg-autonomi-blue' : 'bg-autonomi-border'"
        @click="settingsStore.toggleBell()"
      >
        <span
          class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
          :class="settingsStore.bellOnCritical ? 'translate-x-5' : ''"
        />
      </button>
    </div>

    <!-- Appearance -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div>
        <h3 class="text-sm font-medium">Light Mode</h3>
        <p class="text-xs text-autonomi-muted">Switch between dark and light themes</p>
      </div>
      <button
        role="switch"
        :aria-checked="settingsStore.themeMode === 'light'"
        aria-label="Toggle light mode"
        class="relative h-6 w-11 rounded-full transition-colors"
        :class="settingsStore.themeMode === 'light' ? 'bg-autonomi-blue' : 'bg-autonomi-border'"
        @click="settingsStore.setThemeMode(settingsStore.themeMode === 'light' ? 'dark' : 'light')"
      >
        <span
          class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
          :class="settingsStore.themeMode === 'light' ? 'translate-x-5' : ''"
        />
      </button>
    </div>

    <!-- Advanced -->
    <div>
      <button
        class="text-xs text-autonomi-muted hover:text-autonomi-text"
        :aria-expanded="showAdvanced"
        @click="showAdvanced = !showAdvanced"
      >
        {{ showAdvanced ? '▾ Hide Advanced' : '▸ Show Advanced' }}
      </button>
      <div v-if="showAdvanced" class="mt-2 space-y-4">

        <!-- Indelible Enterprise Connection (only show setup when not connected) -->
        <div v-if="!settingsStore.indelibleConnected" class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">Indelible Enterprise</h3>
              <p class="text-xs text-autonomi-muted">Connect to a self-hosted Indelible gateway for managed storage</p>
            </div>
            <span
              v-if="settingsStore.indelibleConnected"
              class="ml-3 shrink-0 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400"
            >
              Connected
            </span>
          </div>

          <!-- Connected state -->
          <div v-if="settingsStore.indelibleConnected" class="mt-3 space-y-2">
            <div class="rounded-md bg-autonomi-dark px-3 py-2">
              <p class="text-xs text-autonomi-muted">Server</p>
              <p class="truncate font-mono text-xs text-autonomi-text">{{ settingsStore.indelibleUrl }}</p>
            </div>
            <div class="rounded-md bg-autonomi-dark px-3 py-2">
              <p class="text-xs text-autonomi-muted">Signed in as</p>
              <p class="text-xs text-autonomi-text">{{ settingsStore.indelibleOrgName }}</p>
              <p class="text-xs text-autonomi-muted">{{ settingsStore.indelibleUserEmail }}</p>
            </div>
            <button
              class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="disconnectIndelible"
            >
              Disconnect
            </button>
          </div>

          <!-- Setup form -->
          <div v-else-if="editingIndelible" class="mt-3 space-y-3">
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">Server URL</label>
              <input
                v-model="indelibleUrlInput"
                type="text"
                placeholder="https://files.acme.com"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-xs text-autonomi-text placeholder-autonomi-muted focus:border-autonomi-blue focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">API Key</label>
              <input
                v-model="indelibleApiKeyInput"
                type="password"
                autocomplete="off"
                placeholder="Your API token"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-xs text-autonomi-text placeholder-autonomi-muted focus:border-autonomi-blue focus:outline-none"
              />
            </div>
            <div v-if="indelibleError" class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {{ indelibleError }}
            </div>
            <div class="flex gap-2">
              <button
                :disabled="indelibleTesting || !indelibleUrlInput || !indelibleApiKeyInput"
                class="rounded-md bg-autonomi-blue px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                @click="testIndelible"
              >
                {{ indelibleTesting ? 'Testing...' : 'Test & Connect' }}
              </button>
              <button
                class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
                @click="editingIndelible = false"
              >
                Cancel
              </button>
            </div>
          </div>

          <!-- Connect button -->
          <div v-else class="mt-3">
            <button
              class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="startEditIndelible"
            >
              Configure Connection
            </button>
          </div>
        </div>

        <!-- Direct Wallet (private key) -->
        <div class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">Direct Wallet</h3>
              <p class="text-xs text-autonomi-muted">Connect with a private key (bypasses WalletConnect)</p>
            </div>
            <span
              v-if="walletStore.connected && directWalletActive"
              class="ml-3 shrink-0 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400"
            >
              Connected
            </span>
          </div>

          <div v-if="walletStore.connected && directWalletActive" class="mt-3 space-y-2">
            <div class="rounded-md bg-autonomi-dark px-3 py-2">
              <p class="text-xs text-autonomi-muted">Address</p>
              <p class="truncate font-mono text-xs text-autonomi-text">{{ walletStore.paymentAddress }}</p>
            </div>
            <button
              class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="disconnectDirectWallet"
            >
              Disconnect
            </button>
          </div>

          <div v-else-if="editingDirectWallet" class="mt-3 space-y-3">
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">Network</label>
              <select
                v-model="directWalletNetwork"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 text-xs text-autonomi-text focus:border-autonomi-blue focus:outline-none"
              >
                <option value="arbitrum-sepolia">Arbitrum Sepolia (testnet)</option>
                <option value="arbitrum">Arbitrum One (mainnet)</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">Private Key</label>
              <input
                v-model="directWalletKeyInput"
                type="password"
                autocomplete="off"
                placeholder="0x... or raw hex"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-xs text-autonomi-text placeholder-autonomi-muted focus:border-autonomi-blue focus:outline-none"
                @keyup.enter="connectDirectWallet"
              />
            </div>
            <div v-if="directWalletError" class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {{ directWalletError }}
            </div>
            <div class="flex gap-2">
              <button
                :disabled="!directWalletKeyInput"
                class="rounded-md bg-autonomi-blue px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                @click="connectDirectWallet"
              >
                Connect
              </button>
              <button
                class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
                @click="editingDirectWallet = false"
              >
                Cancel
              </button>
            </div>
          </div>

          <div v-else class="mt-3">
            <button
              class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="editingDirectWallet = true; directWalletError = ''"
            >
              Import Private Key
            </button>
          </div>
        </div>

        <!-- Rescue Datamaps -->
        <div class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">Rescue Datamaps</h3>
              <p class="text-xs text-autonomi-muted">
                Re-import private-upload datamaps that exist on disk but are no longer in your upload history
                (e.g. after clearing history or reinstalling the app).
              </p>
            </div>
            <button
              class="shrink-0 rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text disabled:opacity-50"
              :disabled="rescueScanning"
              @click="scanOrphans"
            >
              {{ rescueScanning ? 'Scanning...' : 'Scan' }}
            </button>
          </div>

          <div v-if="rescueScanned" class="mt-3">
            <div v-if="orphanDatamaps.length === 0" class="rounded-md border border-dashed border-autonomi-border px-3 py-4 text-center text-xs text-autonomi-muted">
              No orphaned datamaps found.
            </div>
            <div v-else class="space-y-2">
              <div class="max-h-48 overflow-y-auto rounded-md border border-autonomi-border">
                <ul class="divide-y divide-autonomi-border">
                  <li
                    v-for="orphan in orphanDatamaps"
                    :key="orphan.path"
                    class="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <div class="min-w-0">
                      <div class="truncate text-autonomi-text">{{ orphan.suggested_name }}</div>
                      <div class="truncate font-mono text-[11px] text-autonomi-muted">
                        {{ orphan.path }}
                      </div>
                    </div>
                    <div class="shrink-0 text-right text-[11px] text-autonomi-muted">
                      {{ formatShortDate(orphan.modified_at) }}
                    </div>
                  </li>
                </ul>
              </div>
              <button
                class="rounded-md bg-autonomi-blue px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                :disabled="rescueImporting"
                @click="importOrphans"
              >
                {{ rescueImporting ? 'Importing...' : `Import ${orphanDatamaps.length} datamap${orphanDatamaps.length === 1 ? '' : 's'}` }}
              </button>
            </div>
          </div>
        </div>

        <!-- Diagnostics -->
        <div class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-medium">Diagnostics</h3>
              <p class="text-xs text-autonomi-muted">{{ errorLogStore.entries.length }} log entries ({{ errorLogStore.errors.length }} errors)</p>
            </div>
            <div class="flex gap-2">
              <button
                class="shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
                @click="copyDiagnostics"
              >
                Copy to Clipboard
              </button>
              <button
                v-if="errorLogStore.entries.length > 0"
                class="shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
                @click="clearLog"
              >
                Clear
              </button>
            </div>
          </div>
          <div v-if="showLog" class="mt-3 max-h-48 overflow-auto rounded-md bg-autonomi-dark p-3">
            <div
              v-for="entry in errorLogStore.recent"
              :key="entry.id"
              class="font-mono text-[11px] leading-relaxed"
              :class="{
                'text-autonomi-error': entry.level === 'error',
                'text-autonomi-warning': entry.level === 'warning',
                'text-autonomi-muted': entry.level === 'info',
              }"
            >
              <span class="text-autonomi-muted/50">{{ entry.timestamp.slice(11, 19) }}</span>
              <span class="ml-1">[{{ entry.source }}]</span>
              <span class="ml-1">{{ entry.message }}</span>
            </div>
            <p v-if="errorLogStore.entries.length === 0" class="text-xs text-autonomi-muted">No log entries</p>
          </div>
          <button
            class="mt-2 text-xs text-autonomi-muted hover:text-autonomi-text"
            @click="showLog = !showLog"
          >
            {{ showLog ? '▾ Hide Log' : '▸ Show Log' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Software -->
    <div class="rounded-lg border border-autonomi-border p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-medium">Software</h3>
          <div class="mt-1 flex items-baseline gap-2 text-xs">
            <span class="text-autonomi-muted">Version</span>
            <span class="font-mono">{{ appVersion }}</span>
          </div>
          <p v-if="lastCheckedLabel" class="mt-0.5 text-xs text-autonomi-muted">
            Last checked {{ lastCheckedLabel }}
          </p>
        </div>
        <button
          :disabled="updaterStore.checking"
          class="shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text disabled:opacity-50"
          @click="checkForUpdates"
        >
          {{ updaterStore.checking ? 'Checking…' : 'Check for Updates' }}
        </button>
      </div>
    </div>

    <!-- About -->
    <div class="rounded-lg border border-autonomi-border p-4">
      <h3 class="text-sm font-medium">About</h3>
      <div class="mt-3 space-y-1.5 text-xs">
        <div class="flex justify-between">
          <span class="text-autonomi-muted">Node daemon version</span>
          <span class="font-mono">{{ nodeVersion }}</span>
        </div>
      </div>
      <div class="mt-3 flex gap-3">
        <button class="text-xs text-autonomi-blue hover:underline" @click="tauriOpenUrl('https://autonomi.com')">
          autonomi.com
        </button>
        <button class="text-xs text-autonomi-blue hover:underline" @click="tauriOpenUrl('https://github.com/WithAutonomi')">
          GitHub
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl as tauriOpenUrl } from '@tauri-apps/plugin-opener'
import { setDevnetWalletKey } from '~/stores/settings'
import { useSettingsStore } from '~/stores/settings'
import { isValidEthAddress } from '~/utils/validators'
import { useToastStore } from '~/stores/toasts'
import { useErrorLogStore } from '~/stores/errorlog'
import { useUpdaterStore } from '~/stores/updater'
import { useFilesStore, type UploadHistoryEntry } from '~/stores/files'

const settingsStore = useSettingsStore()
const walletStore = useWalletStore()
const nodesStore = useNodesStore()
const toasts = useToastStore()
const errorLogStore = useErrorLogStore()
const updaterStore = useUpdaterStore()
const filesStore = useFilesStore()
const showAdvanced = ref(false)
const showLog = ref(false)
const appVersion = ref('0.1.0')

// Re-compute "Last checked X ago" every 30s so the label stays fresh while
// the settings page is visible, without paying for a global ticker.
const nowTick = ref(Date.now())
let tickHandle: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tickHandle = setInterval(() => { nowTick.value = Date.now() }, 30_000)
})
onUnmounted(() => {
  if (tickHandle) clearInterval(tickHandle)
})

const lastCheckedLabel = computed(() => {
  const ts = updaterStore.lastCheckedAt
  if (!ts) return ''
  const secs = Math.max(0, Math.round((nowTick.value - ts) / 1000))
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
})

async function checkForUpdates() {
  const result = await updaterStore.checkForUpdate()
  if (!result.ok) {
    toasts.add(result.error ?? 'Update check failed', 'error')
    return
  }
  if (result.available) {
    toasts.add(`Update available: v${updaterStore.version}`, 'info')
    updaterStore.showDialog = true
  } else {
    toasts.add(`You're on the latest version (v${appVersion.value})`, 'success')
  }
}
const nodeVersion = computed(() => {
  const versions = nodesStore.nodes.map(n => n.version).filter(Boolean)
  return versions.length > 0 ? versions[0] : '-'
})

// Earnings address editing
const editingEarnings = ref(false)
const earningsInput = ref('')
const earningsInputRef = ref<HTMLInputElement | null>(null)

// Daemon URL editing
const editingDaemon = ref(false)
const daemonInput = ref('')
const daemonInputRef = ref<HTMLInputElement | null>(null)

// Direct wallet (private key)
const editingDirectWallet = ref(false)
const directWalletKeyInput = ref('')
const directWalletNetwork = ref('arbitrum-sepolia')
const directWalletError = ref('')
const directWalletActive = ref(false)

async function connectDirectWallet() {
  directWalletError.value = ''
  try {
    let key = directWalletKeyInput.value.trim()
    if (!key.startsWith('0x')) key = `0x${key}`
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      directWalletError.value = 'Invalid private key — must be 64 hex characters'
      return
    }

    // Configure the network based on selection
    const isSepolia = directWalletNetwork.value === 'arbitrum-sepolia'
    setDevnetWalletKey(key)
    settingsStore._devnetWalletKeySet = true
    settingsStore.devnetActive = true
    settingsStore.devnetIsSepolia = isSepolia
    if (isSepolia) {
      settingsStore.devnetRpcUrl = 'https://sepolia-rollup.arbitrum.io/rpc'
      settingsStore.devnetTokenAddress = '0x4bc1aCE0E66170375462cB4E6Af42Ad4D5EC689C'
      settingsStore.devnetVaultAddress = '0xd742E8CFEf27A9a884F3EFfA239Ee2F39c276522'
    } else {
      settingsStore.devnetRpcUrl = null
      settingsStore.devnetTokenAddress = null
      settingsStore.devnetVaultAddress = null
    }

    const { initDevnetWallet } = await import('~/composables/useDevnetWallet')
    const config = initDevnetWallet()
    if (!config) {
      directWalletError.value = 'Failed to initialize wallet'
      return
    }

    directWalletActive.value = true
    editingDirectWallet.value = false
    directWalletKeyInput.value = ''
    toasts.add(`Wallet connected: ${walletStore.paymentAddress}`, 'info')
  } catch (e: any) {
    directWalletError.value = e.message ?? 'Failed to import key'
  }
}

function disconnectDirectWallet() {
  walletStore.connected = false
  walletStore.paymentAddress = null
  walletStore.balance = null
  walletStore.ethBalance = null
  walletStore.antBalance = null
  directWalletActive.value = false
  setDevnetWalletKey(null)
  settingsStore._devnetWalletKeySet = false
  toasts.add('Wallet disconnected', 'info')
}

// Indelible connection
const editingIndelible = ref(false)
const indelibleUrlInput = ref('')
const indelibleApiKeyInput = ref('')
const indelibleTesting = ref(false)
const indelibleError = ref('')

function startEditIndelible() {
  indelibleUrlInput.value = settingsStore.indelibleUrl ?? ''
  indelibleApiKeyInput.value = settingsStore.indelibleApiKey ?? ''
  indelibleError.value = ''
  editingIndelible.value = true
}

async function testIndelible() {
  indelibleTesting.value = true
  indelibleError.value = ''
  const result = await settingsStore.testIndelibleConnection(
    indelibleUrlInput.value.trim(),
    indelibleApiKeyInput.value.trim(),
  )
  indelibleTesting.value = false
  if (result.ok) {
    editingIndelible.value = false
    toasts.add('Connected to Indelible', 'info')
  } else {
    indelibleError.value = result.error ?? 'Connection failed'
  }
}

async function disconnectIndelible() {
  await settingsStore.disconnectIndelible()
  toasts.add('Disconnected from Indelible', 'info')
}

onMounted(async () => {
  try {
    appVersion.value = await invoke<string>('get_app_version')
  } catch { /* fallback to default */ }
})

async function pickStorageDir() {
  try {
    const selected = await open({ directory: true, title: 'Select Storage Directory' })
    if (selected) {
      await settingsStore.setStorageDir(selected as string)
      toasts.add('Storage directory updated', 'info')
    }
  } catch (e) {
    toasts.add('Failed to select directory', 'error')
  }
}

async function pickDownloadDir() {
  try {
    const selected = await open({ directory: true, title: 'Select Downloads Directory' })
    if (selected) {
      await settingsStore.setDownloadDir(selected as string)
      toasts.add('Downloads directory updated', 'info')
    }
  } catch (e) {
    toasts.add('Failed to select directory', 'error')
  }
}

function startEditEarnings() {
  earningsInput.value = settingsStore.earningsAddress ?? ''
  editingEarnings.value = true
  nextTick(() => earningsInputRef.value?.focus())
}

async function saveEarnings() {
  const val = earningsInput.value.trim()
  if (val && !isValidEthAddress(val)) {
    toasts.add('Invalid EVM address format', 'warning')
    return
  }
  await settingsStore.setEarningsAddress(val || null)
  editingEarnings.value = false
  toasts.add('Earnings address updated', 'info')
}

function startEditDaemon() {
  daemonInput.value = settingsStore.daemonUrl
  editingDaemon.value = true
  nextTick(() => daemonInputRef.value?.focus())
}

async function saveDaemon() {
  const val = daemonInput.value.trim()
  if (!val) return
  await settingsStore.setDaemonUrl(val)
  editingDaemon.value = false
  toasts.add('Daemon URL updated', 'info')
}

async function copyDiagnostics() {
  const report = errorLogStore.buildReport()
  try {
    await navigator.clipboard.writeText(report)
    toasts.add('Diagnostics copied to clipboard', 'info')
  } catch {
    toasts.add('Failed to copy to clipboard', 'error')
  }
}

function clearLog() {
  errorLogStore.clear()
  toasts.add('Log cleared', 'info')
}

// ── Rescue Datamaps (V2-195) ──

interface OrphanDatamap {
  path: string
  suggested_name: string
  modified_at: string
}

const rescueScanning = ref(false)
const rescueScanned = ref(false)
const rescueImporting = ref(false)
const orphanDatamaps = ref<OrphanDatamap[]>([])

async function scanOrphans() {
  rescueScanning.value = true
  try {
    if (!filesStore.historyLoaded) {
      await filesStore.loadHistory()
    }
    const knownPaths = filesStore.files
      .filter(f => f.kind === 'upload' && f.data_map_file)
      .map(f => f.data_map_file!)
    orphanDatamaps.value = await invoke<OrphanDatamap[]>('scan_orphan_datamaps', {
      knownPaths,
    })
    rescueScanned.value = true
  } catch (e: any) {
    toasts.add(`Scan failed: ${e.message ?? e}`, 'error')
  } finally {
    rescueScanning.value = false
  }
}

async function importOrphans() {
  rescueImporting.value = true
  try {
    const newEntries: UploadHistoryEntry[] = []
    for (const orphan of orphanDatamaps.value) {
      // Read the datamap JSON so we can compute its network address. Without
      // the address the history row can't participate in re-download flows.
      let json: string
      try {
        json = await invoke<string>('read_datamap_file', { path: orphan.path })
      } catch {
        // Skip datamaps we can't read — they stay as orphans for the user
        // to re-scan later once they've fixed permissions / disk issues.
        continue
      }
      const address = await sha256Hex(json)
      newEntries.push({
        name: orphan.suggested_name,
        size_bytes: 0,
        address,
        cost: null,
        uploaded_at: orphan.modified_at,
        data_map_file: orphan.path,
      })
    }

    // Append, skipping any address already in history (shouldn't happen since
    // we filtered by known path, but a computed address could coincidentally
    // collide with an address we already have from some other path).
    const existingAddrs = new Set(
      filesStore.files
        .filter(f => f.kind === 'upload' && f.address)
        .map(f => f.address!.toLowerCase()),
    )
    const toImport = newEntries.filter(e => !existingAddrs.has(e.address.toLowerCase()))

    if (toImport.length === 0) {
      toasts.add('No new datamaps to import', 'info')
      orphanDatamaps.value = []
      rescueScanned.value = false
      return
    }

    // Build the full entries list (existing history + new) and persist.
    const fullEntries: UploadHistoryEntry[] = [
      ...filesStore.files
        .filter(f => f.kind === 'upload' && f.status === 'complete' && f.address)
        .map(f => ({
          name: f.name,
          size_bytes: f.size_bytes,
          address: f.address!,
          cost: f.cost ?? null,
          uploaded_at: f.date,
          data_map_file: f.data_map_file ?? null,
        })),
      ...toImport,
    ]
    await invoke('save_upload_history', { entries: fullEntries })

    // Refresh the store so the Files page picks them up immediately.
    filesStore.historyLoaded = false
    filesStore.files = filesStore.files.filter(f => f.kind !== 'upload' || f.status !== 'complete')
    await filesStore.loadHistory()

    toasts.add(`Imported ${toImport.length} datamap${toImport.length === 1 ? '' : 's'}`, 'success')
    orphanDatamaps.value = []
    rescueScanned.value = false
  } catch (e: any) {
    toasts.add(`Import failed: ${e.message ?? e}`, 'error')
  } finally {
    rescueImporting.value = false
  }
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex}`
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

</script>
