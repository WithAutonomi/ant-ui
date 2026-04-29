<template>
  <!-- A single bar segment in ProgressLine's quote/store split. flex-1 so the
       quote and store segments share the row evenly with the dot in between. -->
  <div class="h-1 flex-1 overflow-hidden rounded bg-autonomi-surface">
    <div
      class="h-full bg-autonomi-blue transition-[width] duration-200 ease-out"
      :style="{ width: `${clamped}%` }"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ percent: number }>()
const clamped = computed(() => Math.max(0, Math.min(100, props.percent)))
</script>
