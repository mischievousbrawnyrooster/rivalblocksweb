// Socket wiring for one Fracture Line match. Contains no rules — every
// decision is made by fracture.js. Binds to loopback; nginx is what faces the
// network. Its own process on its own port, so Blockout Royale on 8081 is
// untouched by anything that happens here.

import { WebSocketServer } from 'ws'
import {
  ARENAS,
  MAX_PLAYERS,
  startMatch,
  createMatch,
  addPlayer,
  removePlayer,
  setInput,
  build,
  dash,
  usePowerup,
  tick,
  snapshot,
  TICK_MS,
  BOT_FILL_TO,
  W,
  H,
} from './fracture.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8082

// The operator console's shared secret. This is a lab control, not a security
// boundary: the protocol is deliberately plain ws:// so it can be read in a
// packet capture, which means this key can be read there too. Anyone on the
// segment who can see a frame can send one. Put TLS and a real credential in
// front of this before the port is reachable from anywhere untrusted.
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin'

const match = createMatch()
// Configuration, not a rule: how many participants this deployment wants in the
// arena. fracture.js owns what a bot actually does.
match.botFill = BOT_FILL_TO
// ws defaults to a 100 MiB maxPayload; the largest legal message here is a
// short input frame, so bound it hard to keep an oversized frame from ever
// reaching the message handler.
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
    // --- operator console ------------------------------------------------
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
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, w: W, h: H }))
    } else if (msg?.t === 'input' && player) {
      setInput(match, player.id, msg)
    } else if (msg?.t === 'build' && player) {
      build(match, player.id)
    } else if (msg?.t === 'dash' && player) {
      dash(match, player.id)
    } else if (msg?.t === 'use' && player) {
      usePowerup(match, player.id)
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
// dash cooldown, respawns, the match countdown — silently runs slow when the
// box is busy. A two second cooldown has to be two seconds.
// Clamped, because a stall or a laptop sleep would otherwise hand the
// simulation one enormous step and teleport every round in flight.
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

console.log(`Fracture Line match server on ws://${HOST}:${PORT}`)
