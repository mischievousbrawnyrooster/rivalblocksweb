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
export const TICK_MS = 33

export const SPEED_BASE = 4.4 // tiles/second on the ground
export const AIR_SPEED = 2.6 // steering authority mid-drop
export const FALL_MS = 480 // per floor
export const DASH_MS = 2500
export const DASH_MULT = 1.7

export const COLLAPSE_EVERY_MS = 900
export const COLLAPSE_COUNT = 8
export const COLLAPSE_SHARE = 0.06
export const COLLAPSE_FASTEST_MS = 260
export const WARNING_MS = 1500

export const VOID_FIRST_MS = 60000
export const VOID_EVERY_MS = 35000
export const VOID_WARN_MS = 8000

export const STOMP_COOLDOWN_MS = 6000
export const STOMP_WINDUP_MS = 350

export const BLINK_TILES = 3
export const FORESIGHT_MS = 6000

export const COUNTDOWN_MS = 3000
export const OVER_MS = 5000
export const MIN_PLAYERS = 2
export const ROUND_TARGET = 3

export const POWERUP_EVERY_MS = 1600
export const POWERUP_MAX = 12

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

// One character per tile on the wire. 845 tiles as quoted words is 300 KB/s per
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
    stompAt: 0,
    stompReadyAt: 0,
    thinkAt: 0,
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
    p.dir = [0, 0]
    p.face = [1, 0]
    p.fallUntil = 0
    p.fallBy = 0
    p.stompAt = 0
    p.stompReadyAt = 0
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

/** Advances every body by dt, on the ground or in the air. */
export function stepPlayers(state, dt) {
  const secs = dt / 1000
  for (const p of state.players) {
    if (!p.playing || !p.alive) continue
    const [dx, dy] = p.dir
    if (dx === 0 && dy === 0) continue
    const speed = p.fallUntil
      ? AIR_SPEED
      : SPEED_BASE * (state.now < p.dashUntil ? DASH_MULT : 1)
    // Clamped to the grid rather than to the arena: the arena edge is carved
    // `gone`, so walking off it is a fall and needs no rule of its own.
    p.x = Math.max(0, Math.min(SIZE, p.x + dx * speed * secs))
    p.y = Math.max(0, Math.min(SIZE, p.y + dy * speed * secs))
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
  // here rather than at each call site covers a hole, a stomp underfoot, a
  // collapsing tile and a shove in one line, because all four drop you through
  // this function.
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
 * causes. That is what makes a stomp into a hole above a rival a play rather
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

    if (!p.fallUntil && state.tiles[tileUnder(state, p)] === 'gone') {
      // A warned tile is still floor. Only a hole drops you.
      startFall(state, p, landed ? p.fallBy : 0)
    }
  }
}

/**
 * Winds up a stomp. Returns false, silently, if there is nothing to break or
 * the boots are not ready.
 *
 * The windup is the telegraph. Resolving on the keypress made a stomp
 * unreactable, which would waste the whole reason bodies move continuously.
 */
export function stomp(state, id) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.playing || !p.alive || p.fallUntil) return false
  if (p.stompAt || state.now < p.stompReadyAt) return false
  if (state.tiles[tileUnder(state, p)] === 'gone') return false
  p.stompAt = state.now + STOMP_WINDUP_MS
  p.stompReadyAt = state.now + STOMP_WINDUP_MS + STOMP_COOLDOWN_MS
  return true
}

/** Lands the stomps that are due. */
export function resolveStomps(state) {
  for (const p of state.players) {
    if (!p.stompAt || state.now < p.stompAt) continue
    p.stompAt = 0
    if (!p.playing || !p.alive || p.fallUntil) continue
    const i = tileUnder(state, p)
    if (state.tiles[i] === 'gone') continue
    state.tiles[i] = 'gone'
    delete state.powerups[i]
    // Anyone else over it goes down too, and it is the stomper's doing.
    for (const o of state.players) {
      if (o === p || !o.playing || !o.alive || o.fallUntil) continue
      if (o.z === p.z && tileUnder(state, o) === i) startFall(state, o, p.id)
    }
  }
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
export const BRIDGE_TILES = 4

// How often a kind comes up, against one for everything not listed.
//
// Patch is the only thing in the kit that gives floor back, on a board whose
// whole premise is losing it, so it is the one worth crossing a floor for.
//
// `lift` is deliberately NOT weighted. It is the only item that creates height
// rather than moving it, so every one collected adds a life the void then has
// to spend time eating. One draw in ten is the rarest this bag can express;
// anything rarer needs the bag to change, not the number.
export const POWERUP_WEIGHTS = { patch: 3 }

// Built from POWERUP_KINDS rather than written out, so a kind added above
// cannot be left out of the draw by accident.
const POWERUP_BAG = POWERUP_KINDS.flatMap((kind) =>
  Array(Object.hasOwn(POWERUP_WEIGHTS, kind) ? POWERUP_WEIGHTS[kind] : 1).fill(kind),
)

// A floor apart is worth a whole board's width, so `nearest` means nearest on
// your own floor unless there is genuinely nobody there.
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
    if (o === p || !o.playing || !o.alive || o.z !== p.z) continue
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
 * tile in the whole stack.
 *
 * Picked ahead of time rather than at the moment it fires, because foresight
 * has to be able to show it. Uniform and never clustered: this is the only
 * place any of it is decided, so what a foresight shows is exactly what lands.
 */
function pickWave(state, rng) {
  const solid = []
  for (let i = 0; i < TOTAL; i++) {
    if (state.tiles[i] === 'solid') solid.push(i)
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

function spawnPowerup(state, rng) {
  if (Object.keys(state.powerups).length >= POWERUP_MAX) return
  const free = []
  for (let i = 0; i < TOTAL; i++) {
    if (state.tiles[i] !== 'solid') continue
    if (Object.hasOwn(state.powerups, i)) continue
    if (state.players.some((p) => p.playing && p.alive && tileUnder(state, p) === i)) continue
    free.push(i)
  }
  if (free.length === 0) return
  const i = free[Math.floor(rng() * free.length)]
  state.powerups[i] = POWERUP_BAG[Math.floor(rng() * POWERUP_BAG.length)]
}

export { spawnPowerup }

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
