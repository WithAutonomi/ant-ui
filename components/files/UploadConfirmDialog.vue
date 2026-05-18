<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="upload-confirm-title" class="w-[36rem] rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="upload-confirm-title" class="mb-3 text-lg font-medium">{{ $t('files.upload_confirm.title') }}</h2>

        <!-- Info banner: dialog is dismissible, job keeps running -->
        <div class="mb-4 flex items-start gap-2 rounded-md border border-autonomi-blue/30 bg-autonomi-blue/5 px-3 py-2">
          <svg class="mt-0.5 h-4 w-4 shrink-0 text-autonomi-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-xs text-autonomi-muted">
            {{ $t('files.upload_confirm.info_banner') }}
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
                  {{ $t('files.upload_confirm.already_stored_badge') }}
                </span>
              </span>
              <span class="text-autonomi-muted">{{ entry.size_bytes ? formatBytes(entry.size_bytes) : '-' }}</span>
            </div>
          </div>

          <!-- Payment mode — only shown once the network has quoted the files.
               Never guessed from chunk count: that was a fallback lie.
               For mixed batches (some entries regular, some merkle) we don't
               aggregate chunk counts — the wave-batch / merkle split is
               per-file and pretending a single tx covers everything would
               be the same kind of fallback lie we removed for chunk counts. -->
          <div v-if="effectivePaymentMode" class="flex items-baseline justify-between">
            <span class="text-sm text-autonomi-muted">{{ $t('files.upload_confirm.payment_label') }}</span>
            <div class="text-right">
              <template v-if="effectivePaymentMode === 'mixed' && paymentModeBreakdown">
                <span class="text-sm font-medium">{{ $t('files.upload_confirm.payment_mixed') }}</span>
                <p class="text-xs text-autonomi-muted">
                  {{ $t('files.upload_confirm.payment_mixed_detail', {
                    regular: paymentModeBreakdown.regular,
                    merkle: paymentModeBreakdown.merkle,
                  }) }}
                </p>
              </template>
              <template v-else>
                <span class="text-sm font-medium">{{ effectivePaymentMode === 'merkle' ? $t('files.upload_confirm.payment_merkle') : $t('files.upload_confirm.payment_regular') }}</span>
                <p class="text-xs text-autonomi-muted">
                  {{ paymentModeDetail }}
                </p>
              </template>
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
                <span>{{ $t('files.upload_confirm.free_title') }}</span>
              </div>
              <p class="text-xs text-autonomi-muted">
                {{ $t('files.upload_confirm.free_detail') }}
              </p>
            </template>
            <template v-else-if="quotedCost">
              <div class="flex items-center justify-between text-sm font-medium">
                <span>{{ $t('files.upload_confirm.cost_label') }}</span>
                <span class="text-autonomi-blue">{{ quotedCost }}</span>
              </div>
              <div class="flex items-center justify-between text-xs text-autonomi-muted">
                <span>{{ $t('files.upload_confirm.gas_label') }}</span>
                <span>{{ quotedGas ?? '—' }}</span>
              </div>
              <p v-if="someAlreadyStored" class="text-xs text-green-400">
                {{ $t('files.upload_confirm.some_already_stored') }}
              </p>
            </template>
            <template v-else-if="connectionStore.hasFailed">
              <div class="space-y-2">
                <div class="text-sm text-yellow-500/80">
                  {{ $t('files.network.unavailable') }}
                </div>
                <div v-if="failedReason" class="text-xs text-autonomi-muted break-words">
                  {{ failedReason }}
                </div>
                <button
                  type="button"
                  class="rounded-md border border-autonomi-blue/40 px-2.5 py-1 text-xs font-medium text-autonomi-blue hover:bg-autonomi-blue/10"
                  @click="connectionStore.retry()"
                >
                  {{ $t('files.network.retry_connection') }}
                </button>
              </div>
            </template>
            <template v-else-if="connectionStore.isConnecting">
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
                <span>{{ $t('files.network.connecting') }}</span>
              </div>
            </template>
            <template v-else-if="anyQuoting">
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-autonomi-blue border-t-transparent" />
                <span>{{ $t('files.network.obtaining_quote') }}</span>
              </div>
            </template>
          </div>

          <!-- Visibility selector -->
          <div>
            <label class="mb-2 block text-xs font-medium uppercase tracking-wider text-autonomi-muted">{{ $t('files.upload_confirm.visibility_label') }}</label>
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
                  <span class="text-sm font-medium">{{ $t('files.upload_confirm.visibility_private') }}</span>
                </div>
                <p class="mt-1.5 pl-6 text-xs text-autonomi-muted">
                  {{ $t('files.upload_confirm.visibility_private_desc') }}
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
                  <span class="text-sm font-medium">{{ $t('files.upload_confirm.visibility_public') }}</span>
                </div>
                <p class="mt-1.5 pl-6 text-xs text-autonomi-muted">
                  {{ $t('files.upload_confirm.visibility_public_desc') }}
                </p>
              </button>
            </div>
          </div>

          <p v-if="quotedCost && !allAlreadyStored && effectivePaymentMode === 'regular'" class="text-xs text-autonomi-muted">
            {{ $t('files.upload_confirm.regular_footnote') }}
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
                {{ $t('common.close') }}
              </button>
              <button
                class="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
                @click="$emit('cancelUpload')"
              >
                {{ $t('files.upload_confirm.cancel_upload') }}
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="!canApprove && needsApprovalEntries.length > 1"
                class="text-xs text-autonomi-muted"
              >
                {{ $t('files.upload_confirm.ready_count', { ready: readyCount, total: needsApprovalEntries.length }) }}
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
import { useI18n } from 'vue-i18n'
import { formatBytes } from '~/utils/formatters'
import { useConnectionStore } from '~/stores/connection'
import { useFilesStore, type FileEntry } from '~/stores/files'
import { formatNanoTokens, formatGasCost } from '~/utils/payment'

const { t } = useI18n()

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

/** Per-mode counts for the multi-file summary. Drives both `effectivePaymentMode`
 *  and the "Mixed — N regular, M merkle" display string. Null until every entry
 *  has been quoted. */
const paymentModeBreakdown = computed<{ regular: number; merkle: number } | null>(() => {
  if (!allEstimated.value) return null
  const modes = entries.value.map(e => e.paymentMode).filter(Boolean) as ('regular' | 'merkle')[]
  if (modes.length !== entries.value.length) return null
  return {
    regular: modes.filter(m => m === 'regular').length,
    merkle: modes.filter(m => m === 'merkle').length,
  }
})

/** Payment mode is reported by the network — we do not guess it from size.
 *  `'mixed'` is reserved for batches that contain both regular and merkle
 *  files, so the summary can stop pretending the whole batch is homogeneous.
 *  Null until all entries are quoted, so the template can hide the Payment
 *  row entirely instead of showing a misleading prediction. */
const effectivePaymentMode = computed<'regular' | 'merkle' | 'mixed' | null>(() => {
  const b = paymentModeBreakdown.value
  if (!b) return null
  if (b.regular > 0 && b.merkle > 0) return 'mixed'
  return b.merkle > 0 ? 'merkle' : 'regular'
})

const visibility = ref<'private' | 'public'>('private')

watch(visibility, (val) => {
  emit('visibility-change', val)
})

const approveButtonLabel = computed(() => {
  const n = needsApprovalEntries.value.length
  if (n <= 1) return t('files.upload_confirm.approve_button_one')
  return t('files.upload_confirm.approve_button_many', { count: n })
})

/** Mode-detail line under the Payment row for the non-mixed case. Pulled out
 *  of the template so the `merkle vs regular_one vs regular_many` selection
 *  doesn't turn into a nested ternary in markup. */
const paymentModeDetail = computed(() => {
  const count = quotedChunks.value ?? 0
  if (effectivePaymentMode.value === 'merkle') {
    return t('files.upload_confirm.payment_merkle_detail', { count })
  }
  return count === 1
    ? t('files.upload_confirm.payment_regular_detail_one')
    : t('files.upload_confirm.payment_regular_detail_many', { count })
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
  // Fall back to 'regular' when the estimate failed or for mixed batches —
  // backend redetermines the real payment mode from each file's live quote
  // anyway, so the frontend's batch-wide guess is only used for status
  // display during paying. For mixed, per-entry paymentMode (already stored
  // on each FileEntry) drives the actual upload path.
  const mode = effectivePaymentMode.value === 'merkle' ? 'merkle' : 'regular'
  emit('approve', {
    visibility: visibility.value,
    paymentMode: mode,
  })
}
</script>
