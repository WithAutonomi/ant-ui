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
              <span class="text-autonomi-muted">{{ file.size ? formatBytes(file.size) : '-' }}</span>
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
            <template v-if="quotedCost">
              <div class="flex items-center justify-between text-sm font-medium">
                <span>Network storage cost</span>
                <span class="text-autonomi-blue">{{ quotedCost }}</span>
              </div>
            </template>
            <template v-else-if="quoting">
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-autonomi-blue border-t-transparent" />
                <span>Getting cost quote from network...</span>
              </div>
            </template>
            <template v-else>
              <div class="text-sm text-autonomi-muted">
                Real cost will be quoted from the network after confirmation.
              </div>
            </template>
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

          <p v-if="quotedCost" class="text-xs text-autonomi-muted">
            Cost quoted from the Autonomi network. Gas fees apply on top.
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
import { formatBytes } from '~/utils/formatters'
import { MERKLE_THRESHOLD, AVG_CHUNK_SIZE } from '~/utils/constants'

const props = defineProps<{
  open: boolean
  files: { name: string; size: number; path: string }[]
  loading: boolean
  /** Real cost from network quote (e.g. "0.0234 ANT") */
  quotedCost?: string | null
  /** Whether a network quote is in progress */
  quoting?: boolean
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

function handleConfirm() {
  emit('confirm', {
    visibility: visibility.value,
    paymentMode: paymentMode.value,
  })
}

</script>
