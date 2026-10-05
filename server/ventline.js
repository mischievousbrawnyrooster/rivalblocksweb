export const TICK_MS = 16
const DT = TICK_MS / 1000
const RADIUS = 12
// A sphere's touch radius, and the radius the page draws it at.
export const SPHERE = 11
export const BASE_SPEED = 170
// Units a second gained per second of flight: slow, steady, never a step.
export const SPEED_GAIN = 0.5
// The fastest any run flies. The reachability test flies every sampled layout
// at this speed, so raising it is only safe while that test still passes.
export const TOP_SPEED = 280
// The wide service gap floats a survival kind, the narrow charged gap a score
// kind, so the gap still says what the risk buys. Drawn from these by seed.
export const SURVIVAL = ['shield', 'coolant', 'compact', 'bumper']
export const SCORE = ['charge', 'overdrive']
// Coolant, compact and overdrive last this many shutters after the one they
// were collected on. Shield, charge and bumper are held until used.
export const TIMED = ['coolant', 'compact', 'overdrive']
export const EFFECT_SHUTTERS = 3
export const COOLANT_SPEED = 2 / 3
export const COMPACT_SCALE = 2 / 3

export const pickupAt = (index) => index >= 5 && (index - 5) % 7 === 0
const hash = (seed, index) => {
  let x = (seed ^ Math.imul(index, 0x9e3779b9)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}
const gap = (y, width) => ({ lo: y - width / 2, hi: y + width / 2 })
// A seeded height inside an opening, far enough from both edges that a drone
// centred on the sphere clears the opening.
const sphereY = (opening, seed, index, salt) =>
  opening.lo + 20 + (hash(seed ^ salt, index) % 1000) / 999 * (opening.hi - opening.lo - 40)
const serviceWidth = (index) => 190 - Math.min(30, index - 1)
const chargedWidth = (index) => 98 - Math.min(18, (index - 1) * 0.6)
export const speedFor = (elapsedMs) => Math.min(TOP_SPEED, BASE_SPEED + SPEED_GAIN * elapsedMs / 1000)
export const gateAt = (seed, index) => {
  const topService = (hash(seed, index) & 1) === 0
  const offset = (hash(seed ^ 0x9e3779b9, index) % 41) - 20
  const serviceY = (topService ? 190 : 410) + offset
  const chargedY = (topService ? 410 : 190) - offset
  const x = 480 + (index - 1) * 360
  const service = gap(serviceY, serviceWidth(index))
  const charged = gap(chargedY, chargedWidth(index))
  const pickup = pickupAt(index)
  return { index, x, w: 28, service, charged, pickup, spheres: pickup ? [
    { kind: SURVIVAL[hash(seed ^ 0x7f4a7c15, index) % SURVIVAL.length], x: x + 14, y: sphereY(service, seed, index, 0x51ed270b) },
    { kind: SCORE[hash(seed ^ 0x3c6ef372, index) % SCORE.length], x: x + 14, y: sphereY(charged, seed, index, 0x2545f491) },
  ] : [] }
}

export const makeRun = ({ seed, id, name, slot }) => ({
  seed, id, name, slot, x: 0, y: 300, vy: 0, alive: true, score: 0, clean: 0,
  shield: false, charge: false, bumper: false, coolant: 0, compact: 0, overdrive: 0,
  nextGate: 1, protectedGate: null,
  elapsedMs: 0, lastFlapMs: -Infinity, event: { seq: 0, type: null }, banked: false,
  route: null, took: {},
})

export const flap = (run) => {
  if (!run.alive || run.elapsedMs - run.lastFlapMs < 120) return false
  run.vy = -310
  run.lastFlapMs = run.elapsedMs
  return true
}

const touchRect = (x, y, r, left, right, top, bottom) => {
  const dx = x - Math.max(left, Math.min(x, right))
  const dy = y - Math.max(top, Math.min(y, bottom))
  return dx * dx + dy * dy <= r * r
}
// Compact shrinks the body the rules collide, not only the one the page draws.
export const radiusOf = (run) => run.compact ? RADIUS * COMPACT_SCALE : RADIUS

const effect = (run, type) => {
  run.event = { seq: run.event.seq + 1, type }
}

export const stepRun = (run) => {
  if (!run.alive) return run
  run.elapsedMs += TICK_MS
  run.vy += 850 * DT
  run.y += run.vy * DT
  run.x += speedFor(run.elapsedMs) * (run.coolant ? COOLANT_SPEED : 1) * DT
  const r = radiusOf(run)
  if (run.y - r <= 0 || run.y + r >= 600) {
    if (!run.bumper) {
      run.alive = false
      return run
    }
    // A bumper turns one ceiling or floor contact into a bounce back into the shaft.
    const floor = run.y + r >= 600
    run.bumper = false
    run.y = floor ? 600 - r - 1 : r + 1
    run.vy = floor ? -310 : 200
    effect(run, 'bumper-use')
  }

  const gate = gateAt(run.seed, run.nextGate)
  if (run.x + r >= gate.x && run.x - r <= gate.x + gate.w) {
    const gaps = [gate.service, gate.charged].sort((a, b) => a.lo - b.lo)
    const hit = touchRect(run.x, run.y, r, gate.x, gate.x + gate.w, 0, gaps[0].lo) ||
      touchRect(run.x, run.y, r, gate.x, gate.x + gate.w, gaps[0].hi, gaps[1].lo) ||
      touchRect(run.x, run.y, r, gate.x, gate.x + gate.w, gaps[1].hi, 600)
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
  // Touching a sphere collects it at once. `took` keeps the shutter it was taken
  // on, which hides it from snapshots and spends it even when one is held. A
  // timed effect refills to EFFECT_SHUTTERS; a held one never stacks.
  for (const sphere of gate.spheres) {
    if (run.took[sphere.kind] === gate.index ||
      (run.x - sphere.x) ** 2 + (run.y - sphere.y) ** 2 > (r + SPHERE) ** 2) continue
    run.took[sphere.kind] = gate.index
    if (TIMED.includes(sphere.kind)) run[sphere.kind] = EFFECT_SHUTTERS
    else if (run[sphere.kind]) continue
    else run[sphere.kind] = true
    effect(run, `${sphere.kind}-pickup`)
  }
  if (run.x - r > gate.x + gate.w) {
    // An effect never lifts the shutter it was collected on, only later ones.
    const fresh = (kind) => run[kind] && run.took[kind] !== gate.index
    if (run.protectedGate !== gate.index && run.route) {
      let points = run.route === 'charged' ? 2 : 1
      if (fresh('charge')) {
        points += 2
        run.charge = false
        effect(run, 'charge-use')
      }
      if (fresh('overdrive')) points *= 2
      run.score += points
      run.clean++
    }
    for (const kind of TIMED) if (fresh(kind)) run[kind]--
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
  // Nothing to bank or show, and a lobby nobody starts would keep every visitor.
  else match.players.delete(id)
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
  bumper: player.run?.bumper ?? false, coolant: player.run?.coolant ?? 0,
  compact: player.run?.compact ?? 0, overdrive: player.run?.overdrive ?? 0,
  event: player.run?.event ?? { seq: 0, type: null },
})

// Spheres the viewed run has taken are left out, so the course shows its own pickups.
const gateWindow = (seed, x, took) => {
  const current = Math.max(1, Math.floor((x - 480) / 360) + 1)
  return Array.from({ length: current === 1 ? 4 : 5 }, (_, i) => {
    const gate = gateAt(seed, current === 1 ? i + 1 : current + i - 1)
    return took ? { ...gate, spheres: gate.spheres.filter(s => took[s.kind] !== gate.index) } : gate
  })
}

export const snapshot = (match, viewerId, board, personalBest) => {
  const viewer = match.players.get(viewerId)
  const viewed = viewer?.connected && viewer.run?.alive ? viewer : spectatorTarget(match)
  const viewedId = viewed?.id ?? match.lastViewedId
  const run = viewed?.run ?? match.players.get(viewedId)?.run
  return { t: 'snap', phase: match.phase, viewedId: viewedId ?? null, personalBest,
    players: [...match.players.values()].filter((p) => !p.spectating && (p.connected || p.run))
      .map(playerView),
    gates: gateWindow(match.seed, run?.x ?? 0, run?.took), board }
}

export const soloSnapshot = (run, board, personalBest) => ({
  t: 'snap', phase: run.alive ? 'playing' : 'over', viewedId: run.id,
  personalBest, players: [playerView({ ...run, run, spectating: false, connected: true })],
  gates: gateWindow(run.seed, run.x, run.took), board,
})
