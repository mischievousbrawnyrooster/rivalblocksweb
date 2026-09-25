import { Component, lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Home from './pages/Home.jsx'
import Games from './pages/Games.jsx'
import GameDetail from './pages/GameDetail.jsx'
import Servers from './pages/Servers.jsx'
import Play from './pages/Play.jsx'
import Fracture from './pages/Fracture.jsx'
import PlayIndex from './pages/PlayIndex.jsx'
import Blastworks from './pages/Blastworks.jsx'
import VoidDrillers from './pages/VoidDrillers.jsx'
import CipherRun from './pages/CipherRun.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import Admin from './pages/Admin.jsx'
import About from './pages/About.jsx'
import NotFound from './pages/NotFound.jsx'

// The routes that pull in three.js. Split on their own so the marketing pages,
// everything else in this app, never pay for a renderer they never mount.
// `npm run check:bundle` fails if three.js ever reaches the main chunk.
const Blockout3D = lazy(() => import('./pages/Blockout3D.jsx'))
const Cutline = lazy(() => import('./pages/Cutline.jsx'))
const Ventline = lazy(() => import('./pages/Ventline.jsx'))

function LoadingRoute({ title, line }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <p className="rule-label">{title}</p>
      <p className="display mt-2 text-2xl">{line}</p>
    </div>
  )
}

// React.lazy only covers the pending state; a chunk 404 after a redeploy
// throws during render, and with no boundary above it React unmounts the
// whole tree, not just this route. Scoped to one route, so the failure stays
// a card in the play area and the nav and every other page keep working.
class RouteLoadError extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <p className="rule-label">{this.props.title}</p>
        <h1 className="display mt-2 text-2xl">{this.props.headline}</h1>
        <p className="mt-4 leading-relaxed text-muted">
          A newer version of the site shipped while this tab was open. Reload
          to pick it up.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
        >
          Reload
        </button>
      </div>
    )
  }
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="games" element={<Games />} />
        <Route path="games/:slug" element={<GameDetail />} />
        <Route path="servers" element={<Servers />} />
        <Route path="play" element={<PlayIndex />} />
        <Route path="play/blockout-royale" element={<Play />} />
        <Route path="play/fracture-line" element={<Fracture />} />
        <Route path="play/blastworks" element={<Blastworks />} />
        <Route path="play/void-drillers" element={<VoidDrillers />} />
        <Route path="play/cipher-run" element={<CipherRun />} />
        <Route
          path="play/ventline"
          element={
            <RouteLoadError title="Ventline" headline="The flight bay did not load">
              <Suspense fallback={<LoadingRoute title="Ventline" line="Loading the flight bay…" />}>
                <Ventline />
              </Suspense>
            </RouteLoadError>
          }
        />
        <Route
          path="play/cutline"
          element={
            <RouteLoadError title="Cutline" headline="The circuit did not load">
              <Suspense fallback={<LoadingRoute title="Cutline" line="Loading the circuit…" />}>
                <Cutline />
              </Suspense>
            </RouteLoadError>
          }
        />
        <Route
          path="play/blockout-royale-3d"
          element={
            <RouteLoadError title="Blockout Royale 3D" headline="The stack did not load">
              <Suspense fallback={<LoadingRoute title="Blockout Royale 3D" line="Loading the stack…" />}>
                <Blockout3D />
              </Suspense>
            </RouteLoadError>
          }
        />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="about" element={<About />} />
        {/* Unlisted: reachable by typing the path, never linked from the site. */}
        <Route path="admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
