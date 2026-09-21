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
  const centerline = buildCenterline(seed)
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

// --- Timing & lobby -------------------------------------------------------
export const TICK_MS = 16            // 60 Hz simulation
export const SEND_MS = 16            // client input rate
export const DELAY_MS = 60           // client interpolation window

export const MIN_PLAYERS = 2
export const BOT_FILL_TO = 4
export const MIN_LAPS = 3
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
  const { grid, centerline, checkpoints, startSlots } = carve(circuit.seed)

  return {
    circuit,
    circuitIndex,
    grid,
    centerline,
    checkpoints,
    startSlots,
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
// Measured lap time (Task 7): 4 bots, fixed rng, 90s runs across all 8
// circuits. Where a bot drives cleanly, median lap is about 19.4s (range
// 13.5 to 24s), close to the spec's 18s estimate. On 4 of the 8 circuits the
// bot pursuit line and the wall bounce physics settle into a fixed point that
// freezes a bot in place; two of those never complete a lap at all in 90s.
// That is a bot AI or track geometry defect, not a speed problem, and
// TOP_SPEED was left alone to get this number. See task-7-report.md.
export const TOP_SPEED = 14.0        // tiles per second
export const ACCEL = 18.0
export const BRAKE = 26.0
export const DRAG = 1.2
export const TURN_RATE = 3.2         // rad/s at low speed
export const TURN_FALLOFF = 0.45     // fraction of turn rate lost at top speed

export const OFFTRACK_CAP = 6.5
export const OFFTRACK_DRAG = 6.0
export const WALL_HIT_KEEP = 0.25
export const CAR_RADIUS = 0.45

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
  car.heading += (car.steer ?? 0) * TURN_RATE * falloff * dt

  const cos = Math.cos(car.heading)
  const sin = Math.sin(car.heading)

  // 2. Split velocity into forward and lateral, relative to the nose.
  let fwd = car.vx * cos + car.vy * sin
  let lat = -car.vx * sin + car.vy * cos

  // 3. Thrust, braking and drag act on the forward component only.
  if (car.throttle) fwd += ACCEL * (match.now < car.boostUntil ? BOOST_MULT : 1) * dt
  if (car.brake) fwd -= BRAKE * dt
  fwd -= fwd * (offTrack ? OFFTRACK_DRAG : DRAG) * dt

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
  if (surfaceAt(match.grid, Math.round(nx), Math.round(car.y)) === S_WALL && !offTrack) {
    car.vx *= -WALL_HIT_KEEP
  } else {
    car.x = nx
  }

  const ny = car.y + car.vy * dt
  if (surfaceAt(match.grid, Math.round(car.x), Math.round(ny)) === S_WALL && !offTrack) {
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

/** Cars push each other apart. Contact is a nuisance, never a weapon. */
function resolveContact(match) {
  const cars = [...match.cars.values()].filter((c) => c.alive)
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i]
      const b = cars[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      const min = CAR_RADIUS * 2
      if (d >= min || d === 0) continue

      const push = (min - d) / 2
      const ux = dx / d
      const uy = dy / d
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
export const CHECKPOINT_RADIUS = 4.0

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

  if (Math.hypot(car.x - target.x, car.y - target.y) > CHECKPOINT_RADIUS) return

  // Checkpoint 0 is the cut line. Reaching it counts a lap, but only from a
  // car that has taken every checkpoint behind it.
  if (car.nextCp === 0) {
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

  car.cpTaken += 1
  car.nextCp = (car.nextCp + 1) % ring.length
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
 * The cut: when the leader crosses the line, whoever is last in running order
 * right now leaves the race, wherever they happen to be on the track.
 *
 * The race never waits for the tail to trail in. A car about to be lapped is
 * gone before it is lapped, which is the point of the format and the reason
 * the pressure sits mid-pack instead of at the front.
 */
export function applyCut(match) {
  if (match.lap <= GRACE_LAPS) return null

  const order = runningOrder(match)
  if (order.length <= 1) return null

  const doomed = order[order.length - 1]
  doomed.alive = false
  doomed.finishedAt = match.elapsed
  match.cut = { id: doomed.id, name: doomed.name, at: match.elapsed }
  return doomed
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
export const SLICK_TTL_MS = 9000
export const SLICK_RADIUS = 1.1
export const WALL_TTL_MS = 8000
export const WALL_RADIUS = 0.9
export const PICKUP_RESPAWN_MS = 6000
export const MAX_HAZARDS = 16
export const DROP_BACK = 1.4         // tiles behind the nose a hazard lands

// Flat by construction. The weighting is in how many copies of each item the
// bag holds, never in who is drawing from it.
export const ITEM_BAG = ['boost', 'boost', 'boost', 'slick', 'slick', 'wall']

/** Driving over a pickup tile fills an empty slot and puts that tile on cooldown. */
export function collectPickup(match, car, rng = Math.random) {
  if (!car.alive || car.item) return false

  const tx = Math.round(car.x)
  const ty = Math.round(car.y)
  if (surfaceAt(match.grid, tx, ty) !== S_PICKUP) return false

  const key = ty * GRID + tx
  const readyAt = match.pickupCooldown.get(key) ?? 0
  if (match.now < readyAt) return false

  match.pickupCooldown.set(key, match.now + PICKUP_RESPAWN_MS)
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
  const ttl = item === 'slick' ? SLICK_TTL_MS : WALL_TTL_MS

  match.hazards.push({ kind: item, x: bx, y: by, until: match.now + ttl, by: car.id })
  // Capped rather than unbounded: the snapshot carries this list every tick.
  while (match.hazards.length > MAX_HAZARDS) match.hazards.shift()
  return true
}

export function expireHazards(match) {
  match.hazards = match.hazards.filter((h) => h.until > match.now)
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
    if (h.kind === 'slick' && d <= SLICK_RADIUS) {
      car.onSlick = true
    } else if (h.kind === 'wall' && d <= WALL_RADIUS + CAR_RADIUS) {
      // A barrier scrubs speed the way a wall does, and shoves the car clear
      // so it cannot sit inside the hazard.
      car.vx *= -WALL_HIT_KEEP
      car.vy *= -WALL_HIT_KEEP
      if (d > 0) {
        car.x += ((car.x - h.x) / d) * 0.2
        car.y += ((car.y - h.y) / d) * 0.2
      }
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

    // Aim ahead of the checkpoint the bot is chasing, scaled by how quick this
    // bot is, so the field has a skill spread rather than identical laps.
    const line = match.centerline
    const target = match.checkpoints[car.nextCp]
    let nearest = target ? target.index : 0
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
  match.laps = Math.max(MIN_LAPS, field)
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

  // The cut fires on the leader completing a lap, and removes whoever is last
  // in running order at that instant. The race never waits for the tail.
  if (match.lap > leaderLapBefore) applyCut(match)

  const running = [...match.cars.values()].filter((c) => c.alive)
  if (running.length <= 1 || (running[0] && running[0].lap >= match.laps)) {
    const order = runningOrder(match)
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
      bestLapMs: car.bestLapMs,
    })
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
    order: order.map((c) => c.id),
    cut: match.cut,
    winner: match.winner,
    final: match.final,
    board: match.board,
  }
}
