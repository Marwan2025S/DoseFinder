import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BACKEND_URL: set by docker-compose (http://backend:3000) or defaults to localhost
const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.js'],
  },
  server: {
    allowedHosts: ['.trycloudflare.com', '.shares.zrok.io'],
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/health': {
        target: backendUrl,
        changeOrigin: true,
      },
    },
  },
})
