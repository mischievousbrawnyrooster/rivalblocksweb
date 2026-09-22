// Rules for one Cutline race. Pure: zero external imports, zero Node APIs,
// zero sockets, zero timers, zero I/O. Everything here is exercised by
// cutline.test.js.

// --- Dimensions -----------------------------------------------------------
export const GRID = 96               // square, the circuit is carved out of it
// Tiles of racing surface across. Widened from 7: the grid now starts four
// abreast and pickups land as a rank of four, and both were crowding a 7-wide
// road with no room left to pick a line. Bounded by the grid rather than by
// taste: BASE_RADIUS + 3 * AMP_MAX + HALF_WIDTH must stay inside GRID / 2,
// which is 30 + 10.5 + 5 = 45.5 against 48.
export const TRACK_WIDTH = 11
export const CHECKPOINT_COUNT = 12

// --- Centerline generation ------------------------------------------------
// The corner vocabulary. `speed` is DERIVED from the handling model, not chosen:
// at speed v a car turns TURN_RATE * (1 - TURN_FALLOFF * v / TOP_SPEED) / v
// radians per tile, so a corner of radius k demands
// v = TURN_RATE / (k + TURN_RATE * TURN_FALLOFF / TOP_SPEED).
// The table spans flat out to hard braking on purpose: a racer whose corners
// never need a brake has removed the main thing a driver does.
export const CORNERS = [
  { name: 'sweeper', rad: 0.15, speed: 12.66 },
  { name: 'standard', rad: 0.3, speed: 7.94 },
  { name: 'tight', rad: 0.45, speed: 5.79 },
  { name: 'hairpin', rad: 0.6, speed: 4.55 },
]

// No longer a ceiling every circuit hugs. It is the tightest corner the
// vocabulary contains, and circuits are expected to use the whole range.
export const MAX_CORNER_RAD = Math.max(...CORNERS.map((c) => c.rad))
export const POINT_SPACING = 1       // tiles between centerline points

export const CIRCUITS = [
  { name: 'Foundry Loop', seed: 1201 },
  { name: 'Coolant Bend', seed: 1340 },
  { name: 'The Spindle', seed: 1477 },
  { name: 'Slag Pit', seed: 1602 },
  { name: 'Draw Bench', seed: 1755 },
  { name: 'Cinder Yard', seed: 1888 },
  { name: 'Ladle Row', seed: 1931 },
  { name: 'Tap Hole', seed: 2064 },
]

// --- Lattice --------------------------------------------------------------
// A circuit is a closed cycle on a coarse lattice, smoothed into real corners.
// The harmonic curve this replaces was single valued in angle, so it always
// bent around the grid centre: every corner turned the same way and curvature
// was global, which is why every circuit read as the same deformed circle.
export const MIN_WALL = 3
export const SEGMENT_WIDTH_MAX = 11
export const SEGMENT_WIDTH_MIN = 7
// Derived. Two parallel corridors must not merge, so their centres must be at
// least the widest road plus a wall apart.
export const LATTICE_CELL = SEGMENT_WIDTH_MAX + MIN_WALL
export const LATTICE_N = 6
export const LATTICE_ORIGIN = 8

export const MIN_CYCLE_EDGES = 16
export const MIN_DIRECTION_CHANGES = 8
export const MIN_SIGN_CHANGES = 3
export const MIN_STRAIGHT_EDGES = 3
export const CYCLE_ATTEMPTS = 200

// A known good cycle, used when the search cannot find one. It satisfies every
// acceptance rule the search applies, so a hard seed never yields a circuit
// worse than one the search would have rejected.
export const FALLBACK_CYCLE = [
  { gx: 1, gy: 1 }, { gx: 2, gy: 1 }, { gx: 3, gy: 1 }, { gx: 4, gy: 1 },
  { gx: 4, gy: 2 }, { gx: 3, gy: 2 }, { gx: 3, gy: 3 }, { gx: 4, gy: 3 },
  { gx: 4, gy: 4 }, { gx: 3, gy: 4 }, { gx: 2, gy: 4 }, { gx: 1, gy: 4 },
  { gx: 1, gy: 3 }, { gx: 2, gy: 3 }, { gx: 2, gy: 2 }, { gx: 1, gy: 2 },
]

const LATTICE_STEPS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** Whether a closed lattice cycle is varied enough to be worth racing. */
function cycleAccepted(cycle) {
  if (cycle.length < MIN_CYCLE_EDGES) return false

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
      if (run > longestStraight) longestStraight = run
    } else {
      turns++
      run = 1
      const sign = Math.sign(cross)
      if (lastSign !== 0 && sign !== lastSign) signChanges++
      lastSign = sign
    }
  }

  return (
    turns >= MIN_DIRECTION_CHANGES &&
    signChanges >= MIN_SIGN_CHANGES &&
    longestStraight >= MIN_STRAIGHT_EDGES
  )
}

/**
 * A closed cycle on the lattice, as a list of vertices in order.
 *
 * Self-intersection is impossible by construction: a vertex is never visited
 * twice, so two stretches of road can never occupy the same lattice cell. That
 * is the guarantee the harmonic curve gave for free and the reason this search
 * refuses rather than repairs.
 */
export function findCycle(rng = Math.random) {
  for (let attempt = 0; attempt < CYCLE_ATTEMPTS; attempt++) {
    const start = {
      gx: Math.floor(rng() * LATTICE_N),
      gy: Math.floor(rng() * LATTICE_N),
    }
    const path = [start]
    const seen = new Set([`${start.gx},${start.gy}`])

    for (let step = 0; step < LATTICE_N * LATTICE_N * 4; step++) {
      const at = path[path.length - 1]
      // Shuffle the four steps with the injected rng so the walk is seeded.
      const order = [0, 1, 2, 3]
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        const t = order[i]
        order[i] = order[j]
        order[j] = t
      }

      let moved = false
      for (const oi of order) {
        const d = LATTICE_STEPS[oi]
        const nx = at.gx + d.x
        const ny = at.gy + d.y
        if (nx < 0 || ny < 0 || nx >= LATTICE_N || ny >= LATTICE_N) continue

        // Closing the loop: only from a path long enough to be worth racing.
        if (nx === start.gx && ny === start.gy) {
          if (path.length >= MIN_CYCLE_EDGES && cycleAccepted(path)) return path
          continue
        }

        if (seen.has(`${nx},${ny}`)) continue
        path.push({ gx: nx, gy: ny })
        seen.add(`${nx},${ny}`)
        moved = true
        break
      }
      if (!moved) break // walked into a dead end, start again
    }
  }

  return FALLBACK_CYCLE.map((v) => ({ ...v }))
}

// --- Seeded PRNG ----------------------------------------------------------
// mulberry32. Duplicated from voiddrillers.js rather than imported: this module
// has zero imports on purpose, and that purity is why every rule here is
// testable in isolation. Do not factor it into a shared file.
export function createRng(seed = 12345) {
  let s = (typeof seed === 'number' ? seed : 12345) >>> 0
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CENTERLINE_ITERATOR = function* () {
  yield* this.centerline
}

/** Lattice vertex to world tile. */
function latticeToWorld(v) {
  return {
    x: LATTICE_ORIGIN + v.gx * LATTICE_CELL,
    y: LATTICE_ORIGIN + v.gy * LATTICE_CELL,
  }
}

function norm(x, y) {
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}

/** Equalize chord gaps along a closed polyline to maintain uniform Euclidean spacing. */
function equalize(line, iters = 25) {
  const pts = line.map((p) => ({ x: p.x, y: p.y }))
  const n = pts.length
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n]
      const here = pts[i]
      const next = pts[(i + 1) % n]
      const d1 = Math.hypot(here.x - prev.x, here.y - prev.y)
      const d2 = Math.hypot(next.x - here.x, next.y - here.y)
      const tx = next.x - prev.x
      const ty = next.y - prev.y
      const tlen = Math.hypot(tx, ty) || 1
      const diff = (d2 - d1) * 0.25
      here.x += (tx / tlen) * diff
      here.y += (ty / tlen) * diff
    }
  }
  return pts
}

/**
 * A circuit's racing line and a description of every point on it.
 *
 * The cycle gives the shape; this gives it corners. Each lattice vertex where
 * the path turns becomes a circular fillet whose radius comes from CORNERS, and
 * consecutive steps in one direction become a straight.
 */
export function buildCenterline(seed) {
  const rng = createRng(seed)
  const cycle = findCycle(rng)
  const pts = cycle.map(latticeToWorld)

  // Classify each vertex: straight through, or a corner of some kind.
  const kinds = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length]
    const here = pts[i]
    const next = pts[(i + 1) % pts.length]
    const ax = here.x - prev.x
    const ay = here.y - prev.y
    const bx = next.x - here.x
    const by = next.y - here.y
    const cross = ax * by - ay * bx
    if (cross === 0) {
      kinds.push({ corner: null, sign: 0 })
    } else {
      const pick = CORNERS[Math.floor(rng() * CORNERS.length)] ?? CORNERS[1]
      kinds.push({ corner: pick.name, sign: Math.sign(cross) })
    }
  }

  // Walk the ring, emitting a dense polyline: straight runs verbatim, corners as
  // arcs. The fillet radius is chosen so the arc's curvature matches the corner's
  // rad per tile, which is what makes the required speed real.
  const dense = []
  const denseMeta = []
  for (let i = 0; i < pts.length; i++) {
    const here = pts[i]
    const next = pts[(i + 1) % pts.length]
    const k = kinds[i]

    if (k.corner === null) {
      dense.push({ x: here.x, y: here.y })
      denseMeta.push({ corner: null, sign: 0 })
    } else {
      const prev = pts[(i - 1 + pts.length) % pts.length]
      const spec = CORNERS.find((c) => c.name === k.corner) ?? CORNERS[1]
      // Arc radius in tiles from radians per tile: r = 1 / k. For a 90-degree corner,
      // a quadratic bezier fillet with arm length r has apex curvature sqrt(2) / r,
      // so r = sqrt(2) / k matches the corner's rad per tile at the apex.
      const radius = Math.min((1 / spec.rad) * Math.SQRT2, LATTICE_CELL * 0.45)
      const inDir = norm(here.x - prev.x, here.y - prev.y)
      const outDir = norm(next.x - here.x, next.y - here.y)
      const entry = { x: here.x - inDir.x * radius, y: here.y - inDir.y * radius }
      const exit = { x: here.x + outDir.x * radius, y: here.y + outDir.y * radius }
      const steps = Math.max(8, Math.round(radius * 4))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        // Quadratic bezier through the vertex gives a clean fillet with the
        // right tangents at both ends and no trigonometry to get wrong.
        const mx = (1 - t) * (1 - t) * entry.x + 2 * (1 - t) * t * here.x + t * t * exit.x
        const my = (1 - t) * (1 - t) * entry.y + 2 * (1 - t) * t * here.y + t * t * exit.y
        dense.push({ x: mx, y: my })
        denseMeta.push({ corner: k.corner, sign: k.sign })
      }
    }
  }

  const raw = resample(dense, POINT_SPACING)
  const centerline = equalize(raw, 25)

  // Carry meta across the resample by nearest dense point. Exact enough: dense
  // points are closer together than POINT_SPACING wherever a corner is.
  const meta = centerline.map((p) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < dense.length; i++) {
      const d = (dense[i].x - p.x) ** 2 + (dense[i].y - p.y) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    const m = denseMeta[best]
    return { width: SEGMENT_WIDTH_MAX, corner: m.corner, sign: m.sign }
  })

  const result = { centerline, meta }
  result[Symbol.iterator] = CENTERLINE_ITERATOR
  Object.defineProperty(result, 'length', { get: () => centerline.length, enumerable: false, configurable: true })
  for (let i = 0; i < centerline.length; i++) {
    Object.defineProperty(result, i, { get: () => centerline[i], enumerable: false, configurable: true })
  }
  return result
}

/**
 * Walk a closed polyline and emit evenly spaced points around the whole
 * loop, including the closing segment from the last point back to the
 * first. A greedy walk that stops once it runs out of input leaves one
 * short or long seam at the wrap; measuring the loop's total length first
 * and dividing it into exactly `n` equal steps removes that seam instead of
 * leaving it for a post-hoc trim.
 */
function resample(points, spacing) {
  const segLengths = []
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    segLengths.push(d)
    total += d
  }

  const n = Math.round(total / spacing)
  const step = total / n
  const out = []

  let segIndex = 0
  let segStart = 0 // arc length travelled at the start of the current segment
  for (let k = 0; k < n; k++) {
    const target = k * step
    while (segIndex < segLengths.length - 1 && segStart + segLengths[segIndex] < target) {
      segStart += segLengths[segIndex]
      segIndex++
    }
    const a = points[segIndex]
    const b = points[(segIndex + 1) % points.length]
    const segLen = segLengths[segIndex]
    const t = segLen === 0 ? 0 : (target - segStart) / segLen
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }

  return out
}

// --- Surfaces -------------------------------------------------------------
export const S_WALL = 0
export const S_TARMAC = 1
export const S_KERB = 2
export const S_BOOST = 3
export const S_OIL = 4
export const S_PICKUP = 5
export const S_LINE = 6
// Run off, not wall. Running wide outside a fast corner costs time instead of
// ending the race, which is what makes a hard braking zone a risk worth taking.
// offTrack stays reserved for S_WALL, so the off-track cap does not apply here.
export const S_GRAVEL = 7
// A ramp. Crossing it above RAMP_MIN_SPEED launches the car.
export const S_RAMP = 8

export const SURFACE_CHARS = ['W', 'T', 'K', 'B', 'O', 'P', 'L', 'G', 'R']

export const GRAVEL_DRAG = 3.0       // scrubs speed without stopping the car

// Derived from the starting slots the carve lays down, the way Blockout derives
// its capacity from SPAWNS.length. To raise capacity, lay more slots; never
// edit this number, or a player is seated at undefined.
// Two rows of four, not four rows of two. Every car must reach the line before
// its first lap counts, so a deep grid charges the back row real distance over
// the whole race: four rows at a 3 point gap spread the field over 9 centerline
// points, 4.7% of a lap, which is about half a second that is never given back.
// Two rows at a 2 point gap is 1.0%.
export const START_ROWS = 2
export const START_COLUMNS = 4
export const MAX_PLAYERS = START_ROWS * START_COLUMNS

const HALF_WIDTH = (TRACK_WIDTH - 1) / 2
export const PICKUP_MIN_SPACING = 16
export const PICKUP_RANDOM_SPACING = 16
const START_ROW_GAP = 2              // centerline points between starting rows
const LANE_GAP = 1.5                 // tiles between cars across the road
// Pickups land as a rank across the road rather than one dot on the centerline,
// so meeting a row is a choice of lane instead of a choice of whether to bother.
export const PICKUP_ROW = 4

/** The surface at a tile. Anything off the grid is wall, so no caller needs a bounds check. */
export function surfaceAt(grid, x, y) {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return S_WALL
  return grid[y * GRID + x]
}

/** The unit tangent of the centerline at an index, from its neighbours. */
function tangentAt(line, i) {
  const a = line[(i - 1 + line.length) % line.length]
  const b = line[(i + 1) % line.length]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

/** Stamp one tile, rounding to the nearest cell and dropping anything that
 * rounds off the grid, so no caller needs a bounds check. */
function putTile(grid, x, y, surface) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || iy < 0 || ix >= GRID || iy >= GRID) return
  grid[iy * GRID + ix] = surface
}

/**
 * Visit every integer tile from (x0, y0) to (x1, y1) inclusive, in order.
 * Ordinary Bresenham already does this, but a plain diagonal step in
 * Bresenham (both x and y moving at once) touches the previous tile only at
 * its corner, not an edge, so a straight run of them is 8-connected, not
 * 4-connected. Visiting the elbow (x + sx, y) just before a diagonal step
 * turns every such step into two orthogonal ones, so the whole line stays
 * 4-connected end to end, whatever its slope or length. Exported so this
 * guarantee can be tested directly, independent of any centerline.
 */
export function walkLine(x0, y0, x1, y1, visit) {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy

  visit(x, y)
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err
    const stepX = e2 >= dy
    const stepY = e2 <= dx
    if (stepX && stepY) visit(x + sx, y) // the elbow ahead of a diagonal step
    if (stepX) {
      err += dy
      x += sx
    }
    if (stepY) {
      err += dx
      y += sy
    }
    visit(x, y)
  }
}

/**
 * Stamp the racing surface (tarmac in the middle, kerb along both edges)
 * across the normal at every centerline point, walking the closed set of
 * adjacent pairs, wrap from the last point back to the first included, and
 * rasterizing the segment between each pair rather than dropping a lone dot.
 * Points are POINT_SPACING apart and the track is TRACK_WIDTH wide, so most
 * consecutive stamps already overlap, but on a tight corner the outer rail
 * travels further per index than the centerline does, so two consecutive
 * stamps on it can round tiles apart. walkLine's rasterized, elbow-aware
 * segment is what keeps every rail, seam included, 4-connected to itself
 * regardless of how far a corner pushes two samples apart.
 *
 * Exported so the bridging can be exercised directly against a synthetic
 * centerline, not only against the eight fixed seeds in CIRCUITS.
 */
export function stampTrack(grid, centerline) {
  const railAt = (i, off) => {
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    return { x: p.x - t.y * off, y: p.y + t.x * off }
  }

  for (let i = 0; i < centerline.length; i++) {
    const next = (i + 1) % centerline.length
    for (let off = -HALF_WIDTH; off <= HALF_WIDTH; off++) {
      const edge = Math.abs(off) === HALF_WIDTH
      const surface = edge ? S_KERB : S_TARMAC
      const a = railAt(i, off)
      const b = railAt(next, off)
      walkLine(Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y), (x, y) =>
        putTile(grid, x, y, surface),
      )
    }
  }
}

/**
 * One circuit, whole. The grid is what the client draws and what handling reads;
 * the centerline, checkpoints and starting slots all fall out of the same walk,
 * which is why none of them is separate code.
 */
export function carve(seed) {
  // Task 4 changed buildCenterline's return shape. The full pipeline arrives in
  // Task 7; until then this keeps the existing carve working on the new shape so
  // the suite never goes red across tasks.
  const { centerline } = buildCenterline(seed)
  const grid = new Uint8Array(GRID * GRID) // S_WALL is 0, so this starts solid
  const rng = createRng(seed ^ 0x9e3779b9) // a stream of its own, so surface
  //                                          decoration cannot shift the shape

  const put = (x, y, surface) => putTile(grid, x, y, surface)

  // Curvature per point, so decoration can tell a straight from a corner exit.
  const curvature = centerline.map((_, i) => {
    const a = centerline[i]
    const b = centerline[(i + 1) % centerline.length]
    const c = centerline[(i + 2) % centerline.length]
    const h1 = Math.atan2(b.y - a.y, b.x - a.x)
    const h2 = Math.atan2(c.y - b.y, c.x - b.x)
    let turn = Math.abs(h2 - h1)
    if (turn > Math.PI) turn = Math.PI * 2 - turn
    return turn
  })

  // 1. Stamp the racing surface. See stampTrack for why it walks the closed
  //    set of adjacent pairs, wrap included, rather than dropping a lone dot
  //    per point.
  stampTrack(grid, centerline)

  // 2. Decorate. A boost strip rewards a straight; oil punishes a corner exit
  //    that was taken too fast. Both come from the decoration stream, so a
  //    circuit's shape and its surfaces are independent.
  for (let i = 0; i < centerline.length; i++) {
    const straight = curvature[i] < MAX_CORNER_RAD * 0.25
    const cornerExit = curvature[(i - 6 + curvature.length) % curvature.length] > MAX_CORNER_RAD * 0.6

    let surface = null
    if (straight && rng() < 0.05) surface = S_BOOST
    else if (cornerExit && rng() < 0.04) surface = S_OIL
    if (!surface) continue

    const p = centerline[i]
    const t = tangentAt(centerline, i)
    for (let off = -1; off <= 1; off++) {
      put(p.x - t.y * off, p.y + t.x * off, surface)
    }
  }

  // 3. Powerups land as a rank across the road, not one dot on the centerline.
  //    Each box in a row carries its own key and therefore its own cooldown, so
  //    taking one lane leaves the rest of the row standing for the cars behind.
  //    That turns arriving at a row into a choice of lane under pressure rather
  //    than a free collect for whoever is nearest the middle.
  const pickups = []
  const seen = new Set()
  let nextPickup = 14 + Math.floor(rng() * 8)
  for (let i = 0; i < centerline.length - 14; i++) {
    if (i < nextPickup) continue
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    for (let lane = 0; lane < PICKUP_ROW; lane++) {
      const off = (lane - (PICKUP_ROW - 1) / 2) * LANE_GAP
      const px = Math.round(p.x - t.y * off)
      const py = Math.round(p.y + t.x * off)
      const key = py * GRID + px
      // A tight corner can round two lanes onto the same tile. One box per tile,
      // or the second would sit on a cooldown it never set.
      if (seen.has(key)) continue
      seen.add(key)
      put(px, py, S_PICKUP)
      pickups.push({ x: px, y: py, key })
    }
    nextPickup = i + PICKUP_MIN_SPACING + Math.floor(rng() * PICKUP_RANDOM_SPACING)
  }

  // 4. The cut line, across the full width at index 0.
  {
    const p = centerline[0]
    const t = tangentAt(centerline, 0)
    for (let off = -HALF_WIDTH + 1; off <= HALF_WIDTH - 1; off++) {
      put(p.x - t.y * off, p.y + t.x * off, S_LINE)
    }
  }

  // 5. Checkpoints, evenly spaced indices around the loop. Taken in order, they
  //    are what stops a driver cutting the infield.
  const checkpoints = []
  for (let c = 0; c < CHECKPOINT_COUNT; c++) {
    const index = Math.floor((c * centerline.length) / CHECKPOINT_COUNT)
    checkpoints.push({ index, x: centerline[index].x, y: centerline[index].y })
  }

  // 6. Starting slots, staggered back from the line. Index 0 is the line, so
  //    the grid runs backwards from it around the end of the loop.
  const startSlots = []
  for (let row = 0; row < START_ROWS; row++) {
    const index = (centerline.length - (row + 1) * START_ROW_GAP) % centerline.length
    const p = centerline[index]
    const t = tangentAt(centerline, index)
    for (let col = 0; col < START_COLUMNS; col++) {
      const off = (col - (START_COLUMNS - 1) / 2) * LANE_GAP
      startSlots.push({
        x: p.x - t.y * off,
        y: p.y + t.x * off,
        heading: Math.atan2(t.y, t.x),
        index,
      })
    }
  }

  return { grid, centerline, checkpoints, startSlots, pickups }
}

// --- Map encoding ---------------------------------------------------------
// Run-length encoded, the identical scheme voiddrillers.js uses. A 96 by 96
// grid is overwhelmingly long runs of wall, so this ships in a welcome frame.
export function encodeMap(grid) {
  if (!grid || grid.length === 0) return ''
  let out = ''
  let current = grid[0]
  let count = 1

  for (let i = 1; i < grid.length; i++) {
    if (grid[i] === current) {
      count++
    } else {
      out += `${count}${SURFACE_CHARS[current] ?? 'W'}`
      current = grid[i]
      count = 1
    }
  }
  return out + `${count}${SURFACE_CHARS[current] ?? 'W'}`
}

export function decodeMap(str) {
  const out = new Uint8Array(GRID * GRID)
  if (!str) return out
  const re = /(\d+)([A-Z])/g
  let match
  let at = 0
  while ((match = re.exec(str)) !== null) {
    const count = parseInt(match[1], 10)
    const surface = SURFACE_CHARS.indexOf(match[2])
    const value = surface < 0 ? S_WALL : surface
    for (let i = 0; i < count && at < out.length; i++) out[at++] = value
  }
  return out
}

// --- Timing & lobby -------------------------------------------------------
export const TICK_MS = 16            // 60 Hz simulation
export const SEND_MS = 16            // client input rate
export const DELAY_MS = 60           // client interpolation window

export const MIN_PLAYERS = 2
export const BOT_FILL_TO = 4
export const MIN_LAPS = 3
// Fixed rather than scaled by field size. Laps measure about 11.9s, so 5 is a
// race of roughly a minute. Scaling by who happened to join made a two car race
// three laps and an eight car race eight, so the same circuit ran for wildly
// different lengths depending on the lobby.
export const RACE_LAPS = 5
export const GRACE_LAPS = 1          // lap 1 takes no cut
export const COUNTDOWN_MS = 4000
export const POST_RACE_GRACE_MS = 8000

export const BOT_NAMES = ['Ladle', 'Tap', 'Cinder', 'Bloom', 'Skip', 'Tundish', 'Runner']

// --- Name sanitisation ----------------------------------------------------
const isPrintable = (ch) => {
  const code = ch.charCodeAt(0)
  return code >= 32 && code !== 127
}

export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    .slice(0, 256)
    .split('')
    .filter(isPrintable)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return clean ? clean.slice(0, 16) : 'Driver'
}

// --- Match creation -------------------------------------------------------
export function make(options = {}) {
  const circuitIndex = Number.isInteger(options.circuitIndex)
    ? ((options.circuitIndex % CIRCUITS.length) + CIRCUITS.length) % CIRCUITS.length
    : 0
  const circuit = CIRCUITS[circuitIndex]
  const { grid, centerline, checkpoints, startSlots, pickups } = carve(circuit.seed)

  return {
    circuit,
    circuitIndex,
    grid,
    centerline,
    checkpoints,
    startSlots,
    pickups: pickups ?? [],
    cars: new Map(),
    nextId: 1,
    phase: 'waiting', // waiting | countdown | racing | over
    countdown: COUNTDOWN_MS,
    now: 0,
    elapsed: 0,
    laps: MIN_LAPS,
    lap: 0,           // laps the leader has completed
    hazards: [],
    pickupCooldown: new Map(), // tile index -> the time it refills
    cut: null,        // { id, name, at } for the most recent elimination
    winner: null,
    final: false,
    overSince: 0,
    board: options.board ?? [],
    botFill: options.botFill ?? BOT_FILL_TO,
    botsWanted: options.botsWanted ?? false,
    botsOnly: options.botsOnly ?? false,
  }
}

// --- Roster ---------------------------------------------------------------
export function join(match, info = {}, rng = Math.random) {
  const isBot = Boolean(info.bot)

  // A full grid of bots stands one down rather than turning a person away.
  if (!isBot && match.cars.size >= MAX_PLAYERS) {
    const bot = [...match.cars.values()].find((c) => c.bot)
    if (bot) leave(match, bot.id)
  }
  if (match.cars.size >= MAX_PLAYERS) return null

  // A restart carries cars in under their old ids while the counter starts
  // again, so an id already on the grid is skipped, never reused.
  let id = info.id
  while (!id || match.cars.has(id)) id = `${isBot ? 'bot' : 'p'}-${match.nextId++}`

  const used = new Set([...match.cars.values()].map((c) => c.slot))
  let slot = 0
  while (slot < MAX_PLAYERS && used.has(slot)) slot++
  const start = match.startSlots[slot]

  const car = {
    id,
    name: sanitizeName(info.name),
    slot,
    bot: isBot,
    botSkill: isBot ? 0.82 + rng() * 0.18 : 1,
    x: start.x,
    y: start.y,
    heading: start.heading,
    vx: 0,
    vy: 0,
    lap: 0,
    // A car sitting on the line has already taken checkpoint 0, so it waits
    // for 1. Starting at 0 would let a car count a lap without moving.
    nextCp: 1,
    cpTaken: 0,
    alive: true,
    finishedAt: null,
    item: null,
    boostUntil: 0,
    bestLapMs: null,
    lapStartedAt: 0,
  }

  match.cars.set(id, car)
  return car
}

export function leave(match, id) {
  match.cars.delete(id)
  if (match.cars.size === 0) {
    match.phase = 'waiting'
    match.winner = null
    match.final = false
  }
}

// --- Handling -------------------------------------------------------------
// Measured lap time (Task 7, after the driveBots aim-anchor fix): 4 bots,
// fixed rng, 90s runs across all 8 circuits. All 8 now drive cleanly and
// consistently: median lap 11.87s, range 11.14 to 13.04s. That is well
// under the spec's 18s estimate, not tuned toward it; TOP_SPEED was left
// alone. See task-7-report.md for the prior, bug-confounded measurement and
// the fix.
export const TOP_SPEED = 14.0        // tiles per second
export const ACCEL = 18.0
export const BRAKE = 26.0
export const DRAG = 1.2
export const TURN_RATE = 3.2         // rad/s at low speed
export const TURN_FALLOFF = 0.45     // fraction of turn rate lost at top speed

export const OFFTRACK_CAP = 6.5
export const OFFTRACK_DRAG = 6.0
export const WALL_HIT_KEEP = 0.25

// The car's collision shape is DERIVED from the car that is drawn, so the two
// cannot drift apart. They drifted in the first place because the page invented
// its own numbers: it drew a body 1.45 by 0.82 while the rules used one circle
// of radius 0.45 and tested walls at a single point at the car's centre. The
// nose reaches CAR_LENGTH / 2 past that point, so a car could sit most of a
// tile inside a wall with nothing registering.
export const CAR_LENGTH = 1.45
export const CAR_WIDTH = 0.82
export const CAR_RADIUS = CAR_WIDTH / 2

/** The four corners of a car's oriented body, nose-left, nose-right, tail-right, tail-left. */
export function carCorners(car) {
  const c = Math.cos(car.heading)
  const s = Math.sin(car.heading)
  const hl = CAR_LENGTH / 2
  const hw = CAR_WIDTH / 2
  return [
    { x: car.x + c * hl - s * hw, y: car.y + s * hl + c * hw },
    { x: car.x + c * hl + s * hw, y: car.y + s * hl - c * hw },
    { x: car.x - c * hl + s * hw, y: car.y - s * hl - c * hw },
    { x: car.x - c * hl - s * hw, y: car.y - s * hl + c * hw },
  ]
}

/** Whether any corner of a car's body sits in a wall at a hypothetical position. */
function bodyHitsWall(match, car, atX, atY) {
  const probe = { x: atX, y: atY, heading: car.heading }
  for (const p of carCorners(probe)) {
    if (surfaceAt(match.grid, Math.round(p.x), Math.round(p.y)) === S_WALL) return true
  }
  return false
}

export const BOOST_MS = 3000         // the carried boost item
export const STRIP_BOOST_MS = 1200   // crossing an S_BOOST strip on the track
export const BOOST_MULT = 1.35       // shared by both
export const SLIP_BOOST = 1.18

// How fast sideways velocity bleeds off, per surface. This one table is where
// a circuit's entire character lives: raise a value and that surface bites,
// lower it and the car slides.
export const GRIP = {
  [S_TARMAC]: 7.0,
  [S_KERB]: 4.0,
  [S_BOOST]: 7.0,
  [S_OIL]: 0.6,
  [S_PICKUP]: 7.0,
  [S_LINE]: 7.0,
  [S_GRAVEL]: 2.0,
  [S_RAMP]: 7.0,
}

/**
 * Held input, clamped. Nothing from a socket is trusted: steer is forced to
 * exactly -1, 0 or 1 and the rest to booleans, so no value a client can send
 * reaches the physics as NaN. A single non finite number here would drive a
 * position to NaN and make a car permanently un-eliminable, the same class of
 * failure the Object.hasOwn direction lookup exists to close.
 */
export function applyInput(match, id, input) {
  const car = typeof id === 'string' ? match.cars.get(id) : undefined
  if (!car || !car.alive) return false

  const raw = input && typeof input === 'object' ? input : {}
  const steer = raw.steer
  car.steer = steer === 1 || steer === -1 ? steer : 0
  car.throttle = raw.throttle === 1 || raw.throttle === true
  car.brake = raw.brake === 1 || raw.brake === true
  car.wantsUse = raw.use === 1 || raw.use === true
  return true
}

/** The speed cap a car is currently allowed, including boost and slipstream. */
export function topSpeedOf(match, car) {
  let cap = TOP_SPEED
  if (match.now < car.boostUntil) cap *= BOOST_MULT
  if (car.drafting) cap *= SLIP_BOOST
  return cap
}

/** The surface under a car right now. */
function surfaceUnder(match, car) {
  return surfaceAt(match.grid, Math.round(car.x), Math.round(car.y))
}

/**
 * One car, one tick. The standard arcade drift model: thrust along the nose,
 * then bleed the sideways component according to the surface. Low grip is
 * drift, and oil is grip near zero, so a car on a slick keeps its momentum and
 * loses its ability to change direction with no special case anywhere.
 */
export function stepCar(match, car, dt) {
  if (!car.alive || !Number.isFinite(dt) || dt <= 0) return

  const surface = surfaceUnder(match, car)
  const offTrack = surface === S_WALL
  const cap = offTrack ? OFFTRACK_CAP : topSpeedOf(match, car)

  // 1. Steer. A rate, never a target: this is what makes the game playable
  //    without client-side prediction.
  const speed = Math.hypot(car.vx, car.vy)
  const falloff = 1 - TURN_FALLOFF * Math.min(1, speed / TOP_SPEED)
  const spinning = match.now < (car.spinUntil ?? 0)
  if (spinning) {
    // The wheel is not yours. Input is ignored outright rather than scaled, so a
    // spin cannot be steered out of by holding the opposite lock.
    car.heading += SPIN_RATE * dt
  } else {
    const steerAuthority = car.onSlick ? SLICK_TURN : 1
    car.heading += (car.steer ?? 0) * TURN_RATE * falloff * steerAuthority * dt
  }

  const cos = Math.cos(car.heading)
  const sin = Math.sin(car.heading)

  // 2. Split velocity into forward and lateral, relative to the nose.
  let fwd = car.vx * cos + car.vy * sin
  let lat = -car.vx * sin + car.vy * cos

  // 3. Thrust, braking and drag act on the forward component only.
  const drive = spinning ? SPIN_THRUST : car.onSlick ? SLICK_THRUST : 1
  if (car.throttle) fwd += ACCEL * (match.now < car.boostUntil ? BOOST_MULT : 1) * drive * dt
  if (car.brake) fwd -= BRAKE * dt
  const surfaceDrag = surface === S_GRAVEL ? GRAVEL_DRAG : DRAG
  fwd -= fwd * (offTrack ? OFFTRACK_DRAG : surfaceDrag) * dt

  // 4. Lateral bleeds off at the surface's grip.
  const base = offTrack ? GRIP[S_TARMAC] : (GRIP[surface] ?? GRIP[S_TARMAC])
  // A dropped slick is oil that happens to be a hazard rather than a tile, so
  // it resolves to the same grip and needs no second physics path.
  const grip = car.onSlick ? Math.min(base, GRIP[S_OIL]) : base
  lat *= Math.max(0, 1 - grip * dt)

  // 5. Clamp and recompose.
  fwd = Math.max(-cap * 0.4, Math.min(cap, fwd))
  car.vx = fwd * cos - lat * sin
  car.vy = fwd * sin + lat * cos

  // 6. Integrate, then resolve contact one axis at a time so a car sliding
  //    along a wall keeps the component that is not blocked.
  const nx = car.x + car.vx * dt
  if (bodyHitsWall(match, car, nx, car.y) && !offTrack) {
    car.vx *= -WALL_HIT_KEEP
  } else {
    car.x = nx
  }

  const ny = car.y + car.vy * dt
  if (bodyHitsWall(match, car, car.x, ny) && !offTrack) {
    car.vy *= -WALL_HIT_KEEP
  } else {
    car.y = ny
  }

  // A car that started off track is walked back rather than trapped: it is
  // allowed to move, capped and dragged, until it finds surface again.
  if (offTrack) {
    car.x = nx
    car.y = ny
  }

  // The grid is the world. Nothing leaves it, whatever the physics says.
  car.x = Math.max(0, Math.min(GRID - 1, car.x))
  car.y = Math.max(0, Math.min(GRID - 1, car.y))
}

/** The two circle centres that make up a car's capsule, fore and aft. */
function capsule(car) {
  const off = CAR_LENGTH / 2 - CAR_RADIUS
  const c = Math.cos(car.heading)
  const s = Math.sin(car.heading)
  return [
    { x: car.x + c * off, y: car.y + s * off },
    { x: car.x - c * off, y: car.y - s * off },
  ]
}

export function resolveContact(match) {
  const cars = [...match.cars.values()].filter((c) => c.alive)
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i]
      const b = cars[j]
      // Nearest pair of circles between the two capsules. A car is two circles,
      // so four pairs, and the closest one decides whether they touch.
      let best = null
      for (const pa of capsule(a)) {
        for (const pb of capsule(b)) {
          const d = Math.hypot(pb.x - pa.x, pb.y - pa.y)
          if (!best || d < best.d) best = { d, pa, pb }
        }
      }
      const min = CAR_RADIUS * 2
      if (!best || best.d >= min || best.d === 0) continue

      const push = (min - best.d) / 2
      const ux = (best.pb.x - best.pa.x) / best.d
      const uy = (best.pb.y - best.pa.y) / best.d
      a.x -= ux * push
      a.y -= uy * push
      b.x += ux * push
      b.y += uy * push
    }
  }
}

// --- Laps, running order and the cut --------------------------------------
// Generous enough that a car cannot thread between two ticks at top speed:
// TOP_SPEED * TICK_MS / 1000 is about 0.22 tiles, well inside this.
// A checkpoint must be reachable from anywhere a car may legally be, so its
// reach is DERIVED from the road rather than chosen. This was a hardcoded 4.0
// while the road was 7 wide, and widening the road to 11 silently put the outer
// racing line out of reach: a car running 4 tiles off centre missed 10 of 11
// checkpoints and its lap never counted at all. CHECKPOINT_RADIUS and
// TRACK_WIDTH are one setting in two places.
// The slack covers a car that has run wide onto the kerb or a tile beyond it.
// Kept below half the checkpoint spacing (centerline length / CHECKPOINT_COUNT,
// about 16) so two checkpoints are never in reach at once.
export const CHECKPOINT_SLACK = 2
export const CHECKPOINT_RADIUS = (TRACK_WIDTH - 1) / 2 + CHECKPOINT_SLACK

// The finish line is NOT judged by a circle. A circle cannot be both accurate
// along the track and wide enough across it: tight enough to stop a lap banking
// early is too narrow for a car crossing on the outside line, and wide enough
// for the outside line banks the lap tiles before the car reaches the paint.
// It is judged as a real crossing instead, which is exact in both axes.
export const LINE_HALF_SPAN = (TRACK_WIDTH - 1) / 2 + CHECKPOINT_SLACK

/**
 * Advance a car's checkpoint ring and count its laps.
 *
 * Checkpoints must be taken in order. A car holds nextCp and only ever
 * registers the one it is actually waiting for, so cutting the infield skips
 * checkpoints and the lap does not count. That ordering is the whole
 * anti-shortcut mechanism, and it is why the checkpoint ring is generated with
 * the circuit rather than bolted on.
 */
export function updateProgress(match, car) {
  if (!car.alive) return

  const ring = match.checkpoints
  const target = ring[car.nextCp]
  if (!target) return

  // Checkpoint 0 is the finish line, and it is judged as a crossing rather than
  // a proximity: the car must pass through the line's plane, travelling forward,
  // somewhere within the width of the road.
  if (car.nextCp === 0) {
    const t = lineTangent(match)
    const dx = car.x - target.x
    const dy = car.y - target.y
    const along = dx * t.x + dy * t.y          // signed: behind the line is negative
    const across = Math.abs(-dx * t.y + dy * t.x)
    const prev = car.lineSide

    car.lineSide = along
    // No previous sample means this is the first tick since a reset; record the
    // side and wait, rather than treating an unknown as a crossing.
    if (prev === undefined || prev === null) return
    if (!(prev < 0 && along >= 0)) return
    if (across > LINE_HALF_SPAN) return
    if (car.cpTaken < ring.length - 1) return

    const lapMs = match.elapsed - car.lapStartedAt
    // A lap only sets a record if it was raced, not if it was the roll off the
    // grid before the clock started.
    if (car.lap > 0 && lapMs > 0 && (car.bestLapMs === null || lapMs < car.bestLapMs)) {
      car.bestLapMs = lapMs
    }
    car.lap += 1
    car.lapStartedAt = match.elapsed
    car.cpTaken = 0
    car.nextCp = 1
    if (car.lap > match.lap) match.lap = car.lap
    return
  }

  if (Math.hypot(car.x - target.x, car.y - target.y) > CHECKPOINT_RADIUS) return

  car.cpTaken += 1
  car.nextCp = (car.nextCp + 1) % ring.length
}

/** The unit tangent of the centerline where the finish line is painted. */
function lineTangent(match) {
  const line = match.centerline
  const a = line[line.length - 1]
  const b = line[1]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

/**
 * Live cars, best first.
 *
 * The HUD needs this for the position display regardless, so the cut costs
 * nothing extra to compute. Ordered by lap, then by checkpoints taken this
 * lap, then by how close the car is to the checkpoint it is chasing.
 */
export function runningOrder(match) {
  return [...match.cars.values()]
    .filter((c) => c.alive)
    .sort((a, b) => {
      if (b.lap !== a.lap) return b.lap - a.lap
      if (b.cpTaken !== a.cpTaken) return b.cpTaken - a.cpTaken
      const at = match.checkpoints[a.nextCp]
      const bt = match.checkpoints[b.nextCp]
      const ad = at ? Math.hypot(a.x - at.x, a.y - at.y) : Infinity
      const bd = bt ? Math.hypot(b.x - bt.x, b.y - bt.y) : Infinity
      return ad - bd
    })
}

/**
 * Eliminations disabled per user instruction: all cars stay alive throughout the race.
 */
export function applyCut(match) {
  return null
}

// --- Slipstream -------------------------------------------------------------
export const SLIP_RANGE = 3.5
export const SLIP_CONE = 0.7         // dot product against the leader's nose

/**
 * The only catch-up mechanic in the game.
 *
 * A car sitting in another's wake gains top speed. This is deliberately the
 * whole of catch-up: the item bag is flat, so nothing is handed to a driver for
 * running last. Slipstream rewards having closed the gap rather than having
 * failed to, which is the studio's position on ranked integrity.
 */
export function updateDraft(match) {
  const cars = [...match.cars.values()]
  for (const car of cars) car.drafting = false

  for (const car of cars) {
    if (!car.alive) continue
    for (const lead of cars) {
      if (lead === car || !lead.alive) continue

      const dx = lead.x - car.x
      const dy = lead.y - car.y
      const d = Math.hypot(dx, dy)
      if (d === 0 || d > SLIP_RANGE) continue

      // The gap must point along the leader's nose: that is what makes this
      // "behind them" rather than "near them".
      const dot = (dx / d) * Math.cos(lead.heading) + (dy / d) * Math.sin(lead.heading)
      if (dot < SLIP_CONE) continue

      car.drafting = true
      break
    }
  }
}

// --- The kit ----------------------------------------------------------------
// A slick used to change only lateral grip, which meant a car pointed where it
// was going felt nothing at all, and a car already sliding kept MORE of its
// slide and came out faster. Oil now also takes away drive and steering: you
// keep every bit of the momentum you arrived with and lose the ability to do
// anything about it, which reads whether you are straight or turning.
// A banana is the opposite trade to a slick. Oil is a puddle that stays put and
// punishes anyone who keeps driving through it; a banana is consumed by the first
// car to touch it and punishes that one car hard. It spins you: heading spirals,
// steering does nothing, drive is nearly gone, and you keep every bit of the
// momentum that carried you in. You are a passenger for SPIN_MS.
export const BANANA_TTL_MS = 12000   // lies around longer than oil, being one use
export const BANANA_RADIUS = 0.8
export const SPIN_MS = 900
export const SPIN_RATE = 9.0         // rad/s, about 1.3 turns before it lets go
export const SPIN_THRUST = 0.1

export const SLICK_THRUST = 0.15     // fraction of throttle that still bites
export const SLICK_TURN = 0.35       // fraction of steering authority left
export const SLICK_TTL_MS = 9000
export const SLICK_RADIUS = 1.1
export const PICKUP_RESPAWN_MS = 6000
export const MAX_HAZARDS = 16
export const DROP_BACK = 1.4         // tiles behind the nose a hazard lands

// Flat by construction. The weighting is in how many copies of each item the
// bag holds, never in who is drawing from it.
// The wall is gone: a near stop is the wrong verb for a game whose handling is
// all momentum and sliding, and it punished whoever hit it more than it rewarded
// whoever dropped it. The bag is deliberately thin until the new kit lands.
export const ITEM_BAG = ['boost', 'boost', 'boost', 'slick', 'slick', 'banana', 'banana']

/** Driving over a pickup tile fills an empty slot and puts that tile on cooldown. */
export function collectPickup(match, car, rng = Math.random) {
  if (!car.alive || car.item) return false

  let hitKey = null
  let bestDist = Infinity
  if (match.pickups && match.pickups.length > 0) {
    for (const p of match.pickups) {
      const d = Math.hypot(car.x - p.x, car.y - p.y)
      if (d <= 1.2 && d < bestDist) {
        bestDist = d
        hitKey = p.key
      }
    }
  }

  if (hitKey === null) {
    const tx = Math.round(car.x)
    const ty = Math.round(car.y)
    if (surfaceAt(match.grid, tx, ty) === S_PICKUP) {
      hitKey = ty * GRID + tx
    }
  }

  if (hitKey === null) return false

  const readyAt = match.pickupCooldown.get(hitKey) ?? 0
  if (match.now < readyAt) return false

  match.pickupCooldown.set(hitKey, match.now + PICKUP_RESPAWN_MS)
  car.item = ITEM_BAG[Math.floor(rng() * ITEM_BAG.length)] ?? ITEM_BAG[0]
  return true
}

/** Spend the held item. Hazards land behind the nose, never under it. */
export function useItem(match, car) {
  if (!car.alive || !car.item) return false

  const item = car.item
  car.item = null

  if (item === 'boost') {
    car.boostUntil = match.now + BOOST_MS
    return true
  }

  const bx = car.x - Math.cos(car.heading) * DROP_BACK
  const by = car.y - Math.sin(car.heading) * DROP_BACK
  const ttl = item === 'banana' ? BANANA_TTL_MS : SLICK_TTL_MS

  match.hazards.push({ kind: item, x: bx, y: by, until: match.now + ttl, by: car.id })
  // Capped rather than unbounded: the snapshot carries this list every tick.
  while (match.hazards.length > MAX_HAZARDS) match.hazards.shift()
  return true
}

export function expireHazards(match) {
  match.hazards = match.hazards.filter((h) => h.until > match.now && !h.spent)
}

/**
 * What the surface and the hazards do to a car this tick.
 *
 * A boost strip sets the same boost window the item does, for STRIP_BOOST_MS
 * rather than BOOST_MS. There is one boost effect in the game and two ways to
 * acquire it, so the strip needs no code path of its own.
 */
export function applyHazards(match, car) {
  if (!car.alive) return

  car.onSlick = false

  if (surfaceAt(match.grid, Math.round(car.x), Math.round(car.y)) === S_BOOST) {
    car.boostUntil = Math.max(car.boostUntil, match.now + STRIP_BOOST_MS)
  }

  for (const h of match.hazards) {
    const d = Math.hypot(car.x - h.x, car.y - h.y)
    if (h.kind === 'banana' && !h.spent && d <= BANANA_RADIUS + CAR_RADIUS) {
      // One use. Marked rather than spliced, because this runs inside a loop over
      // the very list a splice would reindex; expireHazards sweeps it next tick.
      h.spent = true
      car.spinUntil = match.now + SPIN_MS
    } else if (h.kind === 'slick' && d <= SLICK_RADIUS) {
      car.onSlick = true
    }
  }
}

// --- Bots -----------------------------------------------------------------
export const BOT_LOOKAHEAD = 9       // centerline points ahead a bot aims at
export const BOT_BRAKE_ANGLE = 0.5   // rad off the aim point before it lifts
const BOT_REACT_MS = 100

/**
 * Bots steer at a point ahead on the generated racing line.
 *
 * The line costs nothing, because circuit generation already produced it: the
 * same centerline the carve stamped tarmac across is the one the bots follow.
 */
export function driveBots(match) {
  if (match.phase !== 'racing') return

  for (const car of match.cars.values()) {
    if (!car.bot || !car.alive) continue
    if (match.now < (car.botNextAt ?? 0)) continue
    car.botNextAt = match.now + BOT_REACT_MS

    // Aim ahead of the car's own position on the centerline, scaled by how
    // quick this bot is, so the field has a skill spread rather than
    // identical laps. The nearest point has to be the car's own, not the
    // checkpoint's: anchoring to the checkpoint index made the effective
    // lookahead BOT_LOOKAHEAD plus however far the car still was from that
    // checkpoint, which could throw the aim point across a wall the car was
    // still negotiating. A plain scan, not a cached cursor: the line is a
    // couple hundred points, this runs a few times a second per bot, and a
    // cached index buys back the drift and wrap bugs this plan has already
    // paid for twice.
    const line = match.centerline
    let nearest = 0
    let nearestDist = Infinity
    for (let i = 0; i < line.length; i++) {
      const dx = line[i].x - car.x
      const dy = line[i].y - car.y
      const dist = dx * dx + dy * dy
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = i
      }
    }
    const aim = line[(nearest + Math.round(BOT_LOOKAHEAD * car.botSkill)) % line.length]

    let want = Math.atan2(aim.y - car.y, aim.x - car.x) - car.heading
    while (want > Math.PI) want -= Math.PI * 2
    while (want < -Math.PI) want += Math.PI * 2

    car.steer = Math.abs(want) < 0.05 ? 0 : want > 0 ? 1 : -1
    car.throttle = true
    car.brake = Math.abs(want) > BOT_BRAKE_ANGLE
    car.wantsUse = car.item !== null && match.elapsed % 5000 < BOT_REACT_MS
  }
}

// --- Race lifecycle -------------------------------------------------------
/** Put every car back on its slot and drop the flag. */
export function startRace(match) {
  const field = match.cars.size
  match.laps = RACE_LAPS
  match.phase = 'racing'
  match.elapsed = 0
  match.lap = 0
  match.hazards = []
  match.pickupCooldown = new Map()
  match.cut = null
  match.winner = null
  match.final = false

  let slot = 0
  for (const car of match.cars.values()) {
    const start = match.startSlots[slot++ % MAX_PLAYERS]
    car.x = start.x
    car.y = start.y
    car.heading = start.heading
    car.vx = 0
    car.vy = 0
    car.lap = 0
    car.nextCp = 1
    car.cpTaken = 0
    car.alive = true
    car.finishedAt = null
    car.item = null
    car.boostUntil = 0
    car.spinUntil = 0
    car.lineSide = undefined
    car.bestLapMs = null
    car.lapStartedAt = 0
    car.steer = 0
    car.throttle = false
    car.brake = false
    car.wantsUse = false
  }
}

/**
 * One tick of the whole match.
 *
 * dt arrives from the wrapper; this module has no clock of its own, which is
 * what keeps it pure and what lets every test run a race in microseconds.
 */
export function tick(match, dtMs = TICK_MS, rng = Math.random) {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, TICK_MS * 5) : 0
  if (dt === 0) return

  match.now += dt

  // Fill the grid with bots when a lone driver has asked for them, or when the
  // server is set to run bots on its own.
  const humans = [...match.cars.values()].filter((c) => !c.bot).length
  const wantsBots = match.botsOnly || (match.botsWanted && humans > 0)
  if (match.phase === 'waiting' && wantsBots) {
    while (match.cars.size < Math.min(match.botFill, MAX_PLAYERS)) {
      const name = BOT_NAMES[match.cars.size % BOT_NAMES.length]
      if (!join(match, { name, bot: true }, rng)) break
    }
  }

  if (match.phase === 'waiting') {
    if (match.cars.size >= MIN_PLAYERS) {
      match.phase = 'countdown'
      match.countdown = COUNTDOWN_MS
    }
    return
  }

  if (match.phase === 'countdown') {
    match.countdown -= dt
    if (match.countdown <= 0) startRace(match)
    return
  }

  if (match.phase === 'over') {
    return
  }

  // --- racing ---
  match.elapsed += dt
  const seconds = dt / 1000

  driveBots(match)
  expireHazards(match)

  const leaderLapBefore = match.lap

  for (const car of match.cars.values()) {
    if (!car.alive) continue
    applyHazards(match, car)
    if (car.wantsUse) {
      useItem(match, car)
      car.wantsUse = false
    }
    stepCar(match, car, seconds)
    collectPickup(match, car, rng)
    updateProgress(match, car)
  }

  resolveContact(match)
  updateDraft(match)

  // Eliminations disabled: cars remain alive.
  if (match.lap > leaderLapBefore) applyCut(match)

  const order = runningOrder(match)
  if (order[0] && order[0].lap >= match.laps) {
    match.winner = order[0]?.id ?? null
    match.phase = 'over'
    match.final = true
    match.overSince = match.now
  }
}

// --- Snapshot -------------------------------------------------------------
/**
 * The whole visible state, every tick, never a diff.
 *
 * The track is not here: it is static and ships once in welcome, the way Void
 * Drillers ships its shaft. That is what keeps this frame under a kilobyte at
 * 60 Hz. The centerline is not here either, because the racing line is the
 * server's business and a client that knew it could drive it perfectly.
 */
export function snapshot(match) {
  const order = runningOrder(match)
  const place = new Map(order.map((c, i) => [c.id, i + 1]))

  const cars = []
  for (const car of match.cars.values()) {
    cars.push({
      id: car.id,
      name: car.name,
      slot: car.slot,
      bot: car.bot,
      x: Math.round(car.x * 100) / 100,
      y: Math.round(car.y * 100) / 100,
      heading: Math.round(car.heading * 1000) / 1000,
      lap: car.lap,
      alive: car.alive,
      item: car.item,
      place: place.get(car.id) ?? null,
      drafting: Boolean(car.drafting),
      boosting: match.now < car.boostUntil,
      sliding: Boolean(car.onSlick),
      spinning: match.now < (car.spinUntil ?? 0),
      // The page turns the front wheels by `steer` and lights the brake lamps by
      // `brake`. Both are held input the server already owns, and without them on
      // the wire the page silently drew straight wheels and dark lamps forever,
      // because an absent field reads as a falsy one.
      steer: car.steer ?? 0,
      brake: Boolean(car.brake),
      bestLapMs: car.bestLapMs,
    })
  }

  const activePickups = []
  if (match.pickups) {
    for (const p of match.pickups) {
      const readyAt = match.pickupCooldown.get(p.key) ?? 0
      if (match.now >= readyAt) {
        activePickups.push({ x: p.x, y: p.y })
      }
    }
  }

  return {
    t: 'state',
    phase: match.phase,
    now: match.now,
    elapsed: match.elapsed,
    countdown: Math.max(0, Math.ceil(match.countdown / 1000)),
    lap: match.lap,
    laps: match.laps,
    circuit: match.circuit.name,
    cars,
    hazards: match.hazards,
    pickups: activePickups,
    order: order.map((c) => c.id),
    cut: match.cut,
    winner: match.winner,
    final: match.final,
    board: match.board,
  }
}
