import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMatch,
  addPlayer,
  removePlayer,
  sanitizeName,
  move,
  startRound,
  SIZE,
  MOVE_COOLDOWN_MS,
  MAX_PLAYERS,
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
