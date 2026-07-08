<template>
  <!-- Shared colour key for the per-drive disk-usage bars. Rendered once above
       the bars so the swatches aren't repeated for every drive. -->
  <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
    <span class="flex items-center gap-1.5">
      <span class="h-2 w-2 rounded-sm bg-autonomi-blue" />
      <span class="text-autonomi-muted">{{ $t('nodes.disk_bar.used') }}</span>
    </span>
    <span
      class="flex cursor-help items-center gap-1.5"
      :title="$t('nodes.add_dialog.min_size_info')"
    >
      <span class="h-2 w-2 rounded-sm" :style="DISK_MIN_DITHER" />
      <span class="text-autonomi-muted underline decoration-dotted underline-offset-2">{{ $t('nodes.disk_bar.recommended_min') }}</span>
    </span>
    <span class="flex items-center gap-1.5">
      <span class="h-2 w-2 rounded-sm bg-autonomi-muted/25" />
      <span class="text-autonomi-muted">{{ $t('nodes.disk_bar.other') }}</span>
    </span>
    <span class="flex items-center gap-1.5">
      <span class="h-2 w-2 rounded-sm border border-autonomi-border bg-autonomi-surface" />
      <span class="text-autonomi-muted">{{ $t('nodes.disk_bar.drive') }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { DISK_MIN_DITHER } from '~/utils/disk-bar'
</script>
