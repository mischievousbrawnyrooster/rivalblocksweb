import GameCard from '../components/GameCard.jsx'
import { games } from '../data/games.js'
import { useTitle } from '../lib/useTitle.js'

export default function Games() {
  useTitle('Games')

  return (
    <>
      <header className="blueprint blueprint-drift border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="rule-label">Catalog</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Games</h1>
          <p className="mt-5 max-w-xl leading-relaxed text-muted">
            Three multiplayer titles built on the same destructible block
            simulation, all running on servers we operate ourselves.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {games.map((g) => (
            <GameCard key={g.slug} game={g} />
          ))}
        </div>
      </div>
    </>
  )
}
