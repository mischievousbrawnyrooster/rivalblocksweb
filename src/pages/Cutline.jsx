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
  S_GRAVEL,
  S_RAMP,
  SURFACE_CHARS,
  decodeMap,
  CAR_LENGTH,
  CAR_WIDTH,
} from '../../server/cutline.js'

const CANVAS = 768
const TILE_RES = 32
const VIEW_CELLS = 22
const MINIMAP_FRACTION = 0.22

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

let cachedTheme = null
let cachedPalette = null

function resolvePalette() {
  if (typeof document === 'undefined') return PLAYER_FALLBACKS
  const theme = document.documentElement.dataset.theme ?? ''
  if (!cachedPalette || cachedTheme !== theme) {
    cachedTheme = theme
    const root = getComputedStyle(document.documentElement)
    cachedPalette = PLAYER_FALLBACKS.map((fallback, idx) => {
      const val = root.getPropertyValue(`--player-${idx + 1}`).trim()
      return val || fallback
    })
  }
  return cachedPalette
}

function getPlayerColor(slot) {
  return resolvePalette()[slot % 8]
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
 * Paint the circuit once to an offscreen canvas at high resolution (TILE_RES = 32).
 *
 * The track never changes during a race, so every frame after this is one
 * hardware-accelerated drawImage plus cars, dynamic hazards, and minimap blit.
 */
function prerender(map) {
  const off = document.createElement('canvas')
  off.width = GRID * TILE_RES
  off.height = GRID * TILE_RES
  const g = off.getContext('2d')
  if (!g) return off

  // Raw :root variables, never the --color-* aliases: Tailwind v4 substitutes
  // those into utilities rather than emitting them, so reading one at runtime
  // returns an empty string and silently falls back.
  const root = getComputedStyle(document.documentElement)
  const v = (name, fallback) => root.getPropertyValue(name).trim() || fallback

  const cBg = v('--bg', '#0b0b0d')
  const cTile = v('--tile', '#202026')
  const cWarn = v('--warn', '#eab308')
  const cFlare = v('--flare', '#3ad1c4')
  const cLine = v('--fg', '#ecebe6')
  const cKerbDark = '#18181b'

  g.fillStyle = cBg
  g.fillRect(0, 0, off.width, off.height)

  const T = TILE_RES

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const surface = map[y * GRID + x]
      if (surface === S_WALL) continue

      const tx = x * T
      const ty = y * T

      if (surface === S_TARMAC) {
        g.fillStyle = cTile
        g.fillRect(tx, ty, T, T)

        // Subtle aggregate flecks for asphalt depth
        const hash = (x * 37 + y * 73) % 4
        if (hash === 0) {
          g.fillStyle = 'rgba(0, 0, 0, 0.12)'
          g.fillRect(tx + 4, ty + 4, T - 8, T - 8)
        } else if (hash === 2) {
          g.fillStyle = 'rgba(255, 255, 255, 0.03)'
          g.fillRect(tx + 6, ty + 6, T - 12, T - 12)
        }
      } else if (surface === S_KERB) {
        // Authentic racing rumble kerb with alternating diagonal stripes
        g.fillStyle = (x + y) % 2 === 0 ? cWarn : cKerbDark
        g.fillRect(tx, ty, T, T)

        g.fillStyle = (x + y) % 2 === 0 ? cKerbDark : cWarn
        g.beginPath()
        g.moveTo(tx, ty)
        g.lineTo(tx + T, ty + T)
        g.lineTo(tx + T, ty + T * 0.5)
        g.lineTo(tx + T * 0.5, ty)
        g.closePath()
        g.fill()

        g.strokeStyle = 'rgba(255, 255, 255, 0.15)'
        g.lineWidth = 1
        g.strokeRect(tx + 0.5, ty + 0.5, T - 1, T - 1)
      } else if (surface === S_BOOST) {
        // Neon cyan boost acceleration pad
        g.fillStyle = '#0a2e2b'
        g.fillRect(tx, ty, T, T)

        g.strokeStyle = cFlare
        g.lineWidth = 2
        g.strokeRect(tx + 2, ty + 2, T - 4, T - 4)

        // Chevrons »»
        g.fillStyle = cFlare
        for (const cx of [tx + T * 0.3, tx + T * 0.65]) {
          g.beginPath()
          g.moveTo(cx - 3, ty + T * 0.25)
          g.lineTo(cx + 4, ty + T * 0.5)
          g.lineTo(cx - 3, ty + T * 0.75)
          g.lineTo(cx - 1, ty + T * 0.5)
          g.closePath()
          g.fill()
        }
      } else if (surface === S_LINE) {
        // Checkered starting grid line
        g.fillStyle = cTile
        g.fillRect(tx, ty, T, T)

        const checkSize = T / 4
        for (let cy = 0; cy < 4; cy++) {
          for (let cx = 0; cx < 4; cx++) {
            g.fillStyle = (cx + cy) % 2 === 0 ? cLine : '#0b0b0d'
            g.fillRect(tx + cx * checkSize, ty + cy * checkSize, checkSize, checkSize)
          }
        }
      } else if (surface === S_PICKUP) {
        // Recessed tarmac induction charging pad
        g.fillStyle = cTile
        g.fillRect(tx, ty, T, T)

        // Subtle recessed charging pad border
        g.strokeStyle = 'rgba(58, 209, 196, 0.35)'
        g.lineWidth = 1.5
        g.strokeRect(tx + 4, ty + 4, T - 8, T - 8)

        // Induction plate crosshair marks
        g.strokeStyle = 'rgba(58, 209, 196, 0.2)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(tx + 4, ty + T * 0.5)
        g.lineTo(tx + T - 4, ty + T * 0.5)
        g.moveTo(tx + T * 0.5, ty + 4)
        g.lineTo(tx + T * 0.5, ty + T - 4)
        g.stroke()

        // Center contact dot
        g.fillStyle = 'rgba(58, 209, 196, 0.3)'
        g.beginPath()
        g.arc(tx + T * 0.5, ty + T * 0.5, 3, 0, Math.PI * 2)
        g.fill()
      } else if (surface === S_OIL) {
        g.fillStyle = cTile
        g.fillRect(tx, ty, T, T)

        g.fillStyle = '#111116'
        g.beginPath()
        g.arc(tx + T * 0.5, ty + T * 0.5, T * 0.4, 0, Math.PI * 2)
        g.fill()

        g.strokeStyle = 'rgba(56, 189, 248, 0.3)'
        g.lineWidth = 1
        g.stroke()
      } else if (surface === S_GRAVEL) {
        // Loose stone. Stippled so it reads as run off rather than as tarmac in
        // a different shade, which colour alone would not carry.
        g.fillStyle = '#4a4438'
        g.fillRect(tx, ty, T, T)
        g.fillStyle = 'rgba(0, 0, 0, 0.35)'
        for (let d = 0; d < 6; d++) {
          const gx = tx + ((x * 7 + y * 13 + d * 11) % T)
          const gy = ty + ((x * 17 + y * 5 + d * 19) % T)
          g.fillRect(gx, gy, 2, 2)
        }
      } else if (surface === S_RAMP) {
        // A ramp reads as raised: a bright leading lip and chevrons pointing the
        // way it launches, so it is never mistaken for a boost strip.
        g.fillStyle = '#2b2118'
        g.fillRect(tx, ty, T, T)
        g.fillStyle = cWarn
        g.fillRect(tx, ty, T, Math.max(2, T * 0.18))
        g.strokeStyle = cWarn
        g.lineWidth = 2
        for (const cy of [ty + T * 0.45, ty + T * 0.72]) {
          g.beginPath()
          g.moveTo(tx + T * 0.2, cy + T * 0.12)
          g.lineTo(tx + T * 0.5, cy - T * 0.08)
          g.lineTo(tx + T * 0.8, cy + T * 0.12)
          g.stroke()
        }
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
  if (item === 'banana') return 'BANANA ◑'
  return 'EMPTY -'
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
  if (hud.phase === 'countdown') {
    return `Grid countdown active. Green flag in ${hud.countdown}s.`
  }
  if (me?.place != null) {
    return `Race under way. Lap ${hud.lap + 1} of ${hud.laps}. Running in P${me.place}.`
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
  // Crossing the line is the one moment in a race worth interrupting the screen
  // for, and it was passing silently. `lapFlash` holds the lap just completed;
  // `lastLapRef` is what stops the same crossing announcing itself every frame.
  const [lapFlash, setLapFlash] = useState(null)
  const lastLapRef = useRef(0)

  const wsRef = useRef(null)
  const canvasRef = useRef(null)
  const trackCanvasRef = useRef(null)
  const bufRef = useRef(makeBuffer(DELAY_MS, 'cars'))
  const myIdRef = useRef(null)
  const keysRef = useRef(new Set())
  const wantsReadyRef = useRef(false)
  const skidsRef = useRef([])
  const mmAlphaRef = useRef(0.95)

  // --- Connect and socket lifecycle -----------------------------------------
  const connect = useCallback((playerName, andReady = false) => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    wantsReadyRef.current = andReady
    bufRef.current = makeBuffer(DELAY_MS, 'cars')
    keysRef.current.clear()
    skidsRef.current = []

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
        bufRef.current = makeBuffer(DELAY_MS, 'cars')
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

  // Announce a completed lap. Driven off the snapshot rather than a local guess,
  // so it fires exactly when the server banked the lap and never when it did not.
  useEffect(() => {
    const mine = hud?.cars?.find((c) => c.id === myId)
    if (!mine) return
    if (mine.lap > lastLapRef.current) {
      lastLapRef.current = mine.lap
      if (mine.lap > 0) {
        setLapFlash({ lap: mine.lap, of: hud.laps, at: Date.now() })
      }
    } else if (mine.lap < lastLapRef.current) {
      // A restart resets the counter, so the next lap 1 still announces itself.
      lastLapRef.current = mine.lap
    }
  }, [hud, myId])

  // The banner clears itself. Keyed on `at` so a lap completed while one is
  // already showing restarts the timer rather than inheriting the old one.
  useEffect(() => {
    if (!lapFlash) return
    const id = setTimeout(() => setLapFlash(null), 1600)
    return () => clearTimeout(id)
  }, [lapFlash])

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

      if (!sampled) {
        if (track) {
          const initialCam = (GRID - VIEW_CELLS) / 2
          ctx.drawImage(
            track,
            initialCam * TILE_RES,
            initialCam * TILE_RES,
            VIEW_CELLS * TILE_RES,
            VIEW_CELLS * TILE_RES,
            0,
            0,
            CANVAS,
            CANVAS,
          )
        }
        rafId = requestAnimationFrame(frame)
        return
      }

      // The buffer blends whichever array it was given the key for, so this is
      // the interpolated list, not the raw newest frame.
      const cars = sampled.cars ?? []
      const palette = resolvePalette()

      // --- 1. Follow Camera & Heading-Up Orientation -------------------------
      const me = cars.find((c) => c.id === myIdRef.current)
      const aliveCars = cars.filter((c) => c.alive)
      // `cars` arrives in join order, not running order, so the first entry is
      // whoever joined first. The leader is the car the server placed first.
      const leaderCar = cars.find((c) => c.place === 1) ?? aliveCars[0] ?? cars[0]
      const focusCar = me && me.alive ? me : leaderCar

      const focusX = focusCar ? focusCar.x : GRID / 2
      const focusY = focusCar ? focusCar.y : GRID / 2
      const focusHeading = focusCar ? focusCar.heading : -Math.PI / 2

      const viewW = VIEW_CELLS
      const u = CANVAS / viewW // Screen pixels per world tile (e.g. 768 / 22 = 34.9px)

      // Screen anchor position for the followed car (centered horizontally, 56% down vertically)
      const screenX = CANVAS / 2
      const screenY = CANVAS * 0.56

      // Rotate camera so car heading always points North (-Y in screen coordinates)
      const camRot = -Math.PI / 2 - focusHeading

      // --- 2. Render World Inside Rotated & Translated Camera Transform ---
      ctx.save()
      ctx.translate(screenX, screenY)
      ctx.rotate(camRot)
      ctx.translate(-focusX * u, -focusY * u)

      // Background Track Blit (draws the full circuit into world coordinates)
      if (track) {
        ctx.drawImage(track, 0, 0, track.width, track.height, 0, 0, GRID * u, GRID * u)
      }

      // 3a. Update & Draw Dynamic Skid Marks
      for (const car of cars) {
        if (car.alive && car.sliding) {
          const cos = Math.cos(car.heading)
          const sin = Math.sin(car.heading)
          const rlX = car.x - cos * 0.45 - sin * 0.25
          const rlY = car.y - sin * 0.45 + cos * 0.25
          const rrX = car.x - cos * 0.45 + sin * 0.25
          const rrY = car.y - sin * 0.45 - cos * 0.25
          skidsRef.current.push({ x: rlX, y: rlY, at: now })
          skidsRef.current.push({ x: rrX, y: rrY, at: now })
        }
      }
      if (skidsRef.current.length > 500) {
        skidsRef.current = skidsRef.current.slice(-400)
      }
      skidsRef.current = skidsRef.current.filter((s) => now - s.at < 3500)
      for (const s of skidsRef.current) {
        const age = (now - s.at) / 3500
        ctx.fillStyle = `rgba(12, 12, 16, ${(1 - age) * 0.45})`
        ctx.beginPath()
        ctx.arc(s.x * u, s.y * u, u * 0.08, 0, Math.PI * 2)
        ctx.fill()
      }

      // 3b. Draw Active Hazards
      const hazards = sampled.hazards ?? []
      for (const h of hazards) {
        const hx = h.x * u
        const hy = h.y * u

        if (h.kind === 'slick') {
          // Viscous organic oil puddle with petroleum iridescent sheen
          ctx.save()
          ctx.translate(hx, hy)

          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
          ctx.beginPath()
          ctx.ellipse(2, 3, u * 0.7, u * 0.55, 0.3, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#0d0d12'
          ctx.beginPath()
          ctx.ellipse(0, 0, u * 0.68, u * 0.52, 0.35, 0, Math.PI * 2)
          ctx.fill()

          const grad = ctx.createLinearGradient(-u * 0.5, -u * 0.4, u * 0.5, u * 0.4)
          grad.addColorStop(0, 'rgba(45, 212, 191, 0.45)')
          grad.addColorStop(0.5, 'rgba(192, 132, 252, 0.45)')
          grad.addColorStop(1, 'rgba(251, 191, 36, 0.35)')
          ctx.strokeStyle = grad
          ctx.lineWidth = 1.8
          ctx.stroke()

          ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
          ctx.beginPath()
          ctx.ellipse(-u * 0.2, -u * 0.15, u * 0.2, u * 0.1, 0.35, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#0d0d12'
          ctx.beginPath()
          ctx.arc(u * 0.6, -u * 0.25, u * 0.1, 0, Math.PI * 2)
          ctx.arc(-u * 0.55, u * 0.3, u * 0.08, 0, Math.PI * 2)
          ctx.arc(u * 0.2, u * 0.45, u * 0.09, 0, Math.PI * 2)
          ctx.fill()

          ctx.restore()
        } else if (h.kind === 'banana') {
          // A banana peel. Small, bright and unmistakably not part of the road,
          // because it is one use and you only get to see it once. Structure as
          // well as colour: a crescent with a stalk, so it reads without relying
          // on yellow alone.
          ctx.save()
          ctx.translate(hx, hy)
          ctx.rotate(Math.sin(now / 600 + hx) * 0.3)

          const r = u * 0.3

          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
          ctx.beginPath()
          ctx.ellipse(2, 3, r, r * 0.62, 0, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#facc15'
          ctx.beginPath()
          ctx.arc(0, 0, r, Math.PI * 0.15, Math.PI * 0.85)
          ctx.arc(0, r * 0.42, r * 0.92, Math.PI * 0.85, Math.PI * 0.15, true)
          ctx.closePath()
          ctx.fill()

          ctx.strokeStyle = '#a16207'
          ctx.lineWidth = 1.2
          ctx.stroke()

          ctx.strokeStyle = '#713f12'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(-r * 0.85, r * 0.1)
          ctx.lineTo(-r * 1.15, -r * 0.35)
          ctx.stroke()

          ctx.restore()
        }
      }

      // 3c. Draw Active Dynamic Powerups (Hovering / Spinning Crates)
      const pickups = sampled.pickups ?? []
      for (const p of pickups) {
        const px = p.x * u
        const py = p.y * u
        const bob = Math.sin(now / 180 + p.x * 2.5) * (u * 0.1)
        const rot = now / 400 + p.y

        // Ground drop shadow beneath hovering crate
        ctx.save()
        ctx.translate(px, py)
        const shadowScale = 1 - (bob / (u * 0.1)) * 0.15
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
        ctx.beginPath()
        ctx.ellipse(0, 0, u * 0.38 * shadowScale, u * 0.22 * shadowScale, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()

        // Hovering powerup crate
        ctx.save()
        ctx.translate(px, py - u * 0.25 + bob)
        ctx.rotate(rot)
        const crateSize = u * 0.58

        // Cyan glow aura
        ctx.shadowColor = '#3ad1c4'
        ctx.shadowBlur = 8

        // Crate container
        ctx.fillStyle = '#092523'
        ctx.fillRect(-crateSize / 2, -crateSize / 2, crateSize, crateSize)

        ctx.strokeStyle = '#3ad1c4'
        ctx.lineWidth = 1.8
        ctx.strokeRect(-crateSize / 2, -crateSize / 2, crateSize, crateSize)

        // Luminous diamond core
        ctx.fillStyle = '#3ad1c4'
        ctx.beginPath()
        ctx.moveTo(0, -crateSize * 0.32)
        ctx.lineTo(crateSize * 0.32, 0)
        ctx.lineTo(0, crateSize * 0.32)
        ctx.lineTo(-crateSize * 0.32, 0)
        ctx.closePath()
        ctx.fill()

        // WCAG 1.4.1 structural glyph: ✶
        ctx.fillStyle = '#0b0b0d'
        ctx.font = `bold ${Math.round(crateSize * 0.46)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('✶', 0, 0.5)

        ctx.restore()
      }

      // 3d. Draw Cars (Procedural GT Racer Chassis)
      for (const car of cars) {
        const cx = car.x * u
        const cy = car.y * u
        const isMe = car.id === myIdRef.current
        const alive = car.alive
        const color = palette[car.slot % 8]

        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(car.heading)

        // Drawn from the same constants the collision shape derives from, so
        // the car you see and the car you hit are the same size.
        const L = u * CAR_LENGTH
        const W = u * CAR_WIDTH
        const halfL = L / 2
        const halfW = W / 2

        if (!alive) {
          ctx.globalAlpha = 0.35
        }

        // Dynamic Headlights (cast forward onto the track)
        if (alive) {
          const beamGrad = ctx.createRadialGradient(
            halfL * 0.8,
            0,
            halfW * 0.3,
            halfL + u * 2.2,
            0,
            u * 1.5,
          )
          beamGrad.addColorStop(0, 'rgba(255, 255, 230, 0.3)')
          beamGrad.addColorStop(0.5, 'rgba(255, 255, 230, 0.1)')
          beamGrad.addColorStop(1, 'rgba(255, 255, 230, 0)')
          ctx.fillStyle = beamGrad
          ctx.beginPath()
          ctx.moveTo(halfL * 0.8, -halfW * 0.55)
          ctx.lineTo(halfL + u * 2.2, -halfW * 1.7)
          ctx.lineTo(halfL + u * 2.2, halfW * 1.7)
          ctx.lineTo(halfL * 0.8, halfW * 0.55)
          ctx.closePath()
          ctx.fill()
        }

        // Boosting Flame Wake (twin exhaust plumes)
        if (car.boosting && alive) {
          const plumeLen = u * (0.8 + 0.25 * Math.sin(now / 30))
          ctx.fillStyle = '#f97316'
          ctx.beginPath()
          ctx.moveTo(-halfL, -halfW * 0.4)
          ctx.lineTo(-halfL - plumeLen, -halfW * 0.4)
          ctx.lineTo(-halfL, -halfW * 0.15)
          ctx.moveTo(-halfL, halfW * 0.15)
          ctx.lineTo(-halfL - plumeLen, halfW * 0.4)
          ctx.lineTo(-halfL, halfW * 0.4)
          ctx.fill()

          ctx.fillStyle = '#38bdf8'
          ctx.beginPath()
          ctx.moveTo(-halfL, -halfW * 0.35)
          ctx.lineTo(-halfL - plumeLen * 0.65, -halfW * 0.4)
          ctx.lineTo(-halfL, -halfW * 0.2)
          ctx.moveTo(-halfL, halfW * 0.2)
          ctx.lineTo(-halfL - plumeLen * 0.65, halfW * 0.4)
          ctx.lineTo(-halfL, halfW * 0.35)
          ctx.fill()
        }

        // Drafting Slipstream Wake
        if (car.drafting && alive) {
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 1.8
          ctx.beginPath()
          ctx.moveTo(-halfL - 8, -halfW * 0.7)
          ctx.lineTo(-halfL - 3, 0)
          ctx.lineTo(-halfL - 8, halfW * 0.7)
          ctx.stroke()

          ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(-halfL - 14, -halfW * 0.9)
          ctx.lineTo(-halfL - 8, 0)
          ctx.lineTo(-halfL - 14, halfW * 0.9)
          ctx.stroke()
        }

        // Drift Sparks
        if (car.sliding && alive) {
          const sparkColor = Math.sin(now / 20) > 0 ? '#fbbf24' : '#f97316'
          ctx.fillStyle = sparkColor
          for (let s = 0; s < 4; s++) {
            const sx = -halfL * 0.7 - Math.random() * u * 0.4
            const sy = (Math.random() > 0.5 ? -halfW : halfW) + (Math.random() - 0.5) * 4
            ctx.fillRect(sx, sy, 2, 2)
          }
        }

        // 4 Wheels / Tires (Precision Rounded Rubber & Alloy Rims)
        const tw = L * 0.28
        const th = W * 0.24
        const steerAngle = (car.steer ?? 0) * 0.32

        // Mechanical dark axle bars
        ctx.strokeStyle = '#27272a'
        ctx.lineWidth = 2.5
        // Front axle
        ctx.beginPath()
        ctx.moveTo(halfL * 0.52, -halfW * 0.78)
        ctx.lineTo(halfL * 0.52, halfW * 0.78)
        ctx.stroke()
        // Rear axle
        ctx.beginPath()
        ctx.moveTo(-halfL * 0.52, -halfW * 0.78)
        ctx.lineTo(-halfL * 0.52, halfW * 0.78)
        ctx.stroke()

        // Helper to render one high-fidelity wheel
        const renderWheel = (wx, wy, ang = 0) => {
          ctx.save()
          ctx.translate(wx, wy)
          if (ang !== 0) ctx.rotate(ang)

          // Tire drop shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath()
            ctx.roundRect(-tw / 2 + 1, -th / 2 + 1.5, tw, th, 2.5)
            ctx.fill()
          }

          // Outer rubber tire (rounded)
          ctx.fillStyle = '#141417'
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath()
            ctx.roundRect(-tw / 2, -th / 2, tw, th, 2.5)
            ctx.fill()
          } else {
            ctx.fillRect(-tw / 2, -th / 2, tw, th)
          }

          // Center tire tread line
          ctx.strokeStyle = '#27272a'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(-tw / 2 + 2, 0)
          ctx.lineTo(tw / 2 - 2, 0)
          ctx.stroke()

          // Metallic alloy rim
          ctx.fillStyle = '#71717a'
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath()
            ctx.roundRect(-tw * 0.28, -th * 0.32, tw * 0.56, th * 0.64, 1.5)
            ctx.fill()
          } else {
            ctx.fillRect(-tw * 0.28, -th * 0.32, tw * 0.56, th * 0.64)
          }

          // Chrome center hubcap
          ctx.fillStyle = '#f4f4f5'
          ctx.beginPath()
          ctx.arc(0, 0, 1.2, 0, Math.PI * 2)
          ctx.fill()

          ctx.restore()
        }

        // Rear tires (fixed)
        renderWheel(-halfL * 0.52, -halfW * 0.78, 0)
        renderWheel(-halfL * 0.52, halfW * 0.78, 0)

        // Front tires (steered)
        renderWheel(halfL * 0.52, -halfW * 0.78, steerAngle)
        renderWheel(halfL * 0.52, halfW * 0.78, steerAngle)

        // Car Body Drop Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-halfL * 0.85 + 2, -halfW * 0.55 + 2, L * 0.85, W * 0.55, 4)
        } else {
          ctx.rect(-halfL * 0.85 + 2, -halfW * 0.55 + 2, L * 0.85, W * 0.55)
        }
        ctx.fill()

        // Aerodynamic GT Chassis Body with sculpted wheel arches
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(halfL * 0.88, 0)
        ctx.lineTo(halfL * 0.76, -halfW * 0.52)
        ctx.lineTo(halfL * 0.58, -halfW * 0.52)
        ctx.lineTo(halfL * 0.42, -halfW * 0.48)
        ctx.lineTo(halfL * 0.2, -halfW * 0.52)
        ctx.lineTo(-halfL * 0.35, -halfW * 0.52)
        ctx.lineTo(-halfL * 0.45, -halfW * 0.48)
        ctx.lineTo(-halfL * 0.65, -halfW * 0.52)
        ctx.lineTo(-halfL * 0.88, -halfW * 0.46)
        ctx.lineTo(-halfL * 0.88, halfW * 0.46)
        ctx.lineTo(-halfL * 0.65, halfW * 0.52)
        ctx.lineTo(-halfL * 0.45, halfW * 0.48)
        ctx.lineTo(-halfL * 0.35, halfW * 0.52)
        ctx.lineTo(halfL * 0.2, halfW * 0.52)
        ctx.lineTo(halfL * 0.42, halfW * 0.48)
        ctx.lineTo(halfL * 0.58, halfW * 0.52)
        ctx.lineTo(halfL * 0.76, halfW * 0.52)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = isMe ? '#ffffff' : '#0b0b0d'
        ctx.lineWidth = isMe ? 1.8 : 1.2
        ctx.stroke()

        // Front Splitter Lip
        ctx.fillStyle = '#111115'
        ctx.fillRect(halfL * 0.75, -halfW * 0.52, L * 0.1, W * 1.04)

        // Cockpit / Windshield Glass
        ctx.fillStyle = '#0a0e17'
        ctx.beginPath()
        ctx.ellipse(0, 0, L * 0.28, W * 0.42, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
        ctx.lineWidth = 1
        ctx.stroke()

        // Windshield reflection streak
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(-L * 0.12, -W * 0.25)
        ctx.lineTo(L * 0.12, W * 0.25)
        ctx.stroke()

        // Rear GT Wing / Spoiler
        ctx.fillStyle = '#18181b'
        ctx.fillRect(-halfL * 0.88, -halfW * 0.75, L * 0.12, W * 1.5)
        ctx.fillStyle = color
        ctx.fillRect(-halfL * 0.9, -halfW * 0.8, L * 0.08, 3)
        ctx.fillRect(-halfL * 0.9, halfW * 0.8 - 3, L * 0.08, 3)

        // Headlight Lenses
        ctx.fillStyle = '#fef08a'
        ctx.fillRect(halfL * 0.72, -halfW * 0.55, 2, 4)
        ctx.fillRect(halfL * 0.72, halfW * 0.55 - 4, 2, 4)

        // Taillights (glow during braking)
        const brakeActive = car.brake && alive
        ctx.fillStyle = brakeActive ? '#ff2222' : '#dc2626'
        ctx.fillRect(-halfL * 0.87, -halfW * 0.5, 2, 5)
        ctx.fillRect(-halfL * 0.87, halfW * 0.5 - 5, 2, 5)
        if (brakeActive) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.4)'
          ctx.beginPath()
          ctx.arc(-halfL * 0.87, -halfW * 0.35, 6, 0, Math.PI * 2)
          ctx.arc(-halfL * 0.87, halfW * 0.35, 6, 0, Math.PI * 2)
          ctx.fill()
        }

        // Roof Number Roundel / Place Badge (kept upright relative to screen)
        if (alive && car.place != null) {
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.ellipse(-L * 0.02, 0, 7.5, 7.5, 0, 0, Math.PI * 2)
          ctx.fill()

          ctx.save()
          ctx.translate(-L * 0.02, 0)
          ctx.rotate(-car.heading - camRot)
          ctx.fillStyle = '#09090b'
          ctx.font = 'bold 9px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(car.place), 0, 0.5)
          ctx.restore()
        }

        ctx.restore()
      }

      ctx.restore() // Restore world transform to screen space

      // --- 3. Screen Space UI Elements --------------------------------------
      // Local Car "YOU" Floating Indicator (always upright on screen)
      if (me && me.alive) {
        ctx.save()
        const bob = Math.sin(now / 150) * 2.5
        const indicatorY = screenY - u * 1.25 + bob

        ctx.fillStyle = '#3ad1c4'
        ctx.beginPath()
        ctx.moveTo(screenX, indicatorY + 5)
        ctx.lineTo(screenX - 5, indicatorY - 2)
        ctx.lineTo(screenX + 5, indicatorY - 2)
        ctx.closePath()
        ctx.fill()

        ctx.fillStyle = 'rgba(11, 11, 13, 0.85)'
        ctx.fillRect(screenX - 14, indicatorY - 15, 28, 12)
        ctx.strokeStyle = '#3ad1c4'
        ctx.lineWidth = 1
        ctx.strokeRect(screenX - 14, indicatorY - 15, 28, 12)

        ctx.fillStyle = '#3ad1c4'
        ctx.font = 'bold 8px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('YOU', screenX, indicatorY - 9)
        ctx.restore()
      }

      // --- 4. Top-Right Minimap (Circuit Radar) ------------------------------
      const pad = 14
      const mmW = Math.round(CANVAS * MINIMAP_FRACTION)
      const mmH = mmW
      const mmX = CANVAS - mmW - pad
      const mmY = pad

      // Dynamic fade when any car is under the minimap in screen space
      const nearMap = u * 1.5
      const cosCam = Math.cos(camRot)
      const sinCam = Math.sin(camRot)
      const behindMap = cars.some((c) => {
        if (!c.alive) return false
        const dx = (c.x - focusX) * u
        const dy = (c.y - focusY) * u
        const sx = screenX + dx * cosCam - dy * sinCam
        const sy = screenY + dx * sinCam + dy * cosCam
        return (
          sx > mmX - nearMap &&
          sx < mmX + mmW + nearMap &&
          sy > mmY - nearMap &&
          sy < mmY + mmH + nearMap
        )
      })
      mmAlphaRef.current += ((behindMap ? 0.22 : 0.94) - mmAlphaRef.current) * 0.15
      const mmA = mmAlphaRef.current

      ctx.save()
      ctx.globalAlpha = mmA

      // Minimap card container
      ctx.fillStyle = 'rgba(11, 11, 15, 0.88)'
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath()
        ctx.roundRect(mmX, mmY, mmW, mmH, 6)
        ctx.fill()
      } else {
        ctx.fillRect(mmX, mmY, mmW, mmH)
      }
      ctx.strokeStyle = '#27272a'
      ctx.lineWidth = 1.5
      if (typeof ctx.roundRect === 'function') {
        ctx.stroke()
      } else {
        ctx.strokeRect(mmX, mmY, mmW, mmH)
      }

      // Draw scaled whole circuit
      if (track) {
        ctx.drawImage(track, 0, 0, track.width, track.height, mmX + 4, mmY + 4, mmW - 8, mmH - 8)
      }

      // Camera FOV Wedge & Heading on Minimap
      const fx = mmX + 4 + (focusX / GRID) * (mmW - 8)
      const fy = mmY + 4 + (focusY / GRID) * (mmH - 8)
      const fovAngle = 0.55
      const fovLen = 14
      ctx.fillStyle = 'rgba(58, 209, 196, 0.22)'
      ctx.beginPath()
      ctx.moveTo(fx, fy)
      ctx.arc(fx, fy, fovLen, focusHeading - fovAngle, focusHeading + fovAngle)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#3ad1c4'
      ctx.lineWidth = 1.2
      ctx.stroke()

      // Active Pickup Blips on Minimap
      const activePickups = sampled.pickups ?? []
      ctx.fillStyle = '#3ad1c4'
      for (const p of activePickups) {
        const px = mmX + 4 + (p.x / GRID) * (mmW - 8)
        const py = mmY + 4 + (p.y / GRID) * (mmH - 8)
        ctx.beginPath()
        ctx.arc(px, py, 2, 0, Math.PI * 2)
        ctx.fill()
      }

      // Driver Blips
      for (const car of cars) {
        const bx = mmX + 4 + (car.x / GRID) * (mmW - 8)
        const by = mmY + 4 + (car.y / GRID) * (mmH - 8)
        const isMeCar = car.id === myIdRef.current
        const carColor = palette[car.slot % 8]

        ctx.fillStyle = carColor
        ctx.beginPath()
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2)
        ctx.fill()

        if (isMeCar) {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.8
          ctx.beginPath()
          ctx.arc(bx, by, 5.5, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // Header tag
      ctx.fillStyle = '#71717a'
      ctx.font = 'bold 8px monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('CIRCUIT RADAR', mmX + 8, mmY + 8)

      ctx.restore()

      // --- 5. Non-Racing Overlay Banners ------------------------------------
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
          Eight haulers, one shared asphalt loop. Chase camera locked forward to your car. Complete
          the circuit laps and take the checkered flag.
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
          {/* Bots are chosen from inside the lobby, not from the join screen. You
              name yourself and enter the grid first, so the decision to race AI
              is made where you can already see who else turned up. */}
          <button
            type="submit"
            className="bg-flare px-6 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
          >
            Enter Grid
          </button>
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
  // `cars` arrives in join order, not running order, so the first entry is
      // whoever joined first. The leader is the car the server placed first.
      const leaderCar = cars.find((c) => c.place === 1) ?? aliveCars[0] ?? cars[0]

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
          <span className="rule-label">{circuitName || 'Circuit'} Circuit</span>
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

          {/* Lap banner. aria-live so it is announced rather than only seen, and
              pointer-events-none so it can never swallow a click meant for the
              canvas underneath. */}
          {lapFlash && (
            <div
              className="pointer-events-none absolute inset-x-0 top-10 flex justify-center"
              aria-live="polite"
            >
              <div className="border border-flare bg-bg/85 px-8 py-4 text-center">
                <p className="rule-label text-flare">
                  {lapFlash.lap >= lapFlash.of ? 'Final lap complete' : 'Lap complete'}
                </p>
                <p className="display mt-1 text-4xl tabular-nums">
                  {Math.min(lapFlash.lap + 1, lapFlash.of)} / {lapFlash.of}
                </p>
              </div>
            </div>
          )}

          {/* Fixed-height HUD strip below canvas so layout never reflows */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-px border border-line bg-line text-xs">
            <div className="bg-bg p-2.5 h-16 flex flex-col justify-center">
              <p className="rule-label">Place</p>
              <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-fg">
                {me?.place != null ? `P${me.place}/${cars.length}` : '-'}
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
              <p className="rule-label">Leader</p>
              <p className="mt-0.5 font-mono text-sm font-bold truncate text-fg">
                {leaderCar ? `${leaderCar.name} (P1)` : '-'}
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
                <span>Chequered start, finish and timing line.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <BannerAd className="mt-12" />
    </section>
  )
}
