import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The agent server's HTTP API (sessions, voices, voice previews). In
    // production the same server serves this app, so /api is same-origin.
    proxy: {
      '/api': `http://localhost:${process.env.HTTP_PORT ?? 3000}`,
    },
  },
})
