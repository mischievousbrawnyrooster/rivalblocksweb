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
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import Admin from './pages/Admin.jsx'
import About from './pages/About.jsx'
import NotFound from './pages/NotFound.jsx'

// The one route that pulls in three.js. Split on its own so the marketing
// pages — everything else in this app — never pay for a renderer they never
// mount. Nothing else here is heavy enough to be worth the Suspense boundary.
const Blockout3D = lazy(() => import('./pages/Blockout3D.jsx'))

function LoadingStack() {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <p className="rule-label">Blockout Royale 3D</p>
      <p className="display mt-2 text-2xl">Loading the stack…</p>
    </div>
  )
}

// React.lazy only covers the pending state; a chunk 404 after a redeploy
// throws during render, and with no boundary above it React unmounts the
// whole tree, not just this route. Scoped to this one Suspense rather than
// the whole app, so the failure stays a blank card in the play area — the
// nav and every other page around it keep working.
class StackLoadError extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <p className="rule-label">Blockout Royale 3D</p>
        <h1 className="display mt-2 text-2xl">The stack did not load</h1>
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
        <Route
          path="play/blockout-royale-3d"
          element={
            <StackLoadError>
              <Suspense fallback={<LoadingStack />}>
                <Blockout3D />
              </Suspense>
            </StackLoadError>
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
