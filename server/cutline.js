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

/** Walk a closed polyline and emit a point every `spacing` of arc length. */
function resample(points, spacing) {
  const out = [points[0]]
  let carried = 0

  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (segment === 0) continue

    let travelled = spacing - carried
    while (travelled <= segment) {
      const t = travelled / segment
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      travelled += spacing
    }
    carried = segment - (travelled - spacing)
  }

  // The final point may land almost on top of the first after the wrap. Drop it
  // rather than leave a zero-length segment for the tangent maths to divide by.
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 1 && Math.hypot(last.x - first.x, last.y - first.y) < spacing * 0.5) out.pop()

  return out
}
