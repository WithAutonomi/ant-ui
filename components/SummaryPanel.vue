<template>
  <div
    class="flex items-center gap-2 rounded border px-3 py-1.5 text-sm"
    :class="flash
      ? 'border-autonomi-salmon'
      : 'border-autonomi-border'"
  >
    <span v-if="icon" :style="{ color: iconColor }" class="text-xs">{{ icon }}</span>
    <span class="font-medium text-autonomi-text">{{ title }}</span>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  icon?: string
  iconColor?: string
  flash?: boolean
}>()
</script>
