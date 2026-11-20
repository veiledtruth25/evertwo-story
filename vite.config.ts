import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const port = process.env.PORT ?? '8787'

export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') } },
  build: { outDir: resolve('out/web'), emptyOutDir: true },
  // In development the API server runs separately; the browser only talks to Vite.
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: false },
      '/media': `http://127.0.0.1:${port}`,
      '/download': `http://127.0.0.1:${port}`
    }
  }
})
