// Socket wiring for one Blockout Royale match. Contains no rules — every
// decision is made by game.js. Binds to loopback; nginx is what faces the
// network.

import { WebSocketServer } from 'ws'
import {
  ARENAS,
  BOT_FILL_TO,
  MAX_PLAYERS,
  createMatch,
  addPlayer,
  removePlayer,
  move,
  wantBots,
  usePowerup,
  startRound,
  tick,
  snapshot,
  TICK_MS,
  SIZE,
} from './game.js'
import { boardFor } from './board.js'
import { keeper } from './board-store.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8081

// The operator console's shared secret. This is a lab control, not a security
// boundary: the protocol is deliberately plain ws:// so it can be read in a
// packet capture, which means this key can be read there too.
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin'

const match = createMatch()
match.botFill = BOT_FILL_TO

// Which socket belongs to which player, so an operator can actually drop one.
const sockets = new Map()
// ws defaults to a 100 MiB maxPayload; the largest legal message here is a
// short join frame, so bound it hard to keep an oversized frame from ever
// reaching the message handler.
const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 4096 })

// The standing leaderboard. Loaded once at boot — it is the only thing about
// this process that outlives it — and handed to the match so the strip rides
// along in the snapshot that already goes out to everyone.
const keep = keeper(boardFor('blockout'))
match.board = keep.top()

/**
 * Everyone this match should be credited to, as it ended.
 *
 * Every person still connected, bots excluded. Someone who arrived in the last
 * few seconds is counted as having played a match they barely saw; the
 * alternative is three different definitions of "took part" across three games
 * for a distinction nobody reads.
 */
const played = () =>
  match.players
    .filter((p) => !p.bot)
    .map((p) => ({
      name: p.name,
      bot: false,
      won: p.id === match.winnerId,
      kills: 0,
      deaths: 0,
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
        match.arena = msg.name
        startRound(match, () => ARENAS.indexOf(msg.name) / ARENAS.length)
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
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, size: SIZE }))
    } else if (msg?.t === 'move' && player) {
      move(match, player.id, msg.dir)
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

  // A client that drops mid-frame is not a server error.
  ws.on('error', () => ws.close())
})

// Advance by real elapsed time rather than by the nominal tick. setInterval
// drifts under load, and a fixed step means every duration in the match — the
// collapse rate, the countdown, powerup spawns — silently runs slow when the
// box is busy.
// Clamped, because a stall or a laptop sleep would otherwise hand the
// simulation one enormous step and collapse the whole board at once. The
// catch-up loops in tick() handle the remainder on the following ticks.
let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt = Math.min(now - last, TICK_MS * 5)
  last = now
  tick(match, dt)
  // Banked on the frame a ROUND ends, not the match. Rounds here are short and
  // self-contained — the floor falls away, somebody is last off it — so the
  // round is the unit worth recording. The match on top of it is what decides
  // the victory screen, not what reaches the board.
  if (keep.bank(match.phase === 'over', played)) match.board = keep.top()

  // One frame for everybody, built once. Anyone holding a foresight gets their
  // own, because it carries the next wave and nobody else may see it — that is
  // rare enough that it is a second stringify, not N of them.
  const shared = JSON.stringify(snapshot(match))
  const seers = new Set(
    match.players.filter((p) => p.seeingUntil > match.now).map((p) => p.id),
  )
  for (const client of wss.clients) {
    if (client.readyState !== client.OPEN) continue
    client.send(seers.has(client.playerId) ? JSON.stringify(snapshot(match, client.playerId)) : shared)
  }
}, TICK_MS)

console.log(`Blockout Royale match server on ws://${HOST}:${PORT}`)
