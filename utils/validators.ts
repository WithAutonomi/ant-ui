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

/** Parse an `autonomi://<address>` deep link into its public address, or null
 *  if it isn't a well-formed autonomi URL with a valid address. Tolerates an
 *  optional `//`, a trailing slash, and any query/fragment. */
export function parseAutonomiDeepLink(url: string): string | null {
  const m = url.trim().match(/^autonomi:(?:\/\/)?([^/?#]+)/i)
  if (!m) return null
  const addr = m[1]
  return isValidPublicAddress(addr) ? addr : null
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
