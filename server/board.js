// The standing leaderboard, as rules rather than storage. Pure: no imports, no
// Node APIs, no I/O, no clock — the time a match finished is passed in. That is
// what lets this file run unchanged in the browser, so the table a player reads
// on a game page is sorted by the same code that wrote it.
//
// Reading and writing the files is server/board-store.js. Everything here is
// exercised by board.test.js.

// One file per match server, and one match server per file. That is the whole
// concurrency design: no two processes ever write the same path, so there is
// nothing to lock and nothing to lose.
//
// What each board keeps is said here once, for every table that draws one.
// `fights` is whether anybody is killed: a title without it shows no K/D, and
// its deaths (Void Drillers counts being crushed) stay out of the cross-title
// totals. `bests` are the best scores it records, with their column headings:
// `label` for the full table, `short` for the narrow strip.
export const BOARDS = [
  { file: 'board-blockout.json', game: 'blockout', mode: null, title: 'Blockout Royale', fights: false, bests: [] },
  {
    file: 'board-blockout3d.json',
    game: 'blockout3d',
    mode: null,
    title: 'Blockout Royale 3D',
    fights: true,
    bests: [],
  },
  { file: 'board-fracture.json', game: 'fracture', mode: null, title: 'Fracture Line', fights: true, bests: [] },
  {
    file: 'board-blastworks-lastman.json',
    game: 'blastworks',
    mode: 'lastman',
    title: 'Blastworks: Last man standing',
    fights: true,
    bests: [],
  },
  {
    file: 'board-blastworks-deathmatch.json',
    game: 'blastworks',
    mode: 'deathmatch',
    title: 'Blastworks: Deathmatch',
    fights: true,
    bests: [],
  },
  {
    file: 'board-voiddrillers.json',
    game: 'voiddrillers',
    mode: null,
    title: 'Void Drillers',
    fights: false,
    bests: [{ key: 'fastestTime', label: 'Fastest clear', short: 'Clear' }],
  },
  {
    file: 'board-cipherrun.json',
    game: 'cipherrun',
    mode: null,
    title: 'Cipher Run',
    fights: false,
    bests: [
      { key: 'fastestTime', label: 'Fastest win', short: 'Time' },
      { key: 'peakWpm', label: 'Peak WPM', short: 'WPM' },
    ],
  },
  {
    file: 'board-cutline.json',
    game: 'cutline',
    mode: null,
    title: 'Cutline',
    fights: false,
    bests: [{ key: 'fastestTime', label: 'Winning lap', short: 'Lap' }],
  },
  {
    file: 'board-ventline.json',
    game: 'ventline',
    mode: null,
    title: 'Ventline',
    fights: false,
    bests: [{ key: 'bestScore', label: 'Best score', short: 'Best' }],
  },
]

// Enough names that nobody who plays regularly falls off, few enough that a
// public lab cannot grow the file without bound.
export const MAX_NAMES = 200
export const TOP_N = 5

/** The file a server writes, found from what it is running. */
export const boardFor = (game, mode = null) =>
  BOARDS.find((b) => b.game === game && b.mode === mode)

export const emptyBoard = (game, mode = null) => ({ game, mode, updated: 0, players: [] })

const isScore = (n) => Number.isSafeInteger(n) && n >= 0

const isRow = (r) =>
  !!r &&
  typeof r.name === 'string' &&
  ['wins', 'kills', 'deaths', 'matches', 'last'].every((k) => Number.isFinite(r[k])) &&
  (r.fastestTime === undefined || r.fastestTime === null || Number.isFinite(r.fastestTime)) &&
  (r.peakWpm === undefined || r.peakWpm === null || Number.isFinite(r.peakWpm)) &&
  (r.avgAcc === undefined || r.avgAcc === null || Number.isFinite(r.avgAcc)) &&
  (r.bestScore === undefined || isScore(r.bestScore))

/**
 * Whether something read off disk is a board.
 *
 * Checked rather than trusted: the file is plain text on a machine people have
 * shell access to, and a board that has been edited by hand into the wrong
 * shape must read as "no board yet", never as a crash inside a match server.
 */
export const isBoard = (b) =>
  !!b && typeof b === 'object' && Array.isArray(b.players) &&
  b.players.every((r) => isRow(r) && (b.game !== 'ventline' || isScore(r.bestScore)))

/**
 * The row for a name, made if it is not there yet.
 *
 * `players` is a list and never an object keyed by name. A board keyed by name
 * would take `__proto__` and `constructor` as keys straight off the join
 * screen — the same hole the direction lookup in game.js is written to avoid.
 * A list cannot have it, and a name is only ever compared, never used as a key.
 */
function rowFor(players, name) {
  let row = players.find((p) => p.name === name)
  if (!row) {
    row = { name, wins: 0, kills: 0, deaths: 0, matches: 0, last: 0, fastestTime: null }
    players.push(row)
  }
  return row
}

/** Best first: wins, then peak WPM, then fastest clear time, then kills, then fewest deaths, then name. */
export const rank = (players) =>
  [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    // Highest peak WPM: higher is better, having one beats not having one.
    const aWpm = typeof a.peakWpm === 'number'
    const bWpm = typeof b.peakWpm === 'number'
    if (aWpm && bWpm && a.peakWpm !== b.peakWpm) return b.peakWpm - a.peakWpm
    if (aWpm !== bWpm) return aWpm ? -1 : 1
    // Fastest clear time: lower is better, having one beats not having one.
    const aHas = typeof a.fastestTime === 'number'
    const bHas = typeof b.fastestTime === 'number'
    if (aHas && bHas && a.fastestTime !== b.fastestTime) return a.fastestTime - b.fastestTime
    if (aHas !== bHas) return aHas ? -1 : 1
    if (b.kills !== a.kills) return b.kills - a.kills
    if (a.deaths !== b.deaths) return a.deaths - b.deaths
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })

export const rankForBoard = (board, players) => board?.game === 'ventline'
  ? [...players].sort((a, b) => (b.bestScore ?? 0) - (a.bestScore ?? 0) || b.wins - a.wins || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  : rank(players)

/**
 * Kills against deaths, or null where the game keeps neither.
 *
 * Undefeated is measured against one death rather than none, so the answer
 * stays a number instead of infinity and stays comparable to everyone else's.
 *
 * Null rather than zero when there is nothing to divide: somebody with no fight
 * on record anywhere would otherwise read as the worst record rather than an
 * absent one. Titles with no killing at all hide the column instead (`fights`).
 */
export const kd = (row) =>
  row.kills === 0 && row.deaths === 0 ? null : row.kills / Math.max(1, row.deaths)

/** The head of the board, for the strip that rides along in a match snapshot. */
export const top = (board, n = TOP_N) => rankForBoard(board, board?.players ?? []).slice(0, n)

/**
 * Folds one finished match into a board and hands back a new one.
 *
 * `results` is one row per player as the match ended: `{ name, bot, won,
 * kills, deaths }`. Bots are dropped here rather than by each caller, because
 * every caller would otherwise have to remember to.
 *
 * Additive. A match is a delta, never a replacement, which is why the same
 * match must reach this exactly once — see `once`.
 */
export function merge(board, results, at) {
  // Copied, not mutated: a caller that keeps the old board (the in-match strip
  // does) must not watch it change underneath them.
  const players = (board?.players ?? []).map((p) => ({ ...p }))

  for (const r of results ?? []) {
    if (!r || r.bot) continue
    const name = String(r.name ?? '').trim()
    if (!name) continue
    if (board?.game === 'ventline' && !isScore(r.score)) continue

    const row = rowFor(players, name)
    row.wins += r.won ? 1 : 0
    // Floored at nothing. A scoreline is a total that only ever grows, so a
    // negative from anywhere is a bug somewhere else and must not be banked.
    row.kills += Math.max(0, Math.trunc(r.kills ?? 0))
    row.deaths += Math.max(0, Math.trunc(r.deaths ?? 0))
    row.matches += 1
    row.last = at
    if (board?.game === 'ventline') row.bestScore = Math.max(row.bestScore ?? 0, r.score)

    // Fastest clear time: only recorded on a win with a valid time.
    if (r.won && typeof r.time === 'number' && Number.isFinite(r.time) && r.time > 0) {
      row.fastestTime =
        typeof row.fastestTime === 'number' ? Math.min(row.fastestTime, r.time) : r.time
    }

    // Peak WPM and Average Accuracy for typing games
    if (typeof r.wpm === 'number' && Number.isFinite(r.wpm) && r.wpm > 0) {
      row.peakWpm = typeof row.peakWpm === 'number' ? Math.max(row.peakWpm, r.wpm) : r.wpm
    }
    if (typeof r.acc === 'number' && Number.isFinite(r.acc) && r.acc >= 0) {
      row.avgAcc = typeof row.avgAcc === 'number'
        ? Math.round(((row.avgAcc * (row.matches - 1) + r.acc) / row.matches) * 10) / 10
        : r.acc
    }
  }

  // Ranked before the cap, so what falls off the end is the bottom of the
  // board and not whoever happened to arrive last.
  return { ...board, updated: at, players: rankForBoard(board, players).slice(0, MAX_NAMES) }
}

/** Every board added together, one row per name. This is the cross-game table. */
export function combine(boards) {
  const players = []
  for (const board of boards ?? []) {
    const spec = boardFor(board?.game, board?.mode ?? null)
    for (const p of board?.players ?? []) {
      const row = rowFor(players, p.name)
      row.wins += p.wins
      row.matches += p.matches
      row.last = Math.max(row.last, p.last)
      if (spec?.fights) {
        row.kills += p.kills
        row.deaths += p.deaths
      }
      // A best score stays filed under its own title: a Cipher Run finish and a
      // Void Drillers clear are not the same clock, so they are never merged.
      for (const { key } of spec?.bests ?? []) {
        if (typeof p[key] !== 'number') continue
        row.bests ??= {}
        row.bests[spec.file] ??= {}
        row.bests[spec.file][key] = p[key]
      }
    }
  }
  return rank(players)
}

/**
 * Human-readable clear time from milliseconds.
 *
 * Under a minute: `45.2s`. A minute or more: `1:15.3`. Null or absent: an em
 * dash, same as K/D when the game keeps neither kills nor deaths.
 */
export function formatClearTime(ms) {
  if (ms === null || ms === undefined) return '\u2014'
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}

/**
 * One match, banked once.
 *
 * A finished match sits in its `over` phase for several seconds while everyone
 * reads the result, so a wrapper that banked on every frame would count the
 * same match a hundred times. This fires on the edge into a finished match and
 * stays quiet until the next one starts.
 */
export function once() {
  let armed = true
  return (finished) => {
    if (!finished) {
      armed = true
      return false
    }
    if (!armed) return false
    armed = false
    return true
  }
}
