<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="add-node-title" class="w-96 rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="add-node-title" class="mb-4 text-lg font-medium">Add Nodes</h2>

        <div class="mb-4">
          <label class="mb-1 block text-xs text-autonomi-muted">Number of nodes</label>
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
          <p class="mt-1 text-xs text-autonomi-muted">Between 1 and 50</p>
        </div>

        <div v-if="!earningsSet" class="mb-4 rounded-md border border-autonomi-warning/30 bg-yellow-950/30 p-3">
          <p class="text-xs text-autonomi-warning">
            No earnings address configured. Set one in the Wallet page before adding nodes.
          </p>
        </div>

        <div class="flex justify-end gap-2">
          <button
            class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
            @click="$emit('close')"
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            :disabled="!valid"
            @click="confirm"
          >
            Add {{ count }} Node{{ count !== 1 ? 's' : '' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useNodesStore } from '~/stores/nodes'
import { useWalletStore } from '~/stores/wallet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const nodesStore = useNodesStore()
const walletStore = useWalletStore()
const inputEl = ref<HTMLInputElement | null>(null)
const count = ref(1)

const earningsSet = computed(() => !!walletStore.earningsAddress)
const valid = computed(() => count.value >= 1 && count.value <= 50)

watch(() => props.open, (val) => {
  if (val) {
    count.value = 1
    nextTick(() => inputEl.value?.focus())
  }
})

function confirm() {
  if (!valid.value) return
  nodesStore.addNodes(count.value)
  emit('close')
}
</script>
