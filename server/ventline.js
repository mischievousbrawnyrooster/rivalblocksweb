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

export const makeRun = (seed) => ({
  seed, x: 0, y: 300, vy: 0, alive: true, score: 0, clean: 0,
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
      effect(run, 'shield-used')
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
        effect(run, 'charge-used')
      }
      if (gate.pickup) {
        if (run.route === 'service' && !run.shield) {
          run.shield = true
          effect(run, 'shield-gained')
        } else if (run.route === 'charged' && !run.charge) {
          run.charge = true
          effect(run, 'charge-gained')
        }
      }
    }
    run.nextGate++
    run.protectedGate = null
    run.route = null
  }
  return run
}
