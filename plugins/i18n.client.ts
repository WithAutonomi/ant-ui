import { createI18n } from 'vue-i18n'
import en from '~/locales/en.json'
import ja from '~/locales/ja.json'
import ko from '~/locales/ko.json'
import nl from '~/locales/nl.json'
import fr from '~/locales/fr.json'
import bg from '~/locales/bg.json'
import es from '~/locales/es.json'

/**
 * Exported so non-component code (Pinia options-API stores, plain utility
 * modules) can call `i18n.global.t(...)` without a setup context — `useI18n()`
 * only works inside Vue setup, but options-API store actions don't qualify.
 */
export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, ja, ko, nl, fr, bg, es },
  missingWarn: true,
  fallbackWarn: false,
})

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(i18n)

  // Dev-only handle for manual locale-swap testing from DevTools console.
  // Remove when the Settings picker lands.
  if (import.meta.dev && typeof window !== 'undefined') {
    ;(window as unknown as { __i18n: typeof i18n }).__i18n = i18n
  }
})
