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
