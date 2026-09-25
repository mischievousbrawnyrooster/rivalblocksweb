import test from 'node:test'
import assert from 'node:assert/strict'
import { projectWorld } from './ventlineView.js'

test('camera movement shifts a shutter while world height stays scaled', () => {
  assert.deepEqual(projectWorld(1200, 200, 1100, 1), { x: 100, y: 200 })
  assert.deepEqual(projectWorld(1200, 200, 1150, 1), { x: 50, y: 200 })
  assert.deepEqual(projectWorld(1200, 200, 1100, 0.5), { x: 50, y: 100 })
})
