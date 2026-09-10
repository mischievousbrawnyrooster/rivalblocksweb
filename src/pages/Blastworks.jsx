import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Leaderboard from '../components/Leaderboard.jsx'
import { useTitle } from '../lib/useTitle.js'
import { useFavicon } from '../lib/useFavicon.js'
import { makeWallTiles, styleFor } from '../lib/wallTiles.js'
import { makeFireTiles, makeBombArt } from '../lib/fireTiles.js'
import { makePickupArt } from '../lib/pickupArt.js'

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

const SEND_MS = 33
const DELAY_MS = 100

const EMPTY = 0
const SOFT = 1

// One icon per slot, and eight silhouettes that are nothing like each other —
// this is what tells players apart when colour cannot.
const PIECE_ICON = ['🦊', '🐺', '🐙', '🦈', '🐝', '🐸', '🦅', '🐧']
const ICON_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'

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
const PICKUP = {
  bomb: { glyph: '⊕', label: 'Extra bomb' },
  range: { glyph: '↔', label: 'Longer arms' },
  speed: { glyph: '»', label: 'Faster' },
  kick: { glyph: '↦', label: 'Kick' },
  glove: { glyph: '⇧', label: 'Glove' },
  remote: { glyph: '◉', label: 'Remote' },
  vest: { glyph: '◈', label: 'Vest' },
  square: { glyph: '▣', label: 'Square charge' },
  drill: { glyph: '⌸', label: 'Drill charge' },
}

const FEED_MS = 5000

// One entry per running match server. The mode is fixed when the server boots,
// so picking a mode is picking which server to talk to.
const MODES = [
  {
    id: 'lastman',
    path: '/blast-ws',
    label: 'Last one standing',
    blurb: 'One life a round. Take three rounds to win the shift.',
  },
  {
    id: 'deathmatch',
    path: '/blast-dm-ws',
    label: 'Deathmatch',
    blurb: 'Straight back in when you go down. First to twelve.',
  },
]

const lerp = (a, b, t) => a + (b - a) * t

/** The two snapshots bracketing `at`, plus how far between them we are. */
function bracket(buf, at) {
  for (let i = buf.length - 2; i >= 0; i--) {
    if (buf[i].t <= at && at <= buf[i + 1].t) {
      const span = buf[i + 1].t - buf[i].t
      return [buf[i].s, buf[i + 1].s, span > 0 ? (at - buf[i].t) / span : 0]
    }
  }
  const last = buf[buf.length - 1]
  return [last.s, last.s, 0]
}

function statusLine(game, myId) {
  if (!game) return 'Connecting to the match server.'
  const mine = game.players.find((p) => p.id === myId)
  if (game.phase === 'waiting') {
    const short = (game.min ?? 2) - game.players.length
    return `Waiting for ${short === 1 ? 'one more player' : `${short} more players`}. ${game.players.length} of ${game.min ?? 2} in the works.`
  }
  if (game.phase === 'countdown') return `Round starts in ${game.secs}.`
  if (game.phase === 'over') {
    const what = game.final ? 'takes the match' : 'takes the round'
    return game.winner
      ? `${game.winner} ${what}. Next round in ${game.secs}.`
      : `Nobody survived that one. Next round in ${game.secs}.`
  }
  if (mine && !mine.inRound) return 'Watching this one out. You are in the next round.'
  if (mine && !mine.alive) return 'Caught in a blast. Waiting on the round.'
  const up = game.players.filter((p) => p.inRound && p.alive).length
  if (game.squeezing) {
    return `The walls are closing in. ${up} still standing, first to ${game.target} rounds.`
  }
  return `Round live. ${up} still standing, first to ${game.target} rounds.`
}

export default function Blastworks() {
  useTitle('Blastworks')
  useFavicon('blastworks')

  const [name, setName] = useState('')
  const [mode, setMode] = useState(MODES[0])
  const [status, setStatus] = useState('idle')
  const [myId, setMyId] = useState(null)
  const [hud, setHud] = useState(null)
  const [feed, setFeed] = useState([])
  const [party, setParty] = useState([])

  const wsRef = useRef(null)
  const canvasRef = useRef(null)
  const bufRef = useRef([])
  const myIdRef = useRef(null)
  const keysRef = useRef(new Set())
  const feedIdRef = useRef(0)
  // When each burning tile was first seen, so fire can fade and settle without
  // the server having to send an age for every one of them.
  const litRef = useRef(new Map())

  const won = hud?.phase === 'over' && hud.final && myId !== null && hud.winnerId === myId

  const send = useCallback((msg) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const absorb = useCallback((msg) => {
    const at = performance.now()
    const nameOf = (id) => msg.players.find((p) => p.id === id)?.name ?? 'someone'
    for (const e of msg.events) {
      if (e.k !== 'kill') continue
      setFeed((f) => [
        ...f.slice(-5),
        {
          id: feedIdRef.current++,
          // No killer means the closing wall took them. Left as a name it
          // read as "someone", which is a player who does not exist.
          by: e.by === null ? 'The wall' : nameOf(e.by),
          of: nameOf(e.of),
          self: e.by !== null && e.by === e.of,
          crushed: e.by === null,
          at,
        },
      ])
    }
  }, [])

  const connect = useCallback(
    (playerName, pick) => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      // 'blastworks.v1' is the WebSocket subprotocol. It names this game in a
      // packet capture; see deploy/rivalblocks.lua. Both modes share it: the
      // port already tells last man standing and deathmatch apart.
      const ws = new WebSocket(`${scheme}://${window.location.host}${pick.path}`, 'blastworks.v1')
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
        } else if (msg.t === 'full') {
          setStatus('full')
        } else if (msg.t === 'state' && Array.isArray(msg.tiles)) {
          const buf = bufRef.current
          buf.push({ t: performance.now(), s: msg })
          if (buf.length > 12) buf.shift()
          if (msg.events?.length) absorb(msg)
          setHud(msg)
        }
      }
      // ponytail: manual reconnect only. Add backoff retry if the link proves flaky.
      ws.onclose = () => setStatus((s) => (s === 'full' ? s : 'closed'))
      ws.onerror = () => ws.close()
    },
    [absorb],
  )

  useEffect(() => () => wsRef.current?.close(), [])

  // ---------- Input ----------
  useEffect(() => {
    if (status !== 'live') return undefined
    const onKey = (down) => (e) => {
      if (e.code === 'Space') {
        e.preventDefault() // space scrolls the page by default
        if (down) send({ t: 'bomb' })
        return
      }
      if (e.code === 'KeyE') {
        e.preventDefault()
        if (down) send({ t: 'action' })
        return
      }
      if (e.code === 'KeyR') {
        e.preventDefault()
        if (down) send({ t: 'detonate' })
        return
      }
      if (!KEYS[e.code]) return
      e.preventDefault() // arrows must not scroll the page mid-match
      if (down) keysRef.current.add(e.code)
      else keysRef.current.delete(e.code)
    }
    const downHandler = onKey(true)
    const upHandler = onKey(false)
    // A key held while the tab loses focus would otherwise stick forever.
    const blur = () => keysRef.current.clear()

    window.addEventListener('keydown', downHandler)
    window.addEventListener('keyup', upHandler)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', downHandler)
      window.removeEventListener('keyup', upHandler)
      window.removeEventListener('blur', blur)
    }
  }, [status, send])

  // ---------- Uplink ----------
  useEffect(() => {
    if (status !== 'live') return undefined
    const id = setInterval(() => {
      let dx = 0
      let dy = 0
      for (const code of keysRef.current) {
        dx += KEYS[code][0]
        dy += KEYS[code][1]
      }
      send({ t: 'input', dx, dy })
    }, SEND_MS)
    return () => clearInterval(id)
  }, [status, send])

  // ---------- Victory ----------
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

  // ---------- Render ----------
  useEffect(() => {
    if (status !== 'live') return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')

    let theme = null
    let colour = {}
    let tiles = null
    let fire = null
    let bombArt = null
    let pickupArt = null
    let tilesPx = 0
    let tilesStyle = null
    const readTheme = () => {
      const css = getComputedStyle(document.documentElement)
      const v = (n) => css.getPropertyValue(n).trim()
      colour = {
        floor: v('--arena') || v('--bg'),
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
      const buf = bufRef.current
      if (buf.length === 0) return

      const nowTheme = document.documentElement.dataset.theme ?? ''
      if (nowTheme !== theme) {
        theme = nowTheme
        readTheme()
        tiles = null
        fire = null
        bombArt = null
        pickupArt = null
      }

      const [a, b, t] = bracket(buf, performance.now() - DELAY_MS)
      const { w, h } = a
      const board = a.tiles

      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = Math.round((cssW * h) / w)
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
        canvas.style.height = `${cssH}px`
      }
      // The whole board, every frame. It is small enough to hold in one view,
      // and a bomb game where you cannot see the far corner is a bomb game
      // where half the map might as well not exist.
      const u = canvas.width / w
      ctx.setTransform(1, 0, 0, 1, 0, 0)

      ctx.fillStyle = colour.floor
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const px = Math.max(8, Math.round(u))
      const style = styleFor(a.arena)
      if (!tiles || tilesPx !== px || tilesStyle !== style) {
        tiles = makeWallTiles(colour, px, style)
        fire = makeFireTiles(colour, px)
        bombArt = makeBombArt(colour, px)
        pickupArt = makePickupArt(colour, px)
        tilesPx = px
        tilesStyle = style
      }

      // The plant floor, in this hall's own material. The whole board is on
      // screen at once here, so there is nothing to cull against.
      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          const cut = tiles.floor[(gx * 7 + gy * 13) % tiles.floor.length]
          ctx.drawImage(cut, gx * u, gy * u, u, u)
        }
      }

      // Hard posts and soft blocks. The post is hatched and the block is a
      // plain slab, so the two are told apart by pattern and not by shade.
      for (let i = 0; i < board.length; i++) {
        const kind = board[i]
        if (kind === EMPTY) continue
        const x = (i % w) * u
        const y = Math.floor(i / w) * u
        if (kind === SOFT) {
          const cuts = tiles.states[0]
          ctx.drawImage(cuts[i % cuts.length], x, y, u, u)
        } else {
          ctx.drawImage(tiles.border, x, y, u, u)
        }
      }

      // Pickups.
      for (const [key, kind] of Object.entries(a.pickups ?? {})) {
        const i = Number(key)
        const gx = (i % w) * u
        const gy = Math.floor(i / w) * u
        const art = pickupArt?.[kind]
        if (art) {
          ctx.drawImage(art, gx, gy, u, u)
        } else {
          ctx.strokeStyle = colour.flare
          ctx.lineWidth = Math.max(1, u * 0.07)
          ctx.strokeRect(gx + u * 0.14, gy + u * 0.14, u * 0.72, u * 0.72)
        }
      }

      // Fire. Which piece a tile gets is worked out from its burning
      // neighbours — a core where the arms cross, a channel along a run, a
      // capped head where one ends — so a blast reads as one continuous cross
      // instead of a row of identical squares. None of that has to be sent:
      // the tile list already says everything needed to derive it.
      const burning = new Set(a.fires ?? [])
      const now = performance.now()
      const lit = litRef.current
      for (const i of burning) if (!lit.has(i)) lit.set(i, now)
      for (const i of lit.keys()) if (!burning.has(i)) lit.delete(i)

      for (const i of burning) {
        const fx = i % w
        const fy = Math.floor(i / w)
        const near = (dx, dy) => burning.has((fy + dy) * w + (fx + dx))
        const east = near(1, 0)
        const west = near(-1, 0)
        const south = near(0, 1)
        const north = near(0, -1)
        const across = east || west
        const along = north || south

        let art
        if (across && along) art = fire.core
        else if (across && east && west) art = fire.armH
        else if (along && north && south) art = fire.armV
        else if (east) art = fire.tip['-1,0']
        else if (west) art = fire.tip['1,0']
        else if (south) art = fire.tip['0,-1']
        else if (north) art = fire.tip['0,1']
        else art = fire.core

        // Flares up, then settles as it burns out.
        const age = a.blast ? Math.min(1, (now - (lit.get(i) ?? now)) / a.blast) : 0
        const grow = age < 0.18 ? 0.72 + (age / 0.18) * 0.28 : 1
        ctx.globalAlpha = 0.35 + 0.65 * (1 - age) ** 0.7
        const size = u * grow
        const off = (u - size) / 2
        ctx.drawImage(art, fx * u + off, fy * u + off, size, size)
        ctx.globalAlpha = 1
      }

      // Bombs. The ring closing in is the fuse; a thrown one carries a shadow
      // under it so you can tell it is still in the air.
      const bombsB = new Map((b.bombs ?? []).map((e) => [e.id, e]))
      for (const from of a.bombs ?? []) {
        const to = bombsB.get(from.id)
        const bx = (to ? lerp(from.x, to.x, t) : from.x) * u
        const by = (to ? lerp(from.y, to.y, t) : from.y) * u
        // A remote charge reports -1: it is armed and waiting, not counting.
        const armed = from.in < 0
        const left = armed ? 1 : a.fuse ? from.in / a.fuse : 1

        if (from.air) {
          ctx.globalAlpha = 0.3
          ctx.fillStyle = colour.edge
          ctx.beginPath()
          ctx.ellipse(bx, by + u * 0.3, u * 0.3, u * 0.12, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }

        // The shell swells and settles, and the closer the fuse gets to the
        // end the faster it does it — the tell that something is about to
        // happen, before the ring is close enough to read.
        const beat = armed ? 1 : 1 + 0.07 * Math.sin(performance.now() / (40 + 160 * left))
        const size = u * beat
        ctx.drawImage(bombArt.art, bx - size / 2, by - size / 2, size, size)

        // The spark on the end of the fuse, brightening as it burns down.
        const sx = bx - size / 2 + bombArt.fuseX * size
        const sy = by - size / 2 + bombArt.fuseY * size
        ctx.fillStyle = colour.warn
        ctx.globalAlpha = 0.5 + 0.5 * (1 - left)
        ctx.beginPath()
        ctx.arc(sx, sy, u * (0.05 + 0.05 * (1 - left)), 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1

        // The countdown, as a ring closing on the shell. An armed remote charge
        // shows a steady square instead: it is not counting down to anything,
        // and it should not look like it is.
        ctx.strokeStyle = colour.warn
        ctx.lineWidth = Math.max(1, u * 0.07)
        if (armed) {
          ctx.strokeRect(bx - u * 0.34, by - u * 0.34, u * 0.68, u * 0.68)
        } else {
          ctx.beginPath()
          ctx.arc(bx, by, u * (0.16 + 0.28 * left), 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // Players.
      const playersB = new Map(b.players.map((e) => [e.id, e]))
      const iconOf = new Map(a.players.map((q, i) => [q.id, PIECE_ICON[i % PIECE_ICON.length]]))
      const tintOf = new Map(
        a.players.map((q, i) => [q.id, colour.players[i % colour.players.length]]),
      )

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      a.players.forEach((from) => {
        if (!from.alive) return
        const to = playersB.get(from.id)
        const x = (to && to.alive ? lerp(from.x, to.x, t) : from.x) * u
        const y = (to && to.alive ? lerp(from.y, to.y, t) : from.y) * u
        const isMe = from.id === myIdRef.current
        const r = u * (isMe ? 0.4 : 0.34)

        if (isMe) {
          ctx.globalAlpha = 0.18
          ctx.fillStyle = colour.flare
          ctx.beginPath()
          ctx.arc(x, y, r * 2.4, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }

        ctx.fillStyle = tintOf.get(from.id)
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()

        ctx.font = `${Math.round(r * 1.35)}px ${ICON_FONT}`
        ctx.fillText(iconOf.get(from.id), x, y)

        if (from.carrying) {
          // Holding a live bomb over their head.
          ctx.fillStyle = colour.edge
          ctx.beginPath()
          ctx.arc(x, y - r * 1.7, u * 0.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = colour.warn
          ctx.lineWidth = Math.max(1, u * 0.06)
          ctx.stroke()
        }

        if (isMe) {
          ctx.fillStyle = colour.flare
          ctx.beginPath()
          ctx.moveTo(x, y - r * 1.9)
          ctx.lineTo(x - u * 0.16, y - r * 1.9 - u * 0.22)
          ctx.lineTo(x + u * 0.16, y - r * 1.9 - u * 0.22)
          ctx.closePath()
          ctx.fill()
        }
      })

      if (a.phase !== 'playing') {
        const text =
          a.phase === 'countdown'
            ? `Round starts in ${a.secs}`
            : a.phase === 'over'
              ? a.winner
                ? `${a.winner} ${a.final ? 'takes the match' : 'takes the round'}`
                : 'Nobody survived that one'
              : 'Waiting for another player'
        ctx.fillStyle = colour.floor
        ctx.globalAlpha = 0.85
        ctx.fillRect(0, canvas.height / 2 - u * 1.5, canvas.width, u * 3)
        ctx.globalAlpha = 1
        ctx.fillStyle = colour.fg
        ctx.font = `bold ${Math.round(u * 0.85)}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 - u * 0.3)
        ctx.fillStyle = colour.muted
        ctx.font = `${Math.round(u * 0.55)}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillText(
          a.phase === 'over'
            ? `Next round in ${a.secs}`
            : a.phase === 'countdown'
              ? 'One life each'
              : 'The match starts the moment someone else drops in',
          canvas.width / 2,
          canvas.height / 2 + u * 0.85,
        )
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [status])

  // ---------- Name entry ----------
  if (status === 'idle' || status === 'full') {
    return (
      <section className="blueprint mx-auto max-w-xl px-5 py-20">
        <p className="rule-label">Blastworks</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">Blastworks</h1>
        <p className="mt-5 leading-relaxed text-muted">
          Everyone opens sealed into their own corner of the plant. Blast a way
          out, and whatever the rubble gives you is the kit you fight with: a
          longer charge, another bomb, a boot to punt one down a gallery. Blasts
          set off other blasts, so the best kills are set up three walls away.
        </p>
        {status === 'full' && (
          <p className="mt-5 border-l-2 border-warn pl-4 text-sm text-warn">
            Every slot on this server is taken. Try again in a moment.
          </p>
        )}
        <fieldset className="mt-8">
          <legend className="rule-label">Game mode</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {MODES.map((m) => (
              <label
                key={m.id}
                className={`cursor-pointer border p-4 transition-colors ${
                  mode.id === m.id
                    ? 'border-flare bg-surface'
                    : 'border-line hover:border-flare'
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={m.id}
                  checked={mode.id === m.id}
                  onChange={() => setMode(m)}
                  className="sr-only"
                />
                <span
                  className={`block text-sm font-bold uppercase tracking-[0.08em] ${
                    mode.id === m.id ? 'text-flare' : ''
                  }`}
                >
                  {mode.id === m.id ? '● ' : '○ '}
                  {m.label}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-muted">{m.blurb}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <form
          className="mt-6 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            connect(name, mode)
          }}
        >
          <label htmlFor="hand-name" className="sr-only">
            Your name
          </label>
          <input
            id="hand-name"
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
          onClick={() => {
            bufRef.current = []
            connect(name, mode)
          }}
          className="mt-8 border border-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-flare transition-colors hover:bg-flare hover:text-on-flare"
        >
          Reconnect
        </button>
      </section>
    )
  }

  // ---------- Board ----------
  const me = hud ? hud.players.find((p) => p.id === myId) : null
  const slotOf = new Map((hud?.players ?? []).map((p, i) => [p.id, i]))
  const board = hud
    ? [...hud.players].sort(
        (x, y) => y.wins - x.wins || y.kills - x.kills || x.name.localeCompare(y.name),
      )
    : []
  const recent = feed.filter((f) => performance.now() - f.at < FEED_MS)
  const feedLines = recent.slice(-4).reverse()

  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="display text-3xl">Blastworks</h1>
          {hud?.arena && <span className="rule-label">{hud.arena}</span>}
          {hud?.mode && (
            <span className="rule-label">
              {MODES.find((m) => m.id === hud.mode)?.label ?? hud.mode}
            </span>
          )}
        </div>
        <Link
          to="/games/blastworks"
          className="text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
        >
          About the game →
        </Link>
      </div>

      <p aria-live="polite" className="mt-3 border-l-2 border-flare pl-4 text-sm text-muted">
        {statusLine(hud, myId)}
      </p>
        {hud?.phase === 'waiting' && (
          <div className="mt-4 border border-line bg-surface p-5">
            <p className="rule-label">Lobby</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {hud.players.length} of {hud.min} in. Hold on for other people, or
              start now and the arena fills itself.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => send({ t: 'ready' })}
                disabled={hud.botsWanted}
                className="bg-flare px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
              >
                {hud.botsWanted ? 'Filling the arena' : 'Start with bots'}
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
            aria-label={`Blastworks arena, ${hud?.w ?? 25} by ${hud?.h ?? 17} tiles. ${statusLine(hud, myId)}`}
            className="w-full border border-line bg-arena"
          />

          <div className="mt-3 grid gap-px border border-line bg-line sm:grid-cols-4">
            <div className="bg-bg p-3">
              <p className="rule-label">Bombs</p>
              <div
                className="mt-2 flex gap-1.5"
                aria-label={`${(me?.bombs ?? 1) - (me?.live ?? 0)} of ${me?.bombs ?? 1} bombs ready`}
              >
                {Array.from({ length: me?.bombs ?? 1 }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`h-3 flex-1 border border-line ${i < (me?.bombs ?? 1) - (me?.live ?? 0) ? 'bg-flare' : ''}`}
                  />
                ))}
              </div>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Blast arms</p>
              <div className="mt-2 flex gap-1.5" aria-label={`${me?.range ?? 3} tiles per arm`}>
                {Array.from({ length: me?.range ?? 3 }, (_, i) => (
                  <span key={i} aria-hidden="true" className="h-3 flex-1 border border-line bg-warn" />
                ))}
              </div>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Boots</p>
              <div className="mt-2 flex gap-1.5" aria-label={`Speed tier ${me?.tier ?? 0} of 4`}>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`h-3 flex-1 border border-line ${i < (me?.tier ?? 0) ? 'bg-flare' : ''}`}
                  />
                ))}
              </div>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Kit</p>
              <p aria-live="polite" className="mt-2 truncate text-xs text-live">
                {[
                  me?.vest && '◈ Vest',
                  me?.remote && '◉ Remote',
                  me?.square && '▣ Square',
                  me?.drill && '⌸ Drill',
                  me?.kick && '↦ Kick',
                  me?.glove && '⇧ Glove',
                  me?.carrying && '⊕ Held',
                ]
                  .filter(Boolean)
                  .join(' · ') || <span className="text-muted">Bare hands.</span>}
              </p>
            </div>
          </div>
        </div>

        <div>
          <p className="rule-label">Feed</p>
          <ul aria-live="polite" className="mt-2 mb-8 h-20 space-y-1 overflow-hidden text-xs">
            {feedLines.map((f) => (
              <li key={f.id} className="truncate">
                <span>{f.by}</span>
                <span aria-hidden="true" className="mx-1.5 text-flare">
                  {f.crushed ? '▪' : f.self ? '✖' : '▸'}
                </span>
                <span className="sr-only">
                  {f.crushed ? 'crushed' : f.self ? 'blew themselves up' : 'eliminated'}
                </span>
                <span className="text-muted">{f.self ? 'self' : f.of}</span>
              </li>
            ))}
            {feedLines.length === 0 && <li className="text-muted">Nothing yet.</li>}
          </ul>

          <div className="flex items-baseline justify-between">
            <p className="rule-label">Scoreboard</p>
            <p className="rule-label">{hud?.mode === 'deathmatch' ? 'Kills' : 'Rounds'}</p>
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
                  className={`truncate ${p.inRound && !p.alive ? 'text-muted line-through' : p.alive ? '' : 'text-muted'}`}
                >
                  {p.name}
                </span>
                {p.bot && <span className="rule-label shrink-0">bot</span>}
                {p.id === myId && <span className="rule-label shrink-0">you</span>}
                <span className="ml-auto font-mono text-xs tabular-nums">
                  {hud?.mode === 'deathmatch' ? p.kills : p.wins}
                  <span className="sr-only">
                    {hud?.mode === 'deathmatch' ? ' eliminations' : ' rounds won'}
                  </span>
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
              <dt>Drop bomb</dt>
              <dd className="font-mono text-xs">space</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Lift / throw</dt>
              <dd className="font-mono text-xs">E</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Detonate</dt>
              <dd className="font-mono text-xs">R</dd>
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
