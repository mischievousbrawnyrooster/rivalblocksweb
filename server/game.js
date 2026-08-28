// Rules for one Blockout Royale match. Pure: no sockets, no Node APIs, no
// imports. Everything here is exercised by game.test.js.

// --- Tuning ------------------------------------------------------------
// The collapse rate is what decides whether a round is tense or tedious, and
// no amount of reasoning settles it. Play the game and move the numbers.
// SIZE and COLLAPSE_COUNT move together: a round lasts roughly
// (SIZE^2 / COLLAPSE_COUNT) * COLLAPSE_EVERY_MS, so growing the arena without
// collapsing faster just makes rounds drag. 15x15 at 6 per wave is ~34s —
// a little longer than the old 9x9, because there is more ground to use.
// Going further: 17 wants COLLAPSE_COUNT 8, 19 wants 10. Past about 19 the
// tiles get too small to read on a phone, which is the real ceiling.
export const SIZE = 15
export const TICK_MS = 100
export const MOVE_COOLDOWN_MS = 120
export const COLLAPSE_EVERY_MS = 900
export const COLLAPSE_COUNT = 6
export const WARNING_MS = 1500
export const COUNTDOWN_MS = 3000
export const OVER_MS = 5000
export const MIN_PLAYERS = 2

// Powerups. You carry at most one and spend it when you choose, so the
// decision is which to keep and when to fire it.
export const POWERUP_EVERY_MS = 4000
// Scaled with the arena, or a bigger board just means longer walks between
// pickups. Roughly one per 45 tiles.
export const POWERUP_MAX = 5
export const POWERUP_KINDS = ['shield', 'dash', 'sinkhole', 'patch']
export const DASH_MS = 2500
// `now` only ever advances inside tick(), so every move message arriving
// between two ticks reads the same clock. Any cooldown above zero therefore
// means exactly one move per tick — double normal speed, and still bounded no
// matter how fast a client sends. A zero cooldown would remove that bound and
// let a scripted client cross the board within a single tick.
export const DASH_COOLDOWN_MS = 50

// Opposite corners first, so a two-player round starts as far apart as it can,
// then the other diagonal, then the edge midpoints. Filling in that order
// keeps a small round spread out instead of clustered down one side.
const MID = Math.floor((SIZE - 1) / 2)
export const SPAWNS = [
  [0, 0],
  [SIZE - 1, SIZE - 1],
  [SIZE - 1, 0],
  [0, SIZE - 1],
  [MID, 0],
  [MID, SIZE - 1],
  [0, MID],
  [SIZE - 1, MID],
]

// Derived, never hand-written: startRound indexes SPAWNS by player, so a
// capacity larger than the spawn list would put a player at undefined.
// To raise capacity, add spawn points above.
export const MAX_PLAYERS = SPAWNS.length

const NAME_MAX = 16

// A unit test rather than a regex range. An escape sequence for a control
// character is exactly the kind of thing an editor or a copy-paste silently
// mangles; arithmetic on the code unit cannot be mangled. Note: split('')
// iterates UTF-16 code units, not code points, so a surrogate pair is seen
// as two units here — both are above the control-character range anyway.
const isPrintable = (ch) => {
  const code = ch.codePointAt(0)
  return code > 31 && code !== 127
}

/** Trims, strips control characters, caps length, and never returns empty. */
export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    // Bound the input before the expensive per-character work below, so an
    // oversized frame can't force a huge split/filter/join allocation.
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
    tiles: new Array(SIZE * SIZE).fill('solid'),
    warnAt: new Array(SIZE * SIZE).fill(0),
    nextCollapseAt: Infinity,
    // Sparse: tile index -> kind. Only occupied tiles appear, which keeps the
    // broadcast small and the Wireshark view readable.
    powerups: {},
    nextPowerupAt: Infinity,
    arena: 'square',
    players: [],
    nextId: 1,
    winner: null,
  }
}

/** Joins the match. A piece is only handed out when a round starts. */
export function addPlayer(state, name) {
  const player = {
    id: state.nextId++,
    name: sanitizeName(name),
    playing: false,
    alive: false,
    x: 0,
    y: 0,
    lastMoveAt: 0,
    // ponytail: score lives on the connection, so a reload resets it. Key it
    // by name in a separate map only if people start caring about that.
    wins: 0,
    held: null,
    shielded: false,
    dashUntil: 0,
  }
  state.players.push(player)
  return player
}

export function removePlayer(state, id) {
  const i = state.players.findIndex((p) => p.id === id)
  if (i !== -1) state.players.splice(i, 1)
}

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

// The grid stays square; the ARENA is carved out of it by starting some tiles
// already gone. Nothing downstream needs to know — holes are holes, whether
// the collapse made them or the generator did.
// `square` is first so a fixed rng of 0 gives the plain board under test.
export const ARENAS = ['square', 'disc', 'diamond', 'cross', 'ring', 'scatter']

function carve(state, arena, rng) {
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
      if (!solid) state.tiles[y * SIZE + x] = 'gone'
    }
  }
}

/**
 * Fills in every solid region except the largest. Without this a generator
 * could strand players on islands that never meet, and `scatter` eventually
 * would. Makes any future shape safe by construction.
 */
function keepLargestRegion(state) {
  const n = state.tiles.length
  const seen = new Int16Array(n).fill(-1)
  let largest = []
  let id = 0

  for (let start = 0; start < n; start++) {
    if (state.tiles[start] !== 'solid' || seen[start] !== -1) continue
    const cells = [start]
    seen[start] = id
    for (let head = 0; head < cells.length; head++) {
      const i = cells[head]
      const x = i % SIZE
      const y = (i / SIZE) | 0
      for (const [dx, dy] of Object.values(DIRS)) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
        const j = ny * SIZE + nx
        if (state.tiles[j] !== 'solid' || seen[j] !== -1) continue
        seen[j] = id
        cells.push(j)
      }
    }
    if (cells.length > largest.length) largest = cells
    id++
  }

  const keep = new Set(largest)
  for (let i = 0; i < n; i++) {
    if (state.tiles[i] === 'solid' && !keep.has(i)) state.tiles[i] = 'gone'
  }
}

/**
 * Moves each spawn to the nearest solid tile, so a carved-away corner never
 * starts someone inside a hole. Claimed tiles are not reused, so two players
 * can never be snapped onto each other.
 */
function snapSpawns(state) {
  const exits = (i) => {
    const x = i % SIZE
    const y = (i / SIZE) | 0
    let n = 0
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
      if (state.tiles[ny * SIZE + nx] === 'solid') n++
    }
    return n
  }

  const taken = new Set()
  return SPAWNS.map(([sx, sy]) => {
    let best = -1
    let bestKey = Infinity
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] !== 'solid' || taken.has(i)) continue
      const dx = (i % SIZE) - sx
      const dy = ((i / SIZE) | 0) - sy
      // A tile with a single exit is a death trap the moment that exit goes,
      // so openness outranks proximity. Among equally open tiles, take the
      // nearest to the ideal spawn.
      const key = (exits(i) >= 2 ? 0 : 1) * 1e6 + dx * dx + dy * dy
      if (key < bestKey) {
        bestKey = key
        best = i
      }
    }
    if (best === -1) return [sx, sy]
    taken.add(best)
    return [best % SIZE, (best / SIZE) | 0]
  })
}

/** Clears the board and hands pieces to the first MAX_PLAYERS in join order. */
export function startRound(state, rng = Math.random) {
  state.tiles.fill('solid')
  state.warnAt.fill(0)
  state.winner = null
  state.nextCollapseAt = state.now + COLLAPSE_EVERY_MS
  state.powerups = {}
  state.nextPowerupAt = state.now + POWERUP_EVERY_MS

  state.arena = ARENAS[Math.floor(rng() * ARENAS.length)]
  carve(state, state.arena, rng)
  keepLargestRegion(state)
  const spawns = snapSpawns(state)

  state.players.forEach((p, i) => {
    p.playing = i < MAX_PLAYERS
    p.alive = p.playing
    p.held = null
    p.shielded = false
    p.dashUntil = 0
    if (p.playing) {
      ;[p.x, p.y] = spawns[i]
      // Backdated, or the very first move of the round hits its own cooldown.
      p.lastMoveAt = state.now - MOVE_COOLDOWN_MS
    }
  })
  state.phase = 'playing'
}

/** Applies one step. Returns false, silently, for anything illegal. */
export function move(state, id, dir) {
  if (state.phase !== 'playing') return false

  const p = state.players.find((q) => q.id === id)
  if (!p || !p.playing || !p.alive) return false
  const cooldown = state.now < p.dashUntil ? DASH_COOLDOWN_MS : MOVE_COOLDOWN_MS
  if (state.now - p.lastMoveAt < cooldown) return false

  const step = Object.hasOwn(DIRS, dir) ? DIRS[dir] : null
  if (!step) return false

  const x = p.x + step[0]
  const y = p.y + step[1]
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false
  if (state.tiles[y * SIZE + x] === 'gone') return false
  if (state.players.some((o) => o !== p && o.playing && o.alive && o.x === x && o.y === y)) {
    return false
  }

  p.x = x
  p.y = y
  p.lastMoveAt = state.now

  // Walking onto a powerup picks it up, but only with an empty hand —
  // otherwise it stays on the floor for someone else to take.
  const dest = y * SIZE + x
  if (!p.held && Object.hasOwn(state.powerups, dest)) {
    p.held = state.powerups[dest]
    delete state.powerups[dest]
  }
  return true
}

/** The first adjacent tile that is solid and unoccupied, or null. */
function adjacentSolid(state, p) {
  for (const [dx, dy] of Object.values(DIRS)) {
    const x = p.x + dx
    const y = p.y + dy
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
    if (state.tiles[y * SIZE + x] !== 'solid') continue
    if (state.players.some((o) => o !== p && o.playing && o.alive && o.x === x && o.y === y)) {
      continue
    }
    return [x, y]
  }
  return null
}

/** Rebuilds every hole orthogonally adjacent to the player. */
function patchAround(state, p) {
  for (const [dx, dy] of Object.values(DIRS)) {
    const x = p.x + dx
    const y = p.y + dy
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
    const i = y * SIZE + x
    if (state.tiles[i] !== 'gone') continue
    state.tiles[i] = 'solid'
    state.warnAt[i] = 0
  }
}

/**
 * Flags the tile under the nearest living opponent. Auto-targeted so using a
 * powerup stays a single keypress; ties break by id, never by array order.
 */
function sinkholeNearest(state, p) {
  let target = null
  let best = Infinity
  for (const o of state.players) {
    if (o === p || !o.playing || !o.alive) continue
    const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y)
    if (d < best || (d === best && target !== null && o.id < target.id)) {
      best = d
      target = o
    }
  }
  if (target === null) return
  const i = target.y * SIZE + target.x
  if (state.tiles[i] !== 'solid') return
  state.tiles[i] = 'warn'
  state.warnAt[i] = state.now + WARNING_MS
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
  return true
}

function spawnPowerup(state, rng) {
  if (Object.keys(state.powerups).length >= POWERUP_MAX) return
  const free = []
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] !== 'solid') continue
    if (Object.hasOwn(state.powerups, i)) continue
    if (state.players.some((p) => p.playing && p.alive && p.y * SIZE + p.x === i)) continue
    free.push(i)
  }
  if (free.length === 0) return
  const i = free[Math.floor(rng() * free.length)]
  state.powerups[i] = POWERUP_KINDS[Math.floor(rng() * POWERUP_KINDS.length)]
}

function startCountdown(state) {
  state.phase = 'countdown'
  state.phaseUntil = state.now + COUNTDOWN_MS
  state.winner = null
}

function endRound(state, survivor) {
  state.phase = 'over'
  state.winner = survivor ? survivor.name : null
  state.phaseUntil = state.now + OVER_MS
  // Safe to do here: once the phase is 'over', tick's early return means the
  // playing branch cannot run again this round, so this counts exactly once.
  if (survivor) survivor.wins += 1
}

// ponytail: rescans the whole grid once per pick. At 81 tiles and three picks
// that is nothing; revisit only if the grid ever gets large.
function collapse(state, rng) {
  for (let n = 0; n < COLLAPSE_COUNT; n++) {
    const solid = []
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] === 'solid') solid.push(i)
    }
    if (solid.length === 0) return
    const i = solid[Math.floor(rng() * solid.length)]
    state.tiles[i] = 'warn'
    state.warnAt[i] = state.now + WARNING_MS
  }
}

/** Turns due warnings into holes and takes anyone standing on them with it. */
function resolveWarnings(state) {
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] !== 'warn' || state.now < state.warnAt[i]) continue
    state.tiles[i] = 'gone'
    // A pickup sitting on a collapsing tile goes down with it.
    delete state.powerups[i]
    for (const p of state.players) {
      if (!p.playing || !p.alive || p.y * SIZE + p.x !== i) continue
      if (p.shielded) {
        // The shield is spent whether or not there is anywhere to be shoved.
        p.shielded = false
        const safe = adjacentSolid(state, p)
        if (safe) {
          ;[p.x, p.y] = safe
          continue
        }
      }
      p.alive = false
    }
  }
}

/**
 * Advances the match by dt milliseconds. `rng` is injectable so the collapse
 * order is deterministic under test; nothing else uses it.
 */
export function tick(state, dt, rng = Math.random) {
  state.now += dt

  if (state.phase === 'waiting') {
    if (state.players.length >= MIN_PLAYERS) startCountdown(state)
    return
  }

  if (state.phase === 'countdown') {
    if (state.players.length < MIN_PLAYERS) {
      state.phase = 'waiting'
    } else if (state.now >= state.phaseUntil) {
      startRound(state, rng)
    }
    return
  }

  if (state.phase === 'over') {
    if (state.now < state.phaseUntil) return
    if (state.players.length >= MIN_PLAYERS) {
      startCountdown(state)
    } else {
      state.phase = 'waiting'
      state.winner = null
    }
    return
  }

  // playing
  while (state.now >= state.nextCollapseAt) {
    collapse(state, rng)
    state.nextCollapseAt += COLLAPSE_EVERY_MS
  }
  while (state.now >= state.nextPowerupAt) {
    spawnPowerup(state, rng)
    state.nextPowerupAt += POWERUP_EVERY_MS
  }
  resolveWarnings(state)

  const standing = state.players.filter((p) => p.playing && p.alive)
  if (standing.length <= 1) endRound(state, standing[0] ?? null)
}

/**
 * The one message shape broadcast to clients.
 * ponytail: full-state broadcast every tick, no diffing. 81 tiles and four
 * players is a small object, and a client never needs earlier messages to
 * render. Delta-encode only if the grid ever exceeds ~400 tiles.
 */
export function snapshot(state) {
  const timed = state.phase === 'countdown' || state.phase === 'over'
  return {
    t: 'state',
    phase: state.phase,
    size: SIZE,
    secs: timed ? Math.max(0, Math.ceil((state.phaseUntil - state.now) / 1000)) : 0,
    winner: state.winner,
    arena: state.arena,
    tiles: state.tiles,
    powerups: state.powerups,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      playing: p.playing,
      alive: p.alive,
      wins: p.wins,
      held: p.held,
      shielded: p.shielded,
      dashing: state.now < p.dashUntil,
    })),
  }
}
