<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="cost-estimate-title" class="w-96 rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="cost-estimate-title" class="mb-4 text-lg font-medium">Upload Cost Estimate</h2>

        <div v-if="loading" class="flex flex-col items-center py-6">
          <p class="text-sm text-autonomi-muted">Estimating cost...</p>
        </div>

        <div v-else-if="files.length > 0" class="space-y-3">
          <div
            v-for="file in files"
            :key="file.name"
            class="flex items-center justify-between text-sm"
          >
            <span class="max-w-[200px] truncate">{{ file.name }}</span>
            <div class="text-right">
              <span v-if="file.size" class="text-autonomi-muted">{{ formatBytes(file.size) }}</span>
              <span class="ml-2 text-autonomi-blue">
                {{ file.cost ? file.cost : `~${estimateCost(file.size)} ANT` }}
              </span>
            </div>
          </div>

          <div v-if="!hasRealCosts" class="border-t border-autonomi-border pt-3">
            <div class="flex items-center justify-between text-sm font-medium">
              <span>Total</span>
              <div>
                <span class="text-autonomi-muted">{{ formatBytes(totalSize) }}</span>
                <span class="ml-2 text-autonomi-blue">~{{ estimateCost(totalSize) }} ANT</span>
              </div>
            </div>
          </div>

          <p class="text-xs text-autonomi-muted">
            {{ hasRealCosts ? 'Costs queried from the Autonomi network.' : 'Estimates are approximate and may vary based on network conditions.' }}
          </p>
        </div>

        <div v-else class="py-4 text-center text-sm text-autonomi-muted">
          No files selected
        </div>

        <div class="mt-4 flex justify-end">
          <button
            class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
            @click="$emit('close')"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  open: boolean
  files: { name: string; size: number; cost?: string }[]
  loading: boolean
}>()

defineEmits<{ close: [] }>()

const totalSize = computed(() => props.files.reduce((sum, f) => sum + f.size, 0))
const hasRealCosts = computed(() => props.files.some(f => f.cost))

function estimateCost(bytes: number) {
  return (bytes / 1_048_576 * 0.05).toFixed(4)
}

function formatBytes(bytes?: number) {
  if (!bytes) return '-'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
</script>
