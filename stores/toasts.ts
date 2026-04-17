import { defineStore } from 'pinia'
import { useErrorLogStore } from './errorlog'

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  message: string
  level: ToastLevel
}

let nextId = 0

const DURATIONS: Record<ToastLevel, number> = {
  info: 3000,
  success: 3000,
  warning: 5000,
  error: 8000,
}

export const useToastStore = defineStore('toasts', {
  state: () => ({
    toasts: [] as Toast[],
  }),

  actions: {
    add(message: string, level: ToastLevel = 'info') {
      const id = nextId++
      this.toasts.push({ id, message, level })

      // Also log to persistent error log
      const errorLog = useErrorLogStore()
      errorLog.log(level, 'toast', message)

      // Keep max 5
      if (this.toasts.length > 5) {
        this.toasts.shift()
      }

      // Auto-remove after duration
      setTimeout(() => {
        this.remove(id)
      }, DURATIONS[level])
    },

    remove(id: number) {
      this.toasts = this.toasts.filter(t => t.id !== id)
    },
  },
})
