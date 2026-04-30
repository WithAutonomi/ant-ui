<template>
  <div class="mt-1 flex flex-col gap-1">
    <span v-if="detail" class="text-[10px] text-autonomi-muted">{{ detail }}</span>
    <div class="h-1 w-full overflow-hidden rounded bg-autonomi-surface" role="progressbar" :aria-valuenow="percent ?? undefined" aria-valuemin="0" aria-valuemax="100">
      <div
        v-if="percent !== undefined && percent !== null"
        class="h-full bg-autonomi-blue transition-[width] duration-200 ease-out"
        :style="{ width: `${clampedPercent}%` }"
      />
      <div v-else class="h-full w-1/3 animate-pulse bg-autonomi-blue/60" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  detail: string | null
  percent: number | null | undefined
}>()

const clampedPercent = computed(() => {
  const p = props.percent ?? 0
  return Math.max(0, Math.min(100, p))
})
</script>
