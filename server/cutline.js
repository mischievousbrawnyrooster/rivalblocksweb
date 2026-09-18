// Rules for one Cutline race. Pure: zero external imports, zero Node APIs,
// zero sockets, zero timers, zero I/O. Everything here is exercised by
// cutline.test.js.

// --- Dimensions -----------------------------------------------------------
export const GRID = 96               // square, the circuit is carved out of it
export const TRACK_WIDTH = 7         // tiles of racing surface across
export const CHECKPOINT_COUNT = 12

// --- Centerline generation ------------------------------------------------
// The centerline is a polar curve r(angle) built from sine harmonics. Periodic
// by construction, so the loop closes with no seam to blend. Single-valued in
// angle, so it can never cross itself. Curvature bounded by the amplitudes,
// which is what makes MAX_CORNER_RAD testable rather than hoped for.
export const BASE_RADIUS = 30
export const AMP_MAX = 3.5           // per harmonic
export const HARMONICS = [2, 3, 4]
export const POINT_SPACING = 1       // tiles between centerline points

// The sharpest corner any circuit may contain, in radians of heading change
// per POINT_SPACING of travel. Derived, not guessed: at speed v the car turns
// TURN_RATE * (1 - TURN_FALLOFF * v / TOP_SPEED) / v radians per tile, so a
// corner of 0.30 is taken at v ~= 7.9, about 57% of TOP_SPEED. Raising this
// admits corners no hauler can hold; lowering it flattens every circuit toward
// an oval.
export const MAX_CORNER_RAD = 0.30

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

/**
 * The racing line for one circuit: a closed ring of points spaced roughly
 * POINT_SPACING apart, centred on the grid.
 *
 * Everything else about a circuit is derived from this one list. The carve
 * stamps tarmac across it, the checkpoints are indices into it, the starting
 * slots sit behind index 0, and the bots drive it. That is why it is built
 * first and tested hardest.
 */
export function buildCenterline(seed) {
  const rng = createRng(seed)

  // One amplitude and phase per harmonic, drawn once so the curve is fixed.
  const waves = HARMONICS.map((k) => ({
    k,
    amp: rng() * AMP_MAX,
    phase: rng() * Math.PI * 2,
  }))

  const radiusAt = (angle) => {
    let r = BASE_RADIUS
    for (const w of waves) r += w.amp * Math.sin(w.k * angle + w.phase)
    return r
  }

  // Sample densely, then resample to even spacing. Sampling by angle alone
  // bunches points where the radius is small, which would make POINT_SPACING a
  // lie and break every consumer that treats an index as a distance.
  const dense = []
  const STEPS = 4096
  for (let i = 0; i < STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2
    const r = radiusAt(a)
    dense.push({ x: GRID / 2 + Math.cos(a) * r, y: GRID / 2 + Math.sin(a) * r })
  }

  return resample(dense, POINT_SPACING)
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

export const SURFACE_CHARS = ['W', 'T', 'K', 'B', 'O', 'P', 'L']

// Derived from the starting slots the carve lays down, the way Blockout derives
// its capacity from SPAWNS.length. To raise capacity, lay more slots; never
// edit this number, or a player is seated at undefined.
export const START_ROWS = 4
export const START_COLUMNS = 2
export const MAX_PLAYERS = START_ROWS * START_COLUMNS

const HALF_WIDTH = (TRACK_WIDTH - 1) / 2
const PICKUP_EVERY = 24              // centerline points between pickup tiles
const START_ROW_GAP = 3              // centerline points between starting rows

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

/**
 * One circuit, whole. The grid is what the client draws and what handling reads;
 * the centerline, checkpoints and starting slots all fall out of the same walk,
 * which is why none of them is separate code.
 */
export function carve(seed) {
  const centerline = buildCenterline(seed)
  const grid = new Uint8Array(GRID * GRID) // S_WALL is 0, so this starts solid
  const rng = createRng(seed ^ 0x9e3779b9) // a stream of its own, so surface
  //                                          decoration cannot shift the shape

  const put = (x, y, surface) => {
    const ix = Math.round(x)
    const iy = Math.round(y)
    if (ix < 0 || iy < 0 || ix >= GRID || iy >= GRID) return
    grid[iy * GRID + ix] = surface
  }

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

  // 1. Stamp the racing surface across the normal at every point. Points are
  //    POINT_SPACING apart and the track is TRACK_WIDTH wide, so consecutive
  //    stamps overlap and the surface has no gaps, EXCEPT on a tight corner:
  //    the outer offset travels further per index than the centerline does,
  //    so two consecutive stamps on the same rail can round to tiles that
  //    touch only diagonally, splitting the surface into two 4-connected
  //    pieces. lastAt bridges that elbow, one tile, so every rail stays
  //    orthogonally connected to itself.
  const lastAt = new Map()
  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    const nx = -t.y
    const ny = t.x

    for (let off = -HALF_WIDTH; off <= HALF_WIDTH; off++) {
      const edge = Math.abs(off) === HALF_WIDTH
      const surface = edge ? S_KERB : S_TARMAC
      const ix = Math.round(p.x + nx * off)
      const iy = Math.round(p.y + ny * off)

      const last = lastAt.get(off)
      if (last && Math.abs(ix - last.x) === 1 && Math.abs(iy - last.y) === 1) {
        put(last.x, iy, surface)
      }
      put(ix, iy, surface)
      lastAt.set(off, { x: ix, y: iy })
    }
  }

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

  // 3. Pickup tiles at even intervals, offset to either side so a driver
  //    chooses a line to collect rather than getting one for free.
  for (let i = PICKUP_EVERY; i < centerline.length - PICKUP_EVERY; i += PICKUP_EVERY) {
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    const side = (i / PICKUP_EVERY) % 2 === 0 ? 1 : -1
    put(p.x - t.y * side * 2, p.y + t.x * side * 2, S_PICKUP)
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
      const off = col === 0 ? -1.5 : 1.5
      startSlots.push({
        x: p.x - t.y * off,
        y: p.y + t.x * off,
        heading: Math.atan2(t.y, t.x),
        index,
      })
    }
  }

  return { grid, centerline, checkpoints, startSlots }
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
