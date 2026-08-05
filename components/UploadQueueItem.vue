<template>
  <div class="upload-queue-item">
    <div class="flex items-center justify-between py-3 border-b border-autonomi-border last:border-0">
      <div class="flex items-center gap-3">
        <StatusBadge :status="folder.status" />
        <div>
          <span class="text-autonomi-text">{{ folder.name }}</span>
          <span class="text-autonomi-muted text-sm ml-2">
            {{ folder.file_count }} files · {{ formatSize(folder.total_size) }}
          </span>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <!-- Progress bar for active uploads -->
        <div v-if="active && folder.progress_pct !== null" class="w-32">
          <ProgressLine :percent="folder.progress_pct" />
        </div>

        <!-- Upload button for pending -->
        <button
          v-if="folder.status === 'pending'"
          class="btn btn-primary text-sm"
          @click="$emit('start', folder.path)"
        >
          Upload
        </button>

        <!-- Completed indicator -->
        <span v-if="folder.status === 'completed'" class="text-green-400 text-sm">
          ✓ Complete
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface FolderInfo {
  path: string
  name: string
  file_count: number
  total_size: number
  status: string
  progress_pct: number | null
  manifest_addr: string | null
  recovery_tx_hash: string | null
}

defineProps<{
  folder: FolderInfo
  active?: boolean
}>()

defineEmits<{
  start: [path: string]
}>()

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
</script>
