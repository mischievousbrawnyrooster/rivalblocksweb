// The wall tiles worth drawing in 3D. Pure and import-free: the grid, its size
// and the value that means wall are passed in. Exercised by wallBlocks.test.js.
//
// Only walls beside the road are drawn, which is 548 to 1,043 boxes per circuit
// out of up to 6,600 wall tiles. Adjacency is 8-way: at 4-way, a wall that meets
// the road only at a corner is skipped, and every convex corner of the circuit
// gets a hole you can see through. Measured, that was 1,039 holes.

export function wallBlocks(grid, size, wall) {
  const road = (x, y) => x >= 0 && y >= 0 && x < size && y < size && grid[y * size + x] !== wall
  const out = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x] !== wall) continue
      let beside = false
      for (let dy = -1; dy <= 1 && !beside; dy++) {
        for (let dx = -1; dx <= 1 && !beside; dx++) {
          if ((dx || dy) && road(x + dx, y + dy)) beside = true
        }
      }
      if (beside) out.push({ x, y })
    }
  }
  return out
}

/**
 * The faces of the pits under holes: a floor under every hole tile, and a wall
 * on each edge a hole tile shares with ground that is not a hole. Walls between
 * two hole tiles are left out, or they would show inside the pit as a grid.
 * `dx, dy` points from the hole tile to the ground beside it.
 */
export function holeFaces(grid, size, hole) {
  const isHole = (x, y) => x >= 0 && y >= 0 && x < size && y < size && grid[y * size + x] === hole
  const floors = []
  const edges = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isHole(x, y)) continue
      floors.push({ x, y })
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!isHole(x + dx, y + dy)) edges.push({ x, y, dx, dy })
      }
    }
  }
  return { floors, edges }
}
