import { Link } from 'react-router-dom'
import NewsletterForm from '../components/NewsletterForm.jsx'
import { fleetStats } from '../data/servers.js'
import { useTitle } from '../lib/useTitle.js'

const values = [
  [
    'Own the stack',
    'Netcode, matchmaking and the machines underneath are all ours. When something breaks we can read the actual code, not a vendor status page.',
  ],
  [
    'Publish the numbers',
    'Uptime, tick rate and incident causes go on the public status page whether or not the month went well.',
  ],
  [
    'Ranked has to be fair',
    'Regional pools, server-authoritative hit registration, and no paid advantage of any kind. Ever.',
  ],
  [
    'Ship when it holds',
    'Seasons land when the build survives a full week of internal ladder play, not when the calendar says so.',
  ],
]

const teams = [
  ['Engine', 'Block simulation, destruction, and the physics that decides what falls.'],
  ['Netcode', 'Rollback, prediction, and keeping 128 tick honest across twelve regions.'],
  ['Infrastructure', 'The racks, the deploys, and the pager.'],
  ['Design', 'Maps, modes, and the ranked system.'],
]

export default function About() {
  useTitle('Studio')

  return (
    <>
      <header className="blueprint blueprint-drift border-b border-line">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2">
          <div>
            <p className="rule-label">Studio</p>
            <h1 className="display mt-2 text-4xl sm:text-5xl">
              A small studio that runs its own servers
            </h1>
            <p className="mt-5 leading-relaxed text-muted">
              RivalBlocks builds multiplayer games out of destructible blocks,
              and operates the {fleetStats.regions} regions they run on. We are
              engineers who got tired of shipping competitive games onto
              infrastructure we could not inspect, so we stopped doing that.
            </p>
            <p className="mt-4 leading-relaxed text-muted">
              Everything we make is multiplayer, server-authoritative, and built
              on one simulation. A wall behaves the same way in a ranked 5v5 as
              it does four hundred metres underground.
            </p>
          </div>
          <div className="flex justify-center">
            <div className="relative w-full max-w-lg aspect-16/9 overflow-hidden border border-line bg-surface shadow-2xl transition-transform duration-500 hover:scale-[1.02]">
              <img
                src="/art/studio-operations.jpg"
                alt="RivalBlocks studio engineering and operations center"
                className="h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 border border-flare/20" />
            </div>
          </div>
        </div>
      </header>

      <section className="reveal mx-auto max-w-6xl px-5 py-20">
        <p className="rule-label">What we hold to</p>
        <h2 className="display mt-2 text-3xl sm:text-4xl">Values</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {values.map(([title, body]) => (
            <article key={title} className="border-l-2 border-flare bg-surface p-6">
              <h3 className="text-sm font-bold uppercase tracking-[0.08em]">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="reveal border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="rule-label">How we are organised</p>
          <h2 className="display mt-2 text-3xl sm:text-4xl">Four teams</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {teams.map(([name, body], i) => (
              <article key={name} className="border border-line bg-bg p-6">
                <span className="font-mono text-sm text-flare">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-3 text-sm font-bold uppercase tracking-[0.08em]">{name}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="careers" className="reveal mx-auto max-w-3xl scroll-mt-24 px-5 py-20 text-center">
        <p className="rule-label">Careers</p>
        <h2 className="display mt-2 text-3xl sm:text-4xl">We hire slowly</h2>
        <p className="mx-auto mt-5 max-w-xl leading-relaxed text-muted">
          There are no open roles right now. When there are, they go on the
          mailing list before anywhere else. Mostly netcode and infrastructure,
          occasionally engine.
        </p>
        <Link
          to="/servers"
          className="mt-8 inline-block border border-line px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-muted transition-colors hover:border-flare hover:text-flare"
        >
          See what we run
        </Link>
        <div className="mt-14 text-left">
          <NewsletterForm />
        </div>
      </section>
    </>
  )
}
