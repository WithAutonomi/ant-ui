<template>
  <div
    v-if="shouldShow"
    class="border-b border-autonomi-blue/40 bg-autonomi-blue/10 px-6 py-3 text-xs text-autonomi-text"
    role="status"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <p class="font-medium">
          <span class="mr-1">{{ scriptLabel }} /</span>
          <span>{{ $t('banners.cjk_font_missing.message') }}</span>
        </p>
        <div class="mt-2 space-y-1">
          <div
            v-for="row in distroRows"
            :key="row.id"
            class="flex items-center gap-3"
          >
            <span class="w-28 shrink-0 text-autonomi-muted">{{ row.label }}</span>
            <code class="min-w-0 flex-1 truncate font-mono text-[11px] text-autonomi-text">{{ row.cmd }}</code>
            <button
              type="button"
              class="rounded p-0.5 text-autonomi-muted/60 hover:bg-autonomi-surface hover:text-autonomi-blue"
              :title="$t('banners.cjk_font_missing.copy')"
              :aria-label="$t('banners.cjk_font_missing.copy')"
              @click="copyCommand(row.cmd)"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
                <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="shrink-0 rounded px-1.5 py-0.5 text-autonomi-muted hover:bg-autonomi-surface hover:text-autonomi-text"
        :title="$t('banners.cjk_font_missing.dismiss')"
        :aria-label="$t('banners.cjk_font_missing.dismiss')"
        @click="dismiss"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCjkFontBanner } from '~/composables/useCjkFontBanner'
import { useToastStore } from '~/stores/toasts'

const { t } = useI18n()
const { shouldShow, dismiss } = useCjkFontBanner()
const toastStore = useToastStore()

const scriptLabel = computed(() => t('banners.cjk_font_missing.script_label'))

interface DistroRow {
  id: string
  label: string
  cmd: string
}

const distroRows = computed<DistroRow[]>(() => [
  { id: 'arch', label: t('banners.cjk_font_missing.distro_arch'), cmd: 'sudo pacman -S noto-fonts-cjk' },
  { id: 'debian', label: t('banners.cjk_font_missing.distro_debian'), cmd: 'sudo apt install fonts-noto-cjk' },
  { id: 'fedora', label: t('banners.cjk_font_missing.distro_fedora'), cmd: 'sudo dnf install google-noto-sans-cjk-fonts' },
])

function copyCommand(cmd: string) {
  navigator.clipboard.writeText(cmd)
  toastStore.add(t('banners.cjk_font_missing.copied'), 'info')
}
</script>
