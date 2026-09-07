import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Leaderboard from '../components/Leaderboard.jsx'
import { useTitle } from '../lib/useTitle.js'
import { useFavicon } from '../lib/useFavicon.js'
import { makeBuffer } from '../lib/snapshotBuffer.js'
import { makeScene } from '../lib/towerScene.js'

// Keyed on e.code, so the binding survives a different keyboard layout.
const KEYS = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

// Render this far behind the server, so there is always a frame on each side of
// the render clock to sit between. One tick plus a little slack.
const DELAY_MS = 100
const SEND_MS = 50

// Pre-connection placeholders only. The real numbers ride in every snapshot
// once one arrives; these just keep the lobby screen from showing blanks.
const DEFAULT_SIZE = 13
const DEFAULT_FLOORS = 5
const DEFAULT_TARGET = 3
const DEFAULT_MIN = 2

// One icon per slot, eight silhouettes nothing like each other — this is what
// tells players apart when colour cannot. Same convention as Blastworks.
const PIECE_ICON = ['🦊', '🐺', '🐙', '🦈', '🐝', '🐸', '🦅', '🐧']

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

// Each held item gets its own glyph, so a kit is never identified by colour.
const ITEM = {
  shield: { glyph: '◈', label: 'Shield' },
  dash: { glyph: '»', label: 'Dash' },
  sinkhole: { glyph: '◍', label: 'Sinkhole' },
  patch: { glyph: '▦', label: 'Patch' },
  blink: { glyph: '↷', label: 'Blink' },
  swap: { glyph: '⇄', label: 'Swap' },
  foresight: { glyph: '◎', label: 'Foresight' },
  shove: { glyph: '↦', label: 'Shove' },
  hover: { glyph: '⇧', label: 'Hover' },
  bridge: { glyph: '▬', label: 'Bridge' },
  anchor: { glyph: '╀', label: 'Anchor' },
  lift: { glyph: '⇑', label: 'Lift' },
}

function statusLine(game, myId) {
  if (!game) return 'Connecting to the match server.'
  const mine = game.players.find((p) => p.id === myId)
  if (game.phase === 'waiting') {
    const short = (game.min ?? DEFAULT_MIN) - game.players.length
    return `Waiting for ${short === 1 ? 'one more player' : `${short} more players`}. ${game.players.length} of ${game.min ?? DEFAULT_MIN} in the works.`
  }
  if (game.phase === 'countdown') return `Round starts in ${game.secs}.`
  if (game.phase === 'over') {
    const what = game.final ? 'takes the match' : 'takes the round'
    return game.winner
      ? `${game.winner} ${what}. Next round in ${game.secs}.`
      : `Nobody survived that one. Next round in ${game.secs}.`
  }
  if (mine && !mine.playing) return 'Watching this one out. You are in the next round.'
  if (mine && !mine.alive) return 'Fell off the stack. Waiting on the round.'
  const up = game.players.filter((p) => p.playing && p.alive).length
  return `Round live. ${game.bottom + 1} of ${game.floors} floors left, ${up} still standing.`
}

export default function Blockout3D() {
  useTitle('Blockout Royale 3D')
  useFavicon('blockout3d')

  const canvasRef = useRef(null)
  const wsRef = useRef(null)
  const bufRef = useRef(makeBuffer(DELAY_MS))
  const heldRef = useRef(new Set())
  const sentRef = useRef([0, 0])
  const [joined, setJoined] = useState(false)
  const [name, setName] = useState('')
  const [hud, setHud] = useState(null)
  const [lostConnection, setLostConnection] = useState(false)
  const meRef = useRef(0)
  const everJoinedRef = useRef(false)

  // --- socket ------------------------------------------------------------
  const join = useCallback((who) => {
    // A fresh buffer per connection: interpolating between a dead match's
    // last frames and the new one's first is not a thing that should happen.
    bufRef.current = makeBuffer(DELAY_MS)
    heldRef.current.clear()
    sentRef.current = [0, 0]
    setLostConnection(false)
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}/blockout3d-ws`)
    wsRef.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: who }))
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.t === 'welcome') {
        meRef.current = msg.id
        everJoinedRef.current = true
        setJoined(true)
      } else if (msg.t === 'state') {
        bufRef.current.push(msg, performance.now())
        setHud(msg)
      }
    }
    ws.onclose = () => {
      setJoined(false)
      if (everJoinedRef.current) setLostConnection(true)
    }
    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => () => wsRef.current?.close(), [])

  const send = useCallback((msg) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  // --- input -------------------------------------------------------------
  useEffect(() => {
    if (!joined) return undefined
    const down = (e) => {
      if (e.code === 'Space') {
        wsRef.current?.send(JSON.stringify({ t: 'stomp' }))
        e.preventDefault()
        return
      }
      if (e.code === 'KeyE') {
        wsRef.current?.send(JSON.stringify({ t: 'use' }))
        return
      }
      if (KEYS[e.code]) {
        heldRef.current.add(e.code)
        e.preventDefault()
      }
    }
    const up = (e) => heldRef.current.delete(e.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    // Held keys survive a lost focus otherwise, and you come back walking.
    const blur = () => heldRef.current.clear()
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [joined])

  // Send the held direction on a clock rather than per keypress: a direction is
  // a state, not an event, and the server holds it until it changes.
  useEffect(() => {
    if (!joined) return undefined
    const id = setInterval(() => {
      let dx = 0
      let dy = 0
      for (const code of heldRef.current) {
        dx += KEYS[code][0]
        dy += KEYS[code][1]
      }
      const [px, py] = sentRef.current
      if (dx === px && dy === py) return
      sentRef.current = [dx, dy]
      wsRef.current?.send(JSON.stringify({ t: 'input', dir: [dx, dy] }))
    }, SEND_MS)
    return () => clearInterval(id)
  }, [joined])

  // --- scene -------------------------------------------------------------
  useEffect(() => {
    if (!joined || !canvasRef.current || !hud) return undefined
    const scene = makeScene(canvasRef.current, { size: hud.size, floors: hud.floors })
    let raf = 0
    const frame = () => {
      const view = bufRef.current.sample(performance.now())
      if (view) {
        const me = view.players.find((p) => p.id === meRef.current)
        scene.update(view, { viewZ: me?.z ?? 0 })
      }
      raf = requestAnimationFrame(frame)
    }
    const fit = () => {
      const el = canvasRef.current
      scene.resize(el.clientWidth, Math.round(el.clientWidth * 0.62))
    }
    fit()
    window.addEventListener('resize', fit)
    raf = requestAnimationFrame(frame)

    let dragging = false
    let lx = 0
    let ly = 0
    const el = canvasRef.current
    const md = (e) => {
      dragging = true
      lx = e.clientX
      ly = e.clientY
    }
    const mm = (e) => {
      if (!dragging) return
      scene.orbit(e.clientX - lx, e.clientY - ly)
      lx = e.clientX
      ly = e.clientY
    }
    const mu = () => {
      dragging = false
    }
    el.addEventListener('pointerdown', md)
    window.addEventListener('pointermove', mm)
    window.addEventListener('pointerup', mu)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      el.removeEventListener('pointerdown', md)
      window.removeEventListener('pointermove', mm)
      window.removeEventListener('pointerup', mu)
      scene.dispose()
    }
    // hud.size and hud.floors never change for a connection; the scene is built
    // once per join and not per snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, !!hud])

  const me = hud ? hud.players.find((p) => p.id === meRef.current) : null
  const won = hud?.phase === 'over' && hud.final && meRef.current !== 0 && hud.winnerId === meRef.current

  // --- victory confetti ---------------------------------------------------
  const [party, setParty] = useState([])
  useEffect(() => {
    if (!won) {
      setParty([])
      return
    }
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

  // ---------- Name entry ----------
  if (!joined) {
    return (
      <section className="blueprint mx-auto max-w-xl px-5 py-20">
        <p className="rule-label">Blockout Royale 3D</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">Blockout Royale 3D</h1>
        <p className="mt-5 leading-relaxed text-muted">
          Five floors, stacked. Waves flag tiles a beat before they drop, and
          the bottom floor gives way to the void the longer a round runs.
          Stomp one out from under a rival, or just be the last stack
          standing when the floor runs out.
        </p>
        {lostConnection && (
          <p className="mt-5 border-l-2 border-warn pl-4 text-sm text-warn">
            Connection lost. The match server stopped answering. Rejoin below.
          </p>
        )}
        <form
          className="mt-8 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            join(name)
          }}
        >
          <label htmlFor="stack-name" className="sr-only">
            Your name
          </label>
          <input
            id="stack-name"
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
            Clock in
          </button>
        </form>
      </section>
    )
  }

  // ---------- Board ----------
  const slotOf = new Map((hud?.players ?? []).map((p, i) => [p.id, i]))
  const board = hud
    ? [...hud.players].sort(
        (x, y) => y.wins - x.wins || y.kills - x.kills || x.name.localeCompare(y.name),
      )
    : []
  const heldItem = me?.held ? ITEM[me.held] : null

  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="display text-3xl">Blockout Royale 3D</h1>
          {hud && <span className="rule-label">{hud.arenas?.[me?.z ?? 0]}</span>}
        </div>
        <Link
          to="/games/blockout-royale-3d"
          className="text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
        >
          About the game →
        </Link>
      </div>

      <p aria-live="polite" className="mt-3 border-l-2 border-flare pl-4 text-sm text-muted">
        {statusLine(hud, meRef.current)}
      </p>

      {hud?.phase === 'waiting' && (
        <div className="mt-4 border border-line bg-surface p-5">
          <p className="rule-label">Lobby</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {hud.players.length} of {hud.min} in. Hold on for other people, or
            start now and the stack fills itself.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => send({ t: 'ready' })}
              disabled={hud.botsWanted}
              className="bg-flare px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
            >
              {hud.botsWanted ? 'Filling the stack' : 'Start with bots'}
            </button>
            <span aria-live="polite" className="text-xs text-muted">
              {hud.botsWanted
                ? 'Bots on their way in.'
                : 'Waiting for players. Anyone who joins takes a bot’s place.'}
            </span>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_14rem]">
        <div>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Blockout Royale 3D stack, ${hud?.size ?? DEFAULT_SIZE} by ${hud?.size ?? DEFAULT_SIZE} tiles, ${hud?.floors ?? DEFAULT_FLOORS} floors. ${statusLine(hud, meRef.current)}`}
            className="w-full cursor-grab border border-line bg-bg active:cursor-grabbing"
          />

          <div className="mt-3 grid gap-px border border-line bg-line sm:grid-cols-5">
            <div className="bg-bg p-3">
              <p className="rule-label">Floor</p>
              <p className="mt-2 text-sm">
                {me ? `${me.z + 1} of ${hud?.floors ?? DEFAULT_FLOORS}` : '—'}
              </p>
              <p className="mt-1 text-xs text-muted">
                {hud
                  ? `${hud.bottom + 1} of ${hud.floors} floors left`
                  : 'Waiting on the stack.'}
              </p>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Void</p>
              <p className={`mt-2 text-sm ${hud?.voidWarning ? 'font-bold text-warn' : ''}`}>
                {hud ? `${hud.voidIn}s` : '—'}
              </p>
              <p aria-live="polite" className="mt-1 text-xs text-muted">
                {hud?.voidWarning
                  ? 'Warning: the bottom floor is about to drop.'
                  : 'Until the bottom floor drops.'}
              </p>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Stomp</p>
              <p className="mt-2 text-sm">{me?.stomping ? 'Winding up' : 'Ready'}</p>
              <p className="mt-1 text-xs text-muted">
                {me?.stomping ? 'Committing to a drop.' : 'Space breaks the floor.'}
              </p>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Held</p>
              <p aria-live="polite" className="mt-2 text-sm text-live">
                {heldItem ? (
                  <>
                    {heldItem.glyph} {heldItem.label}
                  </>
                ) : (
                  <span className="text-muted">Empty handed.</span>
                )}
              </p>
              <p className="mt-1 truncate text-xs text-muted">
                {[
                  me?.shielded && '◈ Shielded',
                  me?.dashing && '» Dashing',
                  me?.hovering && '⇧ Hovering',
                  me?.seeing && '◎ Foresight',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No active effects.'}
              </p>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Score</p>
              <p className="mt-2 text-sm">
                {me?.wins ?? 0} of {hud?.target ?? DEFAULT_TARGET}
              </p>
              <p className="mt-1 text-xs text-muted">Rounds to take the match.</p>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <p className="rule-label">Scoreboard</p>
            <p className="rule-label">Rounds</p>
          </div>
          <ul className="mt-3 space-y-2">
            {board.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center text-[0.7rem] ${PIECE[slotOf.get(p.id) % PIECE.length]}`}
                  aria-hidden="true"
                >
                  {PIECE_ICON[slotOf.get(p.id) % PIECE_ICON.length]}
                </span>
                <span
                  className={`truncate ${p.playing && !p.alive ? 'text-muted line-through' : p.alive ? '' : 'text-muted'}`}
                >
                  {p.name}
                </span>
                {p.bot && <span className="rule-label shrink-0">bot</span>}
                {p.id === meRef.current && <span className="rule-label shrink-0">you</span>}
                <span className="ml-auto font-mono text-xs tabular-nums">
                  {p.wins}
                  <span className="sr-only"> rounds won</span>
                </span>
              </li>
            ))}
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
            <Leaderboard entries={hud?.board ?? []} you={me?.name ?? null} />
          </div>
          <p className="mt-3 text-xs text-muted">
            <Link to="/leaderboard" className="underline underline-offset-4 hover:text-fg">
              Every game, every name
            </Link>
          </p>

          <p className="rule-label mt-8">Controls</p>
          <dl className="mt-2 space-y-1.5 text-sm text-muted">
            <div className="flex justify-between gap-3">
              <dt>Move</dt>
              <dd className="font-mono text-xs">WASD</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Stomp</dt>
              <dd className="font-mono text-xs">space</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Use held item</dt>
              <dd className="font-mono text-xs">E</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Orbit camera</dt>
              <dd className="font-mono text-xs">drag</dd>
            </div>
          </dl>
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
              <p className="rule-label">Match complete</p>
              <h2 className="display mt-2 text-5xl sm:text-6xl">You win</h2>
              <p className="mt-4 text-muted">
                {me?.wins} rounds taken · next match in {hud?.secs}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
