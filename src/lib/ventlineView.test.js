import test from 'node:test'
import assert from 'node:assert/strict'
import { projectWorld, projectMap } from './ventlineView.js'
import { gateAt } from '../../server/ventline.js'

test('camera movement shifts a shutter while world height stays scaled', () => {
  assert.deepEqual(projectWorld(1200, 200, 1100, 1), { x: 100, y: 200 })
  assert.deepEqual(projectWorld(1200, 200, 1150, 1), { x: 50, y: 200 })
  assert.deepEqual(projectWorld(1200, 200, 1100, 0.5), { x: 50, y: 100 })
})

test('map selects one shutter behind and three ahead from the supplied window', () => {
  const gates = Array.from({ length: 5 }, (_, i) => gateAt(7, i + 2))
  const view = projectMap({ viewedId: 'p1', gates, players: [
    { id: 'p1', slot: 0, x: 1200, y: 300, alive: true },
  ] }, 160, 100)
  assert.deepEqual(view.gates.map(gate => gate.index), [2, 3, 4, 5])
  assert.deepEqual(view.gates.map(gate => gate.x), [0, 40, 80, 120])
})

test('opening map keeps all four supplied forward shutters visible', () => {
  const gates = Array.from({ length: 4 }, (_, i) => gateAt(7, i + 1))
  const view = projectMap({ viewedId: 'p1', gates, players: [
    { id: 'p1', slot: 0, x: 0, y: 300, alive: true },
  ] }, 160, 100)
  assert.deepEqual(view.gates.map(gate => gate.index), [1, 2, 3, 4])
  assert.ok(view.players[0].x >= 0 && view.players[0].x < view.gates[0].x)
  assert.ok(view.gates[3].x + view.gates[3].w <= 160)
})

test('map scales both shutter openings without reversing their vertical order', () => {
  const gate = gateAt(7, 5)
  const view = projectMap({ viewedId: 'p1', gates: [gate], players: [
    { id: 'p1', slot: 0, x: gate.x, y: 300, alive: true },
  ] }, 160, 100)
  const projected = view.gates[0]
  assert.ok(Math.abs(projected.service.lo - gate.service.lo / 6) < 1e-9)
  assert.ok(Math.abs(projected.service.hi - gate.service.hi / 6) < 1e-9)
  assert.ok(Math.abs(projected.charged.lo - gate.charged.lo / 6) < 1e-9)
  assert.ok(Math.abs(projected.charged.hi - gate.charged.hi / 6) < 1e-9)
  assert.equal(projected.service.lo < projected.charged.lo, gate.service.lo < gate.charged.lo)
})

test('map projects authoritative player coordinates and keeps overlapping slots distinct', () => {
  const snapshot = { viewedId: 'p1', gates: [gateAt(7, 5)], players: [
    { id: 'p1', slot: 0, x: 1200, y: 200, alive: true },
    { id: 'p2', slot: 1, x: 1200, y: 200, alive: true },
  ] }
  const view = projectMap(snapshot, 160, 100)
  assert.equal(view.players.length, 2)
  assert.notDeepEqual(view.players[0].label, view.players[1].label)
  assert.deepEqual(view.players.map(player => player.x), [40, 40])
  assert.ok(view.players.every(player => Math.abs(player.y - 200 / 6) < 1e-9))
  assert.equal(view.players[0].solid, true)
  assert.equal(view.players[1].solid, false)
  assert.deepEqual(snapshot.players.map(player => [player.x, player.y]), [[1200, 200], [1200, 200]])
})
