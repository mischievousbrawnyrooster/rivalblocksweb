import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import BannerAd from '../components/BannerAd.jsx'
import Leaderboard from '../components/Leaderboard.jsx'
import { boardFor } from '../../server/board.js'
import { makeBuffer } from '../lib/snapshotBuffer.js'
import { useTitle } from '../lib/useTitle.js'
import { useFavicon } from '../lib/useFavicon.js'
import {
  GRID,
  DELAY_MS,
  SEND_MS,
  S_WALL,
  S_TARMAC,
  S_KERB,
  S_BOOST,
  S_OIL,
  S_PICKUP,
  S_LINE,
  SURFACE_CHARS,
  decodeMap,
} from '../../server/cutline.js'

const TILE = 8
const CANVAS = GRID * TILE // 96 * 8 = 768px: whole circuit on screen, no camera needed

const PLAYER_FALLBACKS = [
  '#ff8a3d',
  '#4ade80',
  '#38bdf8',
  '#c084fc',
  '#f472b6',
  '#2dd4bf',
  '#f87171',
  '#a3a3f0',
]

function getPlayerColor(slot) {
  const root = getComputedStyle(document.documentElement)
  const num = (slot % 8) + 1
  return root.getPropertyValue(`--player-${num}`).trim() || PLAYER_FALLBACKS[slot % 8]
}

/** Decode run-length encoded circuit map */
function decode(str) {
  if (typeof decodeMap === 'function') {
    return decodeMap(str)
  }
  const out = new Uint8Array(GRID * GRID)
  const re = /(\d+)([A-Z])/g
  let m
  let at = 0
  while ((m = re.exec(str)) !== null) {
    const count = parseInt(m[1], 10)
    const surface = SURFACE_CHARS.indexOf(m[2])
    for (let i = 0; i < count && at < out.length; i++) {
      out[at++] = surface < 0 ? S_WALL : surface
    }
  }
  return out
}

/**
 * Paint the circuit once to an offscreen canvas.
 *
 * The track never changes during a race, so every frame after this is one
 * drawImage plus the cars and active hazards.
 */
function prerender(map) {
  const off = document.createElement('canvas')
  off.width = CANVAS
  off.height = CANVAS
  const g = off.getContext('2d')

  // Raw :root variables, never the --color-* aliases: Tailwind v4 substitutes
  // those into utilities rather than emitting them, so reading one at runtime
  // returns an empty string and silently falls back.
  const root = getComputedStyle(document.documentElement)
  const v = (name, fallback) => root.getPropertyValue(name).trim() || fallback

  const paint = {
    [S_WALL]: v('--bg', '#0b0b0d'),
    [S_TARMAC]: v('--tile', '#2a2a2e'),
    [S_KERB]: v('--warn', '#d4a017'),
    [S_BOOST]: v('--flare', '#3ad1c4'),
    [S_OIL]: '#15151a',
    [S_PICKUP]: v('--flare', '#3ad1c4'),
    [S_LINE]: v('--fg', '#e9e9ec'),
  }

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const surface = map[y * GRID + x]
      g.fillStyle = paint[surface] ?? paint[S_WALL]
      g.fillRect(x * TILE, y * TILE, TILE, TILE)

      // Structure, not colour alone (WCAG 1.4.1). Kerbs are striped, oil is
      // stippled, the line is chequered, and pickups carry inner markers.
      if (surface === S_KERB && (x + y) % 2 === 0) {
        g.fillStyle = paint[S_WALL]
        g.fillRect(x * TILE, y * TILE, TILE, TILE / 2)
      }
      if (surface === S_OIL) {
        g.fillStyle = paint[S_TARMAC]
        g.fillRect(x * TILE + 2, y * TILE + 2, 2, 2)
      }
      if (surface === S_LINE && (x + y) % 2 === 0) {
        g.fillStyle = paint[S_WALL]
        g.fillRect(x * TILE, y * TILE, TILE, TILE)
      }
      if (surface === S_PICKUP) {
        g.fillStyle = paint[S_WALL]
        g.fillRect(x * TILE + 2, y * TILE + 2, 4, 4)
      }
      if (surface === S_BOOST && (x + y) % 2 === 0) {
        g.fillStyle = paint[S_WALL]
        g.fillRect(x * TILE + 2, y * TILE + 2, 4, 2)
      }
    }
  }

  return off
}

function formatLapTime(ms) {
  if (!ms || ms <= 0) return '-'
  return `${(ms / 1000).toFixed(2)}s`
}

function itemLabel(item) {
  if (item === 'boost') return 'BOOST »'
  if (item === 'slick') return 'SLICK ◈'
  if (item === 'wall') return 'WALL ≡'
  return 'EMPTY —'
}

function statusLine(hud, myId) {
  if (!hud) return 'Connecting to Cutline match server.'
  if (hud.phase === 'waiting') {
    return 'Waiting for drivers. Start now against bots, or wait for someone to drop in.'
  }
  const me = hud.cars?.find((c) => c.id === myId)
  if (hud.phase === 'over') {
    if (hud.winner) {
      const winner = hud.cars?.find((c) => c.id === hud.winner)
      const name = winner?.name ?? 'A driver'
      return `${name} took the checkered flag. Restarting shortly.`
    }
    return 'Race concluded. Restarting shortly.'
  }
  if (me && !me.alive) {
    return 'Eliminated on the cut. Spectating the remaining field.'
  }
  if (hud.phase === 'countdown') {
    return `Grid countdown active. Green flag in ${hud.countdown}s.`
  }
  const lastId = hud.order?.[hud.order.length - 1]
  const lastCar = hud.cars?.find((c) => c.id === lastId)
  if (lastCar?.id === myId) {
    return 'Warning: you are running in elimination position on the cut.'
  }
  if (lastCar) {
    return `Race under way. ${lastCar.name} is running last on the cut.`
  }
  return 'Race under way.'
}

export default function Cutline() {
  useTitle('Cutline')
  useFavicon('cutline')

  const [name, setName] = useState('')
  const [status, setStatus] = useState('idle') // idle | live | closed | full
  const [myId, setMyId] = useState(null)
  const [circuitName, setCircuitName] = useState('')
  const [hud, setHud] = useState(null)

  const wsRef = useRef(null)
  const canvasRef = useRef(null)
  const trackCanvasRef = useRef(null)
  const bufRef = useRef(makeBuffer(DELAY_MS))
  const myIdRef = useRef(null)
  const keysRef = useRef(new Set())
  const wantsReadyRef = useRef(false)

  // --- Connect and socket lifecycle -----------------------------------------
  const connect = useCallback((playerName, andReady = false) => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    wantsReadyRef.current = andReady
    bufRef.current = makeBuffer(DELAY_MS)
    keysRef.current.clear()

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${location.host}/cutline-ws`
    const ws = new WebSocket(url, 'cutline.v1')
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'join', name: playerName }))
    }

    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }

      if (msg.t === 'full') {
        setStatus('full')
        return
      }

      if (msg.t === 'welcome') {
        myIdRef.current = msg.id
        setMyId(msg.id)
        setCircuitName(msg.circuit?.name ?? '')
        trackCanvasRef.current = prerender(decode(msg.circuit?.map ?? ''))
        bufRef.current = makeBuffer(DELAY_MS)
        setStatus('live')

        if (wantsReadyRef.current) {
          ws.send(JSON.stringify({ t: 'ready' }))
          wantsReadyRef.current = false
        }
      } else if (msg.t === 'state') {
        // Adapt cars into players property so snapshotBuffer interpolates positions
        bufRef.current.push({ ...msg, players: msg.cars }, performance.now())
        setHud(msg)
      }
    }

    ws.onclose = () => {
      setStatus('closed')
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => () => wsRef.current?.close(), [])

  // --- Keyboard input listeners ---------------------------------------------
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault()
      }
      keysRef.current.add(e.code)
    }

    const onKeyUp = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      keysRef.current.delete(e.code)
    }

    const onBlur = () => {
      keysRef.current.clear()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // --- Input uplink tick loop -----------------------------------------------
  useEffect(() => {
    if (status !== 'live') return

    const timer = setInterval(() => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return

      const keys = keysRef.current
      const left = keys.has('KeyA') || keys.has('ArrowLeft')
      const right = keys.has('KeyD') || keys.has('ArrowRight')
      const steer = left && !right ? -1 : right && !left ? 1 : 0
      const throttle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0
      const brake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0
      const use = keys.has('Space') || keys.has('KeyE') || keys.has('KeyF')

      // Strictly rate-based: never send a target coordinate, only driving rates
      ws.send(
        JSON.stringify({
          t: 'input',
          steer,
          throttle,
          brake,
          use,
        }),
      )
    }, SEND_MS)

    return () => clearInterval(timer)
  }, [status])

  // --- Render loop ----------------------------------------------------------
  useEffect(() => {
    if (status !== 'live') return

    let rafId
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const frame = () => {
      const now = performance.now()
      const sampled = bufRef.current.sample(now, myIdRef.current)
      const track = trackCanvasRef.current

      ctx.fillStyle = '#0b0b0d'
      ctx.fillRect(0, 0, CANVAS, CANVAS)

      if (track) {
        ctx.drawImage(track, 0, 0)
      }

      if (sampled) {
        // Draw hazards
        const hazards = sampled.hazards ?? []
        for (const h of hazards) {
          const hx = h.x * TILE
          const hy = h.y * TILE

          if (h.kind === 'slick') {
            // Oil slick puddle with droplet stipples
            ctx.save()
            ctx.fillStyle = '#111116'
            ctx.strokeStyle = '#2d2d38'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.ellipse(hx, hy, 9, 7.5, 0.4, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = '#4a4a58'
            ctx.beginPath()
            ctx.arc(hx - 2, hy - 1, 1.2, 0, Math.PI * 2)
            ctx.arc(hx + 3, hy + 1, 1.2, 0, Math.PI * 2)
            ctx.arc(hx, hy + 2.5, 1, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          } else if (h.kind === 'wall') {
            // Deployed barrier hazard with hazard stripes
            ctx.save()
            ctx.translate(hx, hy)
            ctx.fillStyle = '#16161a'
            ctx.fillRect(-6, -6, 12, 12)
            ctx.strokeStyle = '#fbbf24'
            ctx.lineWidth = 1.5
            ctx.strokeRect(-6, -6, 12, 12)

            ctx.beginPath()
            ctx.moveTo(-5, 5)
            ctx.lineTo(5, -5)
            ctx.moveTo(-5, 1)
            ctx.lineTo(1, -5)
            ctx.moveTo(-1, 5)
            ctx.lineTo(5, -1)
            ctx.stroke()
            ctx.restore()
          }
        }

        // Draw cars
        const cars = sampled.players ?? sampled.cars ?? []
        for (const car of cars) {
          const cx = car.x * TILE
          const cy = car.y * TILE
          const isMe = car.id === myIdRef.current
          const alive = car.alive
          const color = getPlayerColor(car.slot)

          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(car.heading)

          if (!alive) {
            ctx.globalAlpha = 0.35
          }

          // Sliding tire tracks
          if (car.sliding && alive) {
            ctx.strokeStyle = '#000000'
            ctx.lineWidth = 1.5
            ctx.setLineDash([2, 2])
            ctx.beginPath()
            ctx.moveTo(-7, -3)
            ctx.lineTo(-16, -3)
            ctx.moveTo(-7, 3)
            ctx.lineTo(-16, 3)
            ctx.stroke()
            ctx.setLineDash([])
          }

          // Boosting wake trails
          if (car.boosting && alive) {
            ctx.strokeStyle = '#ff6b1a'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(-7, -2.5)
            ctx.lineTo(-17, -6)
            ctx.moveTo(-7, 2.5)
            ctx.lineTo(-17, 6)
            ctx.moveTo(-7, 0)
            ctx.lineTo(-13, 0)
            ctx.stroke()

            ctx.strokeStyle = '#38bdf8'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(-7, -1)
            ctx.lineTo(-12, -2.5)
            ctx.moveTo(-7, 1)
            ctx.lineTo(-12, 2.5)
            ctx.stroke()
          }

          // Drafting chevron
          if (car.drafting && alive) {
            ctx.strokeStyle = '#38bdf8'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(-15, -4)
            ctx.lineTo(-11, 0)
            ctx.lineTo(-15, 4)
            ctx.stroke()
          }

          // Car body: rounded rectangle
          ctx.fillStyle = color
          ctx.beginPath()
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(-7, -4, 14, 8, 2)
          } else {
            ctx.rect(-7, -4, 14, 8)
          }
          ctx.fill()
          ctx.strokeStyle = isMe ? '#ffffff' : '#0b0b0d'
          ctx.lineWidth = 1
          ctx.stroke()

          // Nose triangle heading indicator (+X is forward)
          ctx.fillStyle = isMe ? '#ffffff' : '#0b0b0d'
          ctx.beginPath()
          ctx.moveTo(6.5, 0)
          ctx.lineTo(2.5, -3)
          ctx.lineTo(2.5, 3)
          ctx.closePath()
          ctx.fill()

          // Place number in contrasting token
          if (alive && car.place != null) {
            ctx.fillStyle = '#0b0b0d'
            ctx.font = 'bold 7px monospace'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(String(car.place), -1.5, 0.5)
          }

          // Eliminated car cross
          if (!alive) {
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(-6, -3)
            ctx.lineTo(6, 3)
            ctx.moveTo(-6, 3)
            ctx.lineTo(6, -3)
            ctx.stroke()
          }

          ctx.restore()

          // Local car highlight ring in world space
          if (isMe && alive) {
            ctx.save()
            ctx.strokeStyle = '#ff6b1a'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(cx, cy, 11, 0, Math.PI * 2)
            ctx.stroke()

            ctx.fillStyle = '#ff6b1a'
            ctx.font = 'bold 8px monospace'
            ctx.textAlign = 'center'
            ctx.fillText('YOU', cx, cy - 13)
            ctx.restore()
          }
        }

        // Overlay banner for non-racing phases
        if (sampled.phase !== 'racing') {
          ctx.save()
          let headline = ''
          let subtitle = ''
          if (sampled.phase === 'countdown') {
            headline = `GRID COUNTDOWN: ${sampled.countdown}`
            subtitle = 'Drivers prepare for green flag'
          } else if (sampled.phase === 'waiting') {
            headline = 'WAITING FOR DRIVERS'
            subtitle = 'The grid starts when drivers ready up'
          } else if (sampled.phase === 'over') {
            const winner = cars.find((c) => c.id === sampled.winner)
            headline = winner ? `${winner.name.toUpperCase()} TAKES THE FLAG` : 'RACE CONCLUDED'
            subtitle = 'A fresh circuit rolls shortly'
          }

          if (headline) {
            ctx.fillStyle = 'rgba(11, 11, 13, 0.85)'
            ctx.fillRect(0, CANVAS / 2 - 40, CANVAS, 80)
            ctx.strokeStyle = '#2b2b31'
            ctx.lineWidth = 1
            ctx.strokeRect(-1, CANVAS / 2 - 40, CANVAS + 2, 80)

            ctx.fillStyle = '#ecebe6'
            ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(headline, CANVAS / 2, CANVAS / 2 - 10)

            ctx.fillStyle = '#8f8d86'
            ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
            ctx.fillText(subtitle, CANVAS / 2, CANVAS / 2 + 18)
          }
          ctx.restore()
        }
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [status])

  // ---------- Name Entry Screen ----------
  if (status === 'idle') {
    return (
      <section className="mx-auto max-w-xl px-5 py-20">
        <p className="rule-label">Cutline</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">Cutline</h1>
        <p className="mt-5 leading-relaxed text-muted">
          Eight haulers, one shared asphalt loop, and no chase camera. The car running last on the
          leader crossing the line gets cut on the spot. Last driver standing takes the flag.
        </p>

        <form
          className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault()
            connect(name)
          }}
        >
          <label htmlFor="player-name" className="sr-only">
            Driver callsign
          </label>
          <input
            id="player-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            placeholder="Driver callsign"
            className="min-w-48 flex-1 border border-line bg-surface px-4 py-3.5 text-sm text-fg placeholder:text-muted focus:border-flare focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-flare px-6 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
            >
              Enter Grid
            </button>
            <button
              type="button"
              onClick={() => connect(name, true)}
              className="border border-line bg-surface px-5 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-fg transition-colors hover:border-flare hover:text-flare"
            >
              Start with bots
            </button>
          </div>
        </form>
      </section>
    )
  }

  // ---------- Server Full Screen ----------
  if (status === 'full') {
    return (
      <section className="mx-auto max-w-xl px-5 py-20 text-center">
        <p className="rule-label">Cutline</p>
        <h1 className="display mt-2 text-3xl">Grid capacity full</h1>
        <p className="mt-4 text-muted">
          All eight grid positions are currently occupied. Please wait for an opening.
        </p>
        <button
          type="button"
          onClick={() => connect(name)}
          className="mt-8 bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
        >
          Try again
        </button>
      </section>
    )
  }

  // ---------- Disconnected Screen ----------
  if (status === 'closed') {
    return (
      <section className="mx-auto max-w-xl px-5 py-20 text-center">
        <p className="rule-label">Cutline</p>
        <h1 className="display mt-2 text-3xl">Connection lost</h1>
        <p className="mt-4 text-muted">
          The match server stopped answering. Your grid position has been released.
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

  // ---------- Active Match View ----------
  const cars = hud?.cars ?? []
  const me = cars.find((c) => c.id === myId)
  const aliveCars = cars.filter((c) => c.alive)
  const lastCarId = hud?.order?.[hud.order.length - 1]
  const lastCar = cars.find((c) => c.id === lastCarId)
  const isMeLast = Boolean(lastCar && lastCar.id === myId)

  let cutWarningText = 'CLEAR'
  if (hud?.phase === 'racing') {
    if (isMeLast) {
      cutWarningText = `YOU (P${lastCar.place})`
    } else if (lastCar) {
      cutWarningText = `${lastCar.name} (P${lastCar.place})`
    }
  } else if (hud?.phase === 'countdown') {
    cutWarningText = `GRID [${hud.countdown}s]`
  } else if (hud?.phase === 'over') {
    const winnerCar = cars.find((c) => c.id === hud.winner)
    cutWarningText = winnerCar ? `${winnerCar.name} WINS` : 'FINISHED'
  } else {
    cutWarningText = 'LOBBY'
  }

  // Sorted roster by place/order
  const sortedRoster = [...cars].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1
    return (a.place ?? 99) - (b.place ?? 99)
  })

  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="display text-3xl">Cutline</h1>
          <span className="rule-label">{circuitName || 'Circuit'} Elimination</span>
        </div>
        <Link
          to="/games/cutline"
          className="text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
        >
          About the game →
        </Link>
      </div>

      <p aria-live="polite" className="mt-3 border-l-2 border-flare pl-4 text-sm text-muted">
        {statusLine(hud, myId)}
      </p>

      {/* Lobby card when waiting */}
      {hud?.phase === 'waiting' && (
        <div className="mt-4 border border-line bg-surface p-5">
          <p className="rule-label">Lobby</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The grid holds until drivers ready up. Start now and AI haulers will fill the field.
          </p>
          <button
            type="button"
            onClick={() => wsRef.current?.send(JSON.stringify({ t: 'ready' }))}
            className="mt-4 bg-flare px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
          >
            Start with bots
          </button>
        </div>
      )}

      {/* Main Game Layout */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[768px_1fr] items-start justify-center">
        {/* Canvas & HUD Area */}
        <div className="relative mx-auto w-full max-w-[768px]">
          <canvas
            ref={canvasRef}
            width={CANVAS}
            height={CANVAS}
            role="img"
            aria-label={`Cutline circuit canvas. ${statusLine(hud, myId)}`}
            className="w-full max-w-[768px] aspect-square border border-line bg-bg select-none block"
          />

          {/* Fixed-height HUD strip below canvas so layout never reflows */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-px border border-line bg-line text-xs">
            <div className="bg-bg p-2.5 h-16 flex flex-col justify-center">
              <p className="rule-label">Place</p>
              <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-fg">
                {me?.place != null ? `P${me.place}/${aliveCars.length}` : '-'}
              </p>
            </div>
            <div className="bg-bg p-2.5 h-16 flex flex-col justify-center">
              <p className="rule-label">Lap</p>
              <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-fg">
                {hud ? `LAP ${Math.min(hud.lap + 1, hud.laps)}/${hud.laps}` : '-'}
              </p>
            </div>
            <div className="bg-bg p-2.5 h-16 flex flex-col justify-center">
              <p className="rule-label">Item [SPACE]</p>
              <p className="mt-0.5 font-mono text-base font-bold uppercase tracking-wider text-flare">
                {itemLabel(me?.item)}
              </p>
            </div>
            <div className="bg-bg p-2.5 h-16 flex flex-col justify-center">
              <p className="rule-label">Cut Warning</p>
              <p
                className={`mt-0.5 font-mono text-sm font-bold truncate ${
                  isMeLast ? 'text-red-400 animate-pulse' : 'text-warn'
                }`}
              >
                {cutWarningText}
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar Roster and Info */}
        <div className="space-y-8">
          {/* Driver Roster */}
          <div>
            <div className="flex items-baseline justify-between">
              <p className="rule-label">Driver Roster</p>
              <p className="rule-label">Best Lap</p>
            </div>
            <ul className="mt-3 space-y-2">
              {sortedRoster.map((car) => {
                const isCarMe = car.id === myId
                const isAlive = car.alive
                const color = getPlayerColor(car.slot)
                const isCarOnCut = hud?.phase === 'racing' && car.id === lastCarId

                return (
                  <li key={car.id} className="flex items-center gap-2.5 text-sm">
                    <span
                      style={{ backgroundColor: color }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-[0.7rem] text-bg font-bold"
                      aria-hidden="true"
                    >
                      {car.slot + 1}
                    </span>
                    <span
                      className={`truncate ${!isAlive ? 'text-muted line-through' : 'text-fg'}`}
                    >
                      {car.name}
                    </span>
                    {isCarMe && <span className="rule-label shrink-0">you</span>}
                    {car.bot && <span className="rule-label shrink-0">bot</span>}
                    {isCarOnCut && (
                      <span className="text-[0.625rem] text-red-400 font-mono uppercase tracking-wider font-bold">
                        ON CUT
                      </span>
                    )}
                    {car.boosting && isAlive && (
                      <span className="text-[0.625rem] text-flare font-mono uppercase tracking-wider">
                        Boost
                      </span>
                    )}
                    {car.drafting && isAlive && (
                      <span className="text-[0.625rem] text-sky-400 font-mono uppercase tracking-wider">
                        Draft
                      </span>
                    )}
                    {car.sliding && isAlive && (
                      <span className="text-[0.625rem] text-warn font-mono uppercase tracking-wider">
                        Slide
                      </span>
                    )}
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted">
                      {formatLapTime(car.bestLapMs)}
                    </span>
                  </li>
                )
              })}
              {sortedRoster.length === 0 && <li className="text-sm text-muted">Connecting...</li>}
            </ul>
          </div>

          {/* Leaderboard */}
          <div>
            <p className="rule-label">Leaderboard</p>
            <div className="mt-2 border-t border-line pt-3">
              <Leaderboard
                entries={hud?.board ?? []}
                you={me?.name ?? null}
                spec={boardFor('cutline')}
              />
            </div>
          </div>

          {/* Controls Guide */}
          <div>
            <p className="rule-label">Controls</p>
            <dl className="mt-2 space-y-1.5 text-sm text-muted">
              <div className="flex justify-between gap-3">
                <dt>Steering</dt>
                <dd className="font-mono text-xs text-fg">A / D or Left / Right</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Throttle</dt>
                <dd className="font-mono text-xs text-fg">W or Up Arrow</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Brake / Reverse</dt>
                <dd className="font-mono text-xs text-fg">S or Down Arrow</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Use Item</dt>
                <dd className="font-mono text-xs text-fg">Space, E, or F</dd>
              </div>
            </dl>
          </div>

          {/* Track Surface Guide */}
          <div>
            <p className="rule-label">Track Surface Guide</p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted">
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-fg">· Tarmac:</span>
                <span>Standard racing asphalt, peak grip.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-warn">≡ Kerb:</span>
                <span>Striped rumble boundary, reduces lateral grip.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-flare">» Boost:</span>
                <span>Speed induction strip, surges acceleration.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-fg">◈ Oil:</span>
                <span>Slick hazard surface, scrubs tire traction.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-flare">✶ Item:</span>
                <span>Pickup crate granting Boost, Slick, or Barrier.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-fg">▦ Line:</span>
                <span>Chequered checkpoint and cut execution line.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <BannerAd className="mt-12" />
    </section>
  )
}
