import { defineStore } from 'pinia'

export interface LogEntry {
  id: number
  timestamp: string
  level: 'error' | 'warning' | 'info'
  source: string
  message: string
}

const MAX_ENTRIES = 200
let nextId = 0

export const useErrorLogStore = defineStore('errorlog', {
  state: () => ({
    entries: [] as LogEntry[],
  }),

  getters: {
    errors: (state) => state.entries.filter(e => e.level === 'error'),
    recent: (state) => state.entries.slice(-50),
  },

  actions: {
    log(level: LogEntry['level'], source: string, message: string) {
      this.entries.push({
        id: nextId++,
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
      })
      if (this.entries.length > MAX_ENTRIES) {
        this.entries = this.entries.slice(-MAX_ENTRIES)
      }
    },

    clear() {
      this.entries = []
    },

    /** Build a diagnostic report for copy/export */
    buildReport(): string {
      const lines: string[] = []
      lines.push('=== Autonomi Diagnostic Report ===')
      lines.push(`Generated: ${new Date().toISOString()}`)
      lines.push(`Platform: ${navigator.platform}`)
      lines.push(`User Agent: ${navigator.userAgent}`)
      lines.push('')
      lines.push(`Total log entries: ${this.entries.length}`)
      lines.push(`Errors: ${this.errors.length}`)
      lines.push('')
      lines.push('--- Recent Log ---')
      for (const entry of this.recent) {
        lines.push(`[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`)
      }
      return lines.join('\n')
    },
  },
})

