<template>
  <div class="uploads-page">
    <div class="page-header">
      <h1 class="text-2xl font-semibold text-autonomi-text">Folder Uploads</h1>
      <p class="text-autonomi-muted mt-1">
        Drop folders into the staging directory to upload them to Autonomi.
      </p>
    </div>

    <!-- Staging directory -->
    <div class="card mt-6">
      <h2 class="text-lg font-medium text-autonomi-text mb-3">Staging Directory</h2>
      <div class="flex items-center gap-3">
        <input
          v-model="stagingDir"
          type="text"
          class="flex-1 bg-autonomi-dark border border-autonomi-border rounded px-3 py-2 text-autonomi-text text-sm"
          placeholder="~/Autonomi Uploads"
          @change="setStagingDir"
        />
        <button
          class="btn btn-primary text-sm"
          @click="scanStaging"
        >
          Scan for new folders
        </button>
      </div>
    </div>

    <!-- Upload queue -->
    <div class="mt-6 space-y-4">
      <!-- Uploading -->
      <div v-if="status.uploading" class="card">
        <h2 class="text-lg font-medium text-autonomi-text mb-3">Uploading</h2>
        <UploadQueueItem
          :folder="status.uploading"
          :active="true"
          @start="startUpload"
        />
      </div>

      <!-- Pending -->
      <div v-if="status.pending.length" class="card">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-medium text-autonomi-text">Pending ({{ status.pending.length }})</h2>
          <button
            v-if="status.pending.length > 1"
            class="btn btn-primary text-sm"
            @click="uploadAll"
          >
            Upload All
          </button>
        </div>
        <UploadQueueItem
          v-for="folder in status.pending"
          :key="folder.path"
          :folder="folder"
          @start="startUpload"
        />
      </div>

      <!-- Completed -->
      <div v-if="status.completed.length" class="card">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-medium text-autonomi-text">Completed ({{ status.completed.length }})</h2>
          <button
            class="text-autonomi-muted hover:text-autonomi-text text-sm"
            @click="clearCompleted"
          >
            Clear
          </button>
        </div>
        <div
          v-for="folder in status.completed"
          :key="folder.name"
          class="flex items-center justify-between py-2 border-b border-autonomi-border last:border-0"
        >
          <div class="flex items-center gap-3">
            <StatusBadge status="completed" />
            <span class="text-autonomi-text">{{ folder.name }}</span>
            <span class="text-autonomi-muted text-sm">{{ folder.file_count }} files</span>
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span v-if="folder.manifest_addr" class="text-autonomi-muted font-mono text-xs">
              {{ folder.manifest_addr.slice(0, 16) }}...
            </span>
            <span v-if="folder.recovery_tx_hash" class="text-green-400 text-xs" title="Recovery backup on Arbitrum">
              🔒 backed up
            </span>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-if="!status.pending.length && !status.uploading && !status.completed.length"
        class="card text-center py-12"
      >
        <p class="text-autonomi-muted">
          No folders queued. Drop a folder into the staging directory and click "Scan for new folders."
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

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

interface UploadStatus {
  pending: FolderInfo[]
  uploading: FolderInfo | null
  completed: FolderInfo[]
}

const stagingDir = ref('')
const status = ref<UploadStatus>({ pending: [], uploading: null, completed: [] })

onMounted(async () => {
  await refreshStatus()
})

async function refreshStatus() {
  status.value = await invoke('get_upload_status')
}

async function setStagingDir() {
  await invoke('set_staging_dir', { path: stagingDir.value })
}

async function scanStaging() {
  await invoke('scan_staging')
  await refreshStatus()
}

async function startUpload(folderPath: string) {
  await invoke('start_upload', { folderPath, recovery: true })
  await refreshStatus()
}

async function uploadAll() {
  for (const folder of status.value.pending) {
    await startUpload(folder.path)
  }
}

async function clearCompleted() {
  await invoke('clear_completed')
  await refreshStatus()
}
</script>
