import { Link } from 'react-router-dom'
import BlockArt from '../components/BlockArt.jsx'
import { games } from '../data/games.js'
import { useTitle } from '../lib/useTitle.js'

export default function PlayIndex() {
  useTitle('Play in browser')

  // Driven off the catalog, so a title becomes playable by gaining a
  // `playPath` in games.js and nothing here has to change.
  const playable = games.filter((g) => g.playPath)

  return (
    <>
      <header className="blueprint border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="rule-label">Play</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Play now</h1>
          <p className="mt-5 max-w-xl leading-relaxed text-muted">
            Three titles, running in the browser against the same servers
            everyone else is on. No account, no download — pick one and drop in.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {playable.map((game) => (
            <article
              key={game.slug}
              className="group flex flex-col border border-line bg-surface transition-colors hover:border-flare"
            >
              <Link to={game.playPath} className="flex flex-1 flex-col">
                <div className="blueprint flex aspect-16/10 items-center justify-center overflow-hidden border-b border-line p-6">
                  <BlockArt
                    variant={game.art.variant}
                    seed={game.art.seed}
                    className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h2 className="display text-2xl">{game.title}</h2>
                  <p className="mt-1.5 text-sm text-muted">{game.genre}</p>
                  <p className="mt-4 flex-1 text-sm leading-relaxed text-muted">
                    {game.playBlurb}
                  </p>
                  <span className="mt-6 inline-block self-start bg-flare px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity group-hover:opacity-90">
                    Play in browser
                  </span>
                </div>
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-10 border-l-2 border-line pl-4 text-sm leading-relaxed text-muted">
          Every match needs at least two in the arena before it starts. Short of
          that, the roster fills itself.
        </p>
      </div>
    </>
  )
}
