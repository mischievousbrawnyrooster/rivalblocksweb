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
  waveSize,
  collapseDelay,
  COLLAPSE_COUNT,
  COLLAPSE_SHARE,
  COLLAPSE_EVERY_MS,
  COLLAPSE_FASTEST_MS,
  WARNING_MS,
  collapse,
  resolveWarnings,
  startFall,
  consumeFloor,
  voidWarning,
  VOID_WARN_MS,
  VOID_EVERY_MS,
} from './blockout3d.js'

/** The next wave, recomputed. `collapse` is what a test would otherwise have
 *  to drive, and that also mutates the board. */
function pickWaveForTest(m, rng) {
  collapse(m, rng)
  const wave = m.nextWave
  // Undo the flags collapse just laid down, so a loop of these stays clean.
  for (let i = 0; i < TOTAL; i++) {
    if (m.tiles[i] === 'warn') {
      m.tiles[i] = 'solid'
      m.warnAt[i] = 0
    }
  }
  return wave
}

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

test('a wave is capped on a full stack and tapers to one tile on an empty one', () => {
  assert.equal(waveSize(TOTAL), COLLAPSE_COUNT)
  assert.equal(waveSize(1), 1)
  assert.equal(waveSize(0), 1)
  assert.ok(waveSize(40) < COLLAPSE_COUNT, 'the share binds once the stack thins')
  assert.equal(waveSize(40), Math.ceil(40 * COLLAPSE_SHARE))
})

test('waves come faster as the stack runs out', () => {
  assert.equal(collapseDelay(TOTAL), COLLAPSE_EVERY_MS)
  assert.equal(collapseDelay(0), COLLAPSE_FASTEST_MS)
  assert.ok(collapseDelay(TOTAL / 2) < collapseDelay(TOTAL))
})

test('a wave is spread over the whole stack, never one floor', () => {
  const m = playing(2)
  let n = 0
  // A rising rng walks the solid list rather than sitting on one index.
  const rng = () => ((n++ * 0.37) % 1)
  const floors = new Set()
  for (let w = 0; w < 40; w++) {
    for (const i of pickWaveForTest(m, rng)) floors.add(xyz(i)[2])
  }
  assert.ok(floors.size > 1, `waves touched floors ${[...floors]}`)
})

test('a wave never picks a tile that is already gone', () => {
  const m = playing(2)
  for (let i = 0; i < TOTAL; i += 2) m.tiles[i] = 'gone'
  let n = 0
  const wave = pickWaveForTest(m, () => ((n++ * 0.37) % 1))
  for (const i of wave) assert.equal(m.tiles[i], 'solid', `picked ${i}`)
})

test('a wave flags rather than removes, and the warning has to expire', () => {
  const m = playing(2)
  m.nextWave = [idx(5, 5, 2)]
  collapse(m, () => 0)
  assert.equal(m.tiles[idx(5, 5, 2)], 'warn')
  resolveWarnings(m)
  assert.equal(m.tiles[idx(5, 5, 2)], 'warn', 'still standing before the warning is up')
  m.now += WARNING_MS
  resolveWarnings(m)
  assert.equal(m.tiles[idx(5, 5, 2)], 'gone')
})

test('a pickup on a collapsing tile goes down with it', () => {
  const m = playing(2)
  const i = idx(5, 5, 2)
  m.powerups[i] = 'dash'
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now
  resolveWarnings(m)
  assert.equal(Object.hasOwn(m.powerups, i), false)
})

test('reinforcement absorbs one wave and is spent doing it', () => {
  const m = playing(2)
  const i = idx(5, 5, 2)
  m.reinforced.add(i)
  m.nextWave = [i]
  collapse(m, () => 0)
  assert.equal(m.tiles[i], 'solid', 'the wave broke on the plating')
  assert.equal(m.reinforced.has(i), false, 'and the plating went with it')
  // The very next wave takes it, because an anchor buys a wave, not a floor.
  m.nextWave = [i]
  collapse(m, () => 0)
  assert.equal(m.tiles[i], 'warn')
})

test('a tile anchored after it was flagged is put back', () => {
  const m = playing(2)
  const i = idx(5, 5, 2)
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now
  m.reinforced.add(i)
  resolveWarnings(m)
  assert.equal(m.tiles[i], 'solid')
  assert.equal(m.warnAt[i], 0)
  assert.equal(m.reinforced.has(i), false)
})

test('a collapse under a player starts their fall, credited to whoever flagged it', () => {
  const m = playing(2)
  const [a, b] = m.players
  const i = tileUnder(m, b)
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now
  m.warnBy[i] = a.id
  resolveWarnings(m)
  assert.ok(b.fallUntil > m.now, 'the fall began here, not a tick later')
  assert.equal(b.fallBy, a.id)
})

test('an ordinary wave credits nobody for what it drops', () => {
  const m = playing(2)
  const b = m.players[1]
  const i = tileUnder(m, b)
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now
  m.warnBy[i] = 0
  resolveWarnings(m)
  assert.ok(b.fallUntil > m.now)
  assert.equal(b.fallBy, 0, 'the floor is not a player')
})

test('the void eats the bottom floor and raises the floor beneath everyone', () => {
  const m = playing(2)
  const was = m.bottom
  consumeFloor(m)
  assert.equal(m.bottom, was - 1)
  for (let n = 0; n < SIZE * SIZE; n++) {
    assert.equal(m.tiles[idx(n % SIZE, (n / SIZE) | 0, was)], 'gone')
  }
})

test('anyone standing on a consumed floor is out, and nobody gets the kill', () => {
  const m = playing(2)
  const [a, b] = m.players
  a.z = m.bottom
  consumeFloor(m)
  assert.equal(a.alive, false)
  assert.equal(a.deaths, 1)
  assert.equal(b.kills, 0, 'the void is not a player')
})

test('the void never eats the top floor', () => {
  const m = playing(2)
  for (let n = 0; n < FLOORS + 2; n++) consumeFloor(m)
  assert.equal(m.bottom, 0)
  assert.equal(m.tiles[idx(1, 1, 0)] !== 'gone', true, 'floor 0 survives')
})

test('the void announces itself before it arrives', () => {
  const m = playing(2)
  m.voidAt = m.now + VOID_WARN_MS + 1
  assert.equal(voidWarning(m), false)
  m.now += 2
  assert.equal(voidWarning(m), true)
})

test('a consumed floor reschedules the next one', () => {
  const m = playing(2)
  m.voidAt = m.now
  consumeFloor(m)
  assert.equal(m.voidAt, m.now + VOID_EVERY_MS)
})

test('with one floor left the void stands down entirely', () => {
  const m = playing(2)
  while (m.bottom > 0) consumeFloor(m)
  assert.equal(m.voidAt, Infinity, 'nothing left to eat')
  assert.equal(voidWarning(m), false)
})
