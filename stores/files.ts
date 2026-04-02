import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useToastStore } from './toasts'
import { useSettingsStore } from './settings'
import { payForQuotes, formatNanoTokens, type RawPayment } from '~/utils/payment'
import { indelibleApi } from '~/utils/indelible-api'

// ── Pre-obtained quote from network ──

export interface UploadQuote {
  upload_id: string
  payments: RawPayment[]
  total_cost: string
  total_cost_display: string
  payment_required: boolean
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
  /** Upload cost */
  cost?: string
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
  /** Whether this entry existed in history before a download (vs downloaded-by-address) */
  existedBeforeDownload?: boolean
}

/** Shape persisted to upload_history.json (kept for backwards compat) */
export interface UploadHistoryEntry {
  name: string
  size_bytes: number
  address: string
  cost: string | null
  uploaded_at: string
}

export const useFilesStore = defineStore('files', {
  state: () => ({
    files: [] as FileEntry[],
    nextId: 1,
    historyLoaded: false,
  }),

  getters: {
    /** Rows that are actively transferring (pinned to top) */
    pinnedFiles: (state) =>
      state.files.filter(f =>
        ['quoting', 'paying', 'uploading', 'downloading', 'downloaded'].includes(f.status),
      ),

    /** Rows that are not active transfers (sorted normally) */
    settledFiles: (state) =>
      state.files.filter(f =>
        !['quoting', 'paying', 'uploading', 'downloading', 'downloaded'].includes(f.status),
      ),

    hasActiveTransfers: (state) =>
      state.files.some(f =>
        ['quoting', 'paying', 'uploading', 'downloading'].includes(f.status),
      ),
  },

  actions: {
    // ── Persistence ──

    async loadHistory() {
      try {
        const entries = await invoke<UploadHistoryEntry[]>('load_upload_history')
        // Convert legacy history entries to unified FileEntry
        for (const e of entries) {
          // Skip if we already have this address
          if (this.files.some(f => f.address === e.address)) continue
          this.files.push({
            id: this.nextId++,
            name: e.name,
            size_bytes: e.size_bytes,
            address: e.address,
            cost: e.cost ?? undefined,
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
      // Serialize settled complete entries back to legacy format
      const entries: UploadHistoryEntry[] = this.files
        .filter(f => f.status === 'complete' && f.address)
        .map(f => ({
          name: f.name,
          size_bytes: f.size_bytes,
          address: f.address!,
          cost: f.cost ?? null,
          uploaded_at: f.date,
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

    findByAddress(address: string): FileEntry | undefined {
      return this.files.find(f => f.address === address)
    },

    updateEntry(id: number, updates: Partial<FileEntry>) {
      const entry = this.files.find(f => f.id === id)
      if (entry) Object.assign(entry, updates)
    },

    removeEntry(id: number) {
      const idx = this.files.findIndex(f => f.id === id)
      if (idx !== -1) {
        this.files.splice(idx, 1)
        this.persistHistory()
      }
    },

    clearCompleted() {
      this.files = this.files.filter(f => f.status !== 'complete' && f.status !== 'failed')
      this.persistHistory()
    },

    // ── Upload flow ──

    addUpload(name: string, path: string, size_bytes: number): number {
      const id = this.nextId++
      this.files.unshift({
        id,
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

      try {
        const quotePromise = new Promise<{
          payments: RawPayment[]
          total_cost: string
          payment_required: boolean
        }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Quote timeout')), 120_000)
          listen<any>('upload-quote', (event) => {
            if (event.payload.upload_id === uploadId) {
              clearTimeout(timeout)
              resolve(event.payload)
            }
          })
        })

        await invoke('start_upload', {
          request: { files: [path], upload_id: uploadId },
        })

        const quote = await quotePromise
        return {
          upload_id: uploadId,
          payments: quote.payments,
          total_cost: quote.total_cost,
          total_cost_display: formatNanoTokens(quote.total_cost),
          payment_required: quote.payment_required,
        }
      } catch {
        return null
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
        let quote: { payments: RawPayment[]; total_cost: string; payment_required: boolean }

        if (preQuote) {
          // Use pre-obtained quote (from dialog phase)
          uploadId = preQuote.upload_id
          quote = preQuote
          this.updateEntry(id, { cost: preQuote.total_cost_display })
        } else {
          // Get fresh quote from network
          uploadId = `upload-${id}-${Date.now()}`
          this.updateEntry(id, { status: 'quoting' })

          const quotePromise = new Promise<{
            payments: RawPayment[]
            total_cost: string
            payment_required: boolean
          }>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Quote timeout')), 120_000)
            listen<any>('upload-quote', (event) => {
              if (event.payload.upload_id === uploadId) {
                clearTimeout(timeout)
                resolve(event.payload)
              }
            })
          })

          await invoke('start_upload', {
            request: {
              files: [entry.path],
              upload_id: uploadId,
            },
          })

          quote = await quotePromise
          const costDisplay = formatNanoTokens(quote.total_cost)
          this.updateEntry(id, { cost: costDisplay })
        }

        // Pay via wallet and collect tx hash mapping (5 min timeout for user approval)
        let txHashes: Record<string, string> = {}
        if (quote.payment_required) {
          this.updateEntry(id, { status: 'paying' })
          try {
            const payResult = await withTimeout(
              payForQuotes(wagmiConfig, quote.payments),
              300_000,
              'Payment timed out — wallet approval took too long',
            )
            txHashes = payResult.txHashMap
          } catch (e: any) {
            this.updateEntry(id, { status: 'failed', error: `Payment failed: ${e.message}` })
            toasts.add(`Payment failed: ${e.message}`, 'error')
            return
          }
        }

        this.updateEntry(id, { status: 'uploading', progress: 0 })

        const result = await withTimeout(
          invoke<{ upload_id: string; data_map_json: string; chunks_stored: number }>('confirm_upload', {
            uploadId,
            txHashes,
          }),
          120_000,
          'Upload timed out',
        )

        const duration = entry.transferStartedAt
          ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
          : 0
        this.updateEntry(id, {
          status: 'complete',
          progress: 100,
          data_map_json: result.data_map_json,
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
     * Start a download. If the address already exists in the table,
     * pin that row; otherwise create a new entry.
     */
    startDownload(address: string, filename: string, dest_path: string): number {
      const existing = this.findByAddress(address)
      if (existing) {
        // Re-downloading an existing upload — pin it to top
        this.updateEntry(existing.id, {
          status: 'downloading',
          dest_path,
          progress: 0,
          transferStartedAt: Date.now(),
          existedBeforeDownload: true,
        })
        return existing.id
      }

      // New download by address
      const id = this.nextId++
      this.files.unshift({
        id,
        name: filename,
        size_bytes: 0,
        address,
        status: 'downloading',
        dest_path,
        progress: 0,
        date: new Date().toISOString(),
        transferStartedAt: Date.now(),
        existedBeforeDownload: false,
      })
      return id
    },

    async startRealDownload(id: number) {
      const toasts = useToastStore()
      const entry = this.findById(id)
      if (!entry) return

      try {
        this.updateEntry(id, { status: 'downloading', progress: 0 })

        await withTimeout(
          invoke('download_file', {
            dataMapJson: entry.data_map_json,
            destPath: entry.dest_path,
          }),
          300_000,
          'Download timed out',
        )

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
     * Called when user clicks on a downloaded row to open the folder.
     * Unpins the row and returns it to normal sort order.
     */
    acknowledgeDownload(id: number) {
      const entry = this.findById(id)
      if (!entry || entry.status !== 'downloaded') return

      if (entry.existedBeforeDownload) {
        // Was already in table — just unpin, return to complete
        this.updateEntry(id, {
          status: 'complete',
          dest_path: undefined,
          transferStartedAt: undefined,
          existedBeforeDownload: undefined,
        })
      } else {
        // Downloaded by address — keep as a complete entry
        this.updateEntry(id, {
          status: 'complete',
          transferStartedAt: undefined,
          existedBeforeDownload: undefined,
        })
        this.persistHistory()
      }
    },

    getDownloadDir(): string {
      const settings = useSettingsStore()
      return settings.downloadDir ?? '~/Downloads'
    },
  },
})

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise
      .then((val) => { clearTimeout(timer); resolve(val) })
      .catch((err) => { clearTimeout(timer); reject(err) })
  })
}
