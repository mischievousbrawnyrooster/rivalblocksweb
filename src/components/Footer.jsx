import { Link } from 'react-router-dom'
import { games } from '../data/games.js'
import { fleetStats } from '../data/servers.js'

export default function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="block h-3.5 w-3.5 bg-flare" aria-hidden="true" />
            <span className="display text-base">RivalBlocks</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            We build multiplayer block games and run the servers they live on.
            No third-party hosting, no rented match services.
          </p>
        </div>

        <div>
          <h2 className="rule-label">Games</h2>
          <ul className="mt-4 space-y-2.5">
            {games.map((g) => (
              <li key={g.slug}>
                <Link
                  to={`/games/${g.slug}`}
                  className="text-sm text-muted transition-colors hover:text-flare"
                >
                  {g.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="rule-label">Studio</h2>
          <ul className="mt-4 space-y-2.5">
            <li>
              <Link to="/servers" className="text-sm text-muted transition-colors hover:text-flare">
                Server status
              </Link>
            </li>
            <li>
              <Link to="/about" className="text-sm text-muted transition-colors hover:text-flare">
                About us
              </Link>
            </li>
            <li>
              <Link to="/about#careers" className="text-sm text-muted transition-colors hover:text-flare">
                Careers
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="rule-label">Fleet</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Regions</dt>
              <dd className="font-mono">{fleetStats.regions}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Tick rate</dt>
              <dd className="font-mono">{fleetStats.tickRate}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Uptime</dt>
              <dd className="font-mono">{fleetStats.uptime}%</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-6 text-xs text-muted">
          © {new Date().getFullYear()} RivalBlocks. All trademarks are property
          of their respective owners.
        </p>
      </div>
    </footer>
  )
}
