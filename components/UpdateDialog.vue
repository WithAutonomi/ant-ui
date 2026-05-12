<template>
  <Teleport to="body">
    <div
      v-if="updaterStore.showDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        class="w-[420px] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl"
      >
        <!-- Header -->
        <h2 id="update-dialog-title" class="text-lg font-medium">
          {{ $t('updater.dialog.title') }}
        </h2>
        <p class="mt-1 flex items-center gap-2 text-sm text-autonomi-muted">
          <span>{{ $t('updater.dialog.version_ready', { version: updaterStore.version }) }}</span>
          <span
            v-if="updaterStore.isPrerelease"
            class="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-teal-400"
          >
            {{ $t('updater.dialog.pre_release_badge') }}
          </span>
        </p>

        <!-- Download size (shown during download if available) -->
        <p v-if="updaterStore.downloadTotal" class="mt-1 text-xs text-autonomi-muted">
          {{ $t('updater.dialog.download_size', { size: formatBytes(updaterStore.downloadTotal) }) }}
        </p>

        <!-- Release notes -->
        <div
          v-if="!updaterStore.installing"
          class="mt-4 max-h-56 overflow-auto rounded-md bg-autonomi-surface p-3"
        >
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-autonomi-muted">{{ $t('updater.dialog.release_notes') }}</h3>
          <div v-if="updaterStore.body" class="prose-sm text-xs leading-relaxed text-autonomi-text" v-html="renderMarkdown(updaterStore.body)" />
          <p v-else class="text-xs text-autonomi-muted">{{ $t('updater.dialog.no_release_notes') }}</p>
        </div>

        <!-- Download progress -->
        <div v-if="updaterStore.installing" class="mt-4">
          <div class="flex items-center justify-between text-xs text-autonomi-muted">
            <span>{{ downloadComplete ? $t('updater.dialog.download_complete') : $t('updater.dialog.downloading') }}</span>
            <span v-if="!downloadComplete && updaterStore.downloadProgress !== null">{{ updaterStore.downloadProgress }}%</span>
          </div>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-autonomi-surface">
            <div
              class="h-full rounded-full bg-autonomi-blue transition-all duration-300"
              :style="{ width: (updaterStore.downloadProgress ?? 0) + '%' }"
            />
          </div>
          <p v-if="!downloadComplete && updaterStore.downloadTotal" class="mt-1 text-right text-[10px] text-autonomi-muted">
            {{ formatBytes(updaterStore.downloadedBytes) }} / {{ formatBytes(updaterStore.downloadTotal) }}
          </p>
          <p v-if="!downloadComplete" class="mt-2 text-xs text-autonomi-muted">
            {{ $t('updater.dialog.auto_restart_hint') }}
          </p>
        </div>

        <!-- Actions -->
        <div class="mt-5 flex items-center justify-between gap-2">
          <!-- Cancel Download (left) — only shown during install. Disabled
               once download hits 100% because the install step that follows
               is uncancellable (would brick the .app on macOS). -->
          <button
            v-if="updaterStore.installing"
            class="rounded-md border border-autonomi-error/50 px-3 py-1.5 text-sm text-autonomi-error hover:bg-autonomi-error/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            :disabled="downloadComplete"
            :title="downloadComplete ? $t('updater.dialog.installing_tooltip') : undefined"
            @click="cancelDownload"
          >
            {{ $t('updater.dialog.cancel_download') }}
          </button>
          <span v-else />

          <div class="flex justify-end gap-2">
            <button
              v-if="!updaterStore.installing"
              class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
              @click="close"
            >
              {{ $t('updater.dialog.not_now') }}
            </button>
            <button
              v-if="!updaterStore.installing"
              class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              @click="confirm"
            >
              {{ $t('updater.dialog.update_restart') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useUpdaterStore } from '~/stores/updater'
import { formatBytes } from '~/utils/formatters'

const updaterStore = useUpdaterStore()

const downloadComplete = computed(() => updaterStore.downloadProgress === 100)

function close() {
  if (updaterStore.installing) return
  updaterStore.showDialog = false
}

function confirm() {
  updaterStore.installUpdate()
}

function cancelDownload() {
  updaterStore.cancelInstall()
}

function renderMarkdown(text: string): string {
  // Minimal markdown: headers, bold, lists, line breaks
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<p class="font-semibold mt-2 mb-1">$1</p>')
    .replace(/^## (.+)$/gm, '<p class="font-semibold text-sm mt-2 mb-1">$1</p>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li class="ml-3 list-disc">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, '<ul class="space-y-0.5">$&</ul>')
    .replace(/\n{2,}/g, '<br/>')
}

</script>
