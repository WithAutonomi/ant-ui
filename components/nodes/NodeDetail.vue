<template>
  <tr v-if="node" class="bg-autonomi-surface/30">
    <td :colspan="colspan" class="px-4 py-4">
      <div class="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div>
          <span class="text-autonomi-muted">Node ID</span>
          <p class="font-mono text-xs">{{ node.id }}</p>
        </div>
        <div>
          <span class="text-autonomi-muted">Status</span>
          <p><StatusBadge :status="node.status" /></p>
        </div>
        <div>
          <span class="text-autonomi-muted">Version</span>
          <p>{{ node.version }}</p>
        </div>
        <div>
          <span class="text-autonomi-muted">PID</span>
          <p class="font-mono text-xs">{{ node.pid ?? '-' }}</p>
        </div>
        <div>
          <span class="text-autonomi-muted">Uptime</span>
          <p>{{ formatUptime(node.uptime_secs) }}</p>
        </div>
        <div>
          <span class="text-autonomi-muted">Peers</span>
          <p>{{ node.peer_count ?? '-' }}</p>
        </div>
        <div>
          <span class="text-autonomi-muted">Storage</span>
          <p>{{ formatBytes(node.storage_bytes) }}</p>
        </div>
        <div>
          <span class="text-autonomi-muted">Earnings</span>
          <p>{{ node.earnings ?? '-' }}</p>
        </div>
        <div class="col-span-2">
          <span class="text-autonomi-muted">Data Directory</span>
          <p class="font-mono text-xs">{{ node.data_dir }}</p>
        </div>
        <div class="col-span-2">
          <span class="text-autonomi-muted">Log Directory</span>
          <p class="font-mono text-xs">{{ node.log_dir }}</p>
        </div>
        <div v-if="node.rewards_address" class="col-span-2">
          <span class="text-autonomi-muted">Rewards Address</span>
          <p class="font-mono text-xs">{{ node.rewards_address }}</p>
        </div>
      </div>

      <div class="mt-4 flex gap-2">
        <button
          v-if="node.status === 'stopped' || node.status === 'errored'"
          class="rounded-md bg-autonomi-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          @click="$emit('start', node.id)"
        >
          Start
        </button>
        <button
          v-if="node.status === 'running'"
          class="rounded-md border border-autonomi-border px-3 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="$emit('stop', node.id)"
        >
          Stop
        </button>
        <button
          v-if="node.status === 'stopped' || node.status === 'errored'"
          class="rounded-md border border-autonomi-border px-3 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="$emit('remove', node.id)"
        >
          Remove
        </button>
      </div>
    </td>
  </tr>
</template>

<script setup lang="ts">
import type { NodeInfo } from '~/stores/nodes'

defineProps<{
  node: NodeInfo
  colspan: number
}>()

defineEmits<{
  start: [id: number]
  stop: [id: number]
  remove: [id: number]
}>()

function formatUptime(seconds?: number) {
  if (!seconds) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(bytes?: number) {
  if (!bytes) return '-'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
</script>
