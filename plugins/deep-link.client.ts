import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { parseAutonomiDeepLink } from '~/utils/validators'
import { useFilesStore } from '~/stores/files'

/**
 * Handles `autonomi://<public_address>?name=<file>` deep links (V2-505).
 *
 * The Rust side (`src-tauri/src/lib.rs`) delivers URLs two ways: a `deep-link`
 * event for warm/live opens, and a `take_pending_deep_links` command for any
 * URL the app was cold-started with. Both funnel through `handle()`, which
 * validates the address and asks the Files page (via the store) to open the
 * Download dialog prefilled with it — the dialog is the confirm + filename
 * step, so a web-triggered link never downloads silently.
 */
export default defineNuxtPlugin(() => {
  // Only in the Tauri desktop runtime — no-op in a plain browser dev session.
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return

  // Capture composables now, while the Nuxt instance context is available — the
  // listen/invoke callbacks below run outside it, where calling
  // useFilesStore()/navigateTo() directly is unreliable.
  const files = useFilesStore()
  const router = useRouter()

  let lastUrl = ''
  let lastTs = 0

  const handle = (url: string) => {
    const link = parseAutonomiDeepLink(url)
    if (!link) return
    // Dedupe the brief overlap where the same URL arrives via both the pending
    // drain and the live event (the Rust side emits from two paths), while
    // still allowing a deliberate re-click of the same link later.
    const now = Date.now()
    if (url === lastUrl && now - lastTs < 2000) return
    lastUrl = url
    lastTs = now

    files.pendingDownloadAddress = link.address
    files.pendingDownloadName = link.name ?? null
    router.push('/files')
  }

  // Warm/live opens.
  listen<string[]>('deep-link', e => e.payload.forEach(handle)).catch(() => {})

  // Cold-start launch URL(s) captured before this listener was attached.
  invoke<string[]>('take_pending_deep_links')
    .then(urls => urls.forEach(handle))
    .catch(() => {})
})
