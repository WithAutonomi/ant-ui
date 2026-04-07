<template>
  <div
    class="group relative cursor-pointer rounded-xl border border-autonomi-border p-4 transition-all hover:border-autonomi-blue/50 hover:shadow-lg hover:shadow-autonomi-blue/5"
    :class="[
      selected ? 'border-autonomi-blue bg-autonomi-blue/20 shadow-lg shadow-autonomi-blue/15' : 'bg-autonomi-surface',
      node.status === 'adding' ? 'animate-pulse' : '',
    ]"
    @click="$emit('select', node.id)"
  >
    <!-- Status indicator dot -->
    <div class="absolute left-3 top-3" :aria-label="`Status: ${node.status}`" role="img">
      <span class="relative flex h-2.5 w-2.5">
        <span
          v-if="node.status === 'running' || node.status === 'adding'"
          class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40"
          :class="dotBgClass"
        />
        <span class="relative inline-flex h-2.5 w-2.5 rounded-full" :class="dotClass" />
      </span>
    </div>

    <!-- Node name / ID -->
    <div class="mb-3 mt-1 pl-5">
      <p class="text-sm font-medium text-autonomi-text">{{ node.name || `Node ${node.id}` }}</p>
      <p v-if="node.version" class="text-[10px] text-autonomi-muted">v{{ node.version }}</p>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
      <div>
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">PID</p>
        <p class="text-sm font-mono text-autonomi-text">{{ node.pid ?? '-' }}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Uptime</p>
        <p class="text-sm font-mono text-autonomi-text">{{ node.uptime_secs ? formatUptime(node.uptime_secs) : '-' }}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Storage</p>
        <p class="text-sm font-mono text-autonomi-text">{{ node.storage_bytes != null ? formatBytes(node.storage_bytes) : '-' }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NodeInfo } from '~/stores/nodes'
import { formatBytes, formatUptime } from '~/utils/formatters'

const props = defineProps<{
  node: NodeInfo
  selected: boolean
}>()

defineEmits<{
  select: [id: number]
}>()

const statusColors: Record<string, { dot: string; bg: string }> = {
  running:  { dot: 'bg-autonomi-success', bg: 'bg-autonomi-success' },
  starting: { dot: 'bg-autonomi-warning', bg: 'bg-autonomi-warning' },
  stopping: { dot: 'bg-autonomi-warning', bg: 'bg-autonomi-warning' },
  adding:   { dot: 'bg-autonomi-warning', bg: 'bg-autonomi-warning' },
  errored:  { dot: 'bg-autonomi-error', bg: 'bg-autonomi-error' },
  stopped:  { dot: 'border-2 border-autonomi-muted bg-transparent', bg: '' },
}

const dotClass = computed(() => statusColors[props.node.status]?.dot ?? 'bg-autonomi-muted')
const dotBgClass = computed(() => statusColors[props.node.status]?.bg ?? '')

</script>
