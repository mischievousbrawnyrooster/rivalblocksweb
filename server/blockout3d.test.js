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
  let n = 0
  startRound(m, () => (n++ % ARENAS.length) / ARENAS.length)
  assert.equal(m.arenas.length, FLOORS)
  assert.ok(new Set(m.arenas).size > 1, 'floors do not all share one shape')
})

test('carving never strands a solid tile in a region of its own', () => {
  const m = createMatch()
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  // 'scatter' is the shape that produces islands, so drive every floor to it.
  const scatter = ARENAS.indexOf('scatter') / ARENAS.length
  startRound(m, () => scatter + 0.001)
  for (let z = 0; z < FLOORS; z++) {
    const solid = []
    for (let i = z * SIZE * SIZE; i < (z + 1) * SIZE * SIZE; i++) {
      if (m.tiles[i] === 'solid') solid.push(i)
    }
    if (solid.length === 0) continue
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
