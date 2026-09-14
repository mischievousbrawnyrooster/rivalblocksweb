import test from 'node:test'
import assert from 'node:assert/strict'
import {
  make,
  join,
  leave,
  removePlayer,
  setInput,
  tick,
  snapshot,
  encodeMap,
  decodeMap,
  WIDTH,
  DEPTH,
  BLOCK_AIR,
  BLOCK_DIRT,
  BLOCK_STONE,
  BLOCK_BEDROCK,
  BLOCK_GAS,
  BLOCK_GEODE,
  BLOCK_VAULT,
  CHAR_TO_BLOCK,
  TICK_MS,
  GRACE_MS,
  VAULT_Y,
  SPAWN_Y,
  INITIAL_VOID_Y,
  BASE_VOID_SPEED,
  VOID_ACCEL,
  VOID_DEPTH_ACCEL,
  MAX_VOID_SPEED,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  WALK_SPEED,
  GRAVITY,
  TERMINAL_VELOCITY,
  JETPACK_THRUST,
  DIRT_HP,
  STONE_HP,
  GAS_HP,
  GEODE_HP
} from './voiddrillers.js'

test('shaft generation initializes correct dimensions and boundary bedrock', () => {
  const m = make({ seed: 42 })
  assert.equal(m.width, WIDTH)
  assert.equal(m.depth, DEPTH)
  assert.equal(m.grid.length, WIDTH * DEPTH)

  // Boundary columns (x = 0 and x = WIDTH - 1) must be bedrock
  for (let y = 0; y < DEPTH; y++) {
    assert.equal(m.grid[y * WIDTH + 0], BLOCK_BEDROCK, `left boundary bedrock at y=${y}`)
    assert.equal(m.grid[y * WIDTH + (WIDTH - 1)], BLOCK_BEDROCK, `right boundary bedrock at y=${y}`)
  }

  // Bottom barrier must be bedrock
  for (let x = 0; x < WIDTH; x++) {
    assert.equal(m.grid[(DEPTH - 1) * WIDTH + x], BLOCK_BEDROCK, `bottom bedrock at x=${x}`)
  }

  // Vault zone at y >= VAULT_Y contains vault platform
  for (let x = 1; x < WIDTH - 1; x++) {
    assert.equal(m.grid[VAULT_Y * WIDTH + x], BLOCK_VAULT, `vault tile at x=${x}`)
  }
})

test('run-length encoding serializes and compresses the shaft map', () => {
  const m = make({ seed: 101 })
  const encoded = encodeMap(m.grid)
  assert.equal(typeof encoded, 'string')
  assert.equal(encoded.length > 0, true)
  assert.equal(encoded.length < m.grid.length, true, 'compressed string is smaller than raw array')

  // Decode round-trip
  const decoded = decodeMap(encoded)
  assert.equal(decoded.length, m.grid.length)
  for (let i = 0; i < m.grid.length; i++) {
    assert.equal(decoded[i], m.grid[i], `tile mismatch at ${i}`)
  }
})

test('decodeMap resists prototype pollution keys', () => {
  const decoded = decodeMap('1__proto__1constructor1toString')
  assert.equal(decoded.length > 0, true)
  for (const b of decoded) {
    assert.equal(typeof b, 'number')
    assert.equal(b, BLOCK_AIR)
  }
  assert.equal(Object.hasOwn(CHAR_TO_BLOCK, 'constructor'), false)
  assert.equal(Object.hasOwn(CHAR_TO_BLOCK, '__proto__'), false)
})

test('player joins at launch gantry and respects gravity and solid collisions', () => {
  const m = make({ seed: 123 })
  const p = join(m, { id: 'p1', name: 'DrillerOne' })
  assert.ok(p)
  assert.equal(p.alive, true)
  assert.equal(p.y, SPAWN_Y)

  // Advance simulation by 5 ticks with no inputs
  const initialY = p.y
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)

  // Player stands solid on gantry block
  assert.equal(p.y, initialY, 'player stands on solid gantry')

  // Remove block under player and verify falling
  const belowIdx = Math.floor(p.y + 1) * WIDTH + Math.floor(p.x)
  m.grid[belowIdx] = BLOCK_AIR
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)
  assert.equal(p.y > initialY, true, 'player accelerates downward under gravity')
})

test('player flush against solid right wall does not wall-cling and falls under gravity', () => {
  const m = make({ seed: 501 })
  const p = join(m, { id: 'p1', name: 'WallHugger' })
  p.x = 5.1 // flush against right wall at column 6 (5.1 + PLAYER_WIDTH + epsilon = 6.0)
  p.y = 10.0
  p.vy = 0

  // Column 6 has solid blocks from y = 10 to 15
  for (let y = 10; y <= 15; y++) {
    m.grid[y * WIDTH + 6] = BLOCK_STONE
    m.hp[y * WIDTH + 6] = STONE_HP
  }
  // Column 5 below player is empty air
  for (let y = 10; y <= 15; y++) {
    m.grid[y * WIDTH + 5] = BLOCK_AIR
    m.hp[y * WIDTH + 5] = 0
  }

  // Tick simulation with no horizontal input
  setInput(m, 'p1', { dx: 0, thrust: false, drill: false, aim: 0 })
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)

  assert.equal(p.y > 10.0, true, 'driller fell downward rather than clinging to right wall')
  assert.equal(p.grounded, false, 'driller is in free-fall')
})

test('drilling damages blocks, builds heat, and triggers overheat lockout', () => {
  const m = make({ seed: 777 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0

  // Place a stone block directly below player (durability STONE_HP)
  const targetIdx = 11 * WIDTH + 5
  m.grid[targetIdx] = BLOCK_STONE
  m.hp[targetIdx] = STONE_HP

  // Aim downwards (PI / 2) and drill
  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })

  // Tick for 250ms (two drill pulses)
  for (let i = 0; i < 8; i++) tick(m, TICK_MS)

  assert.equal(m.hp[targetIdx] < STONE_HP, true, 'stone block sustained damage')
  assert.equal(p.heat > 0, true, 'drill heat accumulated')

  // Continue drilling until overheated
  while (!p.overheated) {
    tick(m, TICK_MS)
  }
  assert.equal(p.overheated, true, 'overheat breaker tripped at 100% heat')

  // While overheated, drill does not damage
  const hpBefore = m.hp[targetIdx]
  tick(m, TICK_MS)
  assert.equal(m.hp[targetIdx], hpBefore, 'overheated drill produces zero damage')
})

test('destroying gas pocket generates expanding hazard', () => {
  const m = make({ seed: 888 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0
  const gasIdx = 11 * WIDTH + 5
  m.grid[gasIdx] = BLOCK_GAS
  m.hp[gasIdx] = GAS_HP

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })
  // Drill the gas block
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)

  assert.equal(m.grid[gasIdx], BLOCK_AIR, 'gas block popped into air')
  assert.equal(m.hazards.length > 0, true, 'expanding gas hazard created')
})

test('collecting geode clears heat and activates super drill', () => {
  const m = make({ seed: 999 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0
  p.heat = 0.8
  const geodeIdx = 11 * WIDTH + 5
  m.grid[geodeIdx] = BLOCK_GEODE
  m.hp[geodeIdx] = GEODE_HP

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })
  for (let i = 0; i < 8; i++) tick(m, TICK_MS)

  assert.equal(m.grid[geodeIdx], BLOCK_AIR)
  assert.equal(p.heat, 0, 'drill heat flushed')
  assert.equal(p.superDrillTimer > 0, true, 'super drill active')
})

test('crush void advances after grace period and crushes drillers', () => {
  const m = make({ seed: 555 })
  const p = join(m, { id: 'p1', name: 'SlowDriller' })
  p.x = 5.0
  p.y = SPAWN_Y

  assert.equal(m.voidY, INITIAL_VOID_Y)

  // Advance past grace period (4000 ms)
  for (let t = 0; t < 5000; t += TICK_MS) tick(m, TICK_MS)

  assert.equal(m.voidY > INITIAL_VOID_Y, true, 'void is descending')


  // Advance until void passes player position
  while (m.voidY < p.y) {
    tick(m, TICK_MS)
  }
  tick(m, TICK_MS)

  assert.equal(p.alive, false, 'player eliminated by crush void')
  assert.equal(m.phase, 'over', 'match over when all drillers crushed')
})

test('crush void accelerates with depth', () => {
  const m = make({ seed: 505 })
  m.elapsed = GRACE_MS + 1000
  m.voidY = 100.0 // deep in the shaft
  const voidYBefore = m.voidY
  tick(m, 1000)
  const deltaDeep = m.voidY - voidYBefore

  const m2 = make({ seed: 506 })
  m2.elapsed = GRACE_MS + 1000
  m2.voidY = 10.0 // shallow in the shaft
  const voidY2Before = m2.voidY
  tick(m2, 1000)
  const deltaShallow = m2.voidY - voidY2Before

  assert.equal(deltaDeep > deltaShallow, true, 'void moves faster at deeper depth')
})

test('first driller to touch extraction vault wins', () => {
  const m = make({ seed: 333 })
  const p1 = join(m, { id: 'p1', name: 'Speedy' })
  const p2 = join(m, { id: 'p2', name: 'Second' })

  // Teleport p1 onto the extraction vault
  p1.y = VAULT_Y + 0.5
  tick(m, TICK_MS)

  assert.equal(m.phase, 'over')
  assert.equal(m.winner, 'p1', 'p1 reached vault and won match')
})

test('bedrock cannot be damaged by drilling', () => {
  const m = make({ seed: 111 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 1.0
  p.y = 10.0
  // Left border is bedrock (col 0)
  const bedrockIdx = 10 * WIDTH + 0
  assert.equal(m.grid[bedrockIdx], BLOCK_BEDROCK)
  const initialHp = m.hp[bedrockIdx]

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI }) // aim left
  for (let i = 0; i < 8; i++) tick(m, TICK_MS)

  assert.equal(m.grid[bedrockIdx], BLOCK_BEDROCK, 'bedrock still intact')
  assert.equal(m.hp[bedrockIdx], initialHp, 'bedrock hp undamaged')
})

test('jetpack consumes fuel and accelerates upward, recharges on ground', () => {
  const m = make({ seed: 222 })
  const p = join(m, { id: 'p1', name: 'Flyer' })
  p.x = 5.0
  p.y = 50.0 // mid-shaft
  p.vy = 0
  // Clear surrounding area to ensure free flight
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      m.grid[(50 + dy) * WIDTH + (5 + dx)] = BLOCK_AIR
    }
  }

  // Fire jetpack
  setInput(m, 'p1', { dx: 0, thrust: true, drill: false, aim: 0 })
  for (let i = 0; i < 10; i++) tick(m, TICK_MS)

  assert.equal(p.fuel < 1.0, true, 'fuel consumed during thrust')
  assert.equal(p.vy < 0, true, 'driller accelerated upward')

  // Stop jetpack and place solid block below to recharge
  setInput(m, 'p1', { dx: 0, thrust: false, drill: false, aim: 0 })
  p.x = 5.0
  p.y = 10.0
  p.fuel = 0.2
  m.grid[11 * WIDTH + 5] = BLOCK_STONE
  m.hp[11 * WIDTH + 5] = STONE_HP

  // Fall onto the stone block
  for (let i = 0; i < 10; i++) tick(m, TICK_MS)
  assert.equal(p.y, 10.0, 'landed on solid stone')
  const fuelBefore = p.fuel
  for (let i = 0; i < 10; i++) tick(m, TICK_MS)
  assert.equal(p.fuel > fuelBefore, true, 'fuel recharged on solid ground')
})

test('horizontal movement stops at bedrock border', () => {
  const m = make({ seed: 444 })
  const p = join(m, { id: 'p1', name: 'Walker' })
  p.x = 2.0
  p.y = SPAWN_Y

  // Walk left toward bedrock wall at col 0
  setInput(m, 'p1', { dx: -1, thrust: false, drill: false, aim: 0 })
  for (let i = 0; i < 30; i++) tick(m, TICK_MS)

  // Column 0 is bedrock, so driller x cannot penetrate into column 0
  assert.equal(p.x >= 0.9, true, 'cannot walk into left border bedrock')
})

test('last surviving driller among multiple players wins match', () => {
  const m = make({ seed: 666 })
  const p1 = join(m, { id: 'p1', name: 'Survivor' })
  const p2 = join(m, { id: 'p2', name: 'Doomed' })

  p1.x = 5.0
  p1.y = 20.0
  p2.x = 8.0
  p2.y = 5.0

  // Void eliminates p2 while p1 is safe ahead
  m.voidY = 10.0
  tick(m, TICK_MS)

  assert.equal(p2.alive, false, 'p2 crushed')
  assert.equal(p1.alive, true, 'p1 still alive')
  assert.equal(m.phase, 'over', 'match ends when 1 driller survives')
  assert.equal(m.winner, 'p1', 'p1 declared winner')
})

test('leaving player triggers survival win for remaining driller', () => {
  const m = make({ seed: 502 })
  const p1 = join(m, { id: 'p1', name: 'Stayer' })
  const p2 = join(m, { id: 'p2', name: 'Leaver' })
  assert.equal(m.phase, 'playing')

  // p2 leaves match
  leave(m, 'p2')

  assert.equal(m.players.size, 1)
  assert.equal(m.phase, 'over', 'match ends when only one player remains')
  assert.equal(m.winner, 'p1', 'remaining player wins by survival')
  assert.equal(m.winReason, 'survival')
})

test('removePlayer is exported alias for leave', () => {
  const m = make({ seed: 503 })
  const p1 = join(m, { id: 'p1', name: 'P1' })
  const p2 = join(m, { id: 'p2', name: 'P2' })
  removePlayer(m, 'p1')
  assert.equal(m.players.has('p1'), false)
  assert.equal(m.players.size, 1)
})

test('setInput rejects NaN and non-finite inputs without corrupting state', () => {
  const m = make({ seed: 504 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  const initialDx = p.input.dx
  const initialAim = p.input.aim

  setInput(m, 'p1', { dx: NaN, aim: Infinity })
  assert.equal(p.input.dx, initialDx)
  assert.equal(p.input.aim, initialAim)

  setInput(m, 'p1', { dx: -Infinity, aim: NaN })
  assert.equal(p.input.dx, initialDx)
  assert.equal(p.input.aim, initialAim)
})

test('drilling heat dissipates when idle', () => {
  const m = make({ seed: 778 })
  const p = join(m, { id: 'p1', name: 'Cooler' })
  p.heat = 0.5
  setInput(m, 'p1', { dx: 0, thrust: false, drill: false, aim: 0 })

  tick(m, 1000) // 1 second idle
  assert.equal(p.heat < 0.5, true, 'heat cooled down')
  assert.equal(Math.abs(p.heat - 0.2) < 0.05, true, 'heat cooled by approx 0.30/s')
})

test('snapshot contains clean public state without leaking private match state', () => {
  const m = make({ seed: 889 })
  join(m, { id: 'p1', name: 'SnapTester' })
  const snap = snapshot(m)

  assert.equal(snap.t, 'snap')
  assert.equal(typeof snap.seq, 'number')
  assert.equal(typeof snap.voidY, 'number')
  assert.equal(Array.isArray(snap.players), true)
  assert.equal(Array.isArray(snap.deltas), true)
  assert.equal(Array.isArray(snap.hazards), true)
  assert.equal(snap.players.length, 1)
  assert.equal(snap.players[0].name, 'SnapTester')
})

test('leave removes driller from match', () => {
  const m = make({ seed: 991 })
  const p1 = join(m, { id: 'p1', name: 'Player1' })
  const p2 = join(m, { id: 'p2', name: 'Player2' })
  assert.equal(m.players.size, 2)

  leave(m, 'p1')
  assert.equal(m.players.has('p1'), false)
  assert.equal(m.players.size, 1)
})
