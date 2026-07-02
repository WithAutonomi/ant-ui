import { defineStore } from 'pinia'
import { useToastStore } from './toasts'
import { useSettingsStore } from './settings'
import { invoke } from '@tauri-apps/api/core'
import { daemonApi, connectSSE, disconnectSSE, type NodeEvent } from '~/utils/daemon-api'
import type { NodeStatusSummary, ApiNodeStatus, DaemonStatus } from '~/utils/daemon-api'
import { POLL_INTERVAL, DETAIL_POLL_INTERVAL, MIN_NODE_SIZE_BYTES } from '~/utils/constants'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { i18n } from '~/plugins/i18n.client'

/** Module-scope translator — see stores/files.ts for the rationale. */
const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {})

// Frontend node status — ant-core values + frontend-only states
export type NodeStatus = ApiNodeStatus | 'adding'

export interface NodeInfo {
  id: number
  name: string
  status: NodeStatus
  version: string
  pid?: number
  uptime_secs?: number
  /** Version the supervisor detected on disk but hasn't booted yet. Populated
   *  during the `upgrade_scheduled` window, cleared on `node_upgraded`. */
  pending_version?: string
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
    pending_version: s.pending_version,
  }
}

export const useNodesStore = defineStore('nodes', {
  state: () => ({
    nodes: [] as NodeInfo[],
    loading: false,
    initializing: true,
    /** True while an explicit daemon restart is in flight. Suppresses the
     *  "Cannot connect" flash that would otherwise happen during the ~1 s
     *  gap between the old daemon shutting down and the new one accepting
     *  connections. */
    restarting: false,
    daemonConnected: false,
    daemonStatus: null as DaemonStatus | null,
    _pollTimer: null as ReturnType<typeof setInterval> | null,
    _detailPollTimer: null as ReturnType<typeof setInterval> | null,
    _sseDisconnect: null as (() => void) | null,
    _sseUnlisten: null as UnlistenFn | null,
    _sseWindowHandler: null as ((e: Event) => void) | null,
    _reconnectTimer: null as ReturnType<typeof setTimeout> | null,
    /** Total / available capacity of the volume holding node storage. Populated
     *  by `refreshDriveSpace`; 0 until first fetched. */
    driveTotalBytes: 0,
    driveAvailableBytes: 0,
  }),

  getters: {
    running: (state) => state.nodes.filter(n => n.status === 'running').length,
    stopped: (state) => state.nodes.filter(n => n.status === 'stopped').length,
    errored: (state) => state.nodes.filter(n => n.status === 'errored').length,
    total: (state) => state.nodes.length,
    totalPeers: (state) => state.nodes.reduce((sum, n) => sum + (n.peer_count ?? 0), 0),
    totalStorage: (state) => state.nodes.reduce((sum, n) => sum + (n.storage_bytes ?? 0), 0),
    /** Recommended minimum total storage across all nodes (moving target). */
    recommendedMinStorage: (state) => state.nodes.length * MIN_NODE_SIZE_BYTES,
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
        // `ensure_daemon_running` waits for the port file but the daemon's
        // HTTP server may take another ~100–500 ms after that to bind. A
        // single status fetch loses this race on cold boot and the UI flashes
        // "Cannot connect to node daemon" for ~10 s while `scheduleReconnect`
        // ticks. Retry briefly here so `initializing` stays true and the
        // user sees "Starting node daemon..." through the boot race.
        await this.fetchDaemonStatusWithRetry({ attempts: 20, delayMs: 250 })
        this.daemonConnected = true
        await this.fetchNodes()
        this.startPolling()
        this.enrichNodeDetails() // fire-and-forget — don't block init
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

    /** Like `fetchDaemonStatus` but retries on failure for up to
     *  `attempts × delayMs` (default ~5 s). Used at boot and on reconnect
     *  so a brief unbound-port window after daemon spawn doesn't flip the
     *  UI through a transient "Cannot connect" state. The last failure is
     *  rethrown so the caller's catch path runs normally. */
    async fetchDaemonStatusWithRetry({ attempts, delayMs }: { attempts: number; delayMs: number }) {
      let lastErr: unknown
      for (let i = 0; i < attempts; i++) {
        try {
          await this.fetchDaemonStatus()
          return
        } catch (e) {
          lastErr = e
          if (i < attempts - 1) {
            await new Promise<void>(r => setTimeout(r, delayMs))
          }
        }
      }
      throw lastErr
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
        // Don't demote to "disconnected" during a known restart — the new
        // daemon is seconds away and the UI renders a `restarting` panel in
        // the meantime.
        if (this.daemonConnected && !this.restarting) {
          this.daemonConnected = false
          this.scheduleReconnect()
        }
      } finally {
        this.loading = false
      }
    },

    /** Trigger a daemon restart from the UI. Covers the connect-flicker that
     *  the manual `restart_daemon` command would otherwise produce: polling
     *  errors while the old daemon is dead don't flip `daemonConnected`, and
     *  `pages/index.vue` renders a dedicated "Restarting" panel for the
     *  duration. Node processes are untouched by the restart (spawn.rs sets
     *  kill_on_drop(false)), so the node list and counts stay stable. */
    async restartDaemon() {
      this.restarting = true
      try {
        const url = await invoke<string>('restart_daemon')
        const settings = useSettingsStore()
        if (url && url !== settings.daemonUrl) {
          settings.daemonUrl = url
        }
        // Force a fresh fetch so the UI reflects the post-restart state
        // immediately instead of waiting for the next poll tick.
        await this.fetchDaemonStatus()
        await this.fetchNodes()
      } finally {
        this.restarting = false
      }
    },

    /** Enrich nodes with storage usage from the LMDB payload file. */
    async enrichNodeDetails() {
      for (const node of this.nodes) {
        if (node.id < 0) continue // skip placeholders

        // Try detail endpoint first (ant-client PR #22), fall back to known path
        let dataDir = node.data_dir
        if (!dataDir) {
          try {
            const detail = await daemonApi.nodeDetail(node.id)
            dataDir = detail.data_dir
            node.data_dir = detail.data_dir
            node.rewards_address = detail.rewards_address
            node.binary_path = detail.binary_path
            node.log_dir = detail.log_dir
            node.node_port = detail.node_port
            node.metrics_port = detail.metrics_port
          } catch {
            // Detail endpoint not available — derive path from node name
            try {
              const nodeDir = await invoke<string>('get_node_data_dir', { nodeId: node.id })
              dataDir = nodeDir
              node.data_dir = nodeDir
            } catch {
              // Can't determine data dir
            }
          }
        }

        if (dataDir) {
          // ant-node uses LMDB's default subdir layout: `chunks.mdb/` is a
          // directory containing `data.mdb` (the real payload) and a small
          // `lock.mdb`. `get_disk_usage` reports the filesystem-allocated
          // bytes of `data.mdb` (not its logical size), so a sparse LMDB map
          // reports real chunks-stored rather than the configured map size.
          // Upstream follow-up: expose this via the daemon status endpoint
          // so we don't depend on the on-disk file layout at all.
          try {
            const raw = await invoke<number>('get_disk_usage', { path: `${dataDir}/chunks.mdb/data.mdb` })
            node.storage_bytes = raw
          } catch {
            node.storage_bytes = 0
          }
        }
      }

      // Drive capacity changes slowly; refresh it on the same (slow) cadence as
      // storage enrichment rather than the fast status poll.
      await this.refreshDriveSpace()
    },

    /** Refresh total/available capacity of the volume holding node storage.
     *  Targets the configured storage dir when set, else the daemon default. */
    async refreshDriveSpace() {
      const settings = useSettingsStore()
      try {
        const space = await invoke<{ total: number; available: number }>('get_drive_space', {
          path: settings.storageDir ?? null,
        })
        if (space && typeof space.total === 'number') {
          this.driveTotalBytes = space.total
          this.driveAvailableBytes = space.available
        }
      } catch (e) {
        console.warn('Could not query drive space:', e)
      }
    },

    /** Start polling for status updates */
    startPolling() {
      this.stopPolling()
      this._pollTimer = setInterval(() => this.fetchNodes(), POLL_INTERVAL)
      this._detailPollTimer = setInterval(() => this.enrichNodeDetails(), DETAIL_POLL_INTERVAL)
    },

    stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
      if (this._detailPollTimer) {
        clearInterval(this._detailPollTimer)
        this._detailPollTimer = null
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
        case 'upgrade_scheduled':
          // Binary on disk has changed; node still running old version until
          // it exits (--stop-on-upgrade). Surface the target version so the
          // UI can show "v0.10.1 → v0.10.2 (upgrading)".
          if (node) {
            node.status = 'upgrade_scheduled'
            node.pending_version = event.pending_version
          }
          break
        case 'node_upgraded':
          // Supervisor has respawned the node against the new binary. Update
          // the live version and clear the pending marker. Status will land
          // on 'running' via the accompanying node_started event; set it
          // here too in case events arrive out of order.
          if (node) {
            if (event.new_version) node.version = event.new_version
            node.pending_version = undefined
            if (node.status === 'upgrade_scheduled') node.status = 'running'
          }
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
          this.enrichNodeDetails()
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
        data_dir_path: settings.storageDir ?? null,
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
        this.enrichNodeDetails() // fire-and-forget — populates data_dir/ports without waiting for the detail poll
        toasts.add(t('nodes.toast.added', { count: result.nodes_added.length }), 'info')
      } catch (e: any) {
        // Remove placeholders on failure
        this.nodes = this.nodes.filter(n => !placeholderIds.includes(n.id))
        toasts.add(t('nodes.toast.add_failed', { error: e.message }), 'error')
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
        toasts.add(t('nodes.toast.started', { id }), 'info')
      } catch (e: any) {
        const node = this.nodes.find(n => n.id === id)
        if (node) node.status = 'errored'
        toasts.add(t('nodes.toast.start_failed', { id, error: e.message }), 'error')
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
        toasts.add(t('nodes.toast.stopped', { id }), 'info')
      } catch (e: any) {
        toasts.add(t('nodes.toast.stop_failed', { id, error: e.message }), 'error')
      }
    },

    async removeNode(id: number) {
      const toasts = useToastStore()

      try {
        await daemonApi.removeNode(id)
        this.nodes = this.nodes.filter(n => n.id !== id)
        toasts.add(t('nodes.toast.removed', { id }), 'info')
      } catch (e: any) {
        toasts.add(t('nodes.toast.remove_failed', { id, error: e.message }), 'error')
      }
    },

    async startAll() {
      const toasts = useToastStore()
      const stoppedNodes = this.nodes.filter(n => n.status === 'stopped')
      if (stoppedNodes.length === 0) {
        toasts.add(t('nodes.toast.no_stopped'), 'warning')
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
          toasts.add(t('nodes.toast.node_failed', { id: f.node_id, error: f.error }), 'error')
        }
        for (const id of result.already_running) {
          const node = this.nodes.find(n => n.id === id)
          if (node) node.status = 'running'
        }
        if (result.started.length > 0) {
          toasts.add(t('nodes.toast.started_count', { count: result.started.length }), 'info')
        }
      } catch (e: any) {
        toasts.add(t('nodes.toast.start_all_failed', { error: e.message }), 'error')
        await this.fetchNodes() // refresh to get real state
      }
    },

    async stopAll() {
      const toasts = useToastStore()
      const runningNodes = this.nodes.filter(n => n.status === 'running')
      if (runningNodes.length === 0) {
        toasts.add(t('nodes.toast.no_running'), 'warning')
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
          toasts.add(t('nodes.toast.node_failed', { id: f.node_id, error: f.error }), 'error')
        }
        if (result.stopped.length > 0) {
          toasts.add(t('nodes.toast.stopped_count', { count: result.stopped.length }), 'info')
        }
      } catch (e: any) {
        toasts.add(t('nodes.toast.stop_all_failed', { error: e.message }), 'error')
        await this.fetchNodes()
      }
    },
  },
})
