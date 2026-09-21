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
  formatClearTime,
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
  for (const b of BOARDS) assert.match(b.file, /^board-[a-z0-9-]+\.json$/)
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

test('blockout3d has a board file of its own, with exactly one writer', () => {
  const spec = boardFor('blockout3d')
  assert.ok(spec, 'the game is registered')
  assert.equal(spec.file, 'board-blockout3d.json')
  assert.equal(spec.title, 'Blockout Royale 3D')
  // One writer per file is the whole concurrency design.
  const files = BOARDS.map((b) => b.file)
  assert.equal(new Set(files).size, files.length, 'no two servers share a file')
})

test('voiddrillers has a board file of its own, with exactly one writer', () => {
  const spec = boardFor('voiddrillers')
  assert.ok(spec, 'the game is registered')
  assert.equal(spec.file, 'board-voiddrillers.json')
  assert.equal(spec.title, 'Void Drillers')
  const files = BOARDS.map((b) => b.file)
  assert.equal(new Set(files).size, files.length, 'no two servers share a file')
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
  assert.deepEqual(ada, { name: 'ada', wins: 1, kills: 12, deaths: 3, matches: 1, last: at, fastestTime: null })
  assert.equal(b.updated, at)
})

test('a second match adds to the first rather than replacing it', () => {
  let b = merge(emptyBoard('fracture'), [person('ada', { won: true, kills: 12, deaths: 3 })], at)
  b = merge(b, [person('ada', { kills: 5, deaths: 9 })], at + 1000)

  const ada = b.players.find((p) => p.name === 'ada')
  assert.deepEqual(ada, { name: 'ada', wins: 1, kills: 17, deaths: 12, matches: 2, last: at + 1000, fastestTime: null })
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
  assert.deepEqual(ada, { name: 'ada', wins: 2, kills: 14, deaths: 7, matches: 3, last: at + 50, fastestTime: null })
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

// --- fastest clear time --------------------------------------------------

test('a winning match with a clear time records fastestTime on the board', () => {
  const b = merge(
    emptyBoard('voiddrillers'),
    [person('ada', { won: true, time: 45200 })],
    at,
  )
  const ada = b.players.find((p) => p.name === 'ada')
  assert.equal(ada.fastestTime, 45200)
  assert.equal(ada.wins, 1)
})

test('a faster win replaces the previous fastestTime', () => {
  let b = merge(
    emptyBoard('voiddrillers'),
    [person('ada', { won: true, time: 60000 })],
    at,
  )
  b = merge(b, [person('ada', { won: true, time: 42000 })], at + 1000)
  const ada = b.players.find((p) => p.name === 'ada')
  assert.equal(ada.fastestTime, 42000, 'a faster time did not replace the old one')
  assert.equal(ada.wins, 2)
})

test('a slower win preserves the existing fastestTime', () => {
  let b = merge(
    emptyBoard('voiddrillers'),
    [person('ada', { won: true, time: 30000 })],
    at,
  )
  b = merge(b, [person('ada', { won: true, time: 55000 })], at + 1000)
  const ada = b.players.find((p) => p.name === 'ada')
  assert.equal(ada.fastestTime, 30000, 'a slower time overwrote the faster one')
})

test('a loss does not set fastestTime even if time is present', () => {
  const b = merge(
    emptyBoard('voiddrillers'),
    [person('ada', { won: false, time: 20000 })],
    at,
  )
  const ada = b.players.find((p) => p.name === 'ada')
  assert.equal(ada.fastestTime, null)
})

test('a win without a clear time does not set fastestTime', () => {
  const b = merge(
    emptyBoard('voiddrillers'),
    [person('ada', { won: true })],
    at,
  )
  const ada = b.players.find((p) => p.name === 'ada')
  assert.equal(ada.fastestTime, null)
  assert.equal(ada.wins, 1)
})

test('boards without fastestTime on rows are still valid', () => {
  // Backwards compatibility: old board files have rows without fastestTime.
  assert.equal(
    isBoard({
      game: 'fracture',
      players: [{ name: 'ada', wins: 1, kills: 0, deaths: 0, matches: 1, last: 0 }],
    }),
    true,
    'an existing row without fastestTime was rejected',
  )
})

test('equal wins rank by fastest clear time, lower is better', () => {
  const order = rank([
    { name: 'zoe', wins: 2, kills: 0, deaths: 0, matches: 2, last: 0, fastestTime: 80000 },
    { name: 'ada', wins: 2, kills: 0, deaths: 0, matches: 2, last: 0, fastestTime: 30000 },
    { name: 'bob', wins: 2, kills: 0, deaths: 0, matches: 2, last: 0, fastestTime: 55000 },
  ]).map((p) => p.name)
  assert.deepEqual(order, ['ada', 'bob', 'zoe'])
})

test('a player with a clear time ranks above one without on equal wins', () => {
  const order = rank([
    { name: 'zoe', wins: 1, kills: 0, deaths: 0, matches: 1, last: 0, fastestTime: null },
    { name: 'ada', wins: 1, kills: 0, deaths: 0, matches: 1, last: 0, fastestTime: 50000 },
  ]).map((p) => p.name)
  assert.deepEqual(order, ['ada', 'zoe'])
})

test('combine keeps each best score under its own title rather than merging games', () => {
  const drillers = merge(emptyBoard('voiddrillers'), [person('ada', { won: true, time: 54585 })], at)
  const cipher = merge(emptyBoard('cipherrun'), [person('ada', { won: true, time: 13372, wpm: 81.1 })], at)

  const ada = combine([drillers, cipher]).find((p) => p.name === 'ada')
  assert.deepEqual(ada.bests, {
    [boardFor('voiddrillers').file]: { fastestTime: 54585 },
    [boardFor('cipherrun').file]: { fastestTime: 13372, peakWpm: 81.1 },
  })
  assert.equal(ada.fastestTime, null, 'a typing race and a drill clear were merged into one time')
  assert.equal(ada.wins, 2)
})

test('a title that keeps no best scores adds none to the cross-title row', () => {
  const blockout = merge(emptyBoard('blockout'), [person('ada', { won: true })], at)
  const drillers = merge(emptyBoard('voiddrillers'), [person('ada', { won: true, time: 45000 })], at)

  const ada = combine([blockout, drillers]).find((p) => p.name === 'ada')
  assert.deepEqual(Object.keys(ada.bests), [boardFor('voiddrillers').file])
})

test('kills and deaths only add up from titles that have fighting in them', () => {
  // Void Drillers banks being crushed as a death, with no kill to set against it.
  const drillers = merge(emptyBoard('voiddrillers'), [person('ada', { deaths: 4 })], at)
  const fracture = merge(emptyBoard('fracture'), [person('ada', { kills: 9, deaths: 3 })], at)

  const ada = combine([drillers, fracture])[0]
  assert.equal(ada.deaths, 3)
  assert.equal(kd(ada), 3)
})

test('every title says whether it keeps kills and deaths, and labels its best scores', () => {
  for (const spec of BOARDS) {
    assert.equal(typeof spec.fights, 'boolean', `${spec.file} does not say whether it fights`)
    for (const best of spec.bests) {
      assert.ok(best.key && best.label && best.short, `${spec.file} has an unlabelled best score`)
    }
  }
  for (const game of ['blockout', 'voiddrillers', 'cipherrun']) {
    assert.equal(boardFor(game).fights, false, `${game} has no killing, so it must not show K/D`)
  }
})

test('formatClearTime renders sub-minute times in seconds', () => {
  assert.equal(formatClearTime(45200), '45.2s')
  assert.equal(formatClearTime(8000), '8.0s')
  assert.equal(formatClearTime(59900), '59.9s')
})

test('formatClearTime renders times at or above one minute with minutes and seconds', () => {
  assert.equal(formatClearTime(60000), '1:00.0')
  assert.equal(formatClearTime(75300), '1:15.3')
  assert.equal(formatClearTime(125600), '2:05.6')
})

test('formatClearTime returns a dash for null or undefined', () => {
  assert.equal(formatClearTime(null), '—')
  assert.equal(formatClearTime(undefined), '—')
})

test('cipherrun board is registered in BOARDS', () => {
  const spec = boardFor('cipherrun')
  assert.ok(spec)
  assert.equal(spec.file, 'board-cipherrun.json')
  assert.equal(spec.game, 'cipherrun')
})

test('merge records peakWpm and computes running avgAcc for typing games', () => {
  let b = emptyBoard('cipherrun')
  b = merge(b, [person('ada', { won: true, wpm: 75.5, acc: 98.0 })], at)
  const ada = b.players.find((p) => p.name === 'ada')
  assert.equal(ada.peakWpm, 75.5)
  assert.equal(ada.avgAcc, 98.0)

  // Second match with lower WPM keeps peak WPM, updates avgAcc
  b = merge(b, [person('ada', { won: false, wpm: 70.0, acc: 94.0 })], at + 1000)
  const ada2 = b.players.find((p) => p.name === 'ada')
  assert.equal(ada2.peakWpm, 75.5)
  assert.equal(ada2.avgAcc, 96.0)
})

test('equal wins rank by peak WPM (higher is better)', () => {
  const a = { name: 'ada', wins: 2, peakWpm: 85, kills: 0, deaths: 0 }
  const b = { name: 'bob', wins: 2, peakWpm: 92, kills: 0, deaths: 0 }
  const ranked = rank([a, b])
  assert.equal(ranked[0].name, 'bob')
  assert.equal(ranked[1].name, 'ada')
})

test('Cutline is registered and files its best lap under fastestTime', () => {
  const spec = boardFor('cutline')
  assert.ok(spec, 'Cutline must have a board')
  assert.equal(spec.file, 'board-cutline.json')
  assert.equal(spec.title, 'Cutline')
  assert.equal(spec.fights, false, 'nobody is killed in Cutline; being cut is not a death')

  // fastestTime is reused rather than a new key added: the label is already per
  // board, and fastestTime is already validated by isRow and ranked lower is
  // better, so this costs no change to the validator or the ranker.
  assert.equal(spec.bests.length, 1)
  assert.equal(spec.bests[0].key, 'fastestTime')
  assert.equal(spec.bests[0].label, 'Winning lap')
  assert.equal(spec.bests[0].short, 'Lap')
})

test('every board file is unique and every game resolves', () => {
  const files = BOARDS.map((b) => b.file)
  assert.equal(new Set(files).size, files.length, 'two servers must never write the same file')
  for (const b of BOARDS) {
    assert.equal(boardFor(b.game, b.mode), b, `${b.title} must resolve from its game and mode`)
  }
})

test('a Cutline race banks a win, and only the winner sets a lap record', () => {
  // merge() only records fastestTime on a win (board.js), so the record is the
  // fastest lap among winning drives. That is why the label reads "Winning lap"
  // rather than "Fastest lap": a quicker lap from a driver who was cut is not
  // banked, and a column claiming otherwise would be a lie.
  const banked = merge(
    emptyBoard('cutline'),
    [
      { name: 'Ladle', bot: false, won: true, time: 17420 },
      { name: 'Tap', bot: false, won: false, time: 12000 },
    ],
    1000,
  )

  const winner = banked.players.find((p) => p.name === 'Ladle')
  assert.equal(winner.wins, 1)
  assert.equal(winner.fastestTime, 17420)
  assert.equal(winner.kills, 0, 'Cutline banks no kills')
  assert.equal(winner.deaths, 0, 'being cut is not a death')

  const cut = banked.players.find((p) => p.name === 'Tap')
  assert.equal(cut.wins, 0)
  assert.equal(cut.matches, 1, 'a cut driver still played the race')
  assert.ok(
    cut.fastestTime === null || cut.fastestTime === undefined,
    'a faster lap from a driver who was cut is not banked',
  )
})

test('a bot never reaches the board', () => {
  const banked = merge(
    emptyBoard('cutline'),
    [{ name: 'Cinder', bot: true, won: true, time: 9000 }],
    1000,
  )
  assert.equal(banked.players.length, 0, 'merge drops bots itself')
})
