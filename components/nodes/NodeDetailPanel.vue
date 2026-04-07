<template>
  <div class="rounded-xl border border-autonomi-blue/30 bg-autonomi-surface p-5">
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h3 class="text-base font-medium text-autonomi-text">{{ node.name || `Node ${node.id}` }}</h3>
        <StatusBadge :status="node.status" />
      </div>
      <button
        aria-label="Close panel"
        class="text-autonomi-muted hover:text-autonomi-text"
        @click="$emit('close')"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="grid grid-cols-2 gap-x-8 gap-y-3 text-sm lg:grid-cols-4">
      <div>
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Version</p>
        <p class="text-autonomi-text">{{ node.version }}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">PID</p>
        <p class="font-mono text-xs text-autonomi-text">{{ node.pid ?? '-' }}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Uptime</p>
        <p class="text-autonomi-text">{{ node.uptime_secs ? formatUptime(node.uptime_secs) : '-' }}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Storage</p>
        <p class="text-autonomi-text">{{ node.storage_bytes != null ? formatBytes(node.storage_bytes) : '-' }}</p>
      </div>
      <div v-if="node.data_dir" class="col-span-2">
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Data Directory</p>
        <p class="font-mono text-xs text-autonomi-text">{{ node.data_dir }}</p>
      </div>
      <div v-if="node.log_dir" class="col-span-2">
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Log Directory</p>
        <p class="font-mono text-xs text-autonomi-text">{{ node.log_dir }}</p>
      </div>
      <div v-if="node.node_port" class="col-span-1">
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Port</p>
        <p class="font-mono text-xs text-autonomi-text">{{ node.node_port }}</p>
      </div>
      <div v-if="node.binary_path" class="col-span-2 lg:col-span-3">
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Binary</p>
        <p class="font-mono text-xs text-autonomi-text">{{ node.binary_path }}</p>
      </div>
      <div v-if="node.rewards_address" class="col-span-2 lg:col-span-4">
        <p class="text-[10px] uppercase tracking-wider text-autonomi-muted">Rewards Address</p>
        <p class="font-mono text-xs text-autonomi-text">{{ node.rewards_address }}</p>
      </div>
    </div>

    <div class="mt-4 flex gap-2 border-t border-autonomi-border pt-4">
      <button
        v-if="node.status === 'stopped' || node.status === 'errored'"
        class="rounded-md bg-autonomi-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        @click="$emit('start', node.id)"
      >
        Start
      </button>
      <button
        v-if="node.status === 'running'"
        class="rounded-md border border-autonomi-border px-3 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
        @click="$emit('stop', node.id)"
      >
        Stop
      </button>
      <button
        v-if="node.status === 'stopped' || node.status === 'errored'"
        class="rounded-md border border-autonomi-error/50 px-3 py-1.5 text-xs text-autonomi-error hover:bg-autonomi-error/10"
        @click="$emit('remove', node.id)"
      >
        Remove
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NodeInfo } from '~/stores/nodes'
import { formatBytes, formatUptime } from '~/utils/formatters'

defineProps<{
  node: NodeInfo
}>()

defineEmits<{
  close: []
  start: [id: number]
  stop: [id: number]
  remove: [id: number]
}>()

</script>
