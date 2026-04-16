import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useToastStore } from './toasts'
import { useSettingsStore } from './settings'
import { payForQuotes, payForMerkleTree, formatNanoTokens, formatGasCost, estimatePaymentGasCost, type RawPayment, type SerializedPoolCommitment } from '~/utils/payment'
import { indelibleApi } from '~/utils/indelible-api'

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
  | 'complete'      // Normal row, no active transfer
  | 'quoting'       // Upload: getting cost estimate
  | 'paying'        // Upload: wallet payment in progress
  | 'uploading'     // Upload: data being sent to network
  | 'downloading'   // Download: fetching from network
  | 'downloaded'    // Download complete, waiting for user to open folder
  | 'failed'        // Transfer failed

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
}

const ACTIVE_STATUSES: FileStatus[] = ['quoting', 'paying', 'uploading', 'downloading', 'downloaded']
const IN_FLIGHT_STATUSES: FileStatus[] = ['quoting', 'paying', 'uploading', 'downloading']

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
}

export const useFilesStore = defineStore('files', {
  state: () => ({
    files: [] as FileEntry[],
    nextId: 1,
    historyLoaded: false,
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
            cost: e.cost ?? undefined,
            data_map_file: e.data_map_file ?? undefined,
            status: 'complete',
            date: e.uploaded_at,
          })
        }
        this.historyLoaded = true
      } catch (e) {
        console.error('Failed to load upload history:', e)
        this.historyLoaded = true
      }
    },

    async persistHistory() {
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
        }))

      try {
        await invoke('save_upload_history', { entries })
      } catch (e) {
        console.error('Failed to save upload history:', e)
      }
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

    addUpload(name: string, path: string, size_bytes: number): number {
      const id = this.nextId++
      this.files.unshift({
        id,
        kind: 'upload',
        name,
        path,
        size_bytes,
        status: 'quoting',
        date: new Date().toISOString(),
        transferStartedAt: Date.now(),
      })
      return id
    },

    /** Get a real network quote for a file. Used by the upload dialog to show real costs. */
    async getUploadQuote(path: string): Promise<UploadQuote | null> {
      const uploadId = `quote-${Date.now()}-${Math.random().toString(36).slice(2)}`

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
          request: { files: [path], upload_id: uploadId },
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

      try {
        let uploadId: string
        let quote: UploadQuote

        if (preQuote) {
          // Use pre-obtained quote (from dialog phase)
          uploadId = preQuote.upload_id
          quote = preQuote
          this.updateEntry(id, { cost: preQuote.total_cost_display })
        } else {
          // Get fresh quote from network. Delegates to getUploadQuote so
          // there is a single implementation of the listen+invoke dance.
          if (!entry.path) throw new Error('Upload entry has no file path')
          this.updateEntry(id, { status: 'quoting' })
          const fresh = await this.getUploadQuote(entry.path)
          if (!fresh) throw new Error('Failed to get quote from network')
          uploadId = fresh.upload_id
          quote = fresh
          this.updateEntry(id, { cost: quote.total_cost_display })
        }

        this.updateEntry(id, { status: 'paying' })

        if (quote.payment_mode === 'merkle') {
          // Merkle path: single tx for all chunks
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

            this.updateEntry(id, {
              status: 'uploading',
              progress: 0,
              cost: formatNanoTokens(payResult.totalPaid.toString()),
              gas_cost: formatGasCost(payResult.gasSpent.toString()),
            })

            // No frontend timeout: the backend drives chunk storage, which
            // can legitimately take many minutes for larger files. The CLI
            // (which works) also has no timeout here. Backend errors still
            // surface through invoke's rejection.
            const result = await invoke<{ upload_id: string; data_map_json: string; address: string; chunks_stored: number; data_map_file: string }>('confirm_upload_merkle', {
              uploadId,
              winnerPoolHash: payResult.winnerPoolHash,
            })

            const duration = entry.transferStartedAt
              ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
              : 0
            this.updateEntry(id, {
              status: 'complete',
              progress: 100,
              address: result.address,
              data_map_json: result.data_map_json,
              data_map_file: result.data_map_file,
              duration,
              transferStartedAt: undefined,
            })
          } catch (e: any) {
            this.updateEntry(id, { status: 'failed', error: `Payment failed: ${e.message}` })
            toasts.add(`Payment failed: ${e.message}`, 'error')
            return
          }
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
              this.updateEntry(id, { status: 'failed', error: `Payment failed: ${e.message}` })
              toasts.add(`Payment failed: ${e.message}`, 'error')
              return
            }
          }

          this.updateEntry(id, { status: 'uploading', progress: 0 })

          // No frontend timeout — see confirm_upload_merkle above for rationale.
          const result = await invoke<{ upload_id: string; data_map_json: string; address: string; chunks_stored: number; data_map_file: string }>('confirm_upload', {
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
            data_map_json: result.data_map_json,
            data_map_file: result.data_map_file,
            duration,
            transferStartedAt: undefined,
          })
        }

        await this.persistHistory()
        toasts.add(`Upload complete: ${entry.name}`, 'info')
      } catch (e: any) {
        this.updateEntry(id, { status: 'failed', error: e.message ?? String(e) })
        toasts.add(`Upload failed: ${entry.name} — ${e.message}`, 'error')
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
        toasts.add(`Upload complete: ${entry.name}`, 'info')
      } catch (e: any) {
        this.updateEntry(id, { status: 'failed', error: e.message ?? String(e) })
        toasts.add(`Upload failed: ${entry.name} — ${e.message}`, 'error')
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
          toasts.add('Cannot download: datamap file missing or unreadable', 'error')
          return
        }
      }

      try {
        this.updateEntry(id, { status: 'downloading', progress: 0 })

        // Local datamap takes priority — it's fast and doesn't require the
        // DataMap chunk to exist on-network. Fall back to a public fetch by
        // address when we have neither JSON nor a local file.
        const request = entry.data_map_json
          ? invoke('download_file', {
              dataMapJson: entry.data_map_json,
              destPath: entry.dest_path,
            })
          : invoke('download_public', {
              address: entry.address,
              destPath: entry.dest_path,
            })

        await withTimeout(request, 300_000, 'Download timed out')

        const duration = entry.transferStartedAt
          ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
          : 0
        this.updateEntry(id, {
          status: 'downloaded',
          progress: 100,
          duration,
        })
        toasts.add(`Download complete: ${entry.name}`, 'info')
      } catch (e: any) {
        this.updateEntry(id, { status: 'failed', error: e.message ?? String(e) })
        toasts.add(`Download failed: ${entry.name} — ${e.message}`, 'error')
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
      return settings.downloadDir ?? '~/Downloads'
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
        toasts.add(`Could not read datamap: ${e.message ?? e}`, 'error')
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
  },
})

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
