import { describe, it, expect } from 'vitest'
import {
  stripNodeStderrNoise,
  collapseRepeatedReports,
  sanitizeDaemonError,
  detectNodeAlreadyRunning,
} from '~/utils/daemon-error'

// One color-eyre report as ant-node 0.20.0 writes it to stderr.log, with the
// ANSI escapes the daemon forwards verbatim. This is the exact text an external
// tester saw six times over after an auto-upgrade restart raced (V2-1181).
const ESC = '\x1b'
const ONE_REPORT =
  `Error: 0: ${ESC}[91mnode startup failed: Failed to create LMDB storage: storage error: ` +
  `Another process already has the chunk store at D:\\Autonomi\\node-35\\chunks open ` +
  `(The process cannot access the file because another process has locked a portion of the file. (os error 33)). ` +
  `Two nodes cannot share one data directory: each keeps its own index and they would disagree about what is stored. ` +
  `Stop the other node first.${ESC}[0m Location: ${ESC}[35msrc\\bin\\ant-node\\main.rs${ESC}[0m:${ESC}[35m169${ESC}[0m ` +
  `Backtrace omitted. Run with RUST_BACKTRACE=1 environment variable to display it. ` +
  `Run with RUST_BACKTRACE=full to include source snippets.`

const DAEMON_PREFIX = 'Process spawn failed: Node 35 exited immediately: '
const SIX_REPORTS = DAEMON_PREFIX + Array(6).fill(ONE_REPORT).join(' ')

const CLEAN_MESSAGE =
  'node startup failed: Failed to create LMDB storage: storage error: ' +
  'Another process already has the chunk store at D:\\Autonomi\\node-35\\chunks open ' +
  '(The process cannot access the file because another process has locked a portion of the file. (os error 33)). ' +
  'Two nodes cannot share one data directory: each keeps its own index and they would disagree about what is stored. ' +
  'Stop the other node first.'

describe('stripNodeStderrNoise', () => {
  it('removes ANSI escapes and the color-eyre backtrace trailer', () => {
    const out = stripNodeStderrNoise(ONE_REPORT)
    expect(out).not.toContain(ESC)
    expect(out).not.toMatch(/\[\d+m/)
    expect(out).not.toContain('Location:')
    expect(out).not.toContain('RUST_BACKTRACE')
    expect(out).toBe(`Error: 0: ${CLEAN_MESSAGE}`)
  })

  it('also removes SGR codes whose ESC byte was lost in transit', () => {
    expect(stripNodeStderrNoise('[91mboom[0m')).toBe('boom')
  })

  it('leaves ordinary bracketed text alone', () => {
    expect(stripNodeStderrNoise('config [nodes] section: 3m timeout')).toBe(
      'config [nodes] section: 3m timeout',
    )
  })
})

describe('collapseRepeatedReports', () => {
  it('collapses N identical reports into one and keeps the daemon prefix', () => {
    const cleaned = stripNodeStderrNoise(SIX_REPORTS)
    const out = collapseRepeatedReports(cleaned)
    expect(out).toBe(`${DAEMON_PREFIX.trim()} ${CLEAN_MESSAGE}`)
    expect(out.match(/Another process already/g)).toHaveLength(1)
  })

  it('keeps distinct consecutive reports', () => {
    const out = collapseRepeatedReports('Error: 0: first Error: 0: second')
    expect(out).toBe('first\nsecond')
  })

  it('returns text without a report marker unchanged', () => {
    expect(collapseRepeatedReports('I/O error: Access is denied. (os error 5)')).toBe(
      'I/O error: Access is denied. (os error 5)',
    )
  })
})

describe('sanitizeDaemonError', () => {
  it('turns the six-copy ANSI wall into one clean sentence', () => {
    const out = sanitizeDaemonError(SIX_REPORTS)
    expect(out).toBe(`${DAEMON_PREFIX.trim()} ${CLEAN_MESSAGE}`)
  })

  it('is a no-op on non-node daemon errors', () => {
    const msg = 'validation failed: rewards_address'
    expect(sanitizeDaemonError(msg)).toBe(msg)
  })
})

describe('detectNodeAlreadyRunning', () => {
  it('extracts the locked path from the file-store refusal', () => {
    expect(detectNodeAlreadyRunning(SIX_REPORTS)).toEqual({
      path: 'D:\\Autonomi\\node-35\\chunks',
    })
  })

  it('works on an already-sanitized message', () => {
    expect(detectNodeAlreadyRunning(sanitizeDaemonError(SIX_REPORTS))).toEqual({
      path: 'D:\\Autonomi\\node-35\\chunks',
    })
  })

  it('returns null for unrelated start failures', () => {
    expect(detectNodeAlreadyRunning('Process spawn failed: exit code: 1')).toBeNull()
    expect(detectNodeAlreadyRunning('Binary not found at path: /x/antnode')).toBeNull()
  })
})
