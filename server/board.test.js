import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BOARDS,
  MAX_NAMES,
  TOP_N,
  emptyBoard,
  boardFor,
  merge,
  rank,
  top,
  combine,
  isBoard,
  once,
  kd,
} from './board.js'

/** One player as a wrapper hands them over at the end of a match. */
const person = (name, extra = {}) => ({
  name,
  bot: false,
  won: false,
  kills: 0,
  deaths: 0,
  ...extra,
})
const at = 1_000_000

// --- shape ---------------------------------------------------------------

test('every match server has exactly one file of its own', () => {
  const files = BOARDS.map((b) => b.file)
  assert.equal(new Set(files).size, files.length, 'two servers would write the same path')
  for (const b of BOARDS) assert.match(b.file, /^board-[a-z-]+\.json$/)
})

test('a board a server has never written is empty, not broken', () => {
  const b = emptyBoard('fracture')
  assert.deepEqual(b.players, [])
  assert.equal(top(b).length, 0)
  assert.equal(isBoard(b), true)
})

test('a server finds its own file from its game and mode', () => {
  assert.equal(boardFor('blastworks', 'lastman').file, 'board-blastworks-lastman.json')
  assert.equal(boardFor('blastworks', 'deathmatch').file, 'board-blastworks-deathmatch.json')
  assert.equal(boardFor('blockout').file, 'board-blockout.json')
  assert.equal(boardFor('nonesuch'), undefined)
})

// --- merging -------------------------------------------------------------

test('a first match puts everyone who played on the board', () => {
  const b = merge(
    emptyBoard('fracture'),
    [person('ada', { won: true, kills: 12, deaths: 3 }), person('grace', { kills: 8, deaths: 11 })],
    at,
  )

  assert.equal(b.players.length, 2)
  const ada = b.players.find((p) => p.name === 'ada')
  assert.deepEqual(ada, { name: 'ada', wins: 1, kills: 12, deaths: 3, matches: 1, last: at })
  assert.equal(b.updated, at)
})

test('a second match adds to the first rather than replacing it', () => {
  let b = merge(emptyBoard('fracture'), [person('ada', { won: true, kills: 12, deaths: 3 })], at)
  b = merge(b, [person('ada', { kills: 5, deaths: 9 })], at + 1000)

  const ada = b.players.find((p) => p.name === 'ada')
  assert.deepEqual(ada, { name: 'ada', wins: 1, kills: 17, deaths: 12, matches: 2, last: at + 1000 })
  assert.equal(b.players.length, 1, 'the same person was added twice')
})

test('merging returns a new board and leaves the old one alone', () => {
  const before = merge(emptyBoard('fracture'), [person('ada', { kills: 4 })], at)
  const untouched = JSON.stringify(before)
  merge(before, [person('ada', { kills: 99 })], at + 1)
  assert.equal(JSON.stringify(before), untouched, 'merge wrote through to its argument')
})

test('bots are never on the board', () => {
  const b = merge(
    emptyBoard('blastworks', 'lastman'),
    [person('ada', { kills: 1 }), { name: 'Cinder', bot: true, won: true, kills: 40, deaths: 0 }],
    at,
  )
  assert.deepEqual(
    b.players.map((p) => p.name),
    ['ada'],
  )
})

test('a match taken off nothing but bots still counts for the person in it', () => {
  const b = merge(
    emptyBoard('blastworks', 'lastman'),
    [person('ada', { won: true, kills: 3 }), { name: 'Ash', bot: true, kills: 1 }],
    at,
  )
  assert.equal(b.players[0].wins, 1)
  assert.equal(b.players[0].matches, 1)
})

test('a nameless entry is dropped rather than given a blank row', () => {
  const b = merge(emptyBoard('fracture'), [person('   '), person(''), person('ada')], at)
  assert.deepEqual(
    b.players.map((p) => p.name),
    ['ada'],
  )
})

test('a scoreline cannot go backwards, whatever a wrapper hands over', () => {
  const b = merge(emptyBoard('fracture'), [person('ada', { kills: -50, deaths: -3 })], at)
  assert.deepEqual([b.players[0].kills, b.players[0].deaths], [0, 0])
})

// --- the hole this shape exists to close ---------------------------------

test('a player called __proto__ is a row on the board, not a hole in it', () => {
  let b = merge(
    emptyBoard('fracture'),
    [person('__proto__', { won: true, kills: 5 }), person('constructor', { kills: 2 }), person('ada')],
    at,
  )
  b = merge(b, [person('__proto__', { kills: 1 })], at + 1)

  assert.equal({}.wins, undefined, 'the prototype was written to')
  assert.equal(b.players.find((p) => p.name === '__proto__').kills, 6)
  assert.equal(b.players.find((p) => p.name === 'constructor').kills, 2)
  assert.equal(isBoard(b), true)
  assert.equal(isBoard(JSON.parse(JSON.stringify(b))), true, 'it did not survive a round trip')
})

// --- ranking -------------------------------------------------------------

test('the board ranks on wins, then kills, then fewest deaths, then name', () => {
  const order = rank([
    { name: 'zoe', wins: 1, kills: 5, deaths: 1, matches: 1, last: 0 },
    { name: 'ada', wins: 2, kills: 0, deaths: 9, matches: 1, last: 0 },
    { name: 'bob', wins: 1, kills: 9, deaths: 4, matches: 1, last: 0 },
    { name: 'cal', wins: 1, kills: 5, deaths: 0, matches: 1, last: 0 },
    { name: 'ann', wins: 1, kills: 5, deaths: 0, matches: 1, last: 0 },
  ]).map((p) => p.name)
  assert.deepEqual(order, ['ada', 'bob', 'ann', 'cal', 'zoe'])
})

test('ranking hands back a fresh list rather than resorting the one it was given', () => {
  const rows = [
    { name: 'zoe', wins: 0, kills: 0, deaths: 0, matches: 1, last: 0 },
    { name: 'ada', wins: 5, kills: 0, deaths: 0, matches: 1, last: 0 },
  ]
  rank(rows)
  assert.equal(rows[0].name, 'zoe', 'rank sorted the array it was given')
})

test('the top of the board is the top of the ranking, and no longer than TOP_N', () => {
  let b = emptyBoard('fracture')
  for (let i = 0; i < TOP_N + 4; i++) {
    b = merge(b, [person(`p${i}`, { won: true, kills: i })], at + i)
  }
  const five = top(b)
  assert.equal(five.length, TOP_N)
  assert.equal(five[0].name, `p${TOP_N + 3}`, 'the most kills was not first')
  assert.equal(top(b, 2).length, 2)
})

test('the board is capped, and it is the bottom of it that goes', () => {
  const everyone = []
  for (let i = 0; i < MAX_NAMES + 10; i++) everyone.push(person(`p${i}`, { kills: i }))
  const b = merge(emptyBoard('fracture'), everyone, at)

  assert.equal(b.players.length, MAX_NAMES)
  assert.equal(b.players[0].name, `p${MAX_NAMES + 9}`, 'the best player was dropped')
  assert.equal(
    b.players.some((p) => p.name === 'p0'),
    false,
    'the worst player survived the cap',
  )
})

// --- across the games ----------------------------------------------------

test('one player across three games is one row, with the totals added up', () => {
  const a = merge(emptyBoard('fracture'), [person('ada', { won: true, kills: 10, deaths: 2 })], at)
  const b = merge(emptyBoard('blockout'), [person('ada', { won: true })], at)
  const c = merge(
    emptyBoard('blastworks', 'lastman'),
    [person('ada', { kills: 4, deaths: 5 }), person('bob', { won: true, kills: 7, deaths: 1 })],
    at + 50,
  )

  const all = combine([a, b, c])
  const ada = all.find((p) => p.name === 'ada')
  assert.deepEqual(ada, { name: 'ada', wins: 2, kills: 14, deaths: 7, matches: 3, last: at + 50 })
  assert.equal(all[0].name, 'ada', 'two wins did not outrank one')
  assert.equal(all.length, 2)
})

test('a game nobody has finished contributes nothing and breaks nothing', () => {
  const all = combine([emptyBoard('fracture'), null, undefined, emptyBoard('blockout')])
  assert.deepEqual(all, [])
})

// --- validation ----------------------------------------------------------

test('anything that is not a board is not a board', () => {
  assert.equal(isBoard(null), false)
  assert.equal(isBoard('{}'), false)
  assert.equal(isBoard({ game: 'fracture' }), false, 'no player list')
  assert.equal(isBoard({ game: 'fracture', players: {} }), false, 'players must be a list')
  assert.equal(isBoard({ game: 'fracture', players: [{ name: 'ada' }] }), false, 'a row with no score')
  assert.equal(
    isBoard({
      game: 'fracture',
      players: [{ name: 'ada', wins: 1, kills: 0, deaths: 0, matches: 1, last: 0 }],
    }),
    true,
  )
})

// --- recording a match once ----------------------------------------------

test('a finished match is banked on the frame it finishes and not again', () => {
  const fire = once()
  assert.equal(fire(false), false, 'banked a match that was still being played')
  assert.equal(fire(true), true, 'missed the moment the match ended')
  for (let i = 0; i < 100; i++) assert.equal(fire(true), false, 'banked the same match twice')

  // The next match.
  assert.equal(fire(false), false)
  assert.equal(fire(true), true, 'the second match was never banked')
})

// --- kills against deaths ------------------------------------------------

test('a kill to death ratio is kills over deaths', () => {
  assert.equal(kd({ kills: 10, deaths: 5 }), 2)
  assert.equal(kd({ kills: 5, deaths: 10 }), 0.5)
  assert.equal(kd({ kills: 7, deaths: 7 }), 1)
})

test('somebody who has never died keeps every kill they have', () => {
  // Dividing by zero would read as infinite skill. Undefeated is measured
  // against one death, so the number stays a number and stays comparable.
  assert.equal(kd({ kills: 4, deaths: 0 }), 4)
  assert.equal(kd({ kills: 0, deaths: 0 }), null, 'somebody with no fights was given a ratio')
})

test('a ratio is only offered where the game keeps the score', () => {
  // Blockout Royale has no kills and no deaths — nobody shoots anybody, you
  // outlast them. A zero there is the absence of a number, not a bad one.
  const blockout = merge(emptyBoard('blockout'), [person('ada', { won: true })], at)
  assert.equal(kd(blockout.players[0]), null)

  // And it does not drag down the same person's record elsewhere.
  const fracture = merge(emptyBoard('fracture'), [person('ada', { kills: 9, deaths: 3 })], at)
  assert.equal(kd(combine([blockout, fracture])[0]), 3)
})
