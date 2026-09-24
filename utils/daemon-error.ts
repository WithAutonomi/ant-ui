/**
 * Cleanup for error strings that originate in a spawned ant-node process and
 * reach the app via the daemon's `Process spawn failed: Node N exited
 * immediately: <stderr>` path.
 *
 * ant-node writes a color-eyre report to stderr even when stderr is a file, so
 * the daemon forwards raw ANSI escapes. The daemon also returns the whole
 * `stderr.log`, which is appended across spawns, so every failed Start adds one
 * more copy of the same report. Both are daemon-side defects (tracked
 * upstream) — this module makes the toast readable in the meantime.
 */

// CSI sequences (`ESC [ ... m` and friends). The ESC byte is sometimes lost in
// transit and only the `[91m` tail survives, so match that shape too — the
// `[<digits>m` form is specific enough not to eat legitimate brackets.
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\[(?:\d{1,3};)*\d{1,3}m/g

// color-eyre's trailer. Useless to an end user and repeated per report.
const EYRE_NOISE_RE =
  /\s*Location:\s*\S+\s*(?:Backtrace omitted\.\s*)?(?:Run with RUST_BACKTRACE=1 environment variable to display it\.\s*)?(?:Run with RUST_BACKTRACE=full to include source snippets\.\s*)?/g

// Each color-eyre report starts with `Error:` followed by the numbered chain.
const REPORT_SPLIT_RE = /\bError:\s*(?=\d+:\s)/

/** Strip ANSI escapes and eyre backtrace boilerplate. */
export function stripNodeStderrNoise(raw: string): string {
  return raw
    .replace(ANSI_RE, '')
    .replace(EYRE_NOISE_RE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/**
 * Collapse a stderr blob that contains the same color-eyre report N times into
 * one copy. Reports are split on their `Error: 0:` marker; consecutive
 * duplicates are dropped. Text without that marker is returned as-is.
 */
export function collapseRepeatedReports(text: string): string {
  const parts = text.split(REPORT_SPLIT_RE).map(p => p.trim()).filter(Boolean)
  if (parts.length < 2) return text

  const kept: string[] = []
  for (const p of parts) {
    if (kept[kept.length - 1] !== p) kept.push(p)
  }
  // The first segment is whatever preceded the first `Error:` (the daemon's
  // own prefix, e.g. `Process spawn failed: Node 35 exited immediately:`).
  // Re-attach the reports with a single marker each.
  const [head, ...reports] = kept
  const looksLikePrefix = !/^\d+:\s/.test(head)
  const body = (looksLikePrefix ? reports : kept).map(r => r.replace(/^\d+:\s*/, '')).join('\n')
  return looksLikePrefix && head ? `${head} ${body}` : body
}

/** Full cleanup: strip noise, then dedupe. Safe on non-node errors. */
export function sanitizeDaemonError(raw: string): string {
  return collapseRepeatedReports(stripNodeStderrNoise(raw))
}

/**
 * ant-node's file-per-chunk store refuses to open a `chunks/` directory another
 * process holds. Reaching this from the app means an earlier instance of the
 * same node is still alive (typically an auto-upgrade restart that raced —
 * upstream V2-1181) and the daemon lost track of it.
 */
const ALREADY_RUNNING_RE = /Another process already has the chunk store at (.+?) open/

export interface AlreadyRunningInfo {
  /** The locked data path the node reported, e.g. `D:\Autonomi\node-35\chunks`. */
  path: string
}

export function detectNodeAlreadyRunning(message: string): AlreadyRunningInfo | null {
  const m = ALREADY_RUNNING_RE.exec(stripNodeStderrNoise(message))
  return m ? { path: m[1].trim() } : null
}
