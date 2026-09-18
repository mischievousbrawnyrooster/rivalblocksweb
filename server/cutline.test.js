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
