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
  },

  compatibilityDate: '2024-11-01',
})
