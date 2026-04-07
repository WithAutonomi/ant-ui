<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="download-title" class="w-[28rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="download-title" class="mb-4 text-lg font-medium">Download File</h2>

        <div class="mb-4">
          <label class="mb-1 block text-xs text-autonomi-muted">File address</label>
          <input
            ref="inputEl"
            v-model="address"
            type="text"
            placeholder="File address (hex)"
            class="w-full rounded-md border border-autonomi-border bg-autonomi-surface px-3 py-2 font-mono text-sm text-autonomi-text focus:border-autonomi-blue focus:outline-none"
            @keyup.enter="confirm"
            @keyup.escape="$emit('close')"
          />
        </div>

        <div class="mb-4">
          <label class="mb-1 block text-xs text-autonomi-muted">Save as filename</label>
          <input
            v-model="filename"
            type="text"
            placeholder="myfile.dat"
            class="w-full rounded-md border border-autonomi-border bg-autonomi-surface px-3 py-2 text-sm text-autonomi-text focus:border-autonomi-blue focus:outline-none"
            @keyup.enter="confirm"
          />
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
            Download
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  download: [address: string, filename: string]
}>()

const inputEl = ref<HTMLInputElement | null>(null)
const address = ref('')
const filename = ref('')

const valid = computed(() => {
  const addr = address.value.trim()
  const isHex = /^(0x)?[0-9a-fA-F]{8,}$/.test(addr)
  return isHex && filename.value.trim().length > 0
})

watch(() => props.open, (val) => {
  if (val) {
    address.value = ''
    filename.value = ''
    nextTick(() => inputEl.value?.focus())
  }
})

function confirm() {
  if (!valid.value) return
  emit('download', address.value.trim(), filename.value.trim())
  emit('close')
}
</script>
