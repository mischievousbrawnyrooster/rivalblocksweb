// Rules for one Blockout Royale match. Pure: no sockets, no Node APIs, no
// imports. Everything here is exercised by game.test.js.

// --- Tuning ------------------------------------------------------------
// The collapse rate is what decides whether a round is tense or tedious, and
// no amount of reasoning settles it. Play the game and move the numbers.
// SIZE and COLLAPSE_COUNT move together: a round lasts at least roughly
// (SIZE^2 / COLLAPSE_COUNT) * COLLAPSE_EVERY_MS — longer in practice, because
// the wave tapers with the floor (see COLLAPSE_SHARE) — so growing the arena without
// collapsing faster just makes rounds drag. 15x15 at 6 per wave is ~34s —
// a little longer than the old 9x9, because there is more ground to use.
// Going further: 17 wants COLLAPSE_COUNT 8, 19 wants 10. Past about 19 the
// tiles get too small to read on a phone, which is the real ceiling.
export const SIZE = 15
export const TICK_MS = 100
export const MOVE_COOLDOWN_MS = 120
export const COLLAPSE_EVERY_MS = 900
export const COLLAPSE_COUNT = 6

// A wave never takes more than this share of what is still standing.
//
// Six tiles out of a full board is a wave you can read and run from. Six out
// of the last twelve is a coin toss — most of the remaining floor going at
// once, with nowhere to be that was not about to be a hole. The count tapers
// with the board so the endgame is still a game, and the opening is untouched:
// while there is plenty of floor the share is above COLLAPSE_COUNT and the cap
// is what binds.
// Measured over a full board: at this share a round runs 48 seconds at the
// outside against 27 before, and the wave is down to a single tile once there
// are sixteen left. Steeper than this and the endgame is still several tiles a
// go; shallower and the round drags.
export const COLLAPSE_SHARE = 0.06

/** How many tiles the next wave takes, given how much floor is left to take. */
export const waveSize = (solid) =>
  Math.max(1, Math.min(COLLAPSE_COUNT, Math.ceil(solid * COLLAPSE_SHARE)))

// How fast waves come once there is barely any floor left.
//
// The wave shrinks towards a single tile, so on a fixed clock the endgame
// slowed to a crawl — one tile every nine hundred milliseconds, with two
// players circling what was left. Fewer tiles has to mean more often, or the
// taper buys readability at the cost of the round going anywhere.
export const COLLAPSE_FASTEST_MS = 260

/**
 * How long until the next wave, given how much floor is left.
 *
 * Full board is COLLAPSE_EVERY_MS and an empty one is COLLAPSE_FASTEST_MS,
 * straight between. Paired with `waveSize`, the round takes less and less at a
 * time and takes it faster and faster.
 */
export const collapseDelay = (solid) => {
  const share = Math.max(0, Math.min(1, solid / (SIZE * SIZE)))
  return Math.round(COLLAPSE_FASTEST_MS + (COLLAPSE_EVERY_MS - COLLAPSE_FASTEST_MS) * share)
}
export const WARNING_MS = 1500
export const COUNTDOWN_MS = 3000
export const OVER_MS = 5000
export const MIN_PLAYERS = 2

// Rounds are short, so a single one settles very little. Three of them is a
// match, and a match is the only thing the standing leaderboard records — the
// other two games are scored the same way, which is what makes one board across
// all three mean anything.
export const ROUND_TARGET = 3

// Bots top the board up so one person still gets a round, exactly as in the
// other two titles. They are opt-in: somebody who arrives first chooses between
// holding the lobby for other people and starting now against the machine.
export const BOT_FILL_TO = 5
export const BOT_REACT_MS = 260
export const BOT_NAMES = ['Pell', 'Grit', 'Mote', 'Talc', 'Quill', 'Bram', 'Fen']

// Powerups. You carry at most one and spend it when you choose, so the
// decision is which to keep and when to fire it.
//
// Paced against the round, not the clock. A round here is over in ten or
// fifteen seconds, so a four second interval put an average of 1.6 pickups on
// the board and left four rounds in ten with none at all — a kit nobody ever
// touched. At this interval a typical round carries several, and the first one
// is on the floor before anybody has had to commit to a direction.
export const POWERUP_EVERY_MS = 1600
// Scaled with the arena, or a bigger board just means longer walks between
// pickups. Roughly one per 45 tiles.
export const POWERUP_MAX = 5
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
]

// How often a kind comes up, against one for everything not listed.
//
// Patch is the only thing in the kit that gives floor back, on a board whose
// whole premise is losing it — so it is the one worth crossing the arena for.
// At even odds it came up once in seven, which made it a novelty rather than a
// plan. At three it is a third of what drops, or roughly twice a round.
export const POWERUP_WEIGHTS = { patch: 3 }

// The bag drawn from: every kind at least once, the weighted ones more. Built
// from POWERUP_KINDS rather than written out, so a kind added above cannot be
// left out of the draw by accident.
const POWERUP_BAG = POWERUP_KINDS.flatMap((kind) =>
  Array(Object.hasOwn(POWERUP_WEIGHTS, kind) ? POWERUP_WEIGHTS[kind] : 1).fill(kind),
)

// A hop that clears holes. Nothing else in the kit can cross a gap, which is
// what used to make a late round a question of which island you happened to be
// standing on rather than anything you did.
export const BLINK_TILES = 3

// How long the next wave is shown to whoever spent a foresight. The wave is
// picked early for everyone, but only they are told which tiles it is.
export const FORESIGHT_MS = 6000
export const DASH_MS = 2500
export const HOVER_MS = 2500
export const HOVER_STEP = 0.4
export const HOVER_COOLDOWN_MS = 20
export const SHOVE_RADIUS = 2
export const SHOVE_DIST = 2
export const BRIDGE_TILES = 4
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
    reinforced: new Set(),
    nextCollapseAt: Infinity,
    // Sparse: tile index -> kind. Only occupied tiles appear, which keeps the
    // broadcast small and the Wireshark view readable.
    powerups: {},
    nextPowerupAt: Infinity,
    arena: 'square',
    players: [],
    nextId: 1,
    winner: null,
    // The id as well as the name, because two people may be called the same
    // thing and only the one who actually won should be told they did.
    winnerId: null,
    // Whether that winner took the round or the whole match.
    final: false,
    // The standing leaderboard, best first. Set from outside by server.js and
    // passed through untouched: no rule here reads it, and nothing about the
    // match depends on it.
    board: [],
    // How many participants to top up to with bots. Zero leaves the board
    // exactly as populated as its callers made it.
    botFill: 0,
    // Nobody gets bots until somebody asks, and no round runs with nobody
    // watching. An operator can lift the second one from the console.
    botsWanted: false,
    botsOnly: false,
    // The tiles the next wave will take, chosen early so foresight can show it.
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
    x: 0,
    y: 0,
    lastMoveAt: 0,
    // ponytail: score lives on the connection, so a reload resets it. Key it
    // by name in a separate map only if people start caring about that.
    wins: 0,
    held: null,
    shielded: false,
    dashUntil: 0,
    hoverUntil: 0,
    // The way they last moved, so a blink knows where to go.
    face: [1, 0],
    seeingUntil: 0,
    thinkAt: 0,
  }
  state.players.push(player)
  return player
}

/**
 * Joins the match. Anyone may connect — past capacity you spectate and are
 * handed a piece next round, which is this game's own arrangement and not
 * something bots get to take away. A person does displace a bot, though: a
 * seat held by the machine is not a seat.
 */
export function addPlayer(state, name) {
  const bot = state.players.find((p) => p.bot)
  if (bot && state.players.length >= MAX_PLAYERS) removePlayer(state, bot.id)
  return seat(state, sanitizeName(name), false)
}

/**
 * Whether the round is allowed to run at all. Bots exist to fill a board for a
 * person, not to play by themselves: with nobody watching, a server grinding
 * through rounds is pure waste. An operator can lift this from the console.
 */
export const canRun = (state) => state.botsOnly || state.players.some((p) => !p.bot)

/**
 * Bots are opt-in. Somebody who turns up first gets the choice: hold the lobby
 * open for other people, or start now against the machine.
 */
export function wantBots(state) {
  state.botsWanted = true
  return true
}

/**
 * Tops the board up to `botFill` participants and stands bots down again as
 * people arrive, so a round is never short of opponents and never holding a
 * seat a person could use.
 */
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
  // Bots are seated by the tick, not here, so an operator restarting the round
  // for one person is starting it with one participant. Laying the board out
  // anyway hands them the round on the very next tick — the bots arrive, sit
  // it out as anyone arriving mid-round does, and the survivor check finds a
  // single player standing. A round nobody contested, and now that three of
  // them take a match, a match nobody contested either.
  //
  // Hand it to the waiting branch instead, which lays the board out once there
  // is somebody to play against.
  if (state.players.length < MIN_PLAYERS) {
    state.phase = 'waiting'
    state.winner = null
    state.winnerId = null
    state.final = false
    return
  }

  state.tiles.fill('solid')
  state.warnAt.fill(0)
  state.reinforced = new Set()
  state.winner = null
  state.nextCollapseAt = state.now + COLLAPSE_EVERY_MS
  state.nextWave = []
  state.powerups = {}
  state.nextPowerupAt = state.now + POWERUP_EVERY_MS

  state.arena = ARENAS[Math.floor(rng() * ARENAS.length)]
  carve(state, state.arena, rng)
  keepLargestRegion(state)
  state.nextWave = pickWave(state, rng)
  const spawns = snapSpawns(state)

  state.players.forEach((p, i) => {
    p.playing = i < MAX_PLAYERS
    p.alive = p.playing
    p.held = null
    p.shielded = false
    p.dashUntil = 0
    p.hoverUntil = 0
    p.face = [1, 0]
    p.seeingUntil = 0
    if (p.playing) {
      ;[p.x, p.y] = spawns[i]
      // Backdated, or the very first move of the round hits its own cooldown.
      p.lastMoveAt = state.now - MOVE_COOLDOWN_MS
    }
  })

  // One on the floor before the first tick. The shortest rounds were over
  // inside the first interval, so four rounds in ten ran start to finish with
  // nothing on the board to pick up. Placed last, once the arena is carved and
  // everyone is standing on it, or it would land in the void or under a player.
  spawnPowerup(state, rng)
  state.phase = 'playing'
}

/** Applies one step. Returns false, silently, for anything illegal. */
export function move(state, id, dir) {
  if (state.phase !== 'playing') return false

  const p = state.players.find((q) => q.id === id)
  if (!p || !p.playing || !p.alive) return false
  const isHovering = state.now < p.hoverUntil
  const cooldown = isHovering
    ? HOVER_COOLDOWN_MS
    : state.now < p.dashUntil
      ? DASH_COOLDOWN_MS
      : MOVE_COOLDOWN_MS
  if (state.now - p.lastMoveAt < cooldown) return false

  const step = Object.hasOwn(DIRS, dir) ? DIRS[dir] : null
  if (!step) return false

  if (isHovering) {
    const nx = Math.max(0, Math.min(SIZE - 1, p.x + step[0] * HOVER_STEP))
    const ny = Math.max(0, Math.min(SIZE - 1, p.y + step[1] * HOVER_STEP))
    p.x = Math.round(nx * 100) / 100
    p.y = Math.round(ny * 100) / 100
    p.face = step
    p.lastMoveAt = state.now

    const dest = Math.round(p.y) * SIZE + Math.round(p.x)
    if (!p.held && Object.hasOwn(state.powerups, dest)) {
      p.held = state.powerups[dest]
      delete state.powerups[dest]
    }
    return true
  }

  const x = p.x + step[0]
  const y = p.y + step[1]
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false
  if (state.tiles[y * SIZE + x] === 'gone') return false
  if (state.players.some((o) => o !== p && o.playing && o.alive && o.x === x && o.y === y)) {
    return false
  }

  p.x = x
  p.y = y
  p.face = step
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

/**
 * Rebuilds every hole in the three by three the player is standing in.
 *
 * Corners included, which is most of what makes it worth carrying: the four
 * orthogonal neighbours alone rebuilt a plus, and a plus is not an island you
 * can stand on once the floor around it goes. Only holes are rebuilt — a tile
 * already flagged for the next wave stays flagged, so a patch buys you ground,
 * never a reprieve from a wave you can see coming.
 */
function patchAround(state, p) {
  for (let y = p.y - 1; y <= p.y + 1; y++) {
    for (let x = p.x - 1; x <= p.x + 1; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
      const i = y * SIZE + x
      if (state.tiles[i] !== 'gone') continue
      state.tiles[i] = 'solid'
      state.warnAt[i] = 0
    }
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
  const i = Math.round(target.y) * SIZE + Math.round(target.x)
  if (state.reinforced.has(i)) {
    state.reinforced.delete(i)
    return
  }
  if (state.tiles[i] !== 'solid') return
  state.tiles[i] = 'warn'
  state.warnAt[i] = state.now + WARNING_MS
}

/**
 * Hops up to BLINK_TILES the way you last moved, over anything in between.
 * Only the landing tile has to be somewhere you could stand, which is the whole
 * point: it is the one thing in the game that crosses a hole.
 */
function blink(state, p) {
  const [dx, dy] = p.face
  for (let n = BLINK_TILES; n >= 1; n--) {
    const x = p.x + dx * n
    const y = p.y + dy * n
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
    if (state.tiles[y * SIZE + x] === 'gone') continue
    if (state.players.some((o) => o !== p && o.playing && o.alive && o.x === x && o.y === y)) {
      continue
    }
    p.x = x
    p.y = y
    return true
  }
  return false
}

/**
 * Trades places with the nearest living rival. Auto-targeted so it stays one
 * keypress, and ties break by id rather than by array order.
 *
 * Both of you were standing somewhere legal a moment ago, so the swap always
 * is — the question is only what the tile you hand them is about to do.
 */
function swap(state, p) {
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
  if (target === null) return false
  const x = p.x
  const y = p.y
  p.x = target.x
  p.y = target.y
  target.x = x
  target.y = y
  return true
}

/**
 * Emits a kinetic impulse wave shoving all living rivals within SHOVE_RADIUS by SHOVE_DIST away.
 */
function shoveRivals(state, p) {
  let any = false
  for (const o of state.players) {
    if (o === p || !o.playing || !o.alive) continue
    const dx = o.x - p.x
    const dy = o.y - p.y
    const dist = Math.max(Math.abs(dx), Math.abs(dy))
    if (dist > SHOVE_RADIUS) continue

    any = true
    const sx = Math.sign(dx) || (dy === 0 ? p.face[0] : 0)
    const sy = Math.sign(dy) || (dx === 0 ? p.face[1] : 0)

    for (let step = 1; step <= SHOVE_DIST; step++) {
      const nx = o.x + sx
      const ny = o.y + sy
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) break
      if (state.players.some((q) => q !== o && q.playing && q.alive && q.x === nx && q.y === ny)) {
        break
      }
      o.x = nx
      o.y = ny
      if (state.tiles[ny * SIZE + nx] === 'gone') {
        if (state.now < o.hoverUntil) continue
        if (o.shielded) {
          o.shielded = false
          const safe = adjacentSolid(state, o)
          if (safe) {
            ;[o.x, o.y] = safe
            break
          }
        }
        o.alive = false
        break
      }
    }
  }
  return any
}

/**
 * Projects a straight line of solid tiles forward in the player's facing direction.
 */
function buildBridge(state, p) {
  const [dx, dy] = p.face ?? [1, 0]
  let repaired = 0
  for (let n = 1; n <= BRIDGE_TILES; n++) {
    const x = p.x + dx * n
    const y = p.y + dy * n
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) break
    const i = y * SIZE + x
    if (state.tiles[i] === 'gone') {
      state.tiles[i] = 'solid'
      state.warnAt[i] = 0
      repaired++
    }
  }
  return repaired > 0
}

/**
 * Hardens the 3x3 area around the player with reinforced steel plating to absorb a collapse wave.
 */
function anchorAround(state, p) {
  const px = Math.round(p.x)
  const py = Math.round(p.y)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx
      const y = py + dy
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
      const i = y * SIZE + x
      if (state.tiles[i] === 'gone') continue
      state.tiles[i] = 'solid'
      state.warnAt[i] = 0
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
    p.held = kind
    return false
  } else if (kind === 'bridge' && !buildBridge(state, p)) {
    p.held = kind
    return false
  }
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
  state.powerups[i] = POWERUP_BAG[Math.floor(rng() * POWERUP_BAG.length)]
}

/**
 * A step towards the nearest tile that satisfies `want`, over ground that is
 * still standing. Warned tiles are passable — sometimes crossing one is the
 * only way off an island — but they are never a destination.
 */
function stepTo(state, p, want) {
  const isHovering = state.now < p.hoverUntil
  const px = Math.round(p.x)
  const py = Math.round(p.y)
  const start = py * SIZE + px
  const seen = new Set([start])
  const queue = [[start, null]]

  for (let head = 0; head < queue.length; head++) {
    const [i, first] = queue[head]
    if (first !== null && want(i)) return first
    const x = i % SIZE
    const y = (i / SIZE) | 0
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
      const j = ny * SIZE + nx
      if (seen.has(j)) continue
      if (!isHovering && state.tiles[j] === 'gone') continue
      seen.add(j)
      // Another piece is a wall as far as pathing is concerned.
      if (
        state.players.some(
          (o) =>
            o.playing &&
            o.alive &&
            o !== p &&
            Math.round(o.y) * SIZE + Math.round(o.x) === j,
        )
      ) {
        continue
      }
      queue.push([j, first ?? [dx, dy]])
    }
  }
  return null
}

/** How much standing ground a tile can reach, capped — a crude island size. */
function roomAround(state, i, cap = 24) {
  if (state.tiles[i] !== 'solid') return 0
  const seen = new Set([i])
  const queue = [i]
  for (let head = 0; head < queue.length && seen.size < cap; head++) {
    const x = queue[head] % SIZE
    const y = (queue[head] / SIZE) | 0
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
      const j = ny * SIZE + nx
      if (seen.has(j) || state.tiles[j] !== 'solid') continue
      seen.add(j)
      queue.push(j)
    }
  }
  return seen.size
}

const dirName = (step) =>
  Object.keys(DIRS).find((k) => DIRS[k][0] === step[0] && DIRS[k][1] === step[1])

/**
 * One decision per bot per BOT_REACT_MS. In a game whose whole threat is the
 * floor, the order is: get off a tile that is about to go, then take anything
 * lying around, then work towards the biggest piece of floor left — which is
 * the same instinct that keeps a person alive here.
 */
export function driveBots(state, rng = Math.random) {
  for (const b of state.players) {
    if (!b.bot || !b.playing || !b.alive) continue

    if (b.held) usePowerup(state, b.id)

    const isHovering = state.now < b.hoverUntil
    if (!isHovering && state.now < b.thinkAt) continue

    const cooldown = isHovering ? HOVER_COOLDOWN_MS : BOT_REACT_MS
    if (state.now - b.lastMoveAt < cooldown) continue

    const stepsToTake = isHovering
      ? Math.max(1, Math.min(5, Math.floor((state.now - b.lastMoveAt) / HOVER_COOLDOWN_MS)))
      : 1

    for (let s = 0; s < stepsToTake; s++) {
      const bx = Math.round(b.x)
      const by = Math.round(b.y)
      const here = by * SIZE + bx
      const safe = (i) => state.tiles[i] === 'solid'

      let step = null
      if (isHovering) {
        // If on or near a hole/warning or small island, path towards large solid ground
        if (state.tiles[here] !== 'solid' || roomAround(state, here) < 12) {
          step = stepTo(state, b, (i) => safe(i) && roomAround(state, i) >= 12)
          if (!step) step = stepTo(state, b, safe)
        }
        // If already safe, seek powerups across holes
        if (!step && !b.held) {
          step = stepTo(state, b, (i) => safe(i) && Object.hasOwn(state.powerups, i))
        }
        // Otherwise fly towards any open in-bounds direction
        if (!step) {
          const open = Object.values(DIRS).filter(([dx, dy]) => {
            const x = bx + dx
            const y = by + dy
            return x >= 0 && y >= 0 && x < SIZE && y < SIZE
          })
          if (open.length > 0) step = open[Math.floor(rng() * open.length)]
        }
      } else {
        // Standing on a tile that has been flagged: anywhere solid will do.
        step = state.tiles[here] === 'warn' ? stepTo(state, b, safe) : null

        // Then something to carry, if a hand is free.
        if (!step && !b.held) {
          step = stepTo(state, b, (i) => safe(i) && Object.hasOwn(state.powerups, i))
        }

        // Otherwise work towards more floor than this. Nothing to gain from a
        // shrinking island, and every reason to leave it early.
        if (!step) {
          const room = roomAround(state, here)
          if (room < 12) step = stepTo(state, b, (i) => safe(i) && roomAround(state, i) > room)
        }

        // Nothing worth doing: shuffle, rather than stand on one tile waiting for
        // it to be the one that goes.
        if (!step) {
          const open = Object.values(DIRS).filter(([dx, dy]) => {
            const x = bx + dx
            const y = by + dy
            if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false
            return state.tiles[y * SIZE + x] === 'solid'
          })
          if (open.length > 0) step = open[Math.floor(rng() * open.length)]
        }
      }

      if (step) {
        if (isHovering && s > 0) b.lastMoveAt = state.now - HOVER_COOLDOWN_MS
        move(state, b.id, dirName(step))
      } else {
        break
      }
    }

    b.thinkAt = state.now + (isHovering ? HOVER_COOLDOWN_MS : BOT_REACT_MS)
  }
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
  // Safe to do here: once the phase is 'over', tick's early return means the
  // playing branch cannot run again this round, so this counts exactly once.
  if (survivor) survivor.wins += 1
  // Three rounds is a match. Read after the increment, so the round that
  // reaches the target is the round that ends it.
  state.final = !!survivor && survivor.wins >= ROUND_TARGET
}

/**
 * Chooses which tiles the NEXT wave will take.
 *
 * Picked ahead of time rather than at the moment it fires, because foresight
 * has to be able to show it. Nothing else changes: the wave is still random,
 * it is just random a little earlier.
 *
 * ponytail: rescans the grid once per wave. At a few hundred tiles and six
 * picks that is nothing; revisit only if the grid ever gets large.
 */
function pickWave(state, rng) {
  const solid = []
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] === 'solid') solid.push(i)
  }
  // Decided here and nowhere else, so the wave a foresight shows is exactly
  // the wave that lands.
  const take = waveSize(solid.length)
  const wave = []
  for (let n = 0; n < take && solid.length > 0; n++) {
    wave.push(solid.splice(Math.floor(rng() * solid.length), 1)[0])
  }
  return wave
}

function collapse(state, rng) {
  for (const i of state.nextWave) {
    // A tile can be patched or already flagged between the pick and the wave.
    if (state.tiles[i] !== 'solid') continue
    if (state.reinforced.has(i)) {
      state.reinforced.delete(i)
      continue
    }
    state.tiles[i] = 'warn'
    state.warnAt[i] = state.now + WARNING_MS
  }
  state.nextWave = pickWave(state, rng)
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
      if (state.now < p.hoverUntil) continue
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
    // A finished match resets the running total; a finished round does not.
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

  while (state.now >= state.nextCollapseAt) {
    // Read before the wave lands, so the gap that follows is paced by the
    // floor the players are actually standing on.
    collapse(state, rng)
    state.nextCollapseAt += collapseDelay(
      state.tiles.reduce((n, t) => (t === 'solid' ? n + 1 : n), 0),
    )
  }
  while (state.now >= state.nextPowerupAt) {
    spawnPowerup(state, rng)
    state.nextPowerupAt += POWERUP_EVERY_MS
  }
  resolveWarnings(state)

  for (const p of state.players) {
    if (!p.playing || !p.alive) continue
    if (p.hoverUntil && state.now >= p.hoverUntil) {
      p.hoverUntil = 0
      p.x = Math.max(0, Math.min(SIZE - 1, Math.round(p.x)))
      p.y = Math.max(0, Math.min(SIZE - 1, Math.round(p.y)))
      if (state.tiles[p.y * SIZE + p.x] === 'gone') {
        if (p.shielded) {
          p.shielded = false
          const safe = adjacentSolid(state, p)
          if (safe) {
            ;[p.x, p.y] = safe
            continue
          }
        }
        p.alive = false
      }
    } else if (state.tiles[Math.round(p.y) * SIZE + Math.round(p.x)] === 'gone' && state.now >= p.hoverUntil) {
      p.alive = false
    }
  }

  const standing = state.players.filter((p) => p.playing && p.alive)
  if (standing.length <= 1) endRound(state, standing[0] ?? null)
}

/**
 * The one message shape broadcast to clients.
 * ponytail: full-state broadcast every tick, no diffing. 81 tiles and four
 * players is a small object, and a client never needs earlier messages to
 * render. Delta-encode only if the grid ever exceeds ~400 tiles.
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
    secs: timed ? Math.max(0, Math.ceil((state.phaseUntil - state.now) / 1000)) : 0,
    winner: state.winner,
    winnerId: state.winnerId,
    // Whether they took the round or the match, and how many rounds a match is.
    final: state.final,
    target: ROUND_TARGET,
    board: state.board,
    arena: state.arena,
    min: MIN_PLAYERS,
    botsWanted: state.botsWanted,
    botsOnly: state.botsOnly,
    tiles: state.tiles,
    reinforced: Array.from(state.reinforced),
    powerups: state.powerups,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      x: p.x,
      y: p.y,
      playing: p.playing,
      alive: p.alive,
      wins: p.wins,
      held: p.held,
      shielded: p.shielded,
      dashing: state.now < p.dashUntil,
      hovering: state.now < p.hoverUntil,
      seeing: state.now < p.seeingUntil,
    })),
  }
}
