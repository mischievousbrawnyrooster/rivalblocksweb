import test from 'node:test'
import assert from 'node:assert/strict'
import { gateAt, makeRun, flap, stepRun, TICK_MS, speedFor } from './ventline.js'

test('a seed and index reproduce bounded, separate openings and fixed pickups', () => {
  assert.deepEqual(gateAt(42, 5), gateAt(42, 5))
  assert.notEqual(gateAt(42, 5).service.lo, gateAt(43, 5).service.lo)
  for (let seed = 0; seed < 1000; seed++) for (let index = 1; index <= 50; index++) {
    const gate = gateAt(seed, index)
    const gaps = [gate.service, gate.charged].sort((a, b) => a.lo - b.lo)
    assert.ok(gaps[0].lo > 0 && gaps[1].hi < 600)
    assert.ok(gaps[0].hi < gaps[1].lo)
    assert.ok(gate.service.hi - gate.service.lo > gate.charged.hi - gate.charged.lo)
    assert.equal(gate.pickup, index >= 5 && (index - 5) % 7 === 0)
  }
  assert.equal(gateAt(42, 5).pickup, true)
  assert.equal(gateAt(42, 6).pickup, false)
  assert.equal(gateAt(42, 12).pickup, true)
})

test('each sampled service opening is reachable without a shield from either preceding opening', () => {
  // Exit states cover each body's safe edges and center, with legal vertical speeds.
  // Search flap decisions on fixed ticks; prune equivalent states at each tick.
  const tried = new Map()
  for (let seed = 0; seed < 1000; seed++) for (let index = 2; index <= 50; index++) {
    const previous = gateAt(seed, index - 1)
    const next = gateAt(seed, index)
    const key = [index, previous.service.lo, previous.charged.lo, next.service.lo].join(':')
    if (tried.has(key)) continue
    tried.set(key, true)
    for (const opening of [previous.service, previous.charged]) {
      for (const y of [opening.lo + 14, (opening.lo + opening.hi) / 2, opening.hi - 14]) {
        for (const vy of [-160, 0, 160]) {
          const start = makeRun(seed)
          Object.assign(start, { x: previous.x + previous.w + 12, y, vy, nextGate: index, lastFlapMs: -Infinity })
          let found = false
          for (const horizon of [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6]) {
            for (const aim of [next.service.lo + 20, (next.service.lo + next.service.hi) / 2, next.service.hi - 20]) {
              const candidate = { ...start, event: { ...start.event } }
              for (let tick = 0; tick < 140 && candidate.alive && candidate.nextGate === index; tick++) {
                if (candidate.y + candidate.vy * horizon + 425 * horizon * horizon > aim) flap(candidate)
                stepRun(candidate)
              }
              if (candidate.nextGate > index && candidate.clean === 1 && candidate.score === 1) {
                found = true
                break
              }
            }
            if (found) break
          }
          assert.ok(found, `seed ${seed} gate ${index} from ${opening === previous.service ? 'service' : 'charged'} y=${y} vy=${vy}`)
        }
      }
    }
  }
})

const approach = (seed, index, route, extras = {}) => {
  const gate = gateAt(seed, index)
  const run = makeRun(seed)
  Object.assign(run, { nextGate: index, x: gate.x + gate.w - 2, y: (gate[route].lo + gate[route].hi) / 2,
    vy: -12, ...extras })
  return run
}
const clear = (run, index = run.nextGate) => {
  for (let i = 0; i < 20 && run.alive && run.nextGate === index; i++) stepRun(run)
  return run
}

test('flap sets one upward impulse subject to an edge cooldown', () => {
  const run = makeRun(42)
  assert.equal(flap(run), true)
  assert.equal(run.vy, -310)
  assert.equal(flap(run), false)
  stepRun(run)
  assert.equal(run.vy, -296.4)
  for (let i = 0; i < 7; i++) stepRun(run)
  assert.equal(flap(run), true)
  assert.equal(run.vy, -310)
  run.alive = false
  assert.equal(flap(run), false)
})

test('ceiling and floor kill even when holding a shield', () => {
  for (const [y, vy] of [[12, -310], [588, 100]]) {
    const run = makeRun(42)
    Object.assign(run, { y, vy, shield: true })
    stepRun(run)
    assert.equal(run.alive, false)
    assert.equal(run.shield, true)
  }
})

test('solid shutter contact kills a drone without a shield', () => {
  const gate = gateAt(42, 1)
  const run = makeRun(42)
  Object.assign(run, { x: gate.x - 13, y: 300, vy: 0 })
  stepRun(run)
  assert.equal(run.alive, false)
  assert.equal(run.score, 0)
})

test('full-body service and charged clears score once; distance alone does not', () => {
  const far = makeRun(42)
  for (let i = 0; i < 10; i++) stepRun(far)
  assert.equal(far.score, 0)
  for (const [route, points] of [['service', 1], ['charged', 2]]) {
    const run = approach(42, 1, route)
    stepRun(run)
    assert.equal(run.score, 0)
    clear(run)
    assert.equal(run.alive, true)
    assert.equal(run.score, points)
    assert.equal(run.clean, 1)
    assert.equal(run.nextGate, 2)
    stepRun(run)
    assert.equal(run.score, points)
  }
})

test('pickup clear grants route effect after scoring and effects do not stack', () => {
  const service = clear(approach(42, 5, 'service'))
  assert.equal(service.score, 1)
  assert.equal(service.shield, true)
  assert.equal(service.event.type, 'shield-gained')
  const charged = clear(approach(42, 5, 'charged'))
  assert.equal(charged.score, 2)
  assert.equal(charged.charge, true)
  assert.equal(charged.event.type, 'charge-gained')
  const held = clear(approach(42, 12, 'service', { shield: true, charge: true }))
  assert.equal(held.score, 3)
  assert.equal(held.charge, false)
  assert.equal(held.shield, true)
  assert.equal(held.event.seq, 1)
})

test('charge scores once and a new charged pickup follows its consumption', () => {
  const run = clear(approach(42, 12, 'charged', { charge: true }))
  assert.equal(run.score, 4)
  assert.equal(run.charge, true)
  assert.equal(run.event.seq, 2)
  assert.equal(run.event.type, 'charge-gained')
  const next = clear(approach(42, 13, 'service', { charge: true }))
  assert.equal(next.score, 3)
  assert.equal(next.charge, false)
  assert.equal(next.event.type, 'charge-used')
})

test('a shield absorbs one shutter, blocks repeat hits, and keeps a score charge', () => {
  const gate = gateAt(42, 5)
  const run = makeRun(42)
  Object.assign(run, { nextGate: 5, x: gate.x - 13, y: 300, vy: -12, shield: true, charge: true })
  stepRun(run)
  assert.equal(run.alive, true)
  assert.equal(run.shield, false)
  assert.equal(run.protectedGate, 5)
  assert.equal(run.event.type, 'shield-used')
  clear(run, 5)
  assert.equal(run.alive, true)
  assert.equal(run.nextGate, 6)
  assert.equal(run.score, 0)
  assert.equal(run.clean, 0)
  assert.equal(run.charge, true)
  assert.equal(run.shield, false)
  assert.equal(run.event.seq, 1)
})
