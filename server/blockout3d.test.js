import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMatch,
  addPlayer,
  removePlayer,
  sanitizeName,
  idx,
  xyz,
  tileString,
  SIZE,
  FLOORS,
  TOTAL,
  MAX_PLAYERS,
  SPAWNS,
  startRound,
  ARENAS,
  MIN_PLAYERS,
  input,
  stepPlayers,
  SPEED_BASE,
  AIR_SPEED,
  DASH_MS,
  DASH_MULT,
  usePowerup,
  tileUnder,
  resolveFalls,
  FALL_MS,
} from './blockout3d.js'

test('a new match is a full stack with nobody on it', () => {
  const m = createMatch()
  assert.equal(m.phase, 'waiting')
  assert.equal(m.tiles.length, TOTAL)
  assert.equal(TOTAL, SIZE * SIZE * FLOORS)
  assert.ok(m.tiles.every((t) => t === 'solid'))
  assert.deepEqual(m.players, [])
  assert.equal(m.bottom, FLOORS - 1, 'the whole stack is standing')
})

test('the index runs z, then y, then x', () => {
  assert.equal(idx(0, 0, 0), 0)
  assert.equal(idx(1, 0, 0), 1)
  assert.equal(idx(0, 1, 0), SIZE)
  assert.equal(idx(0, 0, 1), SIZE * SIZE)
  for (const i of [0, 1, SIZE + 2, TOTAL - 1]) {
    const [x, y, z] = xyz(i)
    assert.equal(idx(x, y, z), i, `round trip for ${i}`)
  }
})

test('tiles go on the wire as one character each', () => {
  const m = createMatch()
  m.tiles[idx(1, 0, 0)] = 'warn'
  m.tiles[idx(2, 0, 0)] = 'gone'
  const s = tileString(m.tiles)
  assert.equal(s.length, TOTAL)
  assert.equal(s.slice(0, 3), '.!_')
})

test('joining assigns rising ids and nobody has a piece yet', () => {
  const m = createMatch()
  const a = addPlayer(m, 'ada')
  const b = addPlayer(m, 'bo')
  assert.equal(a.id, 1)
  assert.equal(b.id, 2)
  assert.equal(a.playing, false)
  assert.equal(a.z, 0)
  removePlayer(m, a.id)
  assert.equal(m.players.length, 1)
})

test('a name is trimmed, stripped of control characters, and internal spaces survive', () => {
  assert.equal(sanitizeName('  ada  '), 'ada')
  assert.equal(sanitizeName('a b'), 'a b')
  assert.equal(sanitizeName('   '), 'Player')
  assert.equal(sanitizeName(null), 'Player')
})

test('capacity is derived from the spawn list', () => {
  assert.equal(MAX_PLAYERS, SPAWNS.length)
})

/**
 * A started round with n players. rng 0 picks ARENAS[0] === 'square' for every
 * floor, so the stack is full and spawns land on their exact corners. Timers
 * are frozen; tests place tiles and powerups by hand, never at random.
 */
function playing(n) {
  const m = createMatch()
  for (let i = 0; i < n; i++) addPlayer(m, `p${i}`)
  startRound(m, () => 0)
  m.nextCollapseAt = Infinity
  m.nextPowerupAt = Infinity
  m.voidAt = Infinity
  return m
}

test('a round hands pieces up to capacity, in join order, all on the top floor', () => {
  const m = playing(MAX_PLAYERS + 1)
  assert.equal(m.phase, 'playing')
  assert.equal(m.players.filter((p) => p.playing).length, MAX_PLAYERS)
  assert.equal(m.players[MAX_PLAYERS].playing, false, 'the one over capacity spectates')
  assert.ok(m.players.filter((p) => p.playing).every((p) => p.z === 0))
})

test('every player in a full round starts on a solid tile of floor 0', () => {
  const m = playing(MAX_PLAYERS)
  for (const p of m.players) {
    assert.equal(m.tiles[idx(Math.floor(p.x), Math.floor(p.y), 0)], 'solid', p.name)
  }
})

test('a round below the minimum lays nothing out and waits', () => {
  const m = createMatch()
  addPlayer(m, 'solo')
  startRound(m, () => 0)
  assert.equal(m.phase, 'waiting')
  assert.equal(m.winner, null)
})

test('each floor is carved on its own, so the stack is not one shape repeated', () => {
  const m = createMatch()
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  // A rising sequence walks through the arena list rather than picking one.
  // Dependency: FLOORS must be < ARENAS.length, or the rising counter hits
  // 'scatter' and causes uneven rng consumption inside carve (one per tile).
  let n = 0
  startRound(m, () => (n++ % ARENAS.length) / ARENAS.length)
  assert.equal(m.arenas.length, FLOORS)
  assert.ok(new Set(m.arenas).size > 1, 'floors do not all share one shape')
})

test('carving never strands a solid tile in a region of its own', () => {
  const m = createMatch()
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  // Forces 'scatter' on every arena pick, then uses a pattern that creates
  // clustered holes and isolated islands. A constant rng would make every tile
  // take the same branch, creating no carving and no work for keepLargestRegion.
  let n = 0
  const fragmenting = () => {
    const call = n++
    if (call % (1 + SIZE * SIZE) === 0) {
      return (ARENAS.indexOf('scatter') + 0.5) / ARENAS.length
    }
    // Cluster pattern: every third row is entirely gone, others are solid.
    // This creates multiple isolated regions per floor, forcing keepLargestRegion
    // to eliminate islands.
    const offset = (call - 1) % (SIZE * SIZE)
    const row = Math.floor(offset / SIZE)
    return row % 3 === 1 ? 0.05 : 0.95
  }
  startRound(m, fragmenting)
  // The stack must have at least one gone tile; if it is all solid,
  // keepLargestRegion had nothing to clean and we are testing a vacuity.
  let anyGone = false
  for (let i = 0; i < m.tiles.length; i++) {
    if (m.tiles[i] === 'gone') anyGone = true
  }
  assert.ok(anyGone, 'at least one tile is gone')
  for (let z = 0; z < FLOORS; z++) {
    const solid = []
    for (let i = z * SIZE * SIZE; i < (z + 1) * SIZE * SIZE; i++) {
      if (m.tiles[i] === 'solid') solid.push(i)
    }
    // Each floor must be actually fragmented: some solid, some gone. A floor
    // that is entirely solid or entirely gone would skip the connectivity check.
    assert.ok(solid.length > 0 && solid.length < SIZE * SIZE, `floor ${z} is fragmented`)
    // Flood from the first solid tile; everything solid on this floor must be
    // reachable from it.
    const seen = new Set([solid[0]])
    const queue = [solid[0]]
    for (let h = 0; h < queue.length; h++) {
      const [x, y] = xyz(queue[h])
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
        const j = idx(nx, ny, z)
        if (seen.has(j) || m.tiles[j] !== 'solid') continue
        seen.add(j)
        queue.push(j)
      }
    }
    assert.equal(seen.size, solid.length, `floor ${z} is one region`)
  }
})

test('a held direction moves a player at the ground speed', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  p.y = 6.5
  assert.equal(input(m, p.id, [1, 0]), true)
  stepPlayers(m, 1000)
  assert.ok(Math.abs(p.x - (6.5 + SPEED_BASE)) < 1e-6, `moved to ${p.x}`)
  assert.equal(p.y, 6.5, 'no drift on the other axis')
})

test('a diagonal is not faster than a straight line', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  p.y = 6.5
  input(m, p.id, [1, 1])
  stepPlayers(m, 1000)
  const moved = Math.hypot(p.x - 6.5, p.y - 6.5)
  assert.ok(Math.abs(moved - SPEED_BASE) < 1e-6, `travelled ${moved}`)
})

test('a direction is remembered until another one arrives', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  input(m, p.id, [1, 0])
  stepPlayers(m, 100)
  stepPlayers(m, 100)
  assert.ok(p.x > 6.5 + SPEED_BASE * 0.15, 'kept going without a second message')
})

test('a garbage direction is refused and changes nothing', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  for (const bad of [null, 'up', [1], [NaN, 0], [Infinity, 0], {}, [1, 2, 3]]) {
    assert.equal(input(m, p.id, bad), false, JSON.stringify(bad))
  }
  stepPlayers(m, 1000)
  assert.equal(p.x, 6.5)
})

test('movement is clamped to the grid rather than walking off the array', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 1.5
  p.y = 1.5
  input(m, p.id, [-1, 0])
  stepPlayers(m, 5000)
  assert.ok(p.x >= 0 && p.x <= SIZE, `x stayed in bounds at ${p.x}`)
})

test('a dash multiplies ground speed for its duration', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  p.held = 'dash'
  usePowerup(m, p.id)
  input(m, p.id, [1, 0])
  stepPlayers(m, 100)
  assert.ok(Math.abs(p.x - (6.5 + SPEED_BASE * DASH_MULT * 0.1)) < 1e-6, `at ${p.x}`)
})

test('steering mid-drop is slower than running', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  p.fallUntil = m.now + 10000
  input(m, p.id, [1, 0])
  stepPlayers(m, 1000)
  assert.ok(Math.abs(p.x - (6.5 + AIR_SPEED)) < 1e-6, `at ${p.x}`)
})

test('facing follows the last real direction, not a released key', () => {
  const m = playing(2)
  const p = m.players[0]
  input(m, p.id, [0, 1])
  assert.deepEqual(p.face, [0, 1])
  input(m, p.id, [0, 0])
  assert.deepEqual(p.face, [0, 1], 'standing still does not erase which way you face')
})

test('losing the tile under you starts a drop, it does not teleport you', () => {
  const m = playing(2)
  const p = m.players[0]
  m.tiles[tileUnder(m, p)] = 'gone'
  resolveFalls(m)
  assert.ok(p.fallUntil > m.now, 'a drop is in progress')
  assert.equal(p.z, 0, 'still on the floor being left')
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(p.z, 1)
  assert.equal(p.fallUntil, 0)
  assert.equal(p.alive, true, 'a fall is a life, not the round')
})

test('landing on a hole keeps falling without a second trigger', () => {
  const m = playing(2)
  const p = m.players[0]
  m.tiles[idx(Math.floor(p.x), Math.floor(p.y), 0)] = 'gone'
  m.tiles[idx(Math.floor(p.x), Math.floor(p.y), 1)] = 'gone'
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(p.z, 1)
  assert.ok(p.fallUntil > m.now, 'chained straight into a second drop')
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(p.z, 2)
})

test('a drop off the bottom floor ends the player', () => {
  const m = playing(2)
  const p = m.players[0]
  p.z = m.bottom
  m.tiles[tileUnder(m, p)] = 'gone'
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(p.alive, false)
  assert.equal(p.deaths, 1)
})

test('landing on somebody drives them down a floor too', () => {
  const m = playing(2)
  const [a, b] = m.players
  b.x = a.x
  b.y = a.y
  b.z = 1
  m.tiles[tileUnder(m, a)] = 'gone'
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(a.z, 1, 'the lander arrived')
  assert.ok(b.fallUntil > m.now, 'and shoved the occupant off')
  assert.equal(b.fallBy, a.id, 'credited to whoever landed on them')
})

test('a landing that ends somebody on the bottom floor is a kill', () => {
  const m = playing(2)
  const [a, b] = m.players
  a.z = m.bottom - 1
  b.z = m.bottom
  b.x = a.x
  b.y = a.y
  m.tiles[tileUnder(m, a)] = 'gone'
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(b.alive, false)
  assert.equal(a.kills, 1)
  assert.equal(b.deaths, 1)
})

test('a shield is spent to stay on the floor, once', () => {
  const m = playing(2)
  const p = m.players[0]
  p.shielded = true
  m.tiles[tileUnder(m, p)] = 'gone'
  resolveFalls(m)
  assert.equal(p.fallUntil, 0, 'shoved aside rather than dropped')
  assert.equal(p.shielded, false, 'and the shield is gone')
  assert.equal(p.z, 0)
  assert.equal(m.tiles[tileUnder(m, p)], 'solid')
})

test('a shield with nowhere to be shoved is still spent and you still fall', () => {
  const m = playing(2)
  const p = m.players[0]
  p.shielded = true
  // Erase floor 0 entirely, so there is nowhere on it to stand.
  for (let n = 0; n < SIZE * SIZE; n++) m.tiles[n] = 'gone'
  resolveFalls(m)
  assert.equal(p.shielded, false)
  assert.ok(p.fallUntil > m.now)
})

test('nobody credits themselves with a kill for their own drop', () => {
  const m = playing(2)
  const p = m.players[0]
  p.z = m.bottom
  m.tiles[tileUnder(m, p)] = 'gone'
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(p.kills, 0)
})

test('a fall of your own making credits nobody, even after somebody shoved you', () => {
  const m = playing(2)
  const [a, b] = m.players
  b.z = 1
  b.x = a.x
  b.y = a.y
  m.tiles[tileUnder(m, a)] = 'gone'
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(b.alive, true, 'the shove cost a floor, not the round')
  // Much later, on their own, they walk into a hole and run out of stack.
  b.z = m.bottom
  m.tiles[tileUnder(m, b)] = 'gone'
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(b.alive, false)
  assert.equal(a.kills, 0, 'a shove a minute ago is not a kill now')
})
