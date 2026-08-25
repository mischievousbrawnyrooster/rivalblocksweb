import { useId, useMemo, useState } from 'react'
import { filterSortRegions } from '../lib/servers.js'
import { statusLabels } from '../data/servers.js'

const TONE = {
  operational: 'text-live',
  degraded: 'text-warn',
  maintenance: 'text-idle',
}

const SORTS = [
  { value: 'label', label: 'Region name' },
  { value: 'players', label: 'Players online' },
  { value: 'tickRate', label: 'Tick rate' },
  { value: 'uptime', label: 'Uptime' },
]

export default function StatusTable({ regions }) {
  const id = useId()
  const [status, setStatus] = useState('all')
  const [sortBy, setSortBy] = useState('label')

  const rows = useMemo(
    () => filterSortRegions(regions, { status, sortBy }),
    [regions, status, sortBy],
  )

  const selectClass =
    'border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-flare focus:outline-none'

  return (
    <div>
      <div className="flex flex-wrap items-end gap-5">
        <div>
          <label htmlFor={`${id}-status`} className="rule-label block">
            Status
          </label>
          <select
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`mt-2 ${selectClass}`}
          >
            <option value="all">All regions</option>
            <option value="operational">Operational</option>
            <option value="degraded">Degraded</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-sort`} className="rule-label block">
            Sort by
          </label>
          <select
            id={`${id}-sort`}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className={`mt-2 ${selectClass}`}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <p aria-live="polite" className="ml-auto text-sm text-muted">
          Showing {rows.length} of {regions.length} regions
        </p>
      </div>

      {/* Wide table scrolls inside its own box so the page never scrolls sideways. */}
      <div className="mt-6 overflow-x-auto border border-line">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">
            RivalBlocks game server regions, with status, players online, tick
            rate and 30-day uptime.
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface text-left">
              <th scope="col" className="rule-label px-4 py-3">Region</th>
              <th scope="col" className="rule-label px-4 py-3">Status</th>
              <th scope="col" className="rule-label px-4 py-3 text-right">Players</th>
              <th scope="col" className="rule-label px-4 py-3 text-right">Tick</th>
              <th scope="col" className="rule-label px-4 py-3 text-right">Uptime</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  No regions match that filter.
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 align-top">
                <th scope="row" className="px-4 py-4 text-left font-normal">
                  <span className="block font-semibold">{r.label}</span>
                  <span className="text-muted">{r.city}</span>
                  {r.note && (
                    <span className="mt-1.5 block max-w-md text-xs leading-relaxed text-muted">
                      {r.note}
                    </span>
                  )}
                </th>
                <td className="px-4 py-4">
                  {/* Dot plus text: status is never colour alone. */}
                  <span className={`${TONE[r.status]} whitespace-nowrap`}>
                    <span aria-hidden="true">● </span>
                    {statusLabels[r.status]}
                  </span>
                </td>
                <td className="px-4 py-4 text-right font-mono">
                  {r.players.toLocaleString('en-US')}
                </td>
                <td className="px-4 py-4 text-right font-mono">
                  {r.tickRate === 0 ? '—' : r.tickRate}
                </td>
                <td className="px-4 py-4 text-right font-mono">{r.uptime.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
