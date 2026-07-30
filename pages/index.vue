<template>
  <div />
</template>

<script setup lang="ts">
// '/' has no page of its own — Files is the app's landing page and Nodes
// lives at /nodes. Replace (not push) so Back never bounces through here.
await navigateTo('/files', { replace: true })
</script>
