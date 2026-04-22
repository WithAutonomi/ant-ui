<template>
  <span class="inline-flex items-center gap-1 text-xs font-medium" :class="colorClass" role="status">
    <span aria-hidden="true">{{ dot }}</span>
    <span>{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ status: string }>()

const statusMap: Record<string, { dot: string; label: string; color: string }> = {
  // Node statuses (lowercase, matching ant-core)
  running: { dot: '●', label: 'Running', color: 'text-autonomi-success' },
  stopped: { dot: '○', label: 'Stopped', color: 'text-autonomi-muted' },
  starting: { dot: '◐', label: 'Starting', color: 'text-autonomi-warning' },
  stopping: { dot: '◐', label: 'Stopping', color: 'text-autonomi-warning' },
  adding: { dot: '◐', label: 'Adding...', color: 'text-autonomi-warning' },
  errored: { dot: '●', label: 'Error', color: 'text-autonomi-error' },
  // File transfer statuses
  Pending: { dot: '○', label: 'Pending', color: 'text-autonomi-muted' },
  Quoting: { dot: '◐', label: 'Quoting', color: 'text-autonomi-warning' },
  'Queued: quoting': { dot: '○', label: 'Queued: quoting', color: 'text-autonomi-muted' },
  'Queued: uploading': { dot: '○', label: 'Queued: uploading', color: 'text-autonomi-muted' },
  'Connecting to network…': { dot: '◐', label: 'Connecting to network…', color: 'text-autonomi-warning' },
  'Obtaining quote…': { dot: '◐', label: 'Obtaining quote…', color: 'text-autonomi-warning' },
  'Network unavailable': { dot: '✖', label: 'Network unavailable', color: 'text-autonomi-error' },
  'Ready to approve': { dot: '●', label: 'Ready to approve', color: 'text-autonomi-blue' },
  Paying: { dot: '◐', label: 'Paying', color: 'text-autonomi-warning' },
  Uploading: { dot: '●', label: 'Uploading', color: 'text-autonomi-blue' },
  Downloading: { dot: '●', label: 'Downloading', color: 'text-autonomi-blue' },
  Complete: { dot: '●', label: 'Done', color: 'text-autonomi-success' },
  Done: { dot: '●', label: 'Done', color: 'text-autonomi-success' },
  Downloaded: { dot: '↓', label: 'Downloaded — click to open', color: 'text-autonomi-blue' },
}

const entry = computed(() => {
  // Handle percentage statuses like "Uploading 45%" or "Downloading 80%"
  if (props.status.includes('%')) {
    return { dot: '◐', label: props.status, color: 'text-autonomi-blue' }
  }
  if (props.status.startsWith('Failed') || props.status.startsWith('ERR')) {
    return { dot: '✖', label: props.status, color: 'text-autonomi-error' }
  }
  if (props.status.startsWith('Quote:')) {
    return { dot: '●', label: props.status, color: 'text-autonomi-blue' }
  }
  return statusMap[props.status] ?? { dot: '?', label: props.status, color: 'text-autonomi-muted' }
})

const dot = computed(() => entry.value.dot)
const label = computed(() => entry.value.label)
const colorClass = computed(() => entry.value.color)
</script>
