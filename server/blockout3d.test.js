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
  TICK_MS,
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
  stomp,
  resolveStomps,
  STOMP_WINDUP_MS,
  STOMP_COOLDOWN_MS,
  POWERUP_KINDS,
  POWERUP_WEIGHTS,
  POWERUP_MAX,
  spawnPowerup,
  pickUp,
  BLINK_TILES,
  FORESIGHT_MS,
  SHOVE_DIST,
  HOVER_MS,
  BRIDGE_TILES,
  driveBots,
  ensureBots,
  wantBots,
  BOT_FILL_TO,
  BOT_REACT_MS,
  tick,
  snapshot,
  COUNTDOWN_MS,
  OVER_MS,
  ROUND_TARGET,
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
  // startRound seeds one pickup itself; cleared so a test's own placements are
  // the only ones on the board.
  m.powerups = {}
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

test('a new round starts kill and death counts at zero', () => {
  const m = playing(2)
  const [a, b] = m.players
  a.kills = 4
  b.deaths = 7
  startRound(m, () => 0)
  assert.equal(a.kills, 0)
  assert.equal(b.deaths, 0)
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

test('movement never quite reaches SIZE, so a bare Math.floor at the edge stays a valid column', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = SIZE - 0.5
  p.y = 6.5
  input(m, p.id, [1, 0])
  stepPlayers(m, 5000)
  // patchAround, anchorAround, blink and buildBridge all read Math.floor(p.x)
  // with no clamp of their own — tileUnder's SIZE - 1 clamp does not cover
  // them, so the coordinate itself has to stay short of SIZE.
  assert.ok(Math.floor(p.x) < SIZE, `floor(x) still a real column at ${p.x}`)
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

test('a wave never touches a floor with nobody standing on it', () => {
  // Both players are on floor 0 (playing() spawns everyone there), and the
  // whole point of the restriction is that an empty floor never quietly
  // erodes. Measured at 53% of drops chaining into an immediate second drop
  // when waves were picked from the whole stack; restricting to occupied
  // floors brought that to 38% over 30 seeded rounds (see pickWave).
  const m = playing(2)
  let n = 0
  // A rising rng walks the solid list rather than sitting on one index.
  const rng = () => ((n++ * 0.37) % 1)
  const floors = new Set()
  for (let w = 0; w < 40; w++) {
    for (const i of pickWaveForTest(m, rng)) floors.add(xyz(i)[2])
  }
  assert.deepEqual([...floors], [0], `waves touched floors ${[...floors]}`)
})

test('moving a player to another floor puts that floor back in play for the wave', () => {
  const m = playing(2)
  m.players[1].z = 2
  let n = 0
  const rng = () => ((n++ * 0.37) % 1)
  const floors = new Set()
  for (let w = 0; w < 40; w++) {
    for (const i of pickWaveForTest(m, rng)) floors.add(xyz(i)[2])
  }
  assert.ok(floors.has(0), 'floor 0 still has a player on it')
  assert.ok(floors.has(2), 'floor 2 now has a player on it too')
  assert.ok(!floors.has(1) && !floors.has(3) && !floors.has(4), 'nobody stands on the rest')
})

test('an empty stack falls back to every solid tile, so a wave is still defined', () => {
  const m = createMatch()
  m.now = 0
  let n = 0
  const rng = () => ((n++ * 0.37) % 1)
  const floors = new Set()
  for (let w = 0; w < 40; w++) {
    for (const i of pickWaveForTest(m, rng)) floors.add(xyz(i)[2])
  }
  assert.ok(floors.size > 1, 'no players means no floor is favoured')
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

test('anyone falling into a consumed floor is out, and credit does not transfer to the shover', () => {
  const m = playing(2)
  const [a, b] = m.players
  a.fallUntil = m.now + FALL_MS
  a.z = m.bottom - 1
  a.fallBy = b.id
  consumeFloor(m)
  assert.equal(a.alive, false)
  assert.equal(a.deaths, 1)
  assert.equal(b.kills, 0, 'the void takes the kill, not the shover')
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
  m.now = m.voidAt - VOID_WARN_MS
  assert.equal(voidWarning(m), true, 'the warning is on at the threshold')
  m.now -= 1
  assert.equal(voidWarning(m), false, 'and not one millisecond before it')
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

test('a stomp winds up before it breaks anything', () => {
  const m = playing(2)
  const p = m.players[0]
  const i = tileUnder(m, p)
  assert.equal(stomp(m, p.id), true)
  resolveStomps(m)
  assert.equal(m.tiles[i], 'solid', 'nothing has happened yet')
  m.now += STOMP_WINDUP_MS
  resolveStomps(m)
  assert.equal(m.tiles[i], 'gone')
})

test('a stomp cannot be spammed', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.equal(stomp(m, p.id), true)
  m.now += STOMP_WINDUP_MS
  resolveStomps(m)
  // Step off the hole this stomp just made and onto standing ground, so the
  // cooldown is the only thing left that could refuse the next one. Without
  // this the test passes on the over-a-hole guard and never exercises the
  // cooldown at all.
  p.x += 1
  assert.equal(m.tiles[tileUnder(m, p)], 'solid', 'back on floor')
  assert.equal(stomp(m, p.id), false, 'still cooling down')
  m.now += STOMP_COOLDOWN_MS
  assert.equal(stomp(m, p.id), true)
})

test('a stomp takes anyone else over that tile down as well, and credits it', () => {
  const m = playing(2)
  const [a, b] = m.players
  b.x = a.x
  b.y = a.y
  b.z = a.z
  stomp(m, a.id)
  m.now += STOMP_WINDUP_MS
  resolveStomps(m)
  resolveFalls(m)
  assert.ok(b.fallUntil > m.now)
  assert.equal(b.fallBy, a.id)
})

test('a stomp mid-drop is refused', () => {
  const m = playing(2)
  const p = m.players[0]
  p.fallUntil = m.now + 1000
  assert.equal(stomp(m, p.id), false)
})

test('stomping over a hole is refused rather than wasted', () => {
  const m = playing(2)
  const p = m.players[0]
  m.tiles[tileUnder(m, p)] = 'gone'
  assert.equal(stomp(m, p.id), false)
})

test('the kit is the flat game plus lift, and every kind is in the bag', () => {
  const flat = ['shield', 'dash', 'sinkhole', 'patch', 'blink', 'swap', 'foresight',
                'shove', 'hover', 'bridge', 'anchor']
  for (const kind of [...flat, 'lift']) {
    assert.ok(POWERUP_KINDS.includes(kind), kind)
  }
  assert.equal(POWERUP_KINDS.length, flat.length + 1)
})

test('a pickup is taken by walking over it with an empty hand', () => {
  const m = playing(2)
  const p = m.players[0]
  m.powerups[tileUnder(m, p)] = 'shield'
  pickUp(m)
  assert.equal(p.held, 'shield')
  assert.equal(Object.keys(m.powerups).length, 0)
})

test('a full hand leaves a pickup on the floor', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'dash'
  m.powerups[tileUnder(m, p)] = 'shield'
  pickUp(m)
  assert.equal(p.held, 'dash')
  assert.equal(Object.keys(m.powerups).length, 1)
})

test('lift climbs a floor', () => {
  const m = playing(2)
  const p = m.players[0]
  p.z = 2
  p.held = 'lift'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(p.z, 1)
})

test('lift on the top floor is a no-op that keeps the item', () => {
  const m = playing(2)
  const p = m.players[0]
  p.z = 0
  p.held = 'lift'
  assert.equal(usePowerup(m, p.id), false)
  assert.equal(p.held, 'lift', 'not eaten for nothing')
})

test('lift onto a hole drops you straight back down', () => {
  const m = playing(2)
  const p = m.players[0]
  p.z = 1
  p.held = 'lift'
  m.tiles[idx(Math.floor(p.x), Math.floor(p.y), 0)] = 'gone'
  usePowerup(m, p.id)
  assert.equal(p.z, 0)
  resolveFalls(m)
  assert.ok(p.fallUntil > m.now, 'and immediately falls again')
})

test('swap trades height as well as position', () => {
  const m = playing(2)
  const [a, b] = m.players
  a.z = 3
  b.z = 1
  b.x = 9.5
  a.held = 'swap'
  assert.equal(usePowerup(m, a.id), true)
  assert.equal(a.z, 1)
  assert.equal(b.z, 3)
  assert.equal(a.x, 9.5)
})

test('swap with nobody to swap with keeps the item', () => {
  const m = playing(2)
  const a = m.players[0]
  m.players[1].alive = false
  a.held = 'swap'
  assert.equal(usePowerup(m, a.id), false)
  assert.equal(a.held, 'swap')
})

test('sinkhole prefers a rival on your own floor over a nearer one below', () => {
  const m = playing(3)
  const [a, near, same] = m.players
  a.x = 1.5
  a.y = 1.5
  a.z = 0
  // Nearer in x/y, but a floor down.
  near.x = 2.5
  near.y = 1.5
  near.z = 1
  // Further away, but standing on the same floor.
  same.x = 6.5
  same.y = 1.5
  same.z = 0
  a.held = 'sinkhole'
  usePowerup(m, a.id)
  assert.equal(m.tiles[tileUnder(m, same)], 'warn')
  assert.equal(m.tiles[tileUnder(m, near)], 'solid')
})

test('a sinkhole that ends somebody is credited to whoever cast it', () => {
  const m = playing(2)
  const [a, b] = m.players
  a.z = m.bottom
  b.z = m.bottom
  b.x = 9.5
  a.held = 'sinkhole'
  usePowerup(m, a.id)
  m.now += WARNING_MS
  resolveWarnings(m)
  resolveFalls(m)
  m.now += FALL_MS
  resolveFalls(m)
  assert.equal(b.alive, false)
  assert.equal(a.kills, 1)
})

test('patch rebuilds the three by three you are standing in, on your own floor', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  p.y = 6.5
  p.z = 2
  for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) m.tiles[idx(x, y, 2)] = 'gone'
  m.tiles[idx(6, 6, 1)] = 'gone'
  p.held = 'patch'
  usePowerup(m, p.id)
  for (let y = 5; y <= 7; y++) {
    for (let x = 5; x <= 7; x++) assert.equal(m.tiles[idx(x, y, 2)], 'solid', `${x},${y}`)
  }
  assert.equal(m.tiles[idx(6, 6, 1)], 'gone', 'the floor above is not yours to fix')
})

test('patch does not clear a tile already flagged for the next wave', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  p.y = 6.5
  const i = idx(6, 6, 0)
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now + WARNING_MS
  p.held = 'patch'
  usePowerup(m, p.id)
  assert.equal(m.tiles[i], 'warn', 'a patch buys ground, never a reprieve')
})

test('blink hops the way you face, over a hole, on your own floor', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 2.5
  p.y = 6.5
  p.z = 1
  p.face = [1, 0]
  m.tiles[idx(3, 6, 1)] = 'gone'
  m.tiles[idx(4, 6, 1)] = 'gone'
  p.held = 'blink'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(Math.floor(p.x), 2 + BLINK_TILES)
  assert.equal(p.z, 1, 'blink is horizontal')
})

test('blink with nowhere to land keeps the item', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  p.y = 6.5
  p.face = [1, 0]
  for (let n = 1; n <= BLINK_TILES; n++) m.tiles[idx(6 + n, 6, 0)] = 'gone'
  p.held = 'blink'
  assert.equal(usePowerup(m, p.id), false)
  assert.equal(p.held, 'blink')
})

test('foresight is a clock, not a board change', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'foresight'
  usePowerup(m, p.id)
  assert.equal(p.seeingUntil, m.now + FORESIGHT_MS)
})

test('a pickup never lands in a hole, on a player, or past the cap', () => {
  const m = playing(2)
  let n = 0
  const rng = () => ((n++ * 0.37) % 1)
  for (let k = 0; k < POWERUP_MAX * 3; k++) spawnPowerup(m, rng)
  assert.ok(Object.keys(m.powerups).length <= POWERUP_MAX)
  for (const key of Object.keys(m.powerups)) {
    assert.equal(m.tiles[Number(key)], 'solid')
    for (const p of m.players) assert.notEqual(tileUnder(m, p), Number(key))
  }
})

test('patch is the only weighted kind, and lift sits at one', () => {
  assert.equal(POWERUP_WEIGHTS.patch, 3)
  assert.equal(Object.hasOwn(POWERUP_WEIGHTS, 'lift'), false)
})

test('shove drives a rival back and leaves the ones on other floors alone', () => {
  const m = playing(3)
  const [p, near, above] = m.players
  p.x = 6.5
  p.y = 6.5
  p.z = 1
  near.x = 7.5
  near.y = 6.5
  near.z = 1
  above.x = 7.5
  above.y = 6.5
  above.z = 0
  p.held = 'shove'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(near.x, 7.5 + SHOVE_DIST, 'driven back along the axis')
  assert.equal(above.x, 7.5, 'a slab is not something a shove travels through')
})

test('shove with nobody in range keeps the item', () => {
  const m = playing(2)
  const [p, far] = m.players
  p.x = 1.5
  p.y = 1.5
  far.x = 11.5
  far.y = 11.5
  p.held = 'shove'
  assert.equal(usePowerup(m, p.id), false)
  assert.equal(p.held, 'shove')
})

test('shove skips a rival already falling, rather than teleporting them sideways in the air', () => {
  const m = playing(2)
  const [p, o] = m.players
  p.x = 6.5
  p.y = 6.5
  o.x = 7.5
  o.y = 6.5
  o.z = p.z
  o.fallUntil = m.now + 1000
  p.held = 'shove'
  assert.equal(usePowerup(m, p.id), false, 'nobody eligible in range')
  assert.equal(o.x, 7.5, 'left where the drop already put them')
  assert.equal(p.held, 'shove', 'kept rather than spent on a body already falling')
})

test('shove over a hole is credited to whoever threw it', () => {
  const m = playing(2)
  const [p, o] = m.players
  p.x = 6.5
  p.y = 6.5
  o.x = 7.5
  o.y = 6.5
  o.z = p.z
  m.tiles[idx(7 + SHOVE_DIST, 6, p.z)] = 'gone'
  p.held = 'shove'
  usePowerup(m, p.id)
  assert.ok(o.fallUntil > m.now, 'they went over the edge')
  assert.equal(o.fallBy, p.id)
})

test('hover carries you over a hole until it runs out', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'hover'
  usePowerup(m, p.id)
  m.tiles[tileUnder(m, p)] = 'gone'
  resolveFalls(m)
  assert.equal(p.fallUntil, 0, 'floating, not falling')
  m.now += HOVER_MS
  resolveFalls(m)
  assert.ok(p.fallUntil > m.now, 'and down when it lapses')
})

test('hover does not climb', () => {
  const m = playing(2)
  const p = m.players[0]
  p.z = 2
  p.held = 'hover'
  usePowerup(m, p.id)
  assert.equal(p.z, 2, 'it buys time, never height')
})

test('bridge lays floor forward and only fills holes', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 2.5
  p.y = 6.5
  p.z = 1
  p.face = [1, 0]
  for (let n = 1; n <= BRIDGE_TILES; n++) m.tiles[idx(2 + n, 6, 1)] = 'gone'
  m.tiles[idx(2 + BRIDGE_TILES + 1, 6, 1)] = 'gone'
  p.held = 'bridge'
  assert.equal(usePowerup(m, p.id), true)
  for (let n = 1; n <= BRIDGE_TILES; n++) {
    assert.equal(m.tiles[idx(2 + n, 6, 1)], 'solid', `tile ${n}`)
  }
  assert.equal(m.tiles[idx(2 + BRIDGE_TILES + 1, 6, 1)], 'gone', 'and no further')
})

test('bridge over standing ground keeps the item', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 2.5
  p.y = 6.5
  p.face = [1, 0]
  p.held = 'bridge'
  assert.equal(usePowerup(m, p.id), false)
  assert.equal(p.held, 'bridge')
})

test('anchor plates the floor you are on and never fills a hole', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 6.5
  p.y = 6.5
  p.z = 1
  m.tiles[idx(5, 5, 1)] = 'gone'
  p.held = 'anchor'
  usePowerup(m, p.id)
  assert.equal(m.tiles[idx(5, 5, 1)], 'gone', 'plating is armour, not a repair')
  assert.equal(m.reinforced.has(idx(5, 5, 1)), false)
  assert.equal(m.reinforced.has(idx(6, 6, 1)), true)
  assert.equal(m.reinforced.has(idx(6, 6, 0)), false, 'your floor only')
})

test('anchoring a flagged tile buys the wave, and spends the plate doing it', () => {
  const m = playing(2)
  const p = m.players[0]
  const i = tileUnder(m, p)
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now + WARNING_MS
  p.held = 'anchor'
  usePowerup(m, p.id)
  assert.equal(m.tiles[i], 'warn', 'the flag stands; no free cancellation')
  assert.equal(m.reinforced.has(i), true)
  m.now += WARNING_MS
  resolveWarnings(m)
  assert.equal(m.tiles[i], 'solid', 'the plate took the hit')
  assert.equal(m.reinforced.has(i), false, 'and was spent doing it')
})

test('a round puts one pickup on the floor before the first tick', () => {
  const m = createMatch()
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  startRound(m, () => 0)
  const keys = Object.keys(m.powerups)
  assert.equal(keys.length, 1, 'exactly one, seeded by startRound')
  const i = Number(keys[0])
  assert.equal(m.tiles[i], 'solid')
  for (const p of m.players) assert.notEqual(tileUnder(m, p), i, 'never under a body')
})

test('bots fill a stack only once somebody asks for them', () => {
  const m = createMatch()
  m.botFill = BOT_FILL_TO
  addPlayer(m, 'ada')
  ensureBots(m)
  assert.equal(m.players.length, 1, 'nobody gets bots unprompted')
  wantBots(m)
  ensureBots(m)
  assert.equal(m.players.length, BOT_FILL_TO)
})

test('a bot on flagged ground routes off it rather than shuffling', () => {
  const m = playing(2)
  const b = m.players[1]
  b.bot = true
  b.thinkAt = 0
  b.x = 6.5
  b.y = 6.5
  // Flag the whole three by three the bot stands in. Every immediate neighbour
  // is now passable but none is a destination, so the random-shuffle fallback
  // has nothing to pick and leaves the bot standing still. Only a deliberate
  // route off the flagged ground moves it at all.
  for (let y = 5; y <= 7; y++) {
    for (let x = 5; x <= 7; x++) {
      const i = idx(x, y, b.z)
      m.tiles[i] = 'warn'
      m.warnAt[i] = m.now + WARNING_MS
    }
  }
  driveBots(m, () => 0)
  assert.notDeepEqual(b.dir, [0, 0], 'it found a way off')
  // And the way it picked actually leads to standing floor.
  const [dx, dy] = b.dir
  assert.equal(m.tiles[idx(6 + Math.round(dx) * 2, 6 + Math.round(dy) * 2, b.z)], 'solid')
})

test('a bot with something in hand spends it', () => {
  const m = playing(2)
  const b = m.players[1]
  b.bot = true
  b.thinkAt = 0
  b.held = 'shield'
  driveBots(m, () => 0)
  assert.equal(b.held, null)
})

test('a bot thinks once per reaction time, not once per tick', () => {
  const m = playing(2)
  const b = m.players[1]
  b.bot = true
  b.thinkAt = 0
  driveBots(m, () => 0)
  const first = b.thinkAt
  assert.equal(first, m.now + BOT_REACT_MS)
  // Advance to just inside the window. Without moving the clock at all, thinkAt
  // recomputes to the same number whether the gate is consulted or not, and the
  // assertion below proves nothing.
  m.now += BOT_REACT_MS - 1
  driveBots(m, () => 0)
  assert.equal(b.thinkAt, first, 'no second decision inside the window')
  m.now += 1
  driveBots(m, () => 0)
  assert.equal(b.thinkAt, m.now + BOT_REACT_MS, 'and a fresh one once it elapses')
})

test('bots never drive a body to NaN', () => {
  const m = playing(2)
  for (const b of m.players) {
    b.bot = true
    b.thinkAt = 0
  }
  let n = 0
  for (let k = 0; k < 200; k++) {
    m.now += BOT_REACT_MS
    driveBots(m, () => ((n++ * 0.37) % 1))
    stepPlayers(m, BOT_REACT_MS)
    for (const p of m.players) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.name} at ${p.x},${p.y}`)
    }
  }
})

test('a match waits, counts down, then plays', () => {
  const m = createMatch()
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  tick(m, TICK_MS)
  assert.equal(m.phase, 'countdown')
  tick(m, COUNTDOWN_MS)
  assert.equal(m.phase, 'playing')
})

test('the last one still in the stack takes the round', () => {
  const m = playing(2)
  m.players[1].alive = false
  tick(m, TICK_MS)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, m.players[0].name)
  assert.equal(m.winnerId, m.players[0].id)
  assert.equal(m.players[0].wins, 1)
})

test('a match is over when somebody reaches the round target', () => {
  const m = playing(2)
  m.players[0].wins = ROUND_TARGET - 1
  m.players[1].alive = false
  tick(m, TICK_MS)
  assert.equal(m.final, true)
})

test('a finished match resets the running total, a finished round does not', () => {
  const m = playing(2)
  m.players[1].alive = false
  tick(m, TICK_MS)
  assert.equal(m.final, false)
  tick(m, OVER_MS)
  assert.equal(m.players[0].wins, 1, 'a round win carries')

  // One win short of the target: the next round taken pushes the match itself
  // to a close, and that is the case the running total does not survive.
  m.players[0].wins = ROUND_TARGET - 1
  tick(m, COUNTDOWN_MS, () => 0)
  m.players[1].alive = false
  tick(m, TICK_MS)
  assert.equal(m.final, true)
  tick(m, OVER_MS)
  assert.equal(m.players[0].wins, 0, 'a finished match resets the running total')
})

test('the snapshot carries tiles as a string of the right length', () => {
  const m = playing(2)
  const s = snapshot(m)
  assert.equal(typeof s.tiles, 'string')
  assert.equal(s.tiles.length, TOTAL)
  assert.equal(s.tiles, tileString(m.tiles))
  assert.equal(s.size, SIZE)
  assert.equal(s.floors, FLOORS)
  assert.equal(s.bottom, m.bottom)
})

test('the next wave is shown to a foresight holder and to nobody else', () => {
  const m = playing(2)
  const p = m.players[0]
  m.nextWave = [idx(1, 1, 1)]
  assert.deepEqual(snapshot(m).soon, [])
  assert.deepEqual(snapshot(m, p.id).soon, [])
  p.seeingUntil = m.now + FORESIGHT_MS
  assert.deepEqual(snapshot(m, p.id).soon, [idx(1, 1, 1)])
  assert.deepEqual(snapshot(m, m.players[1].id).soon, [], 'not to the other one')
})

test('a body mid-drop reports its progress so the client can draw it between floors', () => {
  const m = playing(2)
  const p = m.players[0]
  m.tiles[tileUnder(m, p)] = 'gone'
  resolveFalls(m)
  m.now += FALL_MS / 2
  const row = snapshot(m).players.find((q) => q.id === p.id)
  assert.ok(row.fall > 0.4 && row.fall < 0.6, `fall was ${row.fall}`)
})

test('a tick with nobody human standing hands the round back to waiting', () => {
  const m = playing(2)
  for (const p of m.players) p.bot = true
  tick(m, TICK_MS)
  assert.equal(m.phase, 'waiting')
})

test('a whole round runs to a winner without anything going NaN', () => {
  const m = createMatch()
  m.botFill = BOT_FILL_TO
  m.botsOnly = true
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  let n = 0
  const rng = () => ((n++ * 0.37) % 1)
  for (let k = 0; k < 20000 && m.phase !== 'over'; k++) tick(m, TICK_MS, rng)
  assert.equal(m.phase, 'over', 'the round ended')
  assert.ok(m.winner, 'and somebody won it, rather than everybody dying together')
  assert.equal(m.players.filter((p) => p.alive).length, 1, 'exactly one left standing')
  for (const p of m.players) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isInteger(p.z))
  }
})
