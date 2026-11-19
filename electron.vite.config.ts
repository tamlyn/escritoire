import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    define: {
      __BUILD_TIME__: JSON.stringify(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`),
    },
  },
  preload: {
    build: {
      // Sandboxed preload scripts can't load ES modules.
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
})
