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

          <!-- Payment mode -->
          <div class="flex items-baseline justify-between">
            <span class="text-sm text-autonomi-muted">Payment</span>
            <div class="text-right">
              <span class="text-sm font-medium">{{ effectivePaymentMode === 'merkle' ? 'Merkle tree' : 'Regular' }}</span>
              <p class="text-xs text-autonomi-muted">
                {{ effectivePaymentMode === 'merkle'
                  ? `Single transaction for ${estimatedChunks} chunks — lower gas.`
                  : `Per-batch payment for ${estimatedChunks} chunk${estimatedChunks !== 1 ? 's' : ''}.` }}
              </p>
            </div>
          </div>

          <!-- Cost breakdown -->
          <div class="rounded-md border border-autonomi-border bg-autonomi-surface/50 p-3 space-y-2">
            <template v-if="quotedCost">
              <div class="flex items-center justify-between text-sm font-medium">
                <span>Network storage cost</span>
                <span class="text-autonomi-blue">{{ quotedCost }}</span>
              </div>
              <div class="flex items-center justify-between text-xs text-autonomi-muted">
                <span>Estimated gas</span>
                <span>{{ quotedGas ?? 'Estimating...' }}</span>
              </div>
            </template>
            <template v-else-if="quoting">
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-autonomi-blue border-t-transparent" />
                <span>Getting cost quote from network...</span>
              </div>
            </template>
            <template v-else-if="connectionStore.isConnecting">
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
                <span>Connecting to the Autonomi network...</span>
              </div>
            </template>
            <template v-else-if="connectionStore.hasFailed">
              <div class="space-y-2">
                <div class="text-sm text-yellow-500/80">
                  Could not connect to the Autonomi network.
                </div>
                <div v-if="failedReason" class="text-xs text-autonomi-muted break-words">
                  {{ failedReason }}
                </div>
                <button
                  type="button"
                  class="rounded-md border border-autonomi-blue/40 px-2.5 py-1 text-xs font-medium text-autonomi-blue hover:bg-autonomi-blue/10"
                  @click="connectionStore.retry()"
                >
                  Retry
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-autonomi-blue border-t-transparent" />
                <span>Preparing cost quote...</span>
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
                type="button"
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
                <p class="mt-1.5 pl-6 text-xs text-autonomi-muted">
                  Data map is published to the network. Share a single address so anyone can retrieve the file.
                </p>
              </button>
            </div>
          </div>

          <p v-if="quotedCost && effectivePaymentMode === 'regular'" class="text-xs text-autonomi-muted">
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
import { useConnectionStore } from '~/stores/connection'

const props = defineProps<{
  open: boolean
  files: { name: string; size: number; path: string }[]
  loading: boolean
  /** Real cost from network quote (e.g. "0.0234 ANT" or "Determined on-chain") */
  quotedCost?: string | null
  /** Estimated gas cost (e.g. "0.000142 ETH") */
  quotedGas?: string | null
  /** Whether a network quote is in progress */
  quoting?: boolean
  /** Payment mode selected by the backend (null if no quote yet) */
  quotedPaymentMode?: 'wave-batch' | 'merkle' | null
  /**
   * Kept for backward compatibility with the parent — the dialog now reads
   * the connection state directly from useConnectionStore() so it can show
   * a Retry button when the connect fails.
   */
  networkConnected?: boolean
}>()

const emit = defineEmits<{
  confirm: [options: { visibility: 'private' | 'public'; paymentMode: 'regular' | 'merkle' }]
  cancel: []
  /**
   * Fired whenever the user flips the Private/Public selector. The parent
   * re-quotes against the network since the prepared payment batch differs
   * — public uploads pay for one extra chunk (the data map itself).
   */
  'visibility-change': [visibility: 'private' | 'public']
}>()

const connectionStore = useConnectionStore()

const visibility = ref<'private' | 'public'>('private')

watch(visibility, (val) => {
  emit('visibility-change', val)
})

const totalSize = computed(() => props.files.reduce((sum, f) => sum + f.size, 0))
const estimatedChunks = computed(() => Math.max(1, Math.ceil(totalSize.value / AVG_CHUNK_SIZE)))

/** Payment mode — determined by backend quote, or estimated from file size */
const effectivePaymentMode = computed(() => {
  if (props.quotedPaymentMode === 'merkle') return 'merkle'
  if (props.quotedPaymentMode === 'wave-batch') return 'regular'
  return estimatedChunks.value >= MERKLE_THRESHOLD ? 'merkle' : 'regular'
})

const failedReason = computed(() =>
  connectionStore.current.status === 'failed' ? connectionStore.current.reason : null,
)

watch(
  () => props.open,
  (val) => {
    if (val) {
      visibility.value = 'private'
    }
  },
)

function handleConfirm() {
  emit('confirm', {
    visibility: visibility.value,
    paymentMode: effectivePaymentMode.value,
  })
}

</script>
