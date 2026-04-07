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

    <!-- About -->
    <div class="rounded-lg border border-autonomi-border p-4">
      <h3 class="text-sm font-medium">About</h3>
      <div class="mt-3 space-y-1.5 text-xs">
        <div class="flex justify-between">
          <span class="text-autonomi-muted">App version</span>
          <span class="font-mono">{{ appVersion }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-autonomi-muted">Node version</span>
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
import { useSettingsStore } from '~/stores/settings'
import { isValidEthAddress } from '~/utils/validators'
import { useToastStore } from '~/stores/toasts'
import { useErrorLogStore } from '~/stores/errorlog'

const settingsStore = useSettingsStore()
const walletStore = useWalletStore()
const nodesStore = useNodesStore()
const toasts = useToastStore()
const errorLogStore = useErrorLogStore()
const showAdvanced = ref(false)
const showLog = ref(false)
const appVersion = ref('0.1.0')
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
    settingsStore.devnetWalletKey = key
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
  settingsStore.devnetWalletKey = null
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


</script>
