import { Link } from 'react-router-dom'
import Leaderboard from '../components/Leaderboard.jsx'
import { useTitle } from '../lib/useTitle.js'
import { useBoard } from '../lib/useBoard.js'
import { games } from '../data/games.js'
import { rank } from '../../server/board.js'

/** The play route for a board, so a name on the table is one click from a match. */
const playPathFor = (game) =>
  games.find((g) => g.playPath && g.playPath.includes(game))?.playPath ?? '/play'

export default function LeaderboardPage() {
  useTitle('Leaderboard')
  const { all, byGame, ready } = useBoard()

  return (
    <>
      <header className="blueprint border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="rule-label">Every title</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Leaderboard</h1>
          <p className="mt-5 max-w-xl leading-relaxed text-muted">
            Every round of Blockout Royale and every match of Fracture Line
            and Blastworks, on every server. A result goes on the board the
            moment it finishes and stays there — nothing is cleared between
            sessions.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-16">
        <section>
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <h2 className="display text-2xl">All titles</h2>
            <p className="rule-label">{all.length} on the board</p>
          </div>
          <div className="mt-5">
            {ready ? (
              <Leaderboard entries={all} limit={null} full />
            ) : (
              <p className="text-sm text-muted">Reading the standings…</p>
            )}
          </div>
        </section>

        <section className="mt-16">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <h2 className="display text-2xl">By title</h2>
            <p className="rule-label">Top five each</p>
          </div>
          <div className="mt-7 grid gap-9 md:grid-cols-2">
            {byGame.map((spec) => (
              <div key={spec.file}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm">{spec.title}</h3>
                  <Link
                    to={playPathFor(spec.game)}
                    className="rule-label text-muted hover:text-flare"
                  >
                    Play
                  </Link>
                </div>
                <div className="mt-3 border-t border-line pt-3">
                  {ready ? (
                    <Leaderboard entries={rank(spec.board?.players ?? [])} />
                  ) : (
                    <p className="text-sm text-muted">Reading the standings…</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
