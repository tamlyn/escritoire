import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      // electron-vite bundles `?modulePath` imports (worker threads) separately and
      // returns the bundle's path. Under test, Node runs the TypeScript source itself.
      name: 'module-path',
      enforce: 'pre',
      resolveId(id, importer) {
        if (!id.endsWith('?modulePath') || !importer) return
        return `\0module-path:${resolve(importer, '..', id.slice(0, -'?modulePath'.length))}.ts`
      },
      load(id) {
        if (id.startsWith('\0module-path:')) return `export default ${JSON.stringify(id.slice('\0module-path:'.length))}`
      },
    },
  ],
  test: { include: ['src/**/*.test.ts'] },
})
