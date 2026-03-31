<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        role="alert"
        class="pointer-events-auto rounded border px-4 py-2 text-sm shadow-lg"
        :class="toastClass(toast.level)"
      >
        <div class="flex items-center gap-2">
          <span aria-hidden="true">{{ toastIcon(toast.level) }}</span>
          <span>{{ toast.message }}</span>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useToastStore } from '~/stores/toasts'

const toastStore = useToastStore()
const toasts = computed(() => toastStore.toasts)

function toastClass(level: string) {
  switch (level) {
    case 'error': return 'border-autonomi-error bg-red-950 text-autonomi-error'
    case 'warning': return 'border-autonomi-warning bg-yellow-950 text-autonomi-warning'
    default: return 'border-autonomi-blue bg-blue-950 text-autonomi-blue'
  }
}

function toastIcon(level: string) {
  switch (level) {
    case 'error': return '✖'
    case 'warning': return '⚠'
    default: return 'ℹ'
  }
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(100px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(100px);
}
</style>
