<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="add-node-title" class="w-96 rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="add-node-title" class="mb-4 text-lg font-medium">{{ $t('nodes.add_dialog.title') }}</h2>

        <div class="mb-4">
          <label class="mb-1 block text-xs text-autonomi-muted">{{ $t('nodes.add_dialog.number_label') }}</label>
          <input
            ref="inputEl"
            v-model.number="count"
            type="number"
            min="1"
            max="50"
            class="w-full rounded-md border border-autonomi-border bg-autonomi-surface px-3 py-2 text-sm text-autonomi-text focus:border-autonomi-blue focus:outline-none"
            @keyup.enter="confirm"
            @keyup.escape="$emit('close')"
          />
          <p class="mt-1 text-xs text-autonomi-muted">{{ $t('nodes.add_dialog.range_hint') }}</p>
        </div>

        <div class="mb-4 rounded-md border border-autonomi-blue/30 bg-autonomi-blue/5 p-3">
          <p class="text-xs text-autonomi-muted">
            {{ $t('nodes.add_dialog.min_size_info') }}
          </p>
        </div>

        <div v-if="!earningsSet" class="mb-4 rounded-md border border-autonomi-warning/30 bg-yellow-950/30 p-3">
          <p class="text-xs text-autonomi-warning">
            {{ $t('nodes.add_dialog.no_earnings_warning') }}
          </p>
        </div>

        <div v-if="belowMinimum" class="mb-4 rounded-md border border-autonomi-warning/30 bg-yellow-950/30 p-3">
          <p class="text-xs text-autonomi-warning">
            {{ $t('nodes.add_dialog.below_minimum_warning', {
              available: formatBytes(availableBytes),
              required: formatBytes(requiredBytes),
              count,
            }) }}
          </p>
        </div>

        <div class="flex justify-end gap-2">
          <button
            class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
            @click="$emit('close')"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            :disabled="!valid"
            @click="confirm"
          >
            {{ count === 1 ? $t('nodes.add_dialog.submit_one') : $t('nodes.add_dialog.submit_many', { count }) }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useNodesStore } from '~/stores/nodes'
import { useWalletStore } from '~/stores/wallet'
import { MIN_NODE_SIZE_BYTES } from '~/utils/constants'
import { formatBytes } from '~/utils/formatters'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const nodesStore = useNodesStore()
const walletStore = useWalletStore()
const inputEl = ref<HTMLInputElement | null>(null)
const count = ref(1)

const earningsSet = computed(() => !!walletStore.earningsAddress)
const valid = computed(() => count.value >= 1 && count.value <= 50)

// Warn (but don't block) when the drive doesn't have enough free space for the
// nodes being added to each meet the recommended minimum — starting them below
// it risks the network shunning them for being full.
const availableBytes = computed(() => nodesStore.driveAvailableBytes)
const requiredBytes = computed(() => Math.max(count.value, 0) * MIN_NODE_SIZE_BYTES)
const belowMinimum = computed(
  () => availableBytes.value > 0 && requiredBytes.value > 0 && availableBytes.value < requiredBytes.value,
)

watch(() => props.open, (val) => {
  if (val) {
    count.value = 1
    nextTick(() => inputEl.value?.focus())
    // Refresh capacity so the warning reflects current free space, not a stale
    // value from the last slow poll (or 0 before the first fetch).
    nodesStore.refreshDriveSpace()
  }
})

function confirm() {
  if (!valid.value) return
  nodesStore.addNodes(count.value)
  emit('close')
}
</script>
