<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="datamap-download-title" class="w-[32rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="datamap-download-title" class="mb-1 text-lg font-medium">Download by Datamap</h2>
        <p class="mb-4 text-xs text-autonomi-muted">
          Pick a previous upload to re-download, or browse for a datamap file you received from elsewhere.
        </p>

        <div v-if="candidates.length" class="mb-4 max-h-72 overflow-y-auto rounded-md border border-autonomi-border">
          <ul class="divide-y divide-autonomi-border">
            <li
              v-for="c in candidates"
              :key="c.data_map_file"
              class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-autonomi-surface/70"
              @click="select(c.data_map_file, c.name)"
            >
              <div class="min-w-0">
                <div class="truncate text-autonomi-text">{{ c.name }}</div>
                <div class="truncate font-mono text-[11px] text-autonomi-muted">
                  {{ basename(c.data_map_file) }}
                </div>
              </div>
              <div class="ml-3 shrink-0 text-right text-[11px] text-autonomi-muted">
                <div>{{ c.size_bytes ? formatBytes(c.size_bytes) : '-' }}</div>
                <div>{{ formatShortDate(c.date) }}</div>
              </div>
            </li>
          </ul>
        </div>
        <div v-else class="mb-4 rounded-md border border-dashed border-autonomi-border px-3 py-6 text-center text-xs text-autonomi-muted">
          No previous uploads with a saved datamap yet.
        </div>

        <div class="flex items-center justify-between gap-2">
          <button
            class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
            @click="$emit('browse')"
          >
            Browse for datamap file…
          </button>
          <button
            class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
            @click="$emit('close')"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { formatBytes } from '~/utils/formatters'

defineProps<{
  open: boolean
  candidates: Array<{
    name: string
    data_map_file: string
    date: string
    size_bytes: number
  }>
}>()

const emit = defineEmits<{
  close: []
  browse: []
  select: [dataMapPath: string, suggestedName: string]
}>()

function select(path: string, suggestedName: string) {
  emit('select', path, suggestedName)
  emit('close')
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
</script>
