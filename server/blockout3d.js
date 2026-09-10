// Blockout Royale 3D — every rule and all match state.
//
// No imports, no Node APIs, no sockets, exactly as game.js. That purity is why
// the whole ruleset is testable and why the socket wrapper has no tests of its
// own. Put new logic here, never in the wrapper.
//
// This is a fork of game.js rather than a generalisation of it. game.js is a
// shipped game with 1,163 lines of tests against it; duplicating ~200 lines of
// pure geometry is cheaper than destabilising that to share them.

export const SIZE = 13
export const FLOORS = 5
export const TOTAL = SIZE * SIZE * FLOORS

// Matches Blastworks. Continuous movement needs a tick this fast; the grid-step
// games get away with 100ms because a step is atomic.
export const TICK_MS = 16

export const SPEED_BASE = 4.4 // tiles/second on the ground
export const AIR_SPEED = 2.6 // steering authority mid-drop
export const FALL_MS = 480 // per floor
export const DASH_MS = 2500
export const DASH_MULT = 1.7

// Copied straight from game.js's 900, which was tuned for one 225-tile flat
// board, not a 845-tile, 5-floor stack. Once pickWave was restricted to
// occupied floors (below), that pace ate floor 0 far faster than intended:
// measured over 30 seeded rounds, floor 0 was down to half its starting tiles
// by 9.8s and a quarter by 18.6s, while the void does not take floor 4 until
// VOID_FIRST_MS (60s) — the collapse was winning the race by 40+ seconds, the
// "stack is decoration" failure the design's open question 2 warned about.
// At 3600 the same 30 seeds put floor 0 at half by 43.4s and a quarter by
// 57.8s — landing right at the void's first bite, which is the target. Round
// length moved with it: 33.3s average before, 64.9s after. Slower does not
// buy a longer round for free: at 7200 floor 0 only reached half-solid in
// 6 of 30 rounds (86.8s when it did) and round length only rose to 81.9s; at
// 14400 floor 0 never reached half-solid at all and round length rose to just
// 97.7s. Past about 7200 the void starts winning the race outright — floor 0
// stops being a threat before the void ever touches it, the opposite failure
// this constant exists to avoid — while round length keeps falling short of
// "near three minutes" regardless, because once the collapse stops being the
// dominant killer, elimination shifts to accumulated stray holes and the void
// itself, both with their own pace this constant does not touch. 3600 is the
// point closest to the void-race target of the values tried.
export const COLLAPSE_EVERY_MS = 3600
export const COLLAPSE_COUNT = 8
export const COLLAPSE_SHARE = 0.06
export const COLLAPSE_FASTEST_MS = 260
export const WARNING_MS = 1500

export const VOID_FIRST_MS = 60000
export const VOID_EVERY_MS = 35000
export const VOID_WARN_MS = 8000

export const JUMP_DURATION_MS = 420
export const JUMP_COOLDOWN_MS = 750
export const JUMP_SPEED_BOOST = 1.25

export const BLINK_TILES = 3
export const FORESIGHT_MS = 6000

export const COUNTDOWN_MS = 3000
export const OVER_MS = 5000
export const MIN_PLAYERS = 2
export const ROUND_TARGET = 1

// A floor holds at most POWERUP_FLOOR_MAX at once, which is what actually
// bounds the supply: the players are only ever on one or two floors, and
// POWERUP_MAX is the ceiling for the whole stack. POWERUP_FLOOR_SEED is the
// smaller promise that a floor somebody lands on is never bare. Seed, then let
// the timer grow it, so a floor climbs to its cap over about ten seconds rather
// than being full the instant anyone arrives.
export const POWERUP_EVERY_MS = 4500
export const POWERUP_MAX = 12
export const POWERUP_FLOOR_MAX = 3
export const POWERUP_FLOOR_SEED = 1

export const BOT_FILL_TO = 5
export const BOT_REACT_MS = 260
export const BOT_NAMES = ['Pell', 'Grit', 'Mote', 'Talc', 'Quill', 'Bram', 'Fen']

const MID = Math.floor((SIZE - 1) / 2)

// Opposite corners first, so a two-player round starts as far apart as it can,
// then the other diagonal, then the edge midpoints. Everyone starts on floor 0.
export const SPAWNS = [
  [1, 1],
  [SIZE - 2, SIZE - 2],
  [SIZE - 2, 1],
  [1, SIZE - 2],
  [MID, 1],
  [MID, SIZE - 2],
  [1, MID],
  [SIZE - 2, MID],
]

export const MAX_PLAYERS = SPAWNS.length

const NAME_MAX = 16

/** Stack index. z is the floor, 0 at the top. */
export const idx = (x, y, z) => z * SIZE * SIZE + y * SIZE + x

/** The inverse of `idx`. */
export const xyz = (i) => [i % SIZE, ((i / SIZE) | 0) % SIZE, (i / (SIZE * SIZE)) | 0]

// One character per tile on the wire. 845 tiles as quoted words is 183 KB/s per
// client at this tick rate, which is not acceptable; this is 25 KB/s and reads
// better in a packet capture than an array of strings does.
const CHAR = { solid: '.', warn: '!', gone: '_' }

/** The tile array as the string the snapshot carries. */
export const tileString = (tiles) => {
  let s = ''
  for (let i = 0; i < tiles.length; i++) s += CHAR[tiles[i]]
  return s
}

// A unit test rather than a regex range. An escape sequence for a control
// character is exactly the kind of thing an editor silently mangles;
// arithmetic on the code unit cannot be mangled.
const isPrintable = (ch) => {
  const code = ch.codePointAt(0)
  return code > 31 && code !== 127
}

/** Trims, strips control characters, caps length, and never returns empty. */
export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    // Bound the input before the per-character work below, so an oversized
    // frame cannot force a huge split/filter/join allocation.
    .slice(0, 256)
    .split('')
    .filter(isPrintable)
    .join('')
    .trim()
    .slice(0, NAME_MAX)
  return clean || 'Player'
}

export function createMatch() {
  return {
    phase: 'waiting',
    now: 0,
    phaseUntil: 0,
    tiles: new Array(TOTAL).fill('solid'),
    warnAt: new Array(TOTAL).fill(0),
    // Who flagged a tile, so an elimination it causes can be credited. 0 means
    // the floor did it and nobody gets a kill.
    warnBy: new Array(TOTAL).fill(0),
    // Tiles plated by an anchor (Task 8). Each absorbs exactly one hit.
    reinforced: new Set(),
    nextCollapseAt: Infinity,
    // Sparse: stack index -> kind. Only occupied tiles appear.
    powerups: {},
    nextPowerupAt: Infinity,
    // The lowest floor still standing. The void eats upward from FLOORS - 1
    // and stops at 0, which is what makes the endgame a flat Blockout round.
    bottom: FLOORS - 1,
    voidAt: Infinity,
    // One arena name per floor, so a drop lands you in a different footprint.
    arenas: new Array(FLOORS).fill('square'),
    players: [],
    nextId: 1,
    winner: null,
    winnerId: null,
    final: false,
    // Set from outside by the wrapper and passed through untouched. No rule
    // here reads it and nothing about the match depends on it.
    board: [],
    botFill: 0,
    botsWanted: false,
    botsOnly: false,
    nextWave: [],
  }
}

/** Seats a player or a bot. A piece is only handed out when a round starts. */
function seat(state, name, bot) {
  const player = {
    id: state.nextId++,
    name,
    bot,
    playing: false,
    alive: false,
    // Continuous within a floor, integral between them.
    x: 0,
    y: 0,
    z: 0,
    // The input the client last sent, held until it sends another.
    dir: [0, 0],
    // The way they last moved, so a blink knows where to go.
    face: [1, 0],
    // 0 when grounded; otherwise when the current drop lands.
    fallUntil: 0,
    // Who to credit if this drop is the one that ends them.
    fallBy: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    held: null,
    shielded: false,
    dashUntil: 0,
    hoverUntil: 0,
    seeingUntil: 0,
    jumpUntil: 0,
    jumpReadyAt: 0,
    thinkAt: 0,
    // Floors above `z` while a hover holds the body up. Goes out on the wire
    // as a negative `fall`, which the renderer already draws as height.
    lift: 0,
  }
  state.players.push(player)
  return player
}

/**
 * Joins the match. Anyone may connect — past capacity you spectate and are
 * handed a piece next round. A person does displace a bot, though: a seat held
 * by the machine is not a seat.
 */
export function addPlayer(state, name) {
  const bot = state.players.find((p) => p.bot)
  if (bot && state.players.length >= MAX_PLAYERS) removePlayer(state, bot.id)
  return seat(state, sanitizeName(name), false)
}

export function removePlayer(state, id) {
  const i = state.players.findIndex((p) => p.id === id)
  if (i !== -1) state.players.splice(i, 1)
}

/**
 * Whether the round is allowed to run at all. Bots exist to fill a stack for a
 * person, not to play by themselves.
 */
export const canRun = (state) => state.botsOnly || state.players.some((p) => !p.bot)

/** Bots are opt-in. Whoever turns up first gets the choice. */
export function wantBots(state) {
  state.botsWanted = true
  return true
}

/** Tops up to `botFill` and stands bots down again as people arrive. */
export function ensureBots(state) {
  if (!canRun(state)) {
    for (const bot of state.players.filter((p) => p.bot)) removePlayer(state, bot.id)
    state.botsWanted = false
    return
  }
  if (!state.botFill || (!state.botsWanted && !state.botsOnly)) {
    for (const bot of state.players.filter((p) => p.bot)) removePlayer(state, bot.id)
    return
  }
  const humans = state.players.filter((p) => !p.bot).length
  const bots = state.players.filter((p) => p.bot)
  const want = Math.max(0, Math.min(state.botFill, MAX_PLAYERS) - humans)

  for (let i = bots.length; i > want; i--) removePlayer(state, bots[i - 1].id)
  for (let i = bots.length; i < want; i++) {
    const taken = new Set(state.players.map((q) => q.name))
    seat(state, BOT_NAMES.find((n) => !taken.has(n)) ?? `Unit ${state.nextId}`, true)
  }
}

const DIRS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]

// The grid stays square; the ARENA is carved out of it by starting some tiles
// already gone. Nothing downstream needs to know — holes are holes, whether the
// collapse made them or the generator did.
// `square` is first so a fixed rng of 0 gives the plain stack under test.
export const ARENAS = ['square', 'disc', 'diamond', 'cross', 'ring', 'scatter']

/** Carves one floor into shape. */
function carve(state, z, arena, rng) {
  const c = (SIZE - 1) / 2
  const r = SIZE / 2
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - c
      const dy = y - c
      const dist = Math.hypot(dx, dy)
      let solid = true
      if (arena === 'disc') solid = dist <= r - 0.5
      else if (arena === 'diamond') solid = Math.abs(dx) + Math.abs(dy) <= c + 0.5
      else if (arena === 'cross') solid = Math.abs(dx) <= c / 2.5 || Math.abs(dy) <= c / 2.5
      else if (arena === 'ring') solid = dist <= r - 0.5 && dist >= r / 2.6
      else if (arena === 'scatter') solid = rng() > 0.12
      if (!solid) state.tiles[idx(x, y, z)] = 'gone'
    }
  }
}

/**
 * Fills in every solid region of one floor except the largest.
 *
 * Per floor, not per stack: two regions on the same floor cannot reach each
 * other, and a floor above is not a route between them — you can drop onto a
 * floor but never climb back off it under your own power.
 */
function keepLargestRegion(state, z) {
  const base = z * SIZE * SIZE
  const seen = new Set()
  let largest = []

  for (let n = 0; n < SIZE * SIZE; n++) {
    const start = base + n
    if (state.tiles[start] !== 'solid' || seen.has(start)) continue
    const cells = [start]
    seen.add(start)
    for (let head = 0; head < cells.length; head++) {
      const [x, y] = xyz(cells[head])
      for (const [dx, dy] of DIRS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
        const j = idx(nx, ny, z)
        if (state.tiles[j] !== 'solid' || seen.has(j)) continue
        seen.add(j)
        cells.push(j)
      }
    }
    if (cells.length > largest.length) largest = cells
  }

  const keep = new Set(largest)
  for (let n = 0; n < SIZE * SIZE; n++) {
    const i = base + n
    if (state.tiles[i] === 'solid' && !keep.has(i)) state.tiles[i] = 'gone'
  }
}

/**
 * Moves each spawn to the nearest solid tile of floor 0, so a carved-away
 * corner never starts someone inside a hole. Claimed tiles are not reused, so
 * two players can never be snapped onto each other.
 */
function snapSpawns(state) {
  const exits = (x, y) => {
    let n = 0
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
      if (state.tiles[idx(nx, ny, 0)] === 'solid') n++
    }
    return n
  }

  const taken = new Set()
  return SPAWNS.map(([sx, sy]) => {
    let best = -1
    let bestKey = Infinity
    for (let n = 0; n < SIZE * SIZE; n++) {
      if (state.tiles[n] !== 'solid' || taken.has(n)) continue
      const [x, y] = xyz(n)
      // A tile with a single exit is a death trap the moment that exit goes,
      // so openness outranks proximity.
      const key = (exits(x, y) >= 2 ? 0 : 1) * 1e6 + (x - sx) ** 2 + (y - sy) ** 2
      if (key < bestKey) {
        bestKey = key
        best = n
      }
    }
    if (best === -1) return [sx, sy]
    taken.add(best)
    const [x, y] = xyz(best)
    return [x, y]
  })
}

/** Clears the stack and hands pieces to the first MAX_PLAYERS in join order. */
export function startRound(state, rng = Math.random) {
  // Bots are seated by the tick, not here. Laying the stack out for one person
  // would hand them the round on the very next tick.
  if (state.players.length < MIN_PLAYERS) {
    state.phase = 'waiting'
    state.winner = null
    state.winnerId = null
    state.final = false
    return
  }

  state.tiles.fill('solid')
  state.warnAt.fill(0)
  state.warnBy.fill(0)
  state.reinforced = new Set()
  state.winner = null
  state.bottom = FLOORS - 1
  state.nextCollapseAt = state.now + COLLAPSE_EVERY_MS
  state.voidAt = state.now + VOID_FIRST_MS
  state.nextWave = []
  state.powerups = {}
  state.nextPowerupAt = state.now + POWERUP_EVERY_MS

  for (let z = 0; z < FLOORS; z++) {
    state.arenas[z] = ARENAS[Math.floor(rng() * ARENAS.length)]
    carve(state, z, state.arenas[z], rng)
    keepLargestRegion(state, z)
  }

  state.nextWave = pickWave(state, rng)
  const spawns = snapSpawns(state)

  state.players.forEach((p, i) => {
    p.playing = i < MAX_PLAYERS
    p.alive = p.playing
    p.held = null
    p.shielded = false
    p.dashUntil = 0
    p.hoverUntil = 0
    p.seeingUntil = 0
    p.kills = 0
    p.deaths = 0
    p.dir = [0, 0]
    p.face = [1, 0]
    p.fallUntil = 0
    p.fallBy = 0
    p.jumpUntil = 0
    p.jumpReadyAt = 0
    p.lift = 0
    p.z = 0
    if (p.playing) {
      // Centre of the tile: positions are continuous, tiles are not.
      p.x = spawns[i][0] + 0.5
      p.y = spawns[i][1] + 0.5
    }
  })

  // One on the floor before the first tick, placed last so it lands on carved
  // ground rather than in the void or under a player.
  spawnPowerup(state, rng)
  state.phase = 'playing'
}

/**
 * Sets the direction a player is holding. Returns false, silently, for anything
 * that is not a finite two-component vector — a NaN here would put a body at
 * NaN and make it permanently un-eliminable, which is the same failure the
 * grid games guard against with `Object.hasOwn(DIRS, dir)`.
 */
export function input(state, id, dir) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.playing || !p.alive) return false
  if (!Array.isArray(dir) || dir.length !== 2) return false
  const [dx, dy] = dir
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false

  const len = Math.hypot(dx, dy)
  // A normalised vector, so holding two keys is not a faster way to travel.
  p.dir = len > 0 ? [dx / len, dy / len] : [0, 0]
  // Releasing everything leaves you facing the way you were, which is what a
  // blink needs — a hop into wherever the key happened to be let go is not it.
  if (len > 0) p.face = p.dir
  return true
}

// Just under SIZE, not SIZE itself: tileUnder clamps its own read to
// SIZE - 1, but patchAround, anchorAround, blink and buildBridge all read a
// bare `Math.floor(p.x)` with no clamp of their own. A body pinned exactly at
// SIZE would floor to a column one past the grid, and everything that reads
// the raw coordinate would cover one column instead of two along that edge.
const EDGE = SIZE - 1e-6

/** Advances every body by dt, on the ground or in the air. */
export function stepPlayers(state, dt) {
  const secs = dt / 1000
  for (const p of state.players) {
    if (!p.playing || !p.alive) continue
    const [dx, dy] = p.dir
    if (dx === 0 && dy === 0) continue
    const speed =
      (p.fallUntil
        ? AIR_SPEED
        : SPEED_BASE * (state.now < p.dashUntil ? DASH_MULT : 1)) *
      (state.now < p.jumpUntil ? JUMP_SPEED_BOOST : 1)
    // Clamped to the grid rather than to the arena: the arena edge is carved
    // `gone`, so walking off it is a fall and needs no rule of its own.
    p.x = Math.max(0, Math.min(EDGE, p.x + dx * speed * secs))
    p.y = Math.max(0, Math.min(EDGE, p.y + dy * speed * secs))
  }
}

/** The stack index of the tile a body's centre is over. */
export const tileUnder = (state, p) =>
  idx(Math.min(SIZE - 1, Math.floor(p.x)), Math.min(SIZE - 1, Math.floor(p.y)), p.z)

/** The first solid tile of this floor next to a body, or null. */
function adjacentSolid(state, p) {
  const x0 = Math.min(SIZE - 1, Math.floor(p.x))
  const y0 = Math.min(SIZE - 1, Math.floor(p.y))
  for (const [dx, dy] of DIRS) {
    const x = x0 + dx
    const y = y0 + dy
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
    if (state.tiles[idx(x, y, p.z)] === 'solid') return [x + 0.5, y + 0.5]
  }
  return null
}

/** Takes a player out of the round, crediting `by` if there was one. */
export function eliminate(state, p, by) {
  if (!p.alive) return
  p.alive = false
  p.fallUntil = 0
  p.deaths += 1
  // Your own hole is nobody's kill, and neither is the void's.
  if (!by || by === p.id) return
  const killer = state.players.find((q) => q.id === by)
  if (killer) killer.kills += 1
}

/**
 * Begins a drop, unless a shield can pay for it.
 *
 * The shield is spent whether or not there is anywhere to be shoved, which is
 * how the flat game does it too: an item that only costs you something when it
 * works is an item you never have to think about.
 */
export function startFall(state, p, by = 0) {
  if (!p.playing || !p.alive || p.fallUntil) return
  // Hover is the one thing in the game that pauses its central cost. Guarding
  // here rather than at each call site covers a hole, a collapsing tile and a
  // shove in one line, because all drop you through this function.
  if (state.now < p.hoverUntil) return
  if (p.shielded) {
    p.shielded = false
    const safe = adjacentSolid(state, p)
    if (safe) {
      p.x = safe[0]
      p.y = safe[1]
      return
    }
  }
  p.fallUntil = state.now + FALL_MS
  p.fallBy = by
}

/**
 * Starts drops for anyone standing over nothing, and lands the drops that are
 * due.
 *
 * A landing that arrives on top of somebody drives them down as well, and the
 * credit travels with it: whoever started the chain owns every elimination it
 * causes. That is what makes a drop into a hole above a rival a play rather
 * than an accident.
 *
 * A drop that begins in the same pass as a landing is a chain and keeps its
 * author (`p.fallBy`). A drop that begins because a body is simply standing
 * over a hole is its own doing and credits nobody — `fallBy` otherwise
 * survives a landing forever, so a shove from a minute ago would still get
 * the kill for an unrelated walk into a hole later.
 */
export function resolveFalls(state) {
  for (const p of state.players) {
    if (!p.playing || !p.alive) continue

    // Whether this pass just landed the body. A drop beginning in the same
    // pass as a landing is a chain and keeps its author. A drop beginning
    // because somebody is standing over a hole is their own doing.
    let landed = false

    if (p.fallUntil) {
      if (state.now < p.fallUntil) continue
      p.fallUntil = 0
      if (p.z >= state.bottom) {
        // Nothing under the bottom floor but the void.
        eliminate(state, p, p.fallBy)
        continue
      }
      p.z += 1
      landed = true
      // Anyone already standing where this landed goes down as well.
      for (const o of state.players) {
        if (o === p || !o.playing || !o.alive || o.fallUntil) continue
        if (o.z !== p.z) continue
        if (Math.floor(o.x) !== Math.floor(p.x) || Math.floor(o.y) !== Math.floor(p.y)) continue
        startFall(state, o, p.fallBy || p.id)
      }
    }

    const jumping = state.now < p.jumpUntil
    if (!jumping && !p.fallUntil && state.tiles[tileUnder(state, p)] === 'gone') {
      // A warned tile is still floor. Only a hole drops you.
      startFall(state, p, landed ? p.fallBy : 0)
    }
  }
}

/**
 * Initiates a jump. Returns false, silently, if already airborne, cooling down, or falling.
 */
export function jump(state, id) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.playing || !p.alive || p.fallUntil) return false
  if (state.now < p.jumpUntil || state.now < p.jumpReadyAt) return false
  p.jumpUntil = state.now + JUMP_DURATION_MS
  p.jumpReadyAt = state.now + JUMP_COOLDOWN_MS
  return true
}

export const POWERUP_KINDS = [
  'shield',
  'dash',
  'sinkhole',
  'patch',
  'blink',
  'swap',
  'foresight',
  'shove',
  'hover',
  'bridge',
  'anchor',
  'lift',
]

// Inherited from the flat game unchanged, so the two kits behave alike and a
// player moving between them is not relearning numbers.
export const SHOVE_RADIUS = 2
export const SHOVE_DIST = 2
export const HOVER_MS = 2500
// Floors per second of climb while a hover holds. Per second, not per tick:
// the old per-tick figure silently doubled in speed when TICK_MS went from 33
// to 16, which is the bug a rate expressed in ticks always invites. Over
// HOVER_MS this is a little over two floors, matching what the per-tick
// version delivered at the tick rate it was written for.
export const JETPACK_RISE = 0.9

// How far above the top floor a hover can hold you. Short of a full floor on
// purpose: there is no tile above floor 0 to arrive at, and a negative `z`
// would index off the end of the tile array.
export const LIFT_CEILING = 0.9
export const BRIDGE_TILES = 4

// How often a kind comes up, against one for everything not listed.
//
// Patch is the only thing in the kit that gives floor back, on a board whose
// whole premise is losing it, so it is the one worth crossing a floor for.
//
// `lift` is deliberately NOT weighted. It is the only item that creates height
// rather than moving it, so every one collected adds a life the void then has
// to spend time eating. One draw in fourteen is the rarest this bag can
// express; anything rarer needs the bag to change, not the number.
export const POWERUP_WEIGHTS = { patch: 3 }

// Built from POWERUP_KINDS rather than written out, so a kind added above
// cannot be left out of the draw by accident.
const POWERUP_BAG = POWERUP_KINDS.flatMap((kind) =>
  Array(Object.hasOwn(POWERUP_WEIGHTS, kind) ? POWERUP_WEIGHTS[kind] : 1).fill(kind),
)

// A floor apart is worth a whole board's width, so `nearest` means nearest on
// your own floor unless there is genuinely nobody there.
//
// Measured (30 seeded rounds, 5 bots): sinkhole reaches cross-floor 71% of the
// time (39/55 casts) — but checking each one against who was actually alive
// on the caster's floor at cast time, zero of those had a same-floor rival
// available and skipped. The formula already prefers same-floor whenever a
// choice exists; the "sniping tool" question in the design's open question 3
// is answered by population, not by this constant — with 5 players spread
// over 5 floors, there is often nobody sharing your floor to begin with.
// Left unchanged: SIZE already forces that preference for every case this
// harness produced, and a larger margin (checked against 2 * SIZE) changed
// nothing measurable, so raising it would be tuning without evidence.
const FLOOR_COST = SIZE

const reach = (p, o) =>
  Math.abs(o.x - p.x) + Math.abs(o.y - p.y) + FLOOR_COST * Math.abs(o.z - p.z)

/** The nearest living rival in the stack, ties broken by id, never by order. */
function nearestRival(state, p) {
  let target = null
  let best = Infinity
  for (const o of state.players) {
    if (o === p || !o.playing || !o.alive) continue
    const d = reach(p, o)
    if (d < best || (d === best && target !== null && o.id < target.id)) {
      best = d
      target = o
    }
  }
  return target
}

/** Walking onto a pickup takes it, but only with an empty hand. */
export function pickUp(state) {
  for (const p of state.players) {
    if (!p.playing || !p.alive || p.fallUntil || p.held) continue
    const i = tileUnder(state, p)
    if (!Object.hasOwn(state.powerups, i)) continue
    p.held = state.powerups[i]
    delete state.powerups[i]
  }
}

/**
 * Rebuilds every hole in the three by three the player is standing in, on their
 * own floor. Corners included: the four orthogonal neighbours alone rebuild a
 * plus, and a plus is not an island you can stand on. Only holes are rebuilt —
 * a tile already flagged stays flagged, so a patch buys ground, never a
 * reprieve from a wave you can see coming.
 */
function patchAround(state, p) {
  const x0 = Math.floor(p.x)
  const y0 = Math.floor(p.y)
  for (let y = y0 - 1; y <= y0 + 1; y++) {
    for (let x = x0 - 1; x <= x0 + 1; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
      const i = idx(x, y, p.z)
      if (state.tiles[i] !== 'gone') continue
      state.tiles[i] = 'solid'
      state.warnAt[i] = 0
      state.warnBy[i] = 0
    }
  }
}

/** Flags the tile under the nearest living rival, and signs it. */
function sinkholeNearest(state, p) {
  const target = nearestRival(state, p)
  if (!target) return
  const i = tileUnder(state, target)
  if (state.tiles[i] !== 'solid') return
  state.tiles[i] = 'warn'
  state.warnAt[i] = state.now + WARNING_MS
  // Signed, so the elimination it causes is credited rather than blamed on the
  // floor.
  state.warnBy[i] = p.id
}

/**
 * Hops up to BLINK_TILES the way you last moved, over anything in between. Only
 * the landing tile has to be somewhere you could stand, which is the point: it
 * is the one thing in the kit that crosses a hole.
 */
function blink(state, p) {
  const [dx, dy] = p.face
  for (let n = BLINK_TILES; n >= 1; n--) {
    const x = Math.floor(p.x) + Math.round(dx) * n
    const y = Math.floor(p.y) + Math.round(dy) * n
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
    if (state.tiles[idx(x, y, p.z)] === 'gone') continue
    p.x = x + 0.5
    p.y = y + 0.5
    return true
  }
  return false
}

/**
 * Trades places with the nearest living rival, height included.
 *
 * Zero-sum, and that is what makes it worth carrying next to `lift`: the stack
 * has exactly as much height after a swap as before, so taking a floor means
 * somebody else loses one.
 */
function swap(state, p) {
  const target = nearestRival(state, p)
  // Mid-drop there is no place to trade — a body between two floors is not
  // standing anywhere.
  if (!target || p.fallUntil || target.fallUntil) return false
  const x = p.x
  const y = p.y
  const z = p.z
  p.x = target.x
  p.y = target.y
  p.z = target.z
  target.x = x
  target.y = y
  target.z = z
  return true
}

/**
 * Climbs one floor. The only thing in the game that creates height.
 *
 * Refused on the top floor rather than eaten, and refused mid-drop: a lift out
 * of a fall would undo the cost of the fall, which is the one thing the whole
 * design is built to charge for.
 */
function lift(state, p) {
  if (p.z <= 0 || p.fallUntil) return false
  p.z -= 1
  return true
}

/**
 * Drives every rival within SHOVE_RADIUS on YOUR OWN FLOOR back SHOVE_DIST.
 *
 * Same floor only. A kinetic wave does not travel through a slab, and a shove
 * that reached other floors would be unreadable from any camera angle.
 *
 * On a flat board this was an outright kill when it landed somebody in a hole,
 * which made it the swingiest thing in the kit. Here it obeys the same grammar
 * as everything else: it drives them down a floor with your name on it, and the
 * void collects. Hovering rivals ride it out.
 */
function shoveRivals(state, p) {
  let any = false
  for (const o of state.players) {
    // Same skip list as swap: a body mid-drop is not
    // standing anywhere, so there is nowhere for a shove to drive it from —
    // without this it got teleported sideways in the air, and startFall's
    // early return (already falling) silently ate the credit.
    if (o === p || !o.playing || !o.alive || o.fallUntil || o.z !== p.z) continue
    const dx = o.x - p.x
    const dy = o.y - p.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) > SHOVE_RADIUS) continue

    any = true
    const sx = Math.sign(dx) || (dy === 0 ? Math.sign(p.face[0]) : 0)
    const sy = Math.sign(dy) || (dx === 0 ? Math.sign(p.face[1]) : 0)
    o.x = Math.max(0, Math.min(SIZE, o.x + sx * SHOVE_DIST))
    o.y = Math.max(0, Math.min(SIZE, o.y + sy * SHOVE_DIST))
    // Whether that put them over nothing is resolveFalls' business. Credit it
    // here, so the drop it causes is yours.
    if (state.tiles[tileUnder(state, o)] === 'gone') startFall(state, o, p.id)
  }
  return any
}

/** Lays BRIDGE_TILES of floor forward from your facing, on your own floor. */
function buildBridge(state, p) {
  const [dx, dy] = p.face
  let laid = 0
  for (let n = 1; n <= BRIDGE_TILES; n++) {
    const x = Math.floor(p.x) + Math.round(dx) * n
    const y = Math.floor(p.y) + Math.round(dy) * n
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) break
    const i = idx(x, y, p.z)
    if (state.tiles[i] !== 'gone') continue
    state.tiles[i] = 'solid'
    state.warnAt[i] = 0
    state.warnBy[i] = 0
    laid++
  }
  return laid > 0
}

/**
 * Hardens the 3x3 around you against the next wave to touch it.
 *
 * The only item in the kit that resists a collapse instead of repairing after
 * one. Each plated tile absorbs exactly one hit, spending the plating, so an
 * anchor buys a wave and not a permanent floor. Task 5's `collapse` and
 * `resolveWarnings` are where it is spent.
 */
function anchorAround(state, p) {
  const x0 = Math.floor(p.x)
  const y0 = Math.floor(p.y)
  for (let y = y0 - 1; y <= y0 + 1; y++) {
    for (let x = x0 - 1; x <= x0 + 1; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
      const i = idx(x, y, p.z)
      // Plating goes on standing floor. It is armour, not a repair.
      if (state.tiles[i] === 'gone') continue
      // A flagged tile keeps its flag. The plate is what saves it when the
      // warning resolves, and resolveWarnings spends the plate doing it — so an
      // anchor answers a wave you can see coming without cancelling it free.
      state.reinforced.add(i)
    }
  }
}

/** Spends the held powerup. Returns false, silently, if there is nothing to spend. */
export function usePowerup(state, id) {
  if (state.phase !== 'playing') return false

  const p = state.players.find((q) => q.id === id)
  if (!p || !p.playing || !p.alive || !p.held) return false

  const kind = p.held
  p.held = null

  if (kind === 'shield') p.shielded = true
  else if (kind === 'dash') p.dashUntil = state.now + DASH_MS
  else if (kind === 'patch') patchAround(state, p)
  else if (kind === 'sinkhole') sinkholeNearest(state, p)
  else if (kind === 'foresight') p.seeingUntil = state.now + FORESIGHT_MS
  else if (kind === 'hover') p.hoverUntil = state.now + HOVER_MS
  else if (kind === 'anchor') anchorAround(state, p)
  else if (kind === 'blink' && !blink(state, p)) {
    // Nowhere to land. Keep it rather than eat it for a hop into the void.
    p.held = kind
    return false
  } else if (kind === 'swap' && !swap(state, p)) {
    p.held = kind
    return false
  } else if (kind === 'shove' && !shoveRivals(state, p)) {
    // Nobody in range. Keep it rather than spend it on empty air.
    p.held = kind
    return false
  } else if (kind === 'bridge' && !buildBridge(state, p)) {
    p.held = kind
    return false
  } else if (kind === 'lift' && !lift(state, p)) {
    p.held = kind
    return false
  }
  return true
}

/** Left-click: use held item if any, otherwise start a dash. */
export function handleClick(state, id) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.playing || !p.alive) return false
  if (p.held) return usePowerup(state, id)
  // No item held: short dash burst
  if (state.now >= p.dashUntil) {
    p.dashUntil = state.now + DASH_MS
    return true
  }
  return false
}

/** How many tiles the next wave takes, given how much stack is left to take. */
export const waveSize = (solid) =>
  Math.max(1, Math.min(COLLAPSE_COUNT, Math.ceil(solid * COLLAPSE_SHARE)))

/**
 * How long until the next wave, given how much stack is left.
 *
 * Full stack is COLLAPSE_EVERY_MS and an empty one is COLLAPSE_FASTEST_MS,
 * straight between. Paired with `waveSize`, the round takes less and less at a
 * time and takes it faster and faster — they are two halves of one trade and
 * neither works alone.
 */
export const collapseDelay = (solid) => {
  const share = Math.max(0, Math.min(1, solid / TOTAL))
  return Math.round(COLLAPSE_FASTEST_MS + (COLLAPSE_EVERY_MS - COLLAPSE_FASTEST_MS) * share)
}

/**
 * Chooses which tiles the NEXT wave will take, uniformly over every surviving
 * tile on a floor with a living player on it.
 *
 * Picked ahead of time rather than at the moment it fires, because foresight
 * has to be able to show it. Uniform and never clustered *within a floor*:
 * this is the only place any of it is decided, so what a foresight shows is
 * exactly what lands.
 *
 * NOT uniform across the whole stack, unlike the flat game this was forked
 * from. That was the first cut, and 30 seeded rounds against bots measured it
 * at 53% of drops chaining straight into a second, uncontestable drop —
 * majority, not the minority the design's open question wanted. The cause:
 * floors nobody was standing on kept eroding right alongside floor 0, so a
 * fall onto floor 2 or 3 routinely landed on ground that was already gone,
 * with no warning anyone could have seen because nobody was there to see it.
 * Restricting the candidate list to occupied floors dropped that to 38%,
 * still measured over 30 rounds (see COLLAPSE_EVERY_MS for the pacing change
 * made alongside it). An empty stack (nobody playing) falls back to every
 * solid tile so a wave is still defined between rounds.
 *
 * This is a deliberate departure from flat Blockout's uniform-across-the-board
 * rule — CLAUDE.md carries the invariant and the reasoning for both games.
 */
function pickWave(state, rng) {
  const occupied = new Set(
    state.players.filter((p) => p.playing && p.alive).map((p) => p.z),
  )
  const solid = []
  for (let i = 0; i < TOTAL; i++) {
    if (state.tiles[i] !== 'solid') continue
    if (occupied.size > 0 && !occupied.has((i / (SIZE * SIZE)) | 0)) continue
    solid.push(i)
  }
  const take = waveSize(solid.length)
  const wave = []
  for (let n = 0; n < take && solid.length > 0; n++) {
    wave.push(solid.splice(Math.floor(rng() * solid.length), 1)[0])
  }
  return wave
}

export function collapse(state, rng) {
  for (const i of state.nextWave) {
    // A tile can be patched or already flagged between the pick and the wave.
    if (state.tiles[i] !== 'solid') continue
    // Reinforcement absorbs exactly one hit and is spent doing it, so an anchor
    // buys a wave rather than a permanent floor.
    if (state.reinforced.has(i)) {
      state.reinforced.delete(i)
      continue
    }
    state.tiles[i] = 'warn'
    state.warnAt[i] = state.now + WARNING_MS
    state.warnBy[i] = 0
  }
  state.nextWave = pickWave(state, rng)
}

/**
 * Turns due warnings into holes, and starts the fall of whoever was on them.
 *
 * The fall begins HERE rather than in `resolveFalls`, because this is the last
 * place that still knows who caused it. By the time `resolveFalls` runs, a tile
 * that just collapsed under somebody is indistinguishable from a hole they
 * walked into, and a sinkhole kill would go uncredited.
 */
export function resolveWarnings(state) {
  for (let i = 0; i < TOTAL; i++) {
    if (state.tiles[i] !== 'warn' || state.now < state.warnAt[i]) continue
    // A tile can be anchored after it was already flagged. Spend the plating
    // and put the tile back rather than taking it.
    if (state.reinforced.has(i)) {
      state.reinforced.delete(i)
      state.tiles[i] = 'solid'
      state.warnAt[i] = 0
      state.warnBy[i] = 0
      continue
    }
    state.tiles[i] = 'gone'
    // A pickup sitting on a collapsing tile goes down with it.
    delete state.powerups[i]
    for (const p of state.players) {
      if (!p.playing || !p.alive || p.fallUntil) continue
      if (tileUnder(state, p) === i) startFall(state, p, state.warnBy[i])
    }
  }
}

/**
 * Prunes powerups on abandoned floors where no living players reside.
 */
function prunePowerups(state) {
  const occupied = new Set(
    state.players.filter((p) => p.playing && p.alive).map((p) => p.z),
  )
  if (occupied.size === 0) return
  for (const key of Object.keys(state.powerups)) {
    const z = (Number(key) / (SIZE * SIZE)) | 0
    if (!occupied.has(z)) delete state.powerups[key]
  }
}

/**
 * Places a powerup on a surviving solid tile on a floor with a living player.
 *
 * Restricting powerups to occupied floors ensures pickups are reachable on
 * the active platform rather than accumulating on abandoned floors.
 * Unoccupied floors have their powerups pruned so lower levels always get
 * their full quota of powerups.
 * An empty stack falls back to every solid tile so seeding works before
 * players are seated.
 */
function spawnPowerup(state, rng) {
  prunePowerups(state)
  const occupied = new Set(
    state.players.filter((p) => p.playing && p.alive).map((p) => p.z),
  )
  if (occupied.size === 0) {
    if (Object.keys(state.powerups).length >= POWERUP_MAX) return
    const free = []
    for (let i = 0; i < TOTAL; i++) {
      if (state.tiles[i] !== 'solid') continue
      if (Object.hasOwn(state.powerups, i)) continue
      free.push(i)
    }
    if (free.length === 0) return
    const i = free[Math.floor(rng() * free.length)]
    state.powerups[i] = POWERUP_BAG[Math.floor(rng() * POWERUP_BAG.length)]
    return
  }

  // Find occupied floors that haven't reached POWERUP_FLOOR_MAX
  const eligible = [...occupied].filter((z) => {
    const count = Object.keys(state.powerups).filter(
      (k) => ((Number(k) / (SIZE * SIZE)) | 0) === z,
    ).length
    return count < POWERUP_FLOOR_MAX
  })
  if (eligible.length === 0) return

  // Prioritize occupied floor with fewest powerups
  eligible.sort((a, b) => {
    const ca = Object.keys(state.powerups).filter((k) => ((Number(k) / (SIZE * SIZE)) | 0) === a).length
    const cb = Object.keys(state.powerups).filter((k) => ((Number(k) / (SIZE * SIZE)) | 0) === b).length
    return ca - cb
  })
  const targetFloor = eligible[0]

  const base = targetFloor * SIZE * SIZE
  const free = []
  for (let n = 0; n < SIZE * SIZE; n++) {
    const i = base + n
    if (state.tiles[i] !== 'solid') continue
    if (Object.hasOwn(state.powerups, i)) continue
    if (state.players.some((p) => p.playing && p.alive && tileUnder(state, p) === i)) continue
    free.push(i)
  }
  if (free.length === 0) return
  const i = free[Math.floor(rng() * free.length)]
  state.powerups[i] = POWERUP_BAG[Math.floor(rng() * POWERUP_BAG.length)]
}

export { spawnPowerup, prunePowerups }

/**
 * A step towards the nearest tile on this floor that satisfies `want`, over
 * ground that is still standing. Warned tiles are passable — sometimes crossing
 * one is the only way off an island — but they are never a destination.
 */
function stepTo(state, p, want) {
  const z = p.z
  const start = tileUnder(state, p)
  const seen = new Set([start])
  const queue = [[start, null]]

  for (let head = 0; head < queue.length; head++) {
    const [i, first] = queue[head]
    if (first !== null && want(i)) return first
    const [x, y] = xyz(i)
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
      const j = idx(nx, ny, z)
      if (seen.has(j) || state.tiles[j] === 'gone') continue
      seen.add(j)
      queue.push([j, first ?? [dx, dy]])
    }
  }
  return null
}

/** How much standing ground a tile can reach, capped — a crude island size. */
function roomAround(state, i, cap = 24) {
  if (state.tiles[i] !== 'solid') return 0
  const z = xyz(i)[2]
  const seen = new Set([i])
  const queue = [i]
  for (let head = 0; head < queue.length && seen.size < cap; head++) {
    const [x, y] = xyz(queue[head])
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
      const j = idx(nx, ny, z)
      if (seen.has(j) || state.tiles[j] !== 'solid') continue
      seen.add(j)
      queue.push(j)
    }
  }
  return seen.size
}

/**
 * One decision per bot per BOT_REACT_MS, expressed as an input direction and
 * nothing else — a bot has exactly the vocabulary a client has.
 *
 * The order is: get off a tile that is about to go, then take anything lying
 * around, then work towards the biggest piece of floor left. Depth is not part
 * of it: a bot that understood the void would be a different project, and one
 * that walks its own floor competently is already an opponent.
 */
export function driveBots(state, rng = Math.random) {
  for (const b of state.players) {
    if (!b.bot || !b.playing || !b.alive || state.now < b.thinkAt) continue
    b.thinkAt = state.now + BOT_REACT_MS

    if (b.held) usePowerup(state, b.id)
    if (b.fallUntil) continue

    const here = tileUnder(state, b)

    // Bots jump to escape warned or broken tiles
    if (state.tiles[here] === 'warn' || state.tiles[here] === 'gone') {
      jump(state, b.id)
    }

    const safe = (i) => state.tiles[i] === 'solid'

    let step = state.tiles[here] === 'warn' ? stepTo(state, b, safe) : null

    if (!step && !b.held) {
      step = stepTo(state, b, (i) => safe(i) && Object.hasOwn(state.powerups, i))
    }

    if (!step) {
      const room = roomAround(state, here)
      if (room < 12) step = stepTo(state, b, (i) => safe(i) && roomAround(state, i) > room)
    }

    if (!step) {
      // Nothing worth doing: shuffle, rather than stand on one tile waiting for
      // it to be the one that goes.
      const open = DIRS.filter(([dx, dy]) => {
        const x = Math.floor(b.x) + dx
        const y = Math.floor(b.y) + dy
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false
        return state.tiles[idx(x, y, b.z)] === 'solid'
      })
      if (open.length > 0) step = open[Math.floor(rng() * open.length)]
    }

    input(state, b.id, step ?? [0, 0])
  }
}

/** Whether the void is close enough to be shown as a warning. */
export const voidWarning = (state) =>
  Number.isFinite(state.voidAt) && state.now >= state.voidAt - VOID_WARN_MS

/**
 * Takes the bottom floor, and everyone still standing on it or falling into it.
 *
 * This exists for the reason Blastworks' closing wall exists. Without it the
 * correct play is to stay on the top floor and never descend, and the match is
 * one flat Blockout round with four unused floors decorating it. Height has to
 * cost something to hold.
 *
 * Floor 0 is never eaten. Once it is all that is left the game IS a flat
 * Blockout round, which is the ending this is built to reach.
 */
export function consumeFloor(state) {
  if (state.bottom <= 0) {
    state.voidAt = Infinity
    return
  }
  const z = state.bottom
  for (let n = 0; n < SIZE * SIZE; n++) {
    const i = z * SIZE * SIZE + n
    state.tiles[i] = 'gone'
    state.warnAt[i] = 0
    state.warnBy[i] = 0
    delete state.powerups[i]
    state.reinforced.delete(i)
  }
  for (const p of state.players) {
    if (!p.playing || !p.alive) continue
    // Mid-drop onto a floor that is no longer there counts as being on it.
    if (p.z === z || (p.fallUntil && p.z === z - 1)) eliminate(state, p, 0)
  }
  state.bottom = z - 1
  state.voidAt = state.bottom > 0 ? state.now + VOID_EVERY_MS : Infinity
}

function startCountdown(state) {
  state.phase = 'countdown'
  state.phaseUntil = state.now + COUNTDOWN_MS
  state.winner = null
  state.winnerId = null
  state.final = false
}

function endRound(state, survivor) {
  state.phase = 'over'
  state.winner = survivor ? survivor.name : null
  state.winnerId = survivor ? survivor.id : null
  state.phaseUntil = state.now + OVER_MS
  // Safe here: once the phase is 'over', tick's early return means the playing
  // branch cannot run again this round, so this counts exactly once.
  if (survivor) survivor.wins += 1
  // Read after the increment, so the round that reaches the target ends it.
  state.final = !!survivor && survivor.wins >= ROUND_TARGET
}

/**
 * Advances the match by dt milliseconds. `rng` is injectable so the collapse
 * order is deterministic under test; nothing else uses it.
 */
export function tick(state, dt, rng = Math.random) {
  state.now += dt
  ensureBots(state)

  if (!canRun(state) && state.phase !== 'waiting') {
    // The last person left mid-round. Stand it down rather than let the bots
    // play it out to an empty room.
    state.phase = 'waiting'
    state.winner = null
    state.winnerId = null
  }

  if (state.phase === 'waiting') {
    if (canRun(state) && state.players.length >= MIN_PLAYERS) startCountdown(state)
    return
  }

  if (state.phase === 'countdown') {
    if (!canRun(state) || state.players.length < MIN_PLAYERS) {
      state.phase = 'waiting'
    } else if (state.now >= state.phaseUntil) {
      startRound(state, rng)
    }
    return
  }

  if (state.phase === 'over') {
    if (state.now < state.phaseUntil) return
    if (state.final) for (const p of state.players) p.wins = 0
    if (state.players.length >= MIN_PLAYERS) {
      startCountdown(state)
    } else {
      state.phase = 'waiting'
      state.winner = null
      state.winnerId = null
      state.final = false
    }
    return
  }

  // playing
  driveBots(state, rng)
  stepPlayers(state, dt)

  // The climb, and the settle back down afterwards.
  //
  // `lift` is how many floors above `z` the body is floating, always under one:
  // the moment it would pass a whole floor the body simply belongs to the floor
  // above, so `z` drops and the climb starts again from there. That keeps the
  // rise continuous on the wire without ever putting a body somewhere the tile
  // lookup cannot answer for.
  //
  // On the top floor there is nothing above to arrive at, so the lift clamps
  // short of a full floor and the body hangs over the stack instead. That is
  // the difference between hover doing something on floor 0 and hover looking
  // broken there, which is where a round starts and most of it is spent.
  const rise = JETPACK_RISE * (dt / 1000)
  for (const p of state.players) {
    if (!p.playing || !p.alive) {
      p.lift = 0
      continue
    }
    if (state.now < p.hoverUntil && !p.fallUntil) {
      p.lift += rise
      if (p.z > 0 && p.lift >= 1) {
        p.lift -= 1
        p.z -= 1 // lower z is a higher floor
      } else if (p.z === 0) {
        p.lift = Math.min(LIFT_CEILING, p.lift)
      }
    } else if (p.lift > 0) {
      // Settling, not snapping. Whether there is anything under you to settle
      // onto is resolveFalls' business, as it is for every other way down.
      p.lift = Math.max(0, p.lift - rise)
    }
  }

  while (state.now >= state.nextCollapseAt) {
    // Read before the wave lands, so the gap that follows is paced by the floor
    // the players are actually standing on.
    collapse(state, rng)
    state.nextCollapseAt += collapseDelay(
      state.tiles.reduce((n, t) => (t === 'solid' ? n + 1 : n), 0),
    )
  }
  while (state.now >= state.nextPowerupAt) {
    spawnPowerup(state, rng)
    state.nextPowerupAt += POWERUP_EVERY_MS
  }
  while (state.now >= state.voidAt) consumeFloor(state)

  // A floor somebody is standing on is never bare. Only seeded, not filled:
  // POWERUP_EVERY_MS is what grows it to POWERUP_FLOOR_MAX from there.
  const occupied = new Set(
    state.players.filter((p) => p.playing && p.alive).map((p) => p.z),
  )
  for (const z of occupied) {
    let count = Object.keys(state.powerups).filter(
      (k) => ((Number(k) / (SIZE * SIZE)) | 0) === z,
    ).length
    while (count < POWERUP_FLOOR_SEED) {
      const before = Object.keys(state.powerups).length
      spawnPowerup(state, rng)
      if (Object.keys(state.powerups).length === before) break
      count++
    }
  }

  resolveWarnings(state)
  resolveFalls(state)
  pickUp(state)

  const standing = state.players.filter((p) => p.playing && p.alive)
  if (standing.length <= 1) endRound(state, standing[0] ?? null)
}

/**
 * The one message shape broadcast to clients.
 *
 * `viewerId` is optional and changes exactly one field: somebody holding a
 * foresight is told which tiles the next wave will take. That is the only
 * per-viewer information in any of these games, and it is why this takes an
 * argument at all — the alternative was broadcasting the next wave to everyone
 * and hiding it in the client, which would be a lie on a protocol whose whole
 * point is being readable off the wire.
 */
export function snapshot(state, viewerId = null) {
  const timed = state.phase === 'countdown' || state.phase === 'over'
  const viewer = viewerId === null ? null : state.players.find((p) => p.id === viewerId)
  const seeing = !!viewer && state.now < viewer.seeingUntil
  return {
    soon: seeing ? state.nextWave : [],
    t: 'state',
    phase: state.phase,
    size: SIZE,
    floors: FLOORS,
    bottom: state.bottom,
    voidIn: Number.isFinite(state.voidAt)
      ? Math.max(0, Math.ceil((state.voidAt - state.now) / 1000))
      : 0,
    voidWarning: voidWarning(state),
    secs: timed ? Math.max(0, Math.ceil((state.phaseUntil - state.now) / 1000)) : 0,
    winner: state.winner,
    winnerId: state.winnerId,
    final: state.final,
    target: ROUND_TARGET,
    board: state.board,
    arenas: state.arenas,
    min: MIN_PLAYERS,
    botsWanted: state.botsWanted,
    botsOnly: state.botsOnly,
    tiles: tileString(state.tiles),
    // Plated tiles look like ordinary floor in the tile string, so they ship
    // separately or a player cannot see what their anchor bought.
    reinforced: Array.from(state.reinforced),
    powerups: state.powerups,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      z: p.z,
      // 0 grounded, 1 landed. The client draws the body at z + fall and needs
      // to know nothing else about how a drop works.
      // One signed field for the whole vertical story: positive is a drop in
      // progress, negative is a hover holding you above your floor. The
      // renderer draws height as -(z + fall), so this needs nothing there.
      fall: p.fallUntil
        ? Math.max(0, Math.min(1, 1 - (p.fallUntil - state.now) / FALL_MS))
        : -p.lift,
      playing: p.playing,
      alive: p.alive,
      wins: p.wins,
      kills: p.kills,
      deaths: p.deaths,
      held: p.held,
      shielded: p.shielded,
      dashing: state.now < p.dashUntil,
      hovering: state.now < p.hoverUntil,
      seeing: state.now < p.seeingUntil,
      jumping: state.now < p.jumpUntil,
      jumpProgress: p.jumpUntil && state.now < p.jumpUntil
        ? Math.max(0, Math.min(1, 1 - (p.jumpUntil - state.now) / JUMP_DURATION_MS))
        : 0,
    })),
  }
}
