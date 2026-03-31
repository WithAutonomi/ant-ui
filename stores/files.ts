import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useToastStore } from './toasts'
import { useSettingsStore } from './settings'
import { payForQuotes, formatNanoTokens, type RawPayment } from '~/utils/payment'
import { indelibleApi } from '~/utils/indelible-api'

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

    async startRealUpload(id: number, wagmiConfig: any) {
      const toasts = useToastStore()
      const entry = this.findById(id)
      if (!entry) return

      const uploadId = `upload-${id}-${Date.now()}`

      try {
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

        const quote = await quotePromise
        const costDisplay = formatNanoTokens(quote.total_cost)
        this.updateEntry(id, { cost: costDisplay })

        // Pay via wallet and collect tx hash mapping
        let txHashes: Record<string, string> = {}
        if (quote.payment_required) {
          this.updateEntry(id, { status: 'paying' })
          try {
            const payResult = await payForQuotes(wagmiConfig, quote.payments)
            txHashes = payResult.txHashMap
          } catch (e: any) {
            this.updateEntry(id, { status: 'failed', error: `Payment failed: ${e.message}` })
            toasts.add(`Payment failed: ${e.message}`, 'error')
            return
          }
        }

        this.updateEntry(id, { status: 'uploading', progress: 0 })

        const result = await invoke<{ upload_id: string; data_map_json: string; chunks_stored: number }>('confirm_upload', {
          uploadId,
          txHashes,
        })

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

        await invoke('download_file', {
          dataMapJson: entry.data_map_json,
          destPath: entry.dest_path,
        })

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

    // ── Mock methods (dev fallback) ──
    // TODO: REMOVE before launch

    async simulateUpload(id: number) {
      const toasts = useToastStore()
      const entry = this.findById(id)
      if (!entry) return

      this.updateEntry(id, { status: 'quoting' })
      await delay(800)

      const cost = (entry.size_bytes / 1_048_576 * 0.05).toFixed(4)
      this.updateEntry(id, { cost: `${cost} ANT` })

      this.updateEntry(id, { status: 'paying' })
      await delay(1200)

      this.updateEntry(id, { status: 'uploading', progress: 0 })
      for (let i = 1; i <= 10; i++) {
        await delay(300 + Math.random() * 400)
        this.updateEntry(id, { progress: Math.round((i / 10) * 100) })
      }

      const mockAddr = '0x' + Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)).join('')
      const duration = entry.transferStartedAt
        ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
        : 0
      this.updateEntry(id, {
        status: 'complete',
        progress: 100,
        address: mockAddr,
        duration,
        transferStartedAt: undefined,
      })

      await this.persistHistory()
      toasts.add(`Upload complete: ${entry.name}`, 'info')
    },

    async simulateDownload(id: number) {
      const toasts = useToastStore()
      const entry = this.findById(id)
      if (!entry) return

      this.updateEntry(id, { status: 'downloading', progress: 0 })
      for (let i = 1; i <= 8; i++) {
        await delay(400 + Math.random() * 500)
        this.updateEntry(id, { progress: Math.round((i / 8) * 100) })
      }

      const duration = entry.transferStartedAt
        ? Math.round((Date.now() - entry.transferStartedAt) / 1000)
        : 0
      this.updateEntry(id, {
        status: 'downloaded',
        progress: 100,
        duration,
      })
      toasts.add(`Download complete: ${entry.name}`, 'info')
    },

    getDownloadDir(): string {
      const settings = useSettingsStore()
      return settings.downloadDir ?? '~/Downloads'
    },
  },
})

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
