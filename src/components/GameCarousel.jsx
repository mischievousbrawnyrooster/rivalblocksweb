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
      className="blueprint border-b border-line"
      aria-roledescription="carousel"
      aria-label="Our games"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)}
      onBlurCapture={() => setHold(false)}
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="inline-block bg-flare px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-on-flare">
            {game.status}
          </p>
          <h1 className="display mt-5 text-5xl sm:text-6xl lg:text-7xl">{game.title}</h1>
          <p className="mt-3 text-lg text-flare">{game.tagline}</p>
          <p className="mt-5 border-l-2 border-flare pl-4 leading-relaxed text-muted">
            {game.blurb}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to={game.playPath ?? `/games/${game.slug}`}
              className="bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
            >
              Play free
            </Link>
            <Link
              to={`/games/${game.slug}`}
              className="border border-line px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-muted transition-colors hover:border-flare hover:text-flare"
            >
              About {game.title}
            </Link>
          </div>

          {/* Announced on change, but only the title — reading a whole blurb
              aloud every seven seconds would be intolerable. */}
          <p ref={liveRef} aria-live="polite" className="sr-only">
            {game.title}, {game.genre}
          </p>

          <div className="mt-10 flex items-center gap-4 border-t border-line pt-6">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous game"
              className="border border-line px-3 py-2 text-muted transition-colors hover:border-flare hover:text-flare"
            >
              <span aria-hidden="true">←</span>
            </button>
            <ul className="flex gap-2">
              {games.map((g, i) => (
                <li key={g.slug}>
                  <button
                    type="button"
                    onClick={() => setAt(i)}
                    aria-current={i === at ? 'true' : undefined}
                    aria-label={`Show ${g.title}`}
                    className={`h-2.5 w-8 border transition-colors ${
                      i === at ? 'border-flare bg-flare' : 'border-line hover:border-flare'
                    }`}
                  />
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next game"
              className="border border-line px-3 py-2 text-muted transition-colors hover:border-flare hover:text-flare"
            >
              <span aria-hidden="true">→</span>
            </button>
            <span className={`ml-auto text-[0.6875rem] uppercase tracking-[0.16em] ${tone}`}>
              <span aria-hidden="true">● </span>
              {game.genre}
            </span>
          </div>
        </div>

        <div className="flex justify-center">
          {/* Keyed on the slug so the art remounts and re-draws per title
              rather than quietly keeping the previous one's geometry. */}
          <BlockArt
            key={game.slug}
            variant={game.art.variant}
            seed={game.art.seed}
            className="w-full max-w-lg"
          />
        </div>
      </div>
    </section>
  )
}
