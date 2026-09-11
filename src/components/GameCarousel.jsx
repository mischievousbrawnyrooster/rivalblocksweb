import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import BlockArt from './BlockArt.jsx'

// Long enough to read the blurb, short enough that the third title is not a
// secret. Paused whenever anyone is actually looking at or using the control.
const HOLD_MS = 7000

export default function GameCarousel({ games }) {
  const [at, setAt] = useState(0)
  const [held, setHold] = useState(false)
  const liveRef = useRef(null)

  const game = games[at]
  const go = (n) => setAt((i) => (i + n + games.length) % games.length)

  useEffect(() => {
    if (held || games.length < 2) return undefined
    // Anyone who has asked for less motion gets a static hero and the controls.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    const id = setInterval(() => setAt((i) => (i + 1) % games.length), HOLD_MS)
    return () => clearInterval(id)
  }, [held, games.length])

  const tone = game.statusTone === 'live' ? 'text-live' : 'text-warn'

  return (
    <section
      className="blueprint blueprint-drift relative border-b border-line overflow-hidden"
      aria-roledescription="carousel"
      aria-label="Our games"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)}
      onBlurCapture={() => setHold(false)}
    >
      {/* Sliding Track */}
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(-${at * 100}%)` }}
        >
          {games.map((g, i) => {
            const live = i === at
            // The sliding track needs every slide in the DOM, which means three
            // of them are sitting off to the side at any moment. `inert` is the
            // one attribute that deals with both consequences: their links stop
            // being tabbable and their text stops reaching a screen reader.
            // Without it you can tab into a game that is not on screen.
            const Heading = live ? 'h1' : 'p'
            return (
            <div key={g.slug} className="w-full shrink-0" inert={!live} aria-hidden={!live}>
              <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-16 pb-8 lg:grid-cols-2 lg:pt-24 lg:pb-12">
                <div>
                  <p className="inline-block bg-flare px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-on-flare">
                    {g.status}
                  </p>
                  {/* Only the slide on screen is the page's h1. The other three
                      carry the same styling as a paragraph, or the page claims
                      four titles. */}
                  <Heading className="display mt-5 text-5xl sm:text-6xl lg:text-7xl">{g.title}</Heading>
                  <p className="mt-3 text-lg text-flare">{g.tagline}</p>
                  <p className="mt-5 border-l-2 border-flare pl-4 leading-relaxed text-muted">
                    {g.blurb}
                  </p>

                  <div className="mt-8 flex flex-wrap gap-3">
                    <Link
                      to={g.playPath ?? `/games/${g.slug}`}
                      className="bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
                    >
                      Play free
                    </Link>
                    <Link
                      to={`/games/${g.slug}`}
                      className="border border-line px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-muted transition-colors hover:border-flare hover:text-flare"
                    >
                      About {g.title}
                    </Link>
                  </div>
                </div>

                <div className="flex justify-center">
                  {g.coverImage ? (
                    <div className="relative w-full max-w-lg aspect-16/9 overflow-hidden border border-line bg-surface shadow-2xl transition-transform duration-500 hover:scale-[1.02]">
                      <img
                        src={g.coverImage}
                        alt={`${g.title} key art`}
                        className="h-full w-full object-cover"
                        loading={i === 0 ? 'eager' : 'lazy'}
                      />
                      <div className="pointer-events-none absolute inset-0 border border-flare/20" />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface/60 via-transparent to-transparent" />
                    </div>
                  ) : (
                    <BlockArt
                      variant={g.art.variant}
                      seed={g.art.seed}
                      className="w-full max-w-lg"
                    />
                  )}
                </div>
              </div>
            </div>
            )
          })}
        </div>
      </div>

      {/* Screen Reader Announcement */}
      <p ref={liveRef} aria-live="polite" className="sr-only">
        {game.title}, {game.genre}
      </p>

      {/* Stationary Bottom Controls */}
      <div className="mx-auto max-w-6xl px-5 pb-10 lg:pb-14">
        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous game"
            className="border border-line px-3.5 py-2 text-muted transition-colors hover:border-flare hover:text-flare active:scale-95"
          >
            <span aria-hidden="true">←</span>
          </button>
          <ul className="flex items-center gap-2">
            {games.map((g, i) => (
              <li key={g.slug}>
                <button
                  type="button"
                  onClick={() => setAt(i)}
                  aria-current={i === at ? 'true' : undefined}
                  aria-label={`Show ${g.title}`}
                  className={`h-2.5 border transition-all duration-300 ${
                    i === at ? 'w-10 border-flare bg-flare' : 'w-7 border-line hover:border-flare'
                  }`}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next game"
            className="border border-line px-3.5 py-2 text-muted transition-colors hover:border-flare hover:text-flare active:scale-95"
          >
            <span aria-hidden="true">→</span>
          </button>
          <span className={`ml-auto text-[0.6875rem] uppercase tracking-[0.16em] ${tone}`}>
            <span aria-hidden="true">● </span>
            {game.genre}
          </span>
        </div>
      </div>
    </section>
  )
}
