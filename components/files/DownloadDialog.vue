<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="download-title" class="w-[28rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="download-title" class="mb-4 text-lg font-medium">{{ $t('files.download_dialog.title') }}</h2>

        <div class="mb-4">
          <label class="mb-1 block text-xs text-autonomi-muted">{{ $t('files.download_dialog.address_label') }}</label>
          <input
            ref="inputEl"
            v-model="address"
            type="text"
            :placeholder="$t('files.download_dialog.address_placeholder')"
            class="w-full rounded-md border border-autonomi-border bg-autonomi-surface px-3 py-2 font-mono text-sm text-autonomi-text focus:border-autonomi-blue focus:outline-none"
            @keyup.enter="confirm"
            @keyup.escape="$emit('close')"
          />
        </div>

        <div class="mb-4">
          <label class="mb-1 block text-xs text-autonomi-muted">{{ $t('files.download_dialog.filename_label') }}</label>
          <input
            v-model="filename"
            type="text"
            :placeholder="$t('files.download_dialog.filename_placeholder')"
            :class="[
              'w-full rounded-md border bg-autonomi-surface px-3 py-2 text-sm text-autonomi-text focus:outline-none',
              filenameError ? 'border-red-500 focus:border-red-500' : 'border-autonomi-border focus:border-autonomi-blue',
            ]"
            @input="onFilenameInput"
            @keyup.enter="confirm"
          />
          <p v-if="filenameError" class="mt-1 text-xs text-red-400">{{ $t(filenameError) }}</p>
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
            {{ $t('common.download') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useFilesStore } from '~/stores/files'
import { filenameError as checkFilename } from '~/utils/validators'

const props = defineProps<{
  open: boolean
  /** When the dialog is opened via a deep link, the address arrives prefilled.
   *  Empty/undefined for the manual "Download by address" button. */
  prefillAddress?: string
  /** Optional filename prefill from the deep link's `?name=`. */
  prefillFilename?: string
}>()
const emit = defineEmits<{
  close: []
  download: [address: string, filename: string]
}>()

const filesStore = useFilesStore()

const inputEl = ref<HTMLInputElement | null>(null)
const address = ref('')
const filename = ref('')
/** Tracks whether the user has edited the filename since the last prefill,
 *  so a subsequent address change doesn't clobber their typing. */
const filenameDirty = ref(false)

const filenameError = computed(() => checkFilename(filename.value))

const valid = computed(() => {
  const addr = address.value.trim()
  const isHex = /^(0x)?[0-9a-fA-F]{8,}$/.test(addr)
  return isHex && filename.value.trim().length > 0 && filenameError.value === null
})

/** Prior upload that matches the currently-typed address, if any. Drives
 *  both the filename prefill and the extension-append fallback on submit. */
const matchedEntry = computed(() => {
  const addr = address.value.trim()
  if (!/^(0x)?[0-9a-fA-F]{8,}$/.test(addr)) return undefined
  return filesStore.findUploadByAddress(addr)
})

// `immediate` so the prefill applies even when the dialog mounts already-open
// (deep-link first-attempt: the Files page navigates in with the dialog open
// from the start, so there's no false→true transition to catch). Also watch
// `prefillAddress` so a deep link arriving while the dialog is already open
// refreshes the fields.
watch(
  [() => props.open, () => props.prefillAddress],
  ([val]) => {
    if (!val) return
    address.value = props.prefillAddress ?? ''
    filename.value = props.prefillFilename ?? ''
    // Treat a deep-link-provided name as user-set so the history-match
    // auto-prefill doesn't clobber it.
    filenameDirty.value = !!props.prefillFilename
    nextTick(() => inputEl.value?.focus())
  },
  { immediate: true },
)

watch(matchedEntry, (match) => {
  if (!match) return
  if (filenameDirty.value) return
  filename.value = match.name
})

function onFilenameInput() {
  filenameDirty.value = true
}

function confirm() {
  if (!valid.value) return
  const typed = filename.value.trim()
  const final = appendExtensionIfNeeded(typed, matchedEntry.value?.name)
  emit('download', address.value.trim(), final)
  emit('close')
}

/** If the user typed a filename without an extension and we know the
 *  original extension from a history match, append it silently. Keeps
 *  "screenshot" → "screenshot.png" without nagging, while leaving
 *  deliberate unextensioned names alone when there's no match to copy from. */
function appendExtensionIfNeeded(typed: string, originalName?: string): string {
  if (!originalName) return typed
  if (hasExtension(typed)) return typed
  const origExt = extensionOf(originalName)
  if (!origExt) return typed
  return `${typed}.${origExt}`
}

function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot + 1)
}
</script>
