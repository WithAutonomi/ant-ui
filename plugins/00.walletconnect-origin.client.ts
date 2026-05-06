import { APPKIT_METADATA } from '~/utils/wallet-config'

/**
 * Override `window.location.origin` so the WalletConnect modal shows our
 * production URL instead of the Tauri webview's "tauri://localhost" origin.
 *
 * `@walletconnect/utils::populateAppMetadata` silently substitutes
 * `window.location.origin` for our `metadata.url` regardless of what we
 * configure in `APPKIT_METADATA`. Reown Cloud verification of the project
 * would be the canonical fix, but in the meantime overriding the getter
 * upstream of every read keeps the modal honest.
 *
 * Nothing in the app reads `location.origin` itself — verified via grep at
 * commit time — so the override is global. `00.` prefix forces this plugin
 * to load before `appkit.client.ts` so the override is in place by the
 * time AppKit's wallet-connect modal calls `populateAppMetadata` on user
 * action.
 */
export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return

  try {
    Object.defineProperty(window.location, 'origin', {
      get: () => APPKIT_METADATA.url,
      configurable: true,
    })
  } catch (err) {
    // Some browsers / webview versions disallow redefining built-in
    // location properties. Fail soft — the modal still works, it just
    // shows the Tauri origin.
    console.warn('Failed to override window.location.origin:', err)
  }
})
