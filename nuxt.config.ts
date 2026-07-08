export default defineNuxtConfig({
  ssr: false,
  telemetry: false,
  devtools: { enabled: false },

  modules: [
    '@pinia/nuxt',
  ],

  // Keep the frontend dev-server file watcher out of the Rust side. Tauri's
  // own Cargo watcher handles src-tauri; letting Nuxt/Vite recurse into it
  // means watching src-tauri/target (thousands of build artifacts), which
  // exhausts the macOS per-process open-file limit (kern.maxfilesperproc,
  // 10240) and causes EMFILE "too many open files" crashes + a blank window.
  ignore: ['**/src-tauri/**'],

  css: ['~/assets/css/main.css'],

  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },

  vite: {
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_'],
    server: {
      strictPort: true,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    resolve: {
      dedupe: ['vue'],
    },
    build: {
      // Disable auto-generated <link rel="modulepreload"> tags. In a Tauri
      // SPA the user rarely navigates to all routes immediately, so the
      // browser warns "resource preloaded but not used within a few seconds"
      // for every unused chunk (55+ per session). Loading from local app
      // resources is fast enough that we don't need the prefetch.
      modulePreload: false,
    },
  },

  compatibilityDate: '2024-11-01',
})
