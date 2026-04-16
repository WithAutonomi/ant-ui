import { watchEffect } from 'vue'
import { useSettingsStore } from '~/stores/settings'

/**
 * Syncs the theme class on <html> and the AppKit modal theme with the
 * settings store. Tokens are defined as CSS custom properties in
 * tailwind.config.cjs + assets/css/main.css — dark values are the fallback
 * and `html.light` activates the light overrides.
 */
export function useTheme() {
  const settings = useSettingsStore()
  const nuxt = useNuxtApp()

  watchEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (settings.themeMode === 'light') {
      root.classList.add('light')
    } else {
      root.classList.remove('light')
    }

    const appkit = nuxt.$appkit as { setThemeMode?: (m: 'dark' | 'light') => void } | null
    appkit?.setThemeMode?.(settings.themeMode)
  })
}
