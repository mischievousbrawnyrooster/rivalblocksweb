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

export const DRILL_RANGE = 1.35 // blocks
export const SUPER_DRILL_RANGE = 1.65 // blocks
export const DRILL_PULSE_INTERVAL = 110 // ms (~9 pulses per sec)
export const SUPER_DRILL_PULSE_INTERVAL = 55 // ms (~18 pulses per sec)
export const HEAT_ACCUMULATE_RATE = 0.25 // per sec
export const HEAT_DISSIPATE_RATE = 0.30 // per sec
export const OVERHEAT_LOCKOUT_MS = 1800 // ms
export const SUPER_DRILL_DURATION_MS = 5000 // ms (extended to 5s)


export const GAS_HAZARD_RADIUS = 2.0
export const GAS_HAZARD_TTL_MS = 4000

export const BLOCK_CHARS = ['A', 'D', 'S', 'B', 'G', 'C', 'V']
export const CHAR_TO_BLOCK = {
  A: BLOCK_AIR,
  D: BLOCK_DIRT,
  S: BLOCK_STONE,
  B: BLOCK_BEDROCK,
  G: BLOCK_GAS,
  C: BLOCK_GEODE,
  E: BLOCK_GEODE,
  V: BLOCK_VAULT
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

// --- Match Creation -------------------------------------------------------
export function make(options = {}) {
  const rng = typeof options.rng === 'function' ? options.rng : createRng(options.seed ?? 12345)
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
        // Subterranean strata (11 <= y < VAULT_Y): dirt, stone, gas, and 16% geode caches
        if (veinRemaining <= 0) {
          const r = rng()
          if (r < 0.44) {
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

  // Procedural Bedrock Obstacle Shelves
  // Generates horizontal bedrock shelves across subterranean strata to prevent straight-down descent
  let nextShelfY = 14 + Math.floor(rng() * 4)
  let lastPattern = -1

  while (nextShelfY < VAULT_Y - 6) {
    const shelfY = nextShelfY
    // Pick a pattern different from previous shelf
    // 0: Left-anchored (cols 1..W), right side open (at least 7 cols open)
    // 1: Right-anchored (cols W..18), left side open (at least 7 cols open)
    // 2: Center shelf (cols S..E), both sides open (at least 4 cols on left and right)
    let pattern = Math.floor(rng() * 3)
    if (pattern === lastPattern) {
      pattern = (pattern + 1) % 3
    }
    lastPattern = pattern

    if (pattern === 0) {
      // Left-anchored shelf: covers cols 1 to 8..11, leaving cols 9..18 or 12..18 open
      const shelfWidth = 8 + Math.floor(rng() * 4)
      for (let x = 1; x <= shelfWidth; x++) {
        const idx = shelfY * WIDTH + x
        grid[idx] = BLOCK_BEDROCK
        hp[idx] = 255
      }
    } else if (pattern === 1) {
      // Right-anchored shelf: covers cols 8..11 to 18, leaving cols 1 to 7..10 open
      const shelfWidth = 8 + Math.floor(rng() * 4)
      const startX = (WIDTH - 1) - shelfWidth
      for (let x = startX; x < WIDTH - 1; x++) {
        const idx = shelfY * WIDTH + x
        grid[idx] = BLOCK_BEDROCK
        hp[idx] = 255
      }
    } else {
      // Center shelf: covers cols 5..6 to 12..14, leaving at least 4 cols open on each side
      const startX = 5 + Math.floor(rng() * 2)
      const endX = 12 + Math.floor(rng() * 3)
      for (let x = startX; x <= endX; x++) {
        const idx = shelfY * WIDTH + x
        grid[idx] = BLOCK_BEDROCK
        hp[idx] = 255
      }
    }

    // Advance 9 to 14 rows for next shelf
    nextShelfY += 9 + Math.floor(rng() * 6)
  }

  return {
    width: WIDTH,
    depth: DEPTH,
    grid,
    hp,
    players: new Map(),
    nextSlot: 0,
    elapsed: 0,
    voidY: INITIAL_VOID_Y,
    seq: 0,
    phase: 'playing',
    winner: null,
    winReason: null,
    deltas: [],
    hazards: []
  }
}

// --- Player Management ----------------------------------------------------
export function join(match, playerInfo = {}) {
  const id = playerInfo.id || `p-${Math.random().toString(36).slice(2, 8)}`
  const name = sanitizeName(playerInfo.name)
  const slot = match.nextSlot++
  const spawnX = 2.0 + (slot % 8) * 2.0
  const p = {
    id,
    name,
    slot,
    x: spawnX,
    y: SPAWN_Y,
    vx: 0,
    vy: 0,
    fuel: 1.0,
    heat: 0,
    grounded: true,
    alive: true,
    overheated: false,
    overheatTimer: 0,
    superDrillTimer: 0,
    drillTimer: 0,
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
  const hadMultiple = match.players.size > 1
  match.players.delete(playerId)
  if (match.phase === 'playing' && match.players.size > 0) {
    const alive = [...match.players.values()].filter(p => p.alive)
    if (alive.length === 1 && hadMultiple) {
      match.phase = 'over'
      match.winner = alive[0].id
      match.winReason = 'survival'
    } else if (alive.length === 0) {
      match.phase = 'over'
      match.winner = null
    }
  }
}

export const removePlayer = leave

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

// --- Drilling Raycast -----------------------------------------------------
function executeDrillPulse(match, p) {
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
    const block = match.grid[idx]
    if (block !== BLOCK_AIR) {
      if (block === BLOCK_BEDROCK || block === BLOCK_VAULT) {
        break
      }

      const dmg = isSuper ? match.hp[idx] : 1

      match.hp[idx] = Math.max(0, match.hp[idx] - dmg)

      if (match.hp[idx] === 0) {
        const oldType = block
        match.grid[idx] = BLOCK_AIR
        match.deltas.push({ i: idx, t: BLOCK_AIR })

        if (oldType === BLOCK_GAS) {
          match.hazards.push({
            x: bx + 0.5,
            y: by + 0.5,
            r: GAS_HAZARD_RADIUS,
            ttl: GAS_HAZARD_TTL_MS
          })
        } else if (oldType === BLOCK_GEODE) {
          p.heat = 0
          p.overheated = false
          p.overheatTimer = 0
          p.superDrillTimer = SUPER_DRILL_DURATION_MS
        }
      } else {
        match.deltas.push({ i: idx, t: block, hp: match.hp[idx] })
      }
      break
    }
  }
}

// --- Tick Simulation ------------------------------------------------------
export function tick(match, dtMs) {
  match.deltas = []
  const dtSec = dtMs / 1000

  // 1. Advance Crush Void
  match.elapsed += dtMs
  if (match.elapsed > GRACE_MS) {
    const postGraceSec = (match.elapsed - GRACE_MS) / 1000
    const depth = Math.max(0, match.voidY)
    const speed = Math.min(MAX_VOID_SPEED, BASE_VOID_SPEED + postGraceSec * VOID_ACCEL + depth * VOID_DEPTH_ACCEL)
    match.voidY += speed * dtSec
  }

  // 2. Update Hazards
  for (let i = match.hazards.length - 1; i >= 0; i--) {
    const h = match.hazards[i]
    h.ttl -= dtMs
    if (h.ttl <= 0) {
      match.hazards.splice(i, 1)
    }
  }

  // 3. Update Players
  for (const p of match.players.values()) {
    if (!p.alive) continue

    // Void crush check
    if (p.y <= match.voidY) {
      p.alive = false
      continue
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
      const interval = p.superDrillTimer > 0 ? SUPER_DRILL_PULSE_INTERVAL : DRILL_PULSE_INTERVAL
      p.drillTimer = (p.drillTimer || 0) + dtMs
      while (p.drillTimer >= interval) {
        p.drillTimer -= interval
        executeDrillPulse(match, p)
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
    p.vx = p.input.dx * WALK_SPEED
    const newX = p.x + p.vx * dtSec

    if (p.vx > 0) {
      const minRow = Math.floor(p.y + 0.1)
      const maxRow = Math.floor(p.y + 0.999)
      const targetCol = Math.floor(newX + 0.9)
      let blocked = false
      for (let r = minRow; r <= maxRow; r++) {
        if (isSolid(match.grid, targetCol, r)) {
          blocked = true
          break
        }
      }
      if (blocked) {
        p.x = targetCol - 0.9
        p.vx = 0
      } else {
        p.x = newX
      }
    } else if (p.vx < 0) {
      const minRow = Math.floor(p.y + 0.1)
      const maxRow = Math.floor(p.y + 0.999)
      const targetCol = Math.floor(newX + 0.1)
      let blocked = false
      for (let r = minRow; r <= maxRow; r++) {
        if (isSolid(match.grid, targetCol, r)) {
          blocked = true
          break
        }
      }
      if (blocked) {
        p.x = targetCol + 0.9
        p.vx = 0
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
        if (isSolid(match.grid, c, targetRow)) {
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
        if (isSolid(match.grid, c, targetRow)) {
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

  // 4. Win / Loss Resolution
  if (match.phase === 'playing') {
    for (const p of match.players.values()) {
      if (p.alive && touchesVault(match.grid, p)) {
        match.phase = 'over'
        match.winner = p.id
        match.winReason = 'vault'
        break
      }
    }

    if (match.phase === 'playing') {
      const alive = [...match.players.values()].filter(p => p.alive)
      if (alive.length === 0) {
        match.phase = 'over'
        match.winner = null
      } else if (match.players.size > 1 && alive.length === 1) {
        match.phase = 'over'
        match.winner = alive[0].id
        match.winReason = 'survival'
      }
    }
  }
}

// --- Snapshot Serialization -----------------------------------------------
export function snapshot(match) {
  const players = []
  for (const p of match.players.values()) {
    players.push({
      id: p.id,
      name: p.name,
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
      overheated: p.overheated,
      superDrill: p.superDrillTimer > 0
    })
  }

  const hazards = match.hazards.map(h => ({
    x: Number(h.x.toFixed(2)),
    y: Number(h.y.toFixed(2)),
    r: Number(h.r.toFixed(2)),
    ttl: Number((h.ttl / 1000).toFixed(2))
  }))

  return {
    t: 'snap',
    seq: match.seq++,
    voidY: Number(match.voidY.toFixed(2)),
    phase: match.phase,
    winner: match.winner,
    players,
    deltas: match.deltas,
    hazards
  }
}
