import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import pkg from './package.json' with { type: 'json' }

// The renderer has its own, since a browser on another device can't ask Electron.
const buildInfo = {
  __BUILD_TIME__: JSON.stringify(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`),
  __APP_VERSION__: JSON.stringify(pkg.version),
}

export default defineConfig({
  main: {
    define: buildInfo,
  },
  preload: {
    build: {
      // Sandboxed preload scripts can't load ES modules.
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    define: buildInfo,
    resolve: {
      alias: { '@': resolve('src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
})
