import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'screenshots/**',
  outputDir: 'test-results',
  timeout: 30_000,
})
