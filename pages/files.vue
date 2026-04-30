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
          @click="estimateCost"
        >
          Estimate Cost
        </button>
      </div>

      <div class="flex items-center gap-2">
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
      </div>
    </div>

    <!-- Uploads table + drop zone -->
    <section class="mb-6">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium text-autonomi-text">Uploads</h2>
        <!-- Bulk "Clear history" lives in Settings → Storage now (V2-232).
             Per-row × on hover handles the common case of trimming a single
             failed/complete entry; bulk wipe is gated behind a confirmation
             dialog over there to prevent accidental data loss. -->
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
                <th class="px-4 py-2.5">Status</th>
                <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleUploadSort('size_bytes')">
                  Size {{ uploadSortIndicator('size_bytes') }}
                </th>
                <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleUploadSort('cost')">
                  Cost {{ uploadSortIndicator('cost') }}
                </th>
                <th class="px-4 py-2.5">Address</th>
                <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleUploadSort('date')">
                  Date {{ uploadSortIndicator('date') }}
                </th>
                <th class="w-px px-2 py-2.5"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-autonomi-border">
              <tr
                v-for="file in sortedUploads"
                :key="file.id"
                class="group transition-colors"
                :class="rowClass(file)"
                @click="onRowClick(file)"
              >
                <td class="px-4 py-2.5">
                  <div>{{ file.name }}</div>
                  <ProgressLine
                    v-if="showsProgressBar(file)"
                    :percent="file.progress"
                    :kind="file.kind"
                    :status="file.status"
                    :stage="file.stage"
                    :stage-done="file.stageDone"
                    :stage-total="file.stageTotal"
                  />
                </td>
                <td class="px-4 py-2.5 align-top">
                  <div><StatusBadge :status="statusLabel(file)" /></div>
                  <div v-if="showsProgressBar(file) && stageDetail(file)" class="mt-1 text-[10px] leading-tight text-autonomi-muted">
                    {{ stageDetail(file) }}
                  </div>
                </td>
                <td class="px-4 py-2.5 text-autonomi-muted">{{ file.size_bytes ? formatBytes(file.size_bytes) : '-' }}</td>
                <td class="px-4 py-2.5 text-autonomi-muted">
                  <template v-if="file.alreadyStored">
                    <span class="text-green-400">Free — already stored</span>
                  </template>
                  <template v-else>
                    <span>{{ file.cost ?? '-' }}</span>
                    <span v-if="file.gas_cost" class="block text-[10px] text-autonomi-muted/60">+ {{ file.gas_cost }} gas</span>
                  </template>
                </td>
                <td class="px-4 py-2.5">
                  <span
                    v-if="file.public_address"
                    class="inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs text-autonomi-blue hover:text-autonomi-blue/80"
                    title="Public upload — click to copy the shareable network address"
                    @click.stop="copyPublicAddress(file.public_address)"
                  >
                    <span class="rounded bg-autonomi-blue/15 px-1 py-px text-[9px] font-sans uppercase tracking-wider">Public</span>
                    {{ truncateAddress(file.public_address, 8, 6) }}
                  </span>
                  <span
                    v-else-if="file.data_map_file"
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
                <td class="px-2 py-2.5 text-right whitespace-nowrap">
                  <span v-if="isSettled(file)" class="inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      v-if="canRetry(file)"
                      class="rounded px-1.5 py-0.5 text-[11px] text-autonomi-muted hover:bg-autonomi-surface hover:text-autonomi-blue"
                      title="Retry upload"
                      @click.stop="onRetry(file)"
                    >
                      ↻ Retry
                    </button>
                    <button
                      class="rounded px-1.5 py-0.5 text-[11px] text-autonomi-muted hover:bg-autonomi-surface hover:text-autonomi-error"
                      title="Remove from list"
                      @click.stop="onRemove(file)"
                    >
                      ✕
                    </button>
                  </span>
                </td>
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
              <th class="px-4 py-2.5">Status</th>
              <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleDownloadSort('size_bytes')">
                Size {{ downloadSortIndicator('size_bytes') }}
              </th>
              <th class="px-4 py-2.5">Saved to</th>
              <th class="cursor-pointer px-4 py-2.5 hover:text-autonomi-text" @click="toggleDownloadSort('date')">
                Date {{ downloadSortIndicator('date') }}
              </th>
              <th class="w-px px-2 py-2.5"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-autonomi-border">
            <tr
              v-for="file in sortedDownloads"
              :key="file.id"
              class="group transition-colors"
              :class="rowClass(file)"
              @click="onRowClick(file)"
            >
              <td class="px-4 py-2.5">
                <div>{{ file.name }}</div>
                <ProgressLine
                  v-if="showsProgressBar(file)"
                  :percent="file.progress"
                  :kind="file.kind"
                  :status="file.status"
                  :stage="file.stage"
                  :stage-done="file.stageDone"
                  :stage-total="file.stageTotal"
                />
              </td>
              <td class="px-4 py-2.5 align-top">
                <div><StatusBadge :status="statusLabel(file)" /></div>
                <div v-if="showsProgressBar(file) && stageDetail(file)" class="mt-1 text-[10px] leading-tight text-autonomi-muted">
                  {{ stageDetail(file) }}
                </div>
              </td>
              <td class="px-4 py-2.5 text-autonomi-muted">{{ file.size_bytes ? formatBytes(file.size_bytes) : '-' }}</td>
              <td class="px-4 py-2.5 font-mono text-xs text-autonomi-muted">
                {{ file.dest_path ? basenameOf(file.dest_path) : '-' }}
              </td>
              <td class="px-4 py-2.5 text-autonomi-muted">{{ formatDate(file.date) }}</td>
              <td class="px-2 py-2.5 text-right whitespace-nowrap">
                <span v-if="isSettled(file)" class="inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    class="rounded px-1.5 py-0.5 text-[11px] text-autonomi-muted hover:bg-autonomi-surface hover:text-autonomi-error"
                    title="Remove from list"
                    @click.stop="onRemove(file)"
                  >
                    ✕
                  </button>
                </span>
              </td>
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
      :file-ids="selectedFileIds"
      @approve="approveUpload"
      @cancel-upload="cancelPendingUploads"
      @close="closeUploadDialog"
      @visibility-change="onVisibilityChange"
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
import { useFilesStore, type FileEntry } from '~/stores/files'
import { formatBytes, truncateAddress } from '~/utils/formatters'
import { formatNanoTokens, formatGasCost } from '~/utils/payment'
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

const hasSettledDownloads = computed(() =>
  filesStore.settledDownloads.some(f => f.status !== 'downloading'),
)

function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

// ── Row display helpers ──

function statusLabel(file: FileEntry): string {
  // Already-stored uploads collapse every state after the initial estimate
  // into a single honest label. The real backend still cycles through
  // quoting → paying → uploading for ant-core's bookkeeping, but it's all
  // a no-op sub-second dance in terms of user-visible work.
  if (
    file.alreadyStored
    && (file.status === 'quoting' || file.status === 'queued_for_upload' || file.status === 'paying' || file.status === 'uploading')
  ) {
    return 'Saving datamap…'
  }

  if (file.status === 'uploading') {
    // Wallet-flow direct-key uploads pre-set status='uploading' before the
    // Rust side has gone through encrypt/quote, so the badge would say
    // "Uploading" while the sub-text counts up "Quoting 0..100%". Defer
    // to the actual stage when it disagrees with the outer status.
    if (file.stage === 'encrypting') return 'Encrypting…'
    if (file.stage === 'quoting') return 'Quoting'
    return 'Uploading'
  }
  if (file.status === 'downloading') {
    // Same logic for downloads — datamap resolution can run a few seconds
    // before chunk fetching starts, and the user shouldn't see "Downloading"
    // while we're still pulling the datamap apart.
    if (file.stage === 'resolving') return 'Resolving datamap'
    return 'Downloading'
  }
  if (file.status === 'downloaded') return 'Downloaded'
  if (file.status === 'failed') return file.error ? `Failed: ${file.error}` : 'Failed'
  if (file.status === 'complete') return 'Complete'
  if (file.status === 'queued_for_quote') return 'Queued: quoting'
  if (file.status === 'queued_for_upload') return 'Queued: uploading'
  if (file.status === 'quoting') {
    if (connectionStore.hasFailed) return 'Network unavailable'
    if (!connectionStore.isConnected) return 'Connecting to network…'
    return 'Obtaining quote…'
  }
  if (file.status === 'awaiting_approval') return 'Ready to approve'
  // `paying` is only reachable from the external-signer flow (wallet-flow
  // direct-key never enters this state — Rust drives payment internally),
  // so we can label it for that context unconditionally.
  if (file.status === 'paying') return 'Awaiting approval'
  return file.status
}

/** Sub-stage detail line shown under the status badge while a transfer is
 *  active. Maps the stage / cumulative counts coming from ant-core's
 *  UploadEvent / DownloadEvent stream into a tight label that fits a row.
 *  Shows a per-stage percent (how far through the current step we are);
 *  the bar above shows global progress. Returns null when there's nothing
 *  useful to show (no event yet, or the row isn't in an active state). */
function stageDetail(file: FileEntry): string | null {
  if (!file.stage) return null
  const done = file.stageDone ?? 0
  const total = file.stageTotal
  const pct = total && total > 0 ? Math.round((done / total) * 100) : null
  switch (file.stage) {
    case 'encrypting':
      // Encryption has no total until it finishes — fall back to a spinner.
      return 'Encrypting…'
    case 'quoting':
      return pct !== null ? `Quoting · ${pct}%` : 'Quoting…'
    case 'uploading':
      return pct !== null ? `Storing · ${pct}%` : 'Storing…'
    case 'resolving':
      return pct !== null ? `Resolving datamap · ${pct}%` : 'Resolving datamap…'
    case 'downloading':
      return pct !== null ? `Downloading · ${pct}%` : 'Downloading…'
    default:
      return null
  }
}

/** Whether the row should render a progress bar. Shown for every active
 *  transfer state where progress events are flowing or could flow:
 *
 *  - `quoting`     — start_upload emits Encrypting/Encrypted/ChunkQuoted (0..50%)
 *  - `paying`      — bar freezes at 50% while the wallet popup is open
 *  - `uploading`   — confirm_upload emits ChunkStored (50..100%)
 *  - `downloading` — file_download emits ChunksFetched (0..100%)
 *
 *  Even when `percent` is null (encryption, before total chunks are known)
 *  we render an indeterminate bar so the user sees motion. */
function showsProgressBar(file: FileEntry): boolean {
  return (
    file.status === 'quoting'
    || file.status === 'paying'
    || file.status === 'uploading'
    || file.status === 'downloading'
  )
}

/** Settled = not currently transferring or queued. Per-row Remove and (for
 *  failed uploads) Retry are gated on this — we don't want a row to vanish
 *  mid-store. */
function isSettled(file: FileEntry): boolean {
  return file.status === 'failed' || file.status === 'complete' || file.status === 'downloaded'
}

/** Retry only applies to failed uploads — failed downloads need a different
 *  re-fetch path that's not in scope for this iteration. */
function canRetry(file: FileEntry): boolean {
  return file.kind === 'upload' && file.status === 'failed' && !!file.path
}

function onRetry(file: FileEntry) {
  filesStore.retryUpload(file.id)
}

function onRemove(file: FileEntry) {
  filesStore.removeEntry(file.id)
}

function isReopenable(file: FileEntry): boolean {
  if (file.kind !== 'upload') return false
  return (
    file.status === 'queued_for_quote'
    || file.status === 'quoting'
    || file.status === 'awaiting_approval'
    || file.status === 'queued_for_upload'
  )
}

function rowClass(file: FileEntry): string {
  if (file.status === 'downloaded') return 'hover:bg-autonomi-surface/50 cursor-pointer bg-autonomi-blue/5'
  if (isReopenable(file)) return 'hover:bg-autonomi-surface/50 cursor-pointer'
  if (file.status === 'failed') return 'hover:bg-autonomi-surface/50 opacity-60'
  return 'hover:bg-autonomi-surface/50'
}

function onRowClick(file: FileEntry) {
  if (isReopenable(file)) {
    reopenUploadDialog(file.id)
    return
  }
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
//
// The dialog is a thin view bound to FileEntry ids. Quote state lives on the
// entries themselves (stores/files.ts), which means the dialog can be closed
// and reopened mid-flight without losing anything. Row click on a pending
// entry in the uploads table reopens the dialog for that entry.

const showUploadConfirm = ref(false)
const selectedFileIds = ref<number[]>([])

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
  // Entries enter `queued_for_quote`; the scheduler promotes them to
  // `quoting` as concurrency slots open. Dialog renders off the entries,
  // so rows appear immediately and reactively update as the scheduler
  // works through them.
  const metas = await getFileMetas(paths)
  const ids = metas.map(m => filesStore.addUpload(m.name, m.path, m.size))
  selectedFileIds.value = ids
  showUploadConfirm.value = true

  // Indelible bypass: the remote gateway handles pricing, so skip the
  // quote phase entirely — entries jump straight to `awaiting_approval`.
  if (settingsStore.indelibleConnected && !settingsStore.devnetActive) {
    for (const id of ids) filesStore.updateEntry(id, { status: 'awaiting_approval' })
    return
  }

  kickScheduler()
}

// Reopen the confirm dialog for an entry the user clicked in the uploads
// table. Supports the four pre-payment stalls; `paying`/`uploading` rows
// stay non-clickable (nothing actionable there).
function reopenUploadDialog(id: number) {
  selectedFileIds.value = [id]
  showUploadConfirm.value = true
}

// Public uploads pay for one extra chunk (the data map itself), so the quote
// has to be redone when the user flips visibility. We update each selected
// entry; the scheduler re-quotes any that aren't yet awaiting_approval, and
// the Approve handler picks up the final visibility regardless.
function onVisibilityChange(visibility: 'private' | 'public') {
  for (const id of selectedFileIds.value) {
    filesStore.updateEntry(id, { visibility })
  }
}

function approveUpload(options: { visibility: 'private' | 'public'; paymentMode: 'regular' | 'merkle' }) {
  showUploadConfirm.value = false
  const ids = selectedFileIds.value.slice()
  selectedFileIds.value = []

  for (const id of ids) {
    const entry = filesStore.findById(id)
    if (!entry || entry.status !== 'awaiting_approval') continue

    filesStore.updateEntry(id, { visibility: options.visibility })

    if (settingsStore.indelibleConnected && !settingsStore.devnetActive) {
      filesStore.startIndelibleUpload(id)
    } else {
      // Autonomi path — queue for the scheduler to dispatch.
      filesStore.enqueueForUpload(id)
    }
  }
  kickScheduler()
}

// ── Upload concurrency scheduler ──
//
// Single budget `settingsStore.uploadConcurrency` covers both quoting and
// uploading (they both hit the network; Autonomi throughput degrades non-
// linearly so serial-by-default is the safe choice).
//
// Priority: promote `queued_for_quote` first so the dialog can enable the
// Approve button ASAP; then drain `queued_for_upload` post-approval. Offline
// → skip all promotions (entries stay queued and resume when the watcher
// sees `autonomiConnected` flip).
function kickScheduler() {
  if (settingsStore.indelibleConnected && !settingsStore.devnetActive) return
  const online = autonomiConnected.value || settingsStore.devnetActive
  if (!online) return

  const budget = settingsStore.uploadConcurrency

  while (true) {
    const quotingCount = filesStore.quotingCount
    const uploadingCount = filesStore.uploadingCount
    const active = quotingCount + uploadingCount
    if (active >= budget) break

    const quoteHead = filesStore.queuedForQuote[0]
    if (quoteHead) {
      // beginQuoting synchronously flips status to `quoting`, then awaits
      // the estimate; we count the slot from the status change.
      filesStore.beginQuoting(quoteHead.id)
      continue
    }

    const uploadHead = filesStore.queuedForUpload[0]
    if (!uploadHead) break

    const wagmiConfig = getWagmiConfig()
    if (!wagmiConfig) {
      filesStore.updateEntry(uploadHead.id, {
        status: 'failed',
        error: 'Wallet not connected',
      })
      toastStore.add('Upload requires a wallet', 'warning')
      continue
    }

    const opts = {
      visibility: uploadHead.visibility ?? 'private' as const,
      paymentMode: uploadHead.paymentMode ?? 'regular' as const,
    }
    filesStore.startRealUpload(uploadHead.id, wagmiConfig, opts)
  }
}

// Auto-track every reactive dep the scheduler reads via watchEffect. Runs
// once on setup and re-runs whenever any of the store getters / connection
// state change. watchEffect is more robust here than the array-source form
// of watch because we don't have to remember to list every dep by hand.
watchEffect(() => {
  // Touch every reactive input so it's registered, then kick.
  void settingsStore.uploadConcurrency
  void filesStore.quotingCount
  void filesStore.uploadingCount
  void filesStore.queuedForQuote.length
  void filesStore.queuedForUpload.length
  void autonomiConnected.value
  void settingsStore.devnetActive
  kickScheduler()
})

// Auto-dismiss the confirm dialog when every selected entry was detected as
// already stored on the network. Those entries bypass `awaiting_approval`
// (no user decision left to make) and flow through the scheduler on their
// own, so leaving the dialog open waiting for an Approve that can never
// enable is just clutter.
watch(
  () => selectedFileIds.value.map(id => filesStore.findById(id)?.alreadyStored),
  (flags) => {
    if (!showUploadConfirm.value) return
    if (flags.length === 0) return
    if (flags.some(f => f === undefined)) return
    if (!flags.every(f => f === true)) return
    const n = flags.length
    showUploadConfirm.value = false
    selectedFileIds.value = []
    toastStore.add(
      `${n} file${n !== 1 ? 's' : ''} already stored — saving datamap`,
      'info',
    )
  },
)

function cancelPendingUploads() {
  for (const id of selectedFileIds.value) filesStore.cancelPendingUpload(id)
  selectedFileIds.value = []
  showUploadConfirm.value = false
}

function closeUploadDialog() {
  showUploadConfirm.value = false
  selectedFileIds.value = []
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
    // Parallel: each estimate is independent, and this is display-only.
    const results = await Promise.all(
      metas.map(async (meta) => ({
        meta,
        estimate: await filesStore.estimateFileCost(meta.path),
      })),
    )
    for (const { meta, estimate } of results) {
      if (!estimate) continue
      const idx = costFiles.value.findIndex(f => f.name === meta.name)
      if (idx === -1) continue
      costFiles.value[idx] = {
        ...costFiles.value[idx],
        cost: formatNanoTokens(estimate.storage_cost_atto),
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

function copyPublicAddress(addr: string) {
  navigator.clipboard.writeText(addr)
  toastStore.add('Public address copied — share to let others download this file', 'info')
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
