<template>
  <div
    class="flex items-center gap-1.5 text-xs"
    :class="textClass"
    :title="detail"
  >
    <span :class="dotClass">●</span>
    <span>{{ label }}</span>
    <span v-if="candidateNote" class="text-autonomi-muted">— {{ candidateNote }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useNodesStore } from '~/stores/nodes'

const nodesStore = useNodesStore()

const level = computed(() => nodesStore.healthLevel)

const label = computed(() => {
  switch (level.value) {
    case 'warning': return 'Disk filling'
    case 'critical': return 'Disk critical'
    default: return 'Healthy'
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

// First non-green check carries the actionable detail (full summary on hover).
const activeCheck = computed(() =>
  nodesStore.fleetHealth?.checks.find(c => c.level !== 'green') ?? null,
)

const detail = computed(() => activeCheck.value?.summary ?? 'All nodes have ample disk space.')

// A short inline note naming the node that would be evicted next, when one is known.
const candidateNote = computed(() => {
  const candidate = activeCheck.value?.candidate
  if (!candidate) return ''
  return `node ${candidate.node_id} next`
})
</script>
