import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/**
 * Discriminated union mirroring the Rust ConnectionStatus enum.
 * `status` is the tag; the rest of the fields depend on the variant.
 */
export type ConnectionStatus =
  | { status: 'idle' }
  | { status: 'connecting'; attempt: number; of: number }
  | { status: 'connected' }
  | { status: 'failed'; reason: string; attempts: number }

export const useConnectionStore = defineStore('connection', {
  state: () => ({
    current: { status: 'idle' } as ConnectionStatus,
    /** Whether the SSE-style listener has been installed. */
    listening: false,
  }),

  getters: {
    isConnected: (state) => state.current.status === 'connected',
    isConnecting: (state) => state.current.status === 'connecting',
    hasFailed: (state) => state.current.status === 'failed',
  },

  actions: {
    /**
     * Start listening for `connection-status` events from the backend and
     * fetch the current status once. Idempotent — safe to call from multiple
     * places at app start.
     */
    async startListening() {
      if (this.listening) return
      this.listening = true

      try {
        this.current = await invoke<ConnectionStatus>('get_connection_status')
      } catch (e) {
        console.warn('get_connection_status failed:', e)
      }

      await listen<ConnectionStatus>('connection-status', (event) => {
        this.current = event.payload
      })
    },

    /**
     * Manually re-trigger the connection loop. Used by the Retry button on
     * the upload dialog when the previous attempts failed.
     */
    async retry() {
      try {
        await invoke('retry_autonomi_client')
      } catch (e) {
        console.error('retry_autonomi_client failed:', e)
      }
    },
  },
})
