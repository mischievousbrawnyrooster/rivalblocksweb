// Socket wiring for one Void Drillers match. Contains no rules: every
// decision is made by voiddrillers.js. Binds to loopback; nginx / Vite faces
// the network.

import { WebSocketServer, WebSocket } from 'ws'
import {
  make,
  join,
  leave,
  setInput,
  tick,
  snapshot,
  encodeMap,
  canRun,
  wantBots,
  BOT_FILL_TO,
  MAX_PLAYERS,
  WIDTH,
  DEPTH,
  TICK_MS,
} from './voiddrillers.js'
import { boardFor } from './board.js'
import { keeper } from './board-store.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8086
const RESET_DELAY_MS = 5000

// The operator console's shared secret. A lab control, not a security boundary:
// the protocol is deliberately plain ws:// so it can be read in a packet
// capture, which means this key can be read there too.
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin'

let match = make({ seed: Date.now(), botFill: BOT_FILL_TO })
let overSince = 0

// Map player ID -> WebSocket
const sockets = new Map()

const keep = keeper(boardFor('voiddrillers'))
match.board = keep.top()

// Someone who only watched this round was not in it, so is not banked.
const played = () =>
  [...match.players.values()].filter((p) => !p.spectating).map((p) => ({
    name: p.name,
    bot: Boolean(p.bot),
    won: p.id === match.winner,
    kills: 0,
    deaths: p.alive ? 0 : 1,
    // Only a vault touchdown is a clear time. Outlasting a rival wins without one,
    // or a rival walking out a second in would set the record.
    time: p.id === match.winner && match.winReason === 'vault' ? match.elapsed : null,
  }))

// WebSocket server with maxPayload bound to 4096 bytes and cleartext perMessageDeflate disabled
const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: 4096,
  perMessageDeflate: false,
})

const welcome = (p) =>
  JSON.stringify({ t: 'welcome', id: p.id, slot: p.slot, width: WIDTH, depth: DEPTH, map: encodeMap(p.grid) })

// A fresh match, with everyone still connected carried into it.
function restartMatch() {
  overSince = 0
  const carried = [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN && c.player)
  // A driller who chose bots keeps them; otherwise the next match waits in the lobby.
  match = make({ seed: Date.now(), botFill: match.botFill, botsOnly: match.botsOnly, botsWanted: match.botsWanted })
  match.board = keep.top()
  sockets.clear()

  for (const ws of carried) {
    const p = join(match, { id: ws.player.id, name: ws.player.name })
    ws.player = p
    sockets.set(p.id, ws)
    ws.send(welcome(p))
  }
}

wss.on('connection', (ws) => {
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
      if (msg.t === 'kick' && (typeof msg.id === 'string' || typeof msg.id === 'number')) {
        const id = String(msg.id)
        const target = sockets.get(id)
        sockets.delete(id)
        leave(match, id)
        if (target) {
          target.player = null
          target.close()
        }
      } else if (msg.t === 'restart') {
        restartMatch()
      } else if (msg.t === 'botsonly' && typeof msg.on === 'boolean') {
        match.botsOnly = msg.on
      } else if (msg.t === 'bots' && typeof msg.n === 'number') {
        match.botFill = Math.max(0, Math.min(MAX_PLAYERS, msg.n))
      }
      return
    }

    if (msg?.t === 'join' && !ws.player) {
      // An empty server sitting on a finished match starts fresh for whoever arrives.
      if (match.phase === 'over' && match.players.size === 0) restartMatch()
      // join() stands a bot down to make room, and sanitizes the name.
      const player = join(match, { name: msg.name })
      if (!player) {
        ws.send(JSON.stringify({ t: 'full' }))
        ws.close()
        return
      }
      ws.player = player
      sockets.set(player.id, ws)
      ws.send(welcome(player))
    } else if (msg?.t === 'input' && ws.player) {
      // setInput type-checks every field itself.
      setInput(match, ws.player.id, msg)
    } else if (msg?.t === 'ready' && ws.player) {
      wantBots(match)
    } else if (msg?.t === 'restart') {
      if (match.phase === 'over' || admin) {
        restartMatch()
      }
    }
  })

  ws.on('close', () => {
    if (ws.player) {
      sockets.delete(ws.player.id)
      leave(match, ws.player.id)
      ws.player = null
    }
  })

  // A client that drops mid-frame is not a server error.
  ws.on('error', () => ws.close())
})

// Advance by real elapsed time rather than by the nominal tick. setInterval
// drifts under load, and a fixed step means durations in the game silently run slow.
// Clamped to avoid huge simulation jumps after machine stalls.
let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt = Math.min(now - last, TICK_MS * 5)
  last = now

  if (!canRun(match) && match.players.size === 0) {
    // Idle server with no players and botsOnly disabled
  } else {
    tick(match, dt)
  }

  if (keep.bank(match.phase === 'over', played)) {
    match.board = keep.top()
  }

  if (match.phase === 'over' && match.players.size > 0) {
    if (!overSince) {
      overSince = now
    } else if (now - overSince >= RESET_DELAY_MS) {
      restartMatch()
    }
  } else {
    overSince = 0
  }

  // One frame per socket: each driller is sent their own shaft's changes. Built
  // and sent in this same turn, because deltas ride in by live reference.
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(snapshot(match, client.player?.id)))
    }
  }
}, TICK_MS)

console.log(`Void Drillers match server on ws://${HOST}:${PORT}`)
