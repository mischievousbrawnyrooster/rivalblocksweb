import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { filterSortRegions } from './servers.js'
import { isValidEmail } from './validate.js'
import { makeWallTiles, MATERIALS, ARENA_STYLE, styleFor } from './wallTiles.js'
import { makeFireTiles } from './fireTiles.js'

const sample = [
  { id: 'b', label: 'Beta', status: 'operational', players: 10, tickRate: 128, uptime: 99.1 },
  { id: 'a', label: 'Alpha', status: 'degraded', players: 30, tickRate: 64, uptime: 98.0 },
  { id: 'c', label: 'Gamma', status: 'operational', players: 20, tickRate: 128, uptime: 99.9 },
  { id: 'd', label: 'Delta', status: 'maintenance', players: 0, tickRate: 0, uptime: 99.5 },
]

const ids = (rows) => rows.map((r) => r.id)

test('filters by each status', () => {
  assert.deepEqual(ids(filterSortRegions(sample, { status: 'operational' })), ['b', 'c'])
  assert.deepEqual(ids(filterSortRegions(sample, { status: 'degraded' })), ['a'])
  assert.deepEqual(ids(filterSortRegions(sample, { status: 'maintenance' })), ['d'])
})

test('status "all" and no options keep every region', () => {
  assert.equal(filterSortRegions(sample, { status: 'all' }).length, 4)
  assert.equal(filterSortRegions(sample).length, 4)
})

test('sorts by each key', () => {
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'label' })), ['a', 'b', 'd', 'c'])
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'players' })), ['a', 'c', 'b', 'd'])
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'uptime' })), ['c', 'd', 'b', 'a'])
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'tickRate' }))[3], 'd')
})

test('unknown sortBy falls back to label order instead of throwing', () => {
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'nope' })), ['a', 'b', 'd', 'c'])
})

test('a filter matching nothing returns an empty array', () => {
  assert.deepEqual(filterSortRegions(sample, { status: 'on fire' }), [])
})

test('does not mutate or reorder the input array', () => {
  const before = ids(sample)
  filterSortRegions(sample, { sortBy: 'players' })
  assert.deepEqual(ids(sample), before)
})

test('accepts real addresses', () => {
  assert.ok(isValidEmail('player@rivalblocks.gg'))
  assert.ok(isValidEmail('  padded@example.co.uk  '))
})

test('rejects malformed addresses', () => {
  for (const bad of ['', '   ', 'nope', 'no@domain', '@example.com', 'a b@example.com', 'two@@example.com', null, undefined, 42]) {
    assert.equal(isValidEmail(bad), false, `should reject ${JSON.stringify(bad)}`)
  }
})


// --- wall artwork ---------------------------------------------------------
// The slabs are drawn with canvas calls, which node has no DOM for. A recording
// stub is enough to check the thing that actually matters: that the three
// damage states differ in the SHAPE they draw and not merely in colour, which
// is what makes them readable to someone who cannot separate the two shades.

const PALETTE = {
  wall: '#5c5c68',
  floor: '#16161a',
  edge: '#08080a',
  grid: '#2b2b31',
  fg: '#ecebe6',
  muted: '#8f8d86',
}

/** A 2D context that writes down what it was asked to draw. */
function recorder() {
  const ops = []
  const noop = () => {}
  return {
    ops,
    set fillStyle(v) {},
    set strokeStyle(v) {},
    set lineWidth(v) {},
    set lineCap(v) {},
    set lineJoin(v) {},
    set globalAlpha(v) {},
    fillRect: (...a) => ops.push(['fillRect', ...a]),
    strokeRect: (...a) => ops.push(['strokeRect', ...a]),
    beginPath: () => ops.push(['beginPath']),
    closePath: noop,
    moveTo: (...a) => ops.push(['moveTo', ...a]),
    lineTo: (...a) => ops.push(['lineTo', ...a]),
    arc: (...a) => ops.push(['arc', ...a]),
    fill: () => ops.push(['fill']),
    stroke: () => ops.push(['stroke']),
    translate: (...a) => ops.push(['translate', ...a]),
    rotate: (...a) => ops.push(['rotate', ...a]),
    quadraticCurveTo: (...a) => ops.push(['quadraticCurveTo', ...a]),
    ellipse: (...a) => ops.push(['ellipse', ...a]),
    setLineDash: (...a) => ops.push(['setLineDash', ...a]),
  }
}

function withStubbedCanvas(run) {
  const made = []
  globalThis.document = {
    createElement: () => {
      const rec = recorder()
      made.push(rec)
      return { width: 0, height: 0, getContext: () => rec }
    },
  }
  try {
    return { result: run(), made }
  } finally {
    delete globalThis.document
  }
}

test('every wall damage state is drawn with more structure than the last', () => {
  const { result: tiles, made } = withStubbedCanvas(() => makeWallTiles(PALETTE, 32))

  assert.equal(tiles.states.length, 3, 'three damage states')
  assert.ok(tiles.border, 'the boundary has its own art')

  // The tiles come back in build order: intact, chipped, failing, then border.
  const count = (rec) => rec.ops.filter((o) => o[0] === 'lineTo' || o[0] === 'arc').length
  const intact = count(made[0])
  const chipped = count(made[2])
  const failing = count(made[5])

  assert.ok(chipped > intact, `chipped (${chipped}) draws no more than intact (${intact})`)
  assert.ok(failing > chipped, `failing (${failing}) draws no more than chipped (${chipped})`)
})

test('a slab looks the same every time it is drawn', () => {
  const a = withStubbedCanvas(() => makeWallTiles(PALETTE, 32)).made.map((r) => JSON.stringify(r.ops))
  const b = withStubbedCanvas(() => makeWallTiles(PALETTE, 32)).made.map((r) => JSON.stringify(r.ops))
  assert.deepEqual(a, b, 'the same slab drew differently on a redraw')
})

test('each damage state offers more than one cut, so a wall is not stamped', () => {
  const { result: tiles, made } = withStubbedCanvas(() => makeWallTiles(PALETTE, 32))
  for (const cuts of tiles.states) assert.ok(cuts.length >= 2, 'a state has only one face')
  // And those cuts genuinely differ from one another.
  assert.notEqual(JSON.stringify(made[2].ops), JSON.stringify(made[3].ops))
})


// --- blast artwork --------------------------------------------------------

test('the core, an arm and a tip are each drawn differently', () => {
  const { result: fire, made } = withStubbedCanvas(() => makeFireTiles(PALETTE, 32))

  assert.ok(fire.core && fire.armH && fire.armV, 'a piece of the blast is missing')
  for (const dir of ['1,0', '-1,0', '0,1', '0,-1']) {
    assert.ok(fire.tip[dir], `no tip for ${dir}`)
  }

  // Built in order: core, horizontal arm, vertical arm, then the four tips.
  const shape = (rec) => JSON.stringify(rec.ops)
  assert.notEqual(shape(made[0]), shape(made[1]), 'the core and an arm are drawn alike')
  assert.notEqual(shape(made[1]), shape(made[3]), 'an arm and a tip are drawn alike')

  // The two arm runs are one drawing under different transforms, so with the
  // transforms stripped the geometry is identical — that is what keeps the
  // banding continuous where a horizontal run meets a vertical one.
  const geometry = (rec) => JSON.stringify(rec.ops.filter((o) => o[0] !== 'translate' && o[0] !== 'rotate'))
  assert.equal(geometry(made[1]), geometry(made[2]), 'the two arm runs are not the same drawing')
})

test('a flame looks the same every time it is drawn', () => {
  const a = withStubbedCanvas(() => makeFireTiles(PALETTE, 32)).made.map((r) => JSON.stringify(r.ops))
  const b = withStubbedCanvas(() => makeFireTiles(PALETTE, 32)).made.map((r) => JSON.stringify(r.ops))
  assert.deepEqual(a, b, 'the same flame drew differently on a redraw')
})


// --- arena materials ------------------------------------------------------

test('every arena in all three games names a material that exists', () => {
  // The names have to agree with the ARENAS lists on three separate servers.
  const arenas = [
    ...['kiln', 'substation', 'drydock', 'scrapyard'],
    ...['foundry', 'magazine', 'dryhouse', 'scrapline'],
    ...['square', 'disc', 'diamond', 'cross', 'ring', 'scatter'],
  ]
  for (const arena of arenas) {
    const style = styleFor(arena)
    assert.ok(MATERIALS[style], `${arena} asks for a material called ${style}`)
    assert.ok(ARENA_STYLE[arena], `${arena} has no material of its own`)
  }
  // An unknown arena still renders rather than throwing.
  assert.equal(styleFor('somewhere-else'), 'concrete')
})

test('each material draws a different wall and a different floor', () => {
  const shape = (rec) => JSON.stringify(rec.ops)
  const walls = new Map()
  const floors = new Map()

  for (const style of Object.keys(MATERIALS)) {
    const { made } = withStubbedCanvas(() => makeWallTiles(PALETTE, 32, style))
    // Build order: two intact, three chipped, three failing, border, then the
    // floor cuts.
    walls.set(style, shape(made[0]))
    floors.set(style, shape(made[9]))
  }

  assert.equal(new Set(walls.values()).size, walls.size, 'two materials draw the same wall')
  assert.equal(new Set(floors.values()).size, floors.size, 'two materials draw the same floor')

  // And within one material, the wall and the floor are not the same drawing —
  // a floor that looks like cover is the one thing this must not do.
  for (const style of walls.keys()) {
    assert.notEqual(walls.get(style), floors.get(style), `${style} floors look like its walls`)
  }
})

test('damage reads the same however the arena is dressed', () => {
  // Whatever the material, each state has to draw strictly more structure than
  // the one before it — that is what keeps the three legible without colour.
  const count = (rec) => rec.ops.filter((o) => o[0] === 'lineTo' || o[0] === 'arc').length
  for (const style of Object.keys(MATERIALS)) {
    const { made } = withStubbedCanvas(() => makeWallTiles(PALETTE, 32, style))
    const intact = count(made[0])
    const chipped = count(made[2])
    const failing = count(made[5])
    assert.ok(chipped > intact, `${style}: chipped draws no more than intact`)
    assert.ok(failing > chipped, `${style}: failing draws no more than chipped`)
  }
})

test('a material looks the same every time it is built', () => {
  for (const style of Object.keys(MATERIALS)) {
    const a = withStubbedCanvas(() => makeWallTiles(PALETTE, 32, style)).made.map((r) =>
      JSON.stringify(r.ops),
    )
    const b = withStubbedCanvas(() => makeWallTiles(PALETTE, 32, style)).made.map((r) =>
      JSON.stringify(r.ops),
    )
    assert.deepEqual(a, b, `${style} drew differently on a rebuild`)
  }
})


test('each game builds its tiles before it draws with them', () => {
  // The render loops are ordinary imperative code and cannot be exercised
  // without a DOM, but the one thing that has actually broken here is ordering:
  // a patch moved the floor above the line that builds the tiles it needs, and
  // every frame threw before anything reached the screen. Cheap to check
  // statically, and it fails loudly the moment the order slips again.
  for (const page of [
    'src/pages/Fracture.jsx',
    'src/pages/Blastworks.jsx',
    'src/pages/Play.jsx',
  ]) {
    const src = readFileSync(page, 'utf8')
    const built = src.indexOf('makeWallTiles(colour, px, style)')
    const used = src.indexOf('tiles.floor')
    assert.notEqual(built, -1, `${page} never builds its tiles`)
    assert.notEqual(used, -1, `${page} never draws a floor`)
    assert.ok(built < used, `${page} draws with tiles before it builds them`)
  }
})
