import { defineStore } from 'pinia'
import { check, type Update } from '@tauri-apps/plugin-updater'

export const useUpdaterStore = defineStore('updater', {
  state: () => ({
    available: false,
    version: null as string | null,
    body: null as string | null,
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
