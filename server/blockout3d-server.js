// Socket wiring for one Blockout Royale 3D match. Contains no rules — every
// decision is made by blockout3d.js. Binds to loopback; nginx faces the network.

import { WebSocketServer } from 'ws'
import {
  BOT_FILL_TO,
  MAX_PLAYERS,
  FLOORS,
  SIZE,
  TICK_MS,
  createMatch,
  addPlayer,
  removePlayer,
  input,
  stomp,
  wantBots,
  usePowerup,
  startRound,
  tick,
  snapshot,
} from './blockout3d.js'
import { boardFor } from './board.js'
import { keeper } from './board-store.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8085

// The operator console's shared secret. A lab control, not a security boundary:
// the protocol is deliberately plain ws:// so it can be read in a packet
// capture, which means this key can be read there too.
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin'

const match = createMatch()
match.botFill = BOT_FILL_TO

const sockets = new Map()
// ws defaults to a 100 MiB maxPayload; the largest legal message here is a short
// join frame, so bound it hard.
const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 4096 })

const keep = keeper(boardFor('blockout3d'))
match.board = keep.top()

/**
 * Everyone this round should be credited to, as it ended. Bots excluded.
 *
 * Unlike flat Blockout, this game has real kills — a stomp, a sinkhole and a
 * landing all have an author — so the board gets a K/D worth reading.
 */
const played = () =>
  match.players
    .filter((p) => !p.bot)
    .map((p) => ({
      name: p.name,
      bot: false,
      won: p.id === match.winnerId,
      kills: p.kills,
      deaths: p.deaths,
    }))

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
      } else if (msg.t === 'restart') {
        startRound(match)
      } else if (msg.t === 'botsonly' && typeof msg.on === 'boolean') {
        match.botsOnly = msg.on
      } else if (msg.t === 'bots' && Number.isInteger(msg.n)) {
        match.botFill = Math.max(0, Math.min(MAX_PLAYERS, msg.n))
      }
      return
    }

    if (msg?.t === 'join' && !player) {
      player = addPlayer(match, msg.name)
      sockets.set(player.id, ws)
      ws.playerId = player.id
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, size: SIZE, floors: FLOORS }))
    } else if (msg?.t === 'input' && player) {
      input(match, player.id, msg.dir)
    } else if (msg?.t === 'stomp' && player) {
      stomp(match, player.id)
    } else if (msg?.t === 'ready' && player) {
      wantBots(match)
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

  ws.on('error', () => ws.close())
})

// Advance by real elapsed time rather than by the nominal tick. setInterval
// drifts under load, and a fixed step means every duration in the match runs
// slow when the box is busy. Clamped, because a laptop sleep would otherwise
// hand the simulation one enormous step.
let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt = Math.min(now - last, TICK_MS * 5)
  last = now
  tick(match, dt)
  // Banked on the frame a ROUND ends, as flat Blockout does: rounds here are
  // short and self-contained, so the round is the unit worth recording.
  if (keep.bank(match.phase === 'over', played)) match.board = keep.top()

  const shared = JSON.stringify(snapshot(match))
  const seers = new Set(
    match.players.filter((p) => p.seeingUntil > match.now).map((p) => p.id),
  )
  for (const client of wss.clients) {
    if (client.readyState !== client.OPEN) continue
    client.send(
      seers.has(client.playerId) ? JSON.stringify(snapshot(match, client.playerId)) : shared,
    )
  }
}, TICK_MS)

console.log(`Blockout Royale 3D match server on ws://${HOST}:${PORT}`)
