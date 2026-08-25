// Rules for one Blockout Royale match. Pure: no sockets, no Node APIs, no
// imports. Everything here is exercised by game.test.js.

// --- Tuning ------------------------------------------------------------
// The collapse rate is what decides whether a round is tense or tedious, and
// no amount of reasoning settles it. Play the game and move the numbers.
export const SIZE = 9
export const TICK_MS = 100
export const MOVE_COOLDOWN_MS = 120
export const COLLAPSE_EVERY_MS = 900
export const COLLAPSE_COUNT = 3
export const WARNING_MS = 1500
export const COUNTDOWN_MS = 3000
export const OVER_MS = 5000
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 4

// Opposite corners first, so a two-player round starts as far apart as it can.
export const SPAWNS = [
  [0, 0],
  [SIZE - 1, SIZE - 1],
  [SIZE - 1, 0],
  [0, SIZE - 1],
]

const NAME_MAX = 16

// A code-point test rather than a regex range. An escape sequence for a
// control character is exactly the kind of thing an editor or a copy-paste
// silently mangles; arithmetic on the code point cannot be mangled.
const isPrintable = (ch) => {
  const code = ch.codePointAt(0)
  return code > 31 && code !== 127
}

/** Trims, strips control characters, caps length, and never returns empty. */
export function sanitizeName(raw) {
  const clean = String(raw ?? '')
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
  }
  state.players.push(player)
  return player
}

export function removePlayer(state, id) {
  const i = state.players.findIndex((p) => p.id === id)
  if (i !== -1) state.players.splice(i, 1)
}

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** Clears the board and hands pieces to the first MAX_PLAYERS in join order. */
export function startRound(state) {
  state.tiles.fill('solid')
  state.warnAt.fill(0)
  state.winner = null
  state.nextCollapseAt = state.now + COLLAPSE_EVERY_MS
  state.players.forEach((p, i) => {
    p.playing = i < MAX_PLAYERS
    p.alive = p.playing
    if (p.playing) {
      ;[p.x, p.y] = SPAWNS[i]
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
  if (state.now - p.lastMoveAt < MOVE_COOLDOWN_MS) return false

  const step = DIRS[dir]
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
  return true
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
    for (const p of state.players) {
      if (p.playing && p.alive && p.y * SIZE + p.x === i) p.alive = false
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
      startRound(state)
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
    tiles: state.tiles,
    players: state.players.map(({ id, name, x, y, playing, alive }) => ({
      id,
      name,
      x,
      y,
      playing,
      alive,
    })),
  }
}
