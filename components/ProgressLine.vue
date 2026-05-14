<template>
  <!-- Indeterminate single-bar override: used when the upload backend gives
       us no progress signal at all (Indelible has no per-chunk event stream,
       so the segmented quote/pay/store bar would stay empty for the entire
       transfer). The pulsing single bar at least confirms the row is alive. -->
  <div
    v-if="indeterminate"
    class="h-1 w-full min-w-[8rem] overflow-hidden rounded bg-autonomi-surface"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div class="h-full w-1/3 animate-pulse bg-autonomi-blue/60" />
  </div>

  <!-- Segmented bar for uploads: [quote] · [pay] · [store]
       For downloads: a single bar (no payment phase).
       Stage detail text is rendered separately by the parent (next to the
       status badge), not here — this component is purely the bar. -->
  <div
    v-else-if="kind === 'upload'"
    class="flex w-full min-w-[8rem] items-center gap-1.5"
    role="progressbar"
    :aria-valuenow="overallPercent"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <BarSegment :percent="quoteBarPct" />
    <PayDot :state="dotState" />
    <BarSegment :percent="storeBarPct" />
  </div>

  <div
    v-else
    class="h-1 w-full min-w-[8rem] overflow-hidden rounded bg-autonomi-surface"
    role="progressbar"
    :aria-valuenow="overallPercent"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div
      v-if="props.percent !== undefined && props.percent !== null"
      class="h-full bg-autonomi-blue transition-[width] duration-200 ease-out"
      :style="{ width: `${clamp(props.percent)}%` }"
    />
    <div v-else class="h-full w-1/3 animate-pulse bg-autonomi-blue/60" />
  </div>
</template>

<script setup lang="ts">
import type { FileEntry, FileStatus, TransferStage } from '~/stores/files'

const props = defineProps<{
  /** Global percent 0–100; used for the download bar and aria. Optional —
   *  null means we have no total yet (encryption phase) and the download bar
   *  falls back to an indeterminate pulse. */
  percent: number | null | undefined
  /** Upload vs download — determines whether to render the segmented bar or
   *  the single bar. */
  kind: FileEntry['kind']
  /** Outer status — drives the payment dot's state. */
  status: FileStatus
  /** Sub-stage and per-stage chunk counts; together drive each segment's fill. */
  stage: TransferStage | undefined
  stageDone: number | undefined
  stageTotal: number | undefined
  /** Render the indeterminate single bar regardless of `kind`. Used when the
   *  backend produces no progress events (e.g. Indelible). Optional; defaults
   *  to false for backwards compatibility with existing callers. */
  indeterminate?: boolean
}>()

function clamp(p: number) {
  return Math.max(0, Math.min(100, p))
}

function stagePct(): number {
  const total = props.stageTotal ?? 0
  if (!total) return 0
  return clamp((props.stageDone ?? 0) / total * 100)
}

/** Quote segment fill — 0..100 of the quote phase only.
 *
 *  Stage-driven: `stage` reflects what ant-core is actually doing right now
 *  (quoting / uploading), regardless of the JS-side outer status which the
 *  wallet flow pre-flips to 'uploading' before any quoting begins. Status
 *  is consulted only as a fallback to "we're past quoting":
 *  - `paying` (external-signer's wallet popup) → segment full
 *  - `complete` (everything done) → segment full
 *  Otherwise we fill from the live quote count. */
const quoteBarPct = computed(() => {
  if (props.status === 'complete') return 100
  if (props.stage === 'uploading') return 100
  if (props.status === 'paying') return 100
  if (props.stage === 'quoting') return stagePct()
  return 0
})

/** Storage segment fill — 0..100 of the storage phase only. */
const storeBarPct = computed(() => {
  if (props.status === 'complete') return 100
  if (props.stage === 'uploading') return stagePct()
  return 0
})

/** Payment dot — empty until storage starts, pulses during the external-
 *  signer wallet popup, goes solid once chunks are being stored. Wallet-flow
 *  direct-key never enters `paying` (Rust drives payment internally), so
 *  the dot just flips empty → solid when stage transitions to 'uploading'. */
const dotState = computed<'empty' | 'pulse' | 'solid'>(() => {
  if (props.status === 'paying') return 'pulse'
  if (props.stage === 'uploading' || props.status === 'complete') return 'solid'
  return 'empty'
})

const overallPercent = computed(() => clamp(props.percent ?? 0))
</script>
