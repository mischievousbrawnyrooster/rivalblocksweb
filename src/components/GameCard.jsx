import { Link } from 'react-router-dom'
import BlockArt from './BlockArt.jsx'

export default function GameCard({ game }) {
  const tone = game.statusTone === 'live' ? 'text-live' : 'text-warn'

  return (
    <article className="group border border-line bg-surface transition-colors hover:border-flare">
      <Link to={`/games/${game.slug}`} className="block">
        <div className="relative aspect-16/10 overflow-hidden border-b border-line bg-bg">
          {game.coverImage ? (
            <img
              src={game.coverImage}
              alt={`${game.title} artwork`}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="blueprint flex h-full w-full items-center justify-center p-6">
              <BlockArt
                variant={game.art.variant}
                seed={game.art.seed}
                className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
              />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent opacity-60" />
        </div>
        <div className="p-6">
          <div className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.16em]">
            <span className={tone} aria-hidden="true">
              ●
            </span>
            <span className={tone}>{game.status}</span>
          </div>
          <h3 className="display mt-3 text-2xl">{game.title}</h3>
          <p className="mt-1.5 text-sm text-muted">{game.genre}</p>
          <p className="mt-4 text-sm leading-relaxed text-muted">{game.tagline}</p>
          <span className="mt-5 inline-block text-xs uppercase tracking-[0.16em] text-flare">
            View game →
          </span>
        </div>
      </Link>
    </article>
  )
}
