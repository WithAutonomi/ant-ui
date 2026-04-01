<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('cancel')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="upload-confirm-title" class="w-[36rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="upload-confirm-title" class="mb-4 text-lg font-medium">Confirm Upload</h2>

        <div v-if="loading" class="flex flex-col items-center py-8">
          <p class="text-sm text-autonomi-muted">Estimating costs...</p>
        </div>

        <div v-else class="space-y-5">
          <!-- File list -->
          <div class="max-h-32 space-y-1.5 overflow-y-auto">
            <div
              v-for="file in files"
              :key="file.name"
              class="flex items-center justify-between text-sm"
            >
              <span class="max-w-[280px] truncate">{{ file.name }}</span>
              <span class="text-autonomi-muted">{{ formatBytes(file.size) }}</span>
            </div>
          </div>

          <!-- Payment mode selector -->
          <div>
            <label class="mb-2 block text-xs font-medium uppercase tracking-wider text-autonomi-muted">Payment Method</label>
            <div class="flex gap-3">
              <!-- Regular -->
              <button
                class="flex-1 rounded-lg border p-3 text-left transition-all"
                :class="paymentMode === 'regular'
                  ? 'border-autonomi-blue bg-autonomi-blue/10'
                  : 'border-autonomi-border hover:border-autonomi-blue/30'"
                @click="paymentMode = 'regular'"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="flex h-4 w-4 items-center justify-center rounded-full border-2"
                    :class="paymentMode === 'regular' ? 'border-autonomi-blue' : 'border-autonomi-muted'"
                  >
                    <div v-if="paymentMode === 'regular'" class="h-2 w-2 rounded-full bg-autonomi-blue" />
                  </div>
                  <span class="text-sm font-medium">Regular</span>
                </div>
                <p class="mt-1.5 pl-6 text-xs text-autonomi-muted">
                  Pays per batch of chunks. Simple and reliable for any file size.
                </p>
              </button>

              <!-- Merkle (disabled) -->
              <button
                disabled
                class="flex-1 cursor-not-allowed rounded-lg border border-autonomi-border p-3 text-left opacity-40"
              >
                <div class="flex items-center gap-2">
                  <div class="flex h-4 w-4 items-center justify-center rounded-full border-2 border-autonomi-muted">
                    <div v-if="paymentMode === 'merkle'" class="h-2 w-2 rounded-full bg-autonomi-blue" />
                  </div>
                  <span class="text-sm font-medium">Merkle Tree</span>
                  <span class="rounded bg-autonomi-surface px-1.5 py-0.5 text-[10px] text-autonomi-muted">Coming soon</span>
                </div>
                <p class="mt-1.5 pl-6 text-xs text-autonomi-muted">
                  Single transaction for all chunks. Lower gas for large uploads.
                </p>
              </button>
            </div>
            <p v-if="recommendsMerkle" class="mt-1.5 text-xs text-autonomi-muted">
              Merkle payments would be more efficient for this upload ({{ estimatedChunks }} chunks).
            </p>
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

          <!-- Visibility selector -->
          <div>
            <label class="mb-2 block text-xs font-medium uppercase tracking-wider text-autonomi-muted">Visibility</label>
            <div class="flex gap-3">
              <!-- Private (default) -->
              <button
                class="flex-1 rounded-lg border p-3 text-left transition-all"
                :class="visibility === 'private'
                  ? 'border-autonomi-blue bg-autonomi-blue/10'
                  : 'border-autonomi-border hover:border-autonomi-blue/30'"
                @click="visibility = 'private'"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="flex h-4 w-4 items-center justify-center rounded-full border-2"
                    :class="visibility === 'private' ? 'border-autonomi-blue' : 'border-autonomi-muted'"
                  >
                    <div v-if="visibility === 'private'" class="h-2 w-2 rounded-full bg-autonomi-blue" />
                  </div>
                  <span class="text-sm font-medium">Private</span>
                </div>
                <p class="mt-1.5 pl-6 text-xs text-autonomi-muted">
                  Encrypted and only accessible with your data map. Only you can retrieve the file.
                </p>
              </button>

              <!-- Public -->
              <button
                class="flex-1 rounded-lg border p-3 text-left transition-all"
                :class="visibility === 'public'
                  ? 'border-autonomi-blue bg-autonomi-blue/10'
                  : 'border-autonomi-border hover:border-autonomi-blue/30'"
                @click="visibility = 'public'"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="flex h-4 w-4 items-center justify-center rounded-full border-2"
                    :class="visibility === 'public' ? 'border-autonomi-blue' : 'border-autonomi-muted'"
                  >
                    <div v-if="visibility === 'public'" class="h-2 w-2 rounded-full bg-autonomi-blue" />
                  </div>
                  <span class="text-sm font-medium">Public</span>
                </div>
                <p class="mt-1.5 pl-6 text-xs text-autonomi-warning">
                  Not encrypted. Anyone on the network can access this file with its address.
                </p>
              </button>
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
              @click="handleConfirm"
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
const MERKLE_THRESHOLD = 64
const AVG_CHUNK_SIZE = 262_144 // 256 KB — self-encryption default chunk size

const props = defineProps<{
  open: boolean
  files: { name: string; size: number; path: string }[]
  loading: boolean
}>()

const emit = defineEmits<{
  confirm: [options: { visibility: 'private' | 'public'; paymentMode: 'regular' | 'merkle' }]
  cancel: []
}>()

const visibility = ref<'private' | 'public'>('private')
const paymentMode = ref<'regular' | 'merkle'>('regular')

const totalSize = computed(() => props.files.reduce((sum, f) => sum + f.size, 0))
const estimatedChunks = computed(() => Math.max(1, Math.ceil(totalSize.value / AVG_CHUNK_SIZE)))
const recommendsMerkle = computed(() => estimatedChunks.value >= MERKLE_THRESHOLD)

// Auto-select payment mode based on file size (but merkle is disabled for now)
watch(
  () => props.open,
  (val) => {
    if (val) {
      visibility.value = 'private'
      // Would default to merkle for large uploads once enabled
      paymentMode.value = 'regular'
    }
  },
)

// Mock costs — real implementation queries the network and updates when payment mode changes
const storageCost = computed(() => (totalSize.value / 1_048_576 * 0.05).toFixed(4))
const gasCost = computed(() => {
  if (paymentMode.value === 'merkle') {
    // Merkle: single tx regardless of chunk count
    return (0.0005).toFixed(4)
  }
  // Regular: one tx per wave of 64 chunks
  const waves = Math.ceil(estimatedChunks.value / 64)
  return (waves * 0.0003).toFixed(4)
})

function handleConfirm() {
  emit('confirm', {
    visibility: visibility.value,
    paymentMode: paymentMode.value,
  })
}

function formatBytes(bytes?: number) {
  if (!bytes) return '-'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
</script>
