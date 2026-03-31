import { defineStore } from 'pinia'
import { check, type Update } from '@tauri-apps/plugin-updater'

export const useUpdaterStore = defineStore('updater', {
  state: () => ({
    // TODO: REMOVE before launch — fake update for UI testing
    available: true,
    version: '0.2.0' as string | null,
    body: '### Improvements\n- Better node stability under high load\n- Reduced memory usage by 15%\n\n### Bug Fixes\n- Fixed crash when stopping node during sync\n- Fixed earnings address not persisting after restart' as string | null,
    // END REMOVE
    installing: false,
    showDialog: false,
    downloadTotal: null as number | null,
    downloadedBytes: 0,
    _update: null as Update | null,
  }),

  getters: {
    downloadProgress(): number | null {
      if (!this.downloadTotal || this.downloadTotal === 0) return null
      return Math.min(100, Math.round((this.downloadedBytes / this.downloadTotal) * 100))
    },
  },

  actions: {
    async checkForUpdate() {
      try {
        const update = await check()
        if (update) {
          this.available = true
          this.version = update.version
          this.body = update.body ?? null
          this._update = update
        }
      } catch (e) {
        console.error('Update check failed:', e)
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
