import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRID,
  CIRCUITS,
  MAX_CORNER_RAD,
  TRACK_WIDTH,
  POINT_SPACING,
  CHECKPOINT_COUNT,
  createRng,
  buildCenterline,
} from './cutline.js'

test('createRng is deterministic for a seed and differs across seeds', () => {
  const a = createRng(1201)
  const b = createRng(1201)
  const c = createRng(1340)

  const drawA = [a(), a(), a(), a()]
  const drawB = [b(), b(), b(), b()]
  const drawC = [c(), c(), c(), c()]

  assert.deepEqual(drawA, drawB, 'same seed must produce the same stream')
  assert.notDeepEqual(drawA, drawC, 'different seeds must produce different streams')
  for (const v of drawA) {
    assert.ok(v >= 0 && v < 1, `rng must stay in [0, 1), got ${v}`)
  }
})

test('every named circuit has a unique name and seed', () => {
  const names = new Set(CIRCUITS.map((c) => c.name))
  const seeds = new Set(CIRCUITS.map((c) => c.seed))
  assert.equal(names.size, CIRCUITS.length, 'circuit names must be unique')
  assert.equal(seeds.size, CIRCUITS.length, 'circuit seeds must be unique')
})

test('every circuit centerline is a closed loop of unit-spaced points', () => {
  for (const circuit of CIRCUITS) {
    const line = buildCenterline(circuit.seed)

    assert.ok(line.length > 100, `${circuit.name}: centerline is implausibly short`)

    // Consecutive points, including the wrap from last back to first, are
    // adjacent and evenly spaced. The resample divides the loop's measured
    // length into equal steps, so every gap, including the seam where the
    // loop closes, should sit within a hair of the same distance as every
    // other gap, not merely under some loose ceiling.
    const gaps = []
    for (let i = 0; i < line.length; i++) {
      const a = line[i]
      const b = line[(i + 1) % line.length]
      gaps.push(Math.hypot(b.x - a.x, b.y - a.y))
    }
    const maxGap = Math.max(...gaps)
    const minGap = Math.min(...gaps)
    const meanGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length

    assert.ok(
      maxGap - minGap < 0.01,
      `${circuit.name}: gaps are not uniform, max ${maxGap.toFixed(4)} min ${minGap.toFixed(4)}`,
    )
    assert.ok(
      Math.abs(meanGap - POINT_SPACING) <= POINT_SPACING * 0.1,
      `${circuit.name}: mean gap ${meanGap.toFixed(4)} strays too far from POINT_SPACING ${POINT_SPACING}`,
    )
  }
})

test('every circuit fits the grid with room for the track width', () => {
  const half = (TRACK_WIDTH - 1) / 2
  for (const circuit of CIRCUITS) {
    for (const p of buildCenterline(circuit.seed)) {
      assert.ok(
        p.x - half >= 0 && p.x + half < GRID && p.y - half >= 0 && p.y + half < GRID,
        `${circuit.name}: point (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) puts track off the grid`,
      )
    }
  }
})

test('no circuit has a corner sharper than a hauler can take', () => {
  // At speed v the car turns TURN_RATE * (1 - TURN_FALLOFF * v / TOP_SPEED) / v
  // radians per tile travelled. MAX_CORNER_RAD is set so the sharpest legal
  // corner is taken at roughly 57% of top speed, which is a real corner rather
  // than an undrivable hairpin.
  for (const circuit of CIRCUITS) {
    const line = buildCenterline(circuit.seed)
    for (let i = 0; i < line.length; i++) {
      const a = line[i]
      const b = line[(i + 1) % line.length]
      const c = line[(i + 2) % line.length]
      const h1 = Math.atan2(b.y - a.y, b.x - a.x)
      const h2 = Math.atan2(c.y - b.y, c.x - b.x)
      let turn = Math.abs(h2 - h1)
      if (turn > Math.PI) turn = Math.PI * 2 - turn
      assert.ok(
        turn <= MAX_CORNER_RAD,
        `${circuit.name}: corner of ${turn.toFixed(3)} rad at point ${i} exceeds ${MAX_CORNER_RAD}`,
      )
    }
  }
})

test('the same seed rebuilds an identical centerline', () => {
  const a = buildCenterline(CIRCUITS[0].seed)
  const b = buildCenterline(CIRCUITS[0].seed)
  assert.deepEqual(a, b)
})

import {
  S_WALL,
  S_TARMAC,
  S_KERB,
  S_LINE,
  S_PICKUP,
  MAX_PLAYERS,
  carve,
  encodeMap,
  decodeMap,
  surfaceAt,
  stampTrack,
  walkLine,
} from './cutline.js'

const drivable = (s) => s !== S_WALL

test('every circuit carves a racing surface that is one connected region', () => {
  for (const circuit of CIRCUITS) {
    const { grid } = carve(circuit.seed)

    // Flood fill from the first drivable tile and assert it reaches them all.
    // A circuit in two pieces is a race nobody can finish.
    let start = -1
    let total = 0
    for (let i = 0; i < grid.length; i++) {
      if (drivable(grid[i])) {
        if (start < 0) start = i
        total++
      }
    }
    assert.ok(start >= 0, `${circuit.name}: carved no racing surface at all`)

    const seen = new Uint8Array(grid.length)
    const stack = [start]
    seen[start] = 1
    let reached = 0
    while (stack.length) {
      const idx = stack.pop()
      reached++
      const x = idx % GRID
      const y = (idx / GRID) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue
        const n = ny * GRID + nx
        if (seen[n] || !drivable(grid[n])) continue
        seen[n] = 1
        stack.push(n)
      }
    }

    assert.equal(reached, total, `${circuit.name}: racing surface is in more than one piece`)
  }
})

test('every circuit places its checkpoints, its line and enough starting slots', () => {
  for (const circuit of CIRCUITS) {
    const { grid, checkpoints, startSlots, centerline } = carve(circuit.seed)

    assert.equal(checkpoints.length, CHECKPOINT_COUNT, `${circuit.name}: wrong checkpoint count`)
    for (const cp of checkpoints) {
      assert.ok(cp.index >= 0 && cp.index < centerline.length, `${circuit.name}: checkpoint off the line`)
    }

    // Checkpoints are in increasing order around the loop, which is what lets
    // nextCp advance by one and wrap.
    for (let i = 1; i < checkpoints.length; i++) {
      assert.ok(checkpoints[i].index > checkpoints[i - 1].index, `${circuit.name}: checkpoints out of order`)
    }

    assert.ok(
      startSlots.length >= MAX_PLAYERS,
      `${circuit.name}: ${startSlots.length} starting slots cannot seat ${MAX_PLAYERS}`,
    )

    assert.ok([...grid].some((s) => s === S_LINE), `${circuit.name}: no cut line stamped`)
    assert.ok([...grid].some((s) => s === S_KERB), `${circuit.name}: no kerbs stamped`)
    assert.ok([...grid].some((s) => s === S_PICKUP), `${circuit.name}: no pickup tiles stamped`)
  }
})

test('a starting slot is on the racing surface, never in a wall', () => {
  for (const circuit of CIRCUITS) {
    const { grid, startSlots } = carve(circuit.seed)
    for (const slot of startSlots.slice(0, MAX_PLAYERS)) {
      assert.ok(
        drivable(surfaceAt(grid, Math.round(slot.x), Math.round(slot.y))),
        `${circuit.name}: starting slot at (${slot.x}, ${slot.y}) is walled in`,
      )
    }
  }
})

test('the same seed carves an identical grid, different seeds differ', () => {
  const a = carve(CIRCUITS[0].seed).grid
  const b = carve(CIRCUITS[0].seed).grid
  const c = carve(CIRCUITS[1].seed).grid
  assert.deepEqual([...a], [...b])
  assert.notDeepEqual([...a], [...c])
})

test('encodeMap and decodeMap round trip every circuit', () => {
  for (const circuit of CIRCUITS) {
    const { grid } = carve(circuit.seed)
    const round = decodeMap(encodeMap(grid))
    assert.deepEqual([...round], [...grid], `${circuit.name}: map did not survive the wire`)
  }
})

test('an encoded circuit is small enough to ship in a welcome frame', () => {
  for (const circuit of CIRCUITS) {
    const encoded = encodeMap(carve(circuit.seed).grid)
    assert.ok(encoded.length < 4096, `${circuit.name}: encoded to ${encoded.length} bytes, over maxPayload`)
  }
})

test('surfaceAt treats anything off the grid as wall', () => {
  const { grid } = carve(CIRCUITS[0].seed)
  assert.equal(surfaceAt(grid, -1, 10), S_WALL)
  assert.equal(surfaceAt(grid, 10, -1), S_WALL)
  assert.equal(surfaceAt(grid, GRID, 10), S_WALL)
  assert.equal(surfaceAt(grid, 10, GRID), S_WALL)
})

test('stampTrack bridges a rail a tight corner pulls apart, wrap seam included', () => {
  // A synthetic octagon, radius 12 with only 8 points, far tighter than any
  // real circuit is allowed to be (MAX_CORNER_RAD forbids it). This isolates
  // the bridging behaviour from the luck of the eight fixed seeds in
  // CIRCUITS: measured directly (disabling the elbow bridge and rerunning),
  // this exact shape drops from 540 reachable tiles to 110 of 440, so it is
  // not a case the surrounding redundancy of a 7-wide track happens to paper
  // over. If stampTrack regresses to a lone dot per point, this is expected
  // to fail loudly rather than pass by chance.
  const centre = { x: 40, y: 40 }
  const radius = 12
  const POINTS = 8
  const centerline = []
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2
    centerline.push({ x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius })
  }

  const grid = new Uint8Array(GRID * GRID)
  stampTrack(grid, centerline)

  const drivable = (s) => s !== S_WALL
  const drivableTiles = []
  for (let i = 0; i < grid.length; i++) {
    if (drivable(grid[i])) drivableTiles.push(i)
  }
  assert.ok(drivableTiles.length > 0, 'stampTrack laid no surface at all')

  const seen = new Uint8Array(grid.length)
  const stack = [drivableTiles[0]]
  seen[drivableTiles[0]] = 1
  let reached = 0
  while (stack.length) {
    const idx = stack.pop()
    reached++
    const x = idx % GRID
    const y = (idx / GRID) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue
      const n = ny * GRID + nx
      if (seen[n] || !drivable(grid[n])) continue
      seen[n] = 1
      stack.push(n)
    }
  }

  assert.equal(reached, drivableTiles.length, 'a corner this tight split the surface into more than one piece')
})

test('walkLine visits every tile from start to end and never takes a diagonal-only step', () => {
  // This is the primitive stampTrack's bridging is built on: given any two
  // integer tiles, walk a path between them where every consecutive pair is
  // 4-adjacent (shares an edge, not just a corner), so a caller that stamps
  // along the path never has to bridge it again. Cases include a short
  // diagonal (the old special case, dx=1 dy=1), longer jumps past it in both
  // x and y (the class the old special case missed, matching the review's
  // reported Chebyshev-2 and wider gaps), a pure horizontal and a pure
  // vertical run, and both directions of travel.
  const cases = [
    [0, 0, 1, 1],
    [0, 0, 2, 2],
    [0, 0, 3, 1],
    [0, 0, 4, 3],
    [5, 5, 2, 2],
    [3, 3, 3, 3],
    [0, 0, 5, 0],
    [0, 0, 0, 5],
  ]
  for (const [x0, y0, x1, y1] of cases) {
    const visited = []
    walkLine(x0, y0, x1, y1, (x, y) => visited.push([x, y]))

    assert.deepEqual(visited[0], [x0, y0], `[${x0},${y0}]->[${x1},${y1}]: does not start at the start`)
    assert.deepEqual(
      visited[visited.length - 1],
      [x1, y1],
      `[${x0},${y0}]->[${x1},${y1}]: does not end at the end`,
    )

    for (let i = 1; i < visited.length; i++) {
      const [ax, ay] = visited[i - 1]
      const [bx, by] = visited[i]
      const dx = Math.abs(bx - ax)
      const dy = Math.abs(by - ay)
      assert.ok(
        dx + dy === 1,
        `[${x0},${y0}]->[${x1},${y1}]: step ${i} from (${ax},${ay}) to (${bx},${by}) is not 4-adjacent`,
      )
    }
  }
})

import {
  TICK_MS,
  MIN_PLAYERS,
  BOT_FILL_TO,
  MIN_LAPS,
  make,
  join,
  leave,
  sanitizeName,
} from './cutline.js'

/**
 * A match with n cars on the grid, ready to race. Randomness is the injected
 * counter rng so a seeded run repeats, never Math.random.
 */
function racing(n, options = {}) {
  const match = make({ circuitIndex: 0, ...options })
  for (let i = 0; i < n; i++) join(match, { name: `D${i}` }, () => 0)
  match.phase = 'racing'
  match.laps = Math.max(MIN_LAPS, match.cars.size)
  return match
}

test('make seats a match on a named circuit with a carved grid', () => {
  const match = make({ circuitIndex: 0 })
  assert.equal(match.circuit.name, CIRCUITS[0].name)
  assert.equal(match.grid.length, GRID * GRID)
  assert.equal(match.phase, 'waiting')
  assert.equal(match.cars.size, 0)
  assert.deepEqual(match.hazards, [])
  assert.equal(match.final, false)
})

test('a car joins onto its own starting slot, facing down the track', () => {
  const match = make({ circuitIndex: 0 })
  const a = join(match, { name: 'Ladle' }, () => 0)
  const b = join(match, { name: 'Tap' }, () => 0)

  assert.equal(match.cars.size, 2)
  assert.notEqual(a.slot, b.slot, 'two cars must not share a starting slot')
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.heading))
  assert.equal(a.lap, 0)
  assert.equal(a.nextCp, 1, 'a car on the line is already waiting for checkpoint 1')
  assert.equal(a.alive, true)
  assert.equal(a.item, null)
})

test('joining beyond MAX_PLAYERS is refused', () => {
  const match = make({ circuitIndex: 0 })
  for (let i = 0; i < MAX_PLAYERS; i++) {
    assert.ok(join(match, { name: `D${i}` }, () => 0), `join ${i} should be accepted`)
  }
  assert.equal(join(match, { name: 'Late' }, () => 0), null)
  assert.equal(match.cars.size, MAX_PLAYERS)
})

test('a full grid of bots stands one down for an arriving human', () => {
  const match = make({ circuitIndex: 0 })
  for (let i = 0; i < MAX_PLAYERS; i++) join(match, { name: `B${i}`, bot: true }, () => 0)

  const human = join(match, { name: 'Operator' }, () => 0)
  assert.ok(human, 'a human must displace a bot rather than be refused')
  assert.equal(human.bot, false)
  assert.equal(match.cars.size, MAX_PLAYERS)
})

test('a name off a join screen is sanitised', () => {
  assert.equal(sanitizeName('  Ladle  '), 'Ladle')
  assert.equal(sanitizeName(''), 'Driver')
  assert.equal(sanitizeName(null), 'Driver')
  assert.equal(sanitizeName('a'.repeat(200)).length, 16)
  assert.equal(sanitizeName('Tap Hole'), 'TapHole')
  assert.equal(sanitizeName('Draw   Bench'), 'Draw Bench')
})

test('leaving removes the car and an empty grid falls back to waiting', () => {
  const match = racing(2)
  const [first] = [...match.cars.values()]
  leave(match, first.id)
  assert.equal(match.cars.size, 1)

  for (const car of [...match.cars.values()]) leave(match, car.id)
  assert.equal(match.cars.size, 0)
  assert.equal(match.phase, 'waiting')
})

test('make initialises laps to MIN_LAPS', () => {
  const match = make({ circuitIndex: 0 })
  assert.equal(match.laps, MIN_LAPS)
})

test('starting slots do not collide when counter wraps after roster churn', () => {
  const match = make({ circuitIndex: 0 })

  // Fill the grid: lifetime joins 0 through MAX_PLAYERS-1, assigning slots 0 through MAX_PLAYERS-1
  const cars = []
  for (let i = 0; i < MAX_PLAYERS; i++) {
    cars.push(join(match, { name: `Car${i}` }, () => 0))
  }
  const firstCar = cars[0]

  // Leave a middle car to free its slot. Capture the slot from the object,
  // never hardcode it, so the test works against any MAX_PLAYERS.
  const targetCar = cars[Math.floor(MAX_PLAYERS / 2)]
  const freedSlot = targetCar.slot
  leave(match, targetCar.id)

  // Join one more: lifetime join #MAX_PLAYERS, so the old counter computes
  // MAX_PLAYERS % MAX_PLAYERS === 0 and assigns slot 0 (still held by firstCar).
  // The fixed code scans for the freed slot instead.
  const newCar = join(match, { name: 'NewCar' }, () => 0)

  // The new car should occupy the freed slot
  assert.equal(newCar.slot, freedSlot, `new car should occupy freed slot ${freedSlot}`)

  // The new car must NOT collide with the first car, which still lives
  assert.notEqual(
    newCar.slot,
    firstCar.slot,
    `new car slot ${newCar.slot} collided with first car slot ${firstCar.slot}`,
  )

  // Verify all live cars have unique slots
  const slots = new Set([...match.cars.values()].map((car) => car.slot))
  assert.equal(slots.size, match.cars.size, 'all cars have unique slots')

  // Verify all live cars have unique starting positions
  const positions = new Set([...match.cars.values()].map((car) => `${car.x},${car.y}`))
  assert.equal(positions.size, match.cars.size, 'all cars have unique starting positions')
})

test('BOT_FILL_TO and MIN_PLAYERS are sane against the grid', () => {
  assert.ok(MIN_PLAYERS >= 2, 'a race needs at least two cars')
  assert.ok(BOT_FILL_TO <= MAX_PLAYERS, 'bots cannot overfill the grid')
  assert.ok(TICK_MS > 0)
})
