import { defineStore } from 'pinia'
import { useToastStore } from './toasts'
import { useSettingsStore } from './settings'
import { invoke } from '@tauri-apps/api/core'
import { daemonApi, connectSSE, disconnectSSE, type NodeEvent } from '~/utils/daemon-api'
import type { NodeStatusSummary, NodeStatus as ApiNodeStatus, DaemonStatus } from '~/utils/daemon-api'
import { POLL_INTERVAL } from '~/utils/constants'
import type { UnlistenFn } from '@tauri-apps/api/event'

// Frontend node status — ant-core values + frontend-only states
export type NodeStatus = ApiNodeStatus | 'adding'

export interface NodeInfo {
  id: number
  name: string
  status: NodeStatus
  version: string
  pid?: number
  uptime_secs?: number
  // Fields from NodeConfig (available when daemon provides full info)
  rewards_address?: string
  data_dir?: string
  log_dir?: string | null
  node_port?: number | null
  metrics_port?: number | null
  binary_path?: string
  // Fields not yet in ant-core but kept for future use
  peer_count?: number
  storage_bytes?: number
  earnings?: string
}

function summaryToNodeInfo(s: NodeStatusSummary): NodeInfo {
  return {
    id: s.node_id,
    name: s.name,
    status: s.status,
    version: s.version,
    pid: s.pid,
    uptime_secs: s.uptime_secs,
  }
}

export const useNodesStore = defineStore('nodes', {
  state: () => ({
    nodes: [] as NodeInfo[],
    loading: false,
    initializing: true,
    daemonConnected: false,
    daemonStatus: null as DaemonStatus | null,
    _pollTimer: null as ReturnType<typeof setInterval> | null,
    _sseDisconnect: null as (() => void) | null,
    _sseUnlisten: null as UnlistenFn | null,
    _sseWindowHandler: null as ((e: Event) => void) | null,
    _reconnectTimer: null as ReturnType<typeof setTimeout> | null,
  }),

  getters: {
    running: (state) => state.nodes.filter(n => n.status === 'running').length,
    stopped: (state) => state.nodes.filter(n => n.status === 'stopped').length,
    errored: (state) => state.nodes.filter(n => n.status === 'errored').length,
    total: (state) => state.nodes.length,
    totalPeers: (state) => state.nodes.reduce((sum, n) => sum + (n.peer_count ?? 0), 0),
    totalStorage: (state) => state.nodes.reduce((sum, n) => sum + (n.storage_bytes ?? 0), 0),
  },

  actions: {
    /** Initialize: ensure daemon is running, discover port, connect, start polling. */
    async init() {
      this.initializing = true
      const settings = useSettingsStore()

      // Ensure the daemon is running (starts it if needed) and discover the port.
      try {
        const url = await invoke<string>('ensure_daemon_running')
        if (url && url !== settings.daemonUrl) {
          settings.daemonUrl = url
        }
      } catch (e) {
        console.warn('Could not ensure daemon is running:', e)
      }

      try {
        await this.fetchDaemonStatus()
        this.daemonConnected = true
        await this.fetchNodes()
        this.startPolling()
        await this.connectSSE()
      } catch {
        console.warn('Daemon not available')
        this.daemonConnected = false
        this.scheduleReconnect()
      } finally {
        this.initializing = false
      }
    },

    /** Fetch daemon health status */
    async fetchDaemonStatus() {
      const status = await daemonApi.status()
      this.daemonStatus = status
      this.daemonConnected = status.running
    },

    /** Fetch all node statuses from daemon */
    async fetchNodes() {
      this.loading = true
      try {
        const result = await daemonApi.nodesStatus()
        // Merge with existing nodes to preserve extra fields (pid, uptime from events)
        const existing = new Map(this.nodes.map(n => [n.id, n]))
        this.nodes = result.nodes.map(s => {
          const prev = existing.get(s.node_id)
          return {
            ...prev,
            ...summaryToNodeInfo(s),
          }
        })
        this.daemonConnected = true
      } catch {
        if (this.daemonConnected) {
          // Was connected, now lost — schedule reconnect
          this.daemonConnected = false
          this.scheduleReconnect()
        }
      } finally {
        this.loading = false
      }
    },

    /** Start polling for status updates */
    startPolling() {
      this.stopPolling()
      this._pollTimer = setInterval(() => this.fetchNodes(), POLL_INTERVAL)
    },

    stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
    },

    /** Connect to SSE event stream for real-time updates via Tauri proxy */
    async connectSSE() {
      await this.disconnectSSE()

      const settings = useSettingsStore()
      const daemonUrl = settings.daemonUrl

      // Listen for window custom events dispatched by the Tauri SSE listener
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as NodeEvent
        if (detail) {
          this.handleNodeEvent(detail)
        }
      }
      window.addEventListener('daemon-node-event', handler)
      this._sseWindowHandler = handler

      try {
        const unlisten = await connectSSE(daemonUrl)
        this._sseUnlisten = unlisten
      } catch (e) {
        console.warn('Failed to connect SSE proxy:', e)
        // SSE is supplemental — polling continues as fallback
      }
    },

    async disconnectSSE() {
      // Remove the window event listener
      if (this._sseWindowHandler) {
        window.removeEventListener('daemon-node-event', this._sseWindowHandler)
        this._sseWindowHandler = null
      }

      // Unsubscribe from Tauri events
      if (this._sseUnlisten) {
        this._sseUnlisten()
        this._sseUnlisten = null
      }

      // Stop the Rust-side SSE task
      try {
        await disconnectSSE()
      } catch {
        // Ignore errors during cleanup
      }

      // Legacy cleanup
      if (this._sseDisconnect) {
        this._sseDisconnect()
        this._sseDisconnect = null
      }
    },

    /** Handle a real-time node event from SSE */
    handleNodeEvent(event: NodeEvent) {
      const node = event.node_id != null ? this.nodes.find(n => n.id === event.node_id) : null

      switch (event.type) {
        case 'node_starting':
          if (node) node.status = 'starting'
          break
        case 'node_started':
          if (node) {
            node.status = 'running'
            node.pid = event.pid
            node.uptime_secs = 0
          }
          break
        case 'node_stopping':
          if (node) node.status = 'stopping'
          break
        case 'node_stopped':
          if (node) {
            node.status = 'stopped'
            node.pid = undefined
            node.uptime_secs = undefined
          }
          break
        case 'node_crashed':
          if (node) {
            node.status = 'errored'
            node.pid = undefined
            node.uptime_secs = undefined
          }
          break
        case 'node_errored':
          if (node) node.status = 'errored'
          break
        case 'node_restarting':
          if (node) node.status = 'starting'
          break
      }
    },

    /** Retry connecting to the daemon every 10s when disconnected. */
    scheduleReconnect() {
      this.cancelReconnect()
      this._reconnectTimer = setTimeout(async () => {
        this._reconnectTimer = null
        try {
          // Try to re-discover in case daemon restarted on a new port
          const url = await invoke<string>('ensure_daemon_running')
          const settings = useSettingsStore()
          if (url && url !== settings.daemonUrl) {
            settings.daemonUrl = url
          }
          await this.fetchDaemonStatus()
          this.daemonConnected = true
          await this.fetchNodes()
          this.startPolling()
          await this.connectSSE()
        } catch {
          this.scheduleReconnect()
        }
      }, 10_000)
    },

    cancelReconnect() {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer)
        this._reconnectTimer = null
      }
    },

    /** Clean up on unmount */
    async cleanup() {
      this.stopPolling()
      await this.disconnectSSE()
      this.cancelReconnect()
    },

    // ── Node operations ──

    async addNodes(count: number) {
      const toasts = useToastStore()

      // Optimistic: add placeholder cards immediately
      const maxId = this.nodes.reduce((m, n) => Math.max(m, n.id), 0)
      const placeholderIds: number[] = []
      for (let i = 0; i < count; i++) {
        const tempId = -(maxId + i + 1) // negative IDs to avoid collision
        placeholderIds.push(tempId)
        this.nodes.push({
          id: tempId,
          name: `Adding node...`,
          status: 'adding' as NodeStatus,
          version: '',
        })
      }

      const settings = useSettingsStore()
      const opts = {
        count,
        rewards_address: settings.earningsAddress ?? '',
        network_id: 1,
        binary_source: { type: 'latest' as const },
        bootstrap_peers: [],
        env_variables: [] as [string, string][],
      }

      try {
        const result = await daemonApi.addNodes(opts)
        // Remove placeholders and add real nodes
        this.nodes = this.nodes.filter(n => !placeholderIds.includes(n.id))
        await this.fetchNodes()
        toasts.add(`Added ${result.nodes_added.length} node(s)`, 'info')
      } catch (e: any) {
        // Remove placeholders on failure
        this.nodes = this.nodes.filter(n => !placeholderIds.includes(n.id))
        toasts.add(`Failed to add nodes: ${e.message}`, 'error')
      }
    },

    async startNode(id: number) {
      const toasts = useToastStore()

      try {
        const node = this.nodes.find(n => n.id === id)
        if (node) node.status = 'starting'
        const result = await daemonApi.startNode(id)
        // SSE will update status, but set immediately for responsiveness
        if (node) {
          node.status = 'running'
          node.pid = result.pid
          node.uptime_secs = 0
        }
        toasts.add(`Node ${id} started`, 'info')
      } catch (e: any) {
        const node = this.nodes.find(n => n.id === id)
        if (node) node.status = 'errored'
        toasts.add(`Failed to start node ${id}: ${e.message}`, 'error')
      }
    },

    async stopNode(id: number) {
      const toasts = useToastStore()

      try {
        const node = this.nodes.find(n => n.id === id)
        if (node) node.status = 'stopping'
        await daemonApi.stopNode(id)
        if (node) {
          node.status = 'stopped'
          node.pid = undefined
          node.uptime_secs = undefined
        }
        toasts.add(`Node ${id} stopped`, 'info')
      } catch (e: any) {
        toasts.add(`Failed to stop node ${id}: ${e.message}`, 'error')
      }
    },

    async removeNode(id: number) {
      const toasts = useToastStore()

      try {
        await daemonApi.removeNode(id)
        this.nodes = this.nodes.filter(n => n.id !== id)
        toasts.add(`Node ${id} removed`, 'info')
      } catch (e: any) {
        toasts.add(`Failed to remove node ${id}: ${e.message}`, 'error')
      }
    },

    async startAll() {
      const toasts = useToastStore()
      const stoppedNodes = this.nodes.filter(n => n.status === 'stopped')
      if (stoppedNodes.length === 0) {
        toasts.add('No stopped nodes to start', 'warning')
        return
      }

      try {
        for (const node of stoppedNodes) node.status = 'starting'
        const result = await daemonApi.startAll()
        // Update from results
        for (const s of result.started) {
          const node = this.nodes.find(n => n.id === s.node_id)
          if (node) { node.status = 'running'; node.pid = s.pid; node.uptime_secs = 0 }
        }
        for (const f of result.failed) {
          const node = this.nodes.find(n => n.id === f.node_id)
          if (node) node.status = 'errored'
          toasts.add(`Node ${f.node_id} failed: ${f.error}`, 'error')
        }
        for (const id of result.already_running) {
          const node = this.nodes.find(n => n.id === id)
          if (node) node.status = 'running'
        }
        if (result.started.length > 0) {
          toasts.add(`Started ${result.started.length} node(s)`, 'info')
        }
      } catch (e: any) {
        toasts.add(`Failed to start all: ${e.message}`, 'error')
        await this.fetchNodes() // refresh to get real state
      }
    },

    async stopAll() {
      const toasts = useToastStore()
      const runningNodes = this.nodes.filter(n => n.status === 'running')
      if (runningNodes.length === 0) {
        toasts.add('No running nodes to stop', 'warning')
        return
      }

      try {
        for (const node of runningNodes) node.status = 'stopping'
        const result = await daemonApi.stopAll()
        for (const s of result.stopped) {
          const node = this.nodes.find(n => n.id === s.node_id)
          if (node) { node.status = 'stopped'; node.pid = undefined; node.uptime_secs = undefined }
        }
        for (const f of result.failed) {
          const node = this.nodes.find(n => n.id === f.node_id)
          if (node) node.status = 'errored'
          toasts.add(`Node ${f.node_id} failed: ${f.error}`, 'error')
        }
        if (result.stopped.length > 0) {
          toasts.add(`Stopped ${result.stopped.length} node(s)`, 'info')
        }
      } catch (e: any) {
        toasts.add(`Failed to stop all: ${e.message}`, 'error')
        await this.fetchNodes()
      }
    },
  },
})
