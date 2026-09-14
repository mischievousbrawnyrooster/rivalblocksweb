// WebSocket network adapter for Cipher Run. Authoritative match server on
// port 8087 (/cipherrun-ws). Contains zero game rules; all decisions are
// made by cipherrun.js.

import { WebSocketServer, WebSocket } from 'ws'
import {
  make,
  join,
  leave,
  processInput,
  tick,
  snapshot,
  sanitizeName,
  PROTOCOLS,
  TICK_MS,
  BOT_FILL_TO,
  MAX_PLAYERS,
  POST_RACE_GRACE_MS,
} from './cipherrun.js'
import { boardFor } from './board.js'
import { keeper } from './board-store.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8087
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin'

let currentProtocolIdx = 0
let match = make({ protocolId: PROTOCOLS[currentProtocolIdx].id, botFill: BOT_FILL_TO, botsWanted: true })
let overSince = 0

// Map player ID -> WebSocket
const sockets = new Map()

const keep = keeper(boardFor('cipherrun'))
match.board = keep.top()

const played = () =>
  [...match.players.values()].map((p) => ({
    name: p.name,
    bot: Boolean(p.bot),
    won: p.id === match.winner,
    kills: 0,
    deaths: 0,
    time: p.finished ? p.finishTime : null,
    wpm: p.finalWpm,
    acc: p.finalAcc,
  }))

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: 4096,
  perMessageDeflate: false,
  handleProtocols: (protocols) => (protocols.has('cipherrun.v1') ? 'cipherrun.v1' : [...protocols][0] || false),
})

function nextProtocol() {
  currentProtocolIdx = (currentProtocolIdx + 1) % PROTOCOLS.length
  return PROTOCOLS[currentProtocolIdx].id
}

function restartMatch(protocolId = null) {
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

  const pId = protocolId || nextProtocol()
  match = make({
    protocolId: pId,
    botFill: match.botFill ?? BOT_FILL_TO,
    botsOnly: match.botsOnly ?? false,
    botsWanted: match.botsWanted ?? true,
  })
  match.board = keep.top()
  sockets.clear()

  for (const { ws, id, name } of activeSockets) {
    const p = join(match, { id, name })
    if (!p) continue
    ws.player = p
    sockets.set(p.id, ws)
    ws.send(
      JSON.stringify({
        t: 'welcome',
        id: p.id,
        slot: p.slot,
        mode: match.mode,
        protocol: match.protocol,
      }),
    )
  }
}

wss.on('connection', (ws) => {
  let admin = false

  ws.on('message', (raw) => {
    let msg
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
        restartMatch(typeof msg.protocolId === 'number' ? msg.protocolId : null)
      } else if (msg.t === 'botsonly' && typeof msg.on === 'boolean') {
        match.botsOnly = msg.on
      } else if (msg.t === 'bots' && typeof msg.n === 'number') {
        match.botFill = Math.max(0, Math.min(MAX_PLAYERS, msg.n))
      }
      return
    }

    if (msg?.t === 'join' && !ws.player) {
      if (match.phase === 'over' && match.players.size === 0) {
        restartMatch(typeof msg.protocolId === 'number' ? msg.protocolId : null)
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
          mode: match.mode,
          protocol: match.protocol,
        }),
      )
    } else if (msg?.t === 'input' && ws.player) {
      processInput(match, ws.player.id, msg)
    } else if (msg?.t === 'ready' && ws.player) {
      match.botsWanted = true
    } else if (msg?.t === 'restart') {
      if (match.phase === 'over' || admin) {
        restartMatch(typeof msg.protocolId === 'number' ? msg.protocolId : null)
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

  ws.on('error', () => ws.close())
})

// Tick Loop
let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt = Math.min(now - last, TICK_MS * 5)
  last = now

  tick(match, dt)

  if (keep.bank(match.phase === 'over', played)) {
    match.board = keep.top()
  }

  if (match.phase === 'over' && match.players.size > 0) {
    if (!overSince) {
      overSince = now
    } else if (now - overSince >= POST_RACE_GRACE_MS) {
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

console.log(`Cipher Run match server on ws://${HOST}:${PORT}`)
