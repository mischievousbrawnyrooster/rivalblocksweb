import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRID,
  CIRCUITS,
  MAX_CORNER_RAD,
  SEGMENT_WIDTH_MAX,
  POINT_SPACING,
  CHECKPOINT_COUNT,
  createRng,
  buildCenterline,
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
  SHORTCUT_CHANCE,
  SHORTCUT_WIDTH,
  measureCircuit,
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
    const { centerline: line } = buildCenterline(circuit.seed)

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
  const half = SEGMENT_WIDTH_MAX / 2
  for (const circuit of CIRCUITS) {
    const { centerline } = buildCenterline(circuit.seed)
    for (const p of centerline) {
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
    const { centerline: line } = buildCenterline(circuit.seed)
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


const drivable = (s) => s !== S_WALL
// LANE_GAP is module private; this is its value, used only to bound a search.
const LANE_GAP_MAX = 1.5

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
      const prevDist = (checkpoints[i - 1].index - checkpoints[0].index + centerline.length) % centerline.length
      const curDist = (checkpoints[i].index - checkpoints[0].index + centerline.length) % centerline.length
      assert.ok(curDist > prevDist, `${circuit.name}: checkpoints out of order`)
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
  RACE_LAPS,
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

/**
 * Drive a car through the finish line, approaching from behind and coming out
 * the far side. The line is judged as a crossing rather than a proximity, so a
 * car teleported onto the paint has not crossed anything: it needs a sample
 * behind the line and then one past it.
 */
function crossLine(match, car, across = 0) {
  const p = match.checkpoints[0]
  const line = match.centerline
  const idx = p.index
  const a = line[(idx - 1 + line.length) % line.length]
  const b = line[(idx + 1) % line.length]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const t = { x: dx / len, y: dy / len }
  const place = (along) => {
    car.x = p.x + t.x * along - t.y * across
    car.y = p.y + t.y * along + t.x * across
  }
  place(-1.5)
  updateProgress(match, car)
  place(0.5)
  updateProgress(match, car)
}

/** Walk a car cleanly through every checkpoint and back over the line. */
function completeLap(match, car) {
  for (let i = 1; i < match.checkpoints.length; i++) takeCheckpoint(match, car, i)
  crossLine(match, car)
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

test('applyCut does not eliminate cars (eliminations disabled)', () => {
  const match = racing(3)
  const [a, b, c] = [...match.cars.values()]

  completeLap(match, c)
  takeCheckpoint(match, b, 1)

  match.lap = GRACE_LAPS + 1
  const cut = applyCut(match)

  assert.equal(cut, null, 'applyCut must return null when eliminations are disabled')
  assert.equal(a.alive, true, 'a must survive with eliminations disabled')
  assert.equal(b.alive, true, 'b must survive with eliminations disabled')
  assert.equal(c.alive, true, 'c must survive with eliminations disabled')
})

test('lap 1 takes no cut', () => {
  const match = racing(3)
  match.lap = GRACE_LAPS // still the grace lap
  applyCut(match)
  assert.equal([...match.cars.values()].filter((c) => c.alive).length, 3, 'nobody leaves on lap 1')
})

test('the cut never empties the grid', () => {
  const match = racing(2)
  match.lap = GRACE_LAPS + 1
  applyCut(match)
  assert.equal([...match.cars.values()].filter((c) => c.alive).length, 2)

  applyCut(match)
  assert.equal(
    [...match.cars.values()].filter((c) => c.alive).length,
    2,
    'cars remain on grid with eliminations disabled',
  )
})

test('an eliminated car is skipped by running order', () => {
  const match = racing(3)
  const cars = [...match.cars.values()]
  cars[2].alive = false

  assert.equal(runningOrder(match).length, 2, 'a dead car is not in the order')

  match.lap = GRACE_LAPS + 1
  applyCut(match)
  assert.equal(cars.filter((c) => c.alive).length, 2)
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

import {
  SLIP_RANGE,
  SLIP_BOOST,
  SLICK_TTL_MS,
  PICKUP_RESPAWN_MS,
  MAX_HAZARDS,
  PICKUP_ROW,
  BANANA_TTL_MS,
  SPIN_MS,
  ITEM_BAG,
  BOOST_MS,
  S_BOOST,
  updateDraft,
  collectPickup,
  useItem,
  expireHazards,
  applyHazards,
} from './cutline.js'

test('a car in the wake of another gains slipstream', () => {
  const match = racing(2)
  const [lead, chase] = [...match.cars.values()]

  lead.x = 40
  lead.y = 40
  lead.heading = 0
  chase.x = 40 - SLIP_RANGE * 0.5 // directly behind the leader's tail
  chase.y = 40
  chase.heading = 0

  updateDraft(match)
  assert.equal(chase.drafting, true, 'a car in the wake must draft')
  assert.equal(lead.drafting, false, 'the leader drafts nobody')
  assert.ok(topSpeedOf(match, chase) > topSpeedOf(match, lead))
  assert.ok(Math.abs(topSpeedOf(match, chase) - TOP_SPEED * SLIP_BOOST) < 0.001)
})

test('slipstream does not apply out of range, alongside, or ahead', () => {
  const match = racing(2)
  const [lead, chase] = [...match.cars.values()]
  lead.x = 40
  lead.y = 40
  lead.heading = 0

  chase.heading = 0
  chase.x = 40 - SLIP_RANGE * 3 // too far back
  chase.y = 40
  updateDraft(match)
  assert.equal(chase.drafting, false, 'out of range must not draft')

  chase.x = 40 // alongside
  chase.y = 40 - SLIP_RANGE * 0.5
  updateDraft(match)
  assert.equal(chase.drafting, false, 'alongside must not draft')

  chase.x = 40 + SLIP_RANGE * 0.5 // ahead of the leader
  chase.y = 40
  updateDraft(match)
  assert.equal(chase.drafting, false, 'ahead must not draft')
})

test('an eliminated car gives no slipstream', () => {
  const match = racing(2)
  const [lead, chase] = [...match.cars.values()]
  lead.x = 40
  lead.y = 40
  lead.heading = 0
  lead.alive = false
  chase.x = 40 - SLIP_RANGE * 0.5
  chase.y = 40
  chase.heading = 0

  updateDraft(match)
  assert.equal(chase.drafting, false, 'a dead car must not tow a live one')
})

test('a pickup fills an empty slot, not a full one, and starts a cooldown', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]

  // Write a pickup tile under the car so the test does not depend on where
  // decoration landed.
  const tx = Math.round(car.x)
  const ty = Math.round(car.y)
  match.grid[ty * GRID + tx] = S_PICKUP

  // A counter rng whose first and second draws land on genuinely different
  // ITEM_BAG entries (index 0 is 'boost', the last index is 'slick'; ITEM_BAG
  // repeats
  // entries, so two different indices are not automatically two different
  // items, this pair is chosen to be safe). If the full-slot guard failed to
  // block a second draw, that draw would consume this rng's second value and
  // swap the held item for a different one, not silently redraw the same
  // value the way a fixed rng would.
  let calls = 0
  const rng = () => (calls++ === 0 ? 0 : 0.9)

  collectPickup(match, car, rng)
  assert.ok(car.item, 'an empty slot must fill')
  const held = car.item
  assert.equal(held, 'boost', 'the first draw must be ITEM_BAG[0]')

  // The tile is on cooldown, so a second pass takes nothing even once emptied.
  car.item = null
  collectPickup(match, car, rng)
  assert.equal(car.item, null, 'a tile on cooldown gives nothing')

  car.item = held
  match.now += PICKUP_RESPAWN_MS + 1
  collectPickup(match, car, rng)
  assert.equal(car.item, held, 'a full slot must not be overwritten')
})

test('powerups spawn as a rank across the road, every box on the racing surface', () => {
  for (const circuit of CIRCUITS) {
    const { grid, centerline, pickups } = carve(circuit.seed)
    assert.ok(pickups.length > 0, `${circuit.name}: must spawn at least one pickup`)

    // Every box must be drivable. A box stamped into a wall is a box nobody can
    // ever take, and it would sit in the snapshot forever looking available.
    for (const p of pickups) {
      assert.notEqual(
        surfaceAt(grid, p.x, p.y),
        S_WALL,
        `${circuit.name}: pickup at (${p.x}, ${p.y}) is in a wall`,
      )
    }

    // Every box must carry its own key, or taking one lane would silently put
    // the rest of its row on cooldown too.
    const keys = new Set(pickups.map((p) => p.key))
    assert.equal(keys.size, pickups.length, `${circuit.name}: two boxes share a key`)

    // The boxes must actually form ranks rather than a single file down the
    // middle: at least one group of boxes must span the road laterally. Boxes in
    // one row sit within a couple of tiles of each other along the track but
    // apart from each other across it.
    let widest = 0
    for (const a of pickups) {
      let span = 0
      for (const b of pickups) {
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d > 0 && d <= PICKUP_ROW * LANE_GAP_MAX) span = Math.max(span, d)
      }
      widest = Math.max(widest, span)
    }
    assert.ok(
      widest >= 1.5,
      `${circuit.name}: boxes never span the road, widest neighbour gap was ${widest.toFixed(2)}`,
    )
  }

  // Spacing and coordinates are randomised across different circuit seeds
  const pickupsA = carve(CIRCUITS[0].seed).pickups
  const pickupsB = carve(CIRCUITS[1].seed).pickups
  assert.notDeepEqual(pickupsA, pickupsB, 'different circuits should have randomised pickup distributions')
})

test('taking one box in a row leaves the rest of that row standing', () => {
  // The Mario Kart property: a row is a choice of lane, not a single pickup that
  // the nearest car consumes for everybody.
  const match = racing(2)
  const [a, b] = [...match.cars.values()]
  const row = match.pickups.slice(0, 2)
  assert.equal(row.length, 2, 'need at least two boxes to test this')

  a.item = null
  a.x = row[0].x
  a.y = row[0].y
  assert.equal(collectPickup(match, a, () => 0), true, 'the first car takes its box')

  b.item = null
  b.x = row[1].x
  b.y = row[1].y
  assert.equal(collectPickup(match, b, () => 0), true, 'a neighbouring box must still be there')
})

test('using an empty slot is a no-op', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  car.item = null
  assert.equal(useItem(match, car), false)
  assert.equal(match.hazards.length, 0)
})

test('boost raises the speed cap for BOOST_MS and then lapses', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  car.item = 'boost'

  assert.equal(useItem(match, car), true)
  assert.equal(car.item, null, 'using an item empties the slot')
  assert.ok(topSpeedOf(match, car) > TOP_SPEED)

  match.now += BOOST_MS + 1
  assert.ok(Math.abs(topSpeedOf(match, car) - TOP_SPEED) < 0.001, 'boost must lapse')
})

test('crossing a boost strip grants the same boost the item does', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const tx = Math.round(car.x)
  const ty = Math.round(car.y)
  match.grid[ty * GRID + tx] = S_BOOST

  applyHazards(match, car)
  assert.ok(topSpeedOf(match, car) > TOP_SPEED, 'a strip must boost')
})

test('a slick drops behind the car, never on it', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  car.x = 40
  car.y = 40
  car.heading = 0 // facing positive x
  car.item = 'slick'

  useItem(match, car)
  assert.equal(match.hazards.length, 1)
  const [hazard] = match.hazards
  assert.equal(hazard.kind, 'slick')
  assert.ok(hazard.x < car.x, 'the slick must land behind the nose')
})

test('a dropped hazard expires and is swept', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  car.item = 'slick'
  useItem(match, car)

  assert.equal(match.hazards.length, 1)
  assert.equal(match.hazards[0].kind, 'slick')

  match.now += SLICK_TTL_MS + 1
  expireHazards(match)
  assert.equal(match.hazards.length, 0, 'an expired hazard must be swept')
})

test('the bag no longer carries a wall', () => {
  // The wall was removed deliberately: a near stop is the wrong verb for a game
  // whose handling is momentum and sliding. If it ever comes back it should come
  // back as a decision, not because someone re-added a string.
  assert.ok(!ITEM_BAG.includes('wall'), 'wall must not be in the bag')
})

test('hazards are capped, oldest evicted first', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]

  // A sorted-until check cannot tell "kept the newest" from "kept the
  // oldest": until increases every iteration, so either half of the array is
  // already sorted ascending on its own. Identifying each hazard by a unique
  // x instead lets the assertion check which ones actually survived, not
  // merely whether survivors are in order.
  const totalDrops = MAX_HAZARDS + 5
  const droppedX = []
  for (let i = 0; i < totalDrops; i++) {
    car.item = 'slick'
    car.x = 30 + i // distinct per drop, so each hazard is identifiable later
    match.now += 1
    useItem(match, car)
    // The hazard just added is always last: useItem pushes, then evicts from
    // the front, so the tail is never touched by that eviction.
    droppedX.push(match.hazards[match.hazards.length - 1].x)
  }

  assert.equal(match.hazards.length, MAX_HAZARDS, 'the hazard list must stay capped')

  const survivingX = new Set(match.hazards.map((h) => h.x))
  const evictedCount = totalDrops - MAX_HAZARDS

  for (let i = 0; i < evictedCount; i++) {
    assert.ok(!survivingX.has(droppedX[i]), `drop ${i}, the earliest, must have been evicted`)
  }
  for (let i = evictedCount; i < totalDrops; i++) {
    assert.ok(survivingX.has(droppedX[i]), `drop ${i}, the most recent, must still be present`)
  }
})

test('a slick is not survived by its expiry, and a car on one loses grip', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  car.x = 40
  car.y = 40
  match.hazards.push({ kind: 'slick', x: 40, y: 40, until: match.now + SLICK_TTL_MS, by: car.id })

  applyHazards(match, car)
  assert.ok(car.onSlick, 'a car standing on a slick must be marked')

  match.now += SLICK_TTL_MS + 1
  expireHazards(match)
  assert.equal(match.hazards.length, 0)
})

test('a car on a dropped slick keeps markedly more lateral velocity than the same car on tarmac', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]

  // A genuinely on-track tile. stepCar treats a wall tile as offTrack and
  // takes an entirely different branch, one that never reads GRIP at all, so
  // a test run on wall would never exercise the code this test names.
  const cp = match.checkpoints[3]
  const tx = Math.round(cp.x)
  const ty = Math.round(cp.y)
  match.grid[ty * GRID + tx] = S_TARMAC

  // Control: the same lateral slide, on plain tarmac, no hazard involved.
  placed(match, car, { x: tx, y: ty, heading: 0, speed: 0, lateral: 4 })
  stepCar(match, car, 0.1)
  const control = Math.abs(-car.vx * Math.sin(0) + car.vy * Math.cos(0))

  // Same tile, same slide, but now a dropped slick sits under the car. The
  // hazard must first mark the car via applyHazards, exactly as it would in
  // the real tick order, before stepCar ever runs.
  placed(match, car, { x: tx, y: ty, heading: 0, speed: 0, lateral: 4 })
  match.hazards.push({ kind: 'slick', x: tx, y: ty, until: match.now + SLICK_TTL_MS, by: car.id })
  applyHazards(match, car)
  assert.ok(car.onSlick, 'the hazard must mark the car before the physics check means anything')
  stepCar(match, car, 0.1)
  const onSlick = Math.abs(-car.vx * Math.sin(0) + car.vy * Math.cos(0))

  assert.ok(
    onSlick > control * 2,
    `a dropped slick must preserve markedly more lateral velocity than tarmac (onSlick ${onSlick.toFixed(3)}, control ${control.toFixed(3)})`,
  )
})

test('the item bag is drawn the same way regardless of running position', () => {
  // A car running last must draw from exactly the same odds as the leader.
  // There are no rubber banded catch-up items in this game: slipstream is the
  // catch-up mechanic, because it rewards closing the gap rather than having
  // failed to.
  const match = racing(2)
  const order = runningOrder(match)
  const leader = order[0]
  const last = order[order.length - 1]

  for (const car of [leader, last]) {
    const tx = Math.round(car.x)
    const ty = Math.round(car.y)
    match.grid[ty * GRID + tx] = S_PICKUP
  }

  // The same rng draw must give both cars the same item.
  leader.item = null
  last.item = null
  collectPickup(match, leader, () => 0.5)
  collectPickup(match, last, () => 0.5)
  assert.equal(leader.item, last.item, 'position must not change what the bag gives')

  assert.ok(ITEM_BAG.length > 0)
  for (const item of ITEM_BAG) {
    assert.ok(['boost', 'slick', 'banana'].includes(item), `unknown item ${item} in the bag`)
  }
})

import { COUNTDOWN_MS, BOT_NAMES, driveBots, tick, snapshot, startRace } from './cutline.js'

/** Run a match forward by wall-clock milliseconds at the real tick rate. */
function run(match, ms, rng = () => 0.5) {
  for (let t = 0; t < ms; t += TICK_MS) tick(match, TICK_MS, rng)
}

test('a lone driver waits, and a full lobby counts down', () => {
  const solo = make({ circuitIndex: 0, botFill: 0 })
  join(solo, { name: 'Alone' }, () => 0)
  run(solo, 200)
  assert.equal(solo.phase, 'waiting', 'one driver and no bots stays in the lobby')

  const pair = make({ circuitIndex: 0, botFill: 0 })
  join(pair, { name: 'A' }, () => 0)
  join(pair, { name: 'B' }, () => 0)
  run(pair, 200)
  assert.equal(pair.phase, 'countdown', `MIN_PLAYERS drivers must start a countdown`)
})

test('a lone driver who asks for bots gets a race', () => {
  const match = make({ circuitIndex: 0 })
  join(match, { name: 'Alone' }, () => 0)
  match.botsWanted = true
  run(match, 200)

  assert.ok(match.cars.size >= BOT_FILL_TO, 'bots must fill the grid')
  assert.ok(['countdown', 'racing'].includes(match.phase))
  for (const car of match.cars.values()) {
    if (car.bot) assert.ok(BOT_NAMES.includes(car.name), `bot name ${car.name} is off the list`)
  }
})

test('the countdown runs down and the race starts', () => {
  const match = make({ circuitIndex: 0, botFill: 0 })
  join(match, { name: 'A' }, () => 0)
  join(match, { name: 'B' }, () => 0)

  run(match, 100)
  assert.equal(match.phase, 'countdown')

  run(match, COUNTDOWN_MS + 100)
  assert.equal(match.phase, 'racing')
  assert.equal(match.lap, 0)
  assert.equal(match.elapsed >= 0, true)
})

test('bots drive the generated racing line and complete laps', () => {
  const match = make({ circuitIndex: 0 })
  for (let i = 0; i < 4; i++) join(match, { name: BOT_NAMES[i], bot: true }, () => 0.5)
  startRace(match)

  run(match, 90000) // ninety seconds is several laps at the target lap time

  const progressed = [...match.cars.values()].filter((c) => c.lap >= 1)
  assert.ok(progressed.length > 0, 'at least one bot must complete a lap in ninety seconds')

  for (const car of match.cars.values()) {
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y), 'a bot must never go non finite')
  }
})

test('a race resolves to exactly one winner and sets final', () => {
  const match = make({ circuitIndex: 0 })
  for (let i = 0; i < 4; i++) join(match, { name: BOT_NAMES[i], bot: true }, () => 0.5)
  startRace(match)

  run(match, 600000) // ten minutes is far past any plausible race

  assert.equal(match.phase, 'over', 'a race must conclude')
  assert.ok(match.winner, 'a concluded race must name a winner')
  assert.equal(match.final, true)
  assert.equal(
    [...match.cars.values()].filter((c) => c.alive).length,
    4,
    'all four cars finish without elimination',
  )
})

test('the snapshot carries what the page draws and nothing it must not trust', () => {
  const match = racing(3)
  const snap = snapshot(match)

  assert.equal(snap.t, 'state')
  assert.equal(snap.phase, match.phase)
  assert.equal(snap.laps, match.laps)
  assert.ok(Array.isArray(snap.cars))
  assert.ok(Array.isArray(snap.hazards))
  assert.ok(Array.isArray(snap.pickups))
  assert.ok(Array.isArray(snap.order))
  assert.equal(snap.cars.length, 3)

  for (const car of snap.cars) {
    for (const key of ['id', 'name', 'slot', 'x', 'y', 'heading', 'lap', 'alive']) {
      assert.ok(key in car, `a snapshot car is missing ${key}`)
    }
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y) && Number.isFinite(car.heading))
  }

  // The grid never rides in a snapshot: it is static and ships once in welcome.
  assert.equal(snap.grid, undefined, 'the track must never be in a snapshot')
  assert.equal(snap.map, undefined, 'the track must never be in a snapshot')
  assert.equal(snap.centerline, undefined, 'the racing line is not the client\'s business')
})

test('collecting a powerup despawns it from snapshot until cooldown expires', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  assert.ok(match.pickups.length > 0, 'match should have pickups')

  // Find the first pickup
  const targetPickup = match.pickups[0]
  const initialSnap = snapshot(match)
  assert.ok(
    initialSnap.pickups.some((p) => p.x === targetPickup.x && p.y === targetPickup.y),
    'initial snapshot must include active pickup',
  )

  // Drive car directly over the pickup
  car.x = targetPickup.x
  car.y = targetPickup.y
  car.item = null

  const collected = collectPickup(match, car, () => 0)
  assert.ok(collected, 'car should collect pickup')
  assert.ok(car.item, 'car should receive an item')

  // Despawn check: pickup must immediately vanish from snapshot
  const postPickupSnap = snapshot(match)
  assert.ok(
    !postPickupSnap.pickups.some((p) => p.x === targetPickup.x && p.y === targetPickup.y),
    'collected pickup must despawn from snapshot while on cooldown',
  )

  // Advance time past cooldown
  match.now += PICKUP_RESPAWN_MS + 10

  // Respawn check: pickup must reappear in snapshot
  const respawnSnap = snapshot(match)
  assert.ok(
    respawnSnap.pickups.some((p) => p.x === targetPickup.x && p.y === targetPickup.y),
    'pickup must respawn and reappear in snapshot after cooldown expires',
  )
})

test('a snapshot is small enough to send at 60 Hz', () => {
  const match = racing(MAX_PLAYERS)
  for (let i = 0; i < MAX_HAZARDS; i++) {
    match.hazards.push({ kind: 'slick', x: 40, y: 40, until: 9e9, by: 'p-1' })
  }
  const bytes = JSON.stringify(snapshot(match)).length
  assert.ok(bytes < 4096, `a full snapshot is ${bytes} bytes, over maxPayload`)
})

test('tick survives a hostile dt without moving anybody to NaN', () => {
  const match = racing(3)
  for (const dt of [0, -5, NaN, Infinity, 'fast', null, undefined]) {
    tick(match, dt, () => 0.5)
    for (const car of match.cars.values()) {
      assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y), `dt ${dt} broke a position`)
    }
    // These two are tick's own guard, not stepCar's: stepCar never touches
    // match.now or match.elapsed, so only tick's own clamp of dtMs can be
    // keeping them numeric here. A car's position surviving is not proof of
    // that on its own, stepCar has an independent dt guard of its own.
    assert.ok(Number.isFinite(match.now), `dt ${JSON.stringify(dt)} broke match.now`)
    assert.ok(Number.isFinite(match.elapsed), `dt ${JSON.stringify(dt)} broke match.elapsed`)
  }
})

// Debt carried from Task 3 (Ruling 9 in the plan ledger): laps are a static
// MIN_LAPS in make(), but startRace() is what actually scales the field into
// a lap count. Task 3's version of this test asserted Math.max against
// itself rather than against production code, so it was removed there and
// owed to this task instead. This asserts startRace()'s real output, not a
// value the test computed on its own.
test('startRace sets a fixed race length, whatever the field size', () => {
  // Laps used to scale with the roster, so the same circuit ran three laps for
  // two drivers and eight for eight. Race length is a property of the race, not
  // of who happened to be in the lobby when it started.
  const small = make({ circuitIndex: 0 })
  join(small, { name: 'A' }, () => 0)
  startRace(small)
  assert.equal(small.laps, RACE_LAPS, 'a lone driver races the full distance')

  const full = make({ circuitIndex: 0 })
  for (let i = 0; i < MAX_PLAYERS; i++) join(full, { name: `D${i}` }, () => 0)
  startRace(full)
  assert.equal(full.laps, RACE_LAPS, 'a full grid races exactly the same distance')

  assert.ok(RACE_LAPS >= MIN_LAPS, 'a race is never shorter than MIN_LAPS')
})

// Circuit 0 alone is not proof the aim-anchor fix generalises: the
// checkpoint-anchor defect this task fixed affected 4 of the 8 circuits, and
// every other test in this file that drives driveBots and tick end to end is
// pinned to circuitIndex 0. This walks every circuit in CIRCUITS, so a ninth
// circuit is covered the day it is added, and a regression in the aim
// anchor, BOT_LOOKAHEAD, or the corner bound cannot hide behind circuit 0
// alone.
test('every circuit resolves to exactly one winner with bots only', () => {
  const BUDGET_MS = 300000 // five simulated minutes: generous, still bounded

  for (let ci = 0; ci < CIRCUITS.length; ci++) {
    const match = make({ circuitIndex: ci })
    for (let i = 0; i < 4; i++) join(match, { name: BOT_NAMES[i], bot: true }, () => 0.5)
    startRace(match)

    // A bit-for-bit wedge check rides along for free. The resolution
    // assertion below already fails a race that hangs because its leader is
    // wedged, but a wedge on a car that is not the leader could still let
    // the race resolve around it, so this catches that case too.
    // REPEAT_LIMIT is generous enough that a car briefly motionless off the
    // start line, or waiting between bot decisions, is never mistaken for
    // stuck: BOT_REACT_MS is 100ms, so a genuinely driving car cannot hold
    // identical state for a full simulated second.
    const REPEAT_LIMIT = 60
    const lastState = new Map()
    const repeats = new Map()
    let wedgedCar = null

    let ms = 0
    for (; ms < BUDGET_MS && match.phase === 'racing'; ms += TICK_MS) {
      tick(match, TICK_MS, () => 0.5)

      for (const car of match.cars.values()) {
        if (!car.alive) continue
        const key = `${car.x}|${car.y}|${car.heading}|${car.vx}|${car.vy}`
        if (key === lastState.get(car.id)) {
          const count = (repeats.get(car.id) ?? 0) + 1
          repeats.set(car.id, count)
          if (count >= REPEAT_LIMIT && !wedgedCar) wedgedCar = car.id
        } else {
          repeats.set(car.id, 0)
        }
        lastState.set(car.id, key)
      }
    }

    assert.equal(
      wedgedCar,
      null,
      `${CIRCUITS[ci].name}: car ${wedgedCar} held identical position, velocity and heading for over a simulated second while racing`,
    )

    const alive = [...match.cars.values()].filter((c) => c.alive).length
    assert.equal(match.phase, 'over', `${CIRCUITS[ci].name} did not resolve`)
    assert.equal(alive, 4, `${CIRCUITS[ci].name} ended with ${alive} car(s) alive, not 4`)
  }
})

test('the snapshot names its bodies `cars`, the key the page hands the buffer', () => {
  // src/pages/Cutline.jsx calls makeBuffer(DELAY_MS, 'cars'). The buffer cannot
  // tell a snapshot with no bodies from one whose bodies sit under a different
  // name: both come back as an empty array with no error. Cutline shipped
  // exactly that way once, rendering an empty track while the suite stayed
  // green. Rename this field and that page goes blind again, so the name is
  // part of the contract rather than an implementation detail.
  const match = racing(3)
  const snap = snapshot(match)

  assert.ok(Array.isArray(snap.cars), 'bodies must be under `cars`')
  assert.equal(snap.cars.length, 3)
  assert.equal(snap.players, undefined, 'nothing should answer to `players` here')
})

test('the snapshot carries the held steer and brake the page draws with', () => {
  // The page turns the front wheels by `steer` and lights the brake lamps by
  // `brake`. An absent field reads as a falsy one, so leaving these off the
  // wire drew straight wheels and dark lamps forever without erroring.
  const match = racing(2)
  const [car] = [...match.cars.values()]

  applyInput(match, car.id, { steer: -1, brake: 1, throttle: 1 })
  const left = snapshot(match).cars.find((c) => c.id === car.id)
  assert.equal(left.steer, -1, 'steer must reach the page')
  assert.equal(left.brake, true, 'brake must reach the page')

  applyInput(match, car.id, { steer: 1, brake: 0, throttle: 1 })
  const right = snapshot(match).cars.find((c) => c.id === car.id)
  assert.equal(right.steer, 1, 'steer must track the held input, not a constant')
  assert.equal(right.brake, false)
})

test('a banana spins the car that touches it and is consumed doing so', () => {
  const match = racing(2)
  const [victim] = [...match.cars.values()]
  const cp = match.checkpoints[3]
  victim.x = cp.x
  victim.y = cp.y
  victim.heading = 0
  victim.vx = 8
  victim.vy = 0

  match.hazards.push({ kind: 'banana', x: victim.x, y: victim.y, until: match.now + BANANA_TTL_MS, by: 'p-9' })

  const headingBefore = victim.heading
  applyHazards(match, victim)
  assert.ok(victim.spinUntil > match.now, 'contact must start a spin')

  // The spin must actually turn the car, and must ignore the driver's input:
  // holding full opposite lock changes nothing while it lasts.
  victim.steer = -1
  for (let i = 0; i < 10; i++) stepCar(match, victim, TICK_MS / 1000)
  assert.ok(
    victim.heading > headingBefore,
    `a spin must rotate the car, heading went ${headingBefore} to ${victim.heading}`,
  )

  // One use: the peel is spent and swept, so the car behind drives through clean.
  expireHazards(match)
  assert.equal(match.hazards.length, 0, 'a banana must be consumed by the car that hits it')
})

test('a spin ends, and the car drives again afterwards', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  car.spinUntil = match.now + SPIN_MS

  match.now += SPIN_MS + 1
  const before = car.heading
  car.steer = 0
  stepCar(match, car, TICK_MS / 1000)
  assert.equal(car.heading, before, 'once the spin lapses the car stops rotating on its own')
})

test('the bag carries bananas, and every entry is a real item', () => {
  assert.ok(ITEM_BAG.includes('banana'), 'banana must be drawable')
  for (const item of ITEM_BAG) {
    assert.ok(['boost', 'slick', 'banana'].includes(item), `unknown item ${item} in the bag`)
  }
})

test('every checkpoint is reachable from the full width of the road', () => {
  // CHECKPOINT_RADIUS and SEGMENT_WIDTH_MAX are linked. While the
  // radius was a hardcoded 4.0 and the road was widened to 11, a car running 4
  // tiles off centre, entirely legally, missed 10 of 11 checkpoints and its lap
  // never counted. Derived from the road, this cannot drift apart again.
  const half = SEGMENT_WIDTH_MAX / 2
  assert.ok(
    CHECKPOINT_RADIUS >= half,
    `a checkpoint must reach the edge of the road: radius ${CHECKPOINT_RADIUS} against half-width ${half}`,
  )

  const match = racing(1)
  const [car] = [...match.cars.values()]
  const line = match.centerline

  // Drive the ring at the outermost legal line and require every checkpoint.
  for (const off of [0, half / 2, half]) {
    car.lap = 0
    car.nextCp = 1
    car.cpTaken = 0
    for (let c = 1; c < match.checkpoints.length; c++) {
      const cp = match.checkpoints[c]
      const i = cp.index
      const a = line[(i - 1 + line.length) % line.length]
      const b = line[(i + 1) % line.length]
      const tx = b.x - a.x
      const ty = b.y - a.y
      const len = Math.hypot(tx, ty) || 1
      car.x = cp.x - (ty / len) * off
      car.y = cp.y + (tx / len) * off
      updateProgress(match, car)
    }
    assert.equal(
      car.cpTaken,
      match.checkpoints.length - 1,
      `a car racing ${off} tiles off centre must take every checkpoint`,
    )
  }
})

test('the finish line counts a crossing anywhere across the road, not a circle', () => {
  // A circle cannot be accurate along the track and wide enough across it at the
  // same time. This is a real crossing test, so it must bank a lap for a car
  // passing the line on the outside line, and must not bank one for a car merely
  // sitting near it.
  const half = SEGMENT_WIDTH_MAX / 2
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const p = match.checkpoints[0]
  const line = match.centerline
  const a = line[(p.index - 1 + line.length) % line.length]
  const b = line[(p.index + 1) % line.length]
  const tx = b.x - a.x
  const ty = b.y - a.y
  const len = Math.hypot(tx, ty) || 1
  const t = { x: tx / len, y: ty / len }

  const place = (along, across) => {
    car.x = p.x + t.x * along - t.y * across
    car.y = p.y + t.y * along + t.x * across
  }

  // All checkpoints taken, approaching the line wide.
  car.lap = 0
  car.nextCp = 0
  car.cpTaken = match.checkpoints.length - 1
  car.lineSide = undefined

  place(-1.5, half)          // behind the line, on the outside edge
  updateProgress(match, car)
  assert.equal(car.lap, 0, 'approaching must not bank a lap')

  place(0.5, half)           // now past it, still on the outside edge
  updateProgress(match, car)
  assert.equal(car.lap, 1, 'crossing wide must bank the lap')

  // Sitting still just past the line must not keep banking laps.
  const after = car.lap
  updateProgress(match, car)
  assert.equal(car.lap, after, 'a stationary car must not bank a second lap')
})

import {
  CAR_LENGTH,
  CAR_WIDTH,
  CAR_RADIUS,
  carCorners,
  resolveContact,
} from './cutline.js'

test('a car nose-first into a wall registers contact before its centre is inside', () => {
  // Walls were tested at the car's rounded centre alone. The body is
  // CAR_LENGTH long, so the nose reached most of a tile into a wall with
  // nothing registering, which is why contact felt unassuming.
  const match = racing(1)
  const [car] = [...match.cars.values()]

  // Find an on-track tile with a wall directly beside it, derived from real
  // circuit data rather than a guessed coordinate.
  const line = match.centerline
  let onX = null
  let onY = null
  let dirX = 0
  let dirY = 0
  for (let i = 0; i < line.length && onX === null; i++) {
    const p = line[i]
    const a = line[(i - 1 + line.length) % line.length]
    const b = line[(i + 1) % line.length]
    const tx = b.x - a.x
    const ty = b.y - a.y
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len
    const ny = tx / len
    for (let step = 1; step < GRID; step++) {
      const cx = Math.round(p.x + nx * step)
      const cy = Math.round(p.y + ny * step)
      if (surfaceAt(match.grid, cx, cy) === S_WALL) {
        onX = Math.round(p.x + nx * (step - 1))
        onY = Math.round(p.y + ny * (step - 1))
        dirX = nx
        dirY = ny
        break
      }
    }
  }
  assert.ok(onX !== null, 'the circuit must have a wall beside the road')

  // Place the car so its CENTRE is still on track and its NOSE drives into the wall.
  car.heading = Math.atan2(dirY, dirX)
  car.x = onX - dirX * 0.5
  car.y = onY - dirY * 0.5
  car.vx = Math.cos(car.heading) * 6
  car.vy = Math.sin(car.heading) * 6
  const speedBefore = Math.hypot(car.vx, car.vy)

  for (let i = 0; i < 6; i++) stepCar(match, car, TICK_MS / 1000)

  // The nose must have been stopped. Without corner testing the centre walks
  // in before anything happens and the car keeps its speed.
  const noseX = car.x + Math.cos(car.heading) * (CAR_LENGTH / 2)
  const noseY = car.y + Math.sin(car.heading) * (CAR_LENGTH / 2)
  assert.notEqual(
    surfaceAt(match.grid, Math.round(noseX), Math.round(noseY)),
    S_WALL,
    'the nose must never come to rest inside a wall',
  )
  assert.ok(Math.hypot(car.vx, car.vy) < speedBefore, 'contact must scrub speed')
})

test('two cars overlapping nose to tail register contact', () => {
  // One circle of radius 0.45 covered 62% of a body 1.45 long, so cars visibly
  // overlapped end to end without ever touching.
  const match = racing(2)
  const [a, b] = [...match.cars.values()]
  const cp = match.checkpoints[3]

  a.heading = 0
  b.heading = 0
  a.x = cp.x
  a.y = cp.y
  // Nose to tail, closer than the body length but further than one old circle.
  b.x = cp.x + CAR_LENGTH * 0.7
  b.y = cp.y

  const gapBefore = Math.hypot(b.x - a.x, b.y - a.y)
  resolveContact(match)
  const gapAfter = Math.hypot(b.x - a.x, b.y - a.y)

  assert.ok(gapAfter > gapBefore, `overlapping cars must be pushed apart, ${gapBefore} to ${gapAfter}`)
})

test('the collision shape is derived from the drawn car, not written twice', () => {
  assert.equal(CAR_RADIUS, CAR_WIDTH / 2, 'CAR_RADIUS must derive from CAR_WIDTH')
  assert.ok(CAR_LENGTH > CAR_WIDTH, 'a car is longer than it is wide')
  assert.equal(carCorners({ x: 0, y: 0, heading: 0 }).length, 4)
})

import {
  S_GRAVEL,
  S_RAMP,
  SURFACE_CHARS,
} from './cutline.js'

test('every surface has a char, a grip entry, and a distinct value', () => {
  // Adding a surface touches SURFACE_CHARS, the GRIP table and the page's
  // prerender. Miss one and the wire carries undefined and the page draws
  // nothing, with no error anywhere. This covers the two the module owns.
  const surfaces = [S_WALL, S_TARMAC, S_KERB, S_BOOST, S_OIL, S_PICKUP, S_LINE, S_GRAVEL, S_RAMP]

  assert.equal(new Set(surfaces).size, surfaces.length, 'surface values must be distinct')
  assert.equal(SURFACE_CHARS.length, surfaces.length, 'every surface needs a char')
  assert.equal(new Set(SURFACE_CHARS).size, SURFACE_CHARS.length, 'chars must be distinct')

  // Wall is the only surface with no grip entry, because a car is never on it.
  for (const s of surfaces) {
    if (s === S_WALL) continue
    assert.ok(Number.isFinite(GRIP[s]), `surface ${s} has no grip entry`)
  }

  // Gravel must be grippier than oil and looser than kerb, or it is not run off.
  assert.ok(GRIP[S_GRAVEL] < GRIP[S_KERB], 'gravel must be looser than kerb')
  assert.ok(GRIP[S_GRAVEL] > GRIP[S_OIL], 'gravel must bite more than oil')
})

test('an encoded map round trips with the new surfaces', () => {
  const grid = new Uint8Array(GRID * GRID)
  grid[0] = S_GRAVEL
  grid[1] = S_RAMP
  grid[2] = S_TARMAC
  const round = decodeMap(encodeMap(grid))
  assert.equal(round[0], S_GRAVEL)
  assert.equal(round[1], S_RAMP)
  assert.equal(round[2], S_TARMAC)
})

test('gravel scrubs speed without counting as off track', () => {
  // offTrack stays reserved for S_WALL. Gravel costs time; it does not apply
  // the off-track cap, or running wide would be the same as hitting a wall.
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const cp = match.checkpoints[3]
  const tx = Math.round(cp.x)
  const ty = Math.round(cp.y)

  const run = (surface) => {
    match.grid[ty * GRID + tx] = surface
    car.x = tx
    car.y = ty
    car.heading = 0
    car.vx = 10
    car.vy = 0
    car.throttle = false
    car.steer = 0
    for (let i = 0; i < 10; i++) stepCar(match, car, TICK_MS / 1000)
    return Math.hypot(car.vx, car.vy)
  }

  const onTarmac = run(S_TARMAC)
  const onGravel = run(S_GRAVEL)

  assert.ok(onGravel < onTarmac, `gravel must scrub speed: tarmac ${onTarmac}, gravel ${onGravel}`)
  assert.ok(onGravel > 0, 'gravel must not stop the car dead')
})

import {
  LATTICE_N,
  LATTICE_CELL,
  LATTICE_ORIGIN,
  MIN_WALL,
  SEGMENT_WIDTH_MIN,
  MIN_CYCLE_EDGES,
  MIN_DIRECTION_CHANGES,
  MIN_SIGN_CHANGES,
  MIN_STRAIGHT_EDGES,
  CYCLE_ATTEMPTS,
  FALLBACK_CYCLE,
  findCycle,
} from './cutline.js'

test('a found cycle is closed, never revisits a vertex, and turns both ways', () => {
  // These are the three guarantees the harmonic centreline gave for free. A
  // cycle that fails any of them produces a circuit that softlocks a race, so
  // they are asserted for many seeds rather than one.
  for (let seed = 1; seed <= 40; seed++) {
    const cycle = findCycle(createRng(seed))

    assert.ok(cycle.length >= MIN_CYCLE_EDGES, `seed ${seed}: cycle too short, ${cycle.length}`)

    // Closed: consecutive vertices are lattice neighbours, including the wrap.
    for (let i = 0; i < cycle.length; i++) {
      const a = cycle[i]
      const b = cycle[(i + 1) % cycle.length]
      const step = Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy)
      assert.equal(step, 1, `seed ${seed}: vertices ${i} and ${i + 1} are not neighbours`)
    }

    // No vertex twice: this is what makes self-intersection impossible.
    const keys = new Set(cycle.map((v) => `${v.gx},${v.gy}`))
    assert.equal(keys.size, cycle.length, `seed ${seed}: a vertex is used twice`)

    // Inside the lattice.
    for (const v of cycle) {
      assert.ok(v.gx >= 0 && v.gx < LATTICE_N && v.gy >= 0 && v.gy < LATTICE_N, `seed ${seed}: off lattice`)
    }
  }
})

test('a found cycle is never an oval: it turns both ways and has a straight', () => {
  // The whole point. The harmonic curve bent around the grid centre, so every
  // corner turned the same way and every lap read identically. A cycle that
  // only ever turns one way has reproduced that defect in a new shape.
  for (let seed = 1; seed <= 40; seed++) {
    const cycle = findCycle(createRng(seed))
    const dirs = []
    for (let i = 0; i < cycle.length; i++) {
      const a = cycle[i]
      const b = cycle[(i + 1) % cycle.length]
      dirs.push({ x: b.gx - a.gx, y: b.gy - a.gy })
    }

    let turns = 0
    let signChanges = 0
    let lastSign = 0
    let longestStraight = 1
    let run = 1
    for (let i = 0; i < dirs.length; i++) {
      const a = dirs[i]
      const b = dirs[(i + 1) % dirs.length]
      const cross = a.x * b.y - a.y * b.x
      if (cross === 0) {
        run++
        longestStraight = Math.max(longestStraight, run)
      } else {
        turns++
        run = 1
        const sign = Math.sign(cross)
        if (lastSign !== 0 && sign !== lastSign) signChanges++
        lastSign = sign
      }
    }

    assert.ok(turns >= MIN_DIRECTION_CHANGES, `seed ${seed}: only ${turns} turns`)
    assert.ok(signChanges >= MIN_SIGN_CHANGES, `seed ${seed}: only ${signChanges} counter turns, this is an oval`)
    assert.ok(
      longestStraight >= MIN_STRAIGHT_EDGES,
      `seed ${seed}: longest straight is ${longestStraight} edges`,
    )
  }
})

test('the same seed finds the same cycle', () => {
  assert.deepEqual(findCycle(createRng(7)), findCycle(createRng(7)))
  assert.notDeepEqual(findCycle(createRng(7)), findCycle(createRng(8)))
})

test('the fallback cycle satisfies every rule the search does', () => {
  // The fallback exists so generation can never fail to return a circuit. If it
  // does not itself pass the acceptance rules, a hard seed produces a circuit
  // worse than the ones the search rejected.
  assert.ok(FALLBACK_CYCLE.length >= MIN_CYCLE_EDGES)
  const keys = new Set(FALLBACK_CYCLE.map((v) => `${v.gx},${v.gy}`))
  assert.equal(keys.size, FALLBACK_CYCLE.length, 'the fallback must not revisit a vertex')
  for (let i = 0; i < FALLBACK_CYCLE.length; i++) {
    const a = FALLBACK_CYCLE[i]
    const b = FALLBACK_CYCLE[(i + 1) % FALLBACK_CYCLE.length]
    assert.equal(Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy), 1, 'the fallback must be closed')
  }
})

test('the lattice cell is wide enough to keep parallel corridors apart', () => {
  // Two stretches of road running side by side must not merge into one, or the
  // carve produces a shortcut nobody designed and the checkpoint ring rejects
  // the lap. Derived, so it cannot drift when the road widens.
  assert.ok(
    LATTICE_CELL >= SEGMENT_WIDTH_MAX + MIN_WALL,
    `cell ${LATTICE_CELL} leaves no wall between corridors ${SEGMENT_WIDTH_MAX} wide`,
  )
  // And the widest circuit must fit the grid.
  const far = LATTICE_ORIGIN + (LATTICE_N - 1) * LATTICE_CELL + SEGMENT_WIDTH_MAX / 2
  assert.ok(far < GRID, `a circuit reaches ${far}, past the grid at ${GRID}`)
  assert.ok(LATTICE_ORIGIN - SEGMENT_WIDTH_MAX / 2 > 0, 'a circuit runs off the near edge')
})

import {
  CORNERS,
  TURN_FALLOFF,
} from './cutline.js'

test('the corner vocabulary maps radius to a required speed', () => {
  // Corner speeds are derived from the handling model, not chosen. At speed v a
  // car turns TURN_RATE * (1 - TURN_FALLOFF * v / TOP_SPEED) / v rad per tile,
  // so v = TURN_RATE / (k + TURN_RATE * TURN_FALLOFF / TOP_SPEED).
  const speedFor = (k) => TURN_RATE / (k + (TURN_RATE * TURN_FALLOFF) / TOP_SPEED)

  for (const c of CORNERS) {
    const v = speedFor(c.rad)
    assert.ok(v > 0 && v <= TOP_SPEED, `${c.name} needs an impossible speed ${v}`)
    assert.ok(
      Math.abs(v - c.speed) < 0.2,
      `${c.name} claims speed ${c.speed} but the model says ${v.toFixed(2)}`,
    )
  }

  // The vocabulary must span from flat out to needing a real brake, or corners
  // do not vary and the whole exercise is pointless.
  const fastest = Math.max(...CORNERS.map((c) => c.speed))
  const slowest = Math.min(...CORNERS.map((c) => c.speed))
  assert.ok(fastest > TOP_SPEED * 0.8, 'at least one corner must be near flat out')
  assert.ok(slowest < TOP_SPEED * 0.4, 'at least one corner must demand hard braking')
  assert.equal(MAX_CORNER_RAD, Math.max(...CORNERS.map((c) => c.rad)), 'MAX_CORNER_RAD is the tightest corner')
})

test('a built centreline is closed, evenly spaced and carries meta per point', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { centerline, meta } = buildCenterline(seed)

    assert.ok(centerline.length > 80, `seed ${seed}: centreline implausibly short`)
    assert.equal(meta.length, centerline.length, `seed ${seed}: meta must be parallel to the line`)

    const gaps = []
    for (let i = 0; i < centerline.length; i++) {
      const a = centerline[i]
      const b = centerline[(i + 1) % centerline.length]
      gaps.push(Math.hypot(b.x - a.x, b.y - a.y))
    }
    const maxGap = Math.max(...gaps)
    const minGap = Math.min(...gaps)
    assert.ok(maxGap - minGap < 0.01, `seed ${seed}: spacing is uneven, ${minGap} to ${maxGap}`)

    for (const m of meta) {
      assert.ok(m.width >= SEGMENT_WIDTH_MIN && m.width <= SEGMENT_WIDTH_MAX, `width ${m.width} out of range`)
      assert.ok([-1, 0, 1].includes(m.sign), `sign ${m.sign} is not a direction`)
    }
  }
})

test('a circuit contains corners in both directions and at more than one radius', () => {
  // The defect being fixed, asserted directly. A circuit whose corners all turn
  // the same way is the harmonic curve in a new costume.
  for (let seed = 1; seed <= 12; seed++) {
    const { meta } = buildCenterline(seed)
    const left = meta.filter((m) => m.sign === -1).length
    const right = meta.filter((m) => m.sign === 1).length
    assert.ok(left > 0, `seed ${seed}: no left-hand corners`)
    assert.ok(right > 0, `seed ${seed}: no right-hand corners`)

    const kinds = new Set(meta.map((m) => m.corner).filter(Boolean))
    assert.ok(kinds.size >= 2, `seed ${seed}: only one kind of corner, ${[...kinds]}`)

    const straight = meta.filter((m) => m.corner === null).length
    assert.ok(straight > meta.length * 0.2, `seed ${seed}: barely any straight`)
  }
})

test('no corner is sharper than the tightest the vocabulary allows', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { centerline } = buildCenterline(seed)
    for (let i = 0; i < centerline.length; i++) {
      const a = centerline[i]
      const b = centerline[(i + 1) % centerline.length]
      const c = centerline[(i + 2) % centerline.length]
      const h1 = Math.atan2(b.y - a.y, b.x - a.x)
      const h2 = Math.atan2(c.y - b.y, c.x - b.x)
      let turn = Math.abs(h2 - h1)
      if (turn > Math.PI) turn = Math.PI * 2 - turn
      assert.ok(
        turn <= MAX_CORNER_RAD + 0.05,
        `seed ${seed}: corner of ${turn.toFixed(3)} exceeds ${MAX_CORNER_RAD}`,
      )
    }
  }
})

import {
  WIDTH_RAMP_PER_POINT,
} from './cutline.js'

test('width varies along a lap and never steps', () => {
  // A one tile ledge mid corner catches a wheel and reads as a collision bug
  // rather than as geometry, so width ramps rather than jumps.
  for (let seed = 1; seed <= 12; seed++) {
    const { meta } = buildCenterline(seed)
    const widths = meta.map((m) => m.width)

    assert.ok(Math.max(...widths) > Math.min(...widths), `seed ${seed}: width never varies`)
    assert.ok(Math.min(...widths) >= SEGMENT_WIDTH_MIN, `seed ${seed}: too narrow`)
    assert.ok(Math.max(...widths) <= SEGMENT_WIDTH_MAX, `seed ${seed}: too wide`)

    for (let i = 0; i < widths.length; i++) {
      const a = widths[i]
      const b = widths[(i + 1) % widths.length]
      assert.ok(
        Math.abs(a - b) <= WIDTH_RAMP_PER_POINT + 1e-9,
        `seed ${seed}: width steps from ${a} to ${b} at point ${i}`,
      )
    }
  }
})

test('straights are wider than the corners they lead into', () => {
  // The point of varying width: room to out brake somebody into a corner.
  for (let seed = 1; seed <= 12; seed++) {
    const { meta } = buildCenterline(seed)
    const straightW = meta.filter((m) => m.corner === null).map((m) => m.width)
    const cornerW = meta.filter((m) => m.corner !== null).map((m) => m.width)
    if (straightW.length === 0 || cornerW.length === 0) continue
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    assert.ok(
      avg(straightW) > avg(cornerW),
      `seed ${seed}: straights average ${avg(straightW)}, corners ${avg(cornerW)}`,
    )
  }
})

test('at least some circuits contain a chicane, and a chicane counter turns', () => {
  // A chicane is one feature, not three unrelated corners: tight one way then
  // tight the other, so it cannot be taken on a single line.
  let found = 0
  for (let seed = 1; seed <= 24; seed++) {
    const { meta } = buildCenterline(seed)
    const idx = meta.map((m, i) => (m.corner === 'chicane' ? i : -1)).filter((i) => i >= 0)
    if (idx.length === 0) continue
    found++
    const signs = new Set(idx.map((i) => meta[i].sign).filter((s) => s !== 0))
    assert.ok(signs.size >= 2, `seed ${seed}: a chicane must turn both ways, saw ${[...signs]}`)
  }
  assert.ok(found > 0, 'no circuit in 24 seeds contained a chicane')
})

import {
  RAMP_MIN_SPEED,
  AIR_MS,
  AIR_STEER,
} from './cutline.js'

test('a ramp launches a car that is fast enough, and ignores one that is not', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const cp = match.checkpoints[3]
  const tx = Math.round(cp.x)
  const ty = Math.round(cp.y)
  match.grid[ty * GRID + tx] = S_RAMP

  car.x = tx
  car.y = ty
  car.heading = 0
  car.vx = RAMP_MIN_SPEED - 2
  car.vy = 0
  applyHazards(match, car)
  assert.ok(!(match.now < (car.airUntil ?? 0)), 'a slow car must not be launched')

  car.vx = RAMP_MIN_SPEED + 2
  applyHazards(match, car)
  assert.ok(match.now < car.airUntil, 'a fast car must be launched')
})

test('an airborne car ignores hazards and walls, then lands', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const cp = match.checkpoints[3]
  const tx = Math.round(cp.x)
  const ty = Math.round(cp.y)

  // Ensure known tarmac tile at checkpoint
  match.grid[ty * GRID + tx] = S_TARMAC
  car.x = tx
  car.y = ty
  car.heading = 0
  car.vx = RAMP_MIN_SPEED + 2
  car.vy = 0
  car.airUntil = match.now + AIR_MS

  // A slick directly under an airborne car must do nothing.
  match.hazards.push({ kind: 'slick', x: car.x, y: car.y, until: match.now + SLICK_TTL_MS, by: 'x' })
  applyHazards(match, car)
  assert.equal(car.onSlick, false, 'an airborne car must not be affected by a slick')

  // A banana under an airborne car must neither spin it nor be consumed.
  match.hazards.push({ kind: 'banana', x: car.x, y: car.y, until: match.now + BANANA_TTL_MS, by: 'x' })
  applyHazards(match, car)
  assert.ok(!(match.now < (car.spinUntil ?? 0)), 'an airborne car must not be spun')
  assert.ok(!match.hazards.some((h) => h.spent), 'a banana must not be consumed from the air')

  // Wall bypass: a wall directly in front of the airborne car is passed over.
  match.grid[ty * GRID + (tx + 1)] = S_WALL
  car.x = tx
  car.y = ty
  car.heading = 0
  car.vx = RAMP_MIN_SPEED
  car.vy = 0
  car.airUntil = match.now + AIR_MS
  stepCar(match, car, 0.05)
  assert.ok(car.vx > 0, 'airborne car must not bounce off wall')
  assert.ok(car.x > tx, 'airborne car must advance over the wall')

  // Grounded car facing a wall rebounds with -WALL_HIT_KEEP.
  car.x = tx
  car.y = ty
  car.heading = 0
  car.vx = RAMP_MIN_SPEED
  car.vy = 0
  car.airUntil = 0
  stepCar(match, car, 0.05)
  assert.ok(car.vx < 0, 'grounded car must rebound with negative velocity')

  // Airborne steering: angular turn rate is scaled down by AIR_STEER.
  match.grid[ty * GRID + (tx + 1)] = S_TARMAC
  car.x = tx
  car.y = ty
  car.heading = 0
  car.vx = RAMP_MIN_SPEED
  car.vy = 0
  car.steer = 1
  car.airUntil = match.now + AIR_MS
  stepCar(match, car, 0.05)
  const airTurn = car.heading

  car.x = tx
  car.y = ty
  car.heading = 0
  car.vx = RAMP_MIN_SPEED
  car.vy = 0
  car.steer = 1
  car.airUntil = 0
  stepCar(match, car, 0.05)
  const groundTurn = car.heading

  assert.ok(groundTurn > 0, 'grounded car must turn with positive steer')
  assert.ok(
    Math.abs(airTurn - groundTurn * AIR_STEER) < 1e-6,
    `airborne steering (${airTurn}) must scale ground turn (${groundTurn}) by AIR_STEER (${AIR_STEER})`,
  )

  // And it lands: hazards now affect the car again.
  car.x = tx
  car.y = ty
  car.airUntil = match.now + AIR_MS
  match.now += AIR_MS + 1
  applyHazards(match, car)
  assert.ok(!(match.now < car.airUntil), 'the car must come down')
  assert.equal(car.onSlick, true, 'a landed car is now affected by a slick')
})

test('the snapshot tells the page a car is airborne', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  car.airUntil = match.now + AIR_MS

  const snap = snapshot(match)
  const me = snap.cars.find((c) => c.id === car.id)
  assert.equal(me.airborne, true)
  assert.ok(me.airT >= 0 && me.airT <= 1, `airT ${me.airT} must be normalised for the arc`)

  match.now += AIR_MS + 1
  const after = snapshot(match).cars.find((c) => c.id === car.id)
  assert.equal(after.airborne, false)
})

test('a carved circuit is one connected region at every width', () => {
  for (const circuit of CIRCUITS) {
    const { grid } = carve(circuit.seed)
    let start = -1
    let total = 0
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== S_WALL) {
        if (start < 0) start = i
        total++
      }
    }
    assert.ok(start >= 0, `${circuit.name}: carved no surface`)

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
        if (seen[n] || grid[n] === S_WALL) continue
        seen[n] = 1
        stack.push(n)
      }
    }
    assert.equal(reached, total, `${circuit.name}: surface is in more than one piece`)
  }
})

test('the carved road is as wide as its meta says, within a tile', () => {
  // Width is the setting everything geometric derives from. If the carve and the
  // meta disagree, the checkpoint reach and the pickup spread are both wrong.
  const { grid, centerline, meta } = carve(CIRCUITS[0].seed)
  for (let i = 0; i < centerline.length; i += 7) {
    const p = centerline[i]
    const a = centerline[(i - 1 + centerline.length) % centerline.length]
    const b = centerline[(i + 1) % centerline.length]
    const tx = b.x - a.x
    const ty = b.y - a.y
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len
    const ny = tx / len

    let span = 0
    const half = meta[i].width / 2
    for (let off = -half; off <= half; off += 0.5) {
      const s = surfaceAt(grid, Math.round(p.x + nx * off), Math.round(p.y + ny * off))
      if (s !== S_WALL && s !== S_GRAVEL) span += 0.5
    }
    assert.ok(
      Math.abs(span - meta[i].width) <= 2,
      `point ${i}: carved span ${span} against meta width ${meta[i].width}`,
    )
  }
})

test('gravel sits outside fast corners, never in the racing surface', () => {
  const { grid, centerline, meta } = carve(CIRCUITS[0].seed)
  let gravel = 0
  for (const v of grid) if (v === S_GRAVEL) gravel++
  assert.ok(gravel > 0, 'a circuit must have run off somewhere')

  // No gravel on the centreline itself: run off is outside the road.
  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i]
    assert.notEqual(
      surfaceAt(grid, Math.round(p.x), Math.round(p.y)),
      S_GRAVEL,
      `point ${i}: gravel on the racing line`,
    )
  }
})

test('every checkpoint is reachable from the full width of its own segment', () => {
  // The lap counting bug, generalised. With per-segment width the reach must
  // clear the WIDEST segment, since one radius serves every checkpoint.
  assert.ok(CHECKPOINT_RADIUS >= SEGMENT_WIDTH_MAX / 2, 'reach must clear the widest road')

  for (const circuit of CIRCUITS) {
    const match = make({ circuitIndex: CIRCUITS.indexOf(circuit) })
    join(match, { name: 'W' }, () => 0)
    startRace(match)
    const [car] = [...match.cars.values()]
    const line = match.centerline

    car.lap = 0
    car.nextCp = 1
    car.cpTaken = 0
    for (let c = 1; c < match.checkpoints.length; c++) {
      const cp = match.checkpoints[c]
      const i = cp.index
      const a = line[(i - 1 + line.length) % line.length]
      const b = line[(i + 1) % line.length]
      const tx = b.x - a.x
      const ty = b.y - a.y
      const len = Math.hypot(tx, ty) || 1
      const off = match.meta[i].width / 2
      car.x = cp.x - (ty / len) * off
      car.y = cp.y + (tx / len) * off
      updateProgress(match, car)
    }
    assert.equal(
      car.cpTaken,
      match.checkpoints.length - 1,
      `${circuit.name}: a car on the outer edge missed a checkpoint`,
    )
  }
})

test('start slots sit on a straight and on the racing surface', () => {
  for (const circuit of CIRCUITS) {
    const { grid, meta, startSlots } = carve(circuit.seed)
    assert.ok(startSlots.length >= MAX_PLAYERS, `${circuit.name}: not enough slots`)
    for (const slot of startSlots.slice(0, MAX_PLAYERS)) {
      assert.notEqual(
        surfaceAt(grid, Math.round(slot.x), Math.round(slot.y)),
        S_WALL,
        `${circuit.name}: a slot is in a wall`,
      )
      assert.equal(meta[slot.index].corner, null, `${circuit.name}: the grid must sit on a straight`)
    }
  }
})

test('an encoded circuit still fits a welcome frame', () => {
  for (const circuit of CIRCUITS) {
    const encoded = encodeMap(carve(circuit.seed).grid)
    assert.ok(encoded.length < 4096, `${circuit.name}: encoded to ${encoded.length} bytes`)
  }
})

test('a shortcut branches from the trunk and rejoins it', () => {
  let found = 0
  for (const circuit of CIRCUITS) {
    const { grid, shortcuts, centerline } = carve(circuit.seed)
    if (!shortcuts || shortcuts.length === 0) continue
    found++
    for (const s of shortcuts) {
      assert.ok(s.fromIndex >= 0 && s.fromIndex < centerline.length, 'branch point on the line')
      assert.ok(s.toIndex >= 0 && s.toIndex < centerline.length, 'rejoin point on the line')
      assert.notEqual(s.fromIndex, s.toIndex, 'a shortcut must go somewhere')
      assert.ok(s.points.length > 1, 'a shortcut must have a path')
      for (const pt of s.points) {
        assert.notEqual(
          surfaceAt(grid, Math.round(pt.x), Math.round(pt.y)),
          S_WALL,
          'shortcut corridor must be carved surface, not wall',
        )
      }
    }
  }
  assert.ok(found > 0, 'no circuit had a shortcut')
})

test('no checkpoint ever sits on a shortcut or inside the stretch it skips', () => {
  // This is the rule that keeps the checkpoint ring ignorant of branches. Break
  // it and taking the shortcut silently stops the lap counting, which is the
  // lap bug from the other direction.
  for (const circuit of CIRCUITS) {
    const { shortcuts, checkpoints, centerline } = carve(circuit.seed)
    if (!shortcuts || shortcuts.length === 0) continue
    for (const s of shortcuts) {
      for (const cp of checkpoints) {
        const inSkipped = s.fromIndex < s.toIndex
          ? cp.index > s.fromIndex && cp.index < s.toIndex
          : cp.index > s.fromIndex || cp.index < s.toIndex
        assert.ok(
          !inSkipped,
          `${circuit.name}: checkpoint at ${cp.index} lies inside a stretch a shortcut skips`,
        )
      }
    }
  }
})

test('a lap completed via a shortcut still counts', () => {
  const idx = CIRCUITS.findIndex((c) => (carve(c.seed).shortcuts ?? []).length > 0)
  assert.ok(idx >= 0, 'at least one circuit must have a shortcut')
  const match = make({ circuitIndex: idx })
  join(match, { name: 'S' }, () => 0)
  startRace(match)
  const [car] = [...match.cars.values()]

  // Take every checkpoint, which is what a shortcut runner still does, then
  // cross the line.
  for (let c = 1; c < match.checkpoints.length; c++) {
    const cp = match.checkpoints[c]
    car.x = cp.x
    car.y = cp.y
    updateProgress(match, car)
  }
  crossLine(match, car)
  assert.equal(car.lap, 1, 'a lap taken via the shortcut must count')
})

test('a shortcut is narrower than the trunk it bypasses', () => {
  for (const circuit of CIRCUITS) {
    const { shortcuts, meta } = carve(circuit.seed)
    for (const s of shortcuts ?? []) {
      assert.ok(
        SHORTCUT_WIDTH < meta[s.fromIndex].width,
        `a shortcut must cost something: ${SHORTCUT_WIDTH} against ${meta[s.fromIndex].width}`,
      )
    }
  }
})

test('a circuit can be measured, and the shipped eight are genuinely different', () => {
  const measured = CIRCUITS.map((c) => measureCircuit(c.seed))

  for (const m of measured) {
    assert.ok(m.lapLength > 0, 'a lap must have length')
    assert.ok(m.longestStraight > 0, 'every circuit needs a straight')
    assert.ok(m.directionChanges >= MIN_SIGN_CHANGES, 'every circuit must counter turn')
  }

  // No two shipped circuits may be near-identical on every axis, or the
  // selection pass has silently degraded to eight rolls of the same dice.
  for (let i = 0; i < measured.length; i++) {
    for (let j = i + 1; j < measured.length; j++) {
      const a = measured[i]
      const b = measured[j]
      const same =
        Math.abs(a.lapLength - b.lapLength) < 5 &&
        Math.abs(a.longestStraight - b.longestStraight) < 3 &&
        Math.abs(a.directionChanges - b.directionChanges) < 2
      assert.ok(
        !same,
        `${CIRCUITS[i].name} and ${CIRCUITS[j].name} are the same circuit in two costumes`,
      )
    }
  }
})

test('a car with a corner already in a wall can still drive free', () => {
  // The collision test used to judge a move only by whether the DESTINATION
  // overlapped a wall. A car whose body already touched one therefore had every
  // move rejected, including the moves that would have freed it, and each
  // rejection reversed its velocity, so speed never built. Measured across all
  // circuits, 55% of cars brushing a wall were frozen for good. Steering into a
  // wall, a shove from another car and a landing from a ramp all put a corner
  // there without the translation test ever seeing it.
  let trials = 0
  let freed = 0
  for (let ci = 0; ci < CIRCUITS.length; ci++) {
    const match = make({ circuitIndex: ci })
    join(match, { name: 'X' }, () => 0)
    startRace(match)
    const [car] = [...match.cars.values()]
    const line = match.centerline
    const n = line.length
    const cornersIn = () =>
      carCorners(car).filter((q) => surfaceAt(match.grid, Math.round(q.x), Math.round(q.y)) === S_WALL).length

    for (let i = 0; i < n; i += 23) {
      const p = line[i]
      const a = line[(i - 1 + n) % n]
      const b = line[(i + 1) % n]
      const tx = b.x - a.x
      const ty = b.y - a.y
      const len = Math.hypot(tx, ty) || 1
      const heading = Math.atan2(ty, tx)
      for (const side of [-1, 1]) {
        // Slide sideways until the body first touches a wall, centre still on road.
        let placed = false
        for (let off = 0; off < SEGMENT_WIDTH_MAX; off += 0.05) {
          car.x = p.x + (-ty / len) * off * side
          car.y = p.y + (tx / len) * off * side
          car.heading = heading
          if (surfaceAt(match.grid, Math.round(car.x), Math.round(car.y)) === S_WALL) break
          if (cornersIn() > 0) {
            placed = true
            break
          }
        }
        if (!placed) continue
        trials++

        Object.assign(car, { vx: 0, vy: 0, throttle: true, brake: false, steer: -side })
        car.airUntil = 0
        car.spinUntil = 0
        // Measure the path driven, not the net displacement. Steering is held at
        // full lock for the whole run, so a car that is perfectly free drives a
        // circle and can finish close to where it started. A stuck car does not
        // travel at all: the defect left cars at speed 0.057 covering 0.000 tiles.
        let path = 0
        let px = car.x
        let py = car.y
        for (let t = 0; t < 3000; t += TICK_MS) {
          match.now += TICK_MS
          applyHazards(match, car)
          stepCar(match, car, TICK_MS / 1000)
          path += Math.hypot(car.x - px, car.y - py)
          px = car.x
          py = car.y
        }
        if (path > 5) freed++
      }
    }
  }
  assert.ok(trials > 20, `the test must find wall contacts to try, found ${trials}`)
  assert.equal(freed, trials, `${trials - freed} of ${trials} cars touching a wall were still stuck after 3 seconds`)
})

// --- Ramps are listed for the page ------------------------------------------
// The grid says where a ramp is but not which way it faces, and a 3D wedge needs
// both. carve lists them; the page draws from that list and nothing else.
import { CIRCUITS as RAMP_CIRCUITS, carve as carveRamps, make as makeRamps, tick as tickRamps, S_RAMP as RAMP, GRID as RAMP_GRID, TICK_MS as RAMP_TICK } from './cutline.js'

/** Where (x, y) sits in a ramp's own frame: along its facing, and across it. */
function inRampFrame(r, x, y) {
  const dx = x - r.x
  const dy = y - r.y
  return {
    along: dx * Math.cos(r.heading) + dy * Math.sin(r.heading),
    across: -dx * Math.sin(r.heading) + dy * Math.cos(r.heading),
  }
}
const underRamp = (r, x, y) => {
  const { along, across } = inRampFrame(r, x, y)
  // A ramp is drawn RAMP_LENGTH (one tile) deep on its centre; the tile the
  // physics launches from must sit inside that, not beside it.
  return Math.abs(along) <= 0.5 && Math.abs(across) <= r.width / 2 + 0.5
}

test('carve lists every ramp, and every ramp tile lies under one', () => {
  let listed = 0
  for (const circuit of RAMP_CIRCUITS) {
    const { grid, ramps } = carveRamps(circuit.seed)
    assert.ok(Array.isArray(ramps), `${circuit.name}: carve must list its ramps`)
    listed += ramps.length
    for (const r of ramps) {
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.heading), `${circuit.name}: a ramp is not finite`)
      assert.ok(r.width >= 1, `${circuit.name}: a ramp has no width`)
    }
    for (let y = 0; y < RAMP_GRID; y++) {
      for (let x = 0; x < RAMP_GRID; x++) {
        if (grid[y * RAMP_GRID + x] !== RAMP) continue
        assert.ok(ramps.some((r) => underRamp(r, x, y)), `${circuit.name}: the ramp tile at ${x},${y} has no listed ramp over it`)
      }
    }
    // And the reverse: a wedge over a tile that is not a ramp lifts a car the
    // rules never launch. Later stages of carve lay pickup pads over some.
    for (const r of ramps) {
      const nx = -Math.sin(r.heading)
      const ny = Math.cos(r.heading)
      for (let k = -(r.width - 1) / 2; k <= (r.width - 1) / 2; k++) {
        const x = Math.round(r.x + nx * k)
        const y = Math.round(r.y + ny * k)
        assert.equal(grid[y * RAMP_GRID + x], RAMP, `${circuit.name}: the ramp listed at ${r.x},${r.y} covers ${x},${y}, which is not a ramp tile`)
      }
    }
  }
  assert.ok(listed > 0, 'no circuit has a ramp, so nothing here was tested')
})

test('cars cross every ramp the way it faces', () => {
  let crossings = 0
  for (let i = 0; i < RAMP_CIRCUITS.length; i++) {
    const match = makeRamps({ circuitIndex: i, botsOnly: true })
    for (let t = 0; t < 60000; t += RAMP_TICK) {
      tickRamps(match, RAMP_TICK, () => 0.5)
      for (const car of match.cars.values()) {
        const speed = Math.hypot(car.vx, car.vy)
        if (!car.alive || speed < 1) continue
        if (match.grid[Math.round(car.y) * RAMP_GRID + Math.round(car.x)] !== RAMP) continue
        const r = match.ramps.find((q) => underRamp(q, car.x, car.y))
        assert.ok(r, `${match.circuit.name}: a car on a ramp tile is under no listed ramp`)
        const facing = (car.vx * Math.cos(r.heading) + car.vy * Math.sin(r.heading)) / speed
        assert.ok(facing > 0, `${match.circuit.name}: a car crossed the ramp at ${r.x.toFixed(1)},${r.y.toFixed(1)} against its facing`)
        crossings++
      }
    }
  }
  assert.ok(crossings > 50, `bots must actually cross ramps for this to test anything, saw ${crossings}`)
})

// --- No way round a checkpoint ---------------------------------------------
// A lap only counts if every checkpoint is taken in order. So from checkpoint
// k-1 there must be no drivable way to checkpoint k+1 that stays outside
// checkpoint k's circle. Walling off circles k and k-2 cuts the loop in two, and
// a flood fill from k-1 must then stay on its own side. Corner run-off once dug
// through the wall between two parallel stretches on every circuit, and a car
// that took one of those gravel bridges skipped up to half a lap and then found
// its lap did not count at the line.
import { CIRCUITS as CP_CIRCUITS, carve as cpCarve, GRID as CP_GRID, S_WALL as CP_WALL, CHECKPOINT_RADIUS as CP_RADIUS } from './cutline.js'

test('no drivable way round the circuit skips a checkpoint', () => {
  for (const circuit of CP_CIRCUITS) {
    const { grid, checkpoints } = cpCarve(circuit.seed)
    const n = checkpoints.length
    for (let k = 0; k < n; k++) {
      const walls = [checkpoints[k], checkpoints[(k - 2 + n) % n]]
      const open = (x, y) =>
        x >= 0 && y >= 0 && x < CP_GRID && y < CP_GRID &&
        grid[y * CP_GRID + x] !== CP_WALL &&
        walls.every((c) => Math.hypot(x - c.x, y - c.y) > CP_RADIUS)
      const from = checkpoints[(k - 1 + n) % n]
      const to = checkpoints[(k + 1) % n]
      const seen = new Uint8Array(CP_GRID * CP_GRID)
      const queue = [[Math.round(from.x), Math.round(from.y)]]
      seen[queue[0][1] * CP_GRID + queue[0][0]] = 1
      let reached = false
      while (queue.length && !reached) {
        const [x, y] = queue.pop()
        if (Math.hypot(x - to.x, y - to.y) < 1.5) reached = true
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx
          const ny = y + dy
          if (!open(nx, ny) || seen[ny * CP_GRID + nx]) continue
          seen[ny * CP_GRID + nx] = 1
          queue.push([nx, ny])
        }
      }
      assert.ok(!reached, `${circuit.name}: a car can get from checkpoint ${(k - 1 + n) % n} to ${(k + 1) % n} without passing checkpoint ${k}`)
    }
  }
})
