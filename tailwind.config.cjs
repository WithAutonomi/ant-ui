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
        // Theme-aware tokens: resolved via CSS custom properties. Dark values
        // are the fallback (no `light` class on <html>) so the app renders
        // correctly before settings load. Light-mode overrides live in
        // assets/css/main.css under `:root.light`.
        autonomi: {
          blue: '#4A9FE5',
          dark: 'var(--autonomi-dark, #0A0F1C)',
          surface: 'var(--autonomi-surface, #141B2D)',
          border: 'var(--autonomi-border, #1E2A3F)',
          text: 'var(--autonomi-text, #E2E8F0)',
          muted: 'var(--autonomi-muted, #64748B)',
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
