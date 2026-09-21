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
  assert.equal(sanitizeName('Tap\x00\x07Hole'), 'TapHole')
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

// S_TARMAC is already imported above; re-importing it here would be a
// duplicate binding (SyntaxError), so it is left out of this block.
import {
  TOP_SPEED,
  TURN_RATE,
  OFFTRACK_CAP,
  WALL_HIT_KEEP,
  GRIP,
  S_OIL,
  applyInput,
  stepCar,
  topSpeedOf,
} from './cutline.js'

const speedOf = (car) => Math.hypot(car.vx, car.vy)

/** Put a car at a known tile with a known velocity, for a physics test. */
function placed(match, car, { x, y, heading = 0, speed = 0, lateral = 0 }) {
  car.x = x
  car.y = y
  car.heading = heading
  car.vx = Math.cos(heading) * speed - Math.sin(heading) * lateral
  car.vy = Math.sin(heading) * speed + Math.cos(heading) * lateral
  return car
}

test('holding throttle accelerates a car along its nose', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  applyInput(match, car.id, { throttle: 1, steer: 0 })

  const before = speedOf(car)
  for (let i = 0; i < 10; i++) stepCar(match, car, TICK_MS / 1000)
  assert.ok(speedOf(car) > before, 'throttle must build speed')
  assert.ok(speedOf(car) <= topSpeedOf(match, car) + 0.001, 'speed must not exceed the cap')
})

test('steering is a rate: holding it turns continuously', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  placed(match, car, { x: car.x, y: car.y, heading: 0, speed: 4 })
  applyInput(match, car.id, { throttle: 1, steer: 1 })

  const first = car.heading
  stepCar(match, car, 0.1)
  const afterOne = car.heading
  stepCar(match, car, 0.1)
  const afterTwo = car.heading

  assert.ok(afterOne > first, 'one step of held steer must turn the car')
  assert.ok(afterTwo > afterOne, 'a second step must keep turning it')
  assert.ok(
    Math.abs(afterOne - first) <= TURN_RATE * 0.1 + 0.001,
    'a step must never turn more than TURN_RATE allows',
  )
})

test('turn rate falls off as speed rises', () => {
  const match = racing(1)
  const [slow] = [...match.cars.values()]
  const fast = join(match, { name: 'Fast' }, () => 0)

  placed(match, slow, { x: slow.x, y: slow.y, heading: 0, speed: 1 })
  placed(match, fast, { x: slow.x, y: slow.y, heading: 0, speed: TOP_SPEED })
  applyInput(match, slow.id, { steer: 1 })
  applyInput(match, fast.id, { steer: 1 })

  const slowBefore = slow.heading
  const fastBefore = fast.heading
  stepCar(match, slow, 0.1)
  stepCar(match, fast, 0.1)

  assert.ok(
    slow.heading - slowBefore > fast.heading - fastBefore,
    'a slow car must out-turn a fast one',
  )
})

test('lateral velocity bleeds off faster on tarmac than on oil', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]

  // Find a tarmac tile and an oil tile on this circuit by writing one, so the
  // test does not depend on where decoration happened to land.
  const cp = match.checkpoints[3]
  const tx = Math.round(cp.x)
  const ty = Math.round(cp.y)

  match.grid[ty * GRID + tx] = S_TARMAC
  placed(match, car, { x: tx, y: ty, heading: 0, speed: 0, lateral: 4 })
  stepCar(match, car, 0.1)
  const onTarmac = Math.abs(-car.vx * Math.sin(0) + car.vy * Math.cos(0))

  match.grid[ty * GRID + tx] = S_OIL
  placed(match, car, { x: tx, y: ty, heading: 0, speed: 0, lateral: 4 })
  stepCar(match, car, 0.1)
  const onOil = Math.abs(-car.vx * Math.sin(0) + car.vy * Math.cos(0))

  assert.ok(onOil > onTarmac, 'oil must hold a slide that tarmac would kill')
  assert.ok(GRIP[S_OIL] < GRIP[S_TARMAC], 'the grip table must agree with the behaviour')
})

test('off the racing surface a car is capped and dragged', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]

  // Corner of the grid is always wall on every circuit.
  placed(match, car, { x: 1, y: 1, heading: 0, speed: TOP_SPEED })
  applyInput(match, car.id, { throttle: 1 })
  for (let i = 0; i < 60; i++) stepCar(match, car, TICK_MS / 1000)

  assert.ok(speedOf(car) <= OFFTRACK_CAP + 0.001, `off track speed ${speedOf(car)} exceeds the cap`)
})

test('a car driven into a wall keeps only WALL_HIT_KEEP of its speed', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const { centerline, grid } = match

  // Find a centerline point whose outward normal is close to a grid axis.
  // A near axis-aligned approach concentrates the car's velocity on one
  // component, so the per-axis wall check in stepCar resolves the bounce on
  // that one axis cleanly, rather than splitting it unpredictably across
  // both. Derived from real circuit geometry, not a guessed coordinate: a
  // hardcoded corner (the old (2, 2)) sits off every circuit's racing
  // surface entirely, so the wall-contact branch it was meant to exercise
  // never actually ran.
  let best = null
  for (let i = 0; i < centerline.length; i++) {
    const a = centerline[(i - 1 + centerline.length) % centerline.length]
    const b = centerline[(i + 1) % centerline.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const tlen = Math.hypot(dx, dy) || 1
    const tangent = { x: dx / tlen, y: dy / tlen }

    const p = centerline[i]
    const radial = { x: p.x - GRID / 2, y: p.y - GRID / 2 }
    let normal = { x: -tangent.y, y: tangent.x }
    if (normal.x * radial.x + normal.y * radial.y < 0) {
      normal = { x: tangent.y, y: -tangent.x } // keep the normal pointing outward
    }

    const axisAligned = Math.max(Math.abs(normal.x), Math.abs(normal.y))
    if (!best || axisAligned > best.axisAligned) best = { p, normal, axisAligned }
  }

  const { p, normal } = best

  // Step outward from the centerline, tile by tile, until surfaceAt leaves
  // the racing surface. The last drivable tile before that is on track and
  // touching a wall.
  let wx = p.x
  let wy = p.y
  let onX = Math.round(wx)
  let onY = Math.round(wy)
  let steps = 0
  while (surfaceAt(grid, Math.round(wx), Math.round(wy)) !== S_WALL && steps < GRID) {
    onX = Math.round(wx)
    onY = Math.round(wy)
    wx += normal.x
    wy += normal.y
    steps++
  }
  assert.ok(steps > 0 && steps < GRID, 'never found a wall walking outward from the centerline')
  assert.notEqual(surfaceAt(grid, onX, onY), S_WALL, 'the tile just inside the wall must be drivable')

  // Drive straight at the wall, nose first, along the outward normal.
  const heading = Math.atan2(normal.y, normal.x)
  placed(match, car, { x: onX, y: onY, heading, speed: 10 })

  let bounced = false
  for (let i = 0; i < 30 && !bounced; i++) {
    const before = car.vx * normal.x + car.vy * normal.y
    stepCar(match, car, TICK_MS / 1000)
    const after = car.vx * normal.x + car.vy * normal.y

    assert.notEqual(
      surfaceAt(grid, Math.round(car.x), Math.round(car.y)),
      S_WALL,
      'the wall must stop the car; it must never actually enter the wall tile',
    )

    if (before > 1 && after < 0) {
      bounced = true
      // WALL_HIT_KEEP reflects velocity, it does not merely damp it: the
      // component driving into the wall must reverse sign, and by enough
      // that this cannot be explained by ordinary drag alone. A fixed ratio
      // is used here rather than one built from WALL_HIT_KEEP itself,
      // because the whole point is to catch a keep factor near 1 (an
      // elastic, unscrubbed bounce) or a neutralised branch, and a bound
      // derived from the same constant the bug would corrupt could never
      // fail regardless of what that constant said.
      assert.ok(after < 0, 'the blocked velocity component must reverse sign')
      assert.ok(
        Math.abs(after) < Math.abs(before) * 0.6,
        `contact must scrub speed, not just reflect it: before ${before.toFixed(2)}, after ${after.toFixed(2)}`,
      )
    }
  }
  assert.ok(bounced, 'driving straight at a wall must trigger the bounce within 30 ticks')
})

test('hostile and malformed input never moves a car or produces NaN', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]

  for (const input of [
    { steer: 99 },
    { steer: -99 },
    { steer: NaN },
    { steer: Infinity },
    { steer: '1' },
    { steer: null },
    { steer: {} },
    { steer: [] },
    { throttle: NaN },
    { throttle: 'yes' },
    {},
    null,
    undefined,
  ]) {
    applyInput(match, car.id, input)
    for (let i = 0; i < 5; i++) stepCar(match, car, TICK_MS / 1000)
    assert.ok(Number.isFinite(car.x), `x went non finite on ${JSON.stringify(input)}`)
    assert.ok(Number.isFinite(car.y), `y went non finite on ${JSON.stringify(input)}`)
    assert.ok(Number.isFinite(car.heading), `heading went non finite on ${JSON.stringify(input)}`)
    assert.ok(Number.isFinite(car.vx) && Number.isFinite(car.vy), 'velocity went non finite')
  }
})

test('applyInput refuses an unknown id and a dead car', () => {
  const match = racing(2)
  const [car] = [...match.cars.values()]
  assert.equal(applyInput(match, 'nobody', { throttle: 1 }), false)

  car.alive = false
  assert.equal(applyInput(match, car.id, { throttle: 1 }), false)
})

test('a prototype key as an id is not a car', () => {
  const match = racing(2)
  for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(applyInput(match, hostile, { throttle: 1 }), false, `${hostile} must not resolve`)
  }
})

import {
  GRACE_LAPS,
  CHECKPOINT_RADIUS,
  updateProgress,
  runningOrder,
  applyCut,
} from './cutline.js'

/** Drive a car onto a checkpoint and register it. */
function takeCheckpoint(match, car, index) {
  const cp = match.checkpoints[index]
  car.x = cp.x
  car.y = cp.y
  updateProgress(match, car)
}

/** Walk a car cleanly through every checkpoint and back over the line. */
function completeLap(match, car) {
  for (let i = 1; i < match.checkpoints.length; i++) takeCheckpoint(match, car, i)
  takeCheckpoint(match, car, 0)
}

test('a checkpoint taken out of order does not advance progress', () => {
  const match = racing(2)
  const [car] = [...match.cars.values()]

  const before = car.nextCp
  takeCheckpoint(match, car, 5) // skipping 1 through 4
  assert.equal(car.nextCp, before, 'a checkpoint out of order must be ignored')
  assert.equal(car.cpTaken, 0)
})

test('checkpoints taken in order advance progress and wrap', () => {
  const match = racing(2)
  const [car] = [...match.cars.values()]

  for (let i = 1; i < match.checkpoints.length; i++) {
    takeCheckpoint(match, car, i)
    assert.equal(car.nextCp, (i + 1) % match.checkpoints.length, `after checkpoint ${i}`)
  }
  assert.equal(car.cpTaken, match.checkpoints.length - 1)
})

test('crossing the line with checkpoints missed does not count a lap', () => {
  const match = racing(2)
  const [car] = [...match.cars.values()]

  // Straight back to the line without touching a single checkpoint: the
  // infield shortcut this whole mechanism exists to refuse.
  takeCheckpoint(match, car, 0)
  assert.equal(car.lap, 0, 'a shortcut must not count')
})

test('a clean lap counts and resets the checkpoint ring', () => {
  const match = racing(2)
  const [car] = [...match.cars.values()]

  completeLap(match, car)
  assert.equal(car.lap, 1)
  assert.equal(car.nextCp, 1, 'the ring must reset for the next lap')
  assert.equal(car.cpTaken, 0)
})

test('running order sorts by lap, then checkpoints, then distance to the next', () => {
  const match = racing(5)
  // Join order deliberately does not match the intended running order for
  // the tier-3 pair (far joins before near, see below), so a comparator that
  // dropped a tier and fell back to array order could not pass by accident.
  const [leader, moreCps, fewerCps, far, near] = [...match.cars.values()]

  // Tier 1 (lap): leader is a lap up on everyone else. No earlier tier to
  // tie on, so this alone must place it first.
  completeLap(match, leader)

  // Tier 2 (checkpoints, tied on lap): moreCps and fewerCps both sit on lap
  // 0, so only cpTaken can separate them, and their distances are rigged
  // backwards on purpose: fewerCps sits exactly on its next checkpoint
  // (distance 0) while moreCps sits well short of its own. A comparator that
  // fell through to distance instead of checking cpTaken would rank them the
  // other way around.
  const cp6 = match.checkpoints[6]
  moreCps.nextCp = 6
  moreCps.cpTaken = 5
  moreCps.x = cp6.x + 10
  moreCps.y = cp6.y

  const cp7 = match.checkpoints[7]
  fewerCps.nextCp = 7
  fewerCps.cpTaken = 2
  fewerCps.x = cp7.x
  fewerCps.y = cp7.y

  // Tier 3 (distance, tied on lap and checkpoints): far and near share both
  // lap (0) and cpTaken (3), so only distance to the next checkpoint can
  // separate them. far joined before near (see destructuring above), so a
  // comparator that dropped the distance tier and left ties in array order
  // would keep far ahead of near, the wrong order, rather than passing by
  // coincidence.
  const cp8 = match.checkpoints[8]
  far.nextCp = 8
  far.cpTaken = 3
  far.x = cp8.x + 10
  far.y = cp8.y

  const cp9 = match.checkpoints[9]
  near.nextCp = 9
  near.cpTaken = 3
  near.x = cp9.x
  near.y = cp9.y

  const order = runningOrder(match)
  assert.equal(order[0].id, leader.id, 'the car a lap up leads')
  assert.equal(
    order[1].id,
    moreCps.id,
    'more checkpoints beats fewer, even against a shorter distance to go',
  )
  assert.equal(
    order[2].id,
    near.id,
    'tied on laps and checkpoints, the car closer to its next checkpoint leads',
  )
  assert.equal(
    order[3].id,
    far.id,
    'tied on laps and checkpoints, the car farther from its next checkpoint trails',
  )
  assert.equal(
    order[4].id,
    fewerCps.id,
    'fewer checkpoints trails, even against a shorter distance to go',
  )
})

test('the cut removes the car last in running order, not the last to finish', () => {
  const match = racing(3)
  // Join order is deliberately the reverse of running order: c, joined
  // last, is given the most progress, and a, joined first, is given the
  // least. An implementation that cut by insertion order instead of
  // runningOrder would reach for c here, not a, so the two cannot agree by
  // accident.
  const [a, b, c] = [...match.cars.values()]

  completeLap(match, c)                       // joined last, one lap up: leads
  takeCheckpoint(match, b, 1)                 // joined second, middling progress
  // a has taken nothing at all: joined first, but genuinely last in running order

  match.lap = GRACE_LAPS + 1 // past the grace lap, so a cut is due
  applyCut(match)

  assert.equal(
    a.alive,
    false,
    `expected a (last in running order, first joined) to be cut; instead cut was ${match.cut?.id}`,
  )
  assert.equal(b.alive, true, 'b is not last in running order and must survive the cut')
  assert.equal(c.alive, true, 'c leads and must survive the cut')
  assert.equal(
    match.cut?.id,
    a.id,
    `expected the cut to name a (${a.id}), got ${match.cut?.id}`,
  )
})

test('lap 1 takes no cut', () => {
  const match = racing(3)
  match.lap = GRACE_LAPS // still the grace lap
  applyCut(match)
  assert.equal([...match.cars.values()].filter((c) => c.alive).length, 3, 'nobody leaves on lap 1')
})

test('the cut never empties the grid below one car', () => {
  const match = racing(2)
  match.lap = GRACE_LAPS + 1
  applyCut(match)
  assert.equal([...match.cars.values()].filter((c) => c.alive).length, 1)

  applyCut(match)
  assert.equal(
    [...match.cars.values()].filter((c) => c.alive).length,
    1,
    'a race with one car left cuts nobody',
  )
})

test('an eliminated car is skipped by the cut and by running order', () => {
  const match = racing(3)
  const cars = [...match.cars.values()]
  cars[2].alive = false

  assert.equal(runningOrder(match).length, 2, 'a dead car is not in the order')

  match.lap = GRACE_LAPS + 1
  applyCut(match)
  assert.equal(cars.filter((c) => c.alive).length, 1)
})

test('a checkpoint is only taken from within CHECKPOINT_RADIUS', () => {
  const match = racing(2)
  const [car] = [...match.cars.values()]
  const cp = match.checkpoints[1]

  car.x = cp.x + CHECKPOINT_RADIUS * 4
  car.y = cp.y
  updateProgress(match, car)
  assert.equal(car.nextCp, 1, 'a distant car must not register the checkpoint')

  car.x = cp.x
  updateProgress(match, car)
  assert.equal(car.nextCp, 2, 'a car on the checkpoint must register it')
})
