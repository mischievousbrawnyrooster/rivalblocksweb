// WebSocket adapter for Ventline. Rules and scoring live in ventline.js.
import { randomInt } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { boardFor } from './board.js'
import { runKeeper } from './board-store.js'
import {
  TICK_MS, makeRun, makeMatch, joinMatch, setReady, disconnectMatch,
  flap, stepRun, stepMatch, matchResults, snapshot, soloSnapshot,
} from './ventline.js'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT) || 8089
const keep = runKeeper(boardFor('ventline'))
const validName = (value) => typeof value === 'string'
  ? value.slice(0, 24).replace(/[\x00-\x1f\x7f]/g, '').trim() || 'Pilot'
  : 'Pilot'
const seed = () => randomInt(0, 2 ** 32)
let nextId = 1
let match = makeMatch(seed())
let overTicks = 0

const wss = new WebSocketServer({
  host: HOST, port: PORT, maxPayload: 4096, perMessageDeflate: false,
  verifyClient: ({ req }, done) => {
    const valid = req.url === '/ventline-ws' &&
      req.headers['sec-websocket-protocol']?.split(',').map(s => s.trim()).includes('ventline.v1')
    done(Boolean(valid), valid ? 200 : 404)
  },
  handleProtocols: protocols => protocols.has('ventline.v1') ? 'ventline.v1' : false,
})

const send = (ws, frame) => {
  if (ws.readyState !== WebSocket.OPEN) return
  try { ws.send(JSON.stringify(frame)) } catch { drop(ws); ws.terminate() }
}

function bankSolo(run) {
  keep.bank(run, [{ name: run.name, score: run.score, won: false, kills: 0, deaths: 0 }])
}

function drop(ws) {
  if (!ws.client) return
  const client = ws.client
  ws.client = null
  if (client.mode === 'solo') bankSolo(client.run)
  else disconnectMatch(match, client.id)
}

function restartMatch() {
  match = makeMatch(seed())
  overTicks = 0
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN || ws.client?.mode !== 'live') continue
    const client = ws.client
    const player = joinMatch(match, { id: client.id, name: client.name, slot: liveSlot() })
    player.ready = false
    client.slot = player.slot
    send(ws, { t: 'welcome', id: client.id, slot: client.slot, mode: 'live' })
  }
}

function liveSlot() {
  const used = new Set([...match.players.values()]
    .filter(p => p.connected && !p.spectating).map(p => p.slot))
  for (let slot = 0; slot < 8; slot++) if (!used.has(slot)) return slot
  return null
}

wss.on('connection', ws => {
  ws.client = null
  ws.on('message', raw => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return
    const client = ws.client
    if (msg.t === 'join' && !client && (msg.mode === 'solo' || msg.mode === 'live')) {
      const id = String(nextId++)
      const name = validName(msg.name)
      if (msg.mode === 'solo') {
        const run = makeRun({ seed: seed(), id, name, slot: 0 })
        ws.client = { mode: 'solo', id, name, slot: 0, run }
      } else {
        const player = joinMatch(match, { id, name, slot: liveSlot() })
        ws.client = { mode: 'live', id, name, slot: player.slot }
      }
      send(ws, { t: 'welcome', id, slot: ws.client.slot, mode: msg.mode })
    } else if (msg.t === 'flap' && client) {
      if (client.mode === 'solo') flap(client.run)
      else {
        const player = match.players.get(client.id)
        if (player?.connected && !player.spectating && player.run?.alive) flap(player.run)
      }
    } else if (msg.t === 'ready' && client?.mode === 'live') {
      setReady(match, client.id)
    } else if (msg.t === 'retry' && client?.mode === 'solo' && !client.run.alive) {
      bankSolo(client.run)
      client.run = makeRun({ seed: seed(), id: client.id, name: client.name, slot: 0 })
    }
  })
  ws.on('close', () => drop(ws))
  ws.on('error', () => { drop(ws); ws.terminate() })
})

setInterval(() => {
  try {
    for (const ws of wss.clients) {
      const client = ws.client
      if (client?.mode !== 'solo') continue
      if (client.run.alive) stepRun(client.run)
      if (!client.run.alive) bankSolo(client.run)
    }
    stepMatch(match)
    if (match.phase === 'over') {
      keep.bank(match, matchResults(match))
      if (++overTicks > 250) restartMatch()
    }
    // Snapshot output may contain live references; serialize in this tick.
    for (const ws of wss.clients) {
      const client = ws.client
      if (!client || ws.readyState !== WebSocket.OPEN) continue
      const board = keep.top()
      const best = keep.best(client.name)
      send(ws, client.mode === 'solo'
        ? soloSnapshot(client.run, board, best)
        : snapshot(match, client.id, board, best))
    }
  } catch (error) {
    console.error('[Ventline Tick Error]', error)
  }
}, TICK_MS)

wss.on('listening', () => console.log(`Ventline match server on ws://${HOST}:${PORT}`))
