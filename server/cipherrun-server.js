// WebSocket network adapter for Cipher Run. Authoritative match server on
// port 8087 (/cipherrun-ws). Contains zero game rules; all decisions are
// made by cipherrun.js.

import { WebSocketServer, WebSocket } from 'ws'
import {
  make,
  join,
  leave,
  castVote,
  pickProtocol,
  setAvatar,
  processInput,
  tick,
  snapshot,
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

let match = make({ botFill: BOT_FILL_TO })

// Map player ID -> WebSocket
const sockets = new Map()

const keep = keeper(boardFor('cipherrun'))
match.board = keep.top()

const played = () =>
  [...match.players.values()].map((p) => ({
    name: p.name,
    bot: Boolean(p.bot),
    won: p.id === match.winner,
    time: p.finished ? p.finishTime : null,
    wpm: p.finalWpm,
    acc: p.finalAcc,
  }))

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: 4096,
  perMessageDeflate: false,
})

// A fresh match with everyone still connected carried into it. `pick` is an
// admin's protocol choice; a pick an operator queued mid-race carries over too.
function restartMatch(pick = null) {
  const activeSockets = []
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.player) {
      activeSockets.push({
        ws: client,
        id: client.player.id,
        name: client.player.name,
        avatar: client.player.avatar,
      })
    }
  }

  match = make({
    protocolId: match.protocol.id,
    picked: pick ?? match.picked,
    botFill: match.botFill,
    botsOnly: match.botsOnly,
    // An operator who chose bots keeps them; otherwise the next race waits in the lobby.
    botsWanted: match.botsWanted,
  })
  match.board = keep.top()
  sockets.clear()

  for (const { ws, id, name, avatar } of activeSockets) {
    const p = join(match, { id, name, avatar })
    if (!p) continue
    ws.player = p
    sockets.set(p.id, ws)
    ws.send(
      JSON.stringify({
        t: 'welcome',
        id: p.id,
        slot: p.slot,
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
      // An empty server sitting on a finished race starts fresh for whoever arrives.
      if (match.phase === 'over' && match.players.size === 0) restartMatch()

      // join() stands a bot down to make room, and checks the name and runner itself.
      const player = join(match, { name: msg.name, avatar: msg.avatar })
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
          protocol: match.protocol,
        }),
      )
    } else if (msg?.t === 'input' && ws.player) {
      // Send the frame straight back so the typist sees the verdict without waiting a tick
      if (processInput(match, ws.player.id, msg)) ws.send(JSON.stringify(snapshot(match)))
    } else if (msg?.t === 'vote' && ws.player) {
      castVote(match, ws.player.id, msg.tier)
    } else if (msg?.t === 'pick' && ws.player) {
      pickProtocol(match, ws.player.id, msg.protocolId)
    } else if (msg?.t === 'avatar' && ws.player) {
      setAvatar(match, ws.player.id, msg.avatar)
    } else if (msg?.t === 'ready' && ws.player) {
      match.botsWanted = true
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

  // Results stay up for POST_RACE_GRACE_MS on the match's own clock, the same
  // one the countdown on the results screen reads.
  if (match.phase === 'over' && match.players.size > 0 && match.now - match.overSince >= POST_RACE_GRACE_MS) {
    restartMatch()
  }

  const frame = JSON.stringify(snapshot(match))
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(frame)
    }
  }
}, TICK_MS)

console.log(`Cipher Run match server on ws://${HOST}:${PORT}`)
