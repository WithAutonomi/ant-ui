/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './components/**/*.{vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        autonomi: {
          blue: '#4A9FE5',
          dark: '#0A0F1C',
          surface: '#141B2D',
          border: '#1E2A3F',
          text: '#E2E8F0',
          muted: '#64748B',
          success: '#22C55E',
          warning: '#EAB308',
          error: '#EF4444',
          salmon: '#FF6E82',
        },
      },
    },
  },
  plugins: [],
}
