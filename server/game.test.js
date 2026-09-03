import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMatch,
  addPlayer,
  removePlayer,
  sanitizeName,
  move,
  startRound,
  tick,
  snapshot,
  SIZE,
  TICK_MS,
  MOVE_COOLDOWN_MS,
  MAX_PLAYERS,
  COLLAPSE_COUNT,
  WARNING_MS,
  COUNTDOWN_MS,
  OVER_MS,
  ROUND_TARGET,
  usePowerup,
  POWERUP_MAX,
  POWERUP_KINDS,
  POWERUP_WEIGHTS,
  COLLAPSE_SHARE,
  COLLAPSE_EVERY_MS,
  COLLAPSE_FASTEST_MS,
  collapseDelay,
  waveSize,
  DASH_MS,
  DASH_COOLDOWN_MS,
  ARENAS,
  MIN_PLAYERS,
  BOT_FILL_TO,
  wantBots,
  BLINK_TILES,
  FORESIGHT_MS,
  canRun,
} from './game.js'

test('a new match is a full board with nobody on it', () => {
  const m = createMatch()
  assert.equal(m.phase, 'waiting')
  assert.equal(m.tiles.length, SIZE * SIZE)
  assert.ok(m.tiles.every((t) => t === 'solid'))
  assert.deepEqual(m.players, [])
  assert.equal(m.winner, null)
})

test('joining assigns rising ids and nobody has a piece yet', () => {
  const m = createMatch()
  const a = addPlayer(m, 'ada')
  const b = addPlayer(m, 'bo')
  assert.equal(a.id, 1)
  assert.equal(b.id, 2)
  assert.equal(a.playing, false)
  assert.equal(a.alive, false)
  assert.equal(m.players.length, 2)
})

test('leaving removes exactly one player and tolerates an unknown id', () => {
  const m = createMatch()
  const a = addPlayer(m, 'ada')
  addPlayer(m, 'bo')
  removePlayer(m, a.id)
  assert.deepEqual(m.players.map((p) => p.name), ['bo'])
  removePlayer(m, 999)
  assert.equal(m.players.length, 1)
})

test('names are trimmed, capped, stripped of control characters, never empty', () => {
  assert.equal(sanitizeName('  jiaqi  '), 'jiaqi')
  assert.equal(sanitizeName('jia qi'), 'jia qi', 'an inner space survives')
  assert.equal(sanitizeName('x'.repeat(40)).length, 16)
  assert.equal(sanitizeName('a' + String.fromCharCode(0) + 'bc'), 'abc')
  assert.equal(sanitizeName('a' + String.fromCharCode(127) + 'bc'), 'abc')
  assert.equal(sanitizeName(''), 'Player')
  assert.equal(sanitizeName('   '), 'Player')
  assert.equal(sanitizeName(null), 'Player')
  assert.equal(sanitizeName(undefined), 'Player')
  assert.equal(sanitizeName(42), '42')
})

test('an oversized name is bounded before the per-character work, not after', () => {
  assert.equal(sanitizeName('a'.repeat(10000)).length, 16)
})

/** A match in the `playing` phase with n players and no random collapses. */
function playing(n) {
  const m = createMatch()
  for (let i = 0; i < n; i++) addPlayer(m, `p${i}`)
  // rng 0 picks ARENAS[0] === 'square', so the board is full and spawns land
  // on their exact corners. Arena generation gets its own tests below.
  startRound(m, () => 0)
  // Tests place tiles and powerups by hand, never at random.
  m.nextCollapseAt = Infinity
  m.nextPowerupAt = Infinity
  return m
}

test('a round hands pieces up to capacity, in join order', () => {
  const m = playing(MAX_PLAYERS + 1)
  assert.equal(m.players.filter((p) => p.playing).length, MAX_PLAYERS)
  assert.equal(m.players[MAX_PLAYERS].playing, false, 'the one over capacity spectates')
  assert.ok(m.players.slice(0, MAX_PLAYERS).every((p) => p.alive))
})

test('every player in a full round gets a distinct spawn point', () => {
  const m = playing(MAX_PLAYERS)
  const seen = new Set(m.players.map((p) => `${p.x},${p.y}`))
  assert.equal(seen.size, MAX_PLAYERS, 'no two players share a tile at spawn')
  assert.ok(
    m.players.every((p) => p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE),
    'every spawn is on the board',
  )
})

test('a move off the grid is rejected', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.deepEqual([p.x, p.y], [0, 0])
  assert.equal(move(m, p.id, 'up'), false)
  assert.equal(move(m, p.id, 'left'), false)
  assert.deepEqual([p.x, p.y], [0, 0])
})

test('a move into a hole is rejected', () => {
  const m = playing(2)
  const p = m.players[0]
  m.tiles[0 * SIZE + 1] = 'gone'
  assert.equal(move(m, p.id, 'right'), false)
  assert.equal(p.x, 0)
})

test('a move onto another player is rejected', () => {
  const m = playing(2)
  const [a, b] = m.players
  b.x = 1
  b.y = 0
  assert.equal(move(m, a.id, 'right'), false)
  assert.equal(a.x, 0)
})

test('a legal move is applied', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.equal(move(m, p.id, 'right'), true)
  assert.deepEqual([p.x, p.y], [1, 0])
})

test('the move cooldown stops a client from teleporting', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.equal(move(m, p.id, 'right'), true)
  assert.equal(move(m, p.id, 'right'), false, 'second move in the same instant')
  m.now += MOVE_COOLDOWN_MS
  assert.equal(move(m, p.id, 'right'), true)
  assert.equal(p.x, 2)
})

test('moves are ignored outside the playing phase and for unknown ids', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.equal(move(m, 999, 'right'), false)
  assert.equal(move(m, p.id, 'sideways'), false)
  m.phase = 'over'
  assert.equal(move(m, p.id, 'right'), false)
})

test('an eliminated player cannot move', () => {
  const m = playing(2)
  const p = m.players[0]
  p.alive = false
  assert.equal(move(m, p.id, 'right'), false)
})

test('a spectator cannot move even in a legal direction', () => {
  const m = playing(MAX_PLAYERS + 1)
  const spectator = m.players[MAX_PLAYERS]
  assert.equal(spectator.playing, false)
  assert.equal(move(m, spectator.id, 'right'), false)
  assert.deepEqual([spectator.x, spectator.y], [0, 0])
})

test('inherited Object properties are not accepted as directions', () => {
  const m = playing(2)
  const p = m.players[0]
  const [x0, y0] = [p.x, p.y]
  for (const dir of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
    assert.equal(move(m, p.id, dir), false, `${dir} must be rejected`)
    assert.deepEqual([p.x, p.y], [x0, y0], `${dir} must not move the player`)
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), `${dir} must not leave NaN position`)
  }
})

/** Drops the tile under a player and ticks once so it resolves. */
function collapseUnder(m, p) {
  const i = p.y * SIZE + p.x
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now
  tick(m, TICK_MS)
}

test('one player is not enough to start; a second one starts the countdown', () => {
  const m = createMatch()
  addPlayer(m, 'ada')
  tick(m, TICK_MS)
  assert.equal(m.phase, 'waiting')
  addPlayer(m, 'bo')
  tick(m, TICK_MS)
  assert.equal(m.phase, 'countdown')
  tick(m, COUNTDOWN_MS)
  assert.equal(m.phase, 'playing')
})

test('the countdown aborts if players leave before it finishes', () => {
  const m = createMatch()
  const a = addPlayer(m, 'ada')
  addPlayer(m, 'bo')
  tick(m, TICK_MS)
  assert.equal(m.phase, 'countdown')
  removePlayer(m, a.id)
  tick(m, TICK_MS)
  assert.equal(m.phase, 'waiting')
})

test('a collapse wave marks solid tiles as warning, not gone', () => {
  const m = playing(2)
  m.nextCollapseAt = m.now
  tick(m, TICK_MS, () => 0)
  assert.equal(m.tiles.filter((t) => t === 'warn').length, COLLAPSE_COUNT)
  assert.equal(m.tiles.filter((t) => t === 'gone').length, 0)
})

test('a warning tile falls away after the warning delay', () => {
  const m = playing(2)
  m.tiles[40] = 'warn'
  m.warnAt[40] = m.now + WARNING_MS
  tick(m, WARNING_MS - TICK_MS)
  assert.equal(m.tiles[40], 'warn', 'still standing before the delay elapses')
  tick(m, TICK_MS)
  assert.equal(m.tiles[40], 'gone')
})

test('a player on a tile that falls away is eliminated', () => {
  const m = playing(3)
  const p = m.players[0]
  collapseUnder(m, p)
  assert.equal(m.tiles[p.y * SIZE + p.x], 'gone')
  assert.equal(p.alive, false)
  assert.equal(m.phase, 'playing', 'two are still standing')
})

test('the last player standing wins and the round ends', () => {
  const m = playing(2)
  const [a, b] = m.players
  collapseUnder(m, a)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, b.name)
})

test('a mutual wipeout ends the round with no winner', () => {
  const m = playing(2)
  for (const p of m.players) {
    const i = p.y * SIZE + p.x
    m.tiles[i] = 'warn'
    m.warnAt[i] = m.now
  }
  tick(m, TICK_MS)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, null)
})

test('a player who disconnects mid-round hands the win to the survivor', () => {
  const m = playing(2)
  const [a, b] = m.players
  removePlayer(m, a.id)
  tick(m, TICK_MS)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, b.name)
})

test('a spectator gets a piece in the next round', () => {
  const m = playing(MAX_PLAYERS + 1)
  const spectator = m.players[MAX_PLAYERS]
  assert.equal(spectator.playing, false)
  removePlayer(m, m.players[0].id)
  for (const p of m.players.filter((q) => q.playing && q.alive).slice(1)) {
    collapseUnder(m, p)
  }
  assert.equal(m.phase, 'over')
  tick(m, OVER_MS)
  assert.equal(m.phase, 'countdown')
  tick(m, COUNTDOWN_MS)
  assert.equal(m.phase, 'playing')
  assert.equal(spectator.playing, true)
})

test('an emptied match falls back to waiting instead of restarting', () => {
  const m = playing(2)
  const [a, b] = m.players
  collapseUnder(m, a)
  removePlayer(m, b.id)
  tick(m, OVER_MS)
  assert.equal(m.phase, 'waiting')
  assert.equal(m.winner, null)
})

test('the snapshot carries everything a client needs and nothing private', () => {
  const m = playing(2)
  const s = snapshot(m)
  assert.equal(s.t, 'state')
  assert.equal(s.phase, 'playing')
  assert.equal(s.size, SIZE)
  assert.equal(s.tiles.length, SIZE * SIZE)
  assert.equal(s.players.length, 2)
  assert.deepEqual(
    Object.keys(s.players[0]).sort(),
    ['alive', 'bot', 'dashing', 'held', 'id', 'name', 'playing', 'seeing', 'shielded', 'wins', 'x', 'y'],
    'lastMoveAt and dashUntil stay server-side',
  )
  assert.equal(s.winner, null)
})

test('the snapshot counts down the seconds for timed phases', () => {
  const m = createMatch()
  addPlayer(m, 'ada')
  addPlayer(m, 'bo')
  tick(m, TICK_MS)
  assert.equal(snapshot(m).secs, Math.ceil(COUNTDOWN_MS / 1000))
})

test('winning a round increments only the winner, and only once', () => {
  const m = playing(3)
  const [a, b, c] = m.players
  assert.deepEqual(m.players.map((p) => p.wins), [0, 0, 0])

  collapseUnder(m, b)
  assert.equal(m.phase, 'playing', 'two still standing')
  collapseUnder(m, c)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, a.name)
  assert.deepEqual(m.players.map((p) => p.wins), [1, 0, 0])

  // Sitting in `over` for a while must not keep crediting the winner.
  tick(m, TICK_MS)
  tick(m, TICK_MS)
  assert.deepEqual(m.players.map((p) => p.wins), [1, 0, 0])
})

test('wins accumulate across rounds', () => {
  const m = playing(2)
  const [a, b] = m.players
  collapseUnder(m, b)
  assert.equal(m.winner, a.name)

  tick(m, OVER_MS)
  tick(m, COUNTDOWN_MS)
  assert.equal(m.phase, 'playing', 'a fresh round started')
  m.nextCollapseAt = Infinity
  collapseUnder(m, b)
  assert.equal(m.winner, a.name)
  assert.equal(a.wins, 2)
  assert.equal(b.wins, 0)
})

test('a mutual wipeout credits nobody', () => {
  const m = playing(2)
  for (const p of m.players) {
    const i = p.y * SIZE + p.x
    m.tiles[i] = 'warn'
    m.warnAt[i] = m.now
  }
  tick(m, TICK_MS)
  assert.equal(m.winner, null)
  assert.deepEqual(m.players.map((p) => p.wins), [0, 0])
})

// ---------- Powerups ----------

test('walking onto a powerup picks it up; a full hand leaves it on the floor', () => {
  const m = playing(2)
  const p = m.players[0]
  m.powerups[0 * SIZE + 1] = 'dash'
  assert.equal(move(m, p.id, 'right'), true)
  assert.equal(p.held, 'dash')
  assert.equal(Object.hasOwn(m.powerups, 0 * SIZE + 1), false, 'taken off the board')

  m.powerups[0 * SIZE + 2] = 'shield'
  m.now += MOVE_COOLDOWN_MS
  assert.equal(move(m, p.id, 'right'), true)
  assert.equal(p.held, 'dash', 'the held powerup is not replaced')
  assert.equal(m.powerups[0 * SIZE + 2], 'shield', 'it stays for someone else')
})

test('using an empty hand does nothing', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.equal(p.held, null)
  assert.equal(usePowerup(m, p.id), false)
})

test('a shield absorbs one collapse and shoves you to safety', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'shield'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(p.shielded, true)
  assert.equal(p.held, null, 'spending it empties the hand')

  collapseUnder(m, p)
  assert.equal(p.alive, true, 'survived')
  assert.equal(p.shielded, false, 'shield is consumed')
  assert.deepEqual([p.x, p.y], [0, 1], 'shoved to the adjacent solid tile')
})

test('a shield with nowhere to shove you is still spent, and you die', () => {
  const m = playing(2)
  const p = m.players[0]
  p.shielded = true
  m.tiles[1 * SIZE + 0] = 'gone'
  m.tiles[0 * SIZE + 1] = 'gone'
  collapseUnder(m, p)
  assert.equal(p.alive, false)
  assert.equal(p.shielded, false)
})

test('dash lets you move once per tick instead of once every two', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'dash'
  usePowerup(m, p.id)

  assert.equal(move(m, p.id, 'right'), true)
  m.now += TICK_MS
  assert.equal(move(m, p.id, 'right'), true, 'one tick is enough while dashing')
  assert.equal(p.x, 2)

  // Same elapsed time without dash is rejected.
  p.dashUntil = 0
  m.now += TICK_MS
  assert.equal(move(m, p.id, 'right'), false)
})

test('dash expires', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'dash'
  usePowerup(m, p.id)
  assert.ok(m.now < p.dashUntil)
  m.now += DASH_MS
  assert.equal(move(m, p.id, 'right'), true)
  m.now += TICK_MS
  assert.equal(move(m, p.id, 'right'), false, 'back to the normal cooldown')
})

test('patch rebuilds the whole three by three it is used in, corners included', () => {
  const m = playing(2)
  const p = m.players[0]
  // Spawn is a corner, so stand somewhere with room on every side.
  p.x = 5
  p.y = 5

  for (let y = 4; y <= 6; y++) {
    for (let x = 4; x <= 6; x++) {
      if (x === 5 && y === 5) continue // the tile they are stood on
      m.tiles[y * SIZE + x] = 'gone'
    }
  }
  // And a ring of holes one step further out, to prove where it stops.
  m.tiles[5 * SIZE + 7] = 'gone'
  m.tiles[3 * SIZE + 5] = 'gone'
  m.tiles[3 * SIZE + 3] = 'gone'

  p.held = 'patch'
  assert.equal(usePowerup(m, p.id), true)

  for (let y = 4; y <= 6; y++) {
    for (let x = 4; x <= 6; x++) {
      assert.equal(m.tiles[y * SIZE + x], 'solid', `${x},${y} was left as a hole`)
    }
  }
  assert.equal(m.tiles[5 * SIZE + 7], 'gone', 'two tiles across is untouched')
  assert.equal(m.tiles[3 * SIZE + 5], 'gone', 'two tiles up is untouched')
  assert.equal(m.tiles[3 * SIZE + 3], 'gone', 'a diagonal two away is untouched')
})

test('patch at the edge of the board rebuilds what it can and does not reach off it', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 0
  p.y = 0
  m.tiles[0 * SIZE + 1] = 'gone'
  m.tiles[1 * SIZE + 0] = 'gone'
  m.tiles[1 * SIZE + 1] = 'gone'

  p.held = 'patch'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(m.tiles[0 * SIZE + 1], 'solid')
  assert.equal(m.tiles[1 * SIZE + 0], 'solid')
  assert.equal(m.tiles[1 * SIZE + 1], 'solid', 'the corner was missed')
})

test('sinkhole flags the nearest living opponent, not the furthest', () => {
  const m = playing(3)
  const [a, , c] = m.players
  assert.deepEqual([c.x, c.y], [SIZE - 1, 0], 'nearest to the origin spawn')
  a.held = 'sinkhole'
  assert.equal(usePowerup(m, a.id), true)
  assert.equal(m.tiles[c.y * SIZE + c.x], 'warn')
  assert.equal(m.tiles[m.players[1].y * SIZE + m.players[1].x], 'solid', 'the far one is spared')
})

test('sinkhole with no living opponent is a no-op, not a crash', () => {
  const m = playing(2)
  const [a, b] = m.players
  b.alive = false
  a.held = 'sinkhole'
  assert.equal(usePowerup(m, a.id), true)
  assert.equal(m.tiles.filter((t) => t === 'warn').length, 0)
})

test('powerups spawn during play and stop at the cap', () => {
  const m = playing(2)
  for (let i = 0; i < POWERUP_MAX + 3; i++) {
    m.nextPowerupAt = m.now
    tick(m, TICK_MS, () => 0)
  }
  assert.equal(Object.keys(m.powerups).length, POWERUP_MAX)
  assert.ok(Object.values(m.powerups).every((k) => POWERUP_KINDS.includes(k)))
})

test('a powerup on a collapsing tile goes down with it', () => {
  const m = playing(2)
  const i = 5 * SIZE + 5
  m.powerups[i] = 'shield'
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now
  tick(m, TICK_MS)
  assert.equal(m.tiles[i], 'gone')
  assert.equal(Object.hasOwn(m.powerups, i), false)
})

test('a new round clears the board of powerups and everything held', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'dash'
  p.shielded = true
  p.dashUntil = m.now + DASH_MS
  m.powerups[7] = 'patch'

  startRound(m)
  assert.equal(Object.hasOwn(m.powerups, 7), false, 'last round’s powerup survived')
  assert.equal(
    Object.keys(m.powerups).length,
    1,
    'a round starts with exactly one on the floor, and it is not the old one',
  )
  assert.equal(p.held, null)
  assert.equal(p.shielded, false)
  assert.equal(p.dashUntil, 0)
})

test('the snapshot carries powerups and per-player powerup state', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'shield'
  m.powerups = { 9: 'dash' } // in place of whatever the round laid out
  const s = snapshot(m)
  assert.deepEqual(s.powerups, { 9: 'dash' })
  assert.deepEqual(
    Object.keys(s.players[0]).sort(),
    ['alive', 'bot', 'dashing', 'held', 'id', 'name', 'playing', 'seeing', 'shielded', 'wins', 'x', 'y'],
  )
  assert.equal(s.players[0].held, 'shield')
  assert.equal(s.players[0].dashing, false)
})

test('powerups cannot be used outside the playing phase', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'dash'
  m.phase = 'over'
  assert.equal(usePowerup(m, p.id), false)
  assert.equal(p.held, 'dash', 'and the powerup is not consumed')
})

// ---------- Arena generation ----------

/** Forces one specific arena, bypassing the random pick in startRound. */
function withArena(name, n = MAX_PLAYERS) {
  const idx = ARENAS.indexOf(name)
  assert.notEqual(idx, -1, `${name} must be a known arena`)
  const m = createMatch()
  for (let i = 0; i < n; i++) addPlayer(m, `p${i}`)
  // First rng call picks the arena. Later calls only matter to `scatter`, and
  // must actually vary — a constant above its pit threshold carves nothing.
  let calls = 0
  startRound(m, () => {
    if (calls++ === 0) return idx / ARENAS.length
    return ((calls * 9301 + 49297) % 233280) / 233280
  })
  return m
}

test('every arena is playable: connected, roomy, and spawns everyone on solid ground', () => {
  for (const name of ARENAS) {
    const m = withArena(name)
    assert.equal(m.arena, name, `${name}: startRound recorded the wrong arena`)

    const solid = m.tiles.filter((t) => t === 'solid').length
    assert.ok(solid >= SIZE * 4, `${name}: only ${solid} tiles, too cramped to play`)

    const seats = new Set()
    for (const p of m.players) {
      const i = p.y * SIZE + p.x
      assert.equal(m.tiles[i], 'solid', `${name}: ${p.name} spawned inside a hole`)
      assert.equal(seats.has(i), false, `${name}: two players share a spawn tile`)
      seats.add(i)
    }

    // Every solid tile must be reachable from any player's spawn, or someone
    // is marooned on an island and the round can never resolve.
    const start = m.players[0].y * SIZE + m.players[0].x
    const seen = new Set([start])
    const queue = [start]
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h]
      const x = i % SIZE
      const y = (i / SIZE) | 0
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
        const j = ny * SIZE + nx
        if (seen.has(j) || m.tiles[j] !== 'solid') continue
        seen.add(j)
        queue.push(j)
      }
    }
    assert.equal(seen.size, solid, `${name}: ${solid - seen.size} tiles are unreachable`)
  }
})

test('the carved arenas are actually different shapes, not all squares', () => {
  const square = withArena('square').tiles.filter((t) => t === 'solid').length
  assert.equal(square, SIZE * SIZE, 'square fills the whole grid')
  for (const name of ARENAS.filter((a) => a !== 'square')) {
    const solid = withArena(name).tiles.filter((t) => t === 'solid').length
    assert.ok(solid < square, `${name} should carve something away, kept ${solid}`)
  }
})

test('a ring is hollow in the middle and a disc is not', () => {
  const centre = Math.floor((SIZE - 1) / 2) * SIZE + Math.floor((SIZE - 1) / 2)
  assert.equal(withArena('ring').tiles[centre], 'gone')
  assert.equal(withArena('disc').tiles[centre], 'solid')
  assert.equal(withArena('disc').tiles[0], 'gone', 'a disc has no corners')
})

test('a fresh round can pick a different arena than the last one', () => {
  const m = createMatch()
  for (let i = 0; i < MIN_PLAYERS; i++) addPlayer(m, `p${i}`)
  const seen = new Set()
  for (let i = 0; i < ARENAS.length; i++) {
    startRound(m, () => i / ARENAS.length)
    seen.add(m.arena)
  }
  assert.equal(seen.size, ARENAS.length, 'every arena is reachable from the picker')
})

test('the snapshot names the arena so the client can show it', () => {
  assert.equal(snapshot(withArena('cross')).arena, 'cross')
})

test('no spawn is a dead-end spike with a single exit', () => {
  for (const name of ARENAS) {
    const m = withArena(name)
    for (const p of m.players) {
      let exits = 0
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nx = p.x + dx
        const ny = p.y + dy
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
        if (m.tiles[ny * SIZE + nx] === 'solid') exits++
      }
      assert.ok(exits >= 2, `${name}: ${p.name} spawned at ${p.x},${p.y} with only ${exits} exit(s)`)
    }
  }
})


// --- bots -----------------------------------------------------------------

test('nothing runs in an empty room, and an operator can lift that', () => {
  const m = createMatch()
  m.botFill = BOT_FILL_TO

  for (let i = 0; i < 5; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.players.length, 0, 'bots took the board with nobody watching')
  assert.equal(m.phase, 'waiting')
  assert.equal(canRun(m), false)

  // Somebody arrives; the lobby is held for them to decide.
  const person = addPlayer(m, 'someone')
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.players.length, 1, 'bots arrived without being asked for')
  assert.equal(m.phase, 'waiting')

  wantBots(m)
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.ok(m.players.filter((p) => p.bot).length > 0, 'asking for bots got none')
  assert.equal(m.phase, 'countdown')

  removePlayer(m, person.id)
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'waiting', 'the bots carried on to an empty room')
  assert.equal(m.players.length, 0)
  assert.equal(m.botsWanted, false)

  m.botsOnly = true
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.players.length, BOT_FILL_TO)
  assert.equal(snapshot(m).botsOnly, true)
})

test('two people start a round between them, with no bots involved', () => {
  const m = createMatch()
  m.botFill = BOT_FILL_TO
  addPlayer(m, 'one')
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'waiting', 'a lone player was dropped straight into a round')

  addPlayer(m, 'two')
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'countdown')
  assert.equal(m.players.filter((p) => p.bot).length, 0, 'bots joined an uninvited round')
})

test('a person always displaces a bot rather than sitting behind one', () => {
  const m = createMatch()
  m.botFill = MAX_PLAYERS
  addPlayer(m, 'host')
  wantBots(m)
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.players.length, MAX_PLAYERS)

  const late = addPlayer(m, 'late')
  assert.ok(late, 'a person was turned away from a board full of bots')
  assert.equal(late.bot, false)
  assert.equal(m.players.length, MAX_PLAYERS, 'the board overflowed')
})

test('bots keep off tiles that have been flagged', () => {
  const m = createMatch()
  m.botFill = 3
  addPlayer(m, 'watcher')
  wantBots(m)
  // Run a whole round and count how often a bot is caught standing on a tile
  // that had already been flagged when it last had a chance to move.
  let caught = 0
  let chances = 0
  for (let i = 0; i < 900; i++) {
    tick(m, TICK_MS, () => 0.5)
    if (m.phase !== 'playing') continue
    for (const b of m.players) {
      if (!b.bot || !b.alive || !b.playing) continue
      chances++
      if (m.tiles[b.y * SIZE + b.x] === 'warn') caught++
    }
  }
  assert.ok(chances > 100, 'the round never really ran')
  assert.ok(caught / chances < 0.25, `bots sat on flagged ground ${Math.round((caught / chances) * 100)}% of the time`)
})

test('a bot plays by every rule a person does', () => {
  const m = createMatch()
  m.botFill = 4
  addPlayer(m, 'watcher')
  wantBots(m)
  for (let i = 0; i < 600; i++) {
    tick(m, TICK_MS, () => 0.5)
    for (const p of m.players) {
      if (!p.playing || !p.alive) continue
      assert.notEqual(m.tiles[p.y * SIZE + p.x], 'gone', `${p.name} is standing on a hole`)
      assert.ok(p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE, `${p.name} left the board`)
    }
    // And never two pieces on one tile.
    const on = m.players.filter((p) => p.playing && p.alive).map((p) => p.y * SIZE + p.x)
    assert.equal(new Set(on).size, on.length, 'two pieces share a tile')
  }
})


// --- the wider kit --------------------------------------------------------

test('a blink clears a hole, and lands somewhere you could stand', () => {
  const m = playing(2)
  const p = m.players[0]
  // A clean lane east with a hole in the middle of it.
  p.x = 4
  p.y = 7
  p.face = [1, 0]
  for (let x = 4; x <= 4 + BLINK_TILES; x++) m.tiles[7 * SIZE + x] = 'solid'
  m.tiles[7 * SIZE + 5] = 'gone'
  m.tiles[7 * SIZE + 6] = 'gone'
  m.players[1].x = 0
  m.players[1].y = 0

  p.held = 'blink'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(p.x, 4 + BLINK_TILES, `landed at ${p.x}`)
  assert.equal(p.y, 7)
  assert.equal(m.tiles[p.y * SIZE + p.x], 'solid', 'landed on something that is not there')
})

test('a blink into nothing is refused rather than fatal', () => {
  const m = playing(2)
  const p = m.players[0]
  p.x = 4
  p.y = 7
  p.face = [1, 0]
  for (let n = 1; n <= BLINK_TILES; n++) m.tiles[7 * SIZE + 4 + n] = 'gone'
  m.players[1].x = 0
  m.players[1].y = 0

  p.held = 'blink'
  assert.equal(usePowerup(m, p.id), false)
  assert.equal(p.held, 'blink', 'a refused blink ate the pickup')
  assert.equal(p.x, 4, 'a refused blink still moved them')
})

test('a swap trades places with the nearest rival', () => {
  const m = playing(3)
  const [p, near, far] = m.players
  p.x = 2
  p.y = 2
  near.x = 4
  near.y = 2
  far.x = 12
  far.y = 12

  p.held = 'swap'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(p.x, 4, 'did not take their place')
  assert.equal(p.y, 2)
  assert.equal(near.x, 2, 'they did not take yours')
  assert.equal(near.y, 2)
  assert.equal(far.x, 12, 'the wrong rival was moved')
})

test('a swap with nobody left is refused rather than wasted', () => {
  const m = playing(2)
  const [p, other] = m.players
  other.alive = false
  p.held = 'swap'
  assert.equal(usePowerup(m, p.id), false)
  assert.equal(p.held, 'swap')
})

test('the next wave is chosen before it lands, and only a seer is told', () => {
  const m = playing(2)
  assert.ok(m.nextWave.length > 0, 'no wave was lined up')
  assert.ok(
    m.nextWave.every((i) => m.tiles[i] === 'solid'),
    'a wave was lined up on ground that is already gone',
  )

  // Nobody sees it by default, whoever asks.
  assert.deepEqual(snapshot(m).soon, [])
  assert.deepEqual(snapshot(m, m.players[0].id).soon, [])

  const p = m.players[0]
  p.held = 'foresight'
  usePowerup(m, p.id)
  assert.deepEqual(snapshot(m, p.id).soon, m.nextWave, 'a seer was told nothing')
  assert.deepEqual(snapshot(m, m.players[1].id).soon, [], 'somebody else was told')
  assert.deepEqual(snapshot(m).soon, [], 'the shared frame carried it')

  m.now += FORESIGHT_MS
  assert.deepEqual(snapshot(m, p.id).soon, [], 'foresight never wore off')
})

test('the wave that lands is the wave that was promised', () => {
  const m = playing(2)
  const promised = [...m.nextWave]
  m.nextCollapseAt = m.now
  tick(m, TICK_MS, () => 0.5)

  for (const i of promised) {
    assert.notEqual(m.tiles[i], 'solid', `${i} was promised and never flagged`)
  }
  assert.notDeepEqual(m.nextWave, promised, 'the following wave was never lined up')
})


test('a round names its winner and identifies them', () => {
  const m = playing(3)
  const [a, b, c] = m.players
  b.alive = false
  c.alive = false
  tick(m, TICK_MS, () => 0.5)

  assert.equal(m.phase, 'over')
  assert.equal(m.winner, a.name)
  assert.equal(m.winnerId, a.id, 'the winner was named but not identified')
  assert.equal(snapshot(m).winnerId, a.id)
  assert.equal(a.wins, 1)

  // And it does not leak into the next round.
  m.now += OVER_MS
  tick(m, TICK_MS, () => 0.5)
  assert.equal(snapshot(m).winnerId, null, 'last round’s winner carried over')
})

test('taking the round target takes the match, and says so', () => {
  const m = playing(3)
  const [a, b, c] = m.players

  // Every round but the last: a win, and the match is still running.
  for (let n = 1; n < ROUND_TARGET; n++) {
    b.alive = false
    c.alive = false
    tick(m, TICK_MS, () => 0.5)
    assert.equal(m.phase, 'over')
    assert.equal(a.wins, n)
    assert.equal(m.final, false, `the match ended after ${n} of ${ROUND_TARGET} rounds`)
    assert.equal(snapshot(m).final, false)
    m.now += OVER_MS
    tick(m, TICK_MS, () => 0.5)
    m.now += COUNTDOWN_MS
    tick(m, TICK_MS, () => 0.5)
    assert.equal(m.phase, 'playing')
    for (const p of m.players) p.alive = true
  }

  b.alive = false
  c.alive = false
  tick(m, TICK_MS, () => 0.5)
  assert.equal(a.wins, ROUND_TARGET)
  assert.equal(m.final, true, 'the round target came and went without ending the match')
  assert.equal(m.winnerId, a.id)
  assert.equal(snapshot(m).target, ROUND_TARGET)
})

test('a finished match starts the next one from nothing', () => {
  const m = playing(2)
  const [a, b] = m.players
  a.wins = ROUND_TARGET - 1
  b.wins = 1
  b.alive = false
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.final, true)

  m.now += OVER_MS
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'countdown')
  assert.equal(m.final, false, 'the new match started already finished')
  assert.ok(
    m.players.every((p) => p.wins === 0),
    'the last match’s rounds were carried into the new one',
  )
})

test('a round nobody survives is credited to nobody', () => {
  const m = playing(2)
  for (const p of m.players) p.alive = false
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, null)
  assert.equal(m.winnerId, null)
  assert.ok(m.players.every((p) => p.wins === 0), 'a mutual loss was scored as a win')
})

test('a round started with nobody to play against is not a round anybody won', () => {
  const m = createMatch()
  m.botFill = BOT_FILL_TO
  const solo = addPlayer(m, 'solo')
  wantBots(m)

  // What the operator console's restart and arena buttons do. Bots are seated
  // by the tick, not by this call, so right now there is one participant.
  startRound(m)
  assert.notEqual(m.phase, 'playing', 'a round started with one player in it')

  tick(m, TICK_MS, () => 0.5)
  assert.equal(solo.wins, 0, 'a round was awarded before anybody had played')
  assert.equal(m.winner, null)
  assert.equal(m.final, false)

  // The bots arrive and it gets going on its own.
  assert.ok(m.players.length >= MIN_PLAYERS, 'the bots never arrived')
  assert.equal(m.phase, 'countdown')
})

test('every round has something to pick up from the first tick', () => {
  // Rounds here are over in ten or fifteen seconds. Waiting a full interval
  // for the first pickup left four rounds in ten with nothing on the board at
  // any point, which is a kit nobody ever touched.
  for (let seed = 1; seed <= 12; seed++) {
    const m = createMatch()
    addPlayer(m, 'a')
    addPlayer(m, 'b')
    let n = seed
    startRound(m, () => {
      n = (n * 1103515245 + 12345) % 2147483648
      return n / 2147483648
    })
    const on = Object.keys(m.powerups)
    assert.equal(on.length, 1, `round ${seed} started with ${on.length} powerups`)
    assert.equal(m.tiles[Number(on[0])], 'solid', 'a powerup was laid over the void')
    assert.ok(
      POWERUP_KINDS.includes(m.powerups[on[0]]),
      `unknown powerup ${m.powerups[on[0]]}`,
    )
  }
})

test('a wave takes less of the board as less of it is left', () => {
  // A full board still gets a full wave: the opening is unchanged.
  assert.equal(waveSize(SIZE * SIZE), COLLAPSE_COUNT)
  assert.equal(waveSize(Math.ceil(COLLAPSE_COUNT / COLLAPSE_SHARE)), COLLAPSE_COUNT)

  // And it tapers rather than clearing the last of it in one go.
  assert.ok(waveSize(20) < COLLAPSE_COUNT, 'twenty tiles left still took a full wave')
  assert.equal(waveSize(1), 1)
  assert.equal(waveSize(0), 1, 'a wave has to take at least one, or a round never ends')

  // Never sudden: fewer tiles left never means a bigger wave.
  let last = 0
  for (let n = 0; n <= SIZE * SIZE; n++) {
    const w = waveSize(n)
    assert.ok(w >= 1 && w <= COLLAPSE_COUNT, `wave of ${w} at ${n} tiles`)
    assert.ok(w >= last, `the wave grew as the board shrank, at ${n} tiles`)
    last = w
  }
})

test('a round opens with a full wave and ends one tile at a time', () => {
  const m = playing(2)
  // The helper freezes the collapse so other tests can place tiles by hand.
  // This one is about the collapse, so it runs.
  m.nextCollapseAt = m.now + COLLAPSE_EVERY_MS
  const seen = []
  for (let i = 0; i < 400; i++) {
    const solid = m.tiles.filter((t) => t === 'solid').length
    if (solid === 0) break
    seen.push({ solid, wave: [...m.nextWave] })
    // The round ends the moment one player is last standing, and the floor
    // stops moving with it. This test is about the floor, so put everyone back
    // on their feet and keep it running.
    for (const p of m.players) p.alive = true
    m.phase = 'playing'
    m.now += COLLAPSE_EVERY_MS
    tick(m, TICK_MS, () => 0.5)
  }

  const opening = seen[0]
  const ending = seen[seen.length - 1]
  assert.equal(opening.wave.length, COLLAPSE_COUNT, 'the round did not open at full pace')
  assert.ok(ending.solid < opening.solid, 'the board never shrank')
  assert.equal(ending.wave.length, 1, `the last wave still took ${ending.wave.length} at once`)
})

test('a wave is drawn from the whole floor, never clustered together', () => {
  // Tiles that fall as one connected lump are something you step around; the
  // point of this game is that they are not. Guards against grouping being
  // reintroduced as a "readability" improvement.
  const m = playing(2)
  m.nextCollapseAt = m.now + COLLAPSE_EVERY_MS
  let scattered = 0
  let multi = 0

  for (let i = 0; i < 60; i++) {
    const wave = m.nextWave
    if (wave.length > 1) {
      multi += 1
      const apart = wave.some((a) =>
        wave.every((b) => a === b || Math.abs((a % SIZE) - (b % SIZE)) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) > 1),
      )
      if (apart) scattered += 1
    }
    for (const p of m.players) p.alive = true
    m.phase = 'playing'
    m.now += COLLAPSE_EVERY_MS
    tick(m, TICK_MS, () => 0.5)
  }

  assert.ok(multi > 5, 'not enough multi-tile waves to judge')
  assert.ok(scattered > multi / 2, `only ${scattered} of ${multi} waves were spread across the board`)
})

test('waves come faster as the floor runs out', () => {
  const full = collapseDelay(SIZE * SIZE)
  assert.equal(full, COLLAPSE_EVERY_MS, 'a full board should keep the opening pace')
  assert.equal(collapseDelay(0), COLLAPSE_FASTEST_MS)

  // Never slower as the board shrinks, and never outside the two ends.
  let last = COLLAPSE_EVERY_MS + 1
  for (let n = SIZE * SIZE; n >= 0; n--) {
    const d = collapseDelay(n)
    assert.ok(d >= COLLAPSE_FASTEST_MS && d <= COLLAPSE_EVERY_MS, `gap of ${d} at ${n} tiles`)
    assert.ok(d <= last, `the gap grew as the board shrank, at ${n} tiles`)
    last = d
  }

  // A single tile arriving on the opening clock is what made the endgame drag.
  assert.ok(
    collapseDelay(10) < COLLAPSE_EVERY_MS / 2,
    'the last tiles still come at half the opening pace or slower',
  )
})

test('a patch comes up more often than the rest of the kit, and nothing is missing', () => {
  // The square arena is a full board, so every tile is somewhere a powerup
  // can land.
  const m = playing(2)
  const seen = Object.fromEntries(POWERUP_KINDS.map((k) => [k, 0]))

  // Straight through the bag many times over, so the shares settle.
  let n = 7
  const rng = () => {
    n = (n * 1103515245 + 12345) % 2147483648
    return n / 2147483648
  }
  for (let i = 0; i < 4000; i++) {
    m.powerups = {}
    m.nextPowerupAt = m.now
    tick(m, TICK_MS, rng)
    for (const kind of Object.values(m.powerups)) seen[kind] += 1
  }

  const total = Object.values(seen).reduce((a, b) => a + b, 0)
  assert.ok(total > 1000, `only ${total} powerups drawn, too few to judge`)
  for (const kind of POWERUP_KINDS) {
    assert.ok(seen[kind] > 0, `${kind} never came up at all`)
  }

  const share = seen.patch / total
  const others = POWERUP_KINDS.filter((k) => k !== 'patch').map((k) => seen[k] / total)
  assert.ok(
    others.every((s) => share > s * 1.5),
    `a patch came up ${(share * 100).toFixed(0)}% of the time, no oftener than the rest`,
  )

  // Roughly its weight out of the whole bag, give or take the draw.
  const weight = POWERUP_WEIGHTS.patch
  const bag = POWERUP_KINDS.length - 1 + weight
  assert.ok(
    Math.abs(share - weight / bag) < 0.06,
    `a patch came up ${(share * 100).toFixed(0)}%, not the ${((weight / bag) * 100).toFixed(0)}% its weight asks for`,
  )
})
