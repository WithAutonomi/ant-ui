<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="$emit('close')"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="cost-estimate-title" class="w-96 rounded-lg border border-autonomi-border bg-autonomi-dark p-6 shadow-xl">
        <h2 id="cost-estimate-title" class="mb-4 text-lg font-medium">{{ $t('files.cost_estimate.title') }}</h2>

        <div v-if="loading" class="flex flex-col items-center py-6">
          <p class="text-sm text-autonomi-muted">{{ $t('files.cost_estimate.loading') }}</p>
        </div>

        <div v-else-if="files.length === 0" class="py-4 text-center text-sm text-autonomi-muted">
          {{ $t('files.cost_estimate.no_files') }}
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="file in files"
            :key="file.name"
            class="flex items-center justify-between text-sm"
          >
            <span class="max-w-[200px] truncate">{{ file.name }}</span>
            <div class="text-right">
              <span v-if="file.size" class="text-autonomi-muted">{{ formatBytes(file.size) }}</span>
              <span v-if="file.cost" class="ml-2 text-autonomi-blue">{{ file.cost }}</span>
              <span v-else class="ml-2 text-autonomi-muted">—</span>
              <span v-if="file.gas_cost" class="ml-1 text-autonomi-muted">{{ $t('files.row.gas_suffix', { gas: file.gas_cost }) }}</span>
            </div>
          </div>

          <!-- Status line while (or after) quotes arrive. Connection-error is
               checked first so a failed connect surfaces even if some files
               happened to get quoted before the failure. -->
          <div v-if="!allCostsReal" class="border-t border-autonomi-border pt-3">
            <template v-if="connectionStore.hasFailed">
              <div class="space-y-2">
                <p class="text-sm text-yellow-500/80">
                  {{ $t('files.network.unavailable') }}
                </p>
                <p v-if="failedReason" class="text-xs text-autonomi-muted break-words">
                  {{ failedReason }}
                </p>
                <button
                  type="button"
                  class="rounded-md border border-autonomi-blue/40 px-2.5 py-1 text-xs font-medium text-autonomi-blue hover:bg-autonomi-blue/10"
                  @click="connectionStore.retry()"
                >
                  {{ $t('files.network.retry_connection') }}
                </button>
              </div>
            </template>
            <template v-else-if="connectionStore.isConnecting">
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
                <span>{{ $t('files.network.connecting') }}</span>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2 text-sm text-autonomi-muted">
                <div class="h-3 w-3 animate-spin rounded-full border-2 border-autonomi-blue border-t-transparent" />
                <span>{{ $t('files.network.obtaining_quotes') }}</span>
              </div>
            </template>
          </div>

          <p v-if="allCostsReal" class="text-xs text-autonomi-muted">
            {{ $t('files.cost_estimate.footnote') }}
          </p>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            class="rounded-md border border-autonomi-border px-3 py-1.5 text-sm text-autonomi-muted hover:text-autonomi-text"
            @click="$emit('close')"
          >
            {{ $t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { formatBytes } from '~/utils/formatters'
import { useConnectionStore } from '~/stores/connection'

const props = defineProps<{
  open: boolean
  files: { name: string; size: number; cost?: string; gas_cost?: string }[]
  loading: boolean
}>()

defineEmits<{ close: [] }>()

const connectionStore = useConnectionStore()
const allCostsReal = computed(() =>
  props.files.length > 0 && props.files.every(f => f.cost),
)
const failedReason = computed(() =>
  connectionStore.current.status === 'failed' ? connectionStore.current.reason : null,
)
</script>
