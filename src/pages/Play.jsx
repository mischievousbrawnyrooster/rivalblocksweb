import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTitle } from '../lib/useTitle.js'

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

const TILE = {
  solid: 'bg-surface',
  warn: 'bg-warn text-bg',
  gone: 'bg-bg',
}

// Each piece also carries its initial, so players are told apart without
// relying on colour.
const PIECE = [
  'bg-flare text-on-flare',
  'bg-live text-bg',
  'bg-warn text-bg',
  'bg-idle text-bg',
]

function statusLine(game, myId) {
  if (!game) return 'Connecting to the match server.'
  const mine = game.players.find((p) => p.id === myId)
  switch (game.phase) {
    case 'waiting':
      return `Holding for players. ${game.players.length} connected, 2 needed to drop.`
    case 'countdown':
      return `Round starts in ${game.secs}.`
    case 'over':
      return game.winner
        ? `${game.winner} takes the round. Next drop in ${game.secs}.`
        : `No survivors. Next drop in ${game.secs}.`
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
  useTitle('Blockout Royale — Browser Trial')

  const [name, setName] = useState('')
  const [status, setStatus] = useState('idle') // idle | connecting | live | closed
  const [myId, setMyId] = useState(null)
  const [game, setGame] = useState(null)
  const wsRef = useRef(null)

  const send = useCallback((dir) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'move', dir }))
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
      if (msg.t === 'welcome') setMyId(msg.id)
      else if (msg.t === 'state') setGame(msg)
    }
    // ponytail: manual reconnect only. Add backoff retry if the link proves flaky.
    ws.onclose = () => setStatus('closed')
    ws.onerror = () => ws.close()
  }, [])

  // Leaving the page must drop the socket, or the server holds a ghost player.
  useEffect(() => () => wsRef.current?.close(), [])

  useEffect(() => {
    if (status !== 'live') return undefined
    function onKey(e) {
      const dir = KEYS[e.code]
      if (!dir) return
      e.preventDefault() // arrows must not scroll the page mid-round
      send(dir)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, send])

  // ---------- Name entry ----------
  if (status === 'idle') {
    return (
      <section className="blueprint mx-auto max-w-xl px-5 py-20">
        <p className="rule-label">Blockout Royale</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">Browser trial</h1>
        <p className="mt-5 leading-relaxed text-muted">
          Two to four players, one shrinking grid. Tiles flash before they go.
          Stand on one when it does and you are out. Last one up takes the round.
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

  return (
    <section className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="display text-3xl">Blockout Royale</h1>
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

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_14rem]">
        <div
          role="img"
          aria-label={`Match grid, ${size} by ${size} tiles`}
          className="grid gap-px border border-line bg-line p-px"
          style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        >
          {(game?.tiles ?? []).map((t, i) => {
            const here = occupied.get(i)
            return (
              <div
                key={i}
                className={`relative flex aspect-square items-center justify-center text-[0.65rem] font-bold ${TILE[t]}`}
              >
                {t === 'warn' && (
                  <span aria-hidden="true" className="absolute right-0.5 top-0.5 leading-none">
                    ▲
                  </span>
                )}
                {here && (
                  <span
                    className={`flex h-4/5 w-4/5 items-center justify-center ${PIECE[here.slot]}`}
                  >
                    {here.player.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <div>
          <p className="rule-label">In the round</p>
          <ul className="mt-3 space-y-2">
            {slots.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`flex h-5 w-5 items-center justify-center text-[0.65rem] font-bold ${PIECE[i]}`}
                  aria-hidden="true"
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className={p.alive ? '' : 'text-muted line-through'}>{p.name}</span>
                {p.id === myId && <span className="rule-label">you</span>}
              </li>
            ))}
            {slots.length === 0 && <li className="text-sm text-muted">Nobody yet.</li>}
          </ul>

          <p className="rule-label mt-8">Controls</p>
          <p className="mt-2 text-sm text-muted">Arrow keys or WASD.</p>
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
        </div>
      </div>
    </section>
  )
}
