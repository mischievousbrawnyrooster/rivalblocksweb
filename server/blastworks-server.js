// Socket wiring for one Blastworks match. Contains no rules — every decision is
// made by blastworks.js. Binds to loopback; nginx is what faces the network.
// Its own process on its own port, so neither of the other two match servers is
// affected by anything that happens here.

import { WebSocketServer } from 'ws'
import {
  ARENAS,
  MODES,
  MAX_PLAYERS,
  createMatch,
  addPlayer,
  removePlayer,
  setInput,
  wantBots,
  drop,
  handle,
  detonateAll,
  startMatch,
  tick,
  snapshot,
  TICK_MS,
  W,
  H,
} from './blastworks.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8083
// One binary, two servers: the mode is picked at boot rather than per match, so
// a player who joins knows what they are joining without asking.
const MODE = MODES.includes(process.env.MODE) ? process.env.MODE : MODES[0]

// The operator console's shared secret. This is a lab control, not a security
// boundary: the protocol is deliberately plain ws:// so it can be read in a
// packet capture, which means this key can be read there too.
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin'

const match = createMatch(Math.random, undefined, MODE)
// ws defaults to a 100 MiB maxPayload; the largest legal message here is a
// short input frame, so bound it hard.
const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 4096 })

// Which socket belongs to which player, so an operator can actually drop one.
const sockets = new Map()

wss.on('connection', (ws) => {
  let player = null
  let admin = false

  ws.on('message', (raw) => {
    let msg
    // One malformed client must not be able to take the match down.
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg?.t === 'admin') {
      admin = msg.key === ADMIN_KEY
      ws.send(JSON.stringify({ t: 'admin', ok: admin }))
      return
    }
    if (admin) {
      if (msg.t === 'kick' && Number.isInteger(msg.id)) {
        const target = sockets.get(msg.id)
        removePlayer(match, msg.id)
        if (target) target.close()
      } else if (msg.t === 'arena' && ARENAS.includes(msg.name)) {
        startMatch(match, Math.random, msg.name)
      } else if (msg.t === 'restart') {
        startMatch(match)
      } else if (msg.t === 'botsonly' && typeof msg.on === 'boolean') {
        match.botsOnly = msg.on
      } else if (msg.t === 'bots' && Number.isInteger(msg.n)) {
        match.botFill = Math.max(0, Math.min(MAX_PLAYERS, msg.n))
      }
      return
    }

    if (msg?.t === 'join' && !player) {
      player = addPlayer(match, msg.name)
      if (!player) {
        ws.send(JSON.stringify({ t: 'full' }))
        ws.close()
        return
      }
      sockets.set(player.id, ws)
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, w: W, h: H, mode: MODE }))
    } else if (msg?.t === 'input' && player) {
      setInput(match, player.id, msg)
    } else if (msg?.t === 'bomb' && player) {
      drop(match, player.id)
    } else if (msg?.t === 'ready' && player) {
      wantBots(match)
    } else if (msg?.t === 'detonate' && player) {
      detonateAll(match, player.id)
    } else if (msg?.t === 'action' && player) {
      handle(match, player.id)
    }
  })

  ws.on('close', () => {
    if (player) {
      sockets.delete(player.id)
      removePlayer(match, player.id)
    }
  })

  // A client that drops mid-frame is not a server error.
  ws.on('error', () => ws.close())
})

// Advance by real elapsed time rather than by the nominal tick. setInterval
// drifts under load, and a fixed step means every duration in the game — the
// fuse above all — silently runs slow when the box is busy. A two second fuse
// has to be two seconds.
// Clamped, because a stall would otherwise hand the simulation one enormous
// step and detonate the whole board at once.
let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt = Math.min(now - last, TICK_MS * 5)
  last = now
  tick(match, dt)
  const frame = JSON.stringify(snapshot(match))
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(frame)
  }
}, TICK_MS)

console.log(`Blastworks (${MODE}) match server on ws://${HOST}:${PORT}`)
