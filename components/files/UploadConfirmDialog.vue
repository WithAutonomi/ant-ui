<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('cancel')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="upload-confirm-title" class="w-[26rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="upload-confirm-title" class="mb-4 text-lg font-medium">Confirm Upload</h2>

        <div v-if="loading" class="flex flex-col items-center py-8">
          <p class="text-sm text-autonomi-muted">Estimating costs...</p>
        </div>

        <div v-else class="space-y-4">
          <!-- File list -->
          <div class="max-h-40 space-y-1.5 overflow-y-auto">
            <div
              v-for="file in files"
              :key="file.name"
              class="flex items-center justify-between text-sm"
            >
              <span class="max-w-[180px] truncate">{{ file.name }}</span>
              <span class="text-autonomi-muted">{{ formatBytes(file.size) }}</span>
            </div>
          </div>

          <!-- Cost breakdown -->
          <div class="rounded-md border border-autonomi-border bg-autonomi-surface/50 p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-autonomi-muted">Storage cost</span>
              <span class="text-autonomi-blue">{{ storageCost }} ANT</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-autonomi-muted">Estimated gas</span>
              <span>{{ gasCost }} ETH</span>
            </div>
            <div class="border-t border-autonomi-border pt-2 flex items-center justify-between text-sm font-medium">
              <span>Total</span>
              <div class="text-right">
                <span class="text-autonomi-blue">{{ storageCost }} ANT</span>
                <span class="mx-1 text-autonomi-muted">+</span>
                <span>{{ gasCost }} ETH</span>
              </div>
            </div>
          </div>

          <p class="text-xs text-autonomi-muted">
            Costs are estimates and may vary based on network conditions.
          </p>

          <div class="flex justify-end gap-2">
            <button
              class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
              @click="$emit('cancel')"
            >
              Cancel
            </button>
            <button
              class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              @click="$emit('confirm')"
            >
              Upload {{ files.length }} file{{ files.length !== 1 ? 's' : '' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  open: boolean
  files: { name: string; size: number; path: string }[]
  loading: boolean
}>()

defineEmits<{
  confirm: []
  cancel: []
}>()

const totalSize = computed(() => props.files.reduce((sum, f) => sum + f.size, 0))

// Mock costs — real implementation queries the network
const storageCost = computed(() => (totalSize.value / 1_048_576 * 0.05).toFixed(4))
const gasCost = computed(() => (props.files.length * 0.0003).toFixed(4))

function formatBytes(bytes?: number) {
  if (!bytes) return '-'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
</script>
