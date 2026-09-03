import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { boardFor, emptyBoard, merge } from './board.js'
import { load, save, boardDir, keeper } from './board-store.js'

const spec = boardFor('fracture')
const dir = () => mkdtempSync(join(tmpdir(), 'rivalblocks-board-'))
const scratch = []
const fresh = () => {
  const d = dir()
  scratch.push(d)
  return d
}
test.after(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

const filled = () =>
  merge(emptyBoard(spec.game), [{ name: 'ada', bot: false, won: true, kills: 9, deaths: 2 }], 1234)

test('a board survives being written and read back', () => {
  const d = fresh()
  assert.equal(save(d, spec, filled()), true)
  const back = load(d, spec)
  assert.deepEqual(back.players, filled().players)
  assert.equal(back.game, spec.game)
})

test('a directory that does not exist yet is made, not complained about', () => {
  const d = join(fresh(), 'not', 'there', 'yet')
  assert.equal(save(d, spec, filled()), true)
  assert.equal(load(d, spec).players.length, 1)
})

test('a board nobody has written yet reads as an empty one', () => {
  const b = load(fresh(), spec)
  assert.deepEqual(b.players, [])
  assert.equal(b.game, spec.game)
  assert.equal(b.mode, spec.mode)
})

test('a file that is not JSON reads as an empty board rather than throwing', () => {
  const d = fresh()
  writeFileSync(join(d, spec.file), '{"players": [{"name": "ada"')
  assert.deepEqual(load(d, spec).players, [], 'a truncated file was trusted')
})

test('a file that is JSON but not a board reads as an empty board', () => {
  const d = fresh()
  writeFileSync(join(d, spec.file), JSON.stringify({ players: [{ name: 'ada' }] }))
  assert.deepEqual(load(d, spec).players, [], 'a half-written row was trusted')
  writeFileSync(join(d, spec.file), JSON.stringify(['not', 'a', 'board']))
  assert.deepEqual(load(d, spec).players, [])
})

test('a write that cannot be finished leaves the board that was already there', () => {
  const d = fresh()
  save(d, spec, filled())

  // Unserialisable, so it fails while it is still in memory. The point of the
  // test is the ordering: nothing may touch the file until the whole board has
  // been turned into text successfully.
  const broken = filled()
  broken.players[0].wins = 1n
  assert.equal(save(d, spec, broken), false, 'claimed to have saved a board it could not write')

  const back = load(d, spec)
  assert.equal(back.players[0].wins, 1, 'the good board was destroyed by a failed write')
  assert.equal(back.players[0].kills, 9)
})

test('nothing is left lying beside the board afterwards', () => {
  const d = fresh()
  save(d, spec, filled())
  const broken = filled()
  broken.players[0].wins = 1n
  save(d, spec, broken)
  assert.deepEqual(readdirSync(d), [spec.file], 'a temp file was left behind')
})

test('the board on disk is plain, readable JSON', () => {
  const d = fresh()
  save(d, spec, filled())
  const text = readFileSync(join(d, spec.file), 'utf8')
  assert.match(text, /\n/, 'written as one long line, unreadable in an editor')
  assert.match(text, /"ada"/)
  assert.doesNotThrow(() => JSON.parse(text))
})

test('the directory comes from the environment, and falls back to one in the repo', () => {
  assert.equal(boardDir({ BOARD_DIR: '/var/lib/rivalblocks/board' }), '/var/lib/rivalblocks/board')
  assert.equal(boardDir({}), 'data')
})

// --- the keeper ----------------------------------------------------------

const played = (name, won) => ({ name, bot: false, won, kills: 2, deaths: 1 })

test('a keeper banks a match once, however long the result stays up', () => {
  const d = fresh()
  const keep = keeper(spec, d)
  let asked = 0
  const results = () => {
    asked += 1
    return [played('ada', true), played('bob', false)]
  }

  assert.equal(keep.bank(false, results), false)
  assert.equal(keep.bank(true, results), true, 'the end of the match went unnoticed')
  for (let i = 0; i < 50; i++) keep.bank(true, results)
  assert.equal(asked, 1, 'the same match was banked more than once')
  assert.equal(keep.top()[0].name, 'ada')
  assert.equal(keep.top()[0].wins, 1)
})

test('a board outlives the process that wrote it', () => {
  const d = fresh()
  const first = keeper(spec, d)
  first.bank(true, () => [played('ada', true)])

  // The server goes down and comes back. Nothing is kept in memory across it.
  const second = keeper(spec, d)
  assert.equal(second.top()[0].name, 'ada', 'the board did not survive a restart')
  assert.equal(second.top()[0].matches, 1)

  second.bank(false, () => [])
  second.bank(true, () => [played('ada', true)])
  assert.equal(keeper(spec, d).top()[0].matches, 2, 'the second match was lost')
})

test('a match with nobody in it leaves the file alone', () => {
  const d = fresh()
  const keep = keeper(spec, d)
  keep.bank(true, () => [played('ada', true)])
  const before = readFileSync(join(d, spec.file), 'utf8')

  // Bots playing each other in the operator console. Real matches, nobody to
  // credit for them.
  keep.bank(false, () => [])
  assert.equal(keep.bank(true, () => []), false, 'banked a match with no people in it')
  assert.equal(readFileSync(join(d, spec.file), 'utf8'), before, 'the board was rewritten anyway')
  assert.equal(keep.top()[0].matches, 1)
})
