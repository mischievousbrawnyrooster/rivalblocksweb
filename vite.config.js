import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on every interface, not just loopback. Without this the dev
    // server is unreachable from anywhere but the box it runs on, and plain
    // `npm run dev` silently reverts to localhost-only.
    host: true,
    // Where vite forwards /ws to. A destination, not a bind address — this
    // one stays loopback, because the game server is on the same machine.
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8081', ws: true },
      // Fracture Line is its own process on its own port, so a crash in one
      // match server cannot take the other game down with it.
      // The path must NOT begin with '/ws': proxy keys match by prefix, here
      // and in nginx, so '/ws-fracture' would be swallowed by the rule above
      // and quietly served the wrong game.
      '/fracture-ws': { target: 'ws://127.0.0.1:8082', ws: true },
    },
  },
})
