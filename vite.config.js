import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { BOARDS } from './server/board.js'
import { boardDir } from './server/board-store.js'

/**
 * Serves the leaderboard files in dev, the way nginx serves them in
 * production. They are written at runtime by the match servers, so they cannot
 * live in `public/` — that gets copied into the build, and a stale board would
 * ship with the site.
 *
 * Only the four known filenames are served, and only from BOARD_DIR: the path
 * never comes from the request, so there is nothing here to traverse out of.
 */
const leaderboardFiles = () => ({
  name: 'rivalblocks-leaderboard',
  configureServer(server) {
    server.middlewares.use('/board', (req, res, next) => {
      const wanted = BOARDS.find((b) => req.url === `/${b.file}`)
      if (!wanted) return next()
      const path = join(boardDir(), wanted.file)
      // A server that has never finished a match has no file yet. That is an
      // empty board, not an error.
      if (!existsSync(path)) {
        res.statusCode = 404
        return res.end('{}')
      }
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-cache')
      return createReadStream(path).pipe(res)
    })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), leaderboardFiles()],
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
      '/blast-ws': { target: 'ws://127.0.0.1:8083', ws: true },
      // Same binary, second mode. Its own process, so one crashing takes
      // nothing else with it.
      '/blast-dm-ws': { target: 'ws://127.0.0.1:8084', ws: true },
    },
  },
})
