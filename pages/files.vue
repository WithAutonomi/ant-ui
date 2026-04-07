<template>
  <div>
    <!-- Actions bar -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex gap-2">
        <button
          class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          @click="uploadFiles"
        >
          Upload File(s)
        </button>
        <button
          class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
          @click="showDownloadDialog = true"
        >
          Download by Address
        </button>
        <button
          class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
          @click="estimateCost"
        >
          Estimate Cost
        </button>
      </div>

      <div class="flex items-center gap-3">
        <span v-if="filesStore.files.length" class="text-xs text-autonomi-muted">
          {{ filesStore.files.length }} file{{ filesStore.files.length !== 1 ? 's' : '' }}
        </span>
        <button
          v-if="filesStore.settledFiles.some(f => f.status === 'complete' || f.status === 'failed')"
          class="text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="filesStore.clearCompleted()"
        >
          Clear History
        </button>
      </div>
    </div>

    <!-- Unified table / drop zone -->
    <div class="relative">
      <!-- Drop overlay -->
      <Transition
        enter-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="dragging"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-autonomi-blue bg-autonomi-dark/90"
        >
          <div class="text-center">
            <svg class="mx-auto mb-2 h-8 w-8 text-autonomi-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p class="text-sm font-medium text-autonomi-blue">Drop files to upload</p>
          </div>
        </div>
      </Transition>

      <!-- Empty state -->
      <div
        v-if="sortedFiles.length === 0"
        class="flex flex-col items-center justify-center rounded-lg border border-dashed border-autonomi-border py-20"
      >
        <svg class="mb-3 h-8 w-8 text-autonomi-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p class="text-sm text-autonomi-muted">No files yet</p>
        <p class="mt-1 text-xs text-autonomi-muted">Drag files here, or use the buttons above</p>
      </div>

      <!-- File table -->
      <div v-else class="overflow-hidden rounded-lg border border-autonomi-border">
        <table class="w-full text-sm">
          <thead class="bg-autonomi-surface">
            <tr class="text-left text-xs uppercase tracking-wider text-autonomi-muted">
              <th class="px-4 py-2.5 cursor-pointer hover:text-autonomi-text" @click="toggleSort('name')">
                Name {{ sortIndicator('name') }}
              </th>
              <th class="px-4 py-2.5 cursor-pointer hover:text-autonomi-text" @click="toggleSort('size_bytes')">
                Size {{ sortIndicator('size_bytes') }}
              </th>
              <th class="px-4 py-2.5">Status</th>
              <th class="px-4 py-2.5 cursor-pointer hover:text-autonomi-text" @click="toggleSort('cost')">
                Cost {{ sortIndicator('cost') }}
              </th>
              <th class="px-4 py-2.5">Address</th>
              <th class="px-4 py-2.5 cursor-pointer hover:text-autonomi-text" @click="toggleSort('date')">
                Date {{ sortIndicator('date') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-autonomi-border">
            <tr
              v-for="file in sortedFiles"
              :key="file.id"
              class="transition-colors"
              :class="rowClass(file)"
              @click="onRowClick(file)"
            >
              <td class="px-4 py-2.5">{{ file.name }}</td>
              <td class="px-4 py-2.5 text-autonomi-muted">{{ file.size_bytes ? formatBytes(file.size_bytes) : '-' }}</td>
              <td class="px-4 py-2.5">
                <StatusBadge :status="statusLabel(file)" />
              </td>
              <td class="px-4 py-2.5 text-autonomi-muted">
                <span>{{ file.cost ?? '-' }}</span>
                <span v-if="file.gas_cost" class="block text-[10px] text-autonomi-muted/60">+ {{ file.gas_cost }} gas</span>
              </td>
              <td class="px-4 py-2.5">
                <span
                  v-if="file.address"
                  class="cursor-pointer font-mono text-xs text-autonomi-muted hover:text-autonomi-blue"
                  @click.stop="copyAddress(file.address)"
                >
                  {{ truncateAddress(file.address, 8, 6) }}
                </span>
                <span v-else class="text-autonomi-muted">-</span>
              </td>
              <td class="px-4 py-2.5 text-autonomi-muted">{{ formatDate(file.date) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Dialogs -->
    <FilesDownloadDialog
      :open="showDownloadDialog"
      @close="showDownloadDialog = false"
      @download="handleDownload"
    />

    <FilesUploadConfirmDialog
      :open="showUploadConfirm"
      :files="pendingUploadFiles"
      :loading="uploadEstimating"
      :quoted-cost="quotedCostDisplay"
      :quoted-gas="quotedGasEstimate"
      :quoting="isQuoting"
      :quoted-payment-mode="quotedPaymentMode"
      :network-connected="autonomiConnected"
      @confirm="confirmUpload"
      @cancel="cancelUpload"
    />

    <FilesCostEstimateDialog
      :open="showCostDialog"
      :files="costFiles"
      :loading="costLoading"
      @close="showCostDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useFilesStore, type FileEntry, type UploadQuote } from '~/stores/files'
import { formatBytes, truncateAddress } from '~/utils/formatters'
import { useSettingsStore } from '~/stores/settings'
import { useToastStore } from '~/stores/toasts'

interface FileMeta {
  path: string
  name: string
  size: number
}

const filesStore = useFilesStore()
const settingsStore = useSettingsStore()
const toastStore = useToastStore()

// Autonomi client state
const autonomiConnected = ref(false)

async function checkAutonomiClient() {
  try {
    autonomiConnected.value = await invoke<boolean>('is_autonomi_connected')
  } catch {
    autonomiConnected.value = false
  }
}

function getWagmiConfig() {
  // Direct wallet (private key) takes priority if initialized
  const directConfig = getDevnetWagmiConfig()
  if (directConfig) return directConfig
  // Otherwise use AppKit/WalletConnect
  const { $wagmiAdapter } = useNuxtApp()
  return $wagmiAdapter?.wagmiConfig ?? null
}

// ── Sorting ──

type SortKey = 'name' | 'size_bytes' | 'cost' | 'date'
const sortKey = ref<SortKey>('date')
const sortAsc = ref(false) // default: newest first

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = key === 'name' // name defaults ascending, others descending
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return ''
  return sortAsc.value ? '↑' : '↓'
}

const sortedFiles = computed(() => {
  const pinned = filesStore.pinnedFiles.slice().sort(
    (a, b) => (b.transferStartedAt ?? 0) - (a.transferStartedAt ?? 0),
  )
  const settled = filesStore.settledFiles.slice().sort((a, b) => {
    let cmp = 0
    switch (sortKey.value) {
      case 'name':
        cmp = a.name.localeCompare(b.name)
        break
      case 'size_bytes':
        cmp = a.size_bytes - b.size_bytes
        break
      case 'cost':
        cmp = (a.cost ?? '').localeCompare(b.cost ?? '')
        break
      case 'date':
        cmp = a.date.localeCompare(b.date)
        break
    }
    return sortAsc.value ? cmp : -cmp
  })
  return [...pinned, ...settled]
})

// ── Row display helpers ──

function statusLabel(file: FileEntry): string {
  if (file.status === 'uploading') return 'Uploading'
  if (file.status === 'downloading') return 'Downloading'
  if (file.status === 'downloaded') return 'Downloaded'
  if (file.status === 'failed') return file.error ? `Failed: ${file.error}` : 'Failed'
  if (file.status === 'complete') return 'Complete'
  if (file.status === 'quoting') return 'Quoting'
  if (file.status === 'paying') return 'Paying'
  return file.status
}


function rowClass(file: FileEntry): string {
  if (file.status === 'downloaded') return 'hover:bg-autonomi-surface/50 cursor-pointer bg-autonomi-blue/5'
  if (file.status === 'failed') return 'hover:bg-autonomi-surface/50 opacity-60'
  return 'hover:bg-autonomi-surface/50'
}

function onRowClick(file: FileEntry) {
  if (file.status === 'downloaded' && file.dest_path) {
    openFolder(file.dest_path)
    filesStore.acknowledgeDownload(file.id)
  }
}

// ── Drag and drop (Tauri webview API) ──

const dragging = ref(false)
let unlistenDragDrop: (() => void) | null = null

async function setupDragDrop() {
  unlistenDragDrop = await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'enter' || event.payload.type === 'over') {
      dragging.value = true
    } else if (event.payload.type === 'drop') {
      dragging.value = false
      const paths = event.payload.paths
      if (paths.length > 0) {
        showUploadConfirmForPaths(paths)
      }
    } else if (event.payload.type === 'leave') {
      dragging.value = false
    }
  })
}

// ── Upload flow ──

const showUploadConfirm = ref(false)
const uploadEstimating = ref(false)
const pendingUploadFiles = ref<{ name: string; size: number; path: string }[]>([])
const isQuoting = ref(false)
const quotedCostDisplay = ref<string | null>(null)
const quotedGasEstimate = ref<string | null>(null)
const quotedPaymentMode = ref<'wave-batch' | 'merkle' | null>(null)
const pendingQuotes = ref<Map<string, UploadQuote>>(new Map())

async function getFileMetas(paths: string[]): Promise<FileMeta[]> {
  try {
    return await invoke<FileMeta[]>('get_file_sizes', { paths })
  } catch {
    return paths.map(p => ({
      path: p,
      name: p.split(/[\\/]/).pop() ?? 'unknown',
      size: 0,
    }))
  }
}

async function uploadFiles() {
  try {
    const selected = await openFileDialog({
      multiple: true,
      title: 'Select files to upload',
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    await showUploadConfirmForPaths(paths.map(p => String(p)))
  } catch (err) {
    showUploadConfirm.value = false
    console.error('File dialog error:', err)
  }
}

async function showUploadConfirmForPaths(paths: string[]) {
  uploadEstimating.value = true
  pendingUploadFiles.value = []
  quotedCostDisplay.value = null
  quotedGasEstimate.value = null
  quotedPaymentMode.value = null
  pendingQuotes.value = new Map()
  showUploadConfirm.value = true

  const metas = await getFileMetas(paths)
  pendingUploadFiles.value = metas.map(m => ({
    name: m.name,
    size: m.size,
    path: m.path,
  }))
  uploadEstimating.value = false

  // Start real quoting in background (only when connected to network)
  if ((autonomiConnected.value || settingsStore.devnetActive) && !settingsStore.indelibleConnected) {
    startQuoting(metas)
  }
}

async function startQuoting(metas: FileMeta[]) {
  isQuoting.value = true
  try {
    // Quote each file (sequentially to avoid overwhelming the network)
    const quotes = new Map<string, UploadQuote>()
    for (const meta of metas) {
      const quote = await filesStore.getUploadQuote(meta.path)
      if (quote) {
        quotes.set(meta.path, quote)
      }
    }
    pendingQuotes.value = quotes

    if (quotes.size > 0) {
      const quoteValues = Array.from(quotes.values())
      quotedPaymentMode.value = quoteValues[0].payment_mode

      if (quotedPaymentMode.value === 'merkle') {
        quotedCostDisplay.value = 'Determined on-chain'
      } else {
        const totalNanos = quoteValues.reduce(
          (sum, q) => sum + BigInt(q.total_cost), 0n,
        )
        const whole = totalNanos / 1_000_000_000_000_000_000n
        const frac = (totalNanos % 1_000_000_000_000_000_000n) / 1_000_000_000_000_000n
        quotedCostDisplay.value = frac > 0n ? `${whole}.${frac.toString().padStart(3, '0')} ANT` : `${whole} ANT`
      }

      // Estimate gas cost
      const wagmiConfig = getWagmiConfig()
      if (wagmiConfig) {
        const totalPayments = quoteValues.reduce((sum, q) => sum + q.payments.length, 0)
        const poolCount = quoteValues[0].merkle_pool_commitments?.length
        const est = await estimatePaymentGasCost(
          wagmiConfig,
          quotedPaymentMode.value,
          totalPayments,
          poolCount,
        )
        quotedGasEstimate.value = est
      }
    }
  } catch {
    // Quoting failed — user can still proceed (will re-quote during upload)
  } finally {
    isQuoting.value = false
  }
}

function confirmUpload(options: { visibility: 'private' | 'public'; paymentMode: 'regular' | 'merkle' }) {
  showUploadConfirm.value = false
  const wagmiConfig = getWagmiConfig()

  for (const file of pendingUploadFiles.value) {
    const id = filesStore.addUpload(file.name, file.path, file.size)
    const preQuote = pendingQuotes.value.get(file.path)

    if (settingsStore.indelibleConnected && !settingsStore.devnetActive) {
      filesStore.startIndelibleUpload(id)
    } else if ((autonomiConnected.value || settingsStore.devnetActive) && wagmiConfig) {
      filesStore.startRealUpload(id, wagmiConfig, options, preQuote ?? undefined)
    } else {
      filesStore.updateEntry(id, { status: 'failed', error: 'Not connected to network or wallet' })
      toastStore.add('Upload requires network connection and wallet', 'warning')
    }
  }
  pendingUploadFiles.value = []
  pendingQuotes.value = new Map()
  quotedCostDisplay.value = null
}

function cancelUpload() {
  showUploadConfirm.value = false
  pendingUploadFiles.value = []
  pendingQuotes.value = new Map()
  quotedCostDisplay.value = null
  isQuoting.value = false
}

// ── Download flow ──

const showDownloadDialog = ref(false)

function handleDownload(address: string, filename: string) {
  const downloadDir = filesStore.getDownloadDir()
  const destPath = `${downloadDir}/${filename}`
  const id = filesStore.startDownload(address, filename, destPath)
  if (autonomiConnected.value) {
    filesStore.startRealDownload(id)
  } else {
    filesStore.updateEntry(id, { status: 'failed', error: 'Not connected to network' })
    toastStore.add('Download requires network connection', 'warning')
  }
}

// ── Cost estimation ──

const showCostDialog = ref(false)
const costFiles = ref<{ name: string; size: number; cost?: string }[]>([])
const costLoading = ref(false)

async function estimateCost() {
  try {
    const selected = await openFileDialog({
      multiple: true,
      title: 'Select files to estimate cost',
    })
    if (!selected) return

    const paths = Array.isArray(selected) ? selected : [selected]
    const pathStrings = paths.map(p => String(p))
    costLoading.value = true
    costFiles.value = []
    showCostDialog.value = true

    // Cost estimation shows file sizes; real costs come from the upload quote flow
    const metas = await getFileMetas(pathStrings)
    costFiles.value = metas.map(m => ({ name: m.name, size: m.size }))

    costLoading.value = false
  } catch (err) {
    showCostDialog.value = false
    console.error('File dialog error:', err)
  }
}

// ── Utilities ──

async function openFolder(path: string) {
  try {
    await revealItemInDir(path)
  } catch {
    toastStore.add('Could not open folder', 'warning')
  }
}

function copyAddress(addr: string) {
  navigator.clipboard.writeText(addr)
  toastStore.add('Address copied to clipboard', 'info')
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// ── Lifecycle ──

onMounted(() => {
  if (!filesStore.historyLoaded) {
    filesStore.loadHistory()
  }
  checkAutonomiClient()
  setupDragDrop()
})

onUnmounted(() => {
  unlistenDragDrop?.()
})
</script>
