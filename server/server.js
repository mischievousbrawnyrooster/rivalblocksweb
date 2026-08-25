// Socket wiring for one Blockout Royale match. Contains no rules — every
// decision is made by game.js. Binds to loopback; nginx is what faces the
// network.

import { WebSocketServer } from 'ws'
import {
  createMatch,
  addPlayer,
  removePlayer,
  move,
  tick,
  snapshot,
  TICK_MS,
  SIZE,
} from './game.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8081

const match = createMatch()
// ws defaults to a 100 MiB maxPayload; the largest legal message here is a
// short join frame, so bound it hard to keep an oversized frame from ever
// reaching the message handler.
const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 4096 })

wss.on('connection', (ws) => {
  let player = null

  ws.on('message', (raw) => {
    let msg
    // One malformed client must not be able to take the match down.
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg?.t === 'join' && !player) {
      player = addPlayer(match, msg.name)
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, size: SIZE }))
    } else if (msg?.t === 'move' && player) {
      move(match, player.id, msg.dir)
    }
  })

  ws.on('close', () => {
    if (player) removePlayer(match, player.id)
  })

  // A client that drops mid-frame is not a server error.
  ws.on('error', () => ws.close())
})

setInterval(() => {
  tick(match, TICK_MS)
  const frame = JSON.stringify(snapshot(match))
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(frame)
  }
}, TICK_MS)

console.log(`Blockout Royale match server on ws://${HOST}:${PORT}`)
