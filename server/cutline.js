// Rules for one Cutline race. Pure: zero external imports, zero Node APIs,
// zero sockets, zero timers, zero I/O. Everything here is exercised by
// cutline.test.js.

// --- Dimensions -----------------------------------------------------------
export const GRID = 96               // square, the circuit is carved out of it
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
  { name: 'Foundry Loop', seed: 1134 },  // lap 389, straight 51, tightest 0.6, turns 8, chicanes 4, shortcuts 1
  { name: 'Coolant Bend', seed: 1069 },  // lap 206, straight 23, tightest 0.45, turns 3, chicanes 0, shortcuts 0
  { name: 'The Spindle', seed: 1219 },  // lap 286, straight 25, tightest 0.6, turns 10, chicanes 2, shortcuts 0
  { name: 'Slag Pit', seed: 1150 },  // lap 316, straight 53, tightest 0.6, turns 4, chicanes 0, shortcuts 0
  { name: 'Draw Bench', seed: 1112 },  // lap 339, straight 45, tightest 0.45, turns 4, chicanes 0, shortcuts 0
  { name: 'Cinder Yard', seed: 1385 },  // lap 359, straight 18, tightest 0.6, turns 10, chicanes 0, shortcuts 1
  { name: 'Ladle Row', seed: 1015 },  // lap 239, straight 39, tightest 0.6, turns 6, chicanes 6, shortcuts 0
  { name: 'Tap Hole', seed: 1297 },  // lap 338, straight 38, tightest 0.45, turns 10, chicanes 4, shortcuts 1
]

// --- Lattice --------------------------------------------------------------
// A circuit is a closed cycle on a coarse lattice, smoothed into real corners.
// The harmonic curve this replaces was single valued in angle, so it always
// bent around the grid centre: every corner turned the same way and curvature
// was global, which is why every circuit read as the same deformed circle.
export const MIN_WALL = 3
export const SEGMENT_WIDTH_MAX = 11
export const SEGMENT_WIDTH_MIN = 7
// Width may not step. A one tile ledge mid corner catches a wheel and reads as
// a collision bug rather than as geometry.
export const WIDTH_RAMP_PER_POINT = 0.25
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

  // Chicanes: a tight corner immediately followed by a tight corner the other
  // way is one feature, not two. Marked so width and the carve can treat it as
  // a unit, and so a test can assert circuits contain them.
  for (let i = 0; i < meta.length; i++) {
    const a = meta[i]
    const b = meta[(i + 1) % meta.length]
    if (a.corner === 'tight' && b.corner === 'tight' && a.sign !== 0 && b.sign !== 0 && a.sign !== b.sign) {
      a.corner = 'chicane'
      b.corner = 'chicane'
    }
  }

  // Target width per point: wide on a straight so there is room to out brake
  // somebody, narrow through anything technical.
  const target = meta.map((m) => {
    if (m.corner === null) return SEGMENT_WIDTH_MAX
    if (m.corner === 'chicane' || m.corner === 'hairpin') return SEGMENT_WIDTH_MIN
    if (m.corner === 'tight') return SEGMENT_WIDTH_MIN + 2
    return SEGMENT_WIDTH_MIN + 3
  })

  // Ramp toward the target rather than stepping to it. Two passes, forward then
  // backward, so a narrow stretch is approached from both sides.
  const width = target.slice()
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < width.length; n++) {
      const i = pass === 0 ? n : width.length - 1 - n
      const j = pass === 0 ? (i - 1 + width.length) % width.length : (i + 1) % width.length
      const limit = width[j] + (width[i] > width[j] ? WIDTH_RAMP_PER_POINT : -WIDTH_RAMP_PER_POINT)
      if (Math.abs(width[i] - width[j]) > WIDTH_RAMP_PER_POINT) width[i] = limit
    }
  }
  for (let i = 0; i < meta.length; i++) {
    meta[i].width = Math.max(SEGMENT_WIDTH_MIN, Math.min(SEGMENT_WIDTH_MAX, width[i]))
  }

  return { centerline, meta }
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
// A hole past a ramp's lip, across the whole road. A car that drives into it
// rather than flying it falls, and is set down past it after FALL_MS.
export const S_HOLE = 9

export const SURFACE_CHARS = ['W', 'T', 'K', 'B', 'O', 'P', 'L', 'G', 'R', 'H']

// A hole spans these rows ahead of its ramp's middle tile, whose lip is half a
// tile ahead: one row of road, then the hole, then road to land on.
export const HOLE_FROM = 2
export const HOLE_TO = 4
// Where a car that fell is set down, in tiles ahead of the ramp.
const HOLE_EXIT = HOLE_TO + 3
export const FALL_MS = 1500

// Wall-jump pads. A pad's flight is PAD_FLIGHT_MIN to PAD_FLIGHT_MAX tiles past
// its lip, the same at any speed, and it must skip at least PAD_SKIP_MIN points
// of the lap and no more than PAD_SKIP_MAX of it: a corner complex, not the lap.
const PAD_SEARCH = 24          // tiles straight on from a corner to look for its wall
const PAD_PULL_BACK = 10       // tiles a pad may sit back from that wall to fit the road
export const PAD_FLIGHT_MIN = 6
export const PAD_FLIGHT_MAX = 14
const PAD_SKIP_MIN = 20
const PAD_SKIP_MAX = 0.25
// A pad launches only a car driving at it, within this of its facing (cos 30).
const PAD_ALIGN = Math.cos(Math.PI / 6)

export const GRAVEL_DRAG = 3.0       // scrubs speed without stopping the car
export const GRAVEL_DEPTH = 3        // tiles of run off outside a corner
// How far along the lap, in centre-line points, ground still counts as the same
// corner. Run off may touch that ground and nothing further round the lap.
export const RUNOFF_OWN_SPAN = Math.ceil(SEGMENT_WIDTH_MAX / POINT_SPACING)

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

export const PICKUP_MIN_SPACING = 16
export const PICKUP_RANDOM_SPACING = 16
const START_ROW_GAP = 2              // centerline points between starting rows
const LANE_GAP = 1.5                 // tiles between cars across the road
// Pickups land as a rank across the road rather than one dot on the centerline,
// so meeting a row is a choice of lane instead of a choice of whether to bother.
export const PICKUP_ROW = 4

// A shortcut is a chord across the cycle: shorter than the trunk between the
// same two points, and narrower, so it costs control to save distance.
export const SHORTCUT_CHANCE = 0.5   // per circuit, from the decoration stream
export const SHORTCUT_WIDTH = 5
// Candidate chords tried, shortest first, before a circuit goes without one.
export const SHORTCUT_TRIES = 40

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
 * Points are POINT_SPACING apart and the track is SEGMENT_WIDTH_MAX wide, so most
 * consecutive stamps already overlap, but on a tight corner the outer rail
 * travels further per index than the centerline does, so two consecutive
 * stamps on it can round tiles apart. walkLine's rasterized, elbow-aware
 * segment is what keeps every rail, seam included, 4-connected to itself
 * regardless of how far a corner pushes two samples apart.
 *
 * Exported so the bridging can be exercised directly against a synthetic
 * centerline, not only against the eight fixed seeds in CIRCUITS.
 */
export function stampTrack(grid, centerline, width = SEGMENT_WIDTH_MAX) {
  const half = Math.round(width / 2)
  const railAt = (i, off) => {
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    return { x: p.x - t.y * off, y: p.y + t.x * off }
  }

  for (let i = 0; i < centerline.length; i++) {
    const next = (i + 1) % centerline.length
    for (let off = -half; off <= half; off++) {
      const edge = Math.abs(off) === half
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
  const { centerline, meta } = buildCenterline(seed)
  const grid = new Uint8Array(GRID * GRID)
  const rng = createRng(seed ^ 0x9e3779b9)

  const put = (x, y, surface) => putTile(grid, x, y, surface)

  // 1. Racing surface, at each point's own width. stampTrack walks the closed
  //    set of adjacent pairs including the wrap, so rails stay 4-connected.
  for (let i = 0; i < centerline.length; i++) {
    const half = Math.round(meta[i].width / 2)
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    const q = centerline[(i + 1) % centerline.length]
    const tq = tangentAt(centerline, (i + 1) % centerline.length)
    for (let off = -half; off <= half; off++) {
      const edge = Math.abs(off) === half
      const surface = edge ? S_KERB : S_TARMAC
      walkLine(
        Math.round(p.x - t.y * off),
        Math.round(p.y + t.x * off),
        Math.round(q.x - tq.y * off),
        Math.round(q.y + tq.x * off),
        (x, y) => put(x, y, surface),
      )
    }
  }

  // 2. Run off outside fast corners. Gravel replaces wall, never tarmac, so a
  //    car that runs wide loses time instead of its race.
  //
  //    Gravel never touches ground that belongs to another part of the lap.
  //    Parallel stretches sit MIN_WALL apart and run off digs GRAVEL_DEPTH in,
  //    so without this it ate the whole wall on every circuit and left gravel
  //    bridges that skipped up to half a lap. A car that took one missed its
  //    checkpoints, and its lap did not count at the line.
  const n = centerline.length
  const owner = new Int32Array(GRID * GRID).fill(-1)
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (grid[y * GRID + x] === S_WALL) continue
      let best = 0
      let bd = Infinity
      for (let i = 0; i < n; i++) {
        const d = (centerline[i].x - x) ** 2 + (centerline[i].y - y) ** 2
        if (d < bd) {
          bd = d
          best = i
        }
      }
      owner[y * GRID + x] = best
    }
  }
  const lapGap = (a, b) => Math.min((a - b + n) % n, (b - a + n) % n)
  const touchesAnotherPart = (x, y, i) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ox = x + dx
        const oy = y + dy
        if (ox < 0 || oy < 0 || ox >= GRID || oy >= GRID) continue
        const o = owner[oy * GRID + ox]
        if (o >= 0 && lapGap(o, i) > RUNOFF_OWN_SPAN) return true
      }
    }
    return false
  }
  for (let i = 0; i < centerline.length; i++) {
    const m = meta[i]
    if (m.corner === null || m.corner === 'sweeper') continue
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    const half = Math.round(m.width / 2)
    const side = m.sign > 0 ? -1 : 1
    const x0 = Math.round(p.x - t.y * half * side)
    const y0 = Math.round(p.y + t.x * half * side)
    const x1 = Math.round(p.x - t.y * (half + GRAVEL_DEPTH) * side)
    const y1 = Math.round(p.y + t.x * (half + GRAVEL_DEPTH) * side)
    walkLine(x0, y0, x1, y1, (x, y) => {
      if (surfaceAt(grid, x, y) !== S_WALL || touchesAnotherPart(x, y, i)) return
      put(x, y, S_GRAVEL)
      owner[y * GRID + x] = i
    })
  }
  // Refused tiles leave the edge jagged, with one-tile fingers into the wall. A
  // car that drove into one faced the wall with nowhere to go, so run off with
  // fewer than two ways out goes back to wall, until none is left.
  for (let trimmed = true; trimmed; ) {
    trimmed = false
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (grid[y * GRID + x] !== S_GRAVEL) continue
        let ways = 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (surfaceAt(grid, x + dx, y + dy) !== S_WALL) ways++
        }
        if (ways >= 2) continue
        put(x, y, S_WALL)
        owner[y * GRID + x] = -1
        trimmed = true
      }
    }
  }

  // 3. Decorate. Boost on straights, oil on corner exits, ramps on long straights.
  //    Ramp strips are also remembered, because the grid says where a ramp is
  //    but not which way it faces; `rampRuns` turns them into the list the page
  //    draws once every later stage has stamped the grid.
  const rampStrips = []
  for (let i = 0; i < centerline.length; i++) {
    const m = meta[i]
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    let surface = null
    if (m.corner === null && rng() < 0.04) surface = S_BOOST
    else if (m.corner === null && rng() < 0.02) surface = S_RAMP
    else if (meta[(i - 6 + meta.length) % meta.length].corner === 'hairpin' && rng() < 0.05) surface = S_OIL
    if (!surface) continue
    const half = Math.round(m.width / 2) - 1
    for (let off = -half; off <= half; off++) {
      put(p.x - t.y * off, p.y + t.x * off, surface)
    }
    if (surface === S_RAMP) rampStrips.push({ p, t, half, index: i })
  }

  // 4. Pickup ranks, spread to the local width.
  const pickups = []
  const seen = new Set()
  let nextPickup = 14 + Math.floor(rng() * 8)
  for (let i = 0; i < centerline.length - 14; i++) {
    if (i < nextPickup) continue
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    const laneGap = Math.max(1, (meta[i].width - 2) / PICKUP_ROW)
    for (let lane = 0; lane < PICKUP_ROW; lane++) {
      const off = (lane - (PICKUP_ROW - 1) / 2) * laneGap
      const px = Math.round(p.x - t.y * off)
      const py = Math.round(p.y + t.x * off)
      const key = py * GRID + px
      if (seen.has(key)) continue
      if (surfaceAt(grid, px, py) === S_WALL) continue
      seen.add(key)
      put(px, py, S_PICKUP)
      pickups.push({ x: px, y: py, key })
    }
    nextPickup = i + PICKUP_MIN_SPACING + Math.floor(rng() * PICKUP_RANDOM_SPACING)
  }

  // 5. The finish line, across the full local width at the chosen start index.
  const startIndex = pickStartIndex(meta)
  {
    const p = centerline[startIndex]
    const t = tangentAt(centerline, startIndex)
    const half = Math.round(meta[startIndex].width / 2) - 1
    for (let off = -half; off <= half; off++) {
      put(p.x - t.y * off, p.y + t.x * off, S_LINE)
    }
  }

  // 6. Checkpoints, evenly spaced from the start index.
  const checkpoints = []
  for (let c = 0; c < CHECKPOINT_COUNT; c++) {
    const index = (startIndex + Math.floor((c * centerline.length) / CHECKPOINT_COUNT)) % centerline.length
    checkpoints.push({ index, x: centerline[index].x, y: centerline[index].y })
  }

  // 7. Starting slots, back from the line and always on a straight.
  const startSlots = []
  for (let row = 0; row < START_ROWS; row++) {
    const index = (startIndex - (row + 1) * START_ROW_GAP + centerline.length) % centerline.length
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

  // 7b. Every ramp must set a car down on the road at any speed it can launch
  //     at; one whose jump could end in a wall is taken out, or a boosted car
  //     would land inside it. Then every other ramp left, clear of checkpoints
  //     and the grid, gets a hole past its lip, so it has to be jumped.
  const holes = []
  for (const strip of rampStrips) {
    if (rampLandsClear(grid, strip)) continue
    forEachStripTile(strip, (x, y) => {
      if (surfaceAt(grid, x, y) === S_RAMP) put(x, y, S_TARMAC)
    })
    strip.removed = true
  }
  // A fall skips HOLE_EXIT - HOLE_FROM tiles of road, far less than a
  // checkpoint circle is across, so a checkpoint is always reached before the
  // fall or after it, and a fall across the finish line still counts it as
  // crossed. Only the starting grid must be clear, or a car starts in a hole.
  const clearOfCourse = (x, y) => startSlots.every((s) => Math.hypot(s.x - x, s.y - y) > HOLE_TO + 2)
  let holeTurn = 0
  for (const strip of rampStrips) {
    if (strip.removed) continue
    let intact = true
    forEachStripTile(strip, (x, y) => {
      if (surfaceAt(grid, x, y) !== S_RAMP) intact = false
    })
    const far = { x: strip.p.x + strip.t.x * HOLE_EXIT, y: strip.p.y + strip.t.y * HOLE_EXIT }
    if (!intact || !clearOfCourse(strip.p.x, strip.p.y) || !clearOfCourse(far.x, far.y)) continue
    // Every other one: half the ramps are for show and speed, half must be used.
    if (holeTurn++ % 2 === 1) continue
    const trial = grid.slice()
    digHole(trial, strip, (x, y, i) => lapGap(owner[y * GRID + x], i) <= RUNOFF_OWN_SPAN || owner[y * GRID + x] < 0)
    // Every ramp, not just this one: a boosted jump off the ramp before can
    // reach this hole.
    if (!rampStrips.every((r) => r.removed || rampLandsClear(trial, r))) continue
    grid.set(trial)
    const mid = middleTile(strip)
    holes.push({ x: mid.x, y: mid.y, heading: Math.atan2(strip.t.y, strip.t.x), width: 2 * strip.half + 1, index: strip.index })
  }
  // No box floats over a hole.
  for (let i = pickups.length - 1; i >= 0; i--) {
    if (grid[pickups[i].key] === S_HOLE) pickups.splice(i, 1)
  }

  // 7c. A wall-jump pad, at most one: at the outside of a corner, facing the
  //     wall, so a car that drives straight at it instead of turning is thrown
  //     over the wall onto a later stretch. A pad's flight is exact, the same
  //     distance at any speed, so every lane is checked to land on that stretch.
  //     The checkpoints it flies past are credited on touchdown, so the jump is
  //     a route of its own; the finish line is never jumped.
  const jumps = []
  {
    const ahead = (i, j) => (j - i + n) % n
    const plain = (s) => s === S_TARMAC || s === S_KERB || s === S_GRAVEL
    let best = null
    for (let i = 3; i < n; i++) {
      if (meta[i].corner === null || meta[i - 1].corner !== null) continue
      const t = tangentAt(centerline, (i - 3 + n) % n)
      let wallAt = null
      for (let s = 0; s < PAD_SEARCH && wallAt === null; s++) {
        if (surfaceAt(grid, Math.round(centerline[i].x + t.x * s), Math.round(centerline[i].y + t.y * s)) === S_WALL) wallAt = s
      }
      if (wallAt === null) continue
      const half = Math.round(meta[i].width / 2) - 1
      for (let s = wallAt - 1; s >= wallAt - PAD_PULL_BACK; s--) {
        const q = { x: Math.round(centerline[i].x + t.x * s), y: Math.round(centerline[i].y + t.y * s) }
        const strip = { p: q, t, half, index: i, pad: true }
        let fits = true
        forEachStripTile(strip, (x, y) => {
          const a = ahead(i, owner[y * GRID + x])
          if (!plain(surfaceAt(grid, x, y)) || owner[y * GRID + x] < 0 || (a > 40 && a < n - 5)) fits = false
        })
        if (!fits) continue
        for (let D = PAD_FLIGHT_MIN; D <= PAD_FLIGHT_MAX; D++) {
          const pad = padLanding(grid, owner, centerline, strip, D)
          if (!pad) continue
          const lo = Math.min(...pad.js.map((j) => ahead(i, j)))
          const hi = Math.max(...pad.js.map((j) => ahead(i, j)))
          if (lo < PAD_SKIP_MIN || hi > n * PAD_SKIP_MAX) continue
          const skipped = checkpoints.map((cp, k) => ({ k, a: ahead(i, cp.index) })).filter(({ a }) => a > 0 && a < lo)
          if (skipped.some(({ k }) => k === 0)) continue
          if (best && hi >= best.hi) continue
          best = { strip, D, hi, land: pad.land, credits: skipped.sort((u, v) => u.a - v.a).map(({ k }) => k) }
        }
      }
    }
    if (best) {
      forEachStripTile(best.strip, (x, y) => put(x, y, S_RAMP))
      rampStrips.push(best.strip)
      const { p, t, half } = best.strip
      jumps.push({ x: p.x, y: p.y, heading: Math.atan2(t.y, t.x), width: 2 * half + 1, distance: best.D, land: best.land, credits: best.credits })
    }
  }

  // 8. Shortcuts. A chord between two points far apart along the lap but close
  //    in space. Checkpoints are placed in stage 6 from startIndex, so the chord
  //    is chosen to skip a stretch that contains none: both routes then pass
  //    every checkpoint and the ring never learns a branch exists.
  //
  //    Skipping none is not enough on its own. Draw Bench's best chord started
  //    exactly on checkpoint 1, and a car could slip into it beside the circle
  //    rather than through it, so its lap never counted. So each candidate is
  //    carved into a copy and kept only if no checkpoint can be driven round,
  //    best first; one that fails is refused, not repaired.
  const shortcuts = []
  if (rng() < SHORTCUT_CHANCE) {
    const cpIndices = checkpoints.map((c) => c.index)
    const skipsACheckpoint = (from, to) =>
      cpIndices.some((ci) => (from < to ? ci > from && ci < to : ci > from || ci < to))

    const candidates = []
    for (let a = 0; a < n; a += 2) {
      for (let b = a + Math.max(8, Math.floor(n * 0.05)); b < a + Math.floor(n * 0.4); b += 2) {
        const to = b % n
        if (skipsACheckpoint(a, to)) continue
        const d = Math.hypot(centerline[a].x - centerline[to].x, centerline[a].y - centerline[to].y)
        const along = (to - a + n) % n
        // Worth cutting only if the straight line is much shorter than the road.
        if (d > along * 0.55) continue
        candidates.push({ from: a, to, d })
      }
    }
    // Stable, so equal lengths keep the order the scan found them in.
    candidates.sort((p, q) => p.d - q.d)

    for (const c of candidates.slice(0, SHORTCUT_TRIES)) {
      const trial = grid.slice()
      const points = stampChord(trial, centerline[c.from], centerline[c.to], c.d)
      if (checkpointCanBeDrivenRound(trial, checkpoints)) continue
      grid.set(trial)
      shortcuts.push({ fromIndex: c.from, toIndex: c.to, points })
      break
    }
  }

  return { grid, centerline, meta, checkpoints, startSlots, pickups, shortcuts, holes, jumps, ramps: rampRuns(grid, rampStrips) }
}

/** A ramp strip's middle tile: where the page centres its wedge. */
function middleTile(strip) {
  return { x: Math.round(strip.p.x), y: Math.round(strip.p.y) }
}

/** Every tile of a ramp strip, in order across the road. */
function forEachStripTile(strip, fn) {
  for (let off = -strip.half; off <= strip.half; off++) {
    fn(Math.round(strip.p.x - strip.t.y * off), Math.round(strip.p.y + strip.t.x * off))
  }
}

/**
 * Whether a jump off this ramp lands on the road in every lane, at every speed a
 * car can launch at, from the slowest that launches to boosted in a slipstream. A flight is measured from the lip, half a tile ahead of the
 * middle tile, because the rules renew it on every tick a car is on the ramp.
 */
function rampLandsClear(target, strip) {
  const mid = middleTile(strip)
  const { t } = strip
  // Every half tile of landing distance from the slowest launch to the fastest,
  // so a wall between two sampled speeds cannot hide.
  const fastest = TOP_SPEED * BOOST_MULT * SLIP_BOOST
  for (let v = RAMP_MIN_SPEED; v < fastest + 0.5 / (AIR_MS / 1000); v += 0.5 / (AIR_MS / 1000)) {
    const d = 0.5 + (Math.min(v, fastest) * AIR_MS) / 1000
    for (let lane = -strip.half; lane <= strip.half; lane++) {
      const at = surfaceAt(target, Math.round(mid.x + t.x * d - t.y * lane), Math.round(mid.y + t.y * d + t.x * lane))
      if (at === S_WALL || at === S_HOLE) return false
    }
  }
  return true
}

/**
 * Where a pad strip set `D` tiles past its lip would land each lane, if every
 * lane comes down on one later stretch: on the road a tile in from its edges,
 * along a stretch running the same way in every lane and not back toward the
 * pad, and with at least one wall crossed on the way, or it is only a ramp.
 * Returns the landing in the middle lane and the stretch's centre-line indices.
 */
function padLanding(grid, owner, centerline, strip, D) {
  const { p, t, half } = strip
  const js = []
  let first = null
  let crossesWall = false
  for (let lane = -half; lane <= half; lane++) {
    const at = (d) => ({ x: Math.round(p.x + t.x * d - t.y * lane), y: Math.round(p.y + t.y * d + t.x * lane) })
    const L = at(0.5 + D)
    for (const k of [-1, 0, 1]) {
      const s = surfaceAt(grid, Math.round(L.x + t.x * k), Math.round(L.y + t.y * k))
      if (s === S_WALL || s === S_HOLE || s === S_RAMP) return null
    }
    const j = owner[L.y * GRID + L.x]
    if (j < 0) return null
    const tj = tangentAt(centerline, j)
    first = first ?? tj
    if (tj.x * first.x + tj.y * first.y < 0.85 || tj.x * t.x + tj.y * t.y < -0.3) return null
    for (let k = 1; k < D; k++) {
      const w = at(0.5 + k)
      if (surfaceAt(grid, w.x, w.y) === S_WALL) crossesWall = true
    }
    js.push(j)
  }
  if (!crossesWall) return null
  const mid = { x: p.x + t.x * (0.5 + D), y: p.y + t.y * (0.5 + D) }
  return { js, land: { x: mid.x, y: mid.y, heading: Math.atan2(first.y, first.x) } }
}

/**
 * A hole across the whole road past a ramp: rows HOLE_FROM to HOLE_TO ahead of
 * its middle tile, every drivable tile across that `ownGround` says belongs to
 * this stretch, so no edge is left to drive round it.
 */
function digHole(target, strip, ownGround) {
  const mid = middleTile(strip)
  const { t } = strip
  const reach = strip.half + 2 + GRAVEL_DEPTH
  for (let d = HOLE_FROM; d <= HOLE_TO; d++) {
    for (let off = -reach; off <= reach; off++) {
      const x = Math.round(mid.x + t.x * d - t.y * off)
      const y = Math.round(mid.y + t.y * d + t.x * off)
      if (surfaceAt(target, x, y) === S_WALL || !ownGround(x, y, strip.index)) continue
      putTile(target, x, y, S_HOLE)
    }
  }
}

/** Carve a shortcut chord from `from` to `to` into `target`, over wall and run off only. */
function stampChord(target, from, to, length) {
  const steps = Math.max(2, Math.round(length))
  const points = []
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
  }

  const half = Math.floor(SHORTCUT_WIDTH / 2)
  for (let s = 0; s < points.length - 1; s++) {
    const p = points[s]
    const q = points[s + 1]
    const dx = q.x - p.x
    const dy = q.y - p.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    for (let off = -half; off <= half; off++) {
      walkLine(
        Math.round(p.x + nx * off),
        Math.round(p.y + ny * off),
        Math.round(q.x + nx * off),
        Math.round(q.y + ny * off),
        (x, y) => {
          // Never overwrite the racing surface, only wall and run off.
          const at = surfaceAt(target, x, y)
          if (at === S_WALL || at === S_GRAVEL) putTile(target, x, y, Math.abs(off) === half ? S_KERB : S_TARMAC)
        },
      )
    }
  }
  return points
}

/**
 * True if some checkpoint k can be skipped: a car could get from k-1 to k+1
 * without entering k's circle. Circles k and k-2 are walled off, which cuts the
 * loop in two, and a flood fill from k-1 over drivable ground must not reach
 * k+1. Flood fill is 4-way because a car cannot squeeze between two walls that
 * touch only at a corner.
 */
function checkpointCanBeDrivenRound(grid, checkpoints) {
  const n = checkpoints.length
  const seen = new Uint8Array(GRID * GRID)
  for (let k = 0; k < n; k++) {
    const walls = [checkpoints[k], checkpoints[(k - 2 + n) % n]]
    const from = checkpoints[(k - 1 + n) % n]
    const to = checkpoints[(k + 1) % n]
    seen.fill(0)
    const start = Math.round(from.y) * GRID + Math.round(from.x)
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const c = stack.pop()
      const x = c % GRID
      const y = (c - x) / GRID
      if (Math.hypot(x - to.x, y - to.y) < 1.5) return true
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue
        const id = ny * GRID + nx
        if (seen[id] || grid[id] === S_WALL) continue
        if (walls.some((w) => Math.hypot(nx - w.x, ny - w.y) <= CHECKPOINT_RADIUS)) continue
        seen[id] = 1
        stack.push(id)
      }
    }
  }
  return false
}

/**
 * The ramps the page draws, read from the finished grid. Later stages lay
 * pickup pads over some ramp tiles, and a wedge drawn over a pad lifts a car
 * the rules never launch, so each strip becomes one entry per unbroken run of
 * tiles that are still ramps. Each entry is centred on its tiles, not on the
 * raw centre-line point, so the wedge covers exactly the tiles that launch.
 */
function rampRuns(grid, strips) {
  const ramps = []
  for (const strip of strips) {
    const { p, t, half } = strip
    const heading = Math.atan2(t.y, t.x)
    let run = []
    const flush = () => {
      if (run.length) {
        const a = run[0]
        const b = run[run.length - 1]
        ramps.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, heading, width: run.length, ...(strip.pad && { pad: true }) })
      }
      run = []
    }
    // The same tiles stage 3 stamped, in order across the road.
    for (let off = -half; off <= half; off++) {
      const x = Math.round(p.x - t.y * off)
      const y = Math.round(p.y + t.x * off)
      if (surfaceAt(grid, x, y) === S_RAMP) run.push({ x, y })
      else flush()
    }
    flush()
  }
  return ramps
}

/** Everything about a circuit that distinguishes it from another one. */
export function measureCircuit(seed) {
  const { centerline, meta, shortcuts } = carve(seed)
  let longestStraight = 0
  let run = 0
  let directionChanges = 0
  let lastSign = 0
  let chicanes = 0
  let tightest = 0
  let widthSum = 0

  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]
    widthSum += m.width
    if (m.corner === null) {
      run++
      if (run > longestStraight) longestStraight = run
    } else {
      run = 0
      const spec = CORNERS.find((c) => c.name === m.corner)
      if (spec && spec.rad > tightest) tightest = spec.rad
      if (m.corner === 'chicane') chicanes++
      if (m.sign !== 0) {
        if (lastSign !== 0 && m.sign !== lastSign) directionChanges++
        lastSign = m.sign
      }
    }
  }

  return {
    lapLength: centerline.length,
    longestStraight,
    tightestCorner: tightest,
    directionChanges,
    chicanes,
    shortcuts: (shortcuts ?? []).length,
    meanWidth: Math.round((widthSum / meta.length) * 100) / 100,
  }
}

/**
 * Where the finish line goes: the middle of the longest straight, so the grid
 * sits on a straight and the run to the flag is a straight rather than a corner.
 */
function pickStartIndex(meta) {
  let bestStart = 0
  let bestLen = 0
  let runStart = 0
  let run = 0
  for (let i = 0; i < meta.length * 2; i++) {
    const m = meta[i % meta.length]
    if (m.corner === null) {
      if (run === 0) runStart = i
      run++
      if (run > bestLen) {
        bestLen = run
        bestStart = runStart
      }
    } else {
      run = 0
    }
  }
  // Far enough into the straight that the whole starting grid fits behind it.
  const need = START_ROWS * START_ROW_GAP + 2
  return (bestStart + Math.max(need, Math.floor(bestLen / 2))) % meta.length
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
// Client interpolation window. Long enough to span the longest gap between
// snapshots, 31 ms on a Windows timer, plus jitter; every ms more is delay on
// your own car. Measured: from 30 ms up, no frame freezes at that rhythm.
export const DELAY_MS = 40

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
  const { grid, centerline, meta, checkpoints, startSlots, pickups, shortcuts, ramps, holes, jumps } = carve(circuit.seed)

  return {
    circuit,
    circuitIndex,
    grid,
    centerline,
    meta,
    checkpoints,
    startSlots,
    pickups: pickups ?? [],
    shortcuts: shortcuts ?? [],
    ramps: ramps ?? [],
    holes: holes ?? [],
    jumps: jumps ?? [],
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
    steerNow: 0,
    drift: false,
    driftDir: 0,
    driftChain: 0,
    driftScore: 0,
    driftEnd: null,
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
export const ACCEL = 17.0            // thrust from a standstill
export const ACCEL_FADE = 0.56       // fraction of that thrust gone at the speed cap
export const BRAKE = 11.0            // top speed to a stop in about a second
export const DRAG = 0.5              // low, so a lifted car rolls on
export const TURN_RATE = 3.2         // rad/s at low speed
export const TURN_FALLOFF = 0.45     // fraction of turn rate lost at top speed
export const STEER_IN = 0.15         // seconds from centre to full lock
export const STEER_OUT = 0.08        // seconds from full lock back to centre

// Grip fades with speed, so a fast corner pushes wide unless the driver lifts.
export const GRIP_FALLOFF = 0.35     // fraction of lateral grip gone at top speed, on the throttle
export const LIFT_GRIP = 0.4         // fraction of that loss still felt off the throttle

export const OFFTRACK_CAP = 6.5
export const OFFTRACK_DRAG = 6.0
// A wall hit splits velocity into the part into the wall and the part along it.
export const WALL_BOUNCE = 0.15      // fraction of the into-wall speed that comes back out
export const WALL_SCRUB = 0.25       // along-wall speed lost per unit of impact
export const WALL_ALIGN = 0.5        // fraction of the gap to the wall's line a glancing hit turns the nose
export const WALL_GLANCE = 0.7       // impact above which a hit is square on and turns nothing
export const CAR_BOUNCE = 0.3        // restitution between two cars of equal mass

// --- Drift -----------------------------------------------------------------
// Shift and a steer at speed lets the back step out: the car turns tighter than
// grip allows and carries its speed round, at a cost in drag. Faster through a
// hairpin, slower through a sweeper. The chain it builds is for fun and is never
// banked on the board.
export const DRIFT_MIN_SPEED = 6     // tiles per second, 60 km/h
export const DRIFT_TURN = 1.8        // turn rate multiple while drifting
export const DRIFT_FALLOFF = 0.3     // fraction of TURN_FALLOFF a drift still suffers
export const DRIFT_GRIP = 6.0        // sets the slip angle only: speed is kept, not scrubbed
export const DRIFT_DRAG = 1.0        // what a drift costs, per second, as a fraction of speed
export const DRIFT_POINTS = 100      // per tile/s of speed per radian of slip per second
export const DRIFT_SHOW_MS = 1200    // how long a banked or lost chain stays on the wire

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
/**
 * Lift a car whose body overlaps a wall back out onto the road.
 *
 * The wall test in stepCar judges a move by its destination, which is correct
 * only if the car STARTS clear. Three paths break that and none of them check:
 * the heading turns before any move is tested, resolveContact shoves cars with
 * no regard for walls, and an airborne car skips wall contact until it lands.
 * A car left overlapping had every move rejected, each rejection reversed its
 * velocity, and 55% of cars that brushed a wall were frozen there for good.
 *
 * Restoring the precondition fixes all three in one place, rather than weakening
 * the wall test until it lets cars drive into walls. Searches outward in fixed
 * directions and takes the smallest move that clears the body, so the nudge is
 * as small as it can be and the same every time. Bounded: a car it cannot clear
 * within a tile is left for the off-track branch, which already walks a car back.
 */
function depenetrate(match, car) {
  if (cornersInWall(match, car, car.x, car.y) === 0) return
  for (let d = DEPEN_STEP; d <= DEPEN_REACH; d += DEPEN_STEP) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      const x = car.x + Math.cos(a) * d
      const y = car.y + Math.sin(a) * d
      // Never lift a car onto a spot whose centre is itself in a wall.
      if (surfaceAt(match.grid, Math.round(x), Math.round(y)) === S_WALL) continue
      if (cornersInWall(match, car, x, y) === 0) {
        car.x = x
        car.y = y
        return
      }
    }
  }
}

const DEPEN_STEP = 0.05
const DEPEN_REACH = 1.0

function cornersInWall(match, car, atX, atY) {
  const probe = { x: atX, y: atY, heading: car.heading }
  let count = 0
  for (const p of carCorners(probe)) {
    if (surfaceAt(match.grid, Math.round(p.x), Math.round(p.y)) === S_WALL) count++
  }
  return count
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
  [S_HOLE]: 7.0,
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
  car.drift = raw.drift === 1 || raw.drift === true
  car.wantsUse = raw.use === 1 || raw.use === true
  return true
}

/**
 * The wheel follows the held key rather than jumping to it: full lock after
 * STEER_IN, back to centre after STEER_OUT. The heading still turns at a rate
 * the server applies, so the no-prediction steering model is untouched; only
 * how fast that rate arrives has changed.
 */
function steerToward(car, dt) {
  const target = car.steer ?? 0
  const now = car.steerNow ?? 0
  // Toward centre (letting go, or crossing to the other lock) is the quicker move.
  const outward = target !== 0 && Math.sign(target) === Math.sign(now || target)
  const step = dt / (outward ? STEER_IN : STEER_OUT)
  car.steerNow = Math.abs(target - now) <= step ? target : now + Math.sign(target - now) * step
}

/** Start a drift, or end one cleanly. The ways to lose one are checked at the top of stepCar. */
function updateDrift(match, car, speed, airborne, spinning) {
  if (car.driftDir) {
    if (!car.drift || speed < DRIFT_MIN_SPEED) endDrift(match, car, false)
  } else if (car.drift && !airborne && !spinning && speed >= DRIFT_MIN_SPEED && car.steerNow !== 0) {
    // Locked to the side it was turned into until it ends.
    car.driftDir = Math.sign(car.steerNow)
    car.driftChain = 0
  }
}

/**
 * Bank the chain, or lose it. Either way the outcome is recorded for the page,
 * which draws what the rules decided and never works it out for itself.
 */
function endDrift(match, car, lost) {
  const pts = Math.round(car.driftChain ?? 0)
  if (!lost) car.driftScore = (car.driftScore ?? 0) + pts
  if (pts > 0) car.driftEnd = { pts, lost, at: match.now }
  car.driftDir = 0
  car.driftChain = 0
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
  // A drift is lost by going down a hole, leaving the ground or being spun.
  // Checked before the early returns below, which a falling or flying car takes.
  if (car.driftDir && (isFalling(match, car) || match.now < (car.airUntil ?? 0) || match.now < (car.spinUntil ?? 0))) {
    endDrift(match, car, true)
  }
  // In a hole: going nowhere until it is set down past it.
  if (isFalling(match, car)) return
  // A pad's flight is exact: nothing the driver does changes where it lands.
  if (car.guided && match.now < (car.airUntil ?? 0)) {
    car.x = Math.max(0, Math.min(GRID - 1, car.x + car.vx * dt))
    car.y = Math.max(0, Math.min(GRID - 1, car.y + car.vy * dt))
    return
  }

  const surface = surfaceUnder(match, car)
  const airborne = match.now < (car.airUntil ?? 0)
  // A wall under a car in the air is not a wall it is in: no off-road cap or
  // drag, or a jump over one would slow in mid-air.
  const offTrack = surface === S_WALL && !airborne
  const cap = offTrack ? OFFTRACK_CAP : topSpeedOf(match, car)

  // 1. Steer. A rate, never a target: this is what makes the game playable
  //    without client-side prediction. steerNow eases toward the held key;
  //    the heading still turns at a rate.
  steerToward(car, dt)
  const speed = Math.hypot(car.vx, car.vy)
  const falloff = 1 - TURN_FALLOFF * Math.min(1, speed / TOP_SPEED)
  const spinning = match.now < (car.spinUntil ?? 0)
  updateDrift(match, car, speed, airborne, spinning)
  if (spinning) {
    // The wheel is not yours. Input is ignored outright rather than scaled, so a
    // spin cannot be steered out of by holding the opposite lock.
    car.heading += SPIN_RATE * dt
  } else if (car.driftDir) {
    // Into the drift tightens it, centred holds it, counter-steer opens it.
    const trim = 0.75 + 0.25 * car.steerNow * car.driftDir
    const held = 1 - TURN_FALLOFF * DRIFT_FALLOFF * Math.min(1, speed / TOP_SPEED)
    car.heading += car.driftDir * TURN_RATE * DRIFT_TURN * held * trim * dt
  } else {
    const steerAuthority = airborne ? AIR_STEER : car.onSlick ? SLICK_TURN : 1
    car.heading += car.steerNow * TURN_RATE * falloff * steerAuthority * dt
  }

  // The turn above is never tested against walls, and last tick's contact shove
  // or landing may have left the body overlapping one. Clear it before any move
  // is judged, so the destination test below starts from a clean car. Not in the
  // air: a car flying over a wall is meant to be over it.
  if (!airborne && !offTrack) depenetrate(match, car)

  const cos = Math.cos(car.heading)
  const sin = Math.sin(car.heading)

  // 2. Split velocity into forward and lateral, relative to the nose.
  let fwd = car.vx * cos + car.vy * sin
  let lat = -car.vx * sin + car.vy * cos

  // 3. Thrust, braking and drag act on the forward component only.
  const drive = spinning ? SPIN_THRUST : car.onSlick ? SLICK_THRUST : 1
  // Thrust is strong from a standstill and fades toward the cap, so the last
  // few km/h take their time. Braking cuts it: with a brake this soft, a car
  // holding both (as every bot does) sped up below about 7 tiles/s.
  if (car.throttle && !car.brake) {
    const fade = 1 - ACCEL_FADE * Math.min(1, Math.max(0, fwd) / cap)
    fwd += ACCEL * (match.now < car.boostUntil ? BOOST_MULT : 1) * drive * fade * dt
  }
  // In the air a jump holds its speed: no brakes to bite, no road to drag. The
  // landing checks assume every jump covers the distance its launch speed gives.
  if (!airborne) {
    if (car.brake) fwd -= BRAKE * dt
    const surfaceDrag = surface === S_GRAVEL ? GRAVEL_DRAG : DRAG
    fwd -= fwd * (offTrack ? OFFTRACK_DRAG : surfaceDrag) * dt
  }

  // 4. Lateral bleeds off at the surface's grip.
  const base = offTrack ? GRIP[S_TARMAC] : (GRIP[surface] ?? GRIP[S_TARMAC])
  // A dropped slick is oil that happens to be a hazard rather than a tile, so
  // it resolves to the same grip and needs no second physics path.
  let grip = car.onSlick ? Math.min(base, GRIP[S_OIL]) : base
  if (car.driftDir) grip = Math.min(grip, DRIFT_GRIP)
  // Less of it at speed, and less still on the throttle.
  const load = Math.min(1, speed / TOP_SPEED)
  grip *= 1 - GRIP_FALLOFF * load * load * (car.throttle ? 1 : LIFT_GRIP)
  const latBefore = lat
  lat *= Math.max(0, 1 - grip * dt)
  // A drift turns sideways speed into forward speed instead of scrubbing it.
  // Scrubbed, the turn rate a hairpin needs bled speed faster than any throttle
  // could replace; this is what lets a drift carry its speed round.
  if (car.driftDir) {
    fwd = Math.sign(fwd || 1) * Math.sqrt(Math.max(0, fwd * fwd + latBefore * latBefore - lat * lat))
    fwd -= fwd * DRIFT_DRAG * dt
  }

  // 5. Clamp and recompose.
  fwd = Math.max(-cap * 0.4, Math.min(cap, fwd))
  car.vx = fwd * cos - lat * sin
  car.vy = fwd * sin + lat * cos
  // Points for style: faster and more sideways earns more.
  if (car.driftDir) car.driftChain += Math.hypot(fwd, lat) * Math.abs(Math.atan2(lat, fwd)) * DRIFT_POINTS * dt

  // 6. Integrate, then resolve contact one axis at a time so a car sliding
  //    along a wall keeps the component that is not blocked.
  const hitVx = car.vx
  const hitVy = car.vy
  let hitX = false
  let hitY = false
  const nx = car.x + car.vx * dt
  if (cornersInWall(match, car, nx, car.y) > 0 && !offTrack && !airborne) {
    hitX = true
  } else {
    car.x = nx
  }

  const ny = car.y + car.vy * dt
  if (cornersInWall(match, car, car.x, ny) > 0 && !offTrack && !airborne) {
    hitY = true
  } else {
    car.y = ny
  }
  if (hitX || hitY) wallHit(match, car, hitX, hitY, hitVx, hitVy)

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

/**
 * A grid wall faces along x or y, so the blocked axis is its normal. The part
 * of the velocity into it bounces back at WALL_BOUNCE; the part along it is
 * scrubbed by how square the hit was. A glancing hit also turns the nose
 * toward the wall's line, by WALL_ALIGN scaled by impact, so a bare graze
 * only nudges the heading and a car straightens out along the wall rather
 * than grinding.
 */
function wallHit(match, car, hitX, hitY, vx, vy) {
  if (car.driftDir) endDrift(match, car, true)
  const speed = Math.hypot(vx, vy)
  if (speed === 0) return
  const impact = Math.min(1, Math.hypot(hitX ? vx : 0, hitY ? vy : 0) / speed)
  const keep = 1 - WALL_SCRUB * impact
  car.vx = hitX ? -vx * WALL_BOUNCE : vx * keep
  car.vy = hitY ? -vy * WALL_BOUNCE : vy * keep
  const tx = hitX ? 0 : vx
  const ty = hitY ? 0 : vy
  if (impact < WALL_GLANCE && (tx !== 0 || ty !== 0)) {
    const along = Math.atan2(ty, tx)
    const d = Math.atan2(Math.sin(along - car.heading), Math.cos(along - car.heading))
    // Not a car reversing along the wall: only a nose already pointing its way.
    if (Math.abs(d) < Math.PI / 2) car.heading += d * WALL_ALIGN * impact
  }
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
      // A ghost is not there to be touched, nor is a car down a hole.
      if (isGhost(match, a) || isGhost(match, b) || isFalling(match, a) || isFalling(match, b)) continue
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

      // Trade momentum along the contact, equal masses, a little bounce. Only
      // when closing: two cars already parting keep their own speeds.
      const closing = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy
      if (closing < 0) {
        const j = (-(1 + CAR_BOUNCE) * closing) / 2
        a.vx -= j * ux
        a.vy -= j * uy
        b.vx += j * ux
        b.vy += j * uy
      }
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
// SEGMENT_WIDTH_MAX are linked.
// The slack covers a car that has run wide onto the kerb or a tile beyond it.
// Kept below half the checkpoint spacing (centerline length / CHECKPOINT_COUNT,
// about 16) so two checkpoints are never in reach at once.
export const CHECKPOINT_SLACK = 2
export const CHECKPOINT_RADIUS = SEGMENT_WIDTH_MAX / 2 + CHECKPOINT_SLACK

// The finish line is NOT judged by a circle. A circle cannot be both accurate
// along the track and wide enough across it: tight enough to stop a lap banking
// early is too narrow for a car crossing on the outside line, and wide enough
// for the outside line banks the lap tiles before the car reaches the paint.
// It is judged as a real crossing instead, which is exact in both axes.
export const LINE_HALF_SPAN = SEGMENT_WIDTH_MAX / 2 + CHECKPOINT_SLACK

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
  const idx = match.checkpoints?.[0]?.index ?? 0
  return tangentAt(line, idx)
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

// --- Wrong way --------------------------------------------------------------
// A car moving against the course for WRONG_WAY_MS is told so. Judged by where
// it is going, not where it points, so a spin or a bump does not trip it, and
// only above WRONG_WAY_MIN_SPEED, so a car turning round on the spot is left
// alone. Moving the right way clears it at once.
export const WRONG_WAY_MS = 1000
export const WRONG_WAY_MIN_SPEED = 3
// More than this far off the course's direction counts as against it (cos 120).
const WRONG_WAY_COS = -0.5
// Centre-line points searched either side of where a car was last tick.
const WRONG_WAY_SEARCH = 24

/**
 * The way the course runs where the car is: the tangent of the nearest point on
 * the centre line. Shortcuts need no case of their own: they only cut corners,
 * so the trunk nearest a chord never runs against it (checked at 189 points
 * across every shortcut), and a test holds that.
 */
function courseDirection(match, car) {
  const line = match.centerline
  const n = line.length
  let best = -1
  let bd = Infinity
  const consider = (i) => {
    const k = ((i % n) + n) % n
    const d = (line[k].x - car.x) ** 2 + (line[k].y - car.y) ** 2
    if (d < bd) {
      bd = d
      best = k
    }
  }
  if (Number.isInteger(car.lineIndex)) {
    for (let i = car.lineIndex - WRONG_WAY_SEARCH; i <= car.lineIndex + WRONG_WAY_SEARCH; i++) consider(i)
  }
  // Lost the car (first tick, a teleport, a jump): search the whole lap.
  if (best < 0 || bd > SEGMENT_WIDTH_MAX ** 2) for (let i = 0; i < n; i++) consider(i)
  car.lineIndex = best
  return tangentAt(line, best)
}

export function updateWrongWay(match, car, dtMs) {
  const speed = Math.hypot(car.vx, car.vy)
  const airborne = match.now < (car.airUntil ?? 0)
  if (!car.alive || airborne || speed < WRONG_WAY_MIN_SPEED) {
    // No evidence either way: hold what the car was last told.
    car.wrongWay = Boolean(car.wrongWay)
    return
  }
  const t = courseDirection(match, car)
  const against = (car.vx * t.x + car.vy * t.y) / speed < WRONG_WAY_COS
  car.wrongFor = against ? (car.wrongFor ?? 0) + dtMs : 0
  car.wrongWay = car.wrongFor >= WRONG_WAY_MS
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
// How near a car's centre must come to a box to take it: about its nose corner
// plus the box's half diagonal, so touching a box with the nose is enough.
export const PICKUP_REACH = 1.2
export const MAX_HAZARDS = 16
export const DROP_BACK = 1.4         // tiles behind the nose a hazard lands

// The kit beyond boost, oil and banana.
export const SHIELD_MS = 6000         // a bubble: oil does nothing, and the next spin or shock breaks it
export const GHOST_MS = 3000          // through cars and dropped hazards
export const SHOCK_RANGE = 6          // tiles; every other car inside it is slowed
export const SHOCK_KEEP = 0.45        // fraction of its speed a shocked car keeps
export const SHOCK_MS = 600           // how long a shocked car is shown as shocked
export const PUCK_SPEED = 22          // tiles per second, faster than any car
export const PUCK_TTL_MS = 4000
export const PUCK_RADIUS = 0.4
export const PUCK_HOME_RANGE = 6      // within this of its target a puck stops following the road
const PUCK_AHEAD = 1.2                // tiles ahead of the nose a puck is launched

// Flat by construction. The weighting is in how many copies of each item the
// bag holds, never in who is drawing from it.
// The wall is gone: a near stop is the wrong verb for a game whose handling is
// all momentum and sliding, and it punished whoever hit it more than it rewarded
// whoever dropped it.
export const ITEM_BAG = ['boost', 'boost', 'slick', 'banana', 'shield', 'spring', 'shock', 'puck', 'ghost', 'decoy']

const isGhost = (match, car) => match.now < (car.ghostUntil ?? 0)
const isShielded = (match, car) => match.now < (car.shieldUntil ?? 0)

/**
 * Something that would spin a car. A ghost is not there to hit; a shield takes
 * the hit and is gone. Returns true if the car was actually spun.
 */
function takeHit(match, car) {
  if (isGhost(match, car)) return false
  if (isShielded(match, car)) {
    car.shieldUntil = match.now
    return false
  }
  car.spinUntil = match.now + SPIN_MS
  return true
}

/** Driving over a pickup tile fills an empty slot and puts that tile on cooldown. */
export function collectPickup(match, car, rng = Math.random) {
  if (!car.alive || car.item || isFalling(match, car)) return false

  // The nearest box that is READY. Judged against the nearest box of any kind,
  // a car passing between two took nothing when another car had just emptied
  // the nearer one, though it drove straight through the one beside it.
  let hitKey = null
  let bestDist = Infinity
  if (match.pickups && match.pickups.length > 0) {
    for (const p of match.pickups) {
      if (match.now < (match.pickupCooldown.get(p.key) ?? 0)) continue
      const d = Math.hypot(car.x - p.x, car.y - p.y)
      if (d <= PICKUP_REACH && d < bestDist) {
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
  if (item === 'shield') {
    car.shieldUntil = match.now + SHIELD_MS
    return true
  }
  if (item === 'ghost') {
    car.ghostUntil = match.now + GHOST_MS
    return true
  }
  if (item === 'spring') {
    // A hop from where the car is: everything a ramp gives but the ramp.
    if (!(match.now < (car.airUntil ?? 0))) {
      car.airUntil = match.now + AIR_MS
      car.airMs = AIR_MS
      car.hop = true
    }
    return true
  }
  if (item === 'shock') {
    for (const other of match.cars.values()) {
      if (other === car || !other.alive || isGhost(match, other)) continue
      if (Math.hypot(other.x - car.x, other.y - car.y) > SHOCK_RANGE) continue
      if (isShielded(match, other)) {
        other.shieldUntil = match.now
        continue
      }
      other.vx *= SHOCK_KEEP
      other.vy *= SHOCK_KEEP
      other.shockedUntil = match.now + SHOCK_MS
    }
    return true
  }

  if (item === 'puck') {
    const x = car.x + Math.cos(car.heading) * PUCK_AHEAD
    const y = car.y + Math.sin(car.heading) * PUCK_AHEAD
    // Aimed at whoever is directly ahead in the running order; a leader's puck
    // just runs on down the track and hits whatever it meets.
    const order = runningOrder(match)
    const at = order.indexOf(car)
    const target = at > 0 ? order[at - 1].id : null
    match.hazards.push({ kind: 'puck', x, y, index: nearestLineIndex(match, x, y), target, until: match.now + PUCK_TTL_MS, by: car.id })
    while (match.hazards.length > MAX_HAZARDS) match.hazards.shift()
    return true
  }

  // Dropped behind: oil, a banana, or a decoy box.
  const bx = car.x - Math.cos(car.heading) * DROP_BACK
  const by = car.y - Math.sin(car.heading) * DROP_BACK
  const ttl = item === 'slick' ? SLICK_TTL_MS : BANANA_TTL_MS

  match.hazards.push({ kind: item, x: bx, y: by, until: match.now + ttl, by: car.id })
  // Capped rather than unbounded: the snapshot carries this list every tick.
  while (match.hazards.length > MAX_HAZARDS) match.hazards.shift()
  return true
}

function nearestLineIndex(match, x, y) {
  const line = match.centerline
  let best = 0
  let bd = Infinity
  for (let i = 0; i < line.length; i++) {
    const d = (line[i].x - x) ** 2 + (line[i].y - y) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

/**
 * Pucks run along the centre line, which is what keeps them out of walls, until
 * their target is close; then they go straight for it. A puck hits the first
 * car it reaches other than the one that fired it.
 */
export function movePucks(match, seconds) {
  const line = match.centerline
  const n = line.length
  for (const h of match.hazards) {
    if (h.kind !== 'puck' || h.spent) continue
    let left = PUCK_SPEED * seconds
    const target = h.target ? match.cars.get(h.target) : null
    if (target && target.alive && Math.hypot(target.x - h.x, target.y - h.y) <= PUCK_HOME_RANGE) {
      const d = Math.hypot(target.x - h.x, target.y - h.y) || 1
      const step = Math.min(left, d)
      h.x += ((target.x - h.x) / d) * step
      h.y += ((target.y - h.y) / d) * step
    } else {
      while (left > 0) {
        const next = line[(h.index + 1) % n]
        const d = Math.hypot(next.x - h.x, next.y - h.y)
        if (d <= left) {
          h.x = next.x
          h.y = next.y
          h.index = (h.index + 1) % n
          left -= d
        } else {
          h.x += ((next.x - h.x) / d) * left
          h.y += ((next.y - h.y) / d) * left
          left = 0
        }
      }
    }
    for (const car of match.cars.values()) {
      if (!car.alive || car.id === h.by || isFalling(match, car)) continue
      if (match.now < (car.airUntil ?? 0) || isGhost(match, car)) continue
      if (Math.hypot(car.x - h.x, car.y - h.y) > PUCK_RADIUS + CAR_RADIUS) continue
      h.spent = true
      takeHit(match, car)
      break
    }
  }
}

export function expireHazards(match) {
  match.hazards = match.hazards.filter((h) => h.until > match.now && !h.spent)
}

// A ramp launches a car that arrives with speed. While airborne the car ignores
// hazards and walls, so a ramp can clear a gap or a barrier, and carries the
// speed it arrived with. Height is RENDER ONLY: the rules track only that the
// car is in the air and when it lands, so nothing here gains a z axis. That is
// the same division Blockout 3D uses for its jump.
export const RAMP_MIN_SPEED = 8.0
export const AIR_MS = 700
export const AIR_STEER = 0.25

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

  // In a hole: nothing reaches the car until it is set down past it.
  if (car.fellIn) {
    if (match.now < car.fallUntil) return
    setDownPast(match, car)
  }

  // Down from a pad's jump.
  if (car.guided && !(match.now < (car.airUntil ?? 0))) touchDown(match, car)

  const here = surfaceAt(match.grid, Math.round(car.x), Math.round(car.y))

  const speed = Math.hypot(car.vx, car.vy)
  if (here === S_RAMP && speed >= RAMP_MIN_SPEED) {
    const pad = padUnder(match, car)
    if (!pad) {
      car.airUntil = Math.max(car.airUntil ?? 0, match.now + AIR_MS)
      car.airMs = AIR_MS
      car.hop = false
    } else if ((car.vx * Math.cos(pad.heading) + car.vy * Math.sin(pad.heading)) / speed >= PAD_ALIGN) {
      // Only a car driving at the pad: one skimming along it through the corner
      // is not thrown over the wall.
      launchFromPad(match, car, pad, speed)
    }
  }

  // Airborne: nothing on the ground reaches the car, and a banana under it is
  // not consumed, so it is still there for whoever lands on it.
  if (match.now < (car.airUntil ?? 0)) return

  // Drove into a hole rather than flying it.
  if (here === S_HOLE) {
    car.fellIn = nearestHole(match, car)
    car.fallUntil = match.now + FALL_MS
    car.vx = 0
    car.vy = 0
    return
  }

  if (here === S_BOOST) {
    car.boostUntil = Math.max(car.boostUntil, match.now + STRIP_BOOST_MS)
  }

  // A ghost passes through everything dropped, and leaves it for someone else.
  if (isGhost(match, car)) return

  for (const h of match.hazards) {
    const d = Math.hypot(car.x - h.x, car.y - h.y)
    if ((h.kind === 'banana' || h.kind === 'decoy') && !h.spent && d <= BANANA_RADIUS + CAR_RADIUS) {
      // One use. Marked rather than spliced, because this runs inside a loop over
      // the very list a splice would reindex; expireHazards sweeps it next tick.
      h.spent = true
      takeHit(match, car)
    } else if (h.kind === 'slick' && d <= SLICK_RADIUS && !isShielded(match, car)) {
      car.onSlick = true
    }
  }
}

const isFalling = (match, car) => Boolean(car.fellIn) && match.now < (car.fallUntil ?? 0)

function padUnder(match, car) {
  for (const p of match.jumps ?? []) {
    const f = { x: Math.cos(p.heading), y: Math.sin(p.heading) }
    const along = (car.x - p.x) * f.x + (car.y - p.y) * f.y
    const across = -(car.x - p.x) * f.y + (car.y - p.y) * f.x
    if (Math.abs(along) <= 0.6 && Math.abs(across) <= p.width / 2) return p
  }
  return null
}

/**
 * Lined up with the pad and sent exactly its distance past the lip, however
 * fast: a flight of distance / speed. Renewed every tick the car is on the pad,
 * like any ramp, so it is measured from the lip.
 */
function launchFromPad(match, car, pad, speed) {
  const f = { x: Math.cos(pad.heading), y: Math.sin(pad.heading) }
  const along = (car.x - pad.x) * f.x + (car.y - pad.y) * f.y
  const toGo = Math.max(0, 0.5 - along) + pad.distance
  car.heading = pad.heading
  car.vx = f.x * speed
  car.vy = f.y * speed
  car.airUntil = match.now + (toGo / speed) * 1000
  car.airMs = (pad.distance / speed) * 1000
  car.hop = false
  car.guided = pad
}

/**
 * Down from a pad's jump: facing along the stretch it landed on, at the speed
 * it flew, and credited the checkpoints it flew past, in order, as long as it
 * was due them.
 */
function touchDown(match, car) {
  const pad = car.guided
  const speed = Math.hypot(car.vx, car.vy)
  car.heading = pad.land.heading
  car.vx = Math.cos(car.heading) * speed
  car.vy = Math.sin(car.heading) * speed
  const ring = match.checkpoints.length
  // In order, and only those due: one the flight passed close enough to was
  // taken in the air already, and is simply skipped.
  for (const k of pad.credits) {
    if (car.nextCp !== k) continue
    car.cpTaken += 1
    car.nextCp = (k + 1) % ring
  }
  if (car.nextCp === 0) car.lineSide = null
  car.guided = null
  car.lineIndex = undefined
}

function nearestHole(match, car) {
  let best = null
  let bd = Infinity
  for (const h of match.holes ?? []) {
    const d = Math.hypot(car.x - h.x, car.y - h.y)
    if (d < bd) {
      bd = d
      best = h
    }
  }
  return best ?? { x: car.x, y: car.y, heading: car.heading, width: 1 }
}

/**
 * Past the hole, in the lane the car fell in, stopped and facing along the
 * course. Kept within the ramp's width so it is never set down on the kerb.
 */
function setDownPast(match, car) {
  const h = car.fellIn
  const f = { x: Math.cos(h.heading), y: Math.sin(h.heading) }
  const across = -(car.x - h.x) * f.y + (car.y - h.y) * f.x
  const lane = Math.max(-(h.width - 1) / 2, Math.min((h.width - 1) / 2, across))
  car.x = h.x + f.x * HOLE_EXIT - f.y * lane
  car.y = h.y + f.y * HOLE_EXIT + f.x * lane
  car.heading = h.heading
  car.vx = 0
  car.vy = 0
  car.fellIn = null
  car.fallUntil = 0
  car.lineIndex = undefined
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
    car.airUntil = 0
    car.lineSide = undefined
    car.bestLapMs = null
    car.lapStartedAt = 0
    car.steer = 0
    car.steerNow = 0
    car.drift = false
    car.driftDir = 0
    car.driftChain = 0
    car.driftScore = 0
    car.driftEnd = null
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
  movePucks(match, seconds)

  const leaderLapBefore = match.lap

  for (const car of match.cars.values()) {
    if (!car.alive) continue
    applyHazards(match, car)
    if (car.wantsUse) {
      useItem(match, car)
      car.wantsUse = false
    }
    stepCar(match, car, seconds)
    updateWrongWay(match, car, dt)
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
      airborne: match.now < (car.airUntil ?? 0),
      // Normalised height along the arc, for the page to draw a hop and a
      // shadow with. Render only: no rule reads it back.
      // Measured over the flight from the lip: AIR_MS for a ramp, distance /
      // speed for a pad. Clamped, as a car still on a pad is renewed each tick.
      airT: match.now < (car.airUntil ?? 0)
        ? Math.max(0, Math.min(1, Math.round((1 - (car.airUntil - match.now) / (car.airMs ?? AIR_MS)) * 100) / 100))
        : 0,
      // On a pad's jump: the way the car will face on touchdown, for the page to
      // turn it toward through the air rather than all at once on landing.
      ...(car.guided && match.now < (car.airUntil ?? 0) && { land: Math.round(car.guided.land.heading * 1000) / 1000 }),
      // The page turns the front wheels by `steer` and lights the brake lamps by
      // `brake`. Without them on the wire the page silently drew straight wheels
      // and dark lamps forever, because an absent field reads as a falsy one.
      // `steer` is the eased wheel, so the drawn wheels turn in as the car does.
      steer: Math.round((car.steerNow ?? 0) * 100) / 100,
      brake: Boolean(car.brake),
      speed: Math.round(Math.hypot(car.vx, car.vy) * 10) / 10,
      // Rare states are sent only while true, which keeps a full frame of eight
      // cars inside its 4 KB budget; the page reads a missing flag as false.
      ...(car.wrongWay && { wrongWay: true }),
      ...(match.now < (car.shieldUntil ?? 0) && { shield: true }),
      ...(match.now < (car.ghostUntil ?? 0) && { ghost: true }),
      ...(match.now < (car.shockedUntil ?? 0) && { shocked: true }),
      // A hop from a spring starts on the ground, a launch from a ramp at its
      // lip; the page draws the arc from the right height.
      ...(match.now < (car.airUntil ?? 0) && car.hop && { hop: true }),
      // Down a hole: how far through the fall, for the page to sink the car.
      ...(isFalling(match, car) && { falling: true, fallT: Math.round((1 - (car.fallUntil - match.now) / FALL_MS) * 100) / 100 }),
      bestLapMs: car.bestLapMs ?? undefined,
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

  const activeHazards = []
  if (match.hazards) {
    for (const h of match.hazards) {
      activeHazards.push({ kind: h.kind, x: h.x, y: h.y })
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
    hazards: activeHazards,
    pickups: activePickups,
    order: order.map((c) => c.id),
    cut: match.cut,
    winner: match.winner,
    final: match.final,
    board: match.board,
  }
}
