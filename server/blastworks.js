// Rules for one Blastworks match. Pure: no sockets, no Node APIs. The one
// import is the shared name sanitiser — duplicating a trust-boundary filter is
// how the two copies drift apart. Everything here is exercised by
// blastworks.test.js.

import { sanitizeName } from './game.js'

// --- Tuning ------------------------------------------------------------
// Tile units throughout. The grid is odd-sized on both axes because the pillar
// lattice sits on even coordinates: that is what turns an open field into a
// maze of lanes, and it only works if the outer ring is even too.
export const W = 25
export const H = 17
export const TICK_MS = 33

export const RADIUS = 0.34 // < 0.5, so a one-tile lane stays walkable
export const SPEED_BASE = 4.4 // tiles/second
export const SPEED_STEP = 0.7
export const SPEED_TIERS = 4

// A blast is a cross, never a square: four arms out from the bomb's own tile.
// Diagonal cover is therefore real cover, which is the whole reason the lattice
// is worth navigating.
export const BOMB_FUSE_MS = 2200
export const BLAST_MS = 460
// One tile down each arm to begin with: a cross that fits inside a three by
// three and no further. Everything past that has to be picked up off the floor.
export const RANGE_START = 1
export const RANGE_MAX = 7
export const BOMBS_START = 1
export const BOMBS_MAX = 6
// A chained bomb goes a beat later than the one that set it off, so a cascade
// reads as a cascade instead of one flat bang.
export const CHAIN_STAGGER_MS = 70

export const KICK_SPEED = 7.5
export const THROW_TILES = 3
export const THROW_MS = 380

// One life a round. A deathmatch here would run long and reward nothing —
// with a blast this small, the tension has to come from having something to
// lose, and that means not coming back until the round does.
export const ROUND_TARGET = 3
export const COUNTDOWN_MS = 3000
export const OVER_MS = 4500
export const MIN_PLAYERS = 2

// Two ways to play, chosen when the server starts. Last man standing is one
// life a round, first to ROUND_TARGET rounds. Deathmatch respawns you and runs
// to KILL_TARGET, which is longer but never leaves anybody watching.
export const MODES = ['lastman', 'deathmatch']
export const RESPAWN_MS = 2000
export const KILL_TARGET = 12

// The map starts nearly solid and grows back towards it. Without regrowth a
// deathmatch erodes into an empty field inside a minute and stops being about
// tunnelling at all.
// A last man standing round that will not resolve itself.
//
// With no regrowth the board opens up, and on open ground somebody who plays
// well simply walks away from every blast. Measured with a person in the arena
// actually playing: one round in six finished, and the rest were still going
// after half an hour. Nothing in the rules forced a decision.
//
// So the arena takes the decision away. Past SUDDEN_DEATH_MS a wall closes in
// along an inward spiral, one tile at a time, and whatever it lands on is
// crushed. It reuses HARD, so there is nothing new to draw, nothing new on the
// wire, and no new way to die the client cannot already show.
//
// Only last man standing squeezes. Deathmatch regrows instead, and it ends on
// a score it reliably reaches — measured at seven to sixteen minutes, every
// run, without help.
export const SUDDEN_DEATH_MS = 120000
export const SQUEEZE_EVERY_MS = 160

export const SOFT_DENSITY = 0.72
export const REGROW_EVERY_MS = 2600
export const PICKUP_FROM_SOFT = 0.26
export const PICKUP_EVERY_MS = 9000
export const PICKUP_MAX = 6
export const PICKUP_KINDS = [
  'bomb',
  'range',
  'speed',
  'kick',
  'glove',
  'remote',
  'vest',
  'square',
  'drill',
]

// A vest eats one blast. Without it a single mistake is always fatal, which is
// harsh in a format that gives you one life a round.
// The grace is what stops the same lingering fire eating the vest and then the
// player on the following tick.
export const VEST_GRACE_MS = BLAST_MS + 120

// Bots fill the arena up to this many participants, so one person alone still
// gets a match. They stand down one at a time as people take the slots.
export const BOT_FILL_TO = 4
export const BOT_REACT_MS = 170
// Inside this many tiles a bot stops shopping and starts hunting.
export const BOT_HUNT_RANGE = 6
export const BOT_NAMES = ['Ash', 'Cinder', 'Flint', 'Ember', 'Slag', 'Coke', 'Tinder']

export const EMPTY = 0
export const SOFT = 1
export const HARD = 2

// Every spawn has a 180-degree partner (W-1-x, H-1-y). All of them sit on odd
// coordinates, which the lattice guarantees is never a pillar. Corners first,
// so a two-player match starts as far apart as the arena allows.
export const SPAWNS = [
  [1, 1],
  [23, 15],
  [23, 1],
  [1, 15],
  [11, 1],
  [13, 15],
  [1, 7],
  [23, 9],
]

// Derived, never hand-written: a capacity past the spawn list would put a
// player at undefined. To raise capacity, add spawn points above.
export const MAX_PLAYERS = SPAWNS.length

export const ARENAS = ['foundry', 'magazine', 'dryhouse', 'scrapline']

const r2 = (n) => Math.round(n * 100) / 100
const idx = (x, y) => y * W + x
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Every inner tile, outermost ring first, going round and then in. The order
 * the closing wall takes.
 */
function spiralInwards() {
  const order = []
  let x0 = 1
  let y0 = 1
  let x1 = W - 2
  let y1 = H - 2
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) order.push(idx(x, y0))
    for (let y = y0 + 1; y <= y1; y++) order.push(idx(x1, y))
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) order.push(idx(x, y1))
    if (x1 > x0) for (let y = y1 - 1; y > y0; y--) order.push(idx(x0, y))
    x0++
    y0++
    x1--
    y1--
  }
  return order
}

export const SQUEEZE_ORDER = spiralInwards()

export function createMatch(
  rng = Math.random,
  arena = ARENAS[Math.floor(rng() * ARENAS.length)],
  mode = MODES[0],
) {
  const state = {
    mode: MODES.includes(mode) ? mode : MODES[0],
    phase: 'waiting',
    now: 0,
    phaseUntil: 0,
    arena,
    // 0 empty, 1 soft, 2 hard. Plain ints so the broadcast stays short and the
    // frame stays readable in a packet capture.
    tiles: new Array(W * H).fill(EMPTY),
    bombs: [],
    nextBombId: 1,
    // Sparse: tile index -> when the fire on it goes out.
    fires: {},
    // Sparse: tile index -> kind.
    pickups: {},
    nextPickupAt: Infinity,
    nextRegrowAt: Infinity,
    events: [],
    players: [],
    nextId: 1,
    botFill: BOT_FILL_TO,
    // Set from the operator console. Off means no match runs without a person
    // in it, which is how it sits in normal use.
    botsOnly: false,
    // Nobody gets bots until somebody asks for them.
    botsWanted: false,
    winner: null,
    winnerId: null,
    // When the closing wall takes its next tile, and how far along the spiral
    // it has got. Infinity in deathmatch, which never squeezes.
    squeezeAt: Infinity,
    squeezeStep: 0,
    // The standing leaderboard, best first. Set from outside by the socket
    // wrapper and passed through untouched: no rule here reads it, and nothing
    // about the match depends on it.
    board: [],
    // True when `winner` took the whole match, not just the round.
    final: false,
  }
  carve(state, arena, rng)
  return state
}

// --- Arena -------------------------------------------------------------

/** The indestructible lattice. Both coordinates even, plus the outer ring. */
const isPillar = (x, y) => x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)

/**
 * Clears a spawn pocket.
 *
 * It has to be big enough to survive your own bomb in, which is a stronger
 * requirement than it sounds: a three-tile corner L is entirely covered by a
 * range-3 cross laid at the spawn, so a player there can neither bomb safely
 * nor go anywhere. The alcove at the end of each arm is what guarantees a tile
 * off the cross that is still reachable along it.
 */
function pocket(state, sx, sy) {
  const open = (x, y) => {
    if (!inBounds(x, y) || isPillar(x, y)) return
    state.tiles[idx(x, y)] = EMPTY
  }

  open(sx, sy)
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) open(sx + dx, sy + dy)

  for (const [dx, dy] of DIRS) {
    // The arm itself, far enough that its end is outside a blast laid at the
    // spawn...
    for (let n = 1; n <= RANGE_START + 1; n++) open(sx + dx * n, sy + dy * n)
    // ...and a step to the side of it, which is the tile the cross cannot
    // reach and therefore the one you run to.
    const px = dy
    const py = dx
    open(sx + dx * 2 + px, sy + dy * 2 + py)
    open(sx + dx * 2 - px, sy + dy * 2 - py)
  }
}

/**
 * The lattice, then soft fill, then the pockets. Layouts differ in which extra
 * pillars they add and how thick the fill is — the shape of the game is the
 * same in all of them: everybody starts sealed into a corner and digs out.
 */
function carve(state, arena, rng) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      state.tiles[idx(x, y)] = isPillar(x, y) ? HARD : EMPTY
    }
  }

  if (arena === 'magazine') {
    // Picket walls running down the hall, splitting it into galleries.
    //
    // They sit on ODD columns and EVEN rows on purpose. The base lattice
    // already owns every even/even tile, so a post on an even column would put
    // hard walls on all four sides of the odd-row tile beside it and seal it
    // off for good. An odd column only ever closes a crossing, never a cell.
    for (let x = 3; x < W - 3; x += 6) {
      for (let y = 2; y < H - 2; y += 2) state.tiles[idx(x, y)] = HARD
    }
  } else if (arena === 'dryhouse') {
    // A hard spine down the centre: crossing the map means committing to a end.
    const mid = (W - 1) / 2
    for (let y = 2; y < H - 2; y++) {
      if (y % 4 !== 0) state.tiles[idx(mid, y)] = HARD
    }
  } else if (arena === 'scrapline') {
    // Broken pillars: a few of the lattice posts are missing, which opens
    // diagonals the other layouts never have.
    for (let y = 2; y < H - 2; y += 2) {
      for (let x = 2; x < W - 2; x += 2) {
        if (rng() < 0.22) state.tiles[idx(x, y)] = EMPTY
      }
    }
  }

  // Soft fill over everything that is not a pillar.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y)
      if (state.tiles[i] === HARD) continue
      state.tiles[i] = rng() < SOFT_DENSITY ? SOFT : EMPTY
    }
  }

  for (const [sx, sy] of SPAWNS) pocket(state, sx, sy)
  sealDeadSpace(state)
}

/**
 * Turns any pocket the hard walls have sealed off into wall itself.
 *
 * Soft stock is not a barrier — anyone can blast through it — so reachability
 * is measured through everything except permanent wall. What is left over is a
 * hole nobody can ever enter, and the reason it matters is that pickups spawn
 * on open ground: a sealed tile becomes a powerup nobody can collect, sitting
 * there for the whole match.
 *
 * This is a backstop, not the design. Layouts are meant to avoid sealing
 * anything in the first place; this is what makes that guarantee rather than an
 * intention, so a new layout cannot quietly reintroduce it.
 */
function sealDeadSpace(state) {
  const seen = new Uint8Array(W * H)
  const start = idx(SPAWNS[0][0], SPAWNS[0][1])
  const queue = [start]
  seen[start] = 1

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]
    const x = i % W
    const y = Math.floor(i / W)
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (!inBounds(nx, ny)) continue
      const j = idx(nx, ny)
      if (seen[j] || state.tiles[j] === HARD) continue
      seen[j] = 1
      queue.push(j)
    }
  }

  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] !== HARD && !seen[i]) state.tiles[i] = HARD
  }
}

/** Puts one soft block back, never on top of anything that is in play. */
function regrow(state, rng) {
  const free = []
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y)
      if (state.tiles[i] !== EMPTY) continue
      if (Object.hasOwn(state.fires, i) || Object.hasOwn(state.pickups, i)) continue
      if (state.bombs.some((b) => tileOf(b) === i)) continue
      // Never inside somebody. Being sealed in is survivable — you always have
      // a bomb — but being buried where you stand is not.
      if (state.players.some((p) => p.alive && overlapsTile(p, x, y))) continue
      free.push(i)
    }
  }
  if (free.length === 0) return
  state.tiles[free[Math.floor(rng() * free.length)]] = SOFT
}

// --- Geometry ----------------------------------------------------------

const tileOf = (e) => idx(Math.floor(e.x), Math.floor(e.y))

/** Whether a player's box covers a given tile. */
function overlapsTile(p, x, y) {
  return (
    Math.floor(p.x - RADIUS) <= x &&
    x <= Math.floor(p.x + RADIUS) &&
    Math.floor(p.y - RADIUS) <= y &&
    y <= Math.floor(p.y + RADIUS)
  )
}

const solidTile = (state, x, y) => {
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  if (!inBounds(cx, cy)) return true
  return state.tiles[idx(cx, cy)] !== EMPTY
}

/** The bomb standing on a tile, if any. One in the air or in somebody's hands
 * is not on the floor and blocks nothing. */
const bombAt = (state, x, y) =>
  state.bombs.find(
    (b) => !b.air && !b.carriedBy && Math.floor(b.x) === x && Math.floor(b.y) === y,
  )

/**
 * True if a box centred here cannot be. Bombs are solid too, except to whoever
 * has not stepped off one yet — otherwise laying a bomb would wall you in on
 * the spot.
 */
function blocked(state, p, x, y) {
  const corners = [
    [x - RADIUS, y - RADIUS],
    [x + RADIUS, y - RADIUS],
    [x - RADIUS, y + RADIUS],
    [x + RADIUS, y + RADIUS],
  ]
  for (const [cx, cy] of corners) {
    if (solidTile(state, cx, cy)) return true
    const b = bombAt(state, Math.floor(cx), Math.floor(cy))
    if (b && !b.free.includes(p.id)) return true
  }
  return false
}

// --- Players -----------------------------------------------------------

function seat(state, name, bot) {
  const player = {
    id: state.nextId++,
    name,
    bot,
    x: 0,
    y: 0,
    face: 0, // radians, the way they last moved
    alive: false,
    respawnAt: 0,
    // Rounds taken. Kills and deaths are kept for the scoreboard, but the
    // match is decided on rounds.
    wins: 0,
    kills: 0,
    deaths: 0,
    // Only players who were here when the round started are in it; anyone who
    // arrives mid-round watches this one out.
    inRound: false,
    // Everything below resets on death. That is the comeback loop: whoever is
    // ahead is also whoever has the most to lose.
    bombs: BOMBS_START,
    range: RANGE_START,
    tier: 0,
    kick: false,
    glove: false,
    // Charges stop ticking and go off when you say so.
    remote: false,
    vest: false,
    safeUntil: 0,
    // Shape and reach of what you lay: a filled three by three instead of a
    // cross, and arms that run through stock instead of stopping at it.
    square: false,
    drill: false,
    input: { dx: 0, dy: 0, bomb: false },
    thinkAt: 0,
    duckUntil: 0,
    // When a bot gives up waiting for a clean moment to trigger its own
    // remote charge. See driveBots.
    triggerAt: 0,
  }
  state.players.push(player)
  return player
}

/** Joins the match, or returns null when every spawn point is taken. */
export function addPlayer(state, name) {
  const people = state.players.filter((p) => !p.bot)
  if (people.length >= MAX_PLAYERS) return null
  // A person takes a bot's chair rather than waiting for one to be freed.
  const bot = state.players.find((p) => p.bot)
  if (state.players.length >= MAX_PLAYERS && bot) removePlayer(state, bot.id)
  return seat(state, sanitizeName(name), false)
}

export function removePlayer(state, id) {
  const i = state.players.findIndex((p) => p.id === id)
  if (i === -1) return
  state.players.splice(i, 1)
  releaseBombs(state, id)
}

/** The spawn point furthest from the nearest living rival. */
function bestSpawn(state, self) {
  let best = SPAWNS[0]
  let bestScore = -1
  for (const [sx, sy] of SPAWNS) {
    let nearest = Infinity
    for (const o of state.players) {
      if (o.id === self.id || !o.alive) continue
      nearest = Math.min(nearest, Math.hypot(o.x - (sx + 0.5), o.y - (sy + 0.5)))
    }
    if (nearest > bestScore) {
      bestScore = nearest
      best = [sx, sy]
    }
  }
  return best
}

const isLastMan = (state) => state.mode === 'lastman'

function place(state, p) {
  const [sx, sy] = bestSpawn(state, p)
  // A pocket to open in, so nobody starts the round already dead.
  pocket(state, sx, sy)
  p.x = sx + 0.5
  p.y = sy + 0.5
  p.alive = true
  p.inRound = true
  p.bombs = BOMBS_START
  p.range = RANGE_START
  p.tier = 0
  p.kick = false
  p.glove = false
  p.remote = false
  p.vest = false
  p.safeUntil = 0
  p.square = false
  p.drill = false
}

/** Lays out a fresh board and puts everyone on it with one life each. */
export function startRound(state, rng = Math.random, arena = ARENAS[Math.floor(rng() * ARENAS.length)]) {
  state.arena = arena
  carve(state, arena, rng)
  state.bombs = []
  state.fires = {}
  state.pickups = {}
  state.nextPickupAt = state.now + PICKUP_EVERY_MS
  // Only in deathmatch. A last-man round has to converge on somebody winning,
  // and a board that keeps refilling never lets it — the stock you clear stays
  // cleared, so every round runs down to open ground and a decision.
  state.nextRegrowAt = isLastMan(state) ? Infinity : state.now + REGROW_EVERY_MS
  // The other half of that trade: the mode that does not refill the board is
  // the mode that needs a wall to close it.
  state.squeezeAt = isLastMan(state) ? state.now + SUDDEN_DEATH_MS : Infinity
  state.squeezeStep = 0
  state.winner = null
  state.winnerId = null
  state.final = false
  state.phase = 'playing'
  for (const p of state.players) place(state, p)
}

/** Wipes the running total and starts the first round of a new match. */
export function startMatch(state, rng = Math.random, arena = undefined) {
  for (const p of state.players) {
    p.wins = 0
    p.kills = 0
    p.deaths = 0
  }
  // Bots are seated by the tick, not here, so an operator restarting a match
  // for one person is starting it with one participant. Beginning the round
  // anyway hands them the round on the very next tick — the bots arrive, sit
  // it out as anyone arriving mid-round does, and the last-man check sees a
  // single player left standing. A round nobody contested, written into a
  // leaderboard that keeps it forever.
  //
  // Hand it to the waiting branch instead. It starts the round once there is
  // somebody to play against, by which time the bots are seated and in it.
  if (state.players.length < MIN_PLAYERS) {
    state.phase = 'waiting'
    state.winner = null
    state.winnerId = null
    state.final = false
    return
  }
  startRound(state, rng, arena)
}

function startCountdown(state) {
  state.phase = 'countdown'
  state.phaseUntil = state.now + COUNTDOWN_MS
  state.winner = null
  state.winnerId = null
  state.final = false
}

/**
 * Ends the round on whoever is left, if anyone. A round nobody survives — two
 * players catching each other's blast on the same tick — is a legitimate
 * outcome and goes to nobody.
 */
function endRound(state, survivor) {
  state.phase = 'over'
  state.phaseUntil = state.now + OVER_MS
  state.winner = survivor ? survivor.name : null
  state.winnerId = survivor ? survivor.id : null
  if (survivor) survivor.wins += 1
  // The match is over when somebody has taken enough rounds.
  state.final = !!survivor && survivor.wins >= ROUND_TARGET
}

// --- Input -------------------------------------------------------------

// Anything off the wire is suspect: a NaN here would drive a position to NaN
// and make a player permanently unhittable.
const clamp1 = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0

export function setInput(state, id, msg) {
  const p = state.players.find((q) => q.id === id)
  if (!p) return false
  p.input = { dx: clamp1(msg?.dx), dy: clamp1(msg?.dy), bomb: msg?.bomb === true }
  return true
}

// --- Bombs -------------------------------------------------------------

const liveBombs = (state, p) => state.bombs.filter((b) => b.owner === p.id).length

/**
 * The charge in a player's hands, if any.
 *
 * Asked of the bomb list rather than kept as a flag on the player. A flag is a
 * second copy of the same fact, and the two came apart the moment a charge went
 * off while it was being carried: the bomb left the board, the flag stayed set,
 * and that player could never lay or lift another one for the rest of their
 * life. There is nothing to keep in step if there is only one copy.
 */
const heldBomb = (state, p) => state.bombs.find((b) => b.carriedBy === p.id)

/** Lays a bomb on the tile you are standing on. */
export function drop(state, id) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.alive || heldBomb(state, p)) return false
  if (liveBombs(state, p) >= p.bombs) return false

  const tx = Math.floor(p.x)
  const ty = Math.floor(p.y)
  if (state.tiles[idx(tx, ty)] !== EMPTY) return false
  if (bombAt(state, tx, ty)) return false

  state.bombs.push({
    id: state.nextBombId++,
    owner: p.id,
    x: tx + 0.5,
    y: ty + 0.5,
    range: p.range,
    // A remote charge has no fuse at all: it waits for the word. The shape and
    // reach are fixed the moment it is laid, so picking up a drill afterwards
    // does not change what is already on the floor.
    at: p.remote ? Infinity : state.now + BOMB_FUSE_MS,
    remote: p.remote,
    square: p.square,
    drill: p.drill,
    // Whoever is standing on it right now may walk off it; once they have, it
    // is solid to them like anything else.
    free: state.players.filter((q) => q.alive && overlapsTile(q, tx, ty)).map((q) => q.id),
    slide: null,
    air: null,
    carriedBy: null,
  })
  return true
}

/** Which way a player is facing, snapped to the axis they last moved along. */
function facing(p) {
  const alongX = Math.abs(Math.cos(p.face)) >= Math.abs(Math.sin(p.face))
  if (alongX) return [Math.sign(Math.cos(p.face)) || 1, 0]
  return [0, Math.sign(Math.sin(p.face)) || 1]
}

/**
 * Picks up a bomb, or throws the one you are holding. Needs the glove; without
 * it the action does nothing at all.
 *
 * It reaches the tile you are standing on AND the one in front of you, because
 * standing on a bomb is a state you can only be in for the moment after laying
 * it — step off and it turns solid, so you can never walk back onto it. Looking
 * only underfoot made the glove all but unusable.
 */
export function handle(state, id) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.alive || !p.glove) return false

  const held = heldBomb(state, p)
  if (held) {
    const tx = Math.floor(p.x)
    const ty = Math.floor(p.y)
    const [dx, dy] = facing(p)
    // Land on the furthest free tile within reach, working back towards you, so
    // a throw at a wall drops short instead of vanishing.
    let landed = null
    for (let n = THROW_TILES; n >= 1; n--) {
      const lx = tx + dx * n
      const ly = ty + dy * n
      if (!inBounds(lx, ly) || state.tiles[idx(lx, ly)] !== EMPTY) continue
      if (bombAt(state, lx, ly)) continue
      landed = [lx, ly]
      break
    }
    if (!landed) return false

    held.carriedBy = null
    // Whoever threw it owns what it does. Lobbing somebody else's charge back
    // at them should not credit them with their own death. Its fuse is
    // untouched: the clock has been running the whole time it was in hand.
    held.owner = p.id
    held.free = []
    held.air = {
      fromX: p.x,
      fromY: p.y,
      toX: landed[0] + 0.5,
      toY: landed[1] + 0.5,
      until: state.now + THROW_MS,
    }
    return true
  }

  // Underfoot first, then the tile ahead. Anyone's bomb will do — catching a
  // live charge and putting it back where it came from is the whole point of
  // carrying a glove.
  const [fx, fy] = facing(p)
  const lift =
    bombAt(state, Math.floor(p.x), Math.floor(p.y)) ??
    bombAt(state, Math.floor(p.x) + fx, Math.floor(p.y) + fy)
  if (!lift) return false
  // Kept in the list, so its fuse keeps running while it is off the floor.
  lift.carriedBy = p.id
  lift.slide = null
  return true
}

/**
 * Every tile a charge would set alight right now, as a flat list of indices.
 *
 * A square charge has no arms at all — it takes the three by three it is
 * sitting in, so a hard post shelters only its own tile and nothing behind it.
 * A drill charge keeps its arms but runs them through stock instead of
 * stopping at the first block.
 */
function blastTiles(state, b) {
  const tx = Math.floor(b.x)
  const ty = Math.floor(b.y)
  const hit = [idx(tx, ty)]

  if (b.square) {
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) {
        if (!inBounds(x, y) || (x === tx && y === ty)) continue
        if (state.tiles[idx(x, y)] === HARD) continue
        hit.push(idx(x, y))
      }
    }
    return hit
  }

  for (const [dx, dy] of DIRS) {
    for (let n = 1; n <= b.range; n++) {
      const x = tx + dx * n
      const y = ty + dy * n
      if (!inBounds(x, y)) break
      const i = idx(x, y)
      if (state.tiles[i] === HARD) break
      hit.push(i)
      // A soft block eats the rest of the arm, unless the charge is built to
      // go through it. That stop is what makes range feel earned.
      if (state.tiles[i] === SOFT && !b.drill) break
    }
  }
  return hit
}

/**
 * Blows every charge you have on the floor at once. Only remote charges are
 * waiting to be told; anything already on a fuse is left to run.
 */
export function detonateAll(state, id) {
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.alive || state.phase !== 'playing') return false
  let any = false
  for (const b of state.bombs) {
    if (b.owner !== id || !b.remote || b.air) continue
    b.at = Math.min(b.at, state.now)
    any = true
  }
  return any
}

function detonate(state, b, rng) {
  const hit = blastTiles(state, b)
  state.events.push({ k: 'blast', by: b.owner, tiles: hit, range: b.range })

  for (const i of hit) {
    // Fire burns off whatever was already lying on the floor. This has to come
    // before the block is opened, or it would immediately destroy the very
    // pickup that block was hiding.
    delete state.pickups[i]
    if (state.tiles[i] === SOFT) {
      state.tiles[i] = EMPTY
      if (rng() < PICKUP_FROM_SOFT && Object.keys(state.pickups).length < PICKUP_MAX) {
        state.pickups[i] = PICKUP_KINDS[Math.floor(rng() * PICKUP_KINDS.length)]
      }
    }
    state.fires[i] = { until: state.now + BLAST_MS, by: b.owner }
  }

  // Chain: anything caught in the blast goes a beat later.
  for (const other of state.bombs) {
    if (other === b || other.air) continue
    if (!hit.includes(tileOf(other))) continue
    other.at = Math.min(other.at, state.now + CHAIN_STAGGER_MS)
  }
}

// --- Simulation --------------------------------------------------------

function movePlayers(state, dt) {
  const secs = dt / 1000
  for (const p of state.players) {
    if (!p.alive) continue

    let { dx, dy } = p.input
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    if (dx || dy) p.face = Math.atan2(dy, dx)
    const speed = (SPEED_BASE + p.tier * SPEED_STEP) * secs

    // Axes resolved separately, so you slide along a wall instead of sticking
    // on it — which in a lattice this tight is the difference between the game
    // feeling responsive and feeling broken.
    const nx = p.x + dx * speed
    if (!blocked(state, p, nx, p.y)) p.x = nx
    else kickInto(state, p, Math.sign(dx), 0)

    const ny = p.y + dy * speed
    if (!blocked(state, p, p.x, ny)) p.y = ny
    else kickInto(state, p, 0, Math.sign(dy))

    // Once you are off a bomb, it is solid to you like anything else.
    for (const b of state.bombs) {
      if (b.free.length === 0) continue
      b.free = b.free.filter((qid) => {
        const q = state.players.find((r) => r.id === qid)
        return q && q.alive && overlapsTile(q, Math.floor(b.x), Math.floor(b.y))
      })
    }

    const here = tileOf(p)
    if (Object.hasOwn(state.pickups, here)) {
      collect(state, p, state.pickups[here])
      delete state.pickups[here]
    }

    if (p.input.bomb) drop(state, p.id)
  }
}

/** Walking into a bomb with the kick shoves it down the lane. */
function kickInto(state, p, dx, dy) {
  if (!p.kick || (!dx && !dy)) return
  const tx = Math.floor(p.x + dx * (RADIUS + 0.3))
  const ty = Math.floor(p.y + dy * (RADIUS + 0.3))
  const b = bombAt(state, tx, ty)
  if (!b || b.slide) return
  b.slide = [dx, dy]
}

function collect(state, p, kind) {
  if (kind === 'bomb') p.bombs = Math.min(BOMBS_MAX, p.bombs + 1)
  else if (kind === 'range') p.range = Math.min(RANGE_MAX, p.range + 1)
  else if (kind === 'speed') p.tier = Math.min(SPEED_TIERS, p.tier + 1)
  else if (kind === 'kick') p.kick = true
  else if (kind === 'glove') p.glove = true
  else if (kind === 'remote') p.remote = true
  else if (kind === 'vest') p.vest = true
  else if (kind === 'square') p.square = true
  else if (kind === 'drill') p.drill = true
  state.events.push({ k: 'take', by: p.id, kind })
}

function moveBombs(state, dt) {
  const secs = dt / 1000
  for (const b of state.bombs) {
    if (b.carriedBy) {
      // It goes where its carrier goes, and it goes off there too.
      const carrier = state.players.find((q) => q.id === b.carriedBy)
      if (carrier && carrier.alive) {
        b.x = carrier.x
        b.y = carrier.y
      } else {
        // Dropped by whoever was holding it when they went down.
        b.carriedBy = null
        b.x = Math.floor(b.x) + 0.5
        b.y = Math.floor(b.y) + 0.5
      }
      continue
    }
    if (b.air) {
      const left = b.air.until - state.now
      const t = left <= 0 ? 1 : 1 - left / THROW_MS
      b.x = b.air.fromX + (b.air.toX - b.air.fromX) * t
      b.y = b.air.fromY + (b.air.toY - b.air.fromY) * t
      if (left <= 0) {
        b.x = b.air.toX
        b.y = b.air.toY
        b.air = null
        // The same courtesy a charge you lay gives you: whoever it comes down
        // on may step off it before it turns solid to them. Without this a
        // throw walls somebody into the tile they are standing on, and no
        // amount of playing well gets them out of it.
        b.free = state.players
          .filter((q) => q.alive && overlapsTile(q, Math.floor(b.x), Math.floor(b.y)))
          .map((q) => q.id)
      }
      continue
    }
    if (!b.slide) continue

    const [dx, dy] = b.slide
    const nx = b.x + dx * KICK_SPEED * secs
    const ny = b.y + dy * KICK_SPEED * secs
    const ax = Math.floor(nx + dx * 0.5)
    const ay = Math.floor(ny + dy * 0.5)
    const hitsWall = !inBounds(ax, ay) || state.tiles[idx(ax, ay)] !== EMPTY
    const hitsBomb = bombAt(state, ax, ay)
    const hitsBody = state.players.some(
      (q) => q.alive && !overlapsTile(q, Math.floor(b.x), Math.floor(b.y)) && overlapsTile(q, ax, ay),
    )
    if (hitsWall || (hitsBomb && hitsBomb !== b) || hitsBody) {
      // Stop on the tile it is on, dead centre, so it stays grid-aligned.
      b.x = Math.floor(b.x) + 0.5
      b.y = Math.floor(b.y) + 0.5
      b.slide = null
      continue
    }
    b.x = nx
    b.y = ny
  }
}

function kill(state, victim, byId) {
  state.events.push({ k: 'kill', by: byId, of: victim.id })
  victim.alive = false
  victim.deaths += 1
  victim.respawnAt = state.now + RESPAWN_MS
  releaseBombs(state, victim.id)
  const killer = state.players.find((q) => q.id === byId)
  if (killer && killer !== victim) killer.kills += 1
}

/**
 * Cuts a player loose from whatever of theirs is still on the board: remote
 * charges go back on an ordinary fuse, and anything in their hands hits the
 * floor still ticking.
 *
 * Dying and leaving both have to do this. Only death used to, so a charge laid
 * by somebody who then quit — or who an operator kicked — sat there armed,
 * solid, and waiting for a word nobody was left to give, for the rest of the
 * round.
 */
function releaseBombs(state, id) {
  for (const b of state.bombs) {
    if (b.owner === id && b.remote) {
      b.remote = false
      if (!Number.isFinite(b.at)) b.at = state.now + BOMB_FUSE_MS
    }
    if (b.carriedBy === id) {
      b.carriedBy = null
      b.x = Math.floor(b.x) + 0.5
      b.y = Math.floor(b.y) + 0.5
    }
  }
}

/** Anyone standing in fire dies outright. No chip damage, no partial credit. */
function burnPlayers(state) {
  for (const p of state.players) {
    if (!p.alive) continue
    // Just saved by a vest: the same fire must not immediately take them.
    if (state.now < p.safeUntil) continue

    // The fire carries its own owner, so credit is right whether they walked
    // into it the instant it lit or four hundred milliseconds later.
    let by = null
    for (const key of Object.keys(state.fires)) {
      const i = Number(key)
      if (!overlapsTile(p, i % W, Math.floor(i / W))) continue
      by = state.fires[key].by
      break
    }
    if (by === null) continue

    if (p.vest) {
      // One blast absorbed, and long enough on your feet to walk out of it.
      p.vest = false
      p.safeUntil = state.now + VEST_GRACE_MS
      state.events.push({ k: 'save', by, of: p.id })
      continue
    }
    kill(state, p, by)
  }
}

/**
 * Takes the next tile on the spiral, and whatever is standing on it.
 *
 * One tile per call. Tiles already solid are skipped without spending the
 * call, so the wall keeps its pace instead of stalling on the lattice.
 */
function squeeze(state) {
  while (state.squeezeStep < SQUEEZE_ORDER.length) {
    const i = SQUEEZE_ORDER[state.squeezeStep++]
    if (state.tiles[i] === HARD) continue

    state.tiles[i] = HARD
    delete state.pickups[i]
    delete state.fires[i]
    const x = i % W
    const y = Math.floor(i / W)

    // A charge under it is buried rather than set off: a wall closing on a
    // bomb should not read as somebody's kill.
    state.bombs = state.bombs.filter((b) => b.air || b.carriedBy || tileOf(b) !== i)

    // Crushed. Credited to nobody, which is what makes it read as the arena
    // rather than as a player nobody can see.
    for (const p of state.players) {
      if (p.alive && overlapsTile(p, x, y)) kill(state, p, null)
    }
    return
  }
}

function spawnPickup(state, rng) {
  if (Object.keys(state.pickups).length >= PICKUP_MAX) return
  const free = []
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y)
      if (state.tiles[i] !== EMPTY) continue
      if (Object.hasOwn(state.pickups, i) || Object.hasOwn(state.fires, i)) continue
      if (state.bombs.some((b) => tileOf(b) === i)) continue
      free.push(i)
    }
  }
  if (free.length === 0) return
  state.pickups[free[Math.floor(rng() * free.length)]] = PICKUP_KINDS[Math.floor(rng() * PICKUP_KINDS.length)]
}

// --- Bots --------------------------------------------------------------

/** Every tile that is on fire or about to be. This is what keeps a bot alive. */
function dangerMap(state) {
  const danger = new Set()
  for (const key of Object.keys(state.fires)) danger.add(Number(key))
  for (const b of state.bombs) {
    if (b.air) continue
    for (const i of blastTiles(state, b)) danger.add(i)
  }
  return danger
}

/**
 * One step along the shortest walkable route to the first tile `want` accepts,
 * never entering anything in `avoid`.
 *
 * Fleeing and seeking both go through here on purpose. They used to disagree —
 * the escape route knew bombs were solid and the route to a target did not, so
 * a bot would walk into its own bomb, jam against it, and still be there when
 * the fuse ran out. Nearly every death in a bot match was that.
 */
function stepTo(state, from, want, avoid) {
  const start = tileOf(from)
  const seen = new Set([start])
  const queue = [[start, null]]
  for (let head = 0; head < queue.length && head < 600; head++) {
    const [i, first] = queue[head]
    if (first !== null && want(i)) return first
    const x = i % W
    const y = Math.floor(i / W)
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (!inBounds(nx, ny)) continue
      const j = idx(nx, ny)
      if (seen.has(j)) continue
      seen.add(j)
      if (state.tiles[j] !== EMPTY) continue
      // A bomb is a wall to everyone who is not still standing on it.
      const bomb = bombAt(state, nx, ny)
      if (bomb && !bomb.free.includes(from.id)) continue
      if (avoid && avoid.has(j)) continue
      queue.push([j, first ?? [dx, dy]])
    }
  }
  return null
}

/**
 * A step towards somewhere genuinely out of the way — a tile with a tile to
 * spare between it and the fire. Falls back to merely-safe if there is nothing
 * better, because standing still is always the worst option.
 */
const stepToSafety = (state, p, danger) =>
  stepTo(state, p, (i) => clearanceOf(state, i, danger) >= 2, null) ??
  stepTo(state, p, (i) => !danger.has(i), null)

/** Every tile a player's body is standing on, not just the one they are over. */
function bodyTiles(p) {
  const out = []
  for (let y = Math.floor(p.y - RADIUS); y <= Math.floor(p.y + RADIUS); y++) {
    for (let x = Math.floor(p.x - RADIUS); x <= Math.floor(p.x + RADIUS); x++) {
      if (inBounds(x, y)) out.push(idx(x, y))
    }
  }
  return out
}

/**
 * What laying a bomb here would be worth: 2 if it could catch somebody, 1 if it
 * would only open stock, 0 if it would do nothing at all. Rated rather than
 * answered yes or no, so a bot can hold its one bomb for a shot at a kill
 * instead of spending it on the nearest crate.
 */
function bombValue(state, p) {
  const tx = Math.floor(p.x)
  const ty = Math.floor(p.y)
  let worth = 0
  for (const [dx, dy] of DIRS) {
    for (let n = 1; n <= p.range; n++) {
      const x = tx + dx * n
      const y = ty + dy * n
      if (!inBounds(x, y)) break
      const t = state.tiles[idx(x, y)]
      if (t === HARD) break
      if (state.players.some((q) => q.alive && q.id !== p.id && overlapsTile(q, x, y))) return 2
      if (t === SOFT) {
        worth = Math.max(worth, 1)
        break
      }
    }
  }
  return worth
}

/**
 * How far a tile is from the nearest thing that is about to burn. Fleeing to
 * the first safe tile leaves a bot hugging the edge of a blast with nowhere to
 * go if a second one lands; one more tile of clearance is most of the
 * difference between a bot that survives and one that does not.
 */
function clearanceOf(state, i, danger) {
  if (danger.has(i)) return 0
  const x = i % W
  const y = Math.floor(i / W)
  for (const [dx, dy] of DIRS) {
    const nx = x + dx
    const ny = y + dy
    if (inBounds(nx, ny) && danger.has(idx(nx, ny))) return 1
  }
  return 2
}

/**
 * Turns a tile step into an input that also pulls the bot onto the centre line
 * of its lane.
 *
 * The route is planned in tile space, but a body is wider than a point: sitting
 * a third of a tile off centre means straddling two rows, and a pillar in
 * either of them blocks a turn the planner believed was open. Bots used to jam
 * against exactly that and stand there until something killed them.
 */
function laneward(b, step) {
  const cx = Math.floor(b.x) + 0.5
  const cy = Math.floor(b.y) + 0.5
  const SLACK = 0.06
  if (step[0] !== 0) {
    return { dx: step[0], dy: Math.abs(b.y - cy) > SLACK ? Math.sign(cy - b.y) : 0, bomb: false }
  }
  return { dx: Math.abs(b.x - cx) > SLACK ? Math.sign(cx - b.x) : 0, dy: step[1], bomb: false }
}

function driveBots(state, rng) {
  const danger = dangerMap(state)
  for (const b of state.players) {
    if (!b.bot || !b.alive || state.now < b.thinkAt) continue
    b.thinkAt = state.now + BOT_REACT_MS

    // A remote charge waits for a word, and a bot is the only one who can give
    // it for its own. Fired the moment it is standing clear of everything it
    // laid — which is the same beat an ordinary fuse would have gone off on.
    // Without this a bot lays one charge, never triggers it, and is out of
    // bombs for the rest of its life while the armed charge blocks that tile
    // and poisons every route past it.
    const armed = state.bombs.filter((x) => x.owner === b.id && x.remote && !x.air)
    if (armed.length > 0) {
      const body = new Set(bodyTiles(b))
      const clear = armed.every((x) => !blastTiles(state, x).some((i) => body.has(i)))
      // Clear of it, or out of patience. The deadline matters: a bot that has
      // shut itself in behind its own charge has no clean moment coming, and
      // without one it would stand in its own blast for the rest of the round
      // rather than take the hit an ordinary fuse would have given it.
      if (clear || state.now >= b.triggerAt) detonateAll(state, b.id)
    }

    // Getting clear beats everything else, including a shot at a kill. Checked
    // against the whole body, because standing half in a blast is standing in
    // a blast — and held for as long as the bomb it laid is ticking, because
    // re-deciding every fifth of a second is how a bot talks itself back into
    // the blast it just walked out of.
    if (state.now < b.duckUntil || bodyTiles(b).some((i) => danger.has(i))) {
      const away = stepToSafety(state, b, danger)
      b.input = away ? laneward(b, away) : { dx: 0, dy: 0, bomb: false }
      continue
    }

    // Lay one only when there is something to gain and somewhere to run. A
    // shot at somebody is worth taking; a crate is only worth it if nobody is
    // close enough to be worth waiting for.
    const value = bombValue(state, b)
    const hunting = state.players.some(
      (o) => o.id !== b.id && o.alive && Math.hypot(o.x - b.x, o.y - b.y) <= BOT_HUNT_RANGE,
    )
    if (value >= (hunting ? 2 : 1) && liveBombs(state, b) < b.bombs) {
      const after = new Set(danger)
      for (const i of blastTiles(state, { x: b.x, y: b.y, range: b.range })) after.add(i)
      if (stepToSafety(state, b, after)) {
        drop(state, b.id)
        b.duckUntil = state.now + BOMB_FUSE_MS + BLAST_MS
        b.triggerAt = state.now + BOMB_FUSE_MS
        const away = stepToSafety(state, b, after)
        b.input = away ? laneward(b, away) : { dx: 0, dy: 0, bomb: false }
        continue
      }
    }

    // Somebody close by is worth more than a pickup across the map, so hunt
    // first and shop second rather than always shopping.
    let goal = -1
    let best = Infinity
    if (hunting) {
      for (const o of state.players) {
        if (o.id === b.id || !o.alive) continue
        const d = Math.hypot(o.x - b.x, o.y - b.y)
        if (d < best) {
          best = d
          goal = tileOf(o)
        }
      }
    } else {
      for (const key of Object.keys(state.pickups)) {
        const i = Number(key)
        const d = Math.hypot((i % W) + 0.5 - b.x, Math.floor(i / W) + 0.5 - b.y)
        if (d < best) {
          best = d
          goal = i
        }
      }
      for (const o of state.players) {
        if (o.id === b.id || !o.alive) continue
        const d = Math.hypot(o.x - b.x, o.y - b.y)
        if (d < best) {
          best = d
          goal = tileOf(o)
        }
      }
    }

    const step = goal === -1 ? null : stepTo(state, b, (i) => i === goal, danger)
    if (step) {
      b.input = laneward(b, step)
      continue
    }

    // Nothing reachable: everything worth reaching is behind a wall. Drift, so
    // the next think happens somewhere else and something opens up. Standing
    // still is the one thing that can never improve the situation.
    b.input = laneward(b, DIRS[Math.floor(rng() * DIRS.length)])
  }
}

/**
 * Whether the match is allowed to run at all. Bots exist to fill a board for a
 * person, not to play by themselves: with nobody watching, a server grinding
 * through matches is pure waste. An operator can lift this from the console
 * when they want to watch the bots go at it.
 */
export const canRun = (state) => state.botsOnly || state.players.some((p) => !p.bot)

/**
 * Bots are opt-in. Somebody who turns up first gets the choice: hold the lobby
 * open for other people, or start now against the machine. Filling the arena
 * the instant one person arrives takes that choice away, and a match against
 * bots you did not ask for is worse than a short wait.
 */
export function wantBots(state) {
  state.botsWanted = true
  return true
}

function fillBots(state) {
  // Nobody here: clear the bots out rather than leave them playing to nobody,
  // and forget the request, so the next person to arrive gets the choice fresh.
  if (!canRun(state)) {
    for (const bot of state.players.filter((p) => p.bot)) removePlayer(state, bot.id)
    state.botsWanted = false
    return
  }
  // Held open until somebody asks, or an operator says otherwise.
  if (!state.botsWanted && !state.botsOnly) {
    for (const bot of state.players.filter((p) => p.bot)) removePlayer(state, bot.id)
    return
  }

  const want = Math.max(0, Math.min(state.botFill, MAX_PLAYERS) - state.players.filter((p) => !p.bot).length)
  const bots = state.players.filter((p) => p.bot)
  for (let i = bots.length; i < want; i++) {
    const taken = new Set(state.players.map((p) => p.name))
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Unit ${state.nextId}`
    // A bot arriving mid-round sits it out, exactly as a person would.
    seat(state, name, true)
  }
  for (let i = want; i < bots.length; i++) removePlayer(state, bots[i].id)
}

// --- Tick --------------------------------------------------------------

export function tick(state, dt, rng = Math.random) {
  state.now += dt
  state.events = []
  fillBots(state)

  if (!canRun(state) && state.phase !== 'waiting') {
    // The last person left mid-match. Stand it down rather than let the bots
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
    if (state.players.length < MIN_PLAYERS) state.phase = 'waiting'
    else if (state.now >= state.phaseUntil) startRound(state, rng)
    return
  }

  // Deathmatch puts the dead back on the board; last man standing does not.
  if (!isLastMan(state)) {
    for (const p of state.players) {
      if (!p.alive && state.now >= p.respawnAt) place(state, p)
    }
  }

  if (state.phase === 'over') {
    if (state.now < state.phaseUntil) return
    if (state.players.length < MIN_PLAYERS) {
      state.phase = 'waiting'
      return
    }
    // A finished match resets the running total; a finished round does not.
    if (state.final) {
      for (const p of state.players) {
        p.wins = 0
        p.kills = 0
        p.deaths = 0
      }
    }
    startCountdown(state)
    return
  }

  driveBots(state, rng)
  movePlayers(state, dt)
  moveBombs(state, dt)

  // Fuses run down after movement, so the tick you clear the lane is the tick
  // that saves you.
  const due = state.bombs.filter((b) => !b.air && state.now >= b.at)
  if (due.length > 0) {
    state.bombs = state.bombs.filter((b) => !due.includes(b))
    for (const b of due) detonate(state, b, rng)
  }

  for (const key of Object.keys(state.fires)) {
    if (state.now >= state.fires[key].until) delete state.fires[key]
  }

  burnPlayers(state)

  while (state.now >= state.nextRegrowAt) {
    regrow(state, rng)
    state.nextRegrowAt += REGROW_EVERY_MS
  }
  while (state.now >= state.squeezeAt) {
    squeeze(state)
    state.squeezeAt += SQUEEZE_EVERY_MS
  }
  while (state.now >= state.nextPickupAt) {
    spawnPickup(state, rng)
    state.nextPickupAt += PICKUP_EVERY_MS
  }

  if (isLastMan(state)) {
    const standing = state.players.filter((p) => p.inRound && p.alive)
    if (standing.length <= 1) {
      for (const p of state.players) p.inRound = false
      endRound(state, standing[0] ?? null)
    }
    return
  }

  // Deathmatch: the match ends on a score, and there are no rounds inside it.
  const leader = state.players.find((p) => p.kills >= KILL_TARGET)
  if (leader) {
    state.phase = 'over'
    state.phaseUntil = state.now + OVER_MS
    state.winner = leader.name
    state.winnerId = leader.id
    state.final = true
  }
}

/**
 * The one message shape broadcast to clients.
 * ponytail: full state every tick, no diffing. 425 tiles and a handful of
 * entities is a couple of KB a frame; at 30 Hz that is fine on a LAN, and it
 * means a client never needs an earlier packet to render.
 */
export function snapshot(state) {
  return {
    t: 'state',
    phase: state.phase,
    w: W,
    h: H,
    secs:
      state.phase === 'over' || state.phase === 'countdown'
        ? Math.max(0, Math.ceil((state.phaseUntil - state.now) / 1000))
        : 0,
    winner: state.winner,
    winnerId: state.winnerId,
    board: state.board,
    // Whether that winner took the round or the whole match.
    final: state.final,
    target: isLastMan(state) ? ROUND_TARGET : KILL_TARGET,
    min: MIN_PLAYERS,
    arena: state.arena,
    mode: state.mode,
    botsOnly: state.botsOnly,
    botsWanted: state.botsWanted,
    // Whether the wall has started closing, so the client can say so. The
    // tiles themselves already show it; this is what makes it readable rather
    // than just visible.
    squeezing: state.squeezeStep > 0,
    fuse: BOMB_FUSE_MS,
    blast: BLAST_MS,
    events: state.events,
    tiles: state.tiles,
    pickups: state.pickups,
    fires: Object.keys(state.fires).map(Number),
    bombs: state.bombs.map((b) => ({
      id: b.id,
      x: r2(b.x),
      y: r2(b.y),
      in: Number.isFinite(b.at) ? Math.max(0, b.at - state.now) : -1,
      air: b.air ? 1 : 0,
      held: b.carriedBy ? 1 : 0,
    })),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      x: r2(p.x),
      y: r2(p.y),
      alive: p.alive,
      inRound: p.inRound,
      wins: p.wins,
      kills: p.kills,
      deaths: p.deaths,
      bombs: p.bombs,
      live: state.bombs.filter((b) => b.owner === p.id).length,
      range: p.range,
      tier: p.tier,
      kick: p.kick,
      glove: p.glove,
      remote: p.remote,
      vest: p.vest,
      square: p.square,
      drill: p.drill,
      carrying: !!heldBomb(state, p),
    })),
  }
}
