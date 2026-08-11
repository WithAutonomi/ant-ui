import { acceptHMRUpdate, defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useToastStore } from './toasts'
import { useSettingsStore } from './settings'
import { payForQuotes, payForMerkleTree, formatNanoTokens, formatGasCost, type RawPayment, type SerializedPoolCommitment } from '~/utils/payment'
import { indelibleApi } from '~/utils/indelible-api'
import { i18n } from '~/plugins/i18n.client'

/** Module-scope translator. Options-API store actions can't call useI18n() —
 *  they run outside Vue's setup context — so we route through the global
 *  composer the plugin already configured. */
const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {})

// ── Lightweight cost estimate (no chunks parked) ──
// Matches ant_core::data::UploadCostEstimate.
export interface UploadCostEstimate {
  file_size: number
  chunk_count: number
  storage_cost_atto: string
  estimated_gas_cost_wei: string
  payment_mode: 'auto' | 'single' | 'merkle'
}

// ── Pre-obtained quote from network ──

export interface UploadQuote {
  upload_id: string
  payment_mode: 'wave-batch' | 'merkle'
  // Wave-batch fields
  payments: RawPayment[]
  total_cost: string
  total_cost_display: string
  payment_required: boolean
  // Merkle fields
  merkle_depth?: number
  merkle_pool_commitments?: SerializedPoolCommitment[]
  merkle_timestamp?: number
  // Gas estimate
  estimated_gas?: string | null
}

// ── Unified file entry ──

export type FileStatus =
  | 'complete'           // Normal row, no active transfer
  | 'queued_for_quote'   // Upload: waiting in queue for a quoting slot
  | 'quoting'            // Upload: getting cost estimate
  | 'awaiting_approval'  // Upload: estimate in, waiting for user to click Approve
  | 'queued_for_upload'  // Upload: approved, waiting in queue for an upload slot
  | 'paying'             // Upload: wallet payment in progress
  | 'uploading'          // Upload: data being sent to network
  | 'downloading'        // Download: fetching from network
  | 'downloaded'         // Download complete, waiting for user to open folder
  | 'failed'             // Transfer failed

/** Sub-stage inside an active transfer. Maps 1:1 to ant-core's UploadEvent /
 *  DownloadEvent variants surfaced by the Rust progress forwarder. Drives the
 *  detailed label under the status badge ("Encrypting", "Quoting 12/64", ...). */
export type TransferStage =
  | 'encrypting'
  | 'quoting'
  | 'uploading'
  | 'resolving'
  | 'downloading'

interface ProgressEventPayload {
  transfer_id: string
  stage: TransferStage
  done: number
  total: number | null
  percent: number | null
}

export interface FileEntry {
  /** Unique ID for reactive tracking */
  id: number
  /** Whether this row represents an upload or a download. Uploads persist
   *  across restarts; downloads are in-memory only and a fresh session
   *  always starts with an empty downloads table. */
  kind: 'upload' | 'download'
  /** Display name */
  name: string
  /** Local file path (for uploads) */
  path?: string
  /** Size in bytes */
  size_bytes: number
  /** Network address (hex) — for display / sharing */
  address?: string
  /** On-network chunk address of the published DataMap, set for public
   *  uploads. This is the single shareable handle — anyone with it can
   *  fetch the DataMap via `download_public` and decrypt the file. */
  public_address?: string
  /** Serialized DataMap JSON — needed for download from network */
  data_map_json?: string
  /** Absolute path to the persisted DataMap file on disk. Set for private
   *  uploads performed by this app; `undefined` for legacy entries or for
   *  rows that represent a pure download-by-address with no local datamap. */
  data_map_file?: string
  /** Upload cost (ANT) */
  cost?: string
  /** Gas cost (ETH) */
  gas_cost?: string
  /** Current status */
  status: FileStatus
  /** Transfer progress 0-100 */
  progress?: number
  /** Sub-stage inside the active transfer, populated by upload-progress /
   *  download-progress events. Ephemeral — cleared when the transfer settles. */
  stage?: TransferStage
  /** Cumulative chunks completed in the current stage (paired with stageTotal). */
  stageDone?: number
  /** Total chunks for the current stage; absent during encryption (total
   *  unknown until encryption finishes). */
  stageTotal?: number
  /** Local destination path (for downloads) */
  dest_path?: string
  /** When the entry was created/uploaded */
  date: string
  /** When active transfer started (epoch ms, for duration calc) */
  transferStartedAt?: number
  /** Transfer duration in seconds */
  duration?: number
  /** Error message if failed */
  error?: string
  /** Raw light-estimate result (held while the entry is in the confirm dialog) */
  estimate?: UploadCostEstimate
  /** Payment mode derived from the estimate; carried through to the real upload */
  paymentMode?: 'regular' | 'merkle'
  /** Visibility chosen in the confirm dialog */
  visibility?: 'private' | 'public'
  /** True when ant-core's estimator reported every chunk already stored on
   *  the network (`storage_cost_atto === "0"` with a positive `chunk_count`).
   *  Distinguishes a genuinely free re-upload from a suspiciously cheap quote. */
  alreadyStored?: boolean
}

// Pinned rows (top of the table, independent sort). Includes the two queued
// states and awaiting_approval because the user must still see them and be
// able to reopen the dialog — they just aren't doing network work yet.
const ACTIVE_STATUSES: FileStatus[] = [
  'queued_for_quote',
  'quoting',
  'awaiting_approval',
  'queued_for_upload',
  'paying',
  'uploading',
  'downloading',
  'downloaded',
]
// Entries with live network activity. Excludes the queued/awaiting_approval
// stalls (they don't need progress bars or spinners in the header).
const IN_FLIGHT_STATUSES: FileStatus[] = ['quoting', 'paying', 'uploading', 'downloading']

/** Full error dump for the log file: message + stack of every layer of the
 *  cause chain, so the viem diagnostics (revert selector, calldata, request
 *  args) survive even when wrapped in a plain Error by the preflight. */
function paymentErrorDump(e: any): string {
  const parts: string[] = []
  for (let err = e, depth = 0; err && depth < 5; err = err.cause, depth++) {
    parts.push(String(err?.stack ?? err?.message ?? err))
  }
  return parts.join('\n--- caused by ---\n')
}

/** One-line summary of a wallet payment error. viem's `.message` is a
 *  multi-line diagnostic dump (request args, calldata, docs link) meant for
 *  the log, not the UI; `shortMessage` carries the human sentence — though
 *  even that puts a revert's selector/reason on a second line, so flatten
 *  before rendering. A 4001 rejection — the code survives WalletConnect and
 *  the browser-bridge relay alike — gets its own friendlier line. */
function paymentErrorSummary(e: any): string {
  console.error('[payment]', e)
  // Production builds have no devtools console — mirror the full dump into
  // the Rust rolling log so field failures are diagnosable after the fact.
  invoke('log_frontend_error', { context: 'payment', detail: paymentErrorDump(e) }).catch(() => {})
  const rejected =
    typeof e?.walk === 'function'
      ? Boolean(e.walk((c: any) => c?.code === 4001))
      : e?.code === 4001
  if (rejected) return 'Cancelled in your wallet'
  const s = e?.shortMessage ?? String(e?.message ?? e).split('\n')[0]
  return String(s).replace(/\s*\n\s*/g, ' ').trim()
}

/** Shape persisted to upload_history.json (kept for backwards compat) */
export interface UploadHistoryEntry {
  name: string
  size_bytes: number
  address: string
  cost: string | null
  uploaded_at: string
  /** Absolute path to the persisted DataMap file; `null`/absent for legacy
   *  entries written before datamap persistence was added. */
  data_map_file?: string | null
  /** ETH gas cost (formatted string). `null`/absent for legacy entries
   *  written before gas was tracked, or for already-stored uploads where
   *  no payment tx ran. */
  gas_cost?: string | null
  /** On-network chunk address of the published DataMap for public uploads.
   *  `null`/absent for private uploads and for legacy entries. */
  public_address?: string | null
}

export const useFilesStore = defineStore('files', {
  state: () => ({
    files: [] as FileEntry[],
    nextId: 1,
    historyLoaded: false,
    /** True if loadHistory threw and we never populated `files` from disk.
     *  persistHistory must refuse to write while this is set — otherwise the
     *  next upload-complete/remove/clear would overwrite the on-disk file
     *  with an empty array, orphaning every prior datamap entry. */
    historyLoadFailed: false,
    /** True once the Rust progress event listeners have been wired up.
     *  Idempotent — safe to call setupProgressListeners() multiple times. */
    _progressListenersStarted: false,
    /** Maps a Rust-side transfer_id (string) to its FileEntry row id (number).
     *  The wallet/download paths use `String(id)` so the listener falls through
     *  to a numeric parse; the external-signer path uses an opaque `quote-…`
     *  id assigned by `getUploadQuote`, which we register here. */
    _transferIdToRowId: {} as Record<string, number>,
    /** Set by the deep-link handler when an `autonomi://<address>` URL is
     *  opened. The Files page watches this, opens the Download dialog prefilled
     *  with the address, and clears it. Null when there's nothing pending. */
    pendingDownloadAddress: null as string | null,
    /** Optional filename from the deep link's `?name=`, paired with
     *  `pendingDownloadAddress`. Null/empty when the link carried no name. */
    pendingDownloadName: null as string | null,
  }),

  getters: {
    uploads: (state) => state.files.filter(f => f.kind === 'upload'),
    downloads: (state) => state.files.filter(f => f.kind === 'download'),

    /** Rows that are actively transferring (pinned to top of their table) */
    pinnedUploads(): FileEntry[] {
      return this.uploads.filter(f => ACTIVE_STATUSES.includes(f.status))
    },
    pinnedDownloads(): FileEntry[] {
      return this.downloads.filter(f => ACTIVE_STATUSES.includes(f.status))
    },

    /** Rows that are not active transfers (sorted normally) */
    settledUploads(): FileEntry[] {
      return this.uploads.filter(f => !ACTIVE_STATUSES.includes(f.status))
    },
    settledDownloads(): FileEntry[] {
      return this.downloads.filter(f => !ACTIVE_STATUSES.includes(f.status))
    },

    /** Any row in any table currently mid-transfer. Used by the header. */
    pinnedFiles(): FileEntry[] {
      return this.files.filter(f => ACTIVE_STATUSES.includes(f.status))
    },

    hasActiveTransfers: (state) =>
      state.files.some(f => IN_FLIGHT_STATUSES.includes(f.status)),

    /** Uploads currently holding a quoting slot. Used by the page scheduler
     *  to decide whether to promote the next `queued_for_quote` entry. */
    quotingCount: (state) =>
      state.files.filter(f => f.kind === 'upload' && f.status === 'quoting').length,

    /** Uploads currently holding an upload slot (payment or chunk storage). */
    uploadingCount: (state) =>
      state.files.filter(
        f => f.kind === 'upload' && (f.status === 'paying' || f.status === 'uploading'),
      ).length,

    /** FIFO list (oldest first, by row id) of entries waiting for a quote slot. */
    queuedForQuote: (state) =>
      state.files
        .filter(f => f.kind === 'upload' && f.status === 'queued_for_quote')
        .sort((a, b) => a.id - b.id),

    /** FIFO list of entries waiting for an upload slot (post-approval). */
    queuedForUpload: (state) =>
      state.files
        .filter(f => f.kind === 'upload' && f.status === 'queued_for_upload')
        .sort((a, b) => a.id - b.id),
  },

  actions: {
    // ── Persistence ──

    async loadHistory() {
      try {
        const entries = await invoke<UploadHistoryEntry[]>('load_upload_history')
        for (const e of entries) {
          // Skip if we already have this address in the uploads table — guards
          // against double-loading on HMR without adding duplicates.
          if (this.files.some(f => f.kind === 'upload' && f.address === e.address)) continue
          this.files.push({
            id: this.nextId++,
            kind: 'upload',
            name: e.name,
            size_bytes: e.size_bytes,
            address: e.address,
            public_address: e.public_address ?? undefined,
            cost: e.cost ?? undefined,
            gas_cost: e.gas_cost ?? undefined,
            data_map_file: e.data_map_file ?? undefined,
            status: 'complete',
            date: e.uploaded_at,
          })
        }
        this.historyLoaded = true
        this.historyLoadFailed = false
      } catch (e) {
        console.error('Failed to load upload history:', e)
        this.historyLoaded = true
        this.historyLoadFailed = true
      }
    },

    async persistHistory() {
      // Fail-closed: if we never successfully loaded the history, refuse to
      // write. Otherwise a load error would set `files = []` and the next
      // upload-complete/remove/clear would clobber upload_history.json,
      // orphaning every prior datamap on disk.
      if (this.historyLoadFailed) {
        console.warn('Skipping upload history save — initial load failed; not overwriting on-disk file.')
        return
      }
      // Only uploads are persisted — downloads are intentionally in-memory
      // so the table starts fresh each session.
      const entries: UploadHistoryEntry[] = this.files
        .filter(f => f.kind === 'upload' && f.status === 'complete' && f.address)
        .map(f => ({
          name: f.name,
          size_bytes: f.size_bytes,
          address: f.address!,
          cost: f.cost ?? null,
          uploaded_at: f.date,
          data_map_file: f.data_map_file ?? null,
          gas_cost: f.gas_cost ?? null,
          public_address: f.public_address ?? null,
        }))

      try {
        await invoke('save_upload_history', { entries })
      } catch (e) {
        console.error('Failed to save upload history:', e)
      }
    },

    // ── Progress event plumbing ──

    /** Subscribe to upload-progress / download-progress events from the Rust
     *  backend and route them to the matching FileEntry. The Rust side echoes
     *  the entry id (as a string) as `transfer_id`, so we just parse it back
     *  and updateEntry. Idempotent — only wires once per session. */
    async setupProgressListeners() {
      if (this._progressListenersStarted) return
      this._progressListenersStarted = true

      const apply = (payload: ProgressEventPayload) => {
        // External-signer flow registers a string→row mapping; wallet/download
        // flows just stringify the row id. Try the map first, fall back to a
        // numeric parse.
        const mapped = this._transferIdToRowId[payload.transfer_id]
        const id = mapped ?? Number(payload.transfer_id)
        if (!Number.isFinite(id)) return
        // The transfer may have already settled (failed / completed) by the
        // time a tail-end event arrives; updateEntry no-ops on missing ids.
        this.updateEntry(id, {
          stage: payload.stage,
          stageDone: payload.done,
          stageTotal: payload.total ?? undefined,
          progress: payload.percent ?? undefined,
        })
      }

      await listen<ProgressEventPayload>('upload-progress', e => apply(e.payload))
      await listen<ProgressEventPayload>('download-progress', e => apply(e.payload))
    },

    // ── Entry management ──

    findById(id: number): FileEntry | undefined {
      return this.files.find(f => f.id === id)
    },

    updateEntry(id: number, updates: Partial<FileEntry>) {
      const entry = this.files.find(f => f.id === id)
      if (entry) Object.assign(entry, updates)
    },

    removeEntry(id: number) {
      const idx = this.files.findIndex(f => f.id === id)
      if (idx === -1) return
      const wasUpload = this.files[idx].kind === 'upload'
      this.files.splice(idx, 1)
      if (wasUpload) this.persistHistory()
    },

    /** Reset a failed upload row so the scheduler picks it up for another go.
     *  Reuses `entry.path` so the user doesn't need to re-pick the file from
     *  disk, and clears stale per-attempt fields (error, progress, stage,
     *  address/datamap, costs). Status flips to `queued_for_upload` so the
     *  page scheduler re-runs `startRealUpload` and gets a fresh quote. */
    retryUpload(id: number) {
      const entry = this.files.find(f => f.id === id)
      if (!entry || entry.kind !== 'upload' || entry.status !== 'failed') return
      if (!entry.path) return
      this.updateEntry(id, {
        status: 'queued_for_upload',
        error: undefined,
        progress: undefined,
        stage: undefined,
        stageDone: undefined,
        stageTotal: undefined,
        address: undefined,
        data_map_json: undefined,
        data_map_file: undefined,
        cost: undefined,
        gas_cost: undefined,
        alreadyStored: undefined,
        duration: undefined,
        transferStartedAt: Date.now(),
      })
    },

    /** Remove every upload row in a settled state. Persists. */
    clearUploadHistory() {
      this.files = this.files.filter(f =>
        !(f.kind === 'upload' && (f.status === 'complete' || f.status === 'failed')),
      )
      this.persistHistory()
    },

    /** Drop every download row that isn't mid-transfer. Memory-only, no persist. */
    clearDownloads() {
      this.files = this.files.filter(f =>
        !(f.kind === 'download' && !IN_FLIGHT_STATUSES.includes(f.status)),
      )
    },

    // ── Upload flow ──

    /** Create a new upload row. Entry starts in `queued_for_quote`; the page
     *  scheduler promotes it to `quoting` when a concurrency slot opens. */
    addUpload(name: string, path: string, size_bytes: number): number {
      const id = this.nextId++
      this.files.unshift({
        id,
        kind: 'upload',
        name,
        path,
        size_bytes,
        status: 'queued_for_quote',
        date: new Date().toISOString(),
        transferStartedAt: Date.now(),
      })
      return id
    },

    /** Run the light estimate for an entry that's ready to quote. Promotes
     *  `queued_for_quote` → `quoting` on entry (so concurrency accounting is
     *  consistent while the async estimate is in flight), then transitions
     *  to `awaiting_approval` when the estimate returns — even if the
     *  estimate itself failed, so the real quote can surface a clearer
     *  error on `startRealUpload`. */
    async beginQuoting(id: number) {
      const entry = this.findById(id)
      if (!entry || entry.kind !== 'upload' || !entry.path) return
      if (entry.status !== 'quoting' && entry.status !== 'queued_for_quote') return

      this.updateEntry(id, { status: 'quoting' })

      const estimate = await this.estimateFileCost(entry.path)
      if (estimate) {
        // ant-core returns "0" for both fields when every sampled chunk is
        // already on the network (see ant-core file.rs::estimate_upload_cost).
        // That's a legitimate signal, not a failed estimate — flag it so the
        // UI can say "already stored" instead of rendering "0 ANT" as if it
        // were any other cheap quote.
        const alreadyStored = estimate.chunk_count > 0
          && estimate.storage_cost_atto === '0'
          && estimate.estimated_gas_cost_wei === '0'

        // Even when every data chunk is already on the network the user still
        // has a real decision to make: a private upload returns/writes the
        // DataMap for later retrieval, a public upload publishes the DataMap
        // on-network so it can be shared. Neither is a no-op, so always route
        // through awaiting_approval and require an explicit Approve rather than
        // silently queuing already-stored files with a default visibility.
        this.updateEntry(id, {
          estimate,
          paymentMode: estimate.payment_mode === 'merkle' ? 'merkle' : 'regular',
          cost: formatNanoTokens(estimate.storage_cost_atto),
          gas_cost: formatGasCost(estimate.estimated_gas_cost_wei),
          alreadyStored,
          status: 'awaiting_approval',
        })
      } else {
        this.updateEntry(id, { status: 'awaiting_approval' })
      }
    },

    /** Mark an approved entry as waiting for an upload slot. Caller is
     *  responsible for kicking the scheduler. */
    enqueueForUpload(id: number) {
      const entry = this.findById(id)
      if (!entry || entry.status !== 'awaiting_approval') return
      this.updateEntry(id, { status: 'queued_for_upload' })
    },

    /** Cancel a pending upload that hasn't started paying yet. Covers the
     *  four pre-payment stalls: both queued states plus quoting and
     *  awaiting_approval. Once payment begins the backend owns the flow. */
    cancelPendingUpload(id: number) {
      const entry = this.findById(id)
      if (!entry) return
      const cancellable: FileStatus[] = [
        'queued_for_quote',
        'quoting',
        'awaiting_approval',
        'queued_for_upload',
      ]
      if (!cancellable.includes(entry.status)) return
      this.removeEntry(id)
    },

    /** Light-touch cost estimate — wraps ant-core `estimate_upload_cost`.
     *  Encrypts the file locally, samples one network quote, extrapolates cost.
     *  Does NOT park a `PreparedUpload`, so the user can cancel without orphaning
     *  hundreds of chunks in the daemon's pending_uploads map. Display-only;
     *  actual uploads must still go through `getUploadQuote`/`start_upload`. */
    async estimateFileCost(path: string): Promise<UploadCostEstimate | null> {
      try {
        return await invoke<UploadCostEstimate>('estimate_file_cost', { path })
      } catch (e) {
        console.warn('estimate_file_cost failed:', e)
        return null
      }
    },

    /** Get a real network quote for a file. Parks a `PreparedUpload` in the
     *  daemon. Used internally by `startRealUpload` after the user clicks
     *  Confirm — not for display. For pre-upload cost display, use
     *  `estimateFileCost` instead.
     *
     *  `visibility` controls whether ant-core bundles the serialized DataMap
     *  into the payment batch. Public quotes cost slightly more than private
     *  ones because the DataMap is billed as one extra chunk. A quote obtained
     *  with one visibility must be finalized with the same visibility — the
     *  prepared chunks on the backend differ — so callers re-quote if the
     *  user changes their selection.
     *
     *  `transferRowId` registers the transfer_id → row mapping before invoke
     *  so quote-phase upload-progress events route to the right uploads-table
     *  row from the very first event. */
    async getUploadQuote(
      path: string,
      visibility: 'private' | 'public' = 'private',
      transferRowId?: number,
    ): Promise<UploadQuote | null> {
      const uploadId = `quote-${Date.now()}-${Math.random().toString(36).slice(2)}`

      // If the caller has a row to drive a progress bar on, register the
      // transfer_id → row mapping NOW (before invoke). The Rust side starts
      // emitting upload-progress events as soon as encryption begins; if we
      // registered after `start_upload` returns we'd lose the entire quote
      // phase (0–50%).
      if (transferRowId !== undefined) {
        this._transferIdToRowId[uploadId] = transferRowId
      }

      // Deferred so the listener can resolve independently of where the
      // Promise is awaited.
      let resolveQuote: (value: any) => void = () => {}
      const quotePromise = new Promise<any>((resolve) => {
        resolveQuote = resolve
      })

      let unlisten: (() => void) | null = null

      try {
        // Backend contract: `start_upload` emits `upload-quote` before it
        // returns Ok. So `invoke` itself is our timing signal — when it
        // resolves, the event has been dispatched. No separate timeout on
        // the listener: on slow networks quote collection can legitimately
        // take minutes, and an independent timeout just discards the
        // result after the fact. Errors from the backend come through
        // `invoke`'s rejection.
        //
        // Listener is awaited BEFORE invoke so the event cannot be emitted
        // before we're listening.
        unlisten = await listen<any>('upload-quote', (event) => {
          if (event.payload.upload_id === uploadId) {
            resolveQuote(event.payload)
          }
        })

        await invoke('start_upload', {
          request: { files: [path], upload_id: uploadId, visibility },
        })

        const quote = await quotePromise
        return {
          upload_id: uploadId,
          payment_mode: quote.payment_mode,
          payments: quote.payments ?? [],
          total_cost: quote.total_cost,
          total_cost_display: quote.payment_mode === 'merkle' ? 'Determined on-chain' : formatNanoTokens(quote.total_cost),
          payment_required: quote.payment_required,
          merkle_depth: quote.merkle_depth,
          merkle_pool_commitments: quote.merkle_pool_commitments,
          merkle_timestamp: quote.merkle_timestamp,
        }
      } catch {
        return null
      } finally {
        if (unlisten) unlisten()
      }
    },

    async startRealUpload(
      id: number,
      wagmiConfig: any,
      options: { visibility: 'private' | 'public'; paymentMode: 'regular' | 'merkle' } = { visibility: 'private', paymentMode: 'regular' },
      preQuote?: UploadQuote,
    ) {
      const toasts = useToastStore()
      const entry = this.findById(id)
      if (!entry) return

      // Direct-key (manifest) mode: skip the entire JS quote+pay+confirm
      // dance and call the Rust-side wallet_upload, which drives evmlib's
      // wallet flow — same code path ant-cli uses. Avoids JS BigInt
      // round-trips, devops vault-config drift, and double-implementation
      // bugs. WalletConnect users still take the external-signer path below.
      const settings = useSettingsStore()
      if (settings.devnetActive && settings._devnetWalletKeySet) {
        if (!entry.path) {
          this.updateEntry(id, { status: 'failed', error: 'Upload entry has no file path' })
          return
        }
        // Use the entry id as the transfer_id so Rust-side progress events
        // (upload-progress) route straight back to this row.
        this.updateEntry(id, { status: 'uploading', progress: 0 })
        try {
          const result = await invoke<{
            upload_id: string
            data_map_json: string
            address: string
            chunks_stored: number
            data_map_file: string
            public_address: string | null
          }>('wallet_upload', { uploadId: String(id), filePath: entry.path, visibility: options.visibility })

          const duration = entry.transferStartedAt
            ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
            : 0
          this.updateEntry(id, {
            status: 'complete',
            progress: 100,
            address: result.address,
            public_address: result.public_address ?? undefined,
            data_map_json: result.data_map_json,
            data_map_file: result.data_map_file,
            duration,
            transferStartedAt: undefined,
            stage: undefined,
            stageDone: undefined,
            stageTotal: undefined,
          })
          await this.persistHistory()
          toasts.add(t('files.toast.upload_complete', { name: entry.name }), 'info')
        } catch (e: any) {
          this.updateEntry(id, { status: 'failed', error: e.message ?? String(e) })
          toasts.add(t('files.toast.upload_failed', { name: entry.name, error: e.message ?? e }), 'error')
        }
        return
      }

      try {
        let uploadId: string
        let quote: UploadQuote

        if (preQuote) {
          // Use pre-obtained quote (from dialog phase). The caller is
          // responsible for ensuring its visibility matches `options.visibility`
          // — `pages/files.vue` drops the pre-quote when the user changes
          // visibility so we always re-quote with the matching batch.
          uploadId = preQuote.upload_id
          quote = preQuote
          this.updateEntry(id, { cost: preQuote.total_cost_display })
        } else {
          // Get fresh quote from network. Delegates to getUploadQuote so
          // there is a single implementation of the listen+invoke dance.
          if (!entry.path) throw new Error('Upload entry has no file path')
          this.updateEntry(id, { status: 'quoting' })
          const fresh = await this.getUploadQuote(entry.path, options.visibility, id)
          if (!fresh) throw new Error('Failed to get quote from network')
          uploadId = fresh.upload_id
          quote = fresh
          this.updateEntry(id, { cost: quote.total_cost_display })
        }

        // For the dialog flow (preQuote already in hand) the mapping wasn't
        // registered during the dialog's getUploadQuote call. Register it
        // here so confirm_upload's storage events route to the right row.
        if (preQuote) {
          this._transferIdToRowId[uploadId] = id
        }

        // The row may have been cancelled while the quote above was in
        // flight — cancelPendingUpload allows it, and quote collection can
        // legitimately take minutes. updateEntry silently no-ops on removed
        // rows, so without this check the flow would march on into a real
        // on-chain payment (and chunk storage) for an upload the user
        // cancelled, spending funds with no visible row or history entry.
        // Once `paying` is set below no further removal is possible
        // (cancelPendingUpload refuses paying rows), so this single guard
        // closes the race. The daemon's parked PreparedUpload is reclaimed
        // by gc_pending_uploads on a later start_upload.
        if (!this.findById(id)) return

        this.updateEntry(id, { status: 'paying' })

        if (quote.payment_mode === 'merkle') {
          // Merkle path: single tx for all chunks. Only the on-chain payment
          // is wrapped here — confirm_upload_merkle rejections are storage
          // failures, not payment failures, so they fall through to the
          // outer catch and surface as an upload failure (mirroring the
          // wave-batch path below).
          let winnerPoolHash!: string
          try {
            const payResult = await withTimeout(
              payForMerkleTree(
                wagmiConfig,
                quote.merkle_depth!,
                quote.merkle_pool_commitments!,
                BigInt(quote.merkle_timestamp!),
              ),
              300_000,
              'Payment timed out — wallet approval took too long',
            )
            winnerPoolHash = payResult.winnerPoolHash

            this.updateEntry(id, {
              status: 'uploading',
              progress: 0,
              cost: formatNanoTokens(payResult.totalPaid.toString()),
              gas_cost: formatGasCost(payResult.gasSpent.toString()),
            })
          } catch (e: any) {
            const summary = paymentErrorSummary(e)
            this.updateEntry(id, { status: 'failed', error: `Payment failed: ${summary}` })
            toasts.add(t('files.toast.payment_failed', { error: summary }), 'error')
            return
          }

          // No frontend timeout: the backend drives chunk storage, which
          // can legitimately take many minutes for larger files. The CLI
          // (which works) also has no timeout here. Backend errors still
          // surface through invoke's rejection.
          const result = await invoke<{ upload_id: string; data_map_json: string; address: string; chunks_stored: number; data_map_file: string; public_address: string | null }>('confirm_upload_merkle', {
            uploadId,
            winnerPoolHash,
          })

          const duration = entry.transferStartedAt
            ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
            : 0
          this.updateEntry(id, {
            status: 'complete',
            progress: 100,
            address: result.address,
            public_address: result.public_address ?? undefined,
            data_map_json: result.data_map_json,
            data_map_file: result.data_map_file,
            duration,
            transferStartedAt: undefined,
          })
        } else {
          // Wave-batch path: pay per batch then finalize
          let txHashes: Record<string, string> = {}
          if (quote.payment_required) {
            try {
              const payResult = await withTimeout(
                payForQuotes(wagmiConfig, quote.payments),
                300_000,
                'Payment timed out — wallet approval took too long',
              )
              txHashes = payResult.txHashMap
              this.updateEntry(id, { gas_cost: formatGasCost(payResult.gasSpent.toString()) })
            } catch (e: any) {
              const summary = paymentErrorSummary(e)
              this.updateEntry(id, { status: 'failed', error: `Payment failed: ${summary}` })
              toasts.add(t('files.toast.payment_failed', { error: summary }), 'error')
              return
            }
          }

          this.updateEntry(id, { status: 'uploading', progress: 0 })

          // No frontend timeout — see confirm_upload_merkle above for rationale.
          const result = await invoke<{ upload_id: string; data_map_json: string; address: string; chunks_stored: number; data_map_file: string; public_address: string | null }>('confirm_upload', {
            uploadId,
            txHashes,
          })

          const duration = entry.transferStartedAt
            ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
            : 0
          this.updateEntry(id, {
            status: 'complete',
            progress: 100,
            address: result.address,
            public_address: result.public_address ?? undefined,
            data_map_json: result.data_map_json,
            data_map_file: result.data_map_file,
            duration,
            transferStartedAt: undefined,
          })
        }

        await this.persistHistory()
        toasts.add(t('files.toast.upload_complete', { name: entry.name }), 'info')
      } catch (e: any) {
        this.updateEntry(id, { status: 'failed', error: e.message ?? String(e) })
        toasts.add(t('files.toast.upload_failed', { name: entry.name, error: e.message ?? e }), 'error')
      }
    },

    /** Upload via Indelible server (skips quoting/paying — server handles cost). */
    async startIndelibleUpload(id: number) {
      const toasts = useToastStore()
      const entry = this.findById(id)
      if (!entry || !entry.path) return

      try {
        this.updateEntry(id, { status: 'uploading', progress: 0 })

        // Read file from disk via Tauri, create FormData, post to Indelible
        const bytes: number[] = await invoke('read_file_bytes', { path: entry.path })
        const blob = new Blob([new Uint8Array(bytes)])
        const formData = new FormData()
        formData.append('file', blob, entry.name)
        formData.append('visibility', 'private')

        const result = await indelibleApi.upload(formData)

        const duration = entry.transferStartedAt
          ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
          : 0
        this.updateEntry(id, {
          status: 'complete',
          progress: 100,
          address: result.autonomi_address ?? undefined,
          cost: result.estimated_cost ?? undefined,
          duration,
          transferStartedAt: undefined,
        })

        await this.persistHistory()
        toasts.add(t('files.toast.upload_complete', { name: entry.name }), 'info')
      } catch (e: any) {
        this.updateEntry(id, { status: 'failed', error: e.message ?? String(e) })
        toasts.add(t('files.toast.upload_failed', { name: entry.name, error: e.message ?? e }), 'error')
      }
    },

    // ── Download flow ──

    /**
     * Start a download row. Always creates a fresh entry in the downloads
     * table — uploads are never mutated in place, so the upload history
     * stays stable across download attempts.
     *
     * If the address matches a prior upload by this app, the new download
     * inherits its datamap (JSON or file path). The "address" is a local
     * SHA256 of the serialized DataMap, so without that lookup a pasted
     * address has no way to resolve to a DataMap — the network can't be
     * queried by this synthetic address.
     */
    startDownload(address: string, filename: string, dest_path: string): number {
      const id = this.nextId++
      const match = this.findUploadByAddress(address)
      this.files.unshift({
        id,
        kind: 'download',
        name: filename,
        size_bytes: 0,
        address,
        data_map_json: match?.data_map_json,
        data_map_file: match?.data_map_file,
        status: 'downloading',
        dest_path,
        progress: 0,
        date: new Date().toISOString(),
        transferStartedAt: Date.now(),
      })
      return id
    },

    findUploadByAddress(address: string): FileEntry | undefined {
      const needle = normalizeAddress(address)
      return this.files.find(
        f => f.kind === 'upload' && f.address && normalizeAddress(f.address) === needle,
      )
    },

    async startRealDownload(id: number) {
      const toasts = useToastStore()
      const entry = this.findById(id)
      if (!entry) return

      // Lazy-load the serialized DataMap from disk if only its path is known —
      // e.g. after restarting the app, history entries carry `data_map_file`
      // but not the JSON itself. Without this, re-downloads fail even though
      // we persisted everything we need.
      if (!entry.data_map_json && entry.data_map_file) {
        try {
          const json = await invoke<string>('read_datamap_file', { path: entry.data_map_file })
          this.updateEntry(id, { data_map_json: json })
        } catch (e: any) {
          this.updateEntry(id, { status: 'failed', error: `Failed to read datamap: ${e.message ?? e}` })
          toasts.add(t('files.toast.datamap_missing'), 'error')
          return
        }
      }

      try {
        this.updateEntry(id, { status: 'downloading', progress: 0 })

        // Local datamap takes priority — it's fast and doesn't require the
        // DataMap chunk to exist on-network. Fall back to a public fetch by
        // address when we have neither JSON nor a local file.
        //
        // No frontend timeout: large downloads can legitimately take many
        // minutes, and the backend has no timeout either. A UI-side timeout
        // marks the row Failed while the Rust download keeps running and
        // writes the file successfully. Backend errors still surface through
        // invoke's rejection.
        const request = entry.data_map_json
          ? invoke('download_file', {
              transferId: String(id),
              dataMapJson: entry.data_map_json,
              destPath: entry.dest_path,
            })
          : invoke('download_public', {
              transferId: String(id),
              address: entry.address,
              destPath: entry.dest_path,
            })

        await request

        const duration = entry.transferStartedAt
          ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
          : 0
        this.updateEntry(id, {
          status: 'downloaded',
          progress: 100,
          duration,
          stage: undefined,
          stageDone: undefined,
          stageTotal: undefined,
        })
        toasts.add(t('files.toast.download_complete', { name: entry.name }), 'info')
      } catch (e: any) {
        this.updateEntry(id, { status: 'failed', error: e.message ?? String(e) })
        toasts.add(t('files.toast.download_failed', { name: entry.name, error: e.message ?? e }), 'error')
      }
    },

    /**
     * Called when the user clicks on a downloaded row to open the folder.
     * Unpins the row and returns it to normal sort order. Downloads are
     * memory-only, so there's nothing to persist.
     */
    acknowledgeDownload(id: number) {
      const entry = this.findById(id)
      if (!entry || entry.status !== 'downloaded') return
      this.updateEntry(id, {
        status: 'complete',
        transferStartedAt: undefined,
      })
    },

    getDownloadDir(): string {
      const settings = useSettingsStore()
      return settings.downloadDir ?? ''
    },

    /**
     * Download from a user-picked `.datamap` file on disk. Reads the JSON
     * and creates a fresh download row. The matching upload row (if any)
     * is left untouched so the uploads table stays stable.
     *
     * `filename` controls how the downloaded file is saved; if omitted it
     * falls back to the datamap's basename with `.datamap` stripped.
     */
    async downloadFromDatamapFile(
      datamapPath: string,
      filename?: string,
    ): Promise<number | null> {
      const toasts = useToastStore()

      let json: string
      try {
        json = await invoke<string>('read_datamap_file', { path: datamapPath })
      } catch (e: any) {
        toasts.add(t('files.toast.datamap_read_failed', { error: e.message ?? e }), 'error')
        return null
      }

      const basename = datamapPath.split(/[\\/]/).pop() ?? 'download'
      const fallback = basename.replace(/\.datamap$/i, '') || basename
      const finalName = filename?.trim() || fallback
      const address = await sha256Hex(json)
      const destPath = `${this.getDownloadDir()}/${finalName}`

      const id = this.nextId++
      this.files.unshift({
        id,
        kind: 'download',
        name: finalName,
        size_bytes: 0,
        address,
        data_map_json: json,
        data_map_file: datamapPath,
        status: 'downloading',
        dest_path: destPath,
        progress: 0,
        date: new Date().toISOString(),
        transferStartedAt: Date.now(),
      })
      return id
    },

    /** Fetch a datamap from an `http(s)` URL and stage a download row, exactly
     *  like {@link downloadFromDatamapFile} but sourcing the DataMap over the
     *  network. The file's data is still pulled from Autonomi via the resolved
     *  DataMap. Returns the new row id, or null if the fetch/parse failed. */
    async downloadFromDatamapUrl(
      url: string,
      filename?: string,
    ): Promise<number | null> {
      const toasts = useToastStore()

      let json: string
      try {
        json = await invoke<string>('read_datamap_url', { url })
      } catch (e: any) {
        toasts.add(t('files.toast.datamap_read_failed', { error: e.message ?? e }), 'error')
        return null
      }

      const cleanUrl = url.split(/[?#]/)[0]
      const basename = cleanUrl.split(/[\\/]/).pop() ?? 'download'
      const fallback = basename.replace(/\.datamap$/i, '') || basename
      const finalName = filename?.trim() || fallback
      const address = await sha256Hex(json)
      const destPath = `${this.getDownloadDir()}/${finalName}`

      const id = this.nextId++
      this.files.unshift({
        id,
        kind: 'download',
        name: finalName,
        size_bytes: 0,
        address,
        data_map_json: json,
        status: 'downloading',
        dest_path: destPath,
        progress: 0,
        date: new Date().toISOString(),
        transferStartedAt: Date.now(),
      })
      return id
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useFilesStore, import.meta.hot))
}

/** Compute `sha256(text)` as a `0x`-prefixed lowercase hex string. Matches
 *  the address derivation in `src-tauri/src/autonomi_ops.rs` so the frontend
 *  can recognise re-downloads of known uploads without a round-trip. */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex}`
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/^0x/, '')
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise
      .then((val) => { clearTimeout(timer); resolve(val) })
      .catch((err) => { clearTimeout(timer); reject(err) })
  })
}
