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
  startRound(m)
  m.nextCollapseAt = Infinity // tests collapse tiles by hand, never at random
  return m
}

test('a round hands pieces to at most four players, in join order', () => {
  const m = playing(5)
  assert.equal(m.players.filter((p) => p.playing).length, MAX_PLAYERS)
  assert.equal(m.players[4].playing, false, 'the fifth player spectates')
  assert.ok(m.players.slice(0, MAX_PLAYERS).every((p) => p.alive))
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
  const m = playing(5)
  const spectator = m.players[4]
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
  const m = playing(5)
  const spectator = m.players[4]
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
    ['alive', 'id', 'name', 'playing', 'x', 'y'],
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
