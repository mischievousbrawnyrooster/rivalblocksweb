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
  sanitizeName,
  canRun,
  wantBots,
  BOT_FILL_TO,
  TICK_MS,
} from './voiddrillers.js'
import { boardFor } from './board.js'
import { keeper } from './board-store.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8086
const RESET_DELAY_MS = 5000
const MAX_PLAYERS = 8

// The operator console's shared secret. A lab control, not a security boundary:
// the protocol is deliberately plain ws:// so it can be read in a packet
// capture, which means this key can be read there too.
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin'

let match = make({ seed: Date.now(), botFill: BOT_FILL_TO, botsWanted: true })
let overSince = 0

// Map player ID -> WebSocket
const sockets = new Map()

const keep = keeper(boardFor('voiddrillers'))
match.board = keep.top()

const played = () =>
  [...match.players.values()].map((p) => ({
    name: p.name,
    bot: Boolean(p.bot),
    won: p.id === match.winner,
    kills: 0,
    deaths: p.alive ? 0 : 1,
    time: p.id === match.winner ? match.elapsed : null,
  }))

// WebSocket server with maxPayload bound to 4096 bytes and cleartext perMessageDeflate disabled
const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: 4096,
  perMessageDeflate: false,
  handleProtocols: (protocols) => (protocols.has('voiddrillers.v1') ? 'voiddrillers.v1' : [...protocols][0] || false),
})

function restartMatch() {
  overSince = 0
  const activeSockets = []
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.player) {
      activeSockets.push({
        ws: client,
        id: client.player.id,
        name: client.player.name,
      })
    }
  }

  const prevBotFill = match.botFill ?? BOT_FILL_TO
  const prevBotsOnly = match.botsOnly ?? false
  const prevBotsWanted = match.botsWanted ?? true

  match = make({
    seed: Date.now(),
    botFill: prevBotFill,
    botsOnly: prevBotsOnly,
    botsWanted: prevBotsWanted,
  })
  match.board = keep.top()
  sockets.clear()

  for (const { ws, id, name } of activeSockets) {
    const p = join(match, { id, name })
    ws.player = p
    sockets.set(p.id, ws)
    ws.send(
      JSON.stringify({
        t: 'welcome',
        id: p.id,
        slot: p.slot,
        width: match.width,
        depth: match.depth,
        map: encodeMap(match.grid),
      }),
    )
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
      // If server was empty and in 'over' phase, fresh start for first joining player
      if (match.phase === 'over' && match.players.size === 0) {
        match = make({
          seed: Date.now(),
          botFill: match.botFill ?? BOT_FILL_TO,
          botsWanted: true,
          botsOnly: match.botsOnly ?? false,
        })
        match.board = keep.top()
        overSince = 0
      }

      if (match.players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'full' }))
        ws.close()
        return
      }

      const name = sanitizeName(msg.name)
      const player = join(match, { name })
      if (!player) {
        ws.send(JSON.stringify({ t: 'full' }))
        ws.close()
        return
      }

      ws.player = player
      sockets.set(player.id, ws)
      ws.send(
        JSON.stringify({
          t: 'welcome',
          id: player.id,
          slot: player.slot,
          width: match.width,
          depth: match.depth,
          map: encodeMap(match.grid),
        }),
      )
    } else if (msg?.t === 'input' && ws.player) {
      const cleanInput = {}
      if (typeof msg.dx === 'number' && Number.isFinite(msg.dx)) {
        cleanInput.dx = msg.dx
      }
      if (typeof msg.thrust === 'boolean') {
        cleanInput.thrust = msg.thrust
      }
      if (typeof msg.drill === 'boolean') {
        cleanInput.drill = msg.drill
      }
      if (typeof msg.aim === 'number' && Number.isFinite(msg.aim)) {
        cleanInput.aim = msg.aim
      }
      setInput(match, ws.player.id, cleanInput)
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

  const frame = JSON.stringify(snapshot(match))
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(frame)
    }
  }
}, TICK_MS)

console.log(`Void Drillers match server on ws://${HOST}:${PORT}`)
