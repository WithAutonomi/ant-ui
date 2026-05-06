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
 * set. Returns an error message for the UI, or null when the name is safe to
 * pass to the OS. An empty/whitespace-only string returns null so the caller
 * can decide whether emptiness is itself an error (most callers gate the
 * submit button on `name.trim().length > 0` separately).
 */
export function filenameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return null
  if (RESERVED_FILENAME_CHARS.test(trimmed)) return 'Filename cannot contain special characters'
  if (/[. ]$/.test(trimmed)) return 'Filename cannot end with a dot or space'
  if (RESERVED_FILENAME_NAMES.test(trimmed)) return `${trimmed} is a reserved name on Windows`
  return null
}
