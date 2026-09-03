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
