<template>
  <div class="mb-3">
    <!-- Row 1: drive label on the left (e.g. "C:\") + bar. -->
    <div class="flex items-center gap-3">
      <span
        v-if="label"
        class="w-20 shrink-0 truncate font-mono text-xs text-autonomi-text"
        :title="label"
      >{{ label }}</span>
      <!-- Stacked bar: full width = total drive capacity. Node usage and other
           (non-node) usage are painted explicitly so the leftover track
           background is the real free space, not everything-not-a-node. The
           colour key is shared once above the bars (DiskUsageKey). -->
      <div
        class="flex h-3 min-w-0 flex-1 overflow-hidden rounded-md border border-autonomi-border bg-autonomi-surface"
        role="img"
        :aria-label="$t('nodes.disk_bar.aria', { used: formatBytes(used), total: formatBytes(total), min: formatBytes(min) })"
      >
        <div v-if="otherPct > 0" class="h-full bg-autonomi-muted/25" :style="{ width: `${otherPct}%` }" />
        <div class="h-full bg-autonomi-blue" :style="{ width: `${usedPct}%` }" />
        <div
          v-if="showMin"
          class="h-full cursor-help"
          :style="{ width: `${reservePct}%`, ...DISK_MIN_DITHER }"
          :title="$t('nodes.add_dialog.min_size_info')"
        />
      </div>
    </div>

    <!-- Row 2: node count (left, aligned under the label) + this drive's
         figures. -->
    <div class="mt-1 flex items-baseline gap-3 text-xs text-autonomi-muted">
      <span v-if="label" class="w-20 shrink-0 truncate">
        {{ $t('nodes.disk_bar.drive_nodes', { count: nodeCount }) }}
      </span>
      <span class="flex min-w-0 flex-1 items-baseline gap-8">
        <span class="shrink-0">{{ $t('nodes.disk_bar.used') }} <span class="text-autonomi-text">{{ formatBytes(used) }}</span></span>
        <span><span class="text-autonomi-text">{{ formatBytes(driveUsed) }} / {{ formatBytes(total) }}</span> ({{ formatBytes(available) }} {{ $t('nodes.disk_bar.free') }})</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatBytes } from '~/utils/formatters'
import { DISK_MIN_DITHER } from '~/utils/disk-bar'

// Prop-driven so the node page can render one bar per drive that holds nodes.
const props = withDefaults(defineProps<{
  /** Node storage bytes on this volume. */
  used: number
  /** Recommended-minimum total for the nodes on this volume. */
  min: number
  /** Total volume capacity in bytes. */
  total: number
  /** Bytes available to the caller on this volume. */
  available: number
  /** Drive-root label; empty hides the label/count (the brief pre-enrichment window). */
  label?: string
  /** Node count on this volume. */
  nodeCount?: number
}>(), {
  label: '',
  nodeCount: 0,
})

const used = computed(() => props.used)
const min = computed(() => props.min)
const total = computed(() => props.total)
const available = computed(() => props.available)
// Total drive space in use (node + non-node), for the "used / total (free)" figure.
const driveUsed = computed(() => Math.max(0, total.value - available.value))

// Segment widths in bytes. The track is total drive space, so anything not
// painted reads as free — which would overstate free space when the drive holds
// non-node data. We therefore paint node storage AND other (non-node) usage
// explicitly, leaving only the real free remainder as background:
//
//   [ node used ][ other used ][ recommended reserve ][ free (background) ]
//
const usedW = computed(() => clamp(used.value, 0, total.value))
const otherW = computed(() => clamp(total.value - available.value - usedW.value, 0, total.value - usedW.value))
const freeW = computed(() => Math.max(0, total.value - usedW.value - otherW.value))
// Recommended headroom for nodes to grow into, carved out of free space so it
// never overstates capacity. Hidden once node usage already meets the minimum.
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
