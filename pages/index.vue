<template>
  <div />
</template>

<script setup lang="ts">
// '/' has no page of its own — Files is the app's landing page and Nodes
// lives at /nodes. Route-level redirect (not navigateTo-in-setup, which
// suspends the initial SPA render and blanks the window on boot): the
// router swaps the path before any component mounts, and '/' never enters
// history.
definePageMeta({ redirect: '/files' })
</script>
