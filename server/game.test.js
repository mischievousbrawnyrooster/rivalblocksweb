import test from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, addPlayer, removePlayer, sanitizeName, SIZE } from './game.js'

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
