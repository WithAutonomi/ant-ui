<template>
  <div class="mb-4">
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
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm border border-autonomi-border bg-autonomi-surface" />
        <span class="text-autonomi-muted">{{ $t('nodes.disk_bar.drive') }}</span>
        <span class="text-autonomi-text">{{ formatBytes(available) }} / {{ formatBytes(total) }}</span>
      </span>
    </div>

    <!-- Single stacked bar: full width = total drive capacity. The track's own
         background is the free remainder, so we only render the used + min-gap
         segments on top of it. -->
    <div
      class="flex h-3 w-full overflow-hidden rounded-md border border-autonomi-border bg-autonomi-surface"
      role="img"
      :aria-label="$t('nodes.disk_bar.aria', { used: formatBytes(used), total: formatBytes(total), min: formatBytes(min) })"
    >
      <div class="h-full bg-autonomi-blue" :style="{ width: `${usedPct}%` }" />
      <div
        v-if="showMin"
        class="h-full cursor-help"
        :style="{ width: `${minGapPct}%`, ...DITHER }"
        :title="$t('nodes.add_dialog.min_size_info')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useNodesStore } from '~/stores/nodes'
import { formatBytes } from '~/utils/formatters'

const nodesStore = useNodesStore()

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

const used = computed(() => nodesStore.totalStorage)
const min = computed(() => nodesStore.recommendedMinStorage)
const total = computed(() => nodesStore.driveTotalBytes)
const available = computed(() => nodesStore.driveAvailableBytes)

// Hide the recommended-minimum segment once current usage already meets it.
const showMin = computed(() => min.value > used.value)

// Widths clamped so the segments never overflow the drive-capacity track.
const usedW = computed(() => Math.min(used.value, total.value))
const minGapW = computed(() =>
  showMin.value ? Math.min(min.value - used.value, total.value - usedW.value) : 0,
)

const usedPct = computed(() => (total.value ? (usedW.value / total.value) * 100 : 0))
const minGapPct = computed(() => (total.value ? (minGapW.value / total.value) * 100 : 0))
</script>
