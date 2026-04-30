import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface CheckResult {
  ok: boolean
  available: boolean
  error?: string
}

interface UpdateMetadata {
  version: string
  body: string | null
  is_prerelease: boolean
}

type DownloadEvent =
  | { event: 'Started'; data: { contentLength: number | null } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

// Inputs that the Rust side surfaces verbatim from tauri-plugin-updater's
// errors. The plugin's wording is consistent across versions, so the same
// regex set the JS plugin path used works against the Rust-passthrough
// strings too.
function humaniseUpdateError(raw: string): string {
  if (/could not fetch a valid release json|release not found|did not respond with a successful status code|\b404\b|\bnot found\b/i.test(raw)) {
    return 'Cannot find latest version'
  }
  if (/network|connect|dns|timeout|tcp|tls|unreachable/i.test(raw)) {
    return 'Could not reach update server'
  }
  if (/signature|invalid key|verify/i.test(raw)) {
    return 'Update manifest failed signature check — please report'
  }
  return `Update check failed: ${raw}`
}

export const useUpdaterStore = defineStore('updater', {
  state: () => ({
    available: false,
    version: null as string | null,
    body: null as string | null,
    isPrerelease: false,
    installing: false,
    showDialog: false,
    downloadTotal: null as number | null,
    downloadedBytes: 0,
    checking: false,
    lastCheckedAt: null as number | null,
    /** Live listener for download progress while an install is in flight.
     *  Cleared on Finished or on install failure. */
    _downloadUnlisten: null as UnlistenFn | null,
  }),

  getters: {
    downloadProgress(): number | null {
      if (!this.downloadTotal || this.downloadTotal === 0) return null
      return Math.min(100, Math.round((this.downloadedBytes / this.downloadTotal) * 100))
    },
  },

  actions: {
    async checkForUpdate(): Promise<CheckResult> {
      if (this.checking) return { ok: false, available: false, error: 'Check already in progress' }
      this.checking = true
      try {
        // Custom Tauri command (see src-tauri/src/updater_channel.rs).
        // Honours the prerelease_channel flag in AppConfig — stable users go
        // through the standard /releases/latest/... redirect; pre-release
        // testers get the latest tag including pre-releases via the GitHub API.
        const meta = await invoke<UpdateMetadata | null>('check_for_update_custom')
        this.lastCheckedAt = Date.now()
        if (meta) {
          this.available = true
          this.version = meta.version
          this.body = meta.body ?? null
          this.isPrerelease = meta.is_prerelease
          return { ok: true, available: true }
        }
        this.available = false
        return { ok: true, available: false }
      } catch (e: any) {
        console.error('Update check failed:', e)
        const raw = typeof e === 'string' ? e : (e?.message ?? String(e))
        return { ok: false, available: false, error: humaniseUpdateError(raw) }
      } finally {
        this.checking = false
      }
    },

    async installUpdate() {
      if (!this.available) return
      this.installing = true
      this.downloadedBytes = 0
      this.downloadTotal = null

      // Subscribe BEFORE invoking install so we don't lose the Started event
      // when the download is fast (small installer, warm CDN).
      this._downloadUnlisten = await listen<DownloadEvent>('update-download-event', (event) => {
        const payload = event.payload
        if (payload.event === 'Started') {
          this.downloadTotal = payload.data.contentLength
        } else if (payload.event === 'Progress') {
          this.downloadedBytes += payload.data.chunkLength
        }
        // 'Finished' — Tauri will restart the app, no UI action needed.
      })

      try {
        await invoke('install_pending_update')
      } catch (e) {
        console.error('Update install failed:', e)
        this.installing = false
        if (this._downloadUnlisten) {
          this._downloadUnlisten()
          this._downloadUnlisten = null
        }
      }
    },
  },
})
