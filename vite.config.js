import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Mirrors what nginx does in production, so /ws works the same in both.
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8081', ws: true },
    },
  },
})
