import { defineConfig } from '@playwright/test'

// The README's screenshots, regenerated with `pnpm screenshots` rather than with the tests.
export default defineConfig({
  testDir: 'e2e/screenshots',
  outputDir: 'test-results/screenshots',
  timeout: 120_000,
})
