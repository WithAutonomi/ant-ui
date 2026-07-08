import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setMockInvokeHandler, resetTauriMocks } from '../mocks/tauri'
import { useNodesStore } from '~/stores/nodes'
import { useSettingsStore } from '~/stores/settings'
import { MIN_NODE_SIZE_BYTES } from '~/utils/constants'

// Mock the daemon-api module — the nodes store imports connectSSE/disconnectSSE
vi.mock('~/utils/daemon-api', () => ({
  daemonApi: {
    status: vi.fn(),
    nodesStatus: vi.fn(),
    nodeDetail: vi.fn(),
  },
  connectSSE: vi.fn(() => Promise.resolve(vi.fn())),
  disconnectSSE: vi.fn(() => Promise.resolve()),
}))

describe('nodes store', () => {
  let nodesStore: ReturnType<typeof useNodesStore>
  let settingsStore: ReturnType<typeof useSettingsStore>

  beforeEach(() => {
    // Reset both the Tauri invoke mock AND the vue-i18n / daemon-api module
    // mocks — without `vi.clearAllMocks`, a `mockResolvedValue` (default
    // fallback) set by an earlier test leaks into later ones and silently
    // satisfies status() calls the test never set up.
    vi.clearAllMocks()
    vi.useRealTimers()
    resetTauriMocks()

    settingsStore = useSettingsStore()
    settingsStore.$reset()
    nodesStore = useNodesStore()
    // Pinia's $reset clears state references (`_pollTimer`, `_reconnectTimer`)
    // but does not call clearInterval / clearTimeout on the underlying JS
    // timers. Drop them explicitly so a previous test's polling or reconnect
    // schedule can't fire `fetchNodes` / `fetchDaemonStatus` against the new
    // test's mocks.
    nodesStore.stopPolling()
    nodesStore.cancelReconnect()
    nodesStore.$reset()
  })

  describe('init', () => {
    it('connects to daemon when ensure_daemon_running succeeds', async () => {
      const { daemonApi } = await import('~/utils/daemon-api')

      setMockInvokeHandler((cmd) => {
        if (cmd === 'ensure_daemon_running') return 'http://127.0.0.1:55555'
        if (cmd === 'connect_daemon_sse') return undefined
      })

      vi.mocked(daemonApi.status).mockResolvedValue({
        running: true,
        pid: 1234,
        port: 55555,
        uptime_secs: 100,
        nodes_total: 2,
        nodes_running: 1,
        nodes_stopped: 1,
        nodes_errored: 0,
      })

      vi.mocked(daemonApi.nodesStatus).mockResolvedValue({
        nodes: [
          { node_id: 1, name: 'node1', version: '0.9.0', status: 'running', pid: 100, uptime_secs: 50 },
          { node_id: 2, name: 'node2', version: '0.9.0', status: 'stopped' },
        ],
        total_running: 1,
        total_stopped: 1,
      })

      await nodesStore.init()

      expect(nodesStore.daemonConnected).toBe(true)
      expect(nodesStore.initializing).toBe(false)
      expect(nodesStore.nodes).toHaveLength(2)
      expect(settingsStore.daemonUrl).toBe('http://127.0.0.1:55555')
    })

    it('sets disconnected when daemon is unavailable', async () => {
      const { daemonApi } = await import('~/utils/daemon-api')

      setMockInvokeHandler((cmd) => {
        if (cmd === 'ensure_daemon_running') throw new Error('binary not found')
      })

      vi.mocked(daemonApi.status).mockRejectedValue(new Error('connection refused'))

      await nodesStore.init()

      expect(nodesStore.daemonConnected).toBe(false)
      expect(nodesStore.initializing).toBe(false)
    })

    it('retries the status fetch when the daemon races boot', async () => {
      // Repros the V2-218 boot race: `ensure_daemon_running` returns after
      // the port file is written, but the daemon's HTTP server hasn't bound
      // the port yet. The first status() throws; the next succeeds. The
      // store should ride out the failure inside `initializing` and end up
      // connected — no transient `daemonConnected=false` exposed.
      const { daemonApi } = await import('~/utils/daemon-api')
      vi.useFakeTimers()

      setMockInvokeHandler((cmd) => {
        if (cmd === 'ensure_daemon_running') return 'http://127.0.0.1:55555'
        if (cmd === 'connect_daemon_sse') return undefined
      })

      // Counter-based implementation rather than `mockRejectedValueOnce
      // → mockResolvedValueOnce`. The Once-queue pattern depends on every
      // call beyond the queue falling back to a default, which silently
      // varies depending on what the previous test in this file set up;
      // a counter is self-contained and the assertion below can verify
      // both the retry behaviour and that no unexpected extra calls leak in.
      let statusCallCount = 0
      vi.mocked(daemonApi.status).mockImplementation(async () => {
        statusCallCount++
        if (statusCallCount === 1) throw new Error('connection refused')
        return {
          running: true, pid: 1, port: 55555, uptime_secs: 0,
          nodes_total: 0, nodes_running: 0, nodes_stopped: 0, nodes_errored: 0,
        }
      })

      vi.mocked(daemonApi.nodesStatus).mockResolvedValue({
        nodes: [], total_running: 0, total_stopped: 0,
      })

      const initPromise = nodesStore.init()
      // Advance past the 250 ms retry delay so the second status() runs.
      await vi.advanceTimersByTimeAsync(300)
      await initPromise

      expect(nodesStore.daemonConnected).toBe(true)
      expect(nodesStore.initializing).toBe(false)
      expect(daemonApi.status).toHaveBeenCalledTimes(2)

      // Stop polling / reconnect explicitly before useRealTimers so the
      // following test's beforeEach doesn't have to clean them up.
      nodesStore.stopPolling()
      nodesStore.cancelReconnect()
      vi.useRealTimers()
    })

    it('updates daemon URL when port changes', async () => {
      const { daemonApi } = await import('~/utils/daemon-api')

      settingsStore.daemonUrl = 'http://127.0.0.1:12500' // old default

      setMockInvokeHandler((cmd) => {
        if (cmd === 'ensure_daemon_running') return 'http://127.0.0.1:63210'
        if (cmd === 'connect_daemon_sse') return undefined
      })

      vi.mocked(daemonApi.status).mockResolvedValue({
        running: true, pid: 1, port: 63210, uptime_secs: 0,
        nodes_total: 0, nodes_running: 0, nodes_stopped: 0, nodes_errored: 0,
      })

      vi.mocked(daemonApi.nodesStatus).mockResolvedValue({
        nodes: [], total_running: 0, total_stopped: 0,
      })

      await nodesStore.init()

      expect(settingsStore.daemonUrl).toBe('http://127.0.0.1:63210')
    })
  })

  describe('handleNodeEvent', () => {
    it('updates node status from SSE events', () => {
      nodesStore.nodes = [
        { id: 1, name: 'node1', status: 'stopped', version: '0.9.0' },
      ]

      nodesStore.handleNodeEvent({ type: 'node_started', node_id: 1, pid: 5678 })

      expect(nodesStore.nodes[0].status).toBe('running')
      expect(nodesStore.nodes[0].pid).toBe(5678)
    })

    it('handles node crash event', () => {
      nodesStore.nodes = [
        { id: 1, name: 'node1', status: 'running', version: '0.9.0', pid: 5678 },
      ]

      nodesStore.handleNodeEvent({ type: 'node_crashed', node_id: 1 })

      expect(nodesStore.nodes[0].status).toBe('errored')
      expect(nodesStore.nodes[0].pid).toBeUndefined()
    })
  })

  describe('getters', () => {
    it('counts nodes by status', () => {
      nodesStore.nodes = [
        { id: 1, name: 'n1', status: 'running', version: '' },
        { id: 2, name: 'n2', status: 'running', version: '' },
        { id: 3, name: 'n3', status: 'stopped', version: '' },
        { id: 4, name: 'n4', status: 'errored', version: '' },
      ]

      expect(nodesStore.running).toBe(2)
      expect(nodesStore.stopped).toBe(1)
      expect(nodesStore.errored).toBe(1)
      expect(nodesStore.total).toBe(4)
    })

    it('driveUsageByVolume groups nodes by volume and aggregates usage', () => {
      nodesStore.nodes = [
        { id: 1, name: 'n1', status: 'running', version: '', data_dir: 'C:\\ant\\node-1', storage_bytes: 100 },
        { id: 2, name: 'n2', status: 'running', version: '', data_dir: 'C:\\ant\\node-2', storage_bytes: 200 },
        { id: 3, name: 'n3', status: 'running', version: '', data_dir: 'D:\\Ant\\node-3', storage_bytes: 50 },
      ]
      nodesStore.driveVolumes = [
        { root: 'C:\\', total: 1000, available: 400, paths: ['C:\\ant\\node-1', 'C:\\ant\\node-2'] },
        { root: 'D:\\', total: 2000, available: 1500, paths: ['D:\\Ant\\node-3'] },
      ]
      nodesStore.currentVolumeRoot = 'C:\\'

      const vols = nodesStore.driveUsageByVolume
      expect(vols).toHaveLength(2)

      const c = vols.find(v => v.key === 'C:\\')!
      expect(c.used).toBe(300)
      expect(c.nodeCount).toBe(2)
      expect(c.min).toBe(2 * MIN_NODE_SIZE_BYTES)

      const d = vols.find(v => v.key === 'D:\\')!
      expect(d.used).toBe(50)
      expect(d.nodeCount).toBe(1)
    })

    it('driveUsageByVolume falls back to a single synthesized volume', () => {
      nodesStore.nodes = [
        { id: 1, name: 'n1', status: 'running', version: '', storage_bytes: 100 },
        { id: 2, name: 'n2', status: 'running', version: '', storage_bytes: 200 },
      ]
      nodesStore.driveVolumes = []
      nodesStore.driveTotalBytes = 5000
      nodesStore.driveAvailableBytes = 4000

      const vols = nodesStore.driveUsageByVolume
      expect(vols).toHaveLength(1)
      expect(vols[0].used).toBe(300)
      expect(vols[0].nodeCount).toBe(2)
      expect(vols[0].total).toBe(5000)
      expect(vols[0].label).toBe('')
    })

    it('driveUsageByVolume is empty with no volumes and no drive data', () => {
      nodesStore.nodes = [{ id: 1, name: 'n1', status: 'running', version: '' }]
      nodesStore.driveVolumes = []
      nodesStore.driveTotalBytes = 0

      expect(nodesStore.driveUsageByVolume).toEqual([])
    })

    it('otherNodeLocations lists node dirs outside the configured storage dir', () => {
      settingsStore.storageDir = 'C:\\Users\\me\\Downloads'
      nodesStore.nodes = [
        { id: 1, name: 'n1', status: 'running', version: '', data_dir: 'C:\\Users\\me\\AppData\\Roaming\\ant\\nodes\\node-1', storage_bytes: 100 },
        { id: 2, name: 'n2', status: 'running', version: '', data_dir: 'C:\\Users\\me\\AppData\\Roaming\\ant\\nodes\\node-2', storage_bytes: 200 },
        { id: 3, name: 'n3', status: 'running', version: '', data_dir: 'C:\\tmp\\node-3', storage_bytes: 50 },
        { id: 4, name: 'n4', status: 'running', version: '', data_dir: 'C:\\Users\\me\\Downloads\\ant\\node-4', storage_bytes: 10 },
      ]

      const locs = nodesStore.otherNodeLocations
      // node-4 lives under the storage dir (Downloads) → excluded.
      expect(locs).toHaveLength(2)
      const ant = locs.find(l => l.dir === 'C:\\Users\\me\\AppData\\Roaming\\ant\\nodes')!
      expect(ant.nodeCount).toBe(2)
      expect(ant.used).toBe(300)
      const tmp = locs.find(l => l.dir === 'C:\\tmp')!
      expect(tmp.nodeCount).toBe(1)
      expect(tmp.used).toBe(50)
    })

    it('otherNodeLocations uses the resolved current dir when no storage dir is set', () => {
      settingsStore.storageDir = null
      nodesStore.currentVolumeDir = 'C:\\Users\\me\\AppData\\Roaming\\ant'
      nodesStore.nodes = [
        { id: 1, name: 'n1', status: 'running', version: '', data_dir: 'C:\\Users\\me\\AppData\\Roaming\\ant\\nodes\\node-1', storage_bytes: 100 },
        { id: 2, name: 'n2', status: 'running', version: '', data_dir: 'C:\\tmp\\node-2', storage_bytes: 50 },
      ]

      // node-1 is under the resolved default dir → excluded; only C:\tmp is "other".
      const locs = nodesStore.otherNodeLocations
      expect(locs).toHaveLength(1)
      expect(locs[0].dir).toBe('C:\\tmp')
      expect(locs[0].nodeCount).toBe(1)
    })
  })
})
