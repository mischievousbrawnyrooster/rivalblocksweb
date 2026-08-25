import StatusTable from '../components/StatusTable.jsx'
import { regions, fleetStats } from '../data/servers.js'
import { useTitle } from '../lib/useTitle.js'

const counts = regions.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
const allGood = (counts.operational ?? 0) === regions.length

export default function Servers() {
  useTitle('Server status')

  return (
    <>
      <header className="blueprint border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="rule-label">Infrastructure</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Server status</h1>
          <p className="mt-5 max-w-2xl leading-relaxed text-muted">
            Every RivalBlocks match runs on hardware we own and configure. These
            are the live numbers for all {fleetStats.regions} regions, including
            the ones having a bad day.
          </p>

          <p
            className={`mt-8 inline-block border px-4 py-2.5 text-sm ${
              allGood ? 'border-live/40 text-live' : 'border-warn/40 text-warn'
            }`}
          >
            <span aria-hidden="true">● </span>
            {allGood
              ? 'All regions operational'
              : `${counts.operational ?? 0} operational · ${counts.degraded ?? 0} degraded · ${counts.maintenance ?? 0} in maintenance`}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-16">
        <StatusTable regions={regions} />

        <div className="mt-16 grid gap-6 border-t border-line pt-12 md:grid-cols-3">
          {[
            [
              'What "128 tick" means',
              'The server recalculates the world 128 times a second. A shot you land is judged on a snapshot 7.8ms wide instead of 15.6ms. It is the difference between a peek that works and one that does not.',
            ],
            [
              'How uptime is measured',
              'Rolling 30 days, counted from the player side: a region is up only if matchmaking placed players into matches. Internal health checks passing is not enough to count.',
            ],
            [
              'Why we publish the bad days',
              'A status page that is always green is a status page nobody trusts. Degraded regions are labelled degraded, with the cause, while we fix them.',
            ],
          ].map(([title, body]) => (
            <section key={title}>
              <h2 className="text-sm font-bold uppercase tracking-[0.08em]">{title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
