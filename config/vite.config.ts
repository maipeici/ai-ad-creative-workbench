import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const fromRoot = (relative: string) => fileURLToPath(new URL('../' + relative, import.meta.url))

export default defineConfig({
  root: fromRoot('src/client'),
  publicDir: fromRoot('assets/public'),
  plugins: [react()],
  css: { postcss: fromRoot('config') },
  server: {
    port: 5173,
    // Match endpoint boundaries so the frontend /api.ts module is not proxied.
    proxy: {
      '^/api(?:/|$)': 'http://localhost:8787',
      '^/media(?:/|$)': 'http://localhost:8787',
    },
  },
  build: {
    outDir: fromRoot('dist'),
    emptyOutDir: true,
  },
})
