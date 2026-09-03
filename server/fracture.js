// Rules for one Fracture Line match. Pure: no sockets, no Node APIs. The one
// import is the shared name sanitizer — duplicating a trust-boundary filter is
// how the two copies drift apart. Everything here is exercised by
// fracture.test.js.

import { sanitizeName } from './game.js'

// --- Tuning ------------------------------------------------------------
// Cell units throughout. Players and bullets carry float positions; walls are
// grid-aligned, which is what makes building a snap-to-cell action and keeps
// the snapshot small. Play it and move the numbers.
// Sized for the arena being busy: five bots plus whoever turns up needs room
// to break contact in, and at 32x20 everybody was always in everybody's lane.
// Grows together with POWERUP_MAX and COVER_BLOCKS below — a bigger board with
// the same number of pickups just means longer walks between them.
export const W = 40
export const H = 24
export const TICK_MS = 33

export const RADIUS = 0.34 // < 0.5, so a one-cell gap stays walkable
export const SPEED = 6.5 // cells/second
export const SPRINT_MULT = 1.8

export const BULLET_SPEED = 24
export const BULLET_LIFE_MS = 1400
export const FIRE_COOLDOWN_MS = 260
export const PLAYER_HP = 3
export const WALL_HP = 3

export const BUILD_CHARGES = 4
export const BUILD_REGEN_MS = 3500
export const BUILD_REACH = 1.2

// A short blink in whatever direction you are already moving. Walked out in
// small steps rather than teleported, so it can never cross a wall — that is
// the difference between a mobility tool and a noclip.
export const DASH_DISTANCE = 2
export const DASH_COOLDOWN_MS = 2000
// A dash that scrapes a few centimetres along a wall is not a dash. Below this
// it is refused outright and costs nothing, so pressing shift into cover never
// silently eats the cooldown.
export const DASH_MIN_GAIN = 0.5
const DASH_STEP = 0.08

export const RESPAWN_MS = 2500
export const KILL_TARGET = 12
export const OVER_MS = 8000
export const MIN_PLAYERS = 2

// One slot, picked up off the floor. The decision is which to carry and when
// to spend it, same as Blockout Royale.
export const POWERUP_EVERY_MS = 6000
export const POWERUP_MAX = 5
export const POWERUP_KINDS = [
  'sprint',
  'shield',
  'overcharge',
  'bulwark',
  'rapid',
  'shotgun',
  'popup',
  'medkit',
  'sword',
  'bomb',
  'mine',
  'grapple',
  'cloak',
]

// A charge left on the floor. It arms after a beat — long enough that you
// cannot drop one under somebody's feet — and then takes the first person who
// walks onto it. The only thing in the kit that holds ground while you are
// somewhere else.
export const MINE_ARM_MS = 900
export const MINE_RADIUS = 1.1
export const MINE_LIFE_MS = 25000

// A line fired at cover that pulls you to it. It stops where a round would
// stop, so it can never put you through a wall.
export const GRAPPLE_RANGE = 9
export const GRAPPLE_GAP = RADIUS + 0.12

// You render to everyone else as an outline. Your own view is unchanged, and
// the markers and minimap lose you too — that is most of what it buys.
export const CLOAK_MS = 4500
export const SPRINT_MS = 2500
export const OVERCHARGE_MS = 4000
// How many layers of cover an overcharged round punches through. Infinite: an
// overcharged round opens a lane through everything in front of it and keeps
// going, which is the point of picking it up. The budget arithmetic below is
// unchanged — Infinity just never runs out.
export const PIERCE_LAYERS = Infinity
// A bulwark is a U of fresh cover thrown up around you, closed side facing
// whoever is nearest. Three cells deep on the closed side and one down each
// flank, which is enough to break a line of sight without being a fort.
export const BULWARK_HP = WALL_HP

// Cover only ever gets shot away, and a measured six-player match ended with
// 9% of its cover left — a flat room, which is the opposite of what this game
// is about. So the arena reasserts itself: on a timer, damaged walls gain a
// point back and cells that were cover in the CARVED layout return at 1 HP.
// Anything a player built is not in that layout and stays gone, so ground you
// carved is still yours; it is the designed arena that heals.
export const REPAIR_EVERY_MS = 9000

// Bots top the arena up so a lone player still has a match. `botFill` is a
// per-match setting rather than a constant, so every existing caller keeps an
// arena of exactly the players it created.
export const BOT_FILL_TO = 5
export const BOT_NAMES = ['Vex', 'Rill', 'Kade', 'Sable', 'Nox', 'Wren', 'Dax', 'Cove']
// A bot decides roughly five times a second, not thirty. That lag is what makes
// it beatable, and it is more honest than handicapping its aim alone.
export const BOT_REACT_MS = 210
// Aim is wrong in two human ways rather than one. BOT_AIM_ERROR is the widest
// a bot's crosshair ever sits from true — held as a persistent bias that
// wanders by BOT_AIM_DRIFT per decision, so a bot is off in a consistent
// direction for a while instead of being right on average. BOT_TURN_RATE then
// stops it snapping: it has to swing its aim around like a wrist, which is
// what makes a fast crossing target genuinely hard for it.
export const BOT_AIM_ERROR = 0.17
export const BOT_AIM_DRIFT = 0.1
export const BOT_TURN_RATE = 3.2 // radians per second
export const BOT_RANGE = 14
// How far a bot will detour for a pickup it can see. Wide enough that it goes
// out of its way, short enough that it never crosses the whole arena for one
// and forgets there is a fight on.
export const BOT_PICKUP_RANGE = 9

// A medkit heals, and keeps going past full. Overheal is a real buffer you can
// be shot through — it does not decay, so a fight is the only thing that takes
// it off you. Capped, or a hoarder could stack an unkillable margin.
// A sword swing kills outright, whatever the target's health or overheal. Its
// price is that you have to be close enough to touch them, and a shield still
// gets its one save.
export const SWORD_MS = 7000
export const MELEE_REACH = 1.7
export const MELEE_ARC = 0.9 // radians either side of where you are looking
export const MELEE_COOLDOWN_MS = 600

// While a bomb is in hand it replaces the block charge: the same key, the same
// pool, an entirely different result. The blast runs the full width or height
// of the arena along the axis you were facing, clearing everything on the line.
export const BOMB_MS = 8000
export const BOMB_FUSE_MS = 1300

export const MEDKIT_HEAL = 2
export const OVERHEAL_MAX = PLAYER_HP + MEDKIT_HEAL

// An in-fiction popup ad, fired at everyone else. Times out on its own, so it
// can never grief somebody out of a whole match.
export const AD_MS = 4000

// One name walks in untouchable and shoots rounds that chase. Matched on the
// sanitised name so padding and case cannot be used to sneak in, and exactly —
// 'nicolas' is an ordinary operator.
export const DEATHLESS_NAME = 'nic'
export const HOMING_TURN_RATE = 7 // radians per second a chasing round can bend

// Rapid divides whatever your current fire cooldown is, so it stacks with the
// shotgun rather than replacing it.
export const RAPID_MS = 5000
export const RAPID_MULT = 4

// The shotgun trades range and rate for a wall of pellets. Each pellet is an
// ordinary round, so damage, piercing and wall-chewing all work unchanged —
// there are just five of them, and they do not travel far.
export const SHOTGUN_MS = 6000
export const SHOTGUN_PELLETS = 5
export const SHOTGUN_SPREAD = 0.44
export const SHOTGUN_COOLDOWN_MS = 520
export const SHOTGUN_RANGE_MS = 420

// The longest cycle any weapon can impose. Spawn credit is measured against
// this, not against the pistol, or picking up a shotgun you have never fired
// would make you serve a wait you had already served.
export const MAX_CYCLE_MS = Math.max(FIRE_COOLDOWN_MS, SHOTGUN_COOLDOWN_MS, MELEE_COOLDOWN_MS)

// Rectangles of cover dropped into one half of the arena and mirrored. Each
// one becomes two, so the real count is double this. Too few and the arena is
// a shooting gallery with nowhere to break line of sight; too many and there
// are no sightlines left to break. Play it and move the number.
export const COVER_BLOCKS = 12
export const COVER_MAX_SIZE = 4

// The grid is always the same size; the ARENA is the wall layout carved into
// it. Nothing downstream needs to know which one is up — movement, collision,
// building and the protocol are identical for all of them, so a new layout is
// a few rect() calls and a name here.
// A handmade layout is first, so a fixed rng of 0 gives the same arena every
// time under test.
export const ARENAS = ['kiln', 'substation', 'drydock', 'scrapyard']

// Every spawn has a 180-degree partner (W-1-x, H-1-y), which is the same
// symmetry carve() mirrors across. Opposite pairs come first so a two-player
// match starts as far apart as the arena allows.
export const SPAWNS = [
  [2, 2],
  [37, 21],
  [37, 2],
  [2, 21],
  [19, 2],
  [20, 21],
  [2, 12],
  [37, 11],
]

// Derived, never hand-written: a capacity past the spawn list would put a
// player at undefined. To raise capacity, add spawn points above.
export const MAX_PLAYERS = SPAWNS.length

// Two decimals is about a centimetre at this scale — under what a player can
// see, and it keeps the JSON frame short enough to read in a packet capture.
const r2 = (n) => Math.round(n * 100) / 100

const idx = (x, y) => y * W + x
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H
const isBorder = (x, y) => x === 0 || y === 0 || x === W - 1 || y === H - 1

/**
 * A match with its arena already standing. Carved here and not only in
 * startMatch, or a lobby waiting on its second player would broadcast 640
 * empty cells and a client would have a blank screen to look at.
 */
export function createMatch(rng = Math.random, arena = ARENAS[Math.floor(rng() * ARENAS.length)]) {
  const state = {
    phase: 'waiting',
    now: 0,
    phaseUntil: 0,
    // 0 is empty, anything higher is remaining wall HP.
    walls: new Array(W * H).fill(0),
    // Which cells the arena was carved with, so repair knows the difference
    // between a breach in the map and a wall somebody built.
    layout: new Array(W * H).fill(0),
    nextRepairAt: Infinity,
    bullets: [],
    nextBulletId: 1,
    bombs: [],
    nextBombId: 1,
    mines: [],
    nextMineId: 1,
    // Sparse: cell index -> kind. Only occupied cells travel, which keeps the
    // broadcast small and the Wireshark view readable.
    powerups: {},
    nextPowerupAt: Infinity,
    // What happened during the tick being broadcast, and nothing older. Refilled
    // from scratch every tick, so it is a delta the client can react to without
    // the server having to remember anything about presentation.
    events: [],
    arena,
    players: [],
    nextId: 1,
    // Set from the operator console. Off means no match runs without a person
    // in it, which is how it sits in normal use.
    botsOnly: false,
    // Nobody gets bots until somebody asks for them.
    botsWanted: false,
    winner: null,
    winnerId: null,
    // How many participants to top up to with bots. Zero leaves the arena
    // exactly as populated as its callers made it.
    botFill: 0,
  }
  carve(state, arena, rng)
  return state
}

/** Joins the match, or returns null when every spawn point is taken. */
export function addPlayer(state, name) {
  if (state.players.length >= MAX_PLAYERS) {
    // A bot never keeps a person out of the arena.
    const bot = state.players.find((q) => q.bot)
    if (!bot) return null
    removePlayer(state, bot.id)
  }
  return seat(state, sanitizeName(name), false)
}

function seat(state, name, bot) {
  const player = {
    id: state.nextId++,
    name,
    bot,
    // Exact match on the sanitised name, so ' NIC ' counts and 'nicolas' does not.
    deathless: !bot && name.trim().toLowerCase() === DEATHLESS_NAME,
    // Bot-only steering state. Harmless on a person, and one shape for every
    // player means nothing downstream has to care which is which.
    thinkAt: 0,
    strafe: 1,
    duckUntil: 0,
    aimBias: 0,
    lastX: 0,
    lastY: 0,
    x: 0,
    y: 0,
    aim: 0,
    hp: 0,
    alive: false,
    respawnAt: 0,
    // ponytail: score lives on the connection, so a reload resets it. Key it
    // by name in a separate map only if people start caring about that.
    kills: 0,
    deaths: 0,
    lastFireAt: 0,
    lastDashAt: 0,
    charges: BUILD_CHARGES,
    nextChargeAt: 0,
    held: null,
    shielded: false,
    sprintUntil: 0,
    overchargeUntil: 0,
    rapidUntil: 0,
    shotgunUntil: 0,
    adUntil: 0,
    swordUntil: 0,
    bombUntil: 0,
    cloakUntil: 0,
    input: { dx: 0, dy: 0, aim: 0, fire: false },
  }
  state.players.push(player)
  return player
}

/**
 * Tops the arena up to `botFill` participants, and stands bots down again as
 * people arrive. Called every tick, so a match is never short of opponents and
 * never holding a slot a person could use.
 */
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

export function ensureBots(state, rng = Math.random) {
  // Nobody here: clear the bots out rather than leave them playing to nobody,
  // and forget the request, so the next person to arrive gets the choice fresh.
  if (!canRun(state)) {
    for (const bot of state.players.filter((p) => p.bot)) removePlayer(state, bot.id)
    state.botsWanted = false
    return
  }
  if (!state.botFill) return
  // Held open until somebody asks, or an operator says otherwise.
  if (!state.botsWanted && !state.botsOnly) {
    for (const bot of state.players.filter((p) => p.bot)) removePlayer(state, bot.id)
    return
  }
  const humans = state.players.filter((p) => !p.bot).length
  const bots = state.players.filter((p) => p.bot)
  const want = Math.max(0, Math.min(state.botFill, MAX_PLAYERS) - humans)

  for (let i = bots.length; i > want; i--) removePlayer(state, bots[i - 1].id)
  for (let i = bots.length; i < want; i++) {
    const taken = new Set(state.players.map((p) => p.name))
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${state.nextId}`
    const bot = seat(state, name, true)
    bot.strafe = rng() < 0.5 ? 1 : -1
    // Joining mid-match deploys immediately rather than waiting out a death.
    if (state.phase === 'playing') respawn(state, bot)
  }
}

export function removePlayer(state, id) {
  const i = state.players.findIndex((p) => p.id === id)
  if (i !== -1) state.players.splice(i, 1)
  // Bullets outlive their owner rather than vanishing — a shot already in
  // flight has left the gun. They simply stop crediting a kill.
}

// --- Arena -------------------------------------------------------------

function place(state, x, y) {
  if (inBounds(x, y)) state.walls[idx(x, y)] = WALL_HP
}

/**
 * Places a rectangle and its 180-degree partner. Every layout is built out of
 * this, so symmetry is structural rather than something each one has to
 * remember to get right.
 */
function rect(state, x, y, w, h) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      place(state, i, j)
      place(state, W - 1 - i, H - 1 - j)
    }
  }
}

/**
 * Border ring plus the named layout's cover, mirrored 180 degrees so neither
 * half of the arena is the good half. Only the left half is ever described;
 * rect() fills the right.
 */
function carve(state, arena, rng) {
  state.walls.fill(0)
  for (let x = 0; x < W; x++) {
    place(state, x, 0)
    place(state, x, H - 1)
  }
  for (let y = 0; y < H; y++) {
    place(state, 0, y)
    place(state, W - 1, y)
  }

  if (arena === 'kiln') {
    // One heavy mass in the middle you have to commit to going around, with
    // chimney stacks out on the flanks to break the long lanes.
    rect(state, 16, 10, 4, 4)
    rect(state, 7, 4, 2, 6)
    rect(state, 7, 14, 2, 6)
    rect(state, 13, 3, 5, 1)
    rect(state, 4, 11, 3, 2)
    rect(state, 12, 17, 4, 2)
  } else if (arena === 'substation') {
    // Regular pillars with a two-cell corridor down the middle. Every sightline
    // is a straight lane, so position matters more than map knowledge.
    for (let y = 4; y <= 19; y += 5) {
      for (let x = 4; x <= 16; x += 6) rect(state, x, y, 3, 2)
    }
  } else if (arena === 'drydock') {
    // Two long dock walls with a gap punched through the middle of each: the
    // arena for people who like holding an angle.
    rect(state, 5, 6, 14, 1)
    rect(state, 5, 17, 14, 1)
    rect(state, 10, 10, 1, 6)
    rect(state, 18, 3, 1, 4)
    rect(state, 2, 9, 3, 1)
    rect(state, 14, 20, 4, 1)
    rect(state, 6, 11, 2, 2)
  } else {
    // scrapyard: whatever the generator feels like today.
    for (let n = 0; n < COVER_BLOCKS; n++) {
      const bw = 1 + Math.floor(rng() * COVER_MAX_SIZE)
      const bh = 1 + Math.floor(rng() * COVER_MAX_SIZE)
      const bx = 3 + Math.floor(rng() * (W / 2 - 5))
      const by = 3 + Math.floor(rng() * (H - 7))
      rect(state, bx, by, bw, bh)
    }
  }

  // Nobody spawns inside cover, and nobody spawns already pinned against it.
  for (const [sx, sy] of SPAWNS) {
    for (let y = sy - 1; y <= sy + 1; y++) {
      for (let x = sx - 1; x <= sx + 1; x++) {
        if (inBounds(x, y) && !isBorder(x, y)) state.walls[idx(x, y)] = 0
      }
    }
  }

  // Snapshot of the arena as designed. Everything after this is damage.
  state.layout = state.walls.map((v) => (v > 0 ? 1 : 0))
}

/** The spawn point furthest from the nearest living rival. */
function bestSpawn(state, self) {
  let best = SPAWNS[0]
  let bestScore = -1
  for (const [sx, sy] of SPAWNS) {
    let nearest = Infinity
    for (const o of state.players) {
      if (o === self || !o.alive) continue
      nearest = Math.min(nearest, Math.hypot(o.x - (sx + 0.5), o.y - (sy + 0.5)))
    }
    if (nearest > bestScore) {
      bestScore = nearest
      best = [sx, sy]
    }
  }
  return best
}

function respawn(state, p) {
  const [sx, sy] = bestSpawn(state, p)
  p.x = sx + 0.5
  p.y = sy + 0.5
  p.hp = PLAYER_HP
  p.alive = true
  p.shielded = false
  p.sprintUntil = 0
  p.overchargeUntil = 0
  p.rapidUntil = 0
  p.shotgunUntil = 0
  p.swordUntil = 0
  p.bombUntil = 0
  p.cloakUntil = 0
  // Dying at least buys you your screen back.
  p.adUntil = 0
  p.charges = BUILD_CHARGES
  p.nextChargeAt = state.now + BUILD_REGEN_MS
  // Backdated, or the first shot of every life sits out a cooldown it never
  // earned — whichever weapon that life happens to pick up.
  p.lastFireAt = state.now - MAX_CYCLE_MS
  p.lastDashAt = state.now - DASH_COOLDOWN_MS
}

export function startMatch(state, rng = Math.random, arena = ARENAS[Math.floor(rng() * ARENAS.length)]) {
  state.arena = arena
  carve(state, arena, rng)
  state.bullets = []
  state.bombs = []
  state.mines = []
  state.powerups = {}
  state.nextPowerupAt = state.now + POWERUP_EVERY_MS
  state.nextRepairAt = state.now + REPAIR_EVERY_MS
  state.winner = null
  state.winnerId = null
  state.phase = 'playing'
  for (const p of state.players) {
    p.kills = 0
    p.deaths = 0
    p.held = null
    respawn(state, p)
  }
}

// --- Collision ---------------------------------------------------------

function solidAt(state, x, y) {
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  if (!inBounds(cx, cy)) return true
  return state.walls[idx(cx, cy)] > 0
}

/** True if a player box centred here overlaps any wall. */
function blocked(state, x, y) {
  return (
    solidAt(state, x - RADIUS, y - RADIUS) ||
    solidAt(state, x + RADIUS, y - RADIUS) ||
    solidAt(state, x - RADIUS, y + RADIUS) ||
    solidAt(state, x + RADIUS, y + RADIUS)
  )
}

// --- Input -------------------------------------------------------------

// Anything off the wire is suspect: a NaN here would drive a position to NaN
// and make a player permanently unhittable — the shooter's version of the
// un-eliminable Blockout bug.
const clamp1 = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0
const angle = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function setInput(state, id, msg) {
  const p = state.players.find((q) => q.id === id)
  if (!p) return false
  p.input = {
    dx: clamp1(msg?.dx),
    dy: clamp1(msg?.dy),
    aim: angle(msg?.aim),
    fire: msg?.fire === true,
  }
  return true
}

// --- Actions -----------------------------------------------------------

/**
 * One swing. Everything living inside the arc and within reach dies outright,
 * unless a wall is in the way or a shield takes it instead.
 */
function swing(state, p) {
  if (state.now - p.lastFireAt < MELEE_COOLDOWN_MS) return
  p.lastFireAt = state.now
  state.events.push({
    k: 'swing',
    by: p.id,
    x: r2(p.x),
    y: r2(p.y),
    aim: r2(p.aim),
    r: MELEE_REACH,
    arc: MELEE_ARC,
  })

  for (const o of state.players) {
    if (o === p || !o.alive) continue
    if (Math.hypot(o.x - p.x, o.y - p.y) > MELEE_REACH) continue
    // Shortest angle between where the blade went and where they are standing.
    const bearing = Math.atan2(o.y - p.y, o.x - p.x)
    const off = Math.abs(((bearing - p.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
    if (off > MELEE_ARC) continue
    // No reaching through cover.
    if (!clearShot(state, p, o)) continue

    wound(state, o, o.hp, p.id, o.x, o.y)
  }
}

function fire(state, p) {
  if (state.now < p.swordUntil) return swing(state, p)
  const shotgun = state.now < p.shotgunUntil
  const base = shotgun ? SHOTGUN_COOLDOWN_MS : FIRE_COOLDOWN_MS
  const cooldown = state.now < p.rapidUntil ? base / RAPID_MULT : base
  if (state.now - p.lastFireAt < cooldown) return
  p.lastFireAt = state.now

  const pierce = state.now < p.overchargeUntil
  const count = shotgun ? SHOTGUN_PELLETS : 1
  for (let i = 0; i < count; i++) {
    // Pellets fan evenly across the spread; a single round goes straight.
    const aim = shotgun ? p.aim + (i / (count - 1) - 0.5) * SHOTGUN_SPREAD : p.aim
    state.bullets.push({
      id: state.nextBulletId++,
      owner: p.id,
      x: p.x + Math.cos(aim) * (RADIUS + 0.1),
      y: p.y + Math.sin(aim) * (RADIUS + 0.1),
      vx: Math.cos(aim) * BULLET_SPEED,
      vy: Math.sin(aim) * BULLET_SPEED,
      // Pellets die early: that short life IS the shotgun's range falloff.
      dieAt: state.now + (shotgun ? SHOTGUN_RANGE_MS : BULLET_LIFE_MS),
      // Rounds that chase, and end whoever they reach.
      home: p.deathless,
      lethal: p.deathless,
      // Two separate properties on purpose: `hot` is how hard the round hits
      // and lasts the whole flight, `pierce` is a budget of walls it may cross
      // and is spent on the way.
      hot: pierce,
      pierce: pierce ? PIERCE_LAYERS : 0,
      // A pierced shot sits in one cell for several substeps. Without this it
      // would chew that cell once per substep instead of once per crossing.
      lastCell: -1,
    })
  }
}

/**
 * Raises one wall, unless the cell is taken or the wall would pin a player in
 * place. Comparing cells is not enough: a player standing near a boundary
 * overlaps the next cell over, and walling that cell leaves them with no legal
 * move in any direction — so the movement test itself is the judge.
 */
function placeIfSafe(state, cx, cy, hp = WALL_HP) {
  if (!inBounds(cx, cy) || state.walls[idx(cx, cy)] > 0) return false
  if (Object.hasOwn(state.powerups, idx(cx, cy))) return false
  state.walls[idx(cx, cy)] = hp
  if (state.players.some((o) => o.alive && blocked(state, o.x, o.y))) {
    state.walls[idx(cx, cy)] = 0
    return false
  }
  return true
}

/**
 * Blinks DASH_DISTANCE cells the way you are moving, or the way you are aiming
 * if you are standing still. Stops short at the first wall in the way, and a
 * dash that could not move at all costs nothing.
 */
export function dash(state, id) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.alive) return false
  if (state.now - p.lastDashAt < DASH_COOLDOWN_MS) return false

  let { dx, dy } = p.input
  const len = Math.hypot(dx, dy)
  if (len === 0) {
    dx = Math.cos(p.aim)
    dy = Math.sin(p.aim)
  } else {
    dx /= len
    dy /= len
  }

  const ox = p.x
  const oy = p.y
  let moved = 0
  for (let d = DASH_STEP; d <= DASH_DISTANCE + 1e-9; d += DASH_STEP) {
    const nx = ox + dx * d
    const ny = oy + dy * d
    if (blocked(state, nx, ny)) break
    p.x = nx
    p.y = ny
    moved = d
  }
  if (moved < DASH_MIN_GAIN) {
    p.x = ox
    p.y = oy
    return false
  }
  p.lastDashAt = state.now
  return true
}

/**
 * Arms a bomb one cell ahead instead of a wall. Same key, same charge pool —
 * what the charge becomes is the only difference.
 */
function placeBomb(state, p) {
  const cx = Math.floor(p.x + Math.cos(p.aim) * BUILD_REACH)
  const cy = Math.floor(p.y + Math.sin(p.aim) * BUILD_REACH)
  if (!inBounds(cx, cy) || isBorder(cx, cy)) return false
  if (state.walls[idx(cx, cy)] > 0) return false
  if (state.bombs.some((b) => b.cx === cx && b.cy === cy)) return false

  // The blast runs along whichever axis you were most nearly facing.
  const alongX = Math.abs(Math.cos(p.aim)) >= Math.abs(Math.sin(p.aim))
  state.bombs.push({
    id: state.nextBombId++,
    owner: p.id,
    cx,
    cy,
    axis: alongX ? 'x' : 'y',
    at: state.now + BOMB_FUSE_MS,
  })
  p.charges -= 1
  return true
}

/** Levels one row or column of the arena, and everyone standing in it. */
function detonate(state, b) {
  state.events.push({ k: 'blast', axis: b.axis, at: b.axis === 'x' ? b.cy : b.cx })

  if (b.axis === 'x') {
    for (let x = 1; x < W - 1; x++) state.walls[idx(x, b.cy)] = 0
  } else {
    for (let y = 1; y < H - 1; y++) state.walls[idx(b.cx, y)] = 0
  }

  for (const o of state.players) {
    if (!o.alive) continue
    const on =
      b.axis === 'x'
        ? Math.floor(o.y - RADIUS) <= b.cy && b.cy <= Math.floor(o.y + RADIUS)
        : Math.floor(o.x - RADIUS) <= b.cx && b.cx <= Math.floor(o.x + RADIUS)
    if (!on) continue
    wound(state, o, o.hp, b.owner, o.x, o.y)
  }
}

/** Drops a wall one cell ahead of where you are aiming. */
export function build(state, id) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.alive) return false
  // No rate limit beyond the charges themselves: four walls is four walls
  // whether you place them over four seconds or all at once, and being able to
  // throw up a corner in one motion is the point of carrying them.
  if (p.charges <= 0) return false
  if (state.now < p.bombUntil) return placeBomb(state, p)

  const cx = Math.floor(p.x + Math.cos(p.aim) * BUILD_REACH)
  const cy = Math.floor(p.y + Math.sin(p.aim) * BUILD_REACH)
  if (!placeIfSafe(state, cx, cy)) return false
  p.charges -= 1
  return true
}

/**
 * Throws up a U of cover around a player, closed side facing `dir`. The walls
 * are laid against the player's BOX rather than their cell, so the U can never
 * be built on top of the person it is protecting.
 */
function bulwarkAround(state, p, dir) {
  // Walls are grid-aligned, so the U has to be. Snap to whichever cardinal the
  // threat is most nearly on.
  const alongX = Math.abs(Math.cos(dir)) >= Math.abs(Math.sin(dir))
  const fx = alongX ? Math.sign(Math.cos(dir)) || 1 : 0
  const fy = alongX ? 0 : Math.sign(Math.sin(dir)) || 1

  const x0 = Math.floor(p.x - RADIUS)
  const x1 = Math.floor(p.x + RADIUS)
  const y0 = Math.floor(p.y - RADIUS)
  const y1 = Math.floor(p.y + RADIUS)

  const cells = []
  if (fy === 0) {
    const face = fx > 0 ? x1 + 1 : x0 - 1
    for (let y = y0 - 1; y <= y1 + 1; y++) cells.push([face, y])
    for (let x = x0; x <= x1; x++) {
      cells.push([x, y0 - 1])
      cells.push([x, y1 + 1])
    }
  } else {
    const face = fy > 0 ? y1 + 1 : y0 - 1
    for (let x = x0 - 1; x <= x1 + 1; x++) cells.push([x, face])
    for (let y = y0; y <= y1; y++) {
      cells.push([x0 - 1, y])
      cells.push([x1 + 1, y])
    }
  }

  let raised = 0
  for (const [x, y] of cells) if (placeIfSafe(state, x, y)) raised++
  return raised
}

/**
 * The nearest living rival, or null. Ties break by id, never by array order.
 * Self is skipped by ID rather than by identity, because callers pass a bare
 * {id, x, y} — a homing round asking from where it currently is, not from where
 * the player who fired it is standing.
 */
function nearestLiving(state, p) {
  let target = null
  let best = Infinity
  for (const o of state.players) {
    if (o.id === p.id || !o.alive) continue
    const d = Math.hypot(o.x - p.x, o.y - p.y)
    if (d < best || (d === best && target !== null && o.id < target.id)) {
      best = d
      target = o
    }
  }
  return target
}

/**
 * The heading of the nearest living rival, or your own aim if you are the only
 * one left. Auto-targeted so a bulwark stays a single keypress.
 */
function threatDirection(state, p) {
  const target = nearestLiving(state, p)
  return target ? Math.atan2(target.y - p.y, target.x - p.x) : p.aim
}

/** The nearest pickup within `range`, as a cell index, or -1. */
function nearestPowerup(state, p, range) {
  let best = -1
  let bestD = range
  for (const key of Object.keys(state.powerups)) {
    const i = Number(key)
    const d = Math.hypot((i % W) + 0.5 - p.x, ((i / W) | 0) + 0.5 - p.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Whether a round could travel from a to b without meeting a wall. */
function clearShot(state, from, to) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.ceil(dist / 0.2)
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    if (solidAt(state, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false
  }
  return true
}

/**
 * Writes each bot's input for this tick. Bots go through setInput exactly like
 * a socket would, so every rule that binds a person binds a bot: the same
 * cooldowns, the same collision, the same validation.
 */
function driveBots(state, rng) {
  for (const b of state.players) {
    if (!b.bot || !b.alive) continue
    if (state.now < b.thinkAt) continue
    b.thinkAt = state.now + BOT_REACT_MS

    const target = nearestLiving(state, b)
    if (!target) {
      b.input = { dx: 0, dy: 0, aim: b.aim, fire: false }
      continue
    }

    const bearing = Math.atan2(target.y - b.y, target.x - b.x)
    const dist = Math.hypot(target.x - b.x, target.y - b.y)
    const inRange = dist <= BOT_RANGE
    const see = inRange && clearShot(state, b, target)

    // Empty-handed with something on the floor nearby? Go and get it. Where it
    // walks changes; what it shoots at does not.
    const pick = b.held ? -1 : nearestPowerup(state, b, BOT_PICKUP_RANGE)
    const fetching = pick !== -1

    // Went nowhere since the last decision, so something is in the way.
    const stuck = Math.hypot(b.x - b.lastX, b.y - b.lastY) < 0.15
    if (stuck) b.strafe = -b.strafe
    b.lastX = b.x
    b.lastY = b.y
    const lean = stuck ? b.strafe * 1.1 : 0

    let dx
    let dy
    if (fetching) {
      const toPick = Math.atan2(((pick / W) | 0) + 0.5 - b.y, (pick % W) + 0.5 - b.x)
      dx = Math.cos(toPick + lean)
      dy = Math.sin(toPick + lean)
    } else if (!see) {
      // No clean line: close in, and lean around whatever is in the way rather
      // than grinding straight into it.
      dx = Math.cos(bearing + lean)
      dy = Math.sin(bearing + lean)
    } else if (state.now < b.duckUntil) {
      // Just laid a bomb on its own line. Get off it.
      dx = Math.cos(bearing + Math.PI / 2) * b.strafe
      dy = Math.sin(bearing + Math.PI / 2) * b.strafe
    } else if (dist < 3.5) {
      dx = -Math.cos(bearing) // too close for comfort
      dy = -Math.sin(bearing)
    } else {
      dx = Math.cos(bearing + Math.PI / 2) * b.strafe
      dy = Math.sin(bearing + Math.PI / 2) * b.strafe
    }

    // The crosshair wanders, then the wrist has to catch up to it.
    b.aimBias = Math.max(
      -BOT_AIM_ERROR,
      Math.min(BOT_AIM_ERROR, b.aimBias + (rng() - 0.5) * 2 * BOT_AIM_DRIFT),
    )
    const wanted = bearing + b.aimBias
    const shortest = ((wanted - b.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    const maxTurn = BOT_TURN_RATE * (BOT_REACT_MS / 1000)

    b.input = {
      dx,
      dy,
      aim: b.aim + Math.max(-maxTurn, Math.min(maxTurn, shortest)),
      // Fires on range alone, not on line of sight. Cover here is destructible,
      // so shooting the wall between you and someone IS progress — and it is
      // what stops a bot pinning itself against a corner with a full magazine.
      fire: inRange,
    }

    // What it picks up gets spent rather than hoarded, and a bot with no shot
    // blinks its way to a better angle.
    if (b.held) usePowerup(state, b.id)
    if (!see && rng() < 0.25) dash(state, b.id)

    // A bomb in hand is only a powerup if it actually gets laid. Laying one
    // puts the blast along the bot's own line, so it commits to moving clear
    // for as long as the fuse runs.
    if (state.now < b.bombUntil && inRange && rng() < 0.4 && build(state, b.id)) {
      b.duckUntil = state.now + BOMB_FUSE_MS
    }
  }
}

/**
 * Fires a line along your aim. If it bites cover inside GRAPPLE_RANGE you are
 * pulled up to it; if it finds nothing, the pickup is not spent.
 *
 * Walked out in steps rather than teleported, exactly like a dash, so it can
 * never put you through the wall it caught.
 */
function grapple(state, p) {
  const dx = Math.cos(p.aim)
  const dy = Math.sin(p.aim)
  let landed = 0
  for (let d = 0.1; d <= GRAPPLE_RANGE; d += 0.1) {
    const x = p.x + dx * d
    const y = p.y + dy * d
    if (!inBounds(Math.floor(x), Math.floor(y))) break
    if (blocked(state, x, y)) break
    landed = d
  }
  // Nothing worth pulling towards: too short to be a grapple.
  if (landed < GRAPPLE_GAP + 0.5) return false
  p.x += dx * landed
  p.y += dy * landed
  state.events.push({ k: 'grapple', by: p.id, x: r2(p.x), y: r2(p.y) })
  return true
}

/** Arms a charge where you are standing. */
function layMine(state, p) {
  state.mines.push({
    id: state.nextMineId++,
    owner: p.id,
    x: r2(p.x),
    y: r2(p.y),
    armAt: state.now + MINE_ARM_MS,
    dieAt: state.now + MINE_LIFE_MS,
  })
}

/** Takes anyone standing on an armed mine, and clears the spent ones. */
function resolveMines(state) {
  if (state.mines.length === 0) return
  const live = []
  for (const m of state.mines) {
    if (state.now >= m.dieAt) continue
    if (state.now < m.armAt) {
      live.push(m)
      continue
    }
    const caught = state.players.find(
      (q) => q.alive && q.id !== m.owner && Math.hypot(q.x - m.x, q.y - m.y) <= MINE_RADIUS,
    )
    if (!caught) {
      live.push(m)
      continue
    }
    state.events.push({ k: 'blast', by: m.owner, tiles: [], range: 0 })
    wound(state, caught, caught.hp, m.owner, m.x, m.y)
  }
  state.mines = live
}

export function usePowerup(state, id) {
  if (state.phase !== 'playing') return false
  const p = state.players.find((q) => q.id === id)
  if (!p || !p.alive || !p.held) return false

  const kind = p.held
  p.held = null
  if (kind === 'sprint') p.sprintUntil = state.now + SPRINT_MS
  else if (kind === 'shield') p.shielded = true
  else if (kind === 'overcharge') p.overchargeUntil = state.now + OVERCHARGE_MS
  else if (kind === 'bulwark') bulwarkAround(state, p, threatDirection(state, p))
  else if (kind === 'rapid') p.rapidUntil = state.now + RAPID_MS
  else if (kind === 'shotgun') p.shotgunUntil = state.now + SHOTGUN_MS
  else if (kind === 'medkit') p.hp = Math.min(p.hp + MEDKIT_HEAL, OVERHEAL_MAX)
  else if (kind === 'sword') p.swordUntil = state.now + SWORD_MS
  else if (kind === 'bomb') p.bombUntil = state.now + BOMB_MS
  else if (kind === 'cloak') p.cloakUntil = state.now + CLOAK_MS
  else if (kind === 'mine') layMine(state, p)
  else if (kind === 'grapple' && !grapple(state, p)) {
    // The line found nothing. Keep the pickup rather than eat it for a miss.
    p.held = kind
    return false
  }
  else if (kind === 'popup') {
    // Everyone but you. Spending it on a corpse would be a waste, so the dead
    // are spared too.
    for (const o of state.players) {
      if (o !== p && o.alive) o.adUntil = state.now + AD_MS
    }
  }
  return true
}

// --- Simulation --------------------------------------------------------

function movePlayers(state, dt) {
  const secs = dt / 1000
  for (const p of state.players) {
    if (!p.alive) continue
    p.aim = p.input.aim

    let { dx, dy } = p.input
    const len = Math.hypot(dx, dy)
    // Normalise, or a diagonal is 1.41x faster than a cardinal.
    if (len > 1) {
      dx /= len
      dy /= len
    }
    const speed = SPEED * (state.now < p.sprintUntil ? SPRINT_MULT : 1) * secs

    // Axes resolved separately, so sliding along a wall works instead of
    // sticking. Anything better than this needs a real physics pass.
    const nx = p.x + dx * speed
    if (!blocked(state, nx, p.y)) p.x = nx
    const ny = p.y + dy * speed
    if (!blocked(state, p.x, ny)) p.y = ny

    const cell = idx(Math.floor(p.x), Math.floor(p.y))
    if (!p.held && Object.hasOwn(state.powerups, cell)) {
      p.held = state.powerups[cell]
      delete state.powerups[cell]
    }

    if (p.input.fire) fire(state, p)

    if (p.charges < BUILD_CHARGES && state.now >= p.nextChargeAt) {
      p.charges += 1
      p.nextChargeAt = state.now + BUILD_REGEN_MS
    }
  }
}

function kill(state, victim, ownerId) {
  state.events.push({ k: 'kill', by: ownerId, of: victim.id })
  victim.alive = false
  victim.deaths += 1
  victim.respawnAt = state.now + RESPAWN_MS
  victim.shielded = false
  const killer = state.players.find((q) => q.id === ownerId)
  if (killer && killer !== victim) killer.kills += 1
}

/**
 * The only place a player loses health. Rounds, blades and blasts all come
 * through here, so whatever decides who can be hurt gets decided exactly once
 * rather than in three places that drift apart.
 *
 * The impact point travels with the event so the client can show the victim
 * which direction it came from. A damage of 0 is something absorbing the hit —
 * the attacker still deserves to be told they connected.
 */
function wound(state, victim, dmg, byId, x, y) {
  const hit = (n) =>
    state.events.push({ k: 'hit', by: byId, of: victim.id, x: r2(x), y: r2(y), dmg: n })

  if (victim.deathless) {
    hit(0)
    return
  }
  if (victim.shielded) {
    victim.shielded = false
    hit(0)
    return
  }
  victim.hp -= dmg
  hit(dmg)
  if (victim.hp <= 0) kill(state, victim, byId)
}

function hitPlayer(state, b, p) {
  wound(state, p, b.lethal ? p.hp : b.hot ? 2 : 1, b.owner, b.x, b.y)
}

// Four substeps per tick. A bullet covers ~0.8 cells per tick, so a single
// step would already be close; four means it cannot tunnel through one-cell
// cover even if BULLET_SPEED is turned up.
const SUBSTEPS = 4

function moveBullets(state, dt) {
  const step = dt / 1000 / SUBSTEPS
  const live = []
  for (const b of state.bullets) {
    let alive = state.now < b.dieAt
    for (let s = 0; s < SUBSTEPS && alive; s++) {
      if (b.home) {
        // Bend towards whoever is nearest, at a bounded rate. Steering rather
        // than snapping means a round can still be broken by a corner, so it
        // stays a round and not a guaranteed hit.
        const mark = nearestLiving(state, { id: b.owner, x: b.x, y: b.y })
        if (mark) {
          const want = Math.atan2(mark.y - b.y, mark.x - b.x)
          const cur = Math.atan2(b.vy, b.vx)
          const off = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI
          const most = HOMING_TURN_RATE * step
          const aim = cur + Math.max(-most, Math.min(most, off))
          b.vx = Math.cos(aim) * BULLET_SPEED
          b.vy = Math.sin(aim) * BULLET_SPEED
        }
      }
      b.x += b.vx * step
      b.y += b.vy * step

      const target = state.players.find(
        (p) =>
          p.alive &&
          p.id !== b.owner &&
          Math.abs(p.x - b.x) < RADIUS &&
          Math.abs(p.y - b.y) < RADIUS,
      )
      if (target) {
        hitPlayer(state, b, target)
        alive = false
        break
      }

      const cx = Math.floor(b.x)
      const cy = Math.floor(b.y)
      if (!inBounds(cx, cy)) {
        alive = false
        break
      }
      if (state.walls[idx(cx, cy)] > 0) {
        // The border ring is the arena boundary. Shots stop there, always.
        if (isBorder(cx, cy)) {
          alive = false
          break
        }
        if (idx(cx, cy) !== b.lastCell) {
          b.lastCell = idx(cx, cy)
          state.walls[idx(cx, cy)] = Math.max(0, state.walls[idx(cx, cy)] - (b.hot ? 2 : 1))
          // Crossing costs a layer. Out of layers, the wall stops the round.
          if (b.pierce > 0) b.pierce -= 1
          else {
            alive = false
            break
          }
        }
      }
    }
    if (alive) live.push(b)
  }
  state.bullets = live
}

/**
 * One pass of arena repair: standing damage knits back up, and breaches in the
 * carved layout grow back weak enough to reopen with a single round.
 * ponytail: a whole-grid sweep on a timer rather than a per-cell countdown, so
 * a wall shot down just before a sweep returns sooner than one shot down just
 * after. 640 cells every nine seconds is nothing, and the imprecision is not
 * something a player can perceive, let alone plan around.
 */
function repairArena(state) {
  for (let i = 0; i < state.walls.length; i++) {
    // Repair touches the carved arena and nothing else. A wall a player put up
    // is theirs: it never heals and it never comes back, so cover you made is
    // cover you have to maintain. (Build into a breach in the arena and that
    // cell counts as arena again — the layout is the whole rule.)
    if (!state.layout[i]) continue
    if (state.walls[i] > 0) {
      if (state.walls[i] < WALL_HP) state.walls[i] += 1
      continue
    }
    placeIfSafe(state, i % W, (i / W) | 0, 1)
  }
}

function spawnPowerup(state, rng) {
  if (Object.keys(state.powerups).length >= POWERUP_MAX) return
  const free = []
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y)
      if (state.walls[i] > 0 || Object.hasOwn(state.powerups, i)) continue
      free.push(i)
    }
  }
  if (free.length === 0) return
  state.powerups[free[Math.floor(rng() * free.length)]] =
    POWERUP_KINDS[Math.floor(rng() * POWERUP_KINDS.length)]
}

export function tick(state, dt, rng = Math.random) {
  state.now += dt
  // Only ever this tick's events. Cleared before anything can add to it, and
  // before every early return below, so a paused phase cannot leave a stale
  // kill on screen.
  state.events = []
  ensureBots(state, rng)

  if (!canRun(state) && state.phase !== 'waiting') {
    // The last person left mid-match. Stand it down rather than let the bots
    // play it out to an empty room.
    state.phase = 'waiting'
    state.winner = null
    state.winnerId = null
  }

  if (state.phase === 'waiting') {
    if (canRun(state) && state.players.length >= MIN_PLAYERS) startMatch(state, rng)
    return
  }

  if (state.phase === 'over') {
    if (state.now < state.phaseUntil) return
    if (state.players.length >= MIN_PLAYERS) startMatch(state, rng)
    else state.phase = 'waiting'
    return
  }

  for (const p of state.players) {
    if (!p.alive && state.now >= p.respawnAt) respawn(state, p)
  }

  driveBots(state, rng)
  movePlayers(state, dt)
  moveBullets(state, dt)
  resolveMines(state)

  // Fuses run down after movement, so the tick you step off the line is the
  // tick that saves you.
  if (state.bombs.length > 0) {
    const live = []
    for (const b of state.bombs) {
      if (state.now >= b.at) detonate(state, b)
      else live.push(b)
    }
    state.bombs = live
  }

  while (state.now >= state.nextPowerupAt) {
    spawnPowerup(state, rng)
    state.nextPowerupAt += POWERUP_EVERY_MS
  }
  while (state.now >= state.nextRepairAt) {
    repairArena(state)
    state.nextRepairAt += REPAIR_EVERY_MS
  }

  const leader = state.players.find((p) => p.kills >= KILL_TARGET)
  if (leader) {
    state.phase = 'over'
    state.winner = leader.name
    // The id as well as the name: two players may share a name, and only the
    // winner's own client should get the celebration.
    state.winnerId = leader.id
    state.phaseUntil = state.now + OVER_MS
  }
}

/**
 * The one message shape broadcast to clients.
 * ponytail: full state every tick, no diffing. 640 cells and a handful of
 * entities is roughly 1.5 KB a frame; at 30 Hz that is fine on a LAN, and it
 * means a client never needs an earlier packet to render. Delta-encode only if
 * this ever has to cross the open internet.
 */
export function snapshot(state) {
  return {
    t: 'state',
    phase: state.phase,
    w: W,
    h: H,
    secs:
      state.phase === 'over' ? Math.max(0, Math.ceil((state.phaseUntil - state.now) / 1000)) : 0,
    winner: state.winner,
    winnerId: state.winnerId,
    botsOnly: state.botsOnly,
    botsWanted: state.botsWanted,
    target: KILL_TARGET,
    min: MIN_PLAYERS,
    // Sent so the client can draw a meter without hardcoding the cooldown it
    // is measuring against.
    dashMax: DASH_COOLDOWN_MS,
    adMax: AD_MS,
    bombFuse: BOMB_FUSE_MS,
    // What counts as full, so the client knows which health pips are overheal.
    hpMax: PLAYER_HP,
    arena: state.arena,
    events: state.events,
    walls: state.walls,
    powerups: state.powerups,
    bullets: state.bullets.map((b) => ({ id: b.id, x: r2(b.x), y: r2(b.y), p: b.hot })),
    // Armed mines only. One still arming is not yet a threat, and telling
    // everyone exactly where it landed the instant it was dropped would make it
    // useless.
    mines: state.mines
      .filter((m) => state.now >= m.armAt)
      .map((m) => ({ id: m.id, x: m.x, y: m.y, by: m.owner })),
    bombs: state.bombs.map((b) => ({
      id: b.id,
      x: b.cx,
      y: b.cy,
      axis: b.axis,
      in: Math.max(0, b.at - state.now),
    })),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      x: r2(p.x),
      y: r2(p.y),
      aim: r2(p.aim),
      hp: p.hp,
      alive: p.alive,
      deathless: p.deathless,
      kills: p.kills,
      deaths: p.deaths,
      charges: p.charges,
      held: p.held,
      shielded: p.shielded,
      sprinting: state.now < p.sprintUntil,
      dashIn: Math.max(0, DASH_COOLDOWN_MS - (state.now - p.lastDashAt)),
      adIn: Math.max(0, p.adUntil - state.now),
      overcharged: state.now < p.overchargeUntil,
      rapid: state.now < p.rapidUntil,
      shotgun: state.now < p.shotgunUntil,
      sword: state.now < p.swordUntil,
      bomb: state.now < p.bombUntil,
      cloaked: state.now < p.cloakUntil,
    })),
  }
}
