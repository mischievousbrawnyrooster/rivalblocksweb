import { TOP_N, kd } from '../../server/board.js'

/**
 * A kill-to-death ratio, or a dash.
 *
 * The dash is for Blockout Royale, which keeps neither number: there is
 * nothing to shoot, you simply outlast people. Printing 0.00 there would read
 * as the worst record on the board rather than no record at all.
 */
function Ratio({ row }) {
  const r = kd(row)
  if (r === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">no kills or deaths recorded</span>
      </>
    )
  }
  return (
    <>
      {r.toFixed(2)}
      <span className="sr-only"> kills per death</span>
    </>
  )
}

/**
 * The standing leaderboard, in two shapes.
 *
 * `full` gives the whole table with every column; without it you get the head
 * of the board as a compact strip, which is what goes under a game board and
 * on a game page.
 *
 * The rows are already ranked — by `rank` in server/board.js, the same
 * function the match server sorted them with before writing the file. Nothing
 * here re-sorts, so a page can never disagree with the board it is showing.
 */
export default function Leaderboard({ entries = [], limit = TOP_N, you = null, full = false }) {
  const rows = limit === null ? entries : entries.slice(0, limit)

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        No match has been taken yet. Finish one and the board is yours to open.
      </p>
    )
  }

  // Whoever is reading gets found by name, because a name is all the board
  // keeps. Marked with a glyph and aria-current as well as a colour: the site
  // never says anything with colour alone.
  const mine = (name) => you !== null && name === you

  if (!full) {
    return (
      <ol className="space-y-1.5">
        {rows.map((p, i) => (
          <li
            key={p.name}
            aria-current={mine(p.name) ? 'true' : undefined}
            className={`flex items-baseline gap-2.5 text-sm ${mine(p.name) ? 'text-flare' : ''}`}
          >
            <span className="w-4 shrink-0 text-right font-mono text-xs text-muted">{i + 1}</span>
            <span className="w-3 shrink-0 text-xs" aria-hidden="true">
              {mine(p.name) ? '▸' : ''}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {p.name}
              {mine(p.name) && <span className="sr-only"> — you</span>}
            </span>
            <span className="w-6 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
              {p.wins}
              <span className="sr-only"> {p.wins === 1 ? 'match won' : 'matches won'}</span>
            </span>
            <span className="w-9 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
              <Ratio row={p} />
            </span>
          </li>
        ))}
      </ol>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="rule-label py-2 pr-3">
              #
            </th>
            <th scope="col" className="rule-label py-2 pr-3">
              Name
            </th>
            <th scope="col" className="rule-label py-2 pr-3 text-right">
              Won
            </th>
            <th scope="col" className="rule-label py-2 pr-3 text-right">
              Played
            </th>
            <th scope="col" className="rule-label py-2 pr-3 text-right">
              Kills
            </th>
            <th scope="col" className="rule-label py-2 pr-3 text-right">
              Deaths
            </th>
            <th scope="col" className="rule-label py-2 text-right">
              K/D
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr
              key={p.name}
              aria-current={mine(p.name) ? 'true' : undefined}
              className={`border-b border-line/60 ${mine(p.name) ? 'text-flare' : ''}`}
            >
              <td className="py-2 pr-3 font-mono text-xs text-muted">{i + 1}</td>
              <td className="py-2 pr-3">
                <span aria-hidden="true" className="mr-1.5 inline-block w-3 text-xs">
                  {mine(p.name) ? '▸' : ''}
                </span>
                {p.name}
                {mine(p.name) && <span className="sr-only"> — you</span>}
              </td>
              <td className="py-2 pr-3 text-right font-mono">{p.wins}</td>
              <td className="py-2 pr-3 text-right font-mono text-muted">{p.matches}</td>
              <td className="py-2 pr-3 text-right font-mono text-muted">{p.kills}</td>
              <td className="py-2 pr-3 text-right font-mono text-muted">{p.deaths}</td>
              <td className="py-2 text-right font-mono tabular-nums">
                <Ratio row={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
