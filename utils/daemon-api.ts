import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSettingsStore } from '~/stores/settings'

// ── Types matching ant-core/src/node/types.rs ──

export type NodeStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'errored'

export interface NodeConfig {
  id: number
  service_name: string
  rewards_address: string
  data_dir: string
  log_dir: string | null
  node_port: number | null
  metrics_port: number | null
  network_id: number | null
  binary_path: string
  version: string
  env_variables: Record<string, string>
  bootstrap_peers: string[]
}

// NodeInfo: ant-core uses #[serde(flatten)] on config, so all NodeConfig
// fields appear at the top level alongside status/pid/uptime_secs.
export interface NodeInfo extends NodeConfig {
  status: NodeStatus
  pid: number | null
  uptime_secs: number | null
}

export interface NodeStatusSummary {
  node_id: number
  name: string
  version: string
  status: NodeStatus
  pid?: number
  uptime_secs?: number
}

export interface DaemonStatus {
  running: boolean
  pid: number | null
  port: number | null
  uptime_secs: number | null
  nodes_total: number
  nodes_running: number
  nodes_stopped: number
  nodes_errored: number
}

export interface NodeStatusResult {
  nodes: NodeStatusSummary[]
  total_running: number
  total_stopped: number
}

export interface AddNodeOpts {
  count: number
  rewards_address: string
  node_port?: number | [number, number] | null
  metrics_port?: number | [number, number] | null
  data_dir_path?: string | null
  log_dir_path?: string | null
  network_id: number
  binary_source: { type: 'latest' } | { type: 'version'; value: string } | { type: 'url'; value: string } | { type: 'local_path'; value: string }
  bootstrap_peers: string[]
  env_variables: [string, string][]
}

export interface AddNodeResult {
  nodes_added: NodeConfig[]
}

export interface RemoveNodeResult {
  removed: NodeConfig
}

export interface NodeStarted {
  node_id: number
  service_name: string
  pid: number
}

export interface StartNodeResult {
  started: NodeStarted[]
  failed: { node_id: number; service_name: string; error: string }[]
  already_running: number[]
}

export interface NodeStopped {
  node_id: number
  service_name: string
}

export interface StopNodeResult {
  stopped: NodeStopped[]
  failed: { node_id: number; service_name: string; error: string }[]
  already_stopped: number[]
}

export interface NodeEvent {
  type: string
  node_id?: number
  pid?: number
  exit_code?: number | null
  attempt?: number
  message?: string
  version?: string
  bytes?: number
  total?: number
  path?: string
}

// ── API Client ──

class DaemonApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'DaemonApiError'
  }
}

function baseUrl(): string {
  const settings = useSettingsStore()
  return settings.daemonUrl
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${baseUrl()}${path}`
  const bodyStr = body !== undefined ? JSON.stringify(body) : null

  try {
    const text = await invoke<string>('daemon_request', {
      url,
      method,
      body: bodyStr,
    })
    return JSON.parse(text) as T
  } catch (e: any) {
    // Tauri invoke errors come as strings
    const msg = typeof e === 'string' ? e : e.message ?? String(e)
    throw new DaemonApiError(0, msg)
  }
}

export const daemonApi = {
  /** GET /api/v1/status */
  status: () => request<DaemonStatus>('GET', '/api/v1/status'),

  /** GET /api/v1/nodes/status */
  nodesStatus: () => request<NodeStatusResult>('GET', '/api/v1/nodes/status'),

  /** GET /api/v1/nodes/:id — full config + runtime state */
  nodeDetail: (id: number) => request<NodeInfo>('GET', `/api/v1/nodes/${id}`),

  /** POST /api/v1/nodes */
  addNodes: (opts: AddNodeOpts) => request<AddNodeResult>('POST', '/api/v1/nodes', opts),

  /** DELETE /api/v1/nodes/:id */
  removeNode: (id: number) => request<RemoveNodeResult>('DELETE', `/api/v1/nodes/${id}`),

  /** POST /api/v1/nodes/:id/start */
  startNode: (id: number) => request<NodeStarted>('POST', `/api/v1/nodes/${id}/start`),

  /** POST /api/v1/nodes/start-all */
  startAll: () => request<StartNodeResult>('POST', '/api/v1/nodes/start-all'),

  /** POST /api/v1/nodes/:id/stop */
  stopNode: (id: number) => request<NodeStopped>('POST', `/api/v1/nodes/${id}/stop`),

  /** POST /api/v1/nodes/stop-all */
  stopAll: () => request<StopNodeResult>('POST', '/api/v1/nodes/stop-all'),

  /** Connect to SSE event stream via Tauri proxy. Returns an abort function.
   * The Rust side streams SSE from the daemon and emits events to the frontend.
   * Polling (every 5s) remains as fallback.
   */
  events(_onEvent: (event: NodeEvent) => void): () => void {
    // Legacy stub kept for API compatibility — use connectSSE/disconnectSSE instead.
    return () => {}
  },
}

// ── SSE via Tauri proxy ──

/** Start the Rust-side SSE proxy and listen for forwarded events.
 * Returns an unlisten function to remove the Tauri event listener.
 */
export async function connectSSE(baseUrl: string): Promise<UnlistenFn> {
  // Start the Rust-side SSE proxy
  await invoke('connect_daemon_sse', { url: baseUrl })

  // Listen for forwarded events
  const unlisten = await listen('daemon-sse-event', (event) => {
    // event.payload contains the SSE data string
    const data = event.payload as string
    try {
      const parsed = JSON.parse(data)
      // Dispatch a custom event that the nodes store can listen to
      window.dispatchEvent(new CustomEvent('daemon-node-event', { detail: parsed }))
    } catch {
      // Non-JSON SSE data, ignore
    }
  })

  return unlisten
}

/** Stop the Rust-side SSE proxy. */
export async function disconnectSSE(): Promise<void> {
  await invoke('disconnect_daemon_sse')
}
