import { BOARDS, TOP_N, kd, formatClearTime } from '../../server/board.js'

/**
 * A kill-to-death ratio, or a dash.
 *
 * The dash is for somebody with no kills or deaths on record. Printing 0.00
 * there would read as the worst record on the board rather than no record at
 * all. Titles with no killing never get here: they hide the column.
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

/** One best score in its cell: a clear time, or words per minute. */
function Best({ col, row }) {
  const v = col.get(row)
  if (typeof v !== 'number') {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">no {col.label.toLowerCase()} yet</span>
      </>
    )
  }
  return (
    <>
      {col.key === 'peakWpm' ? v.toFixed(1) : formatClearTime(v)}
      <span className="sr-only"> {col.label.toLowerCase()}</span>
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
 * `spec` is the title's entry in BOARDS and decides the columns: K/D only where
 * somebody gets killed, and a column for each best score that title records.
 * Without one the rows are the cross-title table from `combine`, where each
 * best score stays under the title it was set in and is headed with its name.
 *
 * The rows are already ranked — by `rank` in server/board.js, the same
 * function the match server sorted them with before writing the file. Nothing
 * here re-sorts, so a page can never disagree with the board it is showing.
 */
export default function Leaderboard({ entries = [], limit = TOP_N, you = null, full = false, spec = null }) {
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
  const fights = spec ? spec.fights : true
  const offered = spec
    ? spec.bests.map((b) => ({ ...b, id: b.key, get: (p) => p[b.key] }))
    : full
      ? BOARDS.flatMap((s) =>
          s.bests.map((b) => ({ ...b, id: `${s.file}:${b.key}`, title: s.title, get: (p) => p.bests?.[s.file]?.[b.key] })),
        )
      : []
  // A column nobody on this board has a score in yet is left off.
  const bests = offered.filter((col) => rows.some((p) => typeof col.get(p) === 'number'))

  if (!full) {
    return (
      <div>
        <div
          aria-hidden="true"
          className="flex items-baseline gap-2.5 pb-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted"
        >
          <span className="w-4 shrink-0" />
          <span className="w-3 shrink-0" />
          <span className="min-w-0 flex-1" />
          <span className="w-8 shrink-0 text-right">Won</span>
          {bests.map((col) => (
            <span key={col.id} className="w-12 shrink-0 text-right">
              {col.short}
            </span>
          ))}
          {fights && <span className="w-9 shrink-0 text-right">K/D</span>}
        </div>
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
                {mine(p.name) && <span className="sr-only">, you</span>}
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
                {p.wins}
                <span className="sr-only"> {p.wins === 1 ? 'match won' : 'matches won'}</span>
              </span>
              {bests.map((col) => (
                <span key={col.id} className="w-12 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
                  <Best col={col} row={p} />
                </span>
              ))}
              {fights && (
                <span className="w-9 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
                  <Ratio row={p} />
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line align-bottom">
            <th scope="col" className="rule-label py-2 pr-3">
              #
            </th>
            <th scope="col" className="rule-label py-2 pr-3">
              Name
            </th>
            <th scope="col" className="rule-label py-2 pr-3 text-right">
              Won
            </th>
            {bests.map((col) => (
              <th key={col.id} scope="col" className="rule-label py-2 pr-3 text-right">
                {col.title && <span className="block text-muted">{col.title}</span>}
                {col.label}
              </th>
            ))}
            <th scope="col" className="rule-label py-2 pr-3 text-right">
              Played
            </th>
            {fights && (
              <>
                <th scope="col" className="rule-label py-2 pr-3 text-right">
                  Kills
                </th>
                <th scope="col" className="rule-label py-2 pr-3 text-right">
                  Deaths
                </th>
                <th scope="col" className="rule-label py-2 text-right">
                  K/D
                </th>
              </>
            )}
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
                {mine(p.name) && <span className="sr-only">, you</span>}
              </td>
              <td className="py-2 pr-3 text-right font-mono">{p.wins}</td>
              {bests.map((col) => (
                <td key={col.id} className="py-2 pr-3 text-right font-mono text-muted tabular-nums">
                  <Best col={col} row={p} />
                </td>
              ))}
              <td className="py-2 pr-3 text-right font-mono text-muted">{p.matches}</td>
              {fights && (
                <>
                  <td className="py-2 pr-3 text-right font-mono text-muted">{p.kills}</td>
                  <td className="py-2 pr-3 text-right font-mono text-muted">{p.deaths}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    <Ratio row={p} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
