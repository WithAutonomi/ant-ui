<template>
  <div
    class="flex items-center gap-1.5 whitespace-nowrap text-xs"
    :class="textClass"
    :title="detail"
  >
    <span :class="dotClass">●</span>
    <span>{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useNodesStore } from '~/stores/nodes'

const nodesStore = useNodesStore()

const level = computed(() => nodesStore.healthLevel)

// First non-green check carries the actionable detail; the full sentence is on the tooltip.
const activeCheck = computed(() =>
  nodesStore.fleetHealth?.checks.find(c => c.level !== 'green') ?? null,
)

// A self-explanatory one-liner: says what's happening and, where useful, what to do. The severity
// colour is carried by the dot, so the text focuses on meaning rather than repeating the level.
const label = computed(() => {
  const candidate = activeCheck.value?.candidate
  switch (level.value) {
    case 'warning':
      return candidate
        ? `Low disk — node ${candidate.node_id} will be evicted soon`
        : 'Low disk — free up space soon'
    case 'critical':
      return candidate
        ? `Disk critical — evicting node ${candidate.node_id}`
        : 'Disk critical — free space now'
    default:
      return 'Disk healthy'
  }
})

const dotClass = computed(() => {
  switch (level.value) {
    case 'warning': return 'text-autonomi-warning'
    case 'critical': return 'text-autonomi-error'
    default: return 'text-autonomi-success'
  }
})

const textClass = computed(() =>
  level.value === 'green' ? 'text-autonomi-muted' : 'text-autonomi-text',
)

const detail = computed(() => activeCheck.value?.summary ?? 'All nodes have ample disk space.')
</script>
