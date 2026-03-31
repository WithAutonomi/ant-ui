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
          Update Available
        </h2>
        <p class="mt-1 text-sm text-autonomi-muted">
          v{{ updaterStore.version }} is ready to install
        </p>

        <!-- Download size (shown during download if available) -->
        <p v-if="updaterStore.downloadTotal" class="mt-1 text-xs text-autonomi-muted">
          Download size: {{ formatBytes(updaterStore.downloadTotal) }}
        </p>

        <!-- Release notes -->
        <div
          v-if="!updaterStore.installing"
          class="mt-4 max-h-56 overflow-auto rounded-md bg-autonomi-surface p-3"
        >
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-autonomi-muted">Release Notes</h3>
          <div v-if="updaterStore.body" class="prose-sm text-xs leading-relaxed text-autonomi-text" v-html="renderMarkdown(updaterStore.body)" />
          <p v-else class="text-xs text-autonomi-muted">No release notes available for this version.</p>
        </div>

        <!-- Download progress -->
        <div v-if="updaterStore.installing" class="mt-4">
          <div class="flex items-center justify-between text-xs text-autonomi-muted">
            <span>Downloading...</span>
            <span v-if="updaterStore.downloadProgress !== null">{{ updaterStore.downloadProgress }}%</span>
          </div>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-autonomi-surface">
            <div
              class="h-full rounded-full bg-autonomi-blue transition-all duration-300"
              :style="{ width: (updaterStore.downloadProgress ?? 0) + '%' }"
            />
          </div>
          <p v-if="updaterStore.downloadTotal" class="mt-1 text-right text-[10px] text-autonomi-muted">
            {{ formatBytes(updaterStore.downloadedBytes) }} / {{ formatBytes(updaterStore.downloadTotal) }}
          </p>
          <p class="mt-2 text-xs text-autonomi-muted">
            The app will restart automatically when complete.
          </p>
        </div>

        <!-- Actions -->
        <div class="mt-5 flex justify-end gap-2">
          <button
            v-if="!updaterStore.installing"
            class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
            @click="close"
          >
            Not Now
          </button>
          <button
            v-if="!updaterStore.installing"
            class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            @click="confirm"
          >
            Update &amp; Restart
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useUpdaterStore } from '~/stores/updater'

const updaterStore = useUpdaterStore()

function close() {
  if (updaterStore.installing) return
  updaterStore.showDialog = false
}

function confirm() {
  updaterStore.installUpdate()
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

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
</script>
