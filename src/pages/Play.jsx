import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Leaderboard from '../components/Leaderboard.jsx'
import { useTitle } from '../lib/useTitle.js'
import { useFavicon } from '../lib/useFavicon.js'
import { makeWallTiles, styleFor } from '../lib/wallTiles.js'

// One icon per slot, and eight silhouettes that are nothing like each other —
// this is what tells players apart when colour cannot. Same order as PIECE, so
// a player's icon and colour always agree.
const PIECE_ICON = ['🦊', '🐺', '🐙', '🦈', '🐝', '🐸', '🦅', '🐧']
const ICON_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'

// Keyed on e.code, so the binding survives a different keyboard layout.
const KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
}

// Own tokens, not reused status colours — a piece must never wear the same
// colour as a tile state, or you cannot tell a player from the floor. Each
// piece also carries its initial, so players are told apart without colour.
// One entry per spawn point on the server. If capacity ever outgrows this
// list, PIECE[slot] is undefined and pieces render unstyled.
const PIECE = [
  'bg-player-1 text-bg',
  'bg-player-2 text-bg',
  'bg-player-3 text-bg',
  'bg-player-4 text-bg',
  'bg-player-5 text-bg',
  'bg-player-6 text-bg',
  'bg-player-7 text-bg',
  'bg-player-8 text-bg',
]

// Each kind gets its own glyph, so a pickup is never identified by colour.
const POWERUP = {
  shield: { glyph: '◈', label: 'Shield', blurb: 'Survive one collapse. You get shoved clear.' },
  dash: { glyph: '»', label: 'Dash', blurb: 'Move twice as fast for a few seconds.' },
  sinkhole: { glyph: '✖', label: 'Sinkhole', blurb: 'Flag the tile under the nearest rival.' },
  patch: { glyph: '✚', label: 'Patch', blurb: 'Rebuild the three by three around you.' },
  blink: {
    glyph: '↷',
    label: 'Blink',
    blurb: 'Hop three tiles the way you are going, over holes.',
  },
  swap: { glyph: '⇄', label: 'Swap', blurb: 'Trade places with whoever is nearest.' },
  foresight: {
    glyph: '◎',
    label: 'Foresight',
    blurb: 'Shows which tiles the next wave will take, for a few seconds.',
  },
}

function statusLine(game, myId) {
  if (!game) return 'Connecting to the match server.'
  const mine = game.players.find((p) => p.id === myId)
  switch (game.phase) {
    case 'waiting':
      return `Holding for players. ${game.players.length} connected, 2 needed to drop.`
    case 'countdown':
      return `Round starts in ${game.secs}.`
    case 'over':
      if (!game.winner) return `No survivors. Next drop in ${game.secs}.`
      return game.final
        ? `${game.winner} takes the match. A new one in ${game.secs}.`
        : `${game.winner} takes the round. Next drop in ${game.secs}.`
    default:
      if (mine && !mine.playing) return 'Spectating. You are in on the next round.'
      if (mine && !mine.alive) return 'You went down with the floor. Round still live.'
      return `Round live. ${game.players.filter((p) => p.playing && p.alive).length} still standing.`
  }
}

function Arrow({ dir, glyph, label, onMove }) {
  return (
    <button
      type="button"
      onClick={() => onMove(dir)}
      className="flex h-12 items-center justify-center border border-line text-muted transition-colors hover:border-flare hover:text-flare"
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </button>
  )
}

export default function Play() {
  useTitle('Blockout Royale')
  useFavicon('blockout')

  const [name, setName] = useState('')
  const [status, setStatus] = useState('idle') // idle | connecting | live | closed
  const [myId, setMyId] = useState(null)
  const [game, setGame] = useState(null)
  // Only the player who actually took the round celebrates, which is why the
  // server sends an id and not just a name.
  const [party, setParty] = useState([])
  const wsRef = useRef(null)
  const canvasRef = useRef(null)
  // The board draws from a ref rather than from state, so the render loop does
  // not have to be torn down and rebuilt on every snapshot.
  const gameRef = useRef(null)
  const myIdRef = useRef(null)

  const send = useCallback((dir) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'move', dir }))
    }
  }, [])

  const useHeld = useCallback(() => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'use' }))
    }
  }, [])

  const connect = useCallback((playerName) => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${scheme}://${window.location.host}/ws`)
    wsRef.current = ws
    setStatus('connecting')

    ws.onopen = () => {
      setStatus('live')
      ws.send(JSON.stringify({ t: 'join', name: playerName }))
    }
    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.t === 'welcome') {
        myIdRef.current = msg.id
        setMyId(msg.id)
      } else if (msg.t === 'state') {
        gameRef.current = msg
        setGame(msg)
      }
    }
    // ponytail: manual reconnect only. Add backoff retry if the link proves flaky.
    ws.onclose = () => setStatus('closed')
    ws.onerror = () => ws.close()
  }, [])

  // Leaving the page must drop the socket, or the server holds a ghost player.
  useEffect(() => () => wsRef.current?.close(), [])

  const won = game?.phase === 'over' && myId !== null && game.winnerId === myId

  useEffect(() => {
    if (!won) {
      setParty([])
      return
    }
    // Built once when the round lands, never per frame: regenerating this on
    // every snapshot would restart each animation before it finished.
    setParty(
      Array.from({ length: 90 }, (_, id) => ({
        id,
        left: Math.random() * 100,
        w: 6 + Math.random() * 6,
        h: 9 + Math.random() * 12,
        colour: `var(--player-${1 + Math.floor(Math.random() * 8)})`,
        delay: Math.random() * 1400,
        dur: 2600 + Math.random() * 2400,
        drift: -15 + Math.random() * 30,
        spin: 360 + Math.random() * 900,
      })),
    )
  }, [won])

  useEffect(() => {
    if (status !== 'live') return undefined
    function onKey(e) {
      if (e.code === 'Space') {
        e.preventDefault() // space scrolls the page by default
        useHeld()
        return
      }
      const dir = KEYS[e.code]
      if (!dir) return
      e.preventDefault() // arrows must not scroll the page mid-round
      send(dir)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, send, useHeld])

  // ---------- Board ----------
  useEffect(() => {
    if (status !== 'live') return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')

    // Canvas has no tokens of its own, so the theme's are read out of CSS.
    // Re-read only when the theme actually flips, never per frame.
    let theme = null
    let colour = {}
    let tiles = null
    let tilesPx = 0
    let tilesStyle = null
    const readTheme = () => {
      const css = getComputedStyle(document.documentElement)
      const v = (n) => css.getPropertyValue(n).trim()
      colour = {
        floor: v('--bg'),
        grid: v('--line'),
        wall: v('--tile'),
        edge: v('--hole'),
        fg: v('--fg'),
        muted: v('--muted'),
        flare: v('--flare'),
        warn: v('--warn'),
        players: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--player-${i}`)),
      }
    }

    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const g = gameRef.current
      if (!g) return

      const nowTheme = document.documentElement.dataset.theme ?? ''
      if (nowTheme !== theme) {
        theme = nowTheme
        readTheme()
        tiles = null
      }

      const n = g.size
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      if (canvas.width !== Math.round(cssW * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = canvas.width
        canvas.style.height = `${cssW}px`
      }
      const u = canvas.width / n
      ctx.setTransform(1, 0, 0, 1, 0, 0)

      // The void the board is suspended over. Tiles that are gone show it
      // through, which is the whole read of this game.
      ctx.fillStyle = colour.edge
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const px = Math.max(8, Math.round(u))
      const style = styleFor(g.arena)
      if (!tiles || tilesPx !== px || tilesStyle !== style) {
        tiles = makeWallTiles(colour, px, style)
        tilesPx = px
        tilesStyle = style
      }

      // Standing ground. A flagged tile is the same slab with a chevron and a
      // closing inset on it — a shape, not a shade, so it reads whether or not
      // amber and grey can be told apart.
      const beat = 0.5 + 0.5 * Math.sin(performance.now() / 110)
      const soon = new Set(g.soon ?? [])
      for (let i = 0; i < g.tiles.length; i++) {
        const kind = g.tiles[i]
        if (kind === 'gone') continue
        const x = (i % n) * u
        const y = Math.floor(i / n) * u
        const cuts = tiles.states[0]
        ctx.drawImage(tiles.floor[i % tiles.floor.length], x, y, u, u)
        ctx.drawImage(cuts[i % cuts.length], x, y, u, u)

        // Told in advance, and not yet flagged: an open outline, plainly
        // different from the solid chevron a real warning carries.
        if (kind === 'solid' && soon.has(i)) {
          ctx.strokeStyle = colour.flare
          ctx.lineWidth = Math.max(1, u * 0.07)
          ctx.setLineDash([u * 0.16, u * 0.12])
          ctx.strokeRect(x + u * 0.16, y + u * 0.16, u * 0.68, u * 0.68)
          ctx.setLineDash([])
        }
        if (kind !== 'warn') continue
        ctx.strokeStyle = colour.warn
        ctx.lineWidth = Math.max(1, u * 0.09)
        const inset = u * (0.08 + 0.12 * beat)
        ctx.strokeRect(x + inset, y + inset, u - inset * 2, u - inset * 2)
        ctx.fillStyle = colour.warn
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `bold ${Math.round(u * 0.5)}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillText('▲', x + u / 2, y + u / 2 + u * 0.02)
      }

      // Pickups.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const [key, kind] of Object.entries(g.powerups ?? {})) {
        const i = Number(key)
        const cx = ((i % n) + 0.5) * u
        const cy = (Math.floor(i / n) + 0.5) * u
        ctx.strokeStyle = colour.flare
        ctx.lineWidth = Math.max(1, u * 0.07)
        ctx.strokeRect(cx - u * 0.34, cy - u * 0.34, u * 0.68, u * 0.68)
        ctx.fillStyle = colour.flare
        ctx.font = `${Math.round(u * 0.5)}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillText(POWERUP[kind]?.glyph ?? '?', cx, cy + u * 0.02)
      }

      // Pieces. Slot order is the order they were handed pieces, which is what
      // the scoreboard colours off too.
      const slots = g.players.filter((q) => q.playing)
      slots.forEach((q, slot) => {
        if (!q.alive) return
        const cx = (q.x + 0.5) * u
        const cy = (q.y + 0.5) * u
        const mine = q.id === myIdRef.current
        const r = u * (mine ? 0.42 : 0.36)

        if (mine) {
          ctx.globalAlpha = 0.18
          ctx.fillStyle = colour.flare
          ctx.beginPath()
          ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }

        ctx.fillStyle = colour.players[slot % colour.players.length]
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()

        if (q.shielded) {
          ctx.strokeStyle = colour.fg
          ctx.lineWidth = Math.max(1, u * 0.08)
          ctx.beginPath()
          ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (q.dashing) {
          // A trail behind the piece, so a dash reads off the board.
          ctx.globalAlpha = 0.35
          ctx.fillStyle = colour.players[slot % colour.players.length]
          ctx.beginPath()
          ctx.arc(cx - u * 0.22, cy, r * 0.7, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }

        ctx.font = `${Math.round(r * 1.4)}px ${ICON_FONT}`
        ctx.fillText(PIECE_ICON[slot % PIECE_ICON.length], cx, cy + r * 0.06)

        if (mine) {
          ctx.fillStyle = colour.flare
          ctx.beginPath()
          ctx.moveTo(cx, cy - r * 1.7)
          ctx.lineTo(cx - u * 0.15, cy - r * 1.7 - u * 0.2)
          ctx.lineTo(cx + u * 0.15, cy - r * 1.7 - u * 0.2)
          ctx.closePath()
          ctx.fill()
        }
      })

      // Who took it, across the board, for everybody — not just the winner.
      // The status line alone left the result ambiguous: a player watching
      // their own piece disappear had no idea who was still standing. Worded
      // and placed like the other two games.
      if (g.phase !== 'playing') {
        const headline =
          g.phase === 'countdown'
            ? `Round starts in ${g.secs}`
            : g.phase === 'over'
              ? g.winner
                ? `${g.winner} ${g.final ? 'takes the match' : 'takes the round'}`
                : 'Nobody made it off that one'
              : 'Waiting for another player'
        const under =
          g.phase === 'over'
            ? g.final
              ? `A new match in ${g.secs}`
              : `Next drop in ${g.secs}`
            : g.phase === 'countdown'
              ? `First to ${g.target} rounds`
              : 'The round starts the moment someone else drops in'

        ctx.textAlign = 'center'
        ctx.fillStyle = colour.edge
        ctx.globalAlpha = 0.85
        ctx.fillRect(0, canvas.height / 2 - u * 1.5, canvas.width, u * 3)
        ctx.globalAlpha = 1
        ctx.fillStyle = colour.fg
        ctx.font = `bold ${Math.round(u * 0.85)}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillText(headline, canvas.width / 2, canvas.height / 2 - u * 0.3)
        ctx.fillStyle = colour.muted
        ctx.font = `${Math.round(u * 0.55)}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillText(under, canvas.width / 2, canvas.height / 2 + u * 0.85)
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [status])

  // ---------- Name entry ----------
  if (status === 'idle') {
    return (
      <section className="blueprint mx-auto max-w-xl px-5 py-20">
        <p className="rule-label">Blockout Royale</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">Blockout Royale</h1>
        <p className="mt-5 leading-relaxed text-muted">
          Two to four players, one shrinking grid. Tiles flash before they go. Stand on one when it
          does and you are out. Last one up takes the round.
        </p>
        <form
          className="mt-8 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            connect(name)
          }}
        >
          <label htmlFor="player-name" className="sr-only">
            Player name
          </label>
          <input
            id="player-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            placeholder="Your name"
            className="min-w-48 flex-1 border border-line bg-surface px-4 py-3.5 text-sm"
          />
          <button
            type="submit"
            className="bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
          >
            Drop in
          </button>
        </form>
      </section>
    )
  }

  // ---------- Disconnected ----------
  if (status === 'closed') {
    return (
      <section className="mx-auto max-w-xl px-5 py-20">
        <h1 className="display text-3xl">Connection lost</h1>
        <p className="mt-4 text-muted">
          The match server stopped answering. Your slot has been released.
        </p>
        <button
          type="button"
          onClick={() => connect(name)}
          className="mt-8 border border-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-flare transition-colors hover:bg-flare hover:text-on-flare"
        >
          Reconnect
        </button>
      </section>
    )
  }

  // ---------- Board ----------
  const size = game?.size ?? 9
  const slots = game ? game.players.filter((p) => p.playing) : []
  const occupied = new Map()
  slots.forEach((p, i) => {
    if (p.alive) occupied.set(p.y * size + p.x, { player: p, slot: i })
  })

  const powerups = game?.powerups ?? {}
  const me = game ? game.players.find((p) => p.id === myId) : null
  const held = me && me.held ? POWERUP[me.held] : null

  // The scoreboard lists everyone connected, not just this round's four.
  const slotOf = new Map(slots.map((p, i) => [p.id, i]))
  const board = game
    ? [...game.players].sort((x, y) => y.wins - x.wins || x.name.localeCompare(y.name))
    : []

  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="display text-3xl">Blockout Royale</h1>
          {game?.arena && <span className="rule-label">{game.arena} arena</span>}
        </div>
        <Link
          to="/games/blockout-royale"
          className="text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
        >
          About the game →
        </Link>
      </div>

      <p aria-live="polite" className="mt-3 border-l-2 border-flare pl-4 text-sm text-muted">
        {statusLine(game, myId)}
      </p>
      {game?.phase === 'waiting' && (
        <div className="mt-4 border border-line bg-surface p-5">
          <p className="rule-label">Lobby</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {game.players.length} of {game.min ?? 2} in. Hold on for other people, or start now and
            the board fills itself.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const ws = wsRef.current
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ t: 'ready' }))
                }
              }}
              disabled={game.botsWanted}
              className="bg-flare px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
            >
              {game.botsWanted ? 'Filling the board' : 'Start with bots'}
            </button>
            <span aria-live="polite" className="text-xs text-muted">
              {game.botsWanted
                ? 'Bots on their way in.'
                : 'Waiting for players. Anyone who joins takes a bot\u2019s place.'}
            </span>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_14rem]">
        <div>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Match grid, ${size} by ${size} tiles. ${statusLine(game, myId)}`}
            className="w-full border border-line bg-bg"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <p className="rule-label">Scoreboard</p>
            <p className="rule-label">Wins</p>
          </div>
          <ul className="mt-3 space-y-2">
            {board.map((p) => {
              const slot = slotOf.get(p.id)
              return (
                <li key={p.id} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center text-[0.7rem] ${
                      // A spectator has no piece colour, so it gets an outline.
                      slot === undefined ? 'text-muted ring-1 ring-inset ring-line' : PIECE[slot]
                    }`}
                    aria-hidden="true"
                  >
                    {slot === undefined ? '·' : PIECE_ICON[slot % PIECE_ICON.length]}
                  </span>
                  <span
                    className={`truncate ${p.playing && !p.alive ? 'text-muted line-through' : ''}`}
                  >
                    {p.name}
                  </span>
                  {p.bot && <span className="rule-label shrink-0">bot</span>}
                  {p.id === myId && <span className="rule-label shrink-0">you</span>}
                  <span className="ml-auto font-mono text-xs tabular-nums">
                    {p.wins}
                    <span className="sr-only"> wins</span>
                  </span>
                </li>
              )
            })}
            {board.length === 0 && <li className="text-sm text-muted">Nobody yet.</li>}
          </ul>

          {/* The standing board, as it stood when the last match on this
              server finished. It arrives in the snapshot rather than being
              fetched, so it needs no second connection and updates the moment
              a match ends. */}
          <div className="mt-8 flex items-baseline justify-between">
            <p className="rule-label">Leaderboard</p>
            <p className="rule-label">Won · K/D</p>
          </div>
          <div className="mt-3">
            <Leaderboard entries={game?.board ?? []} you={me?.name ?? null} />
          </div>
          <p className="mt-3 text-xs text-muted">
            <Link to="/leaderboard" className="underline underline-offset-4 hover:text-fg">
              Every game, every name
            </Link>
          </p>

          <p className="rule-label mt-8">Carrying</p>
          <div aria-live="polite" className="mt-3">
            {held ? (
              <>
                <button
                  type="button"
                  onClick={useHeld}
                  className="flex w-full items-center gap-2.5 border border-flare px-3 py-2.5 text-left text-sm text-flare transition-colors hover:bg-flare hover:text-on-flare"
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    {held.glyph}
                  </span>
                  <span className="font-bold uppercase tracking-[0.08em]">{held.label}</span>
                  <span className="ml-auto text-[0.6875rem] tracking-[0.16em]">SPACE</span>
                </button>
                <p className="mt-2 text-xs leading-relaxed text-muted">{held.blurb}</p>
              </>
            ) : (
              <p className="text-sm text-muted">Nothing. Walk over a marked tile to pick one up.</p>
            )}
            {me?.shielded && (
              <p className="mt-2 text-xs text-live">◈ Shielded. One collapse absorbed.</p>
            )}
            {me?.seeing && <p className="mt-2 text-xs text-live">◎ Reading the next wave.</p>}
            {me?.dashing && <p className="mt-2 text-xs text-live">» Dashing.</p>}
          </div>

          <p className="rule-label mt-8">Controls</p>
          <p className="mt-2 text-sm text-muted">
            Arrow keys or WASD to move. Space to use what you are carrying.
          </p>
          <div className="mt-3 grid w-40 grid-cols-3 gap-1.5">
            <span />
            <Arrow dir="up" glyph="▲" label="Move up" onMove={send} />
            <span />
            <Arrow dir="left" glyph="◀" label="Move left" onMove={send} />
            <span />
            <Arrow dir="right" glyph="▶" label="Move right" onMove={send} />
            <span />
            <Arrow dir="down" glyph="▼" label="Move down" onMove={send} />
            <span />
          </div>
          <button
            type="button"
            onClick={useHeld}
            disabled={!held}
            className="mt-2 w-40 border border-line py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-muted transition-colors enabled:hover:border-flare enabled:hover:text-flare disabled:opacity-40"
          >
            Use
          </button>
        </div>
      </div>

      {won && (
        <>
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
            {party.map((c) => (
              <span
                key={c.id}
                className="confetti absolute top-0 block"
                style={{
                  left: `${c.left}%`,
                  width: `${c.w}px`,
                  height: `${c.h}px`,
                  background: c.colour,
                  animationDelay: `${c.delay}ms`,
                  animationDuration: `${c.dur}ms`,
                  '--drift': `${c.drift}vw`,
                  '--spin': `${c.spin}deg`,
                }}
              />
            ))}
          </div>
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-5">
            <div role="status" className="border border-flare bg-bg px-10 py-9 text-center">
              <p className="rule-label">{game?.final ? 'Match taken' : 'Last one standing'}</p>
              <h2 className="display mt-2 text-5xl sm:text-6xl">You win</h2>
              <p className="mt-4 text-muted">
                {game?.final
                  ? `${me?.wins} rounds taken · a new match in ${game?.secs}`
                  : `${me?.wins} of ${game?.target} rounds · next drop in ${game?.secs}`}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
