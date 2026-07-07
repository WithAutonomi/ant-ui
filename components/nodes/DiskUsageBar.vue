<template>
  <div class="mb-4">
    <!-- Per-drive header: shown only when a label is provided (multi-drive
         layouts). Single-drive users see the bare bar, as before. -->
    <div v-if="label" class="mb-1 flex items-baseline justify-between gap-2">
      <span class="truncate font-mono text-xs text-autonomi-text" :title="label">{{ label }}</span>
      <span class="shrink-0 text-xs text-autonomi-muted">{{ $t('nodes.disk_bar.drive_nodes', { count: nodeCount }) }}</span>
    </div>

    <!-- Legend -->
    <div class="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm bg-autonomi-blue" />
        <span class="text-autonomi-muted">{{ $t('nodes.disk_bar.used') }}</span>
        <span class="text-autonomi-text">{{ formatBytes(used) }}</span>
      </span>
      <span
        v-if="showMin"
        class="flex cursor-help items-center gap-1.5"
        :title="$t('nodes.add_dialog.min_size_info')"
      >
        <span class="h-2 w-2 rounded-sm" :style="DITHER" />
        <span class="text-autonomi-muted underline decoration-dotted underline-offset-2">{{ $t('nodes.disk_bar.recommended_min') }}</span>
        <span class="text-autonomi-text">{{ formatBytes(min) }}</span>
      </span>
      <span v-if="otherPct > 0" class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm bg-autonomi-muted/25" />
        <span class="text-autonomi-muted">{{ $t('nodes.disk_bar.other') }}</span>
        <span class="text-autonomi-text">{{ formatBytes(otherW) }}</span>
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm border border-autonomi-border bg-autonomi-surface" />
        <span class="text-autonomi-muted">{{ $t('nodes.disk_bar.drive') }}</span>
        <span class="text-autonomi-text">{{ formatBytes(driveUsed) }} / {{ formatBytes(total) }} ({{ formatBytes(available) }} {{ $t('nodes.disk_bar.free') }})</span>
      </span>
    </div>

    <!-- Single stacked bar: full width = total drive capacity. Node usage and
         other (non-node) usage are painted explicitly so the leftover track
         background is the real free space, not everything-not-a-node. -->
    <div
      class="flex h-3 w-full overflow-hidden rounded-md border border-autonomi-border bg-autonomi-surface"
      role="img"
      :aria-label="$t('nodes.disk_bar.aria', { used: formatBytes(used), total: formatBytes(total), min: formatBytes(min) })"
    >
      <div v-if="otherPct > 0" class="h-full bg-autonomi-muted/25" :style="{ width: `${otherPct}%` }" />
      <div class="h-full bg-autonomi-blue" :style="{ width: `${usedPct}%` }" />
      <div
        v-if="showMin"
        class="h-full cursor-help"
        :style="{ width: `${reservePct}%`, ...DITHER }"
        :title="$t('nodes.add_dialog.min_size_info')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatBytes } from '~/utils/formatters'

// Prop-driven so the node page can render one bar per drive that holds nodes.
// (Previously read singular store getters; now the parent maps over
// `nodesStore.driveUsageByVolume`.)
const props = withDefaults(defineProps<{
  /** Node storage bytes on this volume. */
  used: number
  /** Recommended-minimum total for the nodes on this volume. */
  min: number
  /** Total volume capacity in bytes. */
  total: number
  /** Bytes available to the caller on this volume. */
  available: number
  /** Drive-root label; empty hides the per-drive header (single-drive case). */
  label?: string
  /** Node count on this volume (shown in the header). */
  nodeCount?: number
}>(), {
  label: '',
  nodeCount: 0,
})

// Recommended-minimum segment rendered as a TUI-style shaded block (▒): a
// fine checkerboard dither that reads as a partially-filled threshold zone
// rather than an alert. Colours are theme-aware (see --disk-min-* in
// assets/css/main.css) and deliberately kept close to the background.
const DITHER = {
  backgroundColor: 'var(--disk-min-base)',
  backgroundImage:
    'linear-gradient(45deg, var(--disk-min-cell) 25%, transparent 25%, transparent 75%, var(--disk-min-cell) 75%), ' +
    'linear-gradient(45deg, var(--disk-min-cell) 25%, transparent 25%, transparent 75%, var(--disk-min-cell) 75%)',
  backgroundSize: '4px 4px',
  backgroundPosition: '0 0, 2px 2px',
}

const used = computed(() => props.used)
const min = computed(() => props.min)
const total = computed(() => props.total)
const available = computed(() => props.available)
// Total drive space in use (node + non-node), for the "used / total (free)" label.
const driveUsed = computed(() => Math.max(0, total.value - available.value))

// Segment widths in bytes. The bar must be truthful about capacity: the track
// is total drive space, so anything not painted reads as free — which would
// overstate free space when the drive holds non-node data. We therefore paint
// node storage AND other (non-node) usage explicitly, leaving only the real
// free remainder as background.
//
//   [ node used ][ other used ][ recommended reserve ][ free (background) ]
//
const usedW = computed(() => clamp(used.value, 0, total.value))
// Everything the OS reports as used, minus what the nodes account for.
const otherW = computed(() => clamp(total.value - available.value - usedW.value, 0, total.value - usedW.value))
// Genuinely free space (≈ reported available, after clamping).
const freeW = computed(() => Math.max(0, total.value - usedW.value - otherW.value))
// Recommended headroom for nodes to grow into, carved out of free space so it
// never overstates capacity. Hidden once node usage already meets the minimum
// (or when there's no free space left to reserve — the below-minimum case the
// Add Nodes warning covers).
const reserveW = computed(() => Math.min(Math.max(min.value - used.value, 0), freeW.value))
const showMin = computed(() => reserveW.value > 0)

const usedPct = computed(() => pct(usedW.value))
const otherPct = computed(() => pct(otherW.value))
const reservePct = computed(() => pct(reserveW.value))

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}
function pct(bytes: number) {
  return total.value ? (bytes / total.value) * 100 : 0
}
</script>
