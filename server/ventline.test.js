import test from 'node:test'
import assert from 'node:assert/strict'
import { gateAt, makeRun, flap, stepRun, TICK_MS, speedFor,
  makeMatch, joinMatch, setReady, disconnectMatch, stepMatch, matchResults,
  snapshot, soloSnapshot } from './ventline.js'

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
          const start = makeRun({ seed })
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
  const run = makeRun({ seed })
  Object.assign(run, { nextGate: index, x: gate.x + gate.w - 2, y: (gate[route].lo + gate[route].hi) / 2,
    vy: -12, ...extras })
  return run
}
const clear = (run, index = run.nextGate) => {
  for (let i = 0; i < 20 && run.alive && run.nextGate === index; i++) stepRun(run)
  return run
}

test('a run retains its player descriptor for downstream snapshots', () => {
  const run = makeRun({ seed: 42, id: 'p7', name: 'Ada', slot: 2 })
  assert.equal(run.seed, 42)
  assert.equal(run.id, 'p7')
  assert.equal(run.name, 'Ada')
  assert.equal(run.slot, 2)
  assert.deepEqual(gateAt(run.seed, 1), gateAt(42, 1))
})

test('flap sets one upward impulse subject to an edge cooldown', () => {
  const run = makeRun({ seed: 42 })
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
    const run = makeRun({ seed: 42 })
    Object.assign(run, { y, vy, shield: true })
    stepRun(run)
    assert.equal(run.alive, false)
    assert.equal(run.shield, true)
  }
})

test('solid shutter contact kills a drone without a shield', () => {
  const gate = gateAt(42, 1)
  const run = makeRun({ seed: 42 })
  Object.assign(run, { x: gate.x - 13, y: 300, vy: 0 })
  stepRun(run)
  assert.equal(run.alive, false)
  assert.equal(run.score, 0)
})

test('full-body service and charged clears score once; distance alone does not', () => {
  const far = makeRun({ seed: 42 })
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
  assert.equal(service.event.type, 'shield-pickup')
  const charged = clear(approach(42, 5, 'charged'))
  assert.equal(charged.score, 2)
  assert.equal(charged.charge, true)
  assert.equal(charged.event.type, 'charge-pickup')
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
  assert.equal(run.event.type, 'charge-pickup')
  const next = clear(approach(42, 13, 'service', { charge: true }))
  assert.equal(next.score, 3)
  assert.equal(next.charge, false)
  assert.equal(next.event.type, 'charge-use')
})

test('a shield absorbs one shutter, blocks repeat hits, and keeps a score charge', () => {
  const gate = gateAt(42, 5)
  const run = makeRun({ seed: 42 })
  Object.assign(run, { nextGate: 5, x: gate.x - 13, y: 300, vy: -12, shield: true, charge: true })
  stepRun(run)
  assert.equal(run.alive, true)
  assert.equal(run.shield, false)
  assert.equal(run.protectedGate, 5)
  assert.equal(run.event.type, 'shield-use')
  clear(run, 5)
  assert.equal(run.alive, true)
  assert.equal(run.nextGate, 6)
  assert.equal(run.score, 0)
  assert.equal(run.clean, 0)
  assert.equal(run.charge, true)
  assert.equal(run.shield, false)
  assert.equal(run.event.seq, 1)
})

test('two ready players share a 125 tick countdown and independent runs', () => {
  const match = makeMatch(42)
  joinMatch(match, { id: 'a', name: 'Ada', slot: 0 })
  joinMatch(match, { id: 'b', name: 'Bob', slot: 1 })
  setReady(match, 'a')
  for (let i = 0; i < 125; i++) stepMatch(match)
  assert.equal(match.phase, 'lobby')
  setReady(match, 'b')
  assert.equal(match.phase, 'countdown')
  for (let i = 0; i < 124; i++) stepMatch(match)
  assert.equal(match.phase, 'countdown')
  stepMatch(match)
  assert.equal(match.phase, 'playing')
  const a = match.players.get('a').run
  const b = match.players.get('b').run
  assert.notEqual(a, b)
  assert.deepEqual(gateAt(a.seed, 5), gateAt(b.seed, 5))
  a.shield = true
  a.charge = true
  assert.equal(b.shield, false)
  assert.equal(b.charge, false)
  flap(a)
  stepMatch(match)
  assert.notEqual(a.y, b.y)
  assert.equal(a.alive, true)
  assert.equal(b.alive, true)
})

test('eight active slots cap a round and later arrivals spectate', () => {
  const match = makeMatch(42)
  for (let i = 0; i < 9; i++) joinMatch(match, { id: `p${i}`, name: `P${i}`, slot: i })
  assert.equal([...match.players.values()].filter(p => !p.spectating).length, 8)
  for (let i = 0; i < 8; i++) setReady(match, `p${i}`)
  for (let i = 0; i < 125; i++) stepMatch(match)
  joinMatch(match, { id: 'late', name: 'Late', slot: 9 })
  assert.equal(match.players.get('late').spectating, true)
  assert.equal(match.players.get('late').run, null)
})

test('a disconnected participant cannot win and round waits for all runs to end', () => {
  const match = makeMatch(42)
  for (const id of ['a', 'b']) {
    joinMatch(match, { id, name: id, slot: id === 'a' ? 0 : 1 })
    setReady(match, id)
  }
  for (let i = 0; i < 125; i++) stepMatch(match)
  match.players.get('a').run.score = 99
  disconnectMatch(match, 'a')
  assert.equal(match.phase, 'playing')
  match.players.get('b').run.alive = false
  stepMatch(match)
  assert.equal(match.phase, 'over')
  assert.deepEqual(matchResults(match), [
    { name: 'a', score: 99, won: false, kills: 0, deaths: 0 },
    { name: 'b', score: 0, won: true, kills: 0, deaths: 0 },
  ])
  disconnectMatch(match, 'b')
  assert.equal(matchResults(match).every(row => !row.won), true)
  const abandoned = makeMatch(42)
  for (const id of ['a', 'b']) joinMatch(abandoned, { id, name: id, slot: id === 'a' ? 0 : 1 })
  for (const id of ['a', 'b']) setReady(abandoned, id)
  for (let i = 0; i < 125; i++) stepMatch(abandoned)
  disconnectMatch(abandoned, 'a')
  disconnectMatch(abandoned, 'b')
  stepMatch(abandoned)
  assert.equal(abandoned.phase, 'over')
  assert.deepEqual(abandoned.winners, [])
})

test('winner uses score, then clean clears, then distance; exact ties share a win', () => {
  const match = makeMatch(42)
  for (const id of ['a', 'b', 'c', 'd']) {
    joinMatch(match, { id, name: id, slot: id.charCodeAt(0) - 97 })
  }
  for (const id of ['a', 'b', 'c', 'd']) setReady(match, id)
  for (let i = 0; i < 125; i++) stepMatch(match)
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => match.players.get(id).run)
  Object.assign(a, { score: 3, clean: 5, x: 200, alive: false })
  Object.assign(b, { score: 4, clean: 4, x: 300, alive: false })
  Object.assign(c, { score: 4, clean: 4, x: 310, alive: false })
  Object.assign(d, { score: 4, clean: 4, x: 310, alive: false })
  stepMatch(match)
  assert.deepEqual(match.winners, ['c', 'd'])
  assert.deepEqual(matchResults(match).map(row => row.won), [false, false, true, true])
  const cleanMatch = makeMatch(42)
  for (const id of ['a', 'b']) {
    joinMatch(cleanMatch, { id, name: id, slot: id === 'a' ? 0 : 1 })
    setReady(cleanMatch, id)
  }
  for (let i = 0; i < 125; i++) stepMatch(cleanMatch)
  Object.assign(cleanMatch.players.get('a').run, { score: 4, clean: 5, x: 200, alive: false })
  Object.assign(cleanMatch.players.get('b').run, { score: 4, clean: 4, x: 300, alive: false })
  stepMatch(cleanMatch)
  assert.deepEqual(cleanMatch.winners, ['a'])
})

test('solo snapshot carries one authoritative player and a finite course window', () => {
  const run = makeRun({ seed: 42, id: 's', name: 'Solo', slot: 0 })
  Object.assign(run, { x: gateAt(42, 5).x + 1, score: 7, shield: true,
    event: { seq: 2, type: 'shield-pickup' } })
  const view = soloSnapshot(run, [], 12)
  assert.equal(view.t, 'snap')
  assert.equal(view.phase, 'playing')
  assert.equal(view.personalBest, 12)
  assert.equal(view.viewedId, 's')
  assert.deepEqual(view.players.map(p => [p.id, p.name, p.slot, p.score, p.shield, p.event.seq]),
    [['s', 'Solo', 0, 7, true, 2]])
  assert.deepEqual(view.gates.map(g => g.index), [4, 5, 6, 7, 8])
  assert.deepEqual(view.gates[1], gateAt(42, 5))
  run.alive = false
  assert.equal(soloSnapshot(run, [], 12).phase, 'over')
  assert.equal(soloSnapshot(run, [], 12).players[0].x, run.x)
})

test('spectator follows score, then distance, then stable ID and switches on crash', () => {
  const match = makeMatch(42)
  for (const id of ['b', 'a', 'c']) {
    joinMatch(match, { id, name: id, slot: id.charCodeAt(0) - 97 })
  }
  for (const id of ['b', 'a', 'c']) setReady(match, id)
  for (let i = 0; i < 125; i++) stepMatch(match)
  const a = match.players.get('a').run
  const b = match.players.get('b').run
  const c = match.players.get('c').run
  Object.assign(a, { score: 4, x: 600, y: 200, shield: true, event: { seq: 3, type: 'shield-use' } })
  Object.assign(b, { score: 4, x: 600, y: 210, charge: true })
  Object.assign(c, { score: 3, x: 700 })
  assert.equal(snapshot(match, 'spectator', [], 0).viewedId, 'a')
  b.x = 601
  assert.equal(snapshot(match, 'spectator', [], 0).viewedId, 'b')
  b.alive = false
  assert.equal(snapshot(match, 'spectator', [], 0).viewedId, 'a')
  assert.equal(snapshot(match, 'a', [], 0).viewedId, 'a')
  a.alive = false
  assert.equal(snapshot(match, 'a', [], 0).viewedId, 'c')
})

test('live snapshot carries server state and fits the WebSocket payload limit', () => {
  const match = makeMatch(42)
  for (let i = 0; i < 8; i++) {
    joinMatch(match, { id: `p${i}`, name: `Player ${i}`, slot: i })
  }
  for (let i = 0; i < 8; i++) setReady(match, `p${i}`)
  for (let i = 0; i < 125; i++) stepMatch(match)
  const run = match.players.get('p0').run
  Object.assign(run, { x: gateAt(42, 5).x + 1, y: 220, score: 6,
    shield: true, charge: true, event: { seq: 4, type: 'charge-pickup' } })
  match.players.get('p0').score = 9999 // untrusted fields never replace run state
  const view = snapshot(match, 'p0', [], 11)
  assert.equal(view.phase, 'playing')
  assert.equal(view.viewedId, 'p0')
  assert.equal(view.players.length, 8)
  assert.deepEqual(view.gates.map(g => g.index), [4, 5, 6, 7, 8])
  assert.deepEqual(view.players[0], {
    id: 'p0', name: 'Player 0', slot: 0, x: gateAt(42, 5).x + 1, y: 220,
    alive: true, spectating: false, connected: true, score: 6, clean: 0,
    shield: true, charge: true, event: { seq: 4, type: 'charge-pickup' },
  })
  assert.ok(Buffer.byteLength(JSON.stringify(view), 'utf8') < 4096)
})

test('late spectators and disconnected lobby joins stay out of the bounded snapshot roster', () => {
  const match = makeMatch(42)
  joinMatch(match, { id: 'old', name: 'Old', slot: 0 })
  disconnectMatch(match, 'old')
  for (let i = 0; i < 8; i++) joinMatch(match, { id: String(i), name: `Player ${i}`, slot: i })
  for (let i = 0; i < 8; i++) setReady(match, String(i))
  for (let i = 0; i < 125; i++) stepMatch(match)
  disconnectMatch(match, '7')
  for (let i = 0; i < 100; i++) joinMatch(match, { id: `s${i}`, name: `Spectator ${i}`, slot: null })
  const view = snapshot(match, '0', [], 0)
  assert.equal(match.players.size, 109)
  assert.deepEqual(view.players.map(p => p.id), ['0', '1', '2', '3', '4', '5', '6', '7'])
  assert.equal(view.players[7].connected, false)
  assert.equal(matchResults(match).length, 8)
  assert.ok(Buffer.byteLength(JSON.stringify(view), 'utf8') < 4096)
})

test('spectator exact ties prefer the lower numeric stable ID', () => {
  const match = makeMatch(42)
  joinMatch(match, { id: '10', name: 'Ten', slot: 0 })
  joinMatch(match, { id: '2', name: 'Two', slot: 1 })
  setReady(match, '10')
  setReady(match, '2')
  for (let i = 0; i < 125; i++) stepMatch(match)
  assert.equal(snapshot(match, 'spectator', [], 0).viewedId, '2')
})
