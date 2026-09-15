// Rules for one Void Drillers match. Pure: zero external imports, zero Node APIs,
// zero sockets, zero timers, zero I/O. Everything here is exercised by voiddrillers.test.js.

// --- Tuning & Dimensions --------------------------------------------------
export const WIDTH = 20
export const DEPTH = 260
export const TOTAL_BLOCKS = WIDTH * DEPTH

export const BLOCK_AIR = 0
export const BLOCK_DIRT = 1
export const BLOCK_STONE = 2
export const BLOCK_BEDROCK = 3
export const BLOCK_GAS = 4
export const BLOCK_GEODE = 5
export const BLOCK_VAULT = 6
export const BLOCK_SABOTAGE = 7
export const BLOCK_OBSIDIAN = 8

export const TICK_MS = 16 // 60 FPS simulation loop
export const GRACE_MS = 4000

export const VAULT_Y = 250
export const SPAWN_Y = 1.0

export const INITIAL_VOID_Y = -4.0
export const BASE_VOID_SPEED = 2.6 // blocks/sec (steady initial descent)
export const VOID_ACCEL = 0.025 // blocks/sec^2 (gradual time ramping)
export const VOID_DEPTH_ACCEL = 0.008 // blocks/sec per block depth (accelerates deeper in shaft)
export const MAX_VOID_SPEED = 6.2 // blocks/sec cap

export const PLAYER_WIDTH = 0.8
export const PLAYER_HEIGHT = 0.9
export const WALK_SPEED = 4.5 // blocks/sec
export const GRAVITY = 14.0 // blocks/sec^2
export const TERMINAL_VELOCITY = 12.0 // blocks/sec
export const JETPACK_THRUST = -18.0 // blocks/sec^2
export const FUEL_CONSUME_RATE = 0.35 // per sec
export const FUEL_RECHARGE_RATE = 0.50 // per sec

export const DIRT_HP = 1
export const STONE_HP = 3
export const GAS_HP = 1
export const GEODE_HP = 2
export const SABOTAGE_HP = 2
export const OBSIDIAN_HP = 7 // super-drill pulses only: 7 x 55 ms, just over stone's 3 x 110 ms by hand

// What a shattered sabotage crystal sends a rival, and for how long (ms).
// Mild on purpose: fog and tremor only blur the screen; chill slows the drill.
export const GRIEF_MS = { fog: 3000, tremor: 2500, chill: 3000 }
// How often each lands. Chill is the rare one, about one crystal in 21, since
// it is the only grief that costs a rival real drilling time.
export const GRIEF_WEIGHT = { fog: 10, tremor: 10, chill: 1 }
// Chance a deep row holds a sabotage crystal. Scattered singly, never touching.
export const SABOTAGE_ROW_CHANCE = 0.25

export const DRILL_RANGE = 1.35 // blocks
export const SUPER_DRILL_RANGE = 1.65 // blocks
export const DRILL_PULSE_INTERVAL = 110 // ms (~9 pulses per sec)
export const SUPER_DRILL_PULSE_INTERVAL = 55 // ms (~18 pulses per sec)
export const HEAT_ACCUMULATE_RATE = 0.25 // per sec
export const HEAT_DISSIPATE_RATE = 0.30 // per sec
export const OVERHEAT_LOCKOUT_MS = 1800 // ms
export const SUPER_DRILL_DURATION_MS = 5000 // ms (extended to 5s)


export const GAS_HAZARD_RADIUS = 2.4
export const GAS_HAZARD_TTL_MS = 3000
export const GAS_KNOCKBACK_FORCE = 8.0 // blocks/sec knockback impulse
export const GAS_KNOCKBACK_DECAY = 6 // per sec: a blast's sideways throw halves in about a tenth of a second
export const GAS_HEAT_SURGE = 0.50 // instant heat burst on detonation
export const GAS_FUEL_BURN = 0.25 // jetpack fuel burned by blast
export const GAS_CLOUD_HEAT_RATE = 0.45 // heat accumulation per sec while inside cloud
export const MAX_PLAYERS = 8
export const MIN_PLAYERS = 2 // people it takes to start a match without bots
export const BOT_FILL_TO = 4
export const BOT_NAMES = ['Bore', 'Quarry', 'Piston', 'Chisel', 'Grit', 'Rivet', 'Auger']
export const BOT_REACT_MS = 120 // ~8 bot decisions per sec

export const BLOCK_CHARS = ['A', 'D', 'S', 'B', 'G', 'C', 'V', 'X', 'O']
export const CHAR_TO_BLOCK = {
  A: BLOCK_AIR,
  D: BLOCK_DIRT,
  S: BLOCK_STONE,
  B: BLOCK_BEDROCK,
  G: BLOCK_GAS,
  C: BLOCK_GEODE,
  V: BLOCK_VAULT,
  X: BLOCK_SABOTAGE,
  O: BLOCK_OBSIDIAN
}

// --- Map Encoding & Decoding ----------------------------------------------
export function encodeMap(grid) {
  if (!grid || grid.length === 0) return ''
  let out = ''
  let currentType = grid[0]
  let currentCount = 1

  for (let i = 1; i < grid.length; i++) {
    const t = grid[i]
    if (t === currentType) {
      currentCount++
    } else {
      out += `${currentCount}${BLOCK_CHARS[currentType] ?? 'A'}`
      currentType = t
      currentCount = 1
    }
  }
  out += `${currentCount}${BLOCK_CHARS[currentType] ?? 'A'}`
  return out
}

export function decodeMap(str) {
  if (!str) return new Uint8Array(0)
  const out = []
  const re = /(\d+)([A-Za-z_]+)/g
  let match
  while ((match = re.exec(str)) !== null) {
    const count = parseInt(match[1], 10)
    const char = match[2].toUpperCase()
    const type = Object.hasOwn(CHAR_TO_BLOCK, char) ? CHAR_TO_BLOCK[char] : BLOCK_AIR
    for (let i = 0; i < count; i++) {
      out.push(type)
    }
  }
  return new Uint8Array(out)
}

// --- Name Sanitization ----------------------------------------------------
function isPrintable(ch) {
  const code = ch.charCodeAt(0)
  return code >= 32 && code !== 127
}

export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    .slice(0, 256)
    .split('')
    .filter(isPrintable)
    .join('')
    .trim()
    .slice(0, 16)
  return clean || 'Driller'
}

// --- Seeded PRNG ----------------------------------------------------------
function createRng(seed = 12345) {
  let s = (typeof seed === 'number' ? seed : 12345) >>> 0
  return function() {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Shaft Generation -----------------------------------------------------
// One driller's shaft: strata, bedrock formations and standalone nodules.
export function generateShaft(seed) {
  const rng = createRng(seed)
  const grid = new Uint8Array(WIDTH * DEPTH)
  const hp = new Uint8Array(WIDTH * DEPTH)

  for (let y = 0; y < DEPTH; y++) {
    let veinType = BLOCK_DIRT
    let veinRemaining = 0

    for (let x = 0; x < WIDTH; x++) {
      const idx = y * WIDTH + x
      let type = BLOCK_AIR
      let hitPoints = 0

      if (x === 0 || x === WIDTH - 1 || y === DEPTH - 1) {
        // Bedrock perimeter walls
        type = BLOCK_BEDROCK
        hitPoints = 255
      } else if (y >= VAULT_Y) {
        // Extraction Vault platform
        type = BLOCK_VAULT
        hitPoints = 255
      } else if (y === 0 || y === 1) {
        // Launch open air
        type = BLOCK_AIR
        hitPoints = 0
      } else if (y === 2) {
        // Launch gantry platform floor
        type = BLOCK_DIRT
        hitPoints = 1
      } else if (y >= 3 && y <= 10) {
        // Upper strata: soft dirt with air pockets and occasional surface geodes
        if (veinRemaining <= 0) {
          const u = rng()
          if (u < 0.18) {
            veinType = BLOCK_AIR
          } else if (u < 0.28) {
            veinType = BLOCK_GEODE
          } else {
            veinType = BLOCK_DIRT
          }
          veinRemaining = Math.floor(rng() * 4) + 2
        }
        type = veinType
        if (type === BLOCK_AIR) hitPoints = 0
        else if (type === BLOCK_GEODE) hitPoints = GEODE_HP
        else hitPoints = DIRT_HP
        veinRemaining--
      } else {
        // Subterranean strata (11 <= y < VAULT_Y). Gas takes 10% and geode caches 16%
        // all the way down; the other 74% hardens with depth, dirt thinning from 44%
        // to 19% as stone thickens from 30% to 55%. Obsidian and sabotage crystals
        // are never a vein: they are scattered singly further down.
        if (veinRemaining <= 0) {
          const depth = (y - 11) / (VAULT_Y - 11)
          const dirt = 0.44 - 0.25 * depth
          const r = rng()
          if (r < dirt) {
            veinType = BLOCK_DIRT
          } else if (r < 0.74) {
            veinType = BLOCK_STONE
          } else if (r < 0.84) {
            veinType = BLOCK_GAS
          } else {
            veinType = BLOCK_GEODE
          }
          veinRemaining = Math.floor(rng() * 4) + 2
        }
        type = veinType
        if (type === BLOCK_DIRT) hitPoints = DIRT_HP
        else if (type === BLOCK_STONE) hitPoints = STONE_HP
        else if (type === BLOCK_GAS) hitPoints = GAS_HP
        else if (type === BLOCK_GEODE) hitPoints = GEODE_HP
        veinRemaining--
      }


      grid[idx] = type
      hp[idx] = hitPoints
    }
  }

  // Track formation rows to avoid placing standalone bedrock in the path of complex formations
  const formationRows = new Set()
  const formationList = []
  let nextFormationY = 14 + Math.floor(rng() * 4)

  while (nextFormationY < VAULT_Y - 8) {
    const startY = nextFormationY
    const pattern = Math.floor(rng() * 6)
    formationList.push({ y: startY, pattern })
    // Mark rows around the formation
    for (let dy = -1; dy <= 4; dy++) {
      formationRows.add(startY + dy)
    }
    // Spacing between obstacle formations: 9 to 14 rows
    nextFormationY += 9 + Math.floor(rng() * 6)
  }

  // 1. Standalone Bedrock Nodules ("generate by itself")
  // Generates isolated solitary bedrock blocks in subterranean strata away from obstacle formations.
  // Each solitary bedrock block sits naturally on its own in dirt/stone, requiring drillers to steer around it.
  for (let y = 12; y < VAULT_Y - 4; y++) {
    if (formationRows.has(y)) continue
    // ~30% chance per row for an isolated standalone bedrock block
    if (rng() < 0.30) {
      const x = 3 + Math.floor(rng() * (WIDTH - 6)) // cols 3..16
      const idx = y * WIDTH + x
      grid[idx] = BLOCK_BEDROCK
      hp[idx] = 255
    }
  }

  // 2. Procedural Bedrock Formations (Multi-block, multi-row varied patterns)
  const placeBedrock = (x, y) => {
    if (x >= 1 && x < WIDTH - 1 && y >= 11 && y < VAULT_Y) {
      const idx = y * WIDTH + x
      grid[idx] = BLOCK_BEDROCK
      hp[idx] = 255
    }
  }

  for (const { y: startY, pattern } of formationList) {
    if (pattern === 0) {
      // Pattern 0: Stepped / Terraced Cascade (Diagonal Staircase)
      const goRight = rng() < 0.5
      if (goRight) {
        for (let x = 1; x <= 7; x++) placeBedrock(x, startY)
        for (let x = 4; x <= 10; x++) placeBedrock(x, startY + 1)
        for (let x = 7; x <= 13; x++) placeBedrock(x, startY + 2)
      } else {
        for (let x = 12; x <= 18; x++) placeBedrock(x, startY)
        for (let x = 9; x <= 15; x++) placeBedrock(x, startY + 1)
        for (let x = 6; x <= 12; x++) placeBedrock(x, startY + 2)
      }
    } else if (pattern === 1) {
      // Pattern 1: L-Hook / Overhanging Barrier (Shelf with vertical downward tooth)
      const onLeft = rng() < 0.5
      if (onLeft) {
        for (let x = 1; x <= 10; x++) placeBedrock(x, startY)
        placeBedrock(9, startY + 1)
        placeBedrock(10, startY + 1)
        placeBedrock(9, startY + 2)
        placeBedrock(10, startY + 2)
      } else {
        for (let x = 9; x <= 18; x++) placeBedrock(x, startY)
        placeBedrock(9, startY + 1)
        placeBedrock(10, startY + 1)
        placeBedrock(9, startY + 2)
        placeBedrock(10, startY + 2)
      }
    } else if (pattern === 2) {
      // Pattern 2: Freestanding Monolith / Island Boulder (Generates "by itself" in mid-shaft)
      const startX = 6 + Math.floor(rng() * 2) // 6 or 7
      const width = 6
      const endX = startX + width - 1
      for (let x = startX + 1; x <= endX - 1; x++) placeBedrock(x, startY)
      for (let x = startX; x <= endX; x++) placeBedrock(x, startY + 1)
      for (let x = startX + 1; x <= endX - 1; x++) placeBedrock(x, startY + 2)
    } else if (pattern === 3) {
      // Pattern 3: Thickened Jagged Shelf (Crenellated double-tier)
      const onLeft = rng() < 0.5
      const shelfW = 8 + Math.floor(rng() * 3) // 8..10
      if (onLeft) {
        for (let x = 1; x <= shelfW; x++) {
          placeBedrock(x, startY)
          if (x <= shelfW - 1 && (x % 2 === 0 || rng() < 0.6)) {
            placeBedrock(x, startY + 1)
          }
        }
      } else {
        const startX = (WIDTH - 1) - shelfW
        for (let x = startX; x < WIDTH - 1; x++) {
          placeBedrock(x, startY)
          if (x >= startX + 1 && (x % 2 === 1 || rng() < 0.6)) {
            placeBedrock(x, startY + 1)
          }
        }
      }
    } else if (pattern === 4) {
      // Pattern 4: Double Baffle / Chicane (Staggered upper & lower spurs)
      const upperLeft = rng() < 0.5
      if (upperLeft) {
        for (let x = 1; x <= 10; x++) placeBedrock(x, startY)
        for (let x = 9; x <= 18; x++) placeBedrock(x, startY + 2)
      } else {
        for (let x = 9; x <= 18; x++) placeBedrock(x, startY)
        for (let x = 1; x <= 10; x++) placeBedrock(x, startY + 2)
      }
    } else {
      // Pattern 5: Dual Spires / Twin Pillars (Freestanding vertical columns with central gate)
      for (let dy = 0; dy < 3; dy++) {
        placeBedrock(4, startY + dy)
        placeBedrock(5, startY + dy)
        placeBedrock(14, startY + dy)
        placeBedrock(15, startY + dy)
      }
    }
  }

  // 3. Obsidian and sabotage crystals, scattered one tile at a time through dirt and
  // stone: at most one a row, never touching another of their own kind, diagonals
  // included, so neither ever groups. `chance` is the odds a row gets one, given how
  // deep that row sits (0 at the top of the strata, 1 at the vault).
  const scatter = (block, blockHp, chance) => {
    for (let y = 11; y < VAULT_Y; y++) {
      if (rng() >= chance((y - 11) / (VAULT_Y - 11))) continue
      const x = 1 + Math.floor(rng() * (WIDTH - 2))
      const idx = y * WIDTH + x
      if (grid[idx] !== BLOCK_DIRT && grid[idx] !== BLOCK_STONE) continue
      let touching = false
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (grid[(y + dy) * WIDTH + x + dx] === block) touching = true
        }
      }
      if (touching) continue
      grid[idx] = block
      hp[idx] = blockHp
    }
  }
  // Obsidian is rare: a row in ten near the top, four in ten down by the vault.
  scatter(BLOCK_OBSIDIAN, OBSIDIAN_HP, (depth) => 0.1 + 0.3 * depth)
  scatter(BLOCK_SABOTAGE, SABOTAGE_HP, () => SABOTAGE_ROW_CHANCE)

  // 4. A way down for anyone without the super drill. Find the route from the launch
  // air to the vault that crosses the fewest obsidian tiles, never bedrock, and turn
  // those tiles back into stone. Obsidian costs 1 and everything else 0, so each
  // cost level is swept completely before the next one starts.
  const cost = new Array(WIDTH * VAULT_Y).fill(Infinity)
  const from = new Int32Array(WIDTH * VAULT_Y).fill(-1)
  let level = []
  for (let x = 1; x < WIDTH - 1; x++) {
    cost[WIDTH + x] = 0
    level.push(WIDTH + x)
  }
  let end = -1
  for (let k = 0; level.length > 0 && end < 0; k++) {
    const next = []
    for (let h = 0; h < level.length && end < 0; h++) {
      const i = level[h]
      if (cost[i] !== k) continue // improved since it was queued
      if (Math.floor(i / WIDTH) === VAULT_Y - 1) {
        end = i
        continue
      }
      for (const j of [i + WIDTH, i - 1, i + 1, i - WIDTH]) {
        const x = j % WIDTH
        if (j < WIDTH || j >= WIDTH * VAULT_Y || x < 1 || x > WIDTH - 2) continue
        if (grid[j] === BLOCK_BEDROCK) continue
        const c = k + (grid[j] === BLOCK_OBSIDIAN ? 1 : 0)
        if (c >= cost[j]) continue
        cost[j] = c
        from[j] = i
        if (c === k) level.push(j)
        else next.push(j)
      }
    }
    level = next
  }
  for (let i = end; i >= 0; i = from[i]) {
    if (grid[i] === BLOCK_OBSIDIAN) {
      grid[i] = BLOCK_STONE
      hp[i] = STONE_HP
    }
  }

  return { grid, hp }
}

// --- Match Creation -------------------------------------------------------
// The match holds no terrain: every driller digs a copy of their own, all grown
// on join from this one seed, so everyone races the same layout.
export function make(options = {}) {
  return {
    width: WIDTH,
    depth: DEPTH,
    seed: options.seed ?? 12345,
    players: new Map(),
    nextSlot: 0,
    elapsed: 0,
    voidY: INITIAL_VOID_Y,
    seq: 0,
    phase: 'waiting', // the lobby: see tick()
    winner: null,
    winReason: null,
    board: options.board ?? [],
    botFill: options.botFill ?? 0,
    botsOnly: options.botsOnly ?? false,
    botsWanted: options.botsWanted ?? false,
    nextId: 1
  }
}

// --- Player Management ----------------------------------------------------
export function join(match, playerInfo = {}, rng = Math.random) {
  const isBot = Boolean(playerInfo.bot)
  if (!isBot && match.players.size >= MAX_PLAYERS) {
    const bot = [...match.players.values()].find((p) => p.bot)
    if (bot) leave(match, bot.id)
  }
  if (match.players.size >= MAX_PLAYERS) return null

  // A restart carries people in under their old ids while the counter starts
  // again from 1, so an id already in the roster is skipped, never reused.
  let id = playerInfo.id
  while (!id || match.players.has(id)) id = `${isBot ? 'bot' : 'p'}-${match.nextId++}`
  const name = sanitizeName(playerInfo.name)
  // Once the clock runs the void is moving: a person arriving now would spawn
  // into it, so they watch this round and are dealt into the next.
  const spectating = !isBot && match.elapsed > 0
  const slot = match.nextSlot++
  // Any column between the walls, drawn at random rather than handed out in join order.
  const spawnX = 1 + Math.floor(rng() * (WIDTH - 2))
  // Everyone gets the same layout, so the race is fair, in a copy of their own to dig.
  const { grid, hp } = generateShaft(match.seed)
  const p = {
    id,
    name,
    bot: isBot,
    slot,
    grid,
    hp,
    deltas: [], // this tick's block changes, sent to this driller alone
    hazards: [],
    grief: null, // { type, ttl, by } while a rival's sabotage lasts
    x: spawnX,
    y: SPAWN_Y,
    vx: 0,
    vy: 0,
    kx: 0, // sideways throw from a gas blast, on top of walking; dies away
    fuel: 1.0,
    heat: 0,
    grounded: true,
    alive: !spectating,
    spectating,
    overheated: false,
    overheatTimer: 0,
    superDrillTimer: 0,
    drillTimer: 0,
    thinkAt: 0,
    input: {
      dx: 0,
      thrust: false,
      drill: false,
      aim: Math.PI / 2
    }
  }
  match.players.set(id, p)
  return p
}

export function leave(match, playerId) {
  // Counted before the leaver goes: a rival walking out still leaves a survivor.
  const all = [...match.players.values()]
  match.players.delete(playerId)
  if (match.phase === 'playing' && match.players.size > 0) {
    settle(match, all.some((p) => p.bot), all.filter((p) => !p.bot).length)
  }
}

// Over when the void takes everyone, or when one human outlasts the others.
// Never on survival while bots race: beating bots means reaching the vault.
function settle(match, hadBots, humans) {
  const alive = [...match.players.values()].filter((p) => p.alive)
  if (alive.length === 0) {
    match.phase = 'over'
    match.winner = null
  } else if (!hadBots && humans > 1 && alive.length === 1) {
    match.phase = 'over'
    match.winner = alive[0].id
    match.winReason = 'survival'
  }
}

// --- Bot AI & Lifecycle ---------------------------------------------------
export const canRun = (state) =>
  Boolean(state.botsOnly || [...state.players.values()].some((p) => !p.bot))

export function wantBots(state) {
  state.botsWanted = true
  return true
}

export function ensureBots(state, rng = Math.random) {
  // Nobody racing and nobody asked to watch: every bot stands down.
  if (!canRun(state)) state.botsWanted = false
  const fillTarget = state.botsWanted || state.botsOnly ? state.botFill : 0
  // A spectator is not racing, so no bot stands down for them mid-round.
  const humans = [...state.players.values()].filter((p) => !p.bot && !p.spectating).length
  const bots = [...state.players.values()].filter((p) => p.bot)
  const want = Math.max(0, Math.min(fillTarget, MAX_PLAYERS) - humans)

  for (let i = bots.length; i > want; i--) leave(state, bots[i - 1].id)
  // Bots are dealt in only before the clock starts: the void passes the spawn row a
  // few seconds in, so a bot added to a round under way is crushed on arrival.
  for (let i = bots.length; i < want && state.elapsed === 0; i++) {
    const taken = new Set([...state.players.values()].map((q) => q.name))
    const botName = BOT_NAMES.find((n) => !taken.has(n)) ?? `Unit ${state.nextId}`
    join(state, { name: botName, bot: true }, rng)
  }
}

// Rows a bot's route may climb to get round a shelf, and how far down it must reach.
const ROUTE_UP = 3
const ROUTE_DEPTH = 6

const inCloud = (p, x, y) => p.hazards.some((h) => Math.hypot(x + 0.5 - h.x, y + 0.5 - h.y) <= h.r)

// What a route is after: ground ROUTE_DEPTH rows down, or a geode for the super drill.
const DEEPER = (block, y, bottom) => y >= bottom
const GEODE = (block) => block === BLOCK_GEODE

// One step along the shortest route from a bot's cell to the nearest cell `want`
// accepts, no more than ROUTE_DEPTH rows down, digging through anything breakable.
// Bedrock and the vault are walls; gas pockets and live gas clouds are walls too
// unless `gas`; and the route never rises unless `climb`, since climbing costs
// jetpack fuel a bot may not have. Breadth-first, like blastworks' stepTo, so a
// bot sees the way out of a pocket rather than only the column beneath it.
function route(p, want, gas, climb) {
  const sx = Math.max(1, Math.min(WIDTH - 2, Math.floor(p.x + 0.5)))
  const sy = Math.floor(p.y + 0.5)
  const top = Math.max(0, sy - ROUTE_UP)
  const bottom = Math.min(sy + ROUTE_DEPTH, VAULT_Y - 1)
  const start = sy * WIDTH + sx
  const seen = new Set([start])
  const queue = [[start, null]]
  for (let head = 0; head < queue.length; head++) {
    const [i, first] = queue[head]
    const x = i % WIDTH
    const y = Math.floor(i / WIDTH)
    if (first !== null && want(p.grid[i], y, bottom)) return first
    for (const [dx, dy] of climb ? [[0, 1], [-1, 0], [1, 0], [0, -1]] : [[0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 1 || nx > WIDTH - 2 || ny < top || ny > bottom) continue
      const j = ny * WIDTH + nx
      if (seen.has(j)) continue
      seen.add(j)
      const block = p.grid[j]
      if (block === BLOCK_BEDROCK || block === BLOCK_VAULT) continue
      // Without the super drill, obsidian is as good as bedrock.
      if (block === BLOCK_OBSIDIAN && p.superDrillTimer === 0) continue
      if (!gas && (block === BLOCK_GAS || inCloud(p, nx, ny))) continue
      queue.push([j, first ?? [dx, dy]])
    }
  }
  return null
}

// Blocks per second the void is falling right now: it speeds up with time and depth.
function voidSpeed(match) {
  const postGraceSec = Math.max(0, match.elapsed - GRACE_MS) / 1000
  const depth = Math.max(0, match.voidY)
  return Math.min(MAX_VOID_SPEED, BASE_VOID_SPEED + postGraceSec * VOID_ACCEL + depth * VOID_DEPTH_ACCEL)
}

export function driveBots(match, rng = Math.random) {
  if (match.phase !== 'playing') return

  for (const p of match.players.values()) {
    if (!p.bot || !p.alive) continue
    if (match.elapsed < (p.thinkAt || 0)) continue
    p.thinkAt = match.elapsed + BOT_REACT_MS + Math.floor(rng() * 30)

    const sx = Math.max(1, Math.min(WIDTH - 2, Math.floor(p.x + 0.5)))
    const sy = Math.floor(p.y + 0.5)
    // No pausing to let the drill cool: the void does not wait, and riding the heat
    // into a lockout still digs further than idling at the redline.
    const canDrill = !p.overheated

    // Vault approach: touch down to win
    if (Math.floor(p.y + 1.05) >= VAULT_Y) {
      p.input.aim = Math.PI / 2
      p.input.drill = false
      p.input.thrust = false
      p.input.dx = 0
      continue
    }

    // Without the super drill, go for a geode in reach first, if that needs neither
    // gas nor a climb. Then down and around gas; failing that straight through it,
    // since gas costs heat but a climb costs time the void does not give. Climbing
    // is last. With the super drill running, everything below is one pulse: dig down.
    const step =
      (p.superDrillTimer === 0 && route(p, GEODE, false, false)) ||
      route(p, DEEPER, false, false) ||
      route(p, DEEPER, true, false) ||
      route(p, DEEPER, true, true)
    if (!step) {
      // Nothing leads down from here at all: jump, and look again from somewhere else.
      p.input.thrust = p.fuel > 0.15
      p.input.dx = rng() < 0.5 ? -1 : 1
      p.input.drill = false
      continue
    }

    const [dx, dy] = step
    // The drill runs into anything solid. On the super drill it also stays on in a
    // fall, since it makes no heat: the bot cuts the next block before landing on
    // it, instead of stopping on every block to think again.
    const solidAhead = p.grid[(sy + dy) * WIDTH + sx + dx] !== BLOCK_AIR
    p.input.drill = canDrill && (solidAhead || (dy > 0 && p.superDrillTimer > 0))
    if (dx !== 0) {
      // Sideways: walk, cutting through whatever is in the way.
      p.input.dx = dx
      p.input.aim = dx > 0 ? 0 : Math.PI
      p.input.thrust = false
    } else {
      // Down or up: square up under the column first. A body resting on the lip
      // of the hole beside it otherwise never falls in.
      const offset = sx - p.x
      p.input.dx = Math.abs(offset) < 0.05 ? 0 : Math.max(-1, Math.min(1, offset / 0.6))
      p.input.aim = dy > 0 ? Math.PI / 2 : -Math.PI / 2
      p.input.thrust = dy < 0 && p.fuel > 0.05 // climbing needs the jetpack; a fall never brakes
    }
  }
}

export function setInput(match, playerId, input = {}) {
  const p = match.players.get(playerId)
  if (!p) return
  if (typeof input.dx === 'number' && Number.isFinite(input.dx)) {
    p.input.dx = Math.max(-1, Math.min(1, input.dx))
  }
  if (typeof input.thrust === 'boolean') {
    p.input.thrust = input.thrust
  }
  if (typeof input.drill === 'boolean') {
    p.input.drill = input.drill
  }
  if (typeof input.aim === 'number' && Number.isFinite(input.aim)) {
    p.input.aim = input.aim
  }
}

// --- Collision Helpers ----------------------------------------------------
function isSolid(grid, x, y) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= DEPTH) return true
  return grid[y * WIDTH + x] !== BLOCK_AIR
}

export function touchesVault(grid, p) {
  if (p.y >= VAULT_Y - 1.05) return true
  const minCol = Math.floor(p.x + 0.1)
  const maxCol = Math.floor(p.x + 0.9)
  const minRow = Math.floor(p.y + 0.1)
  const maxRow = Math.floor(p.y + 1.05)
  for (let r = minRow; r <= maxRow; r++) {
    if (r >= VAULT_Y) return true
    for (let c = minCol; c <= maxCol; c++) {
      if (grid[r * WIDTH + c] === BLOCK_VAULT) return true
    }
  }
  return false
}

// --- Gas Pocket Detonation ------------------------------------------------
function detonateGasPocket(p, bx, by) {
  const idx = by * WIDTH + bx
  p.grid[idx] = BLOCK_AIR
  p.hp[idx] = 0
  p.deltas.push({ i: idx, t: BLOCK_AIR })

  const hx = bx + 0.5
  const hy = by + 0.5
  p.hazards.push({
    x: hx,
    y: hy,
    r: GAS_HAZARD_RADIUS,
    ttl: GAS_HAZARD_TTL_MS,
  })

  // Radial explosive shockwave, knockback, heat surge, and fuel scorch. Only the
  // shaft's owner can be caught in it: nobody else stands in this shaft.
  if (p.alive) {
    const pcx = p.x + 0.5
    const pcy = p.y + 0.5
    const dx = pcx - hx
    const dy = pcy - hy
    const dist = Math.hypot(dx, dy)
    if (dist < GAS_HAZARD_RADIUS) {
      const normX = dist > 0.05 ? dx / dist : 0
      const normY = dist > 0.05 ? dy / dist : -1.0
      const falloff = 1 - dist / GAS_HAZARD_RADIUS
      const force = GAS_KNOCKBACK_FORCE * Math.max(0.4, falloff)

      // Into kx, not vx: vx is rebuilt from walking input every tick.
      p.kx += normX * force
      p.vy += normY * force
      p.grounded = false

      p.heat = Math.min(1.0, p.heat + GAS_HEAT_SURGE * falloff)
      if (p.heat >= 1.0) {
        p.heat = 1.0
        p.overheated = true
        p.overheatTimer = OVERHEAT_LOCKOUT_MS
      }

      p.fuel = Math.max(0, p.fuel - GAS_FUEL_BURN * falloff)
    }
  }

  // Terrain blowout: explode adjacent dirt, and chain-detonate adjacent gas
  const toChain = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = bx + dx
      const ny = by + dy
      if (nx < 1 || nx >= WIDTH - 1 || ny < 3 || ny >= VAULT_Y) continue
      const nIdx = ny * WIDTH + nx
      const neighbor = p.grid[nIdx]
      if (neighbor === BLOCK_DIRT) {
        p.grid[nIdx] = BLOCK_AIR
        p.hp[nIdx] = 0
        p.deltas.push({ i: nIdx, t: BLOCK_AIR })
      } else if (neighbor === BLOCK_GAS) {
        p.grid[nIdx] = BLOCK_AIR
        p.hp[nIdx] = 0
        toChain.push({ x: nx, y: ny })
      }
    }
  }

  for (const c of toChain) {
    detonateGasPocket(p, c.x, c.y)
  }
}

// --- Sabotage -------------------------------------------------------------
// A shattered crystal jams one living rival, picked at random. One grief at a
// time: a fresh one replaces whatever the target was already under.
function sabotage(match, p, rng) {
  const rivals = [...match.players.values()].filter((q) => q !== p && q.alive)
  if (rivals.length === 0) return
  const target = rivals[Math.floor(rng() * rivals.length)]
  const type = pickGrief(rng)
  target.grief = { type, ttl: GRIEF_MS[type], by: p.name }
}

// Which grief a shattered crystal sends, weighted by GRIEF_WEIGHT.
export function pickGrief(rng) {
  let roll = rng() * Object.values(GRIEF_WEIGHT).reduce((sum, w) => sum + w, 0)
  for (const [type, weight] of Object.entries(GRIEF_WEIGHT)) {
    roll -= weight
    if (roll < 0) return type
  }
}

// --- Drilling Raycast -----------------------------------------------------
function executeDrillPulse(match, p, rng) {
  const cx = p.x + 0.5
  const cy = p.y + 0.5
  const aim = p.input.aim
  const cos = Math.cos(aim)
  const sin = Math.sin(aim)

  const isSuper = p.superDrillTimer > 0
  const maxReach = isSuper ? SUPER_DRILL_RANGE : DRILL_RANGE

  for (let d = 0.35; d <= maxReach; d += 0.1) {
    const bx = Math.floor(cx + cos * d)
    const by = Math.floor(cy + sin * d)
    if (bx < 0 || bx >= WIDTH || by < 0 || by >= DEPTH) continue

    // Skip the tile the driller's center currently occupies
    if (bx === Math.floor(cx) && by === Math.floor(cy)) continue

    const idx = by * WIDTH + bx
    const block = p.grid[idx]
    if (block !== BLOCK_AIR) {
      if (block === BLOCK_BEDROCK || block === BLOCK_VAULT) {
        break
      }
      // Obsidian stops a normal drill dead, and even the super drill only wears it
      // down one pulse at a time.
      if (block === BLOCK_OBSIDIAN && !isSuper) break

      const dmg = isSuper && block !== BLOCK_OBSIDIAN ? p.hp[idx] : 1

      p.hp[idx] = Math.max(0, p.hp[idx] - dmg)

      if (p.hp[idx] === 0) {
        const oldType = block
        if (oldType === BLOCK_GAS) {
          detonateGasPocket(p, bx, by)
        } else {
          p.grid[idx] = BLOCK_AIR
          p.deltas.push({ i: idx, t: BLOCK_AIR })

          if (oldType === BLOCK_GEODE || oldType === BLOCK_SABOTAGE) {
            p.heat = 0
            p.overheated = false
            p.overheatTimer = 0
          }
          if (oldType === BLOCK_GEODE) p.superDrillTimer = SUPER_DRILL_DURATION_MS
          if (oldType === BLOCK_SABOTAGE) sabotage(match, p, rng)
        }
      } else {
        p.deltas.push({ i: idx, t: block, hp: p.hp[idx] })
      }
      break
    }
  }
}

// --- Tick Simulation ------------------------------------------------------
export function tick(match, dtMs = TICK_MS, rng = Math.random) {
  ensureBots(match, rng)
  if (match.players.size > 0 && !canRun(match)) return

  // Once per tick, not per snapshot: every socket is sent its own frame of it.
  match.seq++

  // The lobby. Nothing moves and the void holds until enough people are in, or
  // someone asks for bots. The grace period starts when the match does.
  if (match.phase === 'waiting') {
    const humans = [...match.players.values()].filter((p) => !p.bot).length
    if (humans < MIN_PLAYERS && !match.botsWanted && !match.botsOnly) return
    match.phase = 'playing'
  }

  // A decided match stands still: the clear time, the void and every driller stop
  // on the frame it ended, and stay that way through the results screen.
  if (match.phase === 'over') return

  driveBots(match, rng)

  const dtSec = dtMs / 1000

  // 1. Advance Crush Void
  match.elapsed += dtMs
  if (match.elapsed > GRACE_MS) {
    match.voidY += voidSpeed(match) * dtSec
  }

  // 2. Update Players, each in their own shaft
  for (const p of match.players.values()) {
    p.deltas = []
    for (const h of p.hazards) h.ttl -= dtMs
    p.hazards = p.hazards.filter((h) => h.ttl > 0)
    if (p.grief) {
      p.grief.ttl -= dtMs
      if (p.grief.ttl <= 0) p.grief = null
    }
    if (!p.alive) continue

    // Void crush check
    if (p.y <= match.voidY) {
      p.alive = false
      continue
    }

    // Hazard cloud interaction: thermal induction and turbulence
    let inHazard = false
    for (const h of p.hazards) {
      const pcx = p.x + 0.5
      const pcy = p.y + 0.5
      const dist = Math.hypot(pcx - h.x, pcy - h.y)
      if (dist <= h.r) {
        inHazard = true
        p.fuel = Math.max(0, p.fuel - 0.15 * dtSec)
      }
    }

    // Super drill timer
    if (p.superDrillTimer > 0) {
      p.superDrillTimer = Math.max(0, p.superDrillTimer - dtMs)
    }

    // Thermal management
    if (p.overheated) {
      p.overheatTimer -= dtMs
      p.heat = Math.max(0, p.overheatTimer / OVERHEAT_LOCKOUT_MS)
      if (p.overheatTimer <= 0) {
        p.overheated = false
        p.heat = 0
        p.overheatTimer = 0
      }
    } else if (inHazard) {
      // Inside toxic gas hazard: drill core heats up continuously and cannot dissipate heat
      p.heat = Math.min(1.0, p.heat + GAS_CLOUD_HEAT_RATE * dtSec)
      if (p.heat >= 1.0) {
        p.heat = 1.0
        p.overheated = true
        p.overheatTimer = OVERHEAT_LOCKOUT_MS
      }
    } else if (p.input.drill) {
      if (p.superDrillTimer === 0) {
        p.heat = Math.min(1.0, p.heat + HEAT_ACCUMULATE_RATE * dtSec)
        if (p.heat >= 1.0) {
          p.heat = 1.0
          p.overheated = true
          p.overheatTimer = OVERHEAT_LOCKOUT_MS
        }
      }
    } else {
      p.heat = Math.max(0, p.heat - HEAT_DISSIPATE_RATE * dtSec)
    }

    // Drilling execution
    if (p.input.drill && !p.overheated) {
      const base = p.superDrillTimer > 0 ? SUPER_DRILL_PULSE_INTERVAL : DRILL_PULSE_INTERVAL
      // Chill doubles whichever interval is running: it slows a super drill, never cancels it.
      const interval = p.grief?.type === 'chill' ? base * 2 : base
      p.drillTimer = (p.drillTimer || 0) + dtMs
      while (p.drillTimer >= interval) {
        p.drillTimer -= interval
        executeDrillPulse(match, p, rng)
      }
    } else {
      p.drillTimer = 0
    }


    // Jetpack & Gravity
    const canThrust = p.input.thrust && p.fuel > 0
    if (canThrust) {
      p.fuel = Math.max(0, p.fuel - FUEL_CONSUME_RATE * dtSec)
      p.vy += JETPACK_THRUST * dtSec
    }
    p.vy += GRAVITY * dtSec
    p.vy = Math.max(-TERMINAL_VELOCITY, Math.min(TERMINAL_VELOCITY, p.vy))

    if (p.grounded && !canThrust) {
      p.fuel = Math.min(1.0, p.fuel + FUEL_RECHARGE_RATE * dtSec)
    }

    // Horizontal Movement & AABB Collision
    // Walking, plus whatever a gas blast is still throwing the driller.
    p.vx = p.input.dx * WALK_SPEED + p.kx
    p.kx *= Math.exp(-GAS_KNOCKBACK_DECAY * dtSec)
    if (Math.abs(p.kx) < 0.05) p.kx = 0
    const newX = p.x + p.vx * dtSec

    if (p.vx > 0) {
      const minRow = Math.floor(p.y + 0.1)
      const maxRow = Math.floor(p.y + 0.999)
      const targetCol = Math.floor(newX + 0.9)
      let blocked = false
      for (let r = minRow; r <= maxRow; r++) {
        if (isSolid(p.grid, targetCol, r)) {
          blocked = true
          break
        }
      }
      if (blocked) {
        p.x = targetCol - 0.9
        p.vx = 0
        p.kx = 0
      } else {
        p.x = newX
      }
    } else if (p.vx < 0) {
      const minRow = Math.floor(p.y + 0.1)
      const maxRow = Math.floor(p.y + 0.999)
      const targetCol = Math.floor(newX + 0.1)
      let blocked = false
      for (let r = minRow; r <= maxRow; r++) {
        if (isSolid(p.grid, targetCol, r)) {
          blocked = true
          break
        }
      }
      if (blocked) {
        p.x = targetCol + 0.9
        p.vx = 0
        p.kx = 0
      } else {
        p.x = newX
      }
    } else {
      p.x = newX
    }
    p.x = Math.max(0.9, Math.min(WIDTH - 1.9, p.x))

    // Vertical Movement & AABB Collision
    const newY = p.y + p.vy * dtSec
    const minCol = Math.floor(p.x + 0.101)
    const maxCol = Math.floor(p.x + 0.899)

    if (p.vy >= 0) {
      const targetRow = Math.floor(newY + 1.0)
      let blocked = false
      for (let c = minCol; c <= maxCol; c++) {
        if (isSolid(p.grid, c, targetRow)) {
          blocked = true
          break
        }
      }
      if (blocked) {
        p.y = targetRow - 1.0
        p.vy = 0
        p.grounded = true
      } else {
        p.y = newY
        p.grounded = false
      }
    } else {
      const targetRow = Math.floor(newY + 0.1)
      let blocked = false
      for (let c = minCol; c <= maxCol; c++) {
        if (isSolid(p.grid, c, targetRow)) {
          blocked = true
          break
        }
      }
      if (blocked) {
        p.y = targetRow + 0.9
        p.vy = 0
      } else {
        p.y = newY
      }
      p.grounded = false
    }

    // Void crush check after movement
    if (p.y <= match.voidY) {
      p.alive = false
    }
  }

  // 3. Win / Loss Resolution
  if (match.phase === 'playing') {
    for (const p of match.players.values()) {
      if (p.alive && touchesVault(p.grid, p)) {
        match.phase = 'over'
        match.winner = p.id
        match.winReason = 'vault'
        break
      }
    }

    if (match.phase === 'playing') {
      const all = [...match.players.values()]
      settle(match, all.some((p) => p.bot), all.filter((p) => !p.bot).length)
    }
  }
}

// --- Snapshot Serialization -----------------------------------------------
// A frame for one viewer: their own shaft's changes and gas clouds, plus every
// driller's position and grief. No viewer (the admin panel) means no terrain.
export function snapshot(match, viewerId) {
  const viewer = match.players.get(viewerId)
  const players = []
  for (const p of match.players.values()) {
    players.push({
      id: p.id,
      name: p.name,
      bot: Boolean(p.bot),
      slot: p.slot,
      x: Number(p.x.toFixed(2)),
      y: Number(p.y.toFixed(2)),
      vx: Number(p.vx.toFixed(2)),
      vy: Number(p.vy.toFixed(2)),
      fuel: Number(p.fuel.toFixed(2)),
      heat: Number(p.heat.toFixed(2)),
      aim: Number(p.input.aim.toFixed(2)),
      drilling: Boolean(p.input.drill && !p.overheated),
      alive: p.alive,
      spectating: Boolean(p.spectating),
      hp: p.alive ? 100 : 0,
      kills: 0,
      deaths: p.alive ? 0 : 1,
      overheated: p.overheated,
      superDrill: p.superDrillTimer > 0,
      grief: p.grief ? { type: p.grief.type, ttl: p.grief.ttl, by: p.grief.by } : null
    })
  }

  const hazards = (viewer?.hazards ?? []).map(h => ({
    x: Number(h.x.toFixed(2)),
    y: Number(h.y.toFixed(2)),
    r: Number(h.r.toFixed(2)),
    ttl: Number((h.ttl / 1000).toFixed(2))
  }))

  return {
    t: 'snap',
    seq: match.seq,
    voidY: Number(match.voidY.toFixed(2)),
    phase: match.phase,
    winner: match.winner,
    winReason: match.winReason, // 'vault' | 'survival' | null: only a vault win has a clear time
    elapsed: match.elapsed,
    arena: 'strata-shaft',
    botFill: match.botFill ?? 0,
    botsOnly: Boolean(match.botsOnly),
    players,
    deltas: viewer?.deltas ?? [],
    hazards,
    board: match.board ?? []
  }
}
