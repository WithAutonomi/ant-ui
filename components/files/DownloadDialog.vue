<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="download-title" class="w-[32rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="download-title" class="mb-1 text-lg font-medium">{{ $t('files.download_dialog.title') }}</h2>
        <p class="mb-4 text-xs text-autonomi-muted">{{ $t('files.download_dialog.subtitle') }}</p>

        <!-- Smart input -->
        <div class="mb-1">
          <input
            ref="inputEl"
            v-model="input"
            type="text"
            :placeholder="$t('files.download_dialog.address_placeholder')"
            class="w-full rounded-md border border-autonomi-border bg-autonomi-surface px-3 py-2 font-mono text-sm text-autonomi-text placeholder-autonomi-muted placeholder:opacity-70 focus:border-autonomi-blue focus:outline-none"
            @keyup.enter="confirm"
            @keyup.escape="$emit('close')"
          />
        </div>

        <!-- Accepted-input hints. The active kind is highlighted so the user
             sees what the app detected from what they entered/dropped. -->
        <p class="mb-1 mt-2 text-[11px] text-autonomi-muted">{{ $t('files.download_dialog.paste_intro') }}</p>
        <ul class="mb-3 space-y-0.5 text-[11px] text-autonomi-muted">
          <li :class="detectedKind === 'address' && !isLink ? 'text-autonomi-blue' : ''">• {{ $t('files.download_dialog.accept_address') }}</li>
          <li :class="isLink ? 'text-autonomi-blue' : ''">• {{ $t('files.download_dialog.accept_link') }}</li>
          <li :class="detectedKind === 'datamap' || detectedKind === 'url' ? 'text-autonomi-blue' : ''">• {{ $t('files.download_dialog.accept_datamap') }}</li>
        </ul>

        <!-- Drop zone for a .datamap file -->
        <button
          type="button"
          class="mb-4 flex w-full flex-col items-center justify-center rounded-md border border-dashed px-3 py-4 text-center text-xs transition-colors"
          :class="dragActive
            ? 'border-autonomi-blue bg-autonomi-blue/10 text-autonomi-blue'
            : 'border-autonomi-border text-autonomi-muted hover:border-autonomi-blue/60 hover:text-autonomi-text'"
          @click="$emit('browse')"
        >
          <svg class="mb-1 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {{ $t('files.download_dialog.drop_datamap') }}
        </button>

        <!-- Save-as -->
        <div class="mb-4">
          <label class="mb-1 block text-xs text-autonomi-muted">{{ $t('files.download_dialog.filename_label') }}</label>
          <input
            v-model="filename"
            type="text"
            :placeholder="$t('files.download_dialog.filename_placeholder')"
            :class="[
              'w-full rounded-md border bg-autonomi-surface px-3 py-2 text-sm text-autonomi-text placeholder-autonomi-muted placeholder:opacity-70 focus:outline-none',
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
import { filenameError as checkFilename, classifyDownloadInput } from '~/utils/validators'

const props = defineProps<{
  open: boolean
  /** Prefill for the smart input — set from a deep link, a dropped datamap
   *  path, or the Browse picker. Empty for the plain "Download" button. */
  prefillAddress?: string
  /** Optional filename prefill (deep link `?name=`). */
  prefillFilename?: string
  /** True while a file is being dragged over the window and this dialog is
   *  open — highlights the drop zone. */
  dragActive?: boolean
}>()
const emit = defineEmits<{
  close: []
  browse: []
  download: [target: { kind: 'address' | 'datamap' | 'url'; value: string; filename: string }]
}>()

const filesStore = useFilesStore()

const inputEl = ref<HTMLInputElement | null>(null)
const input = ref('')
const filename = ref('')
/** True once the user edits the filename, so auto-fill won't clobber it. */
const filenameDirty = ref(false)

const filenameError = computed(() => checkFilename(filename.value))

/** What the current input resolves to — an address, a datamap path, or nothing. */
const target = computed(() => classifyDownloadInput(input.value))
const detectedKind = computed(() => target.value.kind)
const isLink = computed(() => /^autonomi:/i.test(input.value.trim()))

const valid = computed(() =>
  target.value.kind !== 'invalid'
  && filename.value.trim().length > 0
  && filenameError.value === null,
)

/** Prior upload matching an address input — supplies its real name (with
 *  extension) for the filename prefill and the extension-append fallback. */
const matchedEntry = computed(() => {
  if (target.value.kind !== 'address') return undefined
  return filesStore.findUploadByAddress(target.value.address)
})

/** Best filename we can suggest from the current input, if any. A local upload
 *  match wins (authoritative name); otherwise the link/datamap-derived name. */
const suggestedName = computed<string | undefined>(() => {
  const t = target.value
  if (t.kind === 'address') return matchedEntry.value?.name ?? t.name
  if (t.kind === 'datamap' || t.kind === 'url') return t.name
  return undefined
})

watch(suggestedName, (name) => {
  if (!name || filenameDirty.value) return
  filename.value = name
})

// `immediate` so a prefill applies even when the dialog mounts already-open,
// and re-applies when a new prefill (drop / browse / deep link) arrives while
// it's open.
watch(
  [() => props.open, () => props.prefillAddress],
  ([openNow]) => {
    if (!openNow) return
    input.value = props.prefillAddress ?? ''
    filename.value = props.prefillFilename ?? ''
    filenameDirty.value = !!props.prefillFilename
    nextTick(() => inputEl.value?.focus())
  },
  { immediate: true },
)

function onFilenameInput() {
  filenameDirty.value = true
}

function confirm() {
  if (!valid.value) return
  const t = target.value
  if (t.kind === 'invalid') return
  const typed = filename.value.trim()
  if (t.kind === 'datamap') {
    emit('download', { kind: 'datamap', value: t.path, filename: appendExtensionIfNeeded(typed, t.name) })
  } else if (t.kind === 'url') {
    emit('download', { kind: 'url', value: t.url, filename: appendExtensionIfNeeded(typed, t.name) })
  } else {
    emit('download', { kind: 'address', value: t.address, filename: appendExtensionIfNeeded(typed, matchedEntry.value?.name ?? t.name) })
  }
  emit('close')
}

/** If the user typed a name without an extension and we know the original from
 *  a match/link/datamap, append it silently (e.g. "photo" → "photo.png"). */
function appendExtensionIfNeeded(typed: string, originalName?: string): string {
  if (!originalName || hasExtension(typed)) return typed
  const ext = extensionOf(originalName)
  return ext ? `${typed}.${ext}` : typed
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
