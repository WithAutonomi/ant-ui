import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    environmentOptions: {
      nuxt: {
        domEnvironment: 'happy-dom',
      },
    },
    setupFiles: ['./tests/mocks/appkit.ts'],
    // Default excludes plus .claude/: git worktrees under .claude/worktrees/
    // carry their own copies of the test tree, and running them against this
    // root's config produces phantom failures.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
