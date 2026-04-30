<template>
  <!-- The payment indicator between the quote and store segments.
       - empty: outline only, awaiting wallet step
       - pulse: filled and animated, popup is open
       - solid: filled, payment confirmed -->
  <span
    class="inline-block h-2 w-2 rounded-full transition-colors"
    :class="classes"
    :aria-label="label"
  />
</template>

<script setup lang="ts">
const props = defineProps<{ state: 'empty' | 'pulse' | 'solid' }>()

const classes = computed(() => {
  switch (props.state) {
    case 'pulse': return 'animate-pulse bg-autonomi-blue'
    case 'solid': return 'bg-autonomi-blue'
    case 'empty':
    default: return 'bg-autonomi-surface'
  }
})

const label = computed(() => ({
  empty: 'Payment pending',
  pulse: 'Awaiting wallet',
  solid: 'Payment confirmed',
}[props.state]))
</script>
