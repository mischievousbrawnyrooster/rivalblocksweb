export const TICK_MS = 16
const DT = TICK_MS / 1000
const RADIUS = 12

export const pickupAt = (index) => index >= 5 && (index - 5) % 7 === 0
const hash = (seed, index) => {
  let x = (seed ^ Math.imul(index, 0x9e3779b9)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}
const gap = (y, width) => ({ lo: y - width / 2, hi: y + width / 2 })
const serviceWidth = (index) => 190 - Math.min(30, index - 1)
const chargedWidth = (index) => 98 - Math.min(18, (index - 1) * 0.6)
export const speedFor = (index) => 170 + Math.min(40, index - 1)
export const gateAt = (seed, index) => {
  const topService = (hash(seed, index) & 1) === 0
  const offset = (hash(seed ^ 0x9e3779b9, index) % 41) - 20
  const serviceY = (topService ? 190 : 410) + offset
  const chargedY = (topService ? 410 : 190) - offset
  return { index, x: 480 + (index - 1) * 360, w: 28,
    service: gap(serviceY, serviceWidth(index)),
    charged: gap(chargedY, chargedWidth(index)), pickup: pickupAt(index) }
}

export const makeRun = ({ seed, id, name, slot }) => ({
  seed, id, name, slot, x: 0, y: 300, vy: 0, alive: true, score: 0, clean: 0,
  shield: false, charge: false, nextGate: 1, protectedGate: null,
  elapsedMs: 0, lastFlapMs: -Infinity, event: { seq: 0, type: null }, banked: false,
  route: null,
})

export const flap = (run) => {
  if (!run.alive || run.elapsedMs - run.lastFlapMs < 120) return false
  run.vy = -310
  run.lastFlapMs = run.elapsedMs
  return true
}

const touchRect = (x, y, left, right, top, bottom) => {
  const dx = x - Math.max(left, Math.min(x, right))
  const dy = y - Math.max(top, Math.min(y, bottom))
  return dx * dx + dy * dy <= RADIUS * RADIUS
}

const effect = (run, type) => {
  run.event = { seq: run.event.seq + 1, type }
}

export const stepRun = (run) => {
  if (!run.alive) return run
  run.elapsedMs += TICK_MS
  run.vy += 850 * DT
  run.y += run.vy * DT
  run.x += speedFor(run.nextGate) * DT
  if (run.y - RADIUS <= 0 || run.y + RADIUS >= 600) {
    run.alive = false
    return run
  }

  const gate = gateAt(run.seed, run.nextGate)
  if (run.x + RADIUS >= gate.x && run.x - RADIUS <= gate.x + gate.w) {
    const gaps = [gate.service, gate.charged].sort((a, b) => a.lo - b.lo)
    const hit = touchRect(run.x, run.y, gate.x, gate.x + gate.w, 0, gaps[0].lo) ||
      touchRect(run.x, run.y, gate.x, gate.x + gate.w, gaps[0].hi, gaps[1].lo) ||
      touchRect(run.x, run.y, gate.x, gate.x + gate.w, gaps[1].hi, 600)
    if (hit && run.protectedGate !== gate.index) {
      if (!run.shield) {
        run.alive = false
        return run
      }
      run.shield = false
      run.protectedGate = gate.index
      effect(run, 'shield-use')
    }
    if (!run.route && run.protectedGate !== gate.index) {
      if (run.y >= gate.service.lo && run.y <= gate.service.hi) run.route = 'service'
      else if (run.y >= gate.charged.lo && run.y <= gate.charged.hi) run.route = 'charged'
    }
  }
  if (run.x - RADIUS > gate.x + gate.w) {
    if (run.protectedGate !== gate.index && run.route) {
      run.score += run.route === 'charged' ? 2 : 1
      run.clean++
      if (run.charge) {
        run.score += 2
        run.charge = false
        effect(run, 'charge-use')
      }
      if (gate.pickup) {
        if (run.route === 'service' && !run.shield) {
          run.shield = true
          effect(run, 'shield-pickup')
        } else if (run.route === 'charged' && !run.charge) {
          run.charge = true
          effect(run, 'charge-pickup')
        }
      }
    }
    run.nextGate++
    run.protectedGate = null
    run.route = null
  }
  return run
}

export const makeMatch = (seed) => ({ seed, phase: 'lobby', countdown: 0,
  players: new Map(), winners: [], lastViewedId: null })

export const joinMatch = (match, { id, name, slot }) => {
  const spectating = match.phase !== 'lobby' ||
    [...match.players.values()].filter((p) => !p.spectating && p.connected).length >= 8
  const player = { id, name, slot, spectating, connected: true, ready: false, run: null }
  match.players.set(id, player)
  return player
}

export const setReady = (match, id) => {
  const player = match.players.get(id)
  if (!['lobby', 'countdown'].includes(match.phase) || !player?.connected || player.spectating) return
  player.ready = true
  if (match.phase === 'lobby' &&
    [...match.players.values()].filter((p) => p.connected && p.ready && !p.spectating).length >= 2) {
    match.phase = 'countdown'
    match.countdown = 125
  }
}

export const disconnectMatch = (match, id) => {
  const player = match.players.get(id)
  if (!player) return
  player.connected = false
  if (player.run) player.run.alive = false
  if (match.phase === 'countdown' &&
    [...match.players.values()].filter((p) => p.connected && p.ready && !p.spectating).length < 2) {
    match.phase = 'lobby'
    match.countdown = 0
  }
}

const alivePlayers = (match) => [...match.players.values()].filter((p) => p.connected && p.run?.alive)
const spectatorTarget = (match) => alivePlayers(match).sort((a, b) =>
  b.run.score - a.run.score || b.run.x - a.run.x ||
  String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))[0]

export const stepMatch = (match) => {
  if (match.phase === 'countdown' && --match.countdown === 0) {
    for (const player of match.players.values()) {
      if (player.ready && player.connected && !player.spectating) {
        player.run = makeRun({ seed: match.seed, id: player.id, name: player.name, slot: player.slot })
      } else player.spectating = true
    }
    match.phase = 'playing'
  } else if (match.phase === 'playing') {
    match.lastViewedId = spectatorTarget(match)?.id ?? match.lastViewedId
    for (const player of alivePlayers(match)) stepRun(player.run)
    if (!alivePlayers(match).length) {
      match.phase = 'over'
      const ranked = [...match.players.values()].filter((p) => p.connected && p.run)
        .sort((a, b) => b.run.score - a.run.score || b.run.clean - a.run.clean || b.run.x - a.run.x)
      const first = ranked[0]?.run
      match.winners = first ? ranked.filter((p) => p.run.score === first.score &&
        p.run.clean === first.clean && p.run.x === first.x).map((p) => p.id) : []
    }
  }
  return match
}

export const matchResults = (match) => [...match.players.values()]
  .filter((p) => !p.spectating && p.run)
  .map((p) => ({ name: p.name, score: p.run.score,
    won: p.connected && match.winners.includes(p.id), kills: 0, deaths: 0 }))

const playerView = (player) => ({
  id: player.id, name: player.name, slot: player.slot,
  x: player.run?.x ?? null, y: player.run?.y ?? null,
  alive: player.run?.alive ?? false, spectating: player.spectating,
  connected: player.connected, score: player.run?.score ?? 0,
  clean: player.run?.clean ?? 0, shield: player.run?.shield ?? false,
  charge: player.run?.charge ?? false,
  event: player.run?.event ?? { seq: 0, type: null },
})

const gateWindow = (seed, x) => {
  const current = Math.max(1, Math.floor((x - 480) / 360) + 1)
  return Array.from({ length: current === 1 ? 4 : 5 }, (_, i) =>
    gateAt(seed, current === 1 ? i + 1 : current + i - 1))
}

export const snapshot = (match, viewerId, board, personalBest) => {
  const viewer = match.players.get(viewerId)
  const viewed = viewer?.connected && viewer.run?.alive ? viewer : spectatorTarget(match)
  const viewedId = viewed?.id ?? match.lastViewedId
  const run = viewed?.run ?? match.players.get(viewedId)?.run
  return { t: 'snap', phase: match.phase, viewedId: viewedId ?? null, personalBest,
    players: [...match.players.values()].filter((p) => !p.spectating && (p.connected || p.run))
      .map(playerView),
    gates: gateWindow(match.seed, run?.x ?? 0), board }
}

export const soloSnapshot = (run, board, personalBest) => ({
  t: 'snap', phase: run.alive ? 'playing' : 'over', viewedId: run.id,
  personalBest, players: [playerView({ ...run, run, spectating: false, connected: true })],
  gates: gateWindow(run.seed, run.x), board,
})
