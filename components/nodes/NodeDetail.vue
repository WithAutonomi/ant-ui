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
          <p>{{ node.uptime_secs ? formatUptime(node.uptime_secs) : '-' }}</p>
        </div>
        <div>
          <span class="text-autonomi-muted">Storage</span>
          <p>{{ node.storage_bytes != null ? formatBytes(node.storage_bytes) : '-' }}</p>
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
import { formatBytes, formatUptime } from '~/utils/formatters'

defineProps<{
  node: NodeInfo
  colspan: number
}>()

defineEmits<{
  start: [id: number]
  stop: [id: number]
  remove: [id: number]
}>()

</script>
