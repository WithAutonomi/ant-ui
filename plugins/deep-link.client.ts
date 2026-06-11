import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { parseAutonomiDeepLink } from '~/utils/validators'
import { useFilesStore } from '~/stores/files'

/**
 * Handles `autonomi://<public_address>` deep links (V2-505).
 *
 * The Rust side (`src-tauri/src/lib.rs`) delivers URLs two ways:
 *  - a `deep-link` event for warm/live opens (app already running), and
 *  - a `take_pending_deep_links` command holding any URL the app was cold-started
 *    with, before this listener existed.
 *
 * Both funnel through `handle()`, which validates the address and asks the Files
 * page (via the store) to open the Download dialog prefilled with it. The dialog
 * is the confirmation + filename step — we never download silently, since a web
 * page is what triggered the action.
 */
export default defineNuxtPlugin(() => {
  // Only in the Tauri desktop runtime — no-op in a plain browser dev session.
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return

  let lastUrl = ''
  let lastTs = 0

  const handle = (url: string) => {
    const address = parseAutonomiDeepLink(url)
    if (!address) return
    // Dedupe the brief cold-start overlap (the pending drain and the live event
    // can both deliver the launch URL), while still allowing a deliberate
    // re-click of the same link later.
    const now = Date.now()
    if (url === lastUrl && now - lastTs < 2000) return
    lastUrl = url
    lastTs = now

    useFilesStore().pendingDownloadAddress = address
    navigateTo('/files')
  }

  // Warm/live opens.
  listen<string[]>('deep-link', (e) => {
    for (const u of e.payload) handle(u)
  })

  // Cold-start launch URL(s).
  invoke<string[]>('take_pending_deep_links')
    .then(urls => urls.forEach(handle))
    .catch(() => {})
})
