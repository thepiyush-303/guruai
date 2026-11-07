import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The GuruAI server: its HTTP API and its WebSocket (/ws), both on one
    // port. In production the same server serves this app, so both are
    // same-origin (or VITE_WS_URL points at a separately hosted server).
    proxy: {
      '/api': `http://localhost:${process.env.HTTP_PORT ?? 3000}`,
      '/ws': { target: `ws://localhost:${process.env.HTTP_PORT ?? 3000}`, ws: true },
    },
  },
})
