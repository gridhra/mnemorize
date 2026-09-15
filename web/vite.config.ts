import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: webRoot,
  plugins: [preact()],
  server: {
    port: 5173,
    strictPort: true,
    // 開発中は API と添付配信を Hono（8790）へ回す。
    proxy: {
      '/api': { target: 'http://localhost:8790', changeOrigin: false },
      '/files': { target: 'http://localhost:8790', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
