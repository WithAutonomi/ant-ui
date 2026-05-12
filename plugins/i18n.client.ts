import { createI18n } from 'vue-i18n'
import en from '~/locales/en.json'
import ja from '~/locales/ja.json'

export default defineNuxtPlugin((nuxtApp) => {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ja },
    missingWarn: true,
    fallbackWarn: false,
  })
  nuxtApp.vueApp.use(i18n)

  // Dev-only handle for manual locale-swap testing from DevTools console.
  // Remove when the Settings picker lands.
  if (import.meta.dev && typeof window !== 'undefined') {
    ;(window as unknown as { __i18n: typeof i18n }).__i18n = i18n
  }
})
