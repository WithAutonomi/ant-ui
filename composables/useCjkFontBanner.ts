import { ref, computed, type ComputedRef } from 'vue'
import { platform } from '@tauri-apps/plugin-os'
import { useI18n } from 'vue-i18n'

// Locales whose script is not in the base Linux font fallback chain and
// therefore renders as tofu/mojibake without a CJK font (noto-cjk).
// noto-cjk is the unified Chinese/Japanese/Korean font — same package
// across distros covers all three scripts. Add 'zh' here when it ships.
const CJK_LOCALES = new Set<string>(['ja', 'ko'])

// Module-scoped: probe once at first call, share the result across all
// component instances that mount the banner.
const isLinux = ref(false)
let platformProbed = false

async function probePlatformOnce(): Promise<void> {
  if (platformProbed) return
  platformProbed = true
  try {
    isLinux.value = (await platform()) === 'linux'
  } catch {
    isLinux.value = false
  }
}

// Bumped by dismiss() to invalidate the shouldShow computed, since
// localStorage reads aren't reactive on their own.
const dismissedVersion = ref(0)

function dismissedKeyFor(loc: string): string {
  return `cjk-font-banner-dismissed-${loc}`
}

function isDismissed(loc: string): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(dismissedKeyFor(loc)) === '1'
}

export function useCjkFontBanner() {
  const { locale } = useI18n()
  probePlatformOnce()

  const shouldShow: ComputedRef<boolean> = computed(() => {
    // Touch the version ref so the computed re-runs after dismiss().
    void dismissedVersion.value
    if (!isLinux.value) return false
    if (!CJK_LOCALES.has(locale.value)) return false
    return !isDismissed(locale.value)
  })

  function dismiss(): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(dismissedKeyFor(locale.value), '1')
    dismissedVersion.value++
  }

  return { shouldShow, dismiss }
}
