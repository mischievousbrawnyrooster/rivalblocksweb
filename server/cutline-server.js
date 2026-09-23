// WebSocket network adapter for Cutline. Authoritative match server on port
// 8088 (/cutline-ws). Contains zero game rules; every decision is made by
// cutline.js.

import { WebSocketServer, WebSocket } from 'ws'
import {
  make,
  join,
  leave,
  applyInput,
  tick,
  snapshot,
  encodeMap,
  TICK_MS,
  BOT_FILL_TO,
  MAX_PLAYERS,
  POST_RACE_GRACE_MS,
  CIRCUITS,
} from './cutline.js'
import { boardFor } from './board.js'
import { keeper } from './board-store.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8088
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin'

let match = make({ botFill: BOT_FILL_TO })

const sockets = new Map()

const keep = keeper(boardFor('cutline'))
match.board = keep.top()

/**
 * What the race banks. A win is a race won; a time is that driver's best lap.
 *
 * merge() only records a time on a win, so the board's lap record is the best
 * lap among winning drives, which is what the label "Winning lap" says. A lap
 * is only offered at all once the race reached the flag, so a lone driver
 * circling an idle lobby cannot set a record.
 */
const raced = () =>
  [...match.cars.values()].map((car) => ({
    name: car.name,
    bot: Boolean(car.bot),
    won: car.id === match.winner,
    time: match.final ? car.bestLapMs : null,
  }))

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: 4096,
  perMessageDeflate: false,
})

const welcome = (car, mapEncoded = encodeMap(match.grid)) =>
  JSON.stringify({
    t: 'welcome',
    id: car.id,
    slot: car.slot,
    circuit: {
      name: match.circuit.name,
      size: Math.sqrt(match.grid.length),
      map: mapEncoded,
      checkpoints: match.checkpoints,
      // Render only: the grid says where a ramp is, this says which way it faces.
      ramps: match.ramps,
    },
  })

/** A fresh race on the next circuit, carrying everyone still connected into it. */
function restartMatch(circuitIndex = null) {
  const carried = []
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.car) {
      carried.push({ ws: client, id: client.car.id, name: client.car.name })
    }
  }

  const next = Number.isInteger(circuitIndex)
    ? circuitIndex
    : (match.circuitIndex + 1) % CIRCUITS.length

  match = make({
    circuitIndex: next,
    botFill: match.botFill,
    botsOnly: match.botsOnly,
    botsWanted: match.botsWanted,
  })
  match.board = keep.top()
  sockets.clear()

  const mapEncoded = encodeMap(match.grid)
  for (const { ws, id, name } of carried) {
    const car = join(match, { id, name })
    if (!car) {
      ws.car = null
      continue
    }
    ws.car = car
    sockets.set(car.id, ws)
    ws.send(welcome(car, mapEncoded))
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
          target.car = null
          target.close()
        }
      } else if (msg.t === 'restart') {
        restartMatch(Number.isInteger(msg.circuitIndex) ? msg.circuitIndex : null)
      } else if (msg.t === 'botsonly' && typeof msg.on === 'boolean') {
        match.botsOnly = msg.on
      } else if (msg.t === 'bots' && typeof msg.n === 'number') {
        match.botFill = Math.max(0, Math.min(MAX_PLAYERS, msg.n))
      }
      return
    }

    if (msg?.t === 'join' && !ws.car) {
      // An empty server sitting on a finished race starts fresh for whoever arrives.
      if (match.phase === 'over' && match.cars.size === 0) restartMatch()

      const car = join(match, { name: msg.name })
      if (!car) {
        ws.send(JSON.stringify({ t: 'full' }))
        ws.close()
        return
      }
      ws.car = car
      sockets.set(car.id, ws)
      ws.send(welcome(car))
    } else if (msg?.t === 'input' && ws.car) {
      // Held state, not events. Clamping happens inside applyInput, which is
      // where it can be tested.
      applyInput(match, ws.car.id, msg)
    } else if (msg?.t === 'ready' && ws.car) {
      match.botsWanted = true
    }
  })

  ws.on('close', () => {
    if (ws.car) {
      sockets.delete(ws.car.id)
      leave(match, ws.car.id)
      ws.car = null
    }
  })

  ws.on('error', () => ws.close())
})

// Tick loop
let last = Date.now()
setInterval(() => {
  try {
    const now = Date.now()
    const dt = Math.min(now - last, TICK_MS * 5)
    last = now

    tick(match, dt)

    if (keep.bank(match.phase === 'over' && match.final, raced)) {
      match.board = keep.top()
    }

    if (match.phase === 'over' && match.cars.size > 0 && match.now - match.overSince >= POST_RACE_GRACE_MS) {
      restartMatch()
    }

    // Stringified synchronously in the same turn as tick(), which is the only
    // reason snapshot() may return live references. Never retain a frame.
    const frame = JSON.stringify(snapshot(match))
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(frame)
        } catch {
          // Socket write failed, ws close event will clean up
        }
      }
    }
  } catch (err) {
    console.error('[Cutline Tick Error]', err)
  }
}, TICK_MS)

process.on('uncaughtException', (err) => {
  console.error('[Cutline Server Uncaught Exception]', err)
})

console.log(`Cutline match server on ws://${HOST}:${PORT}`)
