import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Home from './pages/Home.jsx'
import Games from './pages/Games.jsx'
import GameDetail from './pages/GameDetail.jsx'
import Servers from './pages/Servers.jsx'
import Play from './pages/Play.jsx'
import Fracture from './pages/Fracture.jsx'
import PlayIndex from './pages/PlayIndex.jsx'
import Admin from './pages/Admin.jsx'
import About from './pages/About.jsx'
import NotFound from './pages/NotFound.jsx'

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
        <Route path="about" element={<About />} />
        {/* Unlisted: reachable by typing the path, never linked from the site. */}
        <Route path="admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
