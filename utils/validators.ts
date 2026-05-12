export function isValidEthAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
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
