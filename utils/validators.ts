export function isValidEthAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

/** A public Autonomi data address: a 32-byte (64 hex char) value, optionally
 *  `0x`-prefixed. Stricter than the download dialog's loose `{8,}` check —
 *  used to validate untrusted input arriving via the `autonomi://` deep link
 *  before we act on it. */
export function isValidPublicAddress(addr: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(addr.trim())
}

export interface AutonomiLink {
  address: string
  /** Optional suggested filename. Derived from the query string: an explicit
   *  `?name=` wins; otherwise `?filename=` and `?filetype=` are joined with a
   *  dot (`filename.filetype`). Unvalidated — the download dialog runs it
   *  through `filenameError` and blocks an unsafe name. */
  name?: string
}

/** Derive a suggested "save as" filename from an autonomi link's query string.
 *  Precedence: explicit `name`, then `filename` + `filetype` joined by a dot,
 *  then a bare `filename`. Returns undefined when the link carries no usable
 *  name hint. A leading dot on `filetype` is tolerated (`.epub` → `epub`). */
function deriveLinkName(url: string): string | undefined {
  const q = url.indexOf('?')
  if (q === -1) return undefined
  const params = new URLSearchParams(url.slice(q + 1))
  const explicit = params.get('name')?.trim()
  if (explicit) return explicit
  const base = params.get('filename')?.trim()
  const ext = params.get('filetype')?.trim().replace(/^\.+/, '')
  if (base && ext) return `${base}.${ext}`
  if (base) return base
  return undefined
}

/** Parse an `autonomi://<address>` deep link into its public address (and an
 *  optional suggested filename), or null if it isn't a well-formed autonomi URL
 *  with a valid address. Tolerates an optional `//`, a trailing slash, and any
 *  query/fragment. Examples: `autonomi://<64-hex>?name=book.epub`,
 *  `autonomi://<64-hex>?filename=book&filetype=epub`. */
export function parseAutonomiDeepLink(url: string): AutonomiLink | null {
  const trimmed = url.trim()
  const m = trimmed.match(/^autonomi:(?:\/\/)?([^/?#]+)/i)
  if (!m) return null
  const address = m[1]
  if (!isValidPublicAddress(address)) return null

  const name = deriveLinkName(trimmed)
  return name ? { address, name } : { address }
}

/** A concrete thing the Download dialog can act on, derived from its free-form
 *  input box (or a dropped file): an on-network/known address, a local
 *  `.datamap` file path, or an `http(s)` URL that serves a `.datamap`.
 *  `invalid` means the input matched nothing. */
export type DownloadTarget =
  | { kind: 'address'; address: string; name?: string }
  | { kind: 'datamap'; path: string; name?: string }
  | { kind: 'url'; url: string; name?: string }
  | { kind: 'invalid' }

/** Suggested filename from a datamap path or URL: the last path segment (minus
 *  any query/fragment) with a trailing `.datamap` stripped. */
function datamapNameFromPath(p: string): string | undefined {
  const clean = p.split(/[?#]/)[0]
  const base = clean.split(/[\\/]/).pop() ?? clean
  return base.replace(/\.datamap$/i, '') || undefined
}

/** If `input` is an `http(s)` URL (or a bare `host.tld/…` that we can safely
 *  promote to `https://`) pointing at a `.datamap` resource, return the
 *  normalized URL; otherwise null. Query/fragment are allowed after the
 *  `.datamap` path segment. */
function toHttpDatamapUrl(input: string): string | null {
  const s = input.trim()
  let url: string | null = null
  if (/^https?:\/\//i.test(s)) {
    url = s
  } else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\//i.test(s)) {
    // Bare `host.tld/path…` with a dotted hostname before the first slash —
    // treat as https. (A leading-slash absolute path or `C:\…` won't match.)
    url = `https://${s}`
  }
  if (!url) return null
  const pathPart = url.split(/[?#]/)[0]
  return /\.datamap$/i.test(pathPart) ? url : null
}

/** Normalize a `file://` URI to a filesystem path (URL-decoded). Returns the
 *  input trimmed-but-unchanged if it isn't a file URI. Handles the Windows
 *  `file:///C:/x` → `C:/x` shape. */
export function fileUriToPath(input: string): string {
  const s = input.trim()
  if (!/^file:\/\//i.test(s)) return s
  // Strip the scheme and any authority/host component (`file://host/path`).
  let p = s.replace(/^file:\/\/[^/]*/i, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    /* leave the raw (possibly malformed) percent-encoding in place */
  }
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1)
  return p
}

/** Classify a Download dialog input into a concrete {@link DownloadTarget}.
 *
 *  - `autonomi://<addr>[?name|filename+filetype]` → address (public), with a
 *    suggested filename from the link.
 *  - an `http(s)` URL (or bare `host.tld/…`) ending in `.datamap` → a remote
 *    datamap to fetch, with a suggested filename from its last path segment.
 *  - a `file://` URI or any path-looking string ending in `.datamap` → a local
 *    datamap file, with a suggested filename from its basename.
 *  - a bare 64-hex value (optional `0x`) → address.
 *  - anything else → `invalid`.
 *
 *  Order matters: the `autonomi:` / URL / datamap-path checks run before the
 *  bare hex check, and a bare 64-hex address contains no slashes / `.datamap`
 *  so it never trips those branches. */
export function classifyDownloadInput(input: string): DownloadTarget {
  const s = input.trim()
  if (!s) return { kind: 'invalid' }

  if (/^autonomi:/i.test(s)) {
    const link = parseAutonomiDeepLink(s)
    return link ? { kind: 'address', address: link.address, name: link.name } : { kind: 'invalid' }
  }

  const url = toHttpDatamapUrl(s)
  if (url) return { kind: 'url', url, name: datamapNameFromPath(url) }

  if (/^file:\/\//i.test(s) || /[\\/]/.test(s) || /\.datamap$/i.test(s)) {
    const path = fileUriToPath(s)
    if (!/\.datamap$/i.test(path)) return { kind: 'invalid' }
    return { kind: 'datamap', path, name: datamapNameFromPath(path) }
  }

  if (isValidPublicAddress(s)) return { kind: 'address', address: s }
  return { kind: 'invalid' }
}

// Windows-reserved set is the strict superset across platforms — rejecting it
// everywhere keeps the same filename portable to any host. Forward/backslash
// would also be path-traversal; null + control chars are never valid.
const RESERVED_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/
const RESERVED_FILENAME_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/**
 * Validate a user-typed "Save as" filename against the cross-platform reserved
 * set. Returns a translation key the caller can pass to `$t(...)`, or null
 * when the name is safe to pass to the OS. An empty/whitespace-only string
 * returns null so the caller can decide whether emptiness is itself an error
 * (most callers gate the submit button on `name.trim().length > 0` separately).
 *
 * Returns keys instead of pre-translated strings so this module stays usable
 * outside a Vue setup context — the caller is always rendering in a
 * component, so it owns translation.
 */
export function filenameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return null
  if (RESERVED_FILENAME_CHARS.test(trimmed)) return 'validators.filename.has_special_chars'
  if (/[. ]$/.test(trimmed)) return 'validators.filename.ends_with_dot_or_space'
  if (RESERVED_FILENAME_NAMES.test(trimmed)) return 'validators.filename.reserved_on_windows'
  return null
}
