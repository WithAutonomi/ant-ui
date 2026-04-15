export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },

  modules: [
    '@pinia/nuxt',
  ],

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
