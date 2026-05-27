import { computed, ref } from 'vue'
import { locale as osLocaleApi } from '@tauri-apps/plugin-os'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '~/stores/settings'

export const SUPPORTED_LOCALES = ['en', 'ja', 'ko', 'nl', 'fr', 'bg', 'es', 'ar', 'he', 'ru', 'uk', 'zh-CN', 'zh-TW', 'pt-BR', 'tr', 'vi', 'id', 'de'] as const
export type SupportedLocale = typeof SUPPORTED_LOCALES[number]
const DEFAULT_LOCALE: SupportedLocale = 'en'

/** Locales whose script flows right-to-left. The active value is applied as
 *  `dir="rtl"` on the <html> element via useHead() in app.vue, which lets
 *  Tailwind's `rtl:` variant flip individual classes that aren't already on
 *  logical properties. */
export const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set(['ar', 'he'])

export function isRtlLocale(value: string): boolean {
  return RTL_LOCALES.has(value as SupportedLocale)
}

/** Each locale's name in its own script. Used in the Settings picker so the
 *  user sees the language name regardless of the currently-active UI locale. */
export const NATIVE_LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  nl: 'Nederlands',
  fr: 'Français',
  bg: 'Български',
  es: 'Español',
  ar: 'العربية',
  he: 'עברית',
  ru: 'Русский',
  uk: 'Українська',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'pt-BR': 'Português (Brasil)',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  de: 'Deutsch',
}

/** Module-scoped cache of the OS-resolved locale. Warmed on the first
 *  detectOsLocale() call so the Settings picker can render
 *  "System default: <name>" synchronously after app init. */
const osLocaleRef = ref<SupportedLocale | null>(null)

function isSupported(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function normalizeLocale(raw: string | null | undefined): SupportedLocale {
  if (!raw) return DEFAULT_LOCALE
  // First try the full IETF tag (lang+region) — handles zh-CN / zh-TW / pt-BR
  // where the region carries the meaning. Casing must match SUPPORTED_LOCALES
  // exactly (lower-case lang, upper-case region per BCP 47).
  const parts = raw.split('-')
  if (parts.length >= 2) {
    const tagged = `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`
    if (isSupported(tagged)) return tagged
  }
  // Fall back to the bare language tag — fr-CA → fr, en-GB → en, etc.
  const base = parts[0].toLowerCase()
  return isSupported(base) ? base : DEFAULT_LOCALE
}

export async function detectOsLocale(): Promise<SupportedLocale> {
  if (osLocaleRef.value !== null) return osLocaleRef.value
  try {
    osLocaleRef.value = normalizeLocale(await osLocaleApi())
  } catch {
    osLocaleRef.value = DEFAULT_LOCALE
  }
  return osLocaleRef.value
}

export function useLocale() {
  const { locale, t } = useI18n()
  const settings = useSettingsStore()

  /**
   * Resolve and apply the locale to use at app start. Order:
   *   1. Persisted user choice (`settings.i18nLocale`) if supported.
   *   2. OS locale via tauri-plugin-os, region-stripped.
   *   3. Fallback `en`.
   *
   * Always warms the OS-locale cache so the Settings picker can render its
   * "System default: <name>" label without an extra round-trip.
   */
  async function init() {
    const persisted = settings.i18nLocale
    if (persisted && isSupported(persisted)) {
      locale.value = persisted
      // Warm the OS cache for the Settings picker label even when the
      // persisted choice overrides it.
      detectOsLocale().catch(() => {})
      return
    }
    locale.value = await detectOsLocale()
  }

  /** Switch the active locale. `null` means "follow system" — the persisted
   *  choice is cleared and the live locale falls back to the OS reading. */
  async function setLocale(next: SupportedLocale | null) {
    if (next === null) {
      await settings.setI18nLocale(null)
      locale.value = await detectOsLocale()
      return
    }
    await settings.setI18nLocale(next)
    locale.value = next
  }

  /** Reactive `ltr`/`rtl` flag tracking the active locale. Bound into the
   *  <html dir=...> attribute by app.vue so Tailwind `rtl:` variants flip
   *  in lockstep with the locale picker. */
  const dir = computed<'ltr' | 'rtl'>(() => (isRtlLocale(locale.value) ? 'rtl' : 'ltr'))

  return { locale, dir, setLocale, init, t, osLocale: osLocaleRef }
}
