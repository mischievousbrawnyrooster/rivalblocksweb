import test from 'node:test'
import assert from 'node:assert/strict'
import { wallBlocks } from './wallBlocks.js'
import { CIRCUITS, carve, GRID, S_WALL } from '../../server/cutline.js'

// Headroom over the measured maximum of 1,043, so a regression that boxes every
// wall tile (up to 6,600) fails loudly.
const WALL_BOX_CEILING = 1200

const roadAt = (grid, x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && grid[y * GRID + x] !== S_WALL
const touchesRoad = (grid, x, y) => {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && roadAt(grid, x + dx, y + dy)) return true
    }
  }
  return false
}

test('a small grid gets exactly the walls around its road, corners included', () => {
  // 5 by 5, one road tile in the middle: all 8 neighbours are walls that touch it.
  const W = 0
  const R = 1
  const g = new Uint8Array(25).fill(W)
  g[2 * 5 + 2] = R
  const got = wallBlocks(g, 5, W).map((b) => `${b.x},${b.y}`).sort()
  const want = ['1,1', '2,1', '3,1', '1,2', '3,2', '1,3', '2,3', '3,3'].sort()
  assert.deepEqual(got, want, 'the diagonal corners must be boxed, or the ring has holes')
})

test('every wall touching the road is boxed, and nothing else', () => {
  for (const circuit of CIRCUITS) {
    const { grid } = carve(circuit.seed)
    const boxes = wallBlocks(grid, GRID, S_WALL)
    const boxed = new Set(boxes.map((b) => b.y * GRID + b.x))

    for (const b of boxes) {
      assert.equal(grid[b.y * GRID + b.x], S_WALL, `${circuit.name}: a box sits on the road at ${b.x},${b.y}`)
      assert.ok(touchesRoad(grid, b.x, b.y), `${circuit.name}: a box is buried in solid wall at ${b.x},${b.y}`)
    }
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (grid[y * GRID + x] === S_WALL && touchesRoad(grid, x, y)) {
          assert.ok(boxed.has(y * GRID + x), `${circuit.name}: a wall beside the road at ${x},${y} is missing`)
        }
      }
    }
    assert.ok(boxes.length <= WALL_BOX_CEILING, `${circuit.name}: ${boxes.length} boxes`)
  }
})

test('a grid with no road produces no walls', () => {
  assert.deepEqual(wallBlocks(new Uint8Array(16), 4, 0), [])
})
