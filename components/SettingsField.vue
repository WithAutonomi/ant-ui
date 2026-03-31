<template>
  <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
    <div>
      <h3 class="text-sm font-medium">{{ label }}</h3>
      <p v-if="description" class="text-xs text-autonomi-muted">{{ description }}</p>
      <p class="mt-0.5 font-mono text-xs text-autonomi-muted">{{ value }}</p>
    </div>
    <button
      class="rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
      @click="$emit('edit')"
    >
      Edit
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  description?: string
  value: string
}>()

defineEmits<{
  edit: []
}>()
</script>
