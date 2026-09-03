// Reading the standing leaderboard from a page.
//
// The files are written by the match servers and served straight off disk, so
// this is a plain GET of plain JSON — the same text a match server wrote, and
// the same text you would see opening the file in an editor.

import { useEffect, useState } from 'react'
import { BOARDS, combine, isBoard } from '../../server/board.js'

/**
 * One file, or nothing.
 *
 * A server that has never finished a match has no file yet, and a file that
 * has been damaged is no better than a missing one. Both mean "no board yet",
 * which is a state the page has to draw anyway.
 */
async function fetchOne(spec, signal) {
  try {
    const res = await fetch(`/board/${spec.file}`, { signal, cache: 'no-store' })
    if (!res.ok) return null
    const board = await res.json()
    return isBoard(board) ? board : null
  } catch {
    return null
  }
}

/**
 * The leaderboard as the pages use it.
 *
 * `all` is every game added together, one row per name — the cross-game table.
 * `byGame` keeps them separate for the breakdown. `ready` is false only until
 * the first read finishes, so a page can tell "still loading" from "nobody has
 * finished a match yet", which look identical otherwise.
 */
export function useBoard() {
  // Seeded with the four boards already listed and empty, so the shape a page
  // renders is the same before and after the fetch. Only `board` and `ready`
  // change, which means a page can draw its sections immediately and swap in a
  // loading line — rather than popping the whole section into existence once
  // the request lands.
  const [state, setState] = useState(() => ({
    all: [],
    byGame: BOARDS.map((spec) => ({ ...spec, board: null })),
    ready: false,
  }))

  useEffect(() => {
    const stop = new AbortController()
    Promise.all(BOARDS.map((spec) => fetchOne(spec, stop.signal))).then((boards) => {
      if (stop.signal.aborted) return
      setState({
        all: combine(boards),
        byGame: BOARDS.map((spec, i) => ({ ...spec, board: boards[i] })),
        ready: true,
      })
    })
    return () => stop.abort()
  }, [])

  return state
}

/**
 * The boards belonging to one title, matched off its play route — Blastworks
 * has two, one per mode, and the other titles have one each.
 */
export const boardsOf = (byGame, playPath) =>
  byGame.filter((b) => (playPath ?? '').includes(b.game))
