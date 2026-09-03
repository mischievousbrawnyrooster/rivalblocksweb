// The only file in the project that reads or writes a leaderboard. It makes no
// decision about what a board contains or how it is ordered — that is board.js,
// which stays pure so it can also run in the browser.
//
// Synchronous on purpose. A match ends every few minutes and a board is a few
// kilobytes; one millisecond inside one tick, that rarely, is cheaper than the
// interleaving an async write would let in.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyBoard, isBoard, merge, once, top } from './board.js'

/** Where the four files live. Set by the systemd units; a repo folder in dev. */
export const boardDir = (env = process.env) => env.BOARD_DIR || 'data'

/**
 * The board for one server, or an empty one.
 *
 * Every failure lands here: no directory yet, no file yet, a truncated file, a
 * file somebody edited by hand into the wrong shape. All of them mean the same
 * thing to a match server — there is no board yet — and none of them may stop
 * it starting. A lost leaderboard is a nuisance; a match server that will not
 * boot is an outage.
 */
export function load(dir, spec) {
  try {
    const raw = JSON.parse(readFileSync(join(dir, spec.file), 'utf8'))
    if (!isBoard(raw)) return emptyBoard(spec.game, spec.mode)
    return { ...emptyBoard(spec.game, spec.mode), ...raw }
  } catch {
    return emptyBoard(spec.game, spec.mode)
  }
}

/**
 * Writes a board, atomically. Returns whether it went.
 *
 * Serialised in full before anything on disk is touched, then written beside
 * the real file and renamed over it. A rename within a directory is atomic, so
 * a crash — or a board that cannot be serialised at all — leaves the previous
 * board intact rather than half of a new one. Anyone reading the file sees one
 * whole board or the other, never a partial one.
 */
export function save(dir, spec, board) {
  const target = join(dir, spec.file)
  const temp = `${target}.tmp`
  let text
  try {
    text = `${JSON.stringify(board, null, 2)}\n`
  } catch {
    return false
  }
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(temp, text)
    renameSync(temp, target)
    return true
  } catch {
    rmSync(temp, { force: true })
    return false
  }
}

/**
 * The leaderboard side of one match server: holds that server's board in
 * memory, hands out the strip that rides along in the snapshot, and banks a
 * result the moment a match finishes.
 *
 * It decides nothing about ordering or contents — merge and top do that — and
 * nothing about when a match is over, which only the game knows. It exists so
 * that four wrappers do not each carry their own copy of load-merge-save.
 *
 * `results` is a function rather than a list because it is only worth building
 * on the one frame in a whole match where it is actually banked.
 */
export function keeper(spec, dir = boardDir()) {
  let board = load(dir, spec)
  const firstFrameOf = once()
  return {
    top: () => top(board),
    bank(finished, results) {
      if (!firstFrameOf(finished)) return false
      const rows = results()
      // Nobody to credit. An operator watching bots play each other in /admin
      // would otherwise rewrite the file every few minutes to change one
      // timestamp, and the board would look like it was moving when it is not.
      if (rows.length === 0) return false
      board = merge(board, rows, Date.now())
      // A board that cannot be written is still correct in memory, so the
      // match carries on and the next result tries again.
      save(dir, spec, board)
      return true
    },
  }
}
