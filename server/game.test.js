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
  usePowerup,
  POWERUP_MAX,
  POWERUP_KINDS,
  DASH_MS,
  DASH_COOLDOWN_MS,
  ARENAS,
  MIN_PLAYERS,
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
    ['alive', 'dashing', 'held', 'id', 'name', 'playing', 'shielded', 'wins', 'x', 'y'],
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

test('patch rebuilds every adjacent hole and nothing further away', () => {
  const m = playing(2)
  const p = m.players[0]
  m.tiles[0 * SIZE + 1] = 'gone'
  m.tiles[1 * SIZE + 0] = 'gone'
  m.tiles[0 * SIZE + 3] = 'gone'
  p.held = 'patch'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(m.tiles[0 * SIZE + 1], 'solid')
  assert.equal(m.tiles[1 * SIZE + 0], 'solid')
  assert.equal(m.tiles[0 * SIZE + 3], 'gone', 'two tiles away is untouched')
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
  assert.deepEqual(m.powerups, {})
  assert.equal(p.held, null)
  assert.equal(p.shielded, false)
  assert.equal(p.dashUntil, 0)
})

test('the snapshot carries powerups and per-player powerup state', () => {
  const m = playing(2)
  const p = m.players[0]
  p.held = 'shield'
  m.powerups[9] = 'dash'
  const s = snapshot(m)
  assert.deepEqual(s.powerups, { 9: 'dash' })
  assert.deepEqual(
    Object.keys(s.players[0]).sort(),
    ['alive', 'dashing', 'held', 'id', 'name', 'playing', 'shielded', 'wins', 'x', 'y'],
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
