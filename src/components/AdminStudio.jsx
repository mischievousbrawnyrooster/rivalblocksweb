import { games } from '../data/games.js'
import { regions, statusLabels } from '../data/servers.js'

const fmt = (n) => n.toLocaleString('en-US')

/**
 * A day's shape, derived from the region list rather than invented per render,
 * so the console reads the same on a refresh as it did a moment before.
 */
function curve(points, seed) {
  const out = []
  let v = seed
  for (let i = 0; i < points; i++) {
    // Fixed arithmetic, no randomness: a dashboard that jitters when nobody
    // touched it is a dashboard nobody trusts.
    v = (v * 9301 + 49297) % 233280
    const hour = i / (points - 1)
    const daily = 0.55 + 0.45 * Math.sin((hour - 0.25) * Math.PI * 2)
    out.push(daily * (0.85 + (v / 233280) * 0.3))
  }
  return out
}

function Spark({ series, label }) {
  const max = Math.max(...series)
  const w = 100
  const h = 28
  const d = series
    .map((v, i) => `${(i / (series.length - 1)) * w},${h - (v / max) * h}`)
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-3 h-8 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function AdminStudio() {
  const online = regions.reduce((n, r) => n + r.players, 0)
  const healthy = regions.filter((r) => r.status === 'operational').length
  const capacity = regions.filter((r) => r.tickRate > 0).length
  const meanUptime = regions.reduce((n, r) => n + r.uptime, 0) / regions.length

  const concurrency = curve(24, online % 233280)
  const queue = curve(24, healthy * 7919)

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-line bg-surface p-5 text-flare">
          <p className="rule-label text-muted">Players online</p>
          <p className="display mt-1.5 text-3xl tabular-nums text-fg">{fmt(online)}</p>
          <Spark series={concurrency} label="Concurrency across the last twenty-four hours" />
        </div>
        <div className="border border-line bg-surface p-5 text-live">
          <p className="rule-label text-muted">Median queue</p>
          <p className="display mt-1.5 text-3xl tabular-nums text-fg">7.4s</p>
          <Spark series={queue} label="Queue time across the last twenty-four hours" />
        </div>
        <div className="border border-line bg-surface p-5">
          <p className="rule-label">Regions healthy</p>
          <p className="display mt-1.5 text-3xl tabular-nums">
            {healthy}
            <span className="text-lg text-muted">/{regions.length}</span>
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {capacity} serving traffic, {regions.length - capacity} out for scheduled work.
          </p>
        </div>
        <div className="border border-line bg-surface p-5">
          <p className="rule-label">Fleet uptime</p>
          <p className="display mt-1.5 text-3xl tabular-nums">{meanUptime.toFixed(2)}%</p>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Rolling thirty days, weighted evenly across regions.
          </p>
        </div>
      </div>

      <section className="border border-line">
        <p className="rule-label border-b border-line bg-surface px-5 py-3">Titles</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="rule-label px-5 py-3 font-normal">Title</th>
              <th className="rule-label px-5 py-3 font-normal">Status</th>
              <th className="rule-label px-5 py-3 text-right font-normal">Share of players</th>
              <th className="rule-label px-5 py-3 text-right font-normal">Browser trial</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g, i) => {
              const share = [0.46, 0.31, 0.23][i] ?? 0
              return (
                <tr key={g.slug} className="border-b border-line/60">
                  <td className="px-5 py-3">{g.title}</td>
                  <td className="px-5 py-3">
                    <span className={g.statusTone === 'live' ? 'text-live' : 'text-warn'}>
                      {g.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">
                    {Math.round(share * 100)}% · {fmt(Math.round(online * share))}
                  </td>
                  <td className="px-5 py-3 text-right text-muted">
                    {g.playPath ? 'Live' : 'Not published'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="border border-line">
        <p className="rule-label border-b border-line bg-surface px-5 py-3">Regions</p>
        <ul className="divide-y divide-line">
          {regions.map((r) => {
            const tone =
              r.status === 'operational'
                ? 'text-live'
                : r.status === 'degraded'
                  ? 'text-warn'
                  : 'text-muted'
            return (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <span aria-hidden="true" className={tone}>
                  ●
                </span>
                <span className="min-w-40">{r.label}</span>
                <span className="text-muted">{r.city}</span>
                <span className={`rule-label ${tone}`}>{statusLabels[r.status]}</span>
                <span className="ml-auto font-mono text-xs tabular-nums text-muted">
                  {fmt(r.players)} online · {r.tickRate} tick · {r.uptime}%
                </span>
                {r.note && <p className="w-full text-xs leading-relaxed text-muted">{r.note}</p>}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
