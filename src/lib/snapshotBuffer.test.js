import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeBuffer } from './snapshotBuffer.js'

test('a buffer holds off until it has two frames to sit between', () => {
  const b = makeBuffer(100)
  assert.equal(b.sample(0), null)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  assert.equal(b.sample(0), null)
})

test('a body between two frames is drawn between the two positions', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 2, y: 0, z: 0, fall: 0 }] }, 100)
  // now 150, delay 100, so the render clock is at 50 — halfway.
  const s = b.sample(150)
  assert.ok(Math.abs(s.players[0].x - 1) < 1e-6, `x was ${s.players[0].x}`)
})

test('everything but the bodies comes from the newer frame, untouched', () => {
  const b = makeBuffer(100)
  b.push({ tiles: '...', phase: 'playing', players: [] }, 0)
  b.push({ tiles: '__.', phase: 'over', players: [] }, 100)
  const s = b.sample(150)
  assert.equal(s.tiles, '__.', 'tiles are never interpolated')
  assert.equal(s.phase, 'over')
})

test('a body that was not in the older frame is drawn where it is now', () => {
  const b = makeBuffer(100)
  b.push({ players: [] }, 0)
  b.push({ players: [{ id: 9, x: 5, y: 5, z: 1, fall: 0 }] }, 100)
  const s = b.sample(150)
  assert.equal(s.players[0].x, 5)
})

test('a body changing floor is not smeared through the floor between them', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0.9 }] }, 0)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 1, fall: 0 }] }, 100)
  const s = b.sample(150)
  assert.equal(s.players[0].z, 1, 'the landing is taken whole')
  assert.equal(s.players[0].fall, 0)
})

test('an old frame is dropped rather than kept forever', () => {
  const b = makeBuffer(100)
  for (let n = 0; n < 200; n++) b.push({ players: [] }, n * 33)
  assert.ok(b.size() <= 4, `held ${b.size()} frames`)
})
