import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setMockInvokeHandler, resetTauriMocks } from '../mocks/tauri'
import { useNodesStore } from '~/stores/nodes'
import { useSettingsStore } from '~/stores/settings'

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
    resetTauriMocks()
    settingsStore = useSettingsStore()
    settingsStore.$reset()
    nodesStore = useNodesStore()
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
  })
})
