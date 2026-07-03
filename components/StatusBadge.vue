<template>
  <!-- Non-error labels render at their natural width (whitespace-nowrap so
       they never break to two lines). Error labels — which can be a wall of
       viem stacktrace — wrap onto multiple lines (whitespace-normal + break
       so long, unspaced strings still break) and stay capped at max-w-xs so
       they don't blow out the table width. align-top keeps the dot pinned to
       the first line. The full error text is also available via the tooltip. -->
  <span
    class="inline-flex gap-1 text-xs font-medium"
    :class="[colorClass, isError ? 'max-w-xs items-start align-top' : 'items-center align-middle whitespace-nowrap']"
    role="status"
    :title="label"
  >
    <span aria-hidden="true" class="shrink-0">{{ dot }}</span>
    <span :class="isError ? 'whitespace-normal break-words' : ''">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = defineProps<{ status: string }>()
const { t } = useI18n()

// Static-status entries keyed by the backend's status string. `labelKey`
// resolves to the localized label; dynamic statuses (percentages, "Failed:",
// "Quote:") bypass this map and surface their raw text — those are
// untranslated by design until the source emits structured tokens we can
// interpolate.
const statusMap: Record<string, { dot: string; labelKey: string; color: string }> = {
  // Node statuses (lowercase, matching ant-core)
  running: { dot: '●', labelKey: 'status.node.running', color: 'text-autonomi-success' },
  stopped: { dot: '○', labelKey: 'status.node.stopped', color: 'text-autonomi-muted' },
  starting: { dot: '◐', labelKey: 'status.node.starting', color: 'text-autonomi-warning' },
  stopping: { dot: '◐', labelKey: 'status.node.stopping', color: 'text-autonomi-warning' },
  adding: { dot: '◐', labelKey: 'status.node.adding', color: 'text-autonomi-warning' },
  errored: { dot: '●', labelKey: 'status.node.errored', color: 'text-autonomi-error' },
  upgrade_scheduled: { dot: '◐', labelKey: 'status.node.upgrade_scheduled', color: 'text-autonomi-blue' },
  evicted: { dot: '●', labelKey: 'status.node.evicted', color: 'text-autonomi-error' },
  // File transfer statuses
  Pending: { dot: '○', labelKey: 'status.file.pending', color: 'text-autonomi-muted' },
  Quoting: { dot: '◐', labelKey: 'status.file.quoting', color: 'text-autonomi-warning' },
  'Encrypting…': { dot: '◐', labelKey: 'status.file.encrypting', color: 'text-autonomi-warning' },
  'Resolving datamap': { dot: '◐', labelKey: 'status.file.resolving_datamap', color: 'text-autonomi-warning' },
  'Queued: quoting': { dot: '○', labelKey: 'status.file.queued_quoting', color: 'text-autonomi-muted' },
  'Queued: uploading': { dot: '○', labelKey: 'status.file.queued_uploading', color: 'text-autonomi-muted' },
  'Connecting to network…': { dot: '◐', labelKey: 'status.file.connecting_to_network', color: 'text-autonomi-warning' },
  'Obtaining quote…': { dot: '◐', labelKey: 'status.file.obtaining_quote', color: 'text-autonomi-warning' },
  'Saving datamap…': { dot: '◐', labelKey: 'status.file.saving_datamap', color: 'text-autonomi-warning' },
  'Network unavailable': { dot: '✖', labelKey: 'status.file.network_unavailable', color: 'text-autonomi-error' },
  'Ready to approve': { dot: '●', labelKey: 'status.file.ready_to_approve', color: 'text-autonomi-blue' },
  'Awaiting approval': { dot: '◐', labelKey: 'status.file.awaiting_approval', color: 'text-autonomi-warning' },
  Uploading: { dot: '●', labelKey: 'status.file.uploading', color: 'text-autonomi-blue' },
  Downloading: { dot: '●', labelKey: 'status.file.downloading', color: 'text-autonomi-blue' },
  Complete: { dot: '●', labelKey: 'status.file.done', color: 'text-autonomi-success' },
  Done: { dot: '●', labelKey: 'status.file.done', color: 'text-autonomi-success' },
  Downloaded: { dot: '↓', labelKey: 'status.file.downloaded', color: 'text-autonomi-blue' },
}

const entry = computed(() => {
  // Handle percentage statuses like "Uploading 45%" or "Downloading 80%"
  if (props.status.includes('%')) {
    return { dot: '◐', label: props.status, color: 'text-autonomi-blue', error: false }
  }
  if (props.status.startsWith('Failed') || props.status.startsWith('ERR')) {
    return { dot: '✖', label: props.status, color: 'text-autonomi-error', error: true }
  }
  if (props.status.startsWith('Quote:')) {
    return { dot: '●', label: props.status, color: 'text-autonomi-blue', error: false }
  }
  const mapped = statusMap[props.status]
  if (mapped) return { dot: mapped.dot, label: t(mapped.labelKey), color: mapped.color, error: false }
  return { dot: '?', label: props.status, color: 'text-autonomi-muted', error: false }
})

const dot = computed(() => entry.value.dot)
const label = computed(() => entry.value.label)
const colorClass = computed(() => entry.value.color)
const isError = computed(() => entry.value.error)
</script>
