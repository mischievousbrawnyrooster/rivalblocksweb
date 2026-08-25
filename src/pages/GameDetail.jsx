import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BlockArt from '../components/BlockArt.jsx'
import Lightbox from '../components/Lightbox.jsx'
import NewsletterForm from '../components/NewsletterForm.jsx'
import NotFound from './NotFound.jsx'
import { getGame } from '../data/games.js'
import { useTitle } from '../lib/useTitle.js'

export default function GameDetail() {
  const { slug } = useParams()
  const game = getGame(slug)

  const [openShot, setOpenShot] = useState(null)
  // Where focus goes when the lightbox closes.
  const openerRef = useRef(null)

  // Called before the early return — hooks cannot run conditionally.
  useTitle(game ? game.title : 'Page not found')

  // An unknown slug is a missing page, not a crash.
  if (!game) return <NotFound />

  const tone = game.statusTone === 'live' ? 'text-live' : 'text-warn'

  function open(e, i) {
    openerRef.current = e.currentTarget
    setOpenShot(i)
  }

  function close() {
    setOpenShot(null)
    openerRef.current?.focus()
  }

  return (
    <>
      {/* ---------- Hero ---------- */}
      <section className="blueprint border-b border-line">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2">
          <div>
            <Link
              to="/games"
              className="text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
            >
              ← All games
            </Link>

            <div className="mt-6 flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.16em]">
              <span className={tone} aria-hidden="true">●</span>
              <span className={tone}>{game.status}</span>
            </div>

            <h1 className="display mt-3 text-5xl sm:text-6xl">{game.title}</h1>
            <p className="mt-3 text-lg text-flare">{game.tagline}</p>
            <p className="mt-5 border-l-2 border-flare pl-4 leading-relaxed text-muted">
              {game.blurb}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                className="bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
              >
                Play free
              </button>
              <Link
                to="/servers"
                className="border border-line px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-muted transition-colors hover:border-flare hover:text-flare"
              >
                Server status
              </Link>
            </div>

            <dl className="mt-10 grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
              <div>
                <dt className="rule-label">Genre</dt>
                <dd className="mt-1.5 text-sm">{game.genre}</dd>
              </div>
              <div>
                <dt className="rule-label">Platforms</dt>
                <dd className="mt-1.5 text-sm">{game.platforms.join(' · ')}</dd>
              </div>
            </dl>
          </div>

          <div className="flex justify-center">
            <BlockArt
              variant={game.art.variant}
              seed={game.art.seed}
              className="w-full max-w-lg"
            />
          </div>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <p className="rule-label">What makes it</p>
        <h2 className="display mt-2 text-3xl sm:text-4xl">Features</h2>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {game.features.map((f, i) => (
            <article key={f.title} className="border border-line bg-surface p-6">
              <span className="font-mono text-sm text-flare">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-3 text-lg font-bold uppercase tracking-[0.04em]">
                {f.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- Gallery ---------- */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="rule-label">Screenshots</p>
          <h2 className="display mt-2 text-3xl sm:text-4xl">In motion</h2>

          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {game.shots.map((s, i) => (
              <li key={s.seed}>
                <button
                  type="button"
                  onClick={(e) => open(e, i)}
                  className="group block w-full border border-line bg-bg text-left transition-colors hover:border-flare"
                >
                  <span className="blueprint flex aspect-4/3 items-center justify-center overflow-hidden p-4">
                    <BlockArt
                      variant={game.art.variant}
                      seed={s.seed}
                      className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                    />
                  </span>
                  <span className="block border-t border-line px-3 py-2.5 text-xs leading-relaxed text-muted">
                    {s.caption}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Server note ---------- */}
      <section className="mx-auto max-w-3xl px-5 py-20 text-center">
        <p className="rule-label">On our servers</p>
        <p className="display mt-4 text-2xl leading-snug sm:text-3xl">
          {game.serverNote}
        </p>
        <Link
          to="/servers"
          className="mt-8 inline-block border border-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-flare transition-colors hover:bg-flare hover:text-on-flare"
        >
          See all regions
        </Link>
      </section>

      {/* ---------- Signup ---------- */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-2xl px-5 py-16">
          <NewsletterForm />
        </div>
      </section>

      {openShot !== null && (
        <Lightbox
          shots={game.shots}
          index={openShot}
          variant={game.art.variant}
          onClose={close}
          onNavigate={setOpenShot}
        />
      )}
    </>
  )
}
