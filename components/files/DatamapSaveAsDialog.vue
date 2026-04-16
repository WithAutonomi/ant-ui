<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="datamap-saveas-title" class="w-[26rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="datamap-saveas-title" class="mb-4 text-lg font-medium">Save downloaded file as</h2>

        <div class="mb-4">
          <label class="mb-1 block text-xs text-autonomi-muted">Filename</label>
          <input
            ref="inputEl"
            v-model="filename"
            type="text"
            placeholder="myfile.dat"
            class="w-full rounded-md border border-autonomi-border bg-autonomi-surface px-3 py-2 text-sm text-autonomi-text focus:border-autonomi-blue focus:outline-none"
            @keyup.enter="confirm"
            @keyup.escape="$emit('close')"
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
const props = defineProps<{
  open: boolean
  defaultName: string
}>()

const emit = defineEmits<{
  close: []
  confirm: [filename: string]
}>()

const inputEl = ref<HTMLInputElement | null>(null)
const filename = ref('')

const valid = computed(() => filename.value.trim().length > 0)

watch(() => props.open, (val) => {
  if (val) {
    filename.value = props.defaultName
    nextTick(() => {
      inputEl.value?.focus()
      inputEl.value?.select()
    })
  }
})

function confirm() {
  if (!valid.value) return
  emit('confirm', filename.value.trim())
}
</script>
