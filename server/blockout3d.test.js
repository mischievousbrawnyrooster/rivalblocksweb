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
