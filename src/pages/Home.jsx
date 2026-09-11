import { Link } from 'react-router-dom'
import GameCard from '../components/GameCard.jsx'
import GameCarousel from '../components/GameCarousel.jsx'
import NewsletterForm from '../components/NewsletterForm.jsx'
import { games } from '../data/games.js'
import { fleetStats } from '../data/servers.js'
import { useTitle } from '../lib/useTitle.js'

export default function Home() {
  useTitle('Multiplayer block games on servers we run ourselves')

  return (
    <>
      {/* ---------- Hero ---------- */}
      <GameCarousel games={games} />

      {/* ---------- Fleet ---------- */}
      <section className="border-b border-line">
        <dl className="mx-auto flex max-w-6xl flex-wrap gap-x-10 gap-y-4 px-5 py-8">
          <div>
            <dt className="rule-label">Regions</dt>
            <dd className="mt-1 font-mono text-xl">{fleetStats.regions}</dd>
          </div>
          <div>
            <dt className="rule-label">Tick rate</dt>
            <dd className="mt-1 font-mono text-xl">{fleetStats.tickRate}</dd>
          </div>
          <div>
            <dt className="rule-label">Uptime</dt>
            <dd className="mt-1 font-mono text-xl">{fleetStats.uptime}%</dd>
          </div>
          <div>
            <dt className="rule-label">Players online</dt>
            <dd className="mt-1 font-mono text-xl">
              {fleetStats.players.toLocaleString('en-US')}
            </dd>
          </div>
        </dl>
      </section>

      {/* ---------- Games ---------- */}
      <section className="reveal mx-auto max-w-6xl px-5 py-20">
        <div className="flex flex-wrap items-end gap-4 border-b border-line pb-5">
          <div>
            <p className="rule-label">Our games</p>
            <h2 className="display mt-2 text-3xl sm:text-4xl">Three ways to lose a wall</h2>
          </div>
          <Link
            to="/games"
            className="ml-auto text-xs uppercase tracking-[0.16em] text-flare hover:underline"
          >
            View all →
          </Link>
        </div>

        <div className="mt-10 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {games.map((g) => (
            <GameCard key={g.slug} game={g} />
          ))}
        </div>
      </section>

      {/* ---------- Servers ---------- */}
      <section className="reveal border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2">
          <div>
            <p className="rule-label">Infrastructure</p>
            <h2 className="display mt-2 text-3xl sm:text-4xl">
              We run our own metal
            </h2>
            <p className="mt-5 leading-relaxed text-muted">
              Most studios rent match services and hope. We own the racks in all{' '}
              {fleetStats.regions} regions, write the netcode that runs on them,
              and publish the numbers whether or not they flatter us.
            </p>
            <p className="mt-4 leading-relaxed text-muted">
              That is why every region runs at {fleetStats.tickRate} tick instead
              of one showcase region, why a Blastworks chain resolves the same
              way for everyone standing near it, and why a bad night shows up on
              our status page before it shows up on yours.
            </p>
            <Link
              to="/servers"
              className="mt-8 inline-block border border-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-flare transition-colors hover:bg-flare hover:text-on-flare"
            >
              Live server status
            </Link>
          </div>

          <ul className="grid gap-5 sm:grid-cols-2 lg:content-start">
            {[
              ['No rented matchmaking', 'Queue logic is ours, so we can fix it at 3am instead of filing a ticket.'],
              ['Published incidents', 'Degraded regions are labelled degraded, with the reason, not hidden behind a green dot.'],
              ['Regional ladders', 'Ranked pools are per-region, so nobody climbs on 200ms of advantage.'],
              ['Capacity kept spare', 'Idle headroom in every region is what makes a ten-second queue possible.'],
            ].map(([title, body]) => (
              <li key={title} className="border border-line bg-bg p-5">
                <h3 className="text-sm font-bold uppercase tracking-[0.08em]">{title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Signup ---------- */}
      <section className="reveal mx-auto max-w-2xl px-5 py-20 text-center">
        <h2 className="display text-3xl sm:text-4xl">Next season drops soon</h2>
        <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted">
          Patch notes, playtest invites, and nothing else. We do not sell the
          list and we do not email twice a week.
        </p>
        <div className="mt-9 text-left">
          <NewsletterForm />
        </div>
      </section>
    </>
  )
}
