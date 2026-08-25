import { Link } from 'react-router-dom'
import BlockArt from '../components/BlockArt.jsx'
import { useTitle } from '../lib/useTitle.js'

export default function NotFound() {
  useTitle('Page not found')

  return (
    <div className="blueprint">
      <div className="mx-auto flex max-w-xl flex-col items-center px-5 py-24 text-center">
        <BlockArt variant="platforms" seed={404} className="w-64" />
        <p className="rule-label mt-8">Error 404</p>
        <h1 className="display mt-2 text-4xl">This tile fell away</h1>
        <p className="mt-4 leading-relaxed text-muted">
          The page you asked for is not here. It may have been moved, or it may
          never have existed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
          >
            Back home
          </Link>
          <Link
            to="/games"
            className="border border-line px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-muted transition-colors hover:border-flare hover:text-flare"
          >
            Browse games
          </Link>
        </div>
      </div>
    </div>
  )
}
