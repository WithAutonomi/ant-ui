import { defineStore } from 'pinia'
import { check, type Update } from '@tauri-apps/plugin-updater'

export interface CheckResult {
  ok: boolean
  available: boolean
  error?: string
}

function humaniseUpdateError(raw: string): string {
  // tauri-plugin-updater surfaces `ReleaseNotFound` for any non-success HTTP
  // response (404, 403, 500, …) with this exact string, so pin to it. The
  // other phrases catch older plugin versions and direct log messages.
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
    installing: false,
    showDialog: false,
    downloadTotal: null as number | null,
    downloadedBytes: 0,
    checking: false,
    lastCheckedAt: null as number | null,
    _update: null as Update | null,
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
        const update = await check()
        this.lastCheckedAt = Date.now()
        if (update) {
          this.available = true
          this.version = update.version
          this.body = update.body ?? null
          this._update = update
          return { ok: true, available: true }
        }
        return { ok: true, available: false }
      } catch (e: any) {
        console.error('Update check failed:', e)
        const raw = e?.message ?? String(e)
        return { ok: false, available: false, error: humaniseUpdateError(raw) }
      } finally {
        this.checking = false
      }
    },

    async installUpdate() {
      if (!this._update) return
      this.installing = true
      this.downloadedBytes = 0
      this.downloadTotal = null
      try {
        await this._update.downloadAndInstall((event) => {
          if (event.event === 'Started') {
            this.downloadTotal = (event.data as any).contentLength ?? null
          } else if (event.event === 'Progress') {
            this.downloadedBytes += (event.data as any).chunkLength ?? 0
          }
          // 'Finished' — Tauri will restart the app
        })
      } catch (e) {
        console.error('Update install failed:', e)
        this.installing = false
      }
    },
  },
})
