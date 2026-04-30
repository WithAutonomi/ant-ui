<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="upload-confirm-title" class="w-[36rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="upload-confirm-title" class="mb-3 text-lg font-medium">Confirm Upload</h2>

        <!-- Info banner: dialog is dismissible, job keeps running -->
        <div class="mb-4 flex items-start gap-2 rounded-md border border-autonomi-blue/30 bg-autonomi-blue/5 px-3 py-2">
          <svg class="mt-0.5 h-4 w-4 shrink-0 text-autonomi-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-xs text-autonomi-muted">
            You can close this window and come back when the quote is in. The upload stays pending until you approve or cancel it.
          </p>
        </div>

        <div class="space-y-5">
          <!-- File list -->
          <div class="max-h-32 space-y-1.5 overflow-y-auto">
            <div
              v-for="entry in entries"
              :key="entry.id"
              class="flex items-center justify-between text-sm"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span class="max-w-[200px] truncate">{{ entry.name }}</span>
                <span
                  v-if="entry.alreadyStored"
                  class="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-green-400"
                >
                  Already stored
                </span>
              </span>
              <span class="text-autonomi-muted">{{ entry.size_bytes ? formatBytes(entry.size_bytes) : '-' }}</span>
            </div>
          </div>

          <!-- Payment mode — only shown once the network has quoted the files.
               Never guessed from chunk count: that was a fallback lie. -->
          <div v-if="effectivePaymentMode" class="flex items-baseline justify-between">
            <span class="text-sm text-autonomi-muted">Payment</span>
            <div class="text-right">
              <span class="text-sm font-medium">{{ effectivePaymentMode === 'merkle' ? 'Merkle tree' : 'Regular' }}</span>
              <p class="text-xs text-autonomi-muted">
                {{ effectivePaymentMode === 'merkle'
                  ? `Single transaction for ${quotedChunks} chunks — lower gas.`
                  : `Per-batch payment for ${quotedChunks} chunk${quotedChunks !== 1 ? 's' : ''}.` }}
              </p>
            </div>
          </div>

          <!-- Cost breakdown. Connection-error takes priority over any in-flight
               quote spinner so users aren't left watching a spinner that will
               never resolve. No heuristic / placeholder values. -->
          <div class="rounded-md border border-autonomi-border bg-autonomi-surface/50 p-3 space-y-2">
            <template v-if="allAlreadyStored">
              <div class="flex items-center gap-2 text-sm font-medium text-green-400">
                <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Already stored on the network — free</span>
              </div>
              <p class="text-xs text-autonomi-muted">
                Every chunk is already present. No ANT or gas will be spent.
              </p>
            </template>
            <template v-else-if="quotedCost">
              <div class="flex items-center justify-between text-sm font-medium">
                <span>Network storage cost</span>
                <span class="text-autonomi-blue">{{ quotedCost }}</span>
              </div>
              <div class="flex items-center justify-between text-xs text-autonomi-muted">
                <span>Estimated gas</span>
                <span>{{ quotedGas ?? '—' }}</span>
              </div>
              <p v-if="someAlreadyStored" class="text-xs text-green-400">
                Some files are already stored — that portion costs nothing.
              </p>
            </template>
            <template v-else-if="connectionStore.hasFailed">
              <div class="space-y-2">
                <div class="text-sm text-yellow-500/80">
                  Not connected to the Autonomi network — cost estimate unavailable.
                </div>
                <div v-if="failedReason" class="text-xs text-autonomi-muted break-words">
                  {{ failedReason }}
                </div>
                <button
                  type="button"
                  class="rounded-md border border-autonomi-blue/40 px-2.5 py-1 text-xs font-medium text-autonomi-blue hover:bg-autonomi-blue/10"
                  @click="connectionStore.retry()"
                >
                  Retry connection
                </button>
              </div>
            </template>
            <template v-else-if="connectionStore.isConnecting">
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
                <span>Connecting to the Autonomi network…</span>
              </div>
            </template>
            <template v-else-if="anyQuoting">
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-autonomi-blue border-t-transparent" />
                <span>Obtaining quote from network…</span>
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

          <p v-if="quotedCost && !allAlreadyStored && effectivePaymentMode === 'regular'" class="text-xs text-autonomi-muted">
            Estimated from a single network quote — final cost may vary slightly. Gas fees apply on top.
          </p>

          <!-- Buttons grouped by intent: both "back out" actions on the left,
               the money-spending Approve isolated on the right so no
               fat-finger can land on it from a dismiss attempt. -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex gap-2">
              <button
                class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
                @click="$emit('close')"
              >
                Close
              </button>
              <button
                class="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
                @click="$emit('cancelUpload')"
              >
                Cancel Upload
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="!canApprove && needsApprovalEntries.length > 1"
                class="text-xs text-autonomi-muted"
              >
                Ready: {{ readyCount }} of {{ needsApprovalEntries.length }}
              </span>
              <button
                class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canApprove"
                @click="handleApprove"
              >
                {{ approveButtonLabel }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { formatBytes } from '~/utils/formatters'
import { useConnectionStore } from '~/stores/connection'
import { useFilesStore, type FileEntry } from '~/stores/files'
import { formatNanoTokens, formatGasCost } from '~/utils/payment'

const props = defineProps<{
  open: boolean
  /** IDs of FileEntry rows this dialog is bound to. Dialog is a thin view —
   *  all quote/estimate state lives on the entries themselves. */
  fileIds: number[]
}>()

const emit = defineEmits<{
  approve: [options: { visibility: 'private' | 'public'; paymentMode: 'regular' | 'merkle' }]
  cancelUpload: []
  close: []
  /**
   * Fired whenever the user flips the Private/Public selector. The parent
   * re-quotes against the network since the prepared payment batch differs
   * — public uploads pay for one extra chunk (the data map itself).
   */
  'visibility-change': [visibility: 'private' | 'public']
}>()

const filesStore = useFilesStore()
const connectionStore = useConnectionStore()

const entries = computed<FileEntry[]>(() =>
  props.fileIds
    .map(id => filesStore.findById(id))
    .filter((e): e is FileEntry => e !== undefined),
)

const allEstimated = computed(() =>
  entries.value.length > 0 && entries.value.every(e => e.estimate),
)
const allAlreadyStored = computed(() =>
  entries.value.length > 0 && entries.value.every(e => e.alreadyStored),
)
const someAlreadyStored = computed(() =>
  entries.value.some(e => e.alreadyStored),
)
const anyQuoting = computed(() =>
  entries.value.some(e => e.status === 'quoting' || e.status === 'queued_for_quote'),
)
/** Entries that still require a user decision — already-stored files auto-
 *  process through the scheduler and never see `awaiting_approval`, so they
 *  don't count toward the approve gate. */
const needsApprovalEntries = computed(() =>
  entries.value.filter(e => !e.alreadyStored),
)
const readyCount = computed(() =>
  needsApprovalEntries.value.filter(e => e.status === 'awaiting_approval').length,
)
/** Approve is gated on every non-stored entry being `awaiting_approval`.
 *  Partial approve would leave some files silently queued and invite
 *  mis-clicks; block until the whole approvable batch is ready. */
const canApprove = computed(() =>
  needsApprovalEntries.value.length > 0
  && readyCount.value === needsApprovalEntries.value.length,
)

/** Sum of estimate costs across entries. Null unless every entry has a real
 *  estimate — partial or fake totals would mislead the user. */
const quotedCost = computed<string | null>(() => {
  if (!allEstimated.value) return null
  const totalAtto = entries.value.reduce(
    (sum, e) => sum + BigInt(e.estimate!.storage_cost_atto), 0n,
  )
  return formatNanoTokens(totalAtto.toString())
})

const quotedGas = computed<string | null>(() => {
  if (!allEstimated.value) return null
  const totalGas = entries.value.reduce(
    (sum, e) => sum + BigInt(e.estimate!.estimated_gas_cost_wei), 0n,
  )
  return formatGasCost(totalGas.toString())
})

/** Real chunk count from the network estimates. Null until all entries have
 *  been quoted — no client-side size-based fallback. */
const quotedChunks = computed<number | null>(() => {
  if (!allEstimated.value) return null
  return entries.value.reduce((sum, e) => sum + e.estimate!.chunk_count, 0)
})

/** Payment mode is reported by the network — we do not guess it from size.
 *  Null until all entries are quoted, so the template can hide the Payment
 *  row entirely instead of showing a misleading prediction. */
const effectivePaymentMode = computed<'regular' | 'merkle' | null>(() => {
  if (!allEstimated.value) return null
  const modes = entries.value.map(e => e.paymentMode).filter(Boolean) as ('regular' | 'merkle')[]
  if (modes.length !== entries.value.length) return null
  return modes.includes('merkle') ? 'merkle' : 'regular'
})

const visibility = ref<'private' | 'public'>('private')

watch(visibility, (val) => {
  emit('visibility-change', val)
})

const approveButtonLabel = computed(() => {
  const n = needsApprovalEntries.value.length
  if (n <= 1) return 'Approve Upload'
  return `Approve ${n} Uploads`
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

function handleApprove() {
  if (!canApprove.value) return
  // Fall back to 'regular' when the estimate failed — backend redetermines
  // the real payment mode from the live quote's chunk count anyway, so the
  // frontend's guess is only used for status display during paying.
  emit('approve', {
    visibility: visibility.value,
    paymentMode: effectivePaymentMode.value ?? 'regular',
  })
}
</script>
