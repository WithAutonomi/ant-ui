<template>
  <div>
    <!-- Actions bar -->
    <div class="mb-4 flex items-center gap-3">
      <button
        class="rounded-md bg-autonomi-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="!nodesStore.daemonConnected"
        @click="showAddDialog = true"
      >
        {{ $t('nodes.add_button') }}
      </button>
      <button
        class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="!nodesStore.daemonConnected"
        @click="nodesStore.startAll()"
      >
        {{ $t('nodes.start_all') }}
      </button>
      <button
        class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="!nodesStore.daemonConnected"
        @click="confirmStopAll"
      >
        {{ $t('nodes.stop_all') }}
      </button>

      <div class="flex-1" />

      <!-- Always-visible fleet health indicator -->
      <FleetHealthIndicator v-if="nodesStore.daemonConnected" />

      <!-- Summary stats -->
      <div class="flex items-center gap-4 text-xs text-autonomi-muted">
        <span><span class="text-autonomi-success">●</span> {{ $t('nodes.running_count', { count: nodesStore.running }) }}</span>
        <span v-if="nodesStore.stopped > 0"><span class="text-autonomi-muted">○</span> {{ $t('nodes.stopped_count', { count: nodesStore.stopped }) }}</span>
        <span v-if="nodesStore.errored > 0"><span class="text-autonomi-error">●</span> {{ $t('nodes.errored_count', { count: nodesStore.errored }) }}</span>
        <span v-if="nodesStore.evicted > 0"><span class="text-autonomi-error">●</span> {{ $t('nodes.evicted_count', { count: nodesStore.evicted }) }}</span>
      </div>

      <input
        v-model="filterText"
        type="text"
        :placeholder="$t('nodes.filter_placeholder')"
        :aria-label="$t('nodes.filter_aria_label')"
        class="w-48 rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 text-sm text-autonomi-text placeholder-autonomi-muted focus:border-autonomi-blue focus:outline-none"
      />

    </div>

    <!-- Disk usage: one bar per drive that holds node data. Multi-drive layouts
         arise when the storage location is changed (existing nodes keep their
         old directory), so each volume is shown separately. -->
    <div
      v-if="nodesStore.daemonConnected && nodesStore.total > 0 && nodesStore.driveUsageByVolume.length > 0"
    >
      <!-- Shared colour key, once — the per-drive bars below carry only labels + figures. -->
      <NodesDiskUsageKey />
      <NodesDiskUsageBar
        v-for="vol in nodesStore.driveUsageByVolume"
        :key="vol.key"
        :label="vol.label"
        :used="vol.used"
        :min="vol.min"
        :total="vol.total"
        :available="vol.available"
        :node-count="vol.nodeCount"
      />
    </div>

    <!-- Initializing state -->
    <div v-if="nodesStore.initializing" class="flex flex-col items-center justify-center py-20">
      <div class="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-autonomi-blue border-t-transparent" />
      <p class="text-sm text-autonomi-muted">{{ $t('nodes.starting_daemon') }}</p>
    </div>

    <!-- Restarting state — takes priority over disconnected so the UI doesn't
         flicker the "Cannot connect" panel during an intentional restart. -->
    <div v-else-if="nodesStore.restarting" class="flex flex-col items-center justify-center py-20">
      <div class="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-autonomi-blue border-t-transparent" />
      <p class="text-sm text-autonomi-muted">{{ $t('nodes.restarting_daemon') }}</p>
      <p class="mt-1 text-xs text-autonomi-muted">{{ $t('nodes.nodes_keep_running') }}</p>
    </div>

    <!-- Disconnected state -->
    <div v-else-if="!nodesStore.daemonConnected" class="flex flex-col items-center justify-center py-20">
      <div class="rounded-full border border-autonomi-error/30 bg-autonomi-error/5 p-4">
        <svg class="h-8 w-8 text-autonomi-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <p class="mt-3 text-sm text-autonomi-muted">{{ $t('nodes.daemon_disconnected') }}</p>
      <p class="mt-1 text-xs text-autonomi-muted">{{ $t('nodes.daemon_retrying') }}</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="filteredNodes.length === 0" class="flex flex-col items-center justify-center py-20">
      <div class="rounded-full border border-autonomi-border bg-autonomi-surface p-4">
        <svg class="h-8 w-8 text-autonomi-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
        </svg>
      </div>
      <p class="mt-3 text-sm text-autonomi-muted">{{ $t('nodes.empty_title') }}</p>
      <p class="mt-1 text-xs text-autonomi-muted">{{ $t('nodes.empty_hint') }}</p>
    </div>

    <!-- Tile view -->
    <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <NodesNodeTile
        v-for="node in filteredNodes"
        :key="node.id"
        :node="node"
        :selected="selectedId === node.id"
        @select="toggleSelect"
        @dismiss="dismissNode"
      />
    </div>

    <!-- Detail panel (slides in below when a node is selected) -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-if="selectedNode" class="mt-4">
        <NodesNodeDetailPanel
          :node="selectedNode"
          @close="selectedId = null"
          @start="nodesStore.startNode($event)"
          @stop="nodesStore.stopNode($event)"
          @remove="confirmRemove($event)"
        />
      </div>
    </Transition>

    <!-- Add Node Dialog -->
    <NodesAddNodeDialog :open="showAddDialog" @close="showAddDialog = false" />

    <!-- Confirm Dialog -->
    <Teleport to="body">
      <div
        v-if="confirmDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        @click.self="confirmDialog = null"
      >
        <div role="dialog" aria-modal="true" :aria-label="$t('nodes.confirm_action')" class="w-80 rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
          <p class="mb-4 text-sm">{{ confirmDialog.message }}</p>
          <div class="flex justify-end gap-2">
            <button
              class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted"
              @click="confirmDialog = null"
            >
              {{ $t('common.cancel') }}
            </button>
            <button
              class="rounded-md bg-autonomi-error px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              @click="executeConfirm"
            >
              {{ $t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useNodesStore } from '~/stores/nodes'

const { t } = useI18n()
const nodesStore = useNodesStore()
const filterText = ref('')
const selectedId = ref<number | null>(null)
const showAddDialog = ref(false)

interface ConfirmAction {
  message: string
  action: () => void
}
const confirmDialog = ref<ConfirmAction | null>(null)

const filteredNodes = computed(() => {
  let nodes = [...nodesStore.nodes]
  if (filterText.value) {
    const q = filterText.value.toLowerCase()
    nodes = nodes.filter(n =>
      String(n.id).includes(q) ||
      n.status.includes(q) ||
      (n.name && n.name.toLowerCase().includes(q)) ||
      n.version.toLowerCase().includes(q)
    )
  }
  return nodes
})

const selectedNode = computed(() => {
  if (selectedId.value === null) return null
  return nodesStore.nodes.find(n => n.id === selectedId.value) ?? null
})

function toggleSelect(id: number) {
  selectedId.value = selectedId.value === id ? null : id
}

function dismissNode(id: number) {
  nodesStore.dismissNode(id)
  if (selectedId.value === id) selectedId.value = null
}

function confirmRemove(id: number) {
  confirmDialog.value = {
    message: t('nodes.remove_node_message', { id }),
    action: () => {
      nodesStore.removeNode(id)
      if (selectedId.value === id) selectedId.value = null
    },
  }
}

function confirmStopAll() {
  confirmDialog.value = {
    message: t('nodes.stop_all_message', { count: nodesStore.running }),
    action: () => nodesStore.stopAll(),
  }
}

function executeConfirm() {
  confirmDialog.value?.action()
  confirmDialog.value = null
}
</script>
