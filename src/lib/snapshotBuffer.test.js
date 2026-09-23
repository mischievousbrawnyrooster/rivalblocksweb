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
  assert.ok(b.size() <= 8, `held ${b.size()} frames`)
})

test('the live player comes from the newest frame, everyone else is smoothed', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }, { id: 2, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 2, y: 0, z: 0, fall: 0 }, { id: 2, x: 2, y: 0, z: 0, fall: 0 }] }, 100)
  const s = b.sample(150, 1)
  const live = s.players.find((p) => p.id === 1)
  const other = s.players.find((p) => p.id === 2)
  assert.equal(live.x, 2, 'the live player is where the server last put them')
  assert.ok(Math.abs(other.x - 1) < 1e-6, 'everyone else is still halfway')
})

test('an unknown or absent live id changes nothing', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 2, y: 0, z: 0, fall: 0 }] }, 100)
  const none = b.sample(150)
  const wrong = b.sample(150, 99)
  assert.ok(Math.abs(none.players[0].x - 1) < 1e-6)
  assert.deepEqual(wrong.players, none.players)
})

test('the live player comes from the newest buffer frame, not the delayed bracket', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }, { id: 2, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 10, y: 0, z: 0, fall: 0 }, { id: 2, x: 10, y: 0, z: 0, fall: 0 }] }, 50)
  b.push({ players: [{ id: 1, x: 20, y: 0, z: 0, fall: 0 }, { id: 2, x: 20, y: 0, z: 0, fall: 0 }] }, 100)
  b.push({ players: [{ id: 1, x: 30, y: 0, z: 0, fall: 0 }, { id: 2, x: 30, y: 0, z: 0, fall: 0 }] }, 150)
  const s = b.sample(150, 1)
  const live = s.players.find((p) => p.id === 1)
  const other = s.players.find((p) => p.id === 2)
  assert.equal(live.x, 30, 'live player comes from the newest frame at 150, not the delayed bracket at 100')
  assert.equal(other.x, 10, 'other player is rendered at the replay clock (50ms)')
})

test('the live player comes from newest frame while another player interpolates between earlier frames', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }, { id: 2, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 10, y: 0, z: 0, fall: 0 }, { id: 2, x: 10, y: 0, z: 0, fall: 0 }] }, 50)
  b.push({ players: [{ id: 1, x: 20, y: 0, z: 0, fall: 0 }, { id: 2, x: 20, y: 0, z: 0, fall: 0 }] }, 100)
  b.push({ players: [{ id: 1, x: 30, y: 0, z: 0, fall: 0 }, { id: 2, x: 30, y: 0, z: 0, fall: 0 }] }, 150)
  const s = b.sample(125, 1)
  const live = s.players.find((p) => p.id === 1)
  const other = s.players.find((p) => p.id === 2)
  assert.equal(live.x, 30, 'live player comes from the newest frame at 150')
  assert.ok(Math.abs(other.x - 5) < 1e-6, 'other player is interpolated halfway between frames at 0 and 50')
})

test('a live player present in the newest frame but absent in delayed frames is included', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 2, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 2, x: 1, y: 0, z: 0, fall: 0 }] }, 50)
  b.push({ players: [{ id: 2, x: 2, y: 0, z: 0, fall: 0 }] }, 100)
  b.push({ players: [{ id: 1, x: 99, y: 0, z: 0, fall: 0 }, { id: 2, x: 3, y: 0, z: 0, fall: 0 }] }, 150)
  const s = b.sample(150, 1)
  const live = s.players.find((p) => p.id === 1)
  assert.ok(live, 'live player is present')
  assert.equal(live.x, 99)
})

test('a snapshot without a fall field is blended without producing NaN', () => {
  // Cutline's cars have no fall and no z. The buffer is shared, so it must not
  // write NaN into a field a caller never set.
  const buffer = makeBuffer(60)
  buffer.push({ players: [{ id: 'p-1', x: 0, y: 0, heading: 1 }] }, 0)
  buffer.push({ players: [{ id: 'p-1', x: 10, y: 20, heading: 2 }] }, 100)

  const sampled = buffer.sample(100)
  assert.ok(sampled, 'two frames must be enough to sample')

  const [car] = sampled.players
  assert.ok(Number.isFinite(car.x), 'x must stay finite')
  assert.ok(Number.isFinite(car.y), 'y must stay finite')
  assert.ok(!('fall' in car) || Number.isFinite(car.fall), 'fall must never be NaN')
})

test('a snapshot that does carry fall still blends it', () => {
  const buffer = makeBuffer(60)
  buffer.push({ players: [{ id: 'p-1', x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  buffer.push({ players: [{ id: 'p-1', x: 10, y: 0, z: 0, fall: 1 }] }, 100)

  const [body] = buffer.sample(100).players
  assert.ok(Number.isFinite(body.fall), 'fall must still interpolate for Blockout 3D')
  assert.ok(body.fall > 0 && body.fall <= 1)
})

test('a buffer keyed to another noun blends that array instead', () => {
  // Cutline's snapshots call the array `cars`, not `players`. The buffer is
  // shared, so the caller names the key rather than every game agreeing on one
  // noun.
  const b = makeBuffer(100, 'cars')
  b.push({ cars: [{ id: 'c-1', x: 0, y: 0, heading: 0 }] }, 0)
  b.push({ cars: [{ id: 'c-1', x: 4, y: 0, heading: 0 }] }, 100)

  const s = b.sample(150)
  assert.equal(s.players, undefined, 'it must not invent a players array')
  assert.equal(s.cars.length, 1, 'the cars array must survive')
  assert.ok(Math.abs(s.cars[0].x - 2) < 1e-6, `x was ${s.cars[0].x}, expected the midpoint`)
})

test('the default key is still players, so Blockout 3D is unaffected', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 2, y: 0, z: 0, fall: 0 }] }, 100)
  const s = b.sample(150)
  assert.equal(s.players.length, 1)
  assert.ok(Math.abs(s.players[0].x - 1) < 1e-6)
})

test('a key that matches nothing yields an empty array, which is how Cutline shipped blind', () => {
  // This is the trap, written down. sample() cannot tell a snapshot with no
  // bodies from a snapshot whose bodies are under a different name: both give
  // back an empty array and no error. Cutline passed the default key while
  // sending `cars`, so every frame rendered an empty track and 672 tests
  // stayed green. If this assertion ever fails, the buffer learned to complain
  // and this test should become that complaint.
  const b = makeBuffer(100, 'players')
  b.push({ cars: [{ id: 'c-1', x: 0, y: 0 }] }, 0)
  b.push({ cars: [{ id: 'c-1', x: 4, y: 0 }] }, 100)

  const s = b.sample(150)
  assert.deepEqual(s.players, [], 'a mismatched key is silent, not loud')
  assert.equal(s.cars.length, 1, 'the real bodies ride through untouched and unblended')
})

test('heading is blended between two frames, the same as position', () => {
  // Position alone was blended, so a car's facing stepped at the rhythm frames
  // arrived: measured, it froze on 153 of 506 cornering frames and then turned
  // up to three times the usual amount in one.
  const b = makeBuffer(100, 'cars')
  b.push({ cars: [{ id: 'c-1', x: 0, y: 0, heading: 0 }] }, 0)
  b.push({ cars: [{ id: 'c-1', x: 4, y: 0, heading: 1 }] }, 100)
  const [car] = b.sample(150).cars
  assert.ok(Math.abs(car.heading - 0.5) < 1e-6, `heading was ${car.heading}, expected the midpoint`)
})

test('heading is blended the short way round through +/-180 degrees', () => {
  const b = makeBuffer(100, 'cars')
  const nearPi = (179 * Math.PI) / 180
  b.push({ cars: [{ id: 'c-1', x: 0, y: 0, heading: nearPi }] }, 0)
  b.push({ cars: [{ id: 'c-1', x: 0, y: 0, heading: -nearPi }] }, 100)
  const [car] = b.sample(150).cars
  assert.ok(Math.abs(Math.cos(car.heading) + 1) < 1e-6, `heading ${car.heading} swung through 0 instead of 180`)
})

test('a body without a heading is not given one', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 2, y: 0, z: 0, fall: 0 }] }, 100)
  assert.ok(!('heading' in b.sample(150).players[0]), 'Blockout 3D bodies must not grow a heading')
})
