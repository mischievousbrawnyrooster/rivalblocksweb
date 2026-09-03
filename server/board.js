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
export const BOARDS = [
  { file: 'board-blockout.json', game: 'blockout', mode: null, title: 'Blockout Royale' },
  { file: 'board-fracture.json', game: 'fracture', mode: null, title: 'Fracture Line' },
  {
    file: 'board-blastworks-lastman.json',
    game: 'blastworks',
    mode: 'lastman',
    title: 'Blastworks: Last man standing',
  },
  {
    file: 'board-blastworks-deathmatch.json',
    game: 'blastworks',
    mode: 'deathmatch',
    title: 'Blastworks: Deathmatch',
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

const isRow = (r) =>
  !!r &&
  typeof r.name === 'string' &&
  ['wins', 'kills', 'deaths', 'matches', 'last'].every((k) => Number.isFinite(r[k]))

/**
 * Whether something read off disk is a board.
 *
 * Checked rather than trusted: the file is plain text on a machine people have
 * shell access to, and a board that has been edited by hand into the wrong
 * shape must read as "no board yet", never as a crash inside a match server.
 */
export const isBoard = (b) =>
  !!b && typeof b === 'object' && Array.isArray(b.players) && b.players.every(isRow)

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
    row = { name, wins: 0, kills: 0, deaths: 0, matches: 0, last: 0 }
    players.push(row)
  }
  return row
}

/** Best first: wins, then kills, then fewest deaths, then name. */
export const rank = (players) =>
  [...players].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.kills - a.kills ||
      a.deaths - b.deaths ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )

/**
 * Kills against deaths, or null where the game keeps neither.
 *
 * Undefeated is measured against one death rather than none, so the answer
 * stays a number instead of infinity and stays comparable to everyone else's.
 *
 * Null rather than zero when there is nothing to divide: Blockout Royale has
 * no kills and no deaths — you outlast people, you do not shoot them — and a
 * zero there would read as a terrible record rather than an absent one.
 */
export const kd = (row) =>
  row.kills === 0 && row.deaths === 0 ? null : row.kills / Math.max(1, row.deaths)

/** The head of the board, for the strip that rides along in a match snapshot. */
export const top = (board, n = TOP_N) => rank(board?.players ?? []).slice(0, n)

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

    const row = rowFor(players, name)
    row.wins += r.won ? 1 : 0
    // Floored at nothing. A scoreline is a total that only ever grows, so a
    // negative from anywhere is a bug somewhere else and must not be banked.
    row.kills += Math.max(0, Math.trunc(r.kills ?? 0))
    row.deaths += Math.max(0, Math.trunc(r.deaths ?? 0))
    row.matches += 1
    row.last = at
  }

  // Ranked before the cap, so what falls off the end is the bottom of the
  // board and not whoever happened to arrive last.
  return { ...board, updated: at, players: rank(players).slice(0, MAX_NAMES) }
}

/** Every board added together, one row per name. This is the cross-game table. */
export function combine(boards) {
  const players = []
  for (const board of boards ?? []) {
    for (const p of board?.players ?? []) {
      const row = rowFor(players, p.name)
      row.wins += p.wins
      row.kills += p.kills
      row.deaths += p.deaths
      row.matches += p.matches
      row.last = Math.max(row.last, p.last)
    }
  }
  return rank(players)
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
