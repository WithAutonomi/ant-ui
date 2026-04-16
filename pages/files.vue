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
          @click="openDownloadByDatamap"
        >
          Download by Datamap
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
      </div>
    </div>

    <!-- Uploads table + drop zone -->
    <section class="mb-6">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium text-autonomi-text">Uploads</h2>
        <button
          v-if="hasSettledUploads"
          class="text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="filesStore.clearUploadHistory()"
        >
          Clear History
        </button>
      </div>

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

        <div
          v-if="sortedUploads.length === 0"
          class="flex flex-col items-center justify-center rounded-lg border border-dashed border-autonomi-border py-16"
        >
          <svg class="mb-3 h-8 w-8 text-autonomi-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p class="text-sm text-autonomi-muted">No uploads yet</p>
          <p class="mt-1 text-xs text-autonomi-muted">Drag files here, or use the buttons above</p>
        </div>

        <div v-else class="overflow-hidden rounded-lg border border-autonomi-border">
          <table class="w-full text-sm">
            <thead class="bg-autonomi-surface">
              <tr class="text-left text-xs uppercase tracking-wider text-autonomi-muted">
                <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleUploadSort('name')">
                  Name {{ uploadSortIndicator('name') }}
                </th>
                <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleUploadSort('size_bytes')">
                  Size {{ uploadSortIndicator('size_bytes') }}
                </th>
                <th class="px-4 py-2.5">Status</th>
                <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleUploadSort('cost')">
                  Cost {{ uploadSortIndicator('cost') }}
                </th>
                <th class="px-4 py-2.5">Address</th>
                <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleUploadSort('date')">
                  Date {{ uploadSortIndicator('date') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-autonomi-border">
              <tr
                v-for="file in sortedUploads"
                :key="file.id"
                class="transition-colors"
                :class="rowClass(file)"
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
                    v-if="file.data_map_file"
                    class="cursor-pointer font-mono text-xs text-autonomi-muted hover:text-autonomi-blue"
                    :title="`Reveal ${datamapBasename(file.data_map_file)} in its folder`"
                    @click.stop="openFolder(file.data_map_file)"
                  >
                    {{ datamapBasename(file.data_map_file) }}
                  </span>
                  <span
                    v-else-if="file.address"
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
    </section>

    <!-- Downloads table -->
    <section>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium text-autonomi-text">Downloads</h2>
        <button
          v-if="hasSettledDownloads"
          class="text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="filesStore.clearDownloads()"
        >
          Clear
        </button>
      </div>

      <div
        v-if="sortedDownloads.length === 0"
        class="flex flex-col items-center justify-center rounded-lg border border-dashed border-autonomi-border py-12"
      >
        <p class="text-sm text-autonomi-muted">No downloads yet</p>
        <p class="mt-1 text-xs text-autonomi-muted">Use "Download by Address" or "Download by Datamap"</p>
      </div>

      <div v-else class="overflow-hidden rounded-lg border border-autonomi-border">
        <table class="w-full text-sm">
          <thead class="bg-autonomi-surface">
            <tr class="text-left text-xs uppercase tracking-wider text-autonomi-muted">
              <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleDownloadSort('name')">
                Name {{ downloadSortIndicator('name') }}
              </th>
              <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleDownloadSort('size_bytes')">
                Size {{ downloadSortIndicator('size_bytes') }}
              </th>
              <th class="px-4 py-2.5">Status</th>
              <th class="px-4 py-2.5">Saved to</th>
              <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleDownloadSort('date')">
                Date {{ downloadSortIndicator('date') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-autonomi-border">
            <tr
              v-for="file in sortedDownloads"
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
              <td class="px-4 py-2.5 font-mono text-xs text-autonomi-muted">
                {{ file.dest_path ? basenameOf(file.dest_path) : '-' }}
              </td>
              <td class="px-4 py-2.5 text-autonomi-muted">{{ formatDate(file.date) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Dialogs -->
    <FilesDownloadDialog
      :open="showDownloadDialog"
      @close="showDownloadDialog = false"
      @download="handleDownload"
    />

    <FilesDownloadByDatamapDialog
      :open="showDatamapDialog"
      :candidates="datamapCandidates"
      @close="showDatamapDialog = false"
      @browse="browseForDatamap"
      @select="onDatamapPicked"
    />

    <FilesDatamapSaveAsDialog
      :open="showDatamapSaveAs"
      :default-name="pendingDatamap?.defaultName ?? ''"
      @close="cancelDatamapSaveAs"
      @confirm="startDatamapDownload"
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
import { useConnectionStore } from '~/stores/connection'

interface FileMeta {
  path: string
  name: string
  size: number
}

const filesStore = useFilesStore()
const settingsStore = useSettingsStore()
const toastStore = useToastStore()
const connectionStore = useConnectionStore()

// Autonomi client state — driven by connection-status events from the backend.
const autonomiConnected = computed(() => connectionStore.isConnected)

function getWagmiConfig() {
  // Direct wallet (private key) takes priority if initialized
  const directConfig = getDevnetWagmiConfig()
  if (directConfig) return directConfig
  // Otherwise use AppKit/WalletConnect
  const { $wagmiAdapter } = useNuxtApp()
  return $wagmiAdapter?.wagmiConfig ?? null
}

// ── Sorting ──
//
// Uploads and downloads have independent sort state: a download doesn't
// reorder the uploads table, and vice versa. Both default to newest-first.

type UploadSortKey = 'name' | 'size_bytes' | 'cost' | 'date'
type DownloadSortKey = 'name' | 'size_bytes' | 'date'

const uploadSortKey = ref<UploadSortKey>('date')
const uploadSortAsc = ref(false)
const downloadSortKey = ref<DownloadSortKey>('date')
const downloadSortAsc = ref(false)

function toggleUploadSort(key: UploadSortKey) {
  if (uploadSortKey.value === key) {
    uploadSortAsc.value = !uploadSortAsc.value
  } else {
    uploadSortKey.value = key
    uploadSortAsc.value = key === 'name'
  }
}

function toggleDownloadSort(key: DownloadSortKey) {
  if (downloadSortKey.value === key) {
    downloadSortAsc.value = !downloadSortAsc.value
  } else {
    downloadSortKey.value = key
    downloadSortAsc.value = key === 'name'
  }
}

function uploadSortIndicator(key: UploadSortKey): string {
  if (uploadSortKey.value !== key) return ''
  return uploadSortAsc.value ? '↑' : '↓'
}

function downloadSortIndicator(key: DownloadSortKey): string {
  if (downloadSortKey.value !== key) return ''
  return downloadSortAsc.value ? '↑' : '↓'
}

function compareEntries(
  a: FileEntry,
  b: FileEntry,
  key: UploadSortKey | DownloadSortKey,
): number {
  switch (key) {
    case 'name': return a.name.localeCompare(b.name)
    case 'size_bytes': return a.size_bytes - b.size_bytes
    case 'cost': return (a.cost ?? '').localeCompare(b.cost ?? '')
    case 'date': return a.date.localeCompare(b.date)
  }
}

/** Active (pinned) rows sort by when their transfer started — newest at top. */
function byTransferStart(a: FileEntry, b: FileEntry): number {
  return (b.transferStartedAt ?? 0) - (a.transferStartedAt ?? 0)
}

const sortedUploads = computed(() => {
  const pinned = filesStore.pinnedUploads.slice().sort(byTransferStart)
  const settled = filesStore.settledUploads.slice().sort((a, b) => {
    const cmp = compareEntries(a, b, uploadSortKey.value)
    return uploadSortAsc.value ? cmp : -cmp
  })
  return [...pinned, ...settled]
})

const sortedDownloads = computed(() => {
  const pinned = filesStore.pinnedDownloads.slice().sort(byTransferStart)
  const settled = filesStore.settledDownloads.slice().sort((a, b) => {
    const cmp = compareEntries(a, b, downloadSortKey.value)
    return downloadSortAsc.value ? cmp : -cmp
  })
  return [...pinned, ...settled]
})

const hasSettledUploads = computed(() =>
  filesStore.settledUploads.some(f => f.status === 'complete' || f.status === 'failed'),
)

const hasSettledDownloads = computed(() =>
  filesStore.settledDownloads.some(f => f.status !== 'downloading'),
)

function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

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
const pendingMetas = ref<FileMeta[]>([])
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
  pendingMetas.value = []
  quotedCostDisplay.value = null
  quotedGasEstimate.value = null
  quotedPaymentMode.value = null
  pendingQuotes.value = new Map()
  showUploadConfirm.value = true

  const metas = await getFileMetas(paths)
  pendingMetas.value = metas
  pendingUploadFiles.value = metas.map(m => ({
    name: m.name,
    size: m.size,
    path: m.path,
  }))
  uploadEstimating.value = false

  // Start real quoting in background (only when connected to network).
  // The watcher below picks up the case where connection completes after the
  // dialog is already open.
  if ((autonomiConnected.value || settingsStore.devnetActive) && !settingsStore.indelibleConnected) {
    startQuoting(metas)
  }
}

// If the embedded ant-core client connects (or finishes retrying) while the
// upload dialog is open and we don't yet have a quote, kick off quoting now.
// Without this, opening the dialog before the network is ready leaves the
// dialog stuck on the misleading "Cost will be quoted from the network when
// upload starts" fallback even after the connection succeeds.
watch(
  () => autonomiConnected.value,
  (connected) => {
    if (!connected) return
    if (!showUploadConfirm.value) return
    if (settingsStore.indelibleConnected) return
    if (isQuoting.value) return
    if (quotedCostDisplay.value) return
    if (pendingMetas.value.length === 0) return
    startQuoting(pendingMetas.value)
  },
)

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

/**
 * Resolve once the embedded ant-core client is connected, or returns false
 * if it transitions to `failed`. No timeout — matches the upload-while-
 * connecting flow, which just waits on a reactive watcher. A user who
 * no longer wants to wait can close the app or dismiss the row.
 */
function waitForConnection(): Promise<boolean> {
  if (autonomiConnected.value) return Promise.resolve(true)
  return new Promise((resolve) => {
    const stop = watch(
      () => connectionStore.current.status,
      (status) => {
        if (status === 'connected') {
          stop()
          resolve(true)
        } else if (status === 'failed') {
          stop()
          resolve(false)
        }
      },
    )
  })
}

const showDatamapDialog = ref(false)
const showDatamapSaveAs = ref(false)

/** Set between phase 1 (picker) and phase 2 (Save As) of the download-by-
 *  datamap flow. Cleared once a download starts or the user cancels. */
const pendingDatamap = ref<{ path: string; defaultName: string } | null>(null)

/** Previously uploaded files for which we still hold a local datamap — the
 *  set the user can re-download from without picking a file from disk. */
const datamapCandidates = computed(() =>
  filesStore.files
    .filter(f => f.kind === 'upload' && f.status === 'complete' && f.data_map_file)
    .map(f => ({
      name: f.name,
      data_map_file: f.data_map_file!,
      date: f.date,
      size_bytes: f.size_bytes,
    })),
)

function openDownloadByDatamap() {
  showDatamapDialog.value = true
}

function onDatamapPicked(path: string, suggestedName: string) {
  pendingDatamap.value = { path, defaultName: suggestedName }
  showDatamapSaveAs.value = true
}

async function browseForDatamap() {
  showDatamapDialog.value = false
  let selected: string | string[] | null
  try {
    selected = await openFileDialog({
      multiple: false,
      title: 'Select a datamap file to download',
      filters: [{ name: 'Datamap', extensions: ['datamap'] }],
    })
  } catch (err) {
    console.error('File dialog error:', err)
    return
  }
  if (!selected) return
  const datamapPath = String(Array.isArray(selected) ? selected[0] : selected)
  const basename = datamapPath.split(/[\\/]/).pop() ?? 'download'
  const defaultName = basename.replace(/\.datamap$/i, '') || basename
  pendingDatamap.value = { path: datamapPath, defaultName }
  showDatamapSaveAs.value = true
}

function cancelDatamapSaveAs() {
  showDatamapSaveAs.value = false
  pendingDatamap.value = null
}

async function startDatamapDownload(filename: string) {
  const pending = pendingDatamap.value
  if (!pending) return
  showDatamapSaveAs.value = false
  pendingDatamap.value = null

  const id = await filesStore.downloadFromDatamapFile(pending.path, filename)
  if (id === null) return

  if (!autonomiConnected.value) {
    invoke('retry_autonomi_client').catch(() => {})
    const connected = await waitForConnection()
    if (!connected) {
      filesStore.updateEntry(id, { status: 'failed', error: 'Not connected to network' })
      toastStore.add('Download requires network connection', 'warning')
      return
    }
  }

  filesStore.startRealDownload(id)
}

async function handleDownload(address: string, filename: string) {
  const downloadDir = filesStore.getDownloadDir()
  const destPath = `${downloadDir}/${filename}`
  const id = filesStore.startDownload(address, filename, destPath)

  if (!autonomiConnected.value) {
    // Kick the connect loop (no-op if already connecting) and wait. The row
    // already shows `downloading` — progress just stays at 0 until the
    // client is ready.
    invoke('retry_autonomi_client').catch(() => {})
    const connected = await waitForConnection()
    if (!connected) {
      filesStore.updateEntry(id, { status: 'failed', error: 'Not connected to network' })
      toastStore.add('Download requires network connection', 'warning')
      return
    }
  }

  filesStore.startRealDownload(id)
}

// ── Cost estimation ──

const showCostDialog = ref(false)
const costFiles = ref<{ name: string; size: number; cost?: string }[]>([])
const costMetas = ref<FileMeta[]>([])
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

    const metas = await getFileMetas(pathStrings)
    costMetas.value = metas
    // Show sizes immediately; the dialog falls back to the heuristic estimate
    // per file until real costs land below.
    costFiles.value = metas.map(m => ({ name: m.name, size: m.size }))
    costLoading.value = false

    // Skip network quoting when Indelible is the active backend — Indelible
    // prices uploads server-side, so the embedded ant-core has nothing to
    // quote against.
    if (settingsStore.indelibleConnected && !settingsStore.devnetActive) return

    // If the embedded client is connected (or devnet override is active),
    // fire real quotes now. Otherwise the watcher below picks up the case
    // where the connection completes after the dialog opened.
    if (autonomiConnected.value || settingsStore.devnetActive) {
      runCostEstimateQuotes(metas)
    }
  } catch (err) {
    showCostDialog.value = false
    console.error('File dialog error:', err)
  }
}

/** Whether a cost-estimate quoting pass is currently in flight. Prevents
 *  the connection watcher from firing duplicate quote rounds. */
const costEstimateQuoting = ref(false)

async function runCostEstimateQuotes(metas: FileMeta[]) {
  if (costEstimateQuoting.value) return
  costEstimateQuoting.value = true
  try {
    for (const meta of metas) {
      const quote = await filesStore.getUploadQuote(meta.path)
      if (!quote) continue
      const idx = costFiles.value.findIndex(f => f.name === meta.name)
      if (idx === -1) continue
      // Mutate the entry in place so the dialog's reactive `:files` re-renders.
      costFiles.value[idx] = {
        ...costFiles.value[idx],
        cost: quote.total_cost_display,
      }
    }
  } finally {
    costEstimateQuoting.value = false
  }
}

// Same watch+retry pattern as the upload-confirm dialog: if the estimate
// dialog is open with sizes only and the network later becomes available,
// run the quotes then so the user doesn't have to close and reopen.
watch(
  () => autonomiConnected.value,
  (connected) => {
    if (!connected) return
    if (!showCostDialog.value) return
    if (settingsStore.indelibleConnected && !settingsStore.devnetActive) return
    if (costEstimateQuoting.value) return
    if (costMetas.value.length === 0) return
    if (costFiles.value.every(f => f.cost)) return
    runCostEstimateQuotes(costMetas.value)
  },
)

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

function datamapBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
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
  setupDragDrop()
})

onUnmounted(() => {
  unlistenDragDrop?.()
})
</script>
