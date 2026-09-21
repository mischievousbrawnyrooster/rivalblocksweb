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
        // Powerup charging pad
        g.fillStyle = cTile
        g.fillRect(tx, ty, T, T)

        g.strokeStyle = cFlare
        g.lineWidth = 1.5
        g.strokeRect(tx + 4, ty + 4, T - 8, T - 8)

        g.fillStyle = cFlare
        g.beginPath()
        g.moveTo(tx + T * 0.5, ty + T * 0.25)
        g.lineTo(tx + T * 0.75, ty + T * 0.5)
        g.lineTo(tx + T * 0.5, ty + T * 0.75)
        g.lineTo(tx + T * 0.25, ty + T * 0.5)
        g.closePath()
        g.fill()

        g.fillStyle = '#0b0b0d'
        g.beginPath()
        g.arc(tx + T * 0.5, ty + T * 0.5, 2.5, 0, Math.PI * 2)
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
  const skidsRef = useRef([])
  const mmAlphaRef = useRef(0.95)

  // --- Connect and socket lifecycle -----------------------------------------
  const connect = useCallback((playerName, andReady = false) => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    wantsReadyRef.current = andReady
    bufRef.current = makeBuffer(DELAY_MS)
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

      const cars = sampled.players ?? sampled.cars ?? []
      const palette = resolvePalette()

      // --- 1. Follow Camera Viewport ----------------------------------------
      const me = cars.find((c) => c.id === myIdRef.current)
      const aliveCars = cars.filter((c) => c.alive)
      const leaderCar = aliveCars[0] ?? cars[0]
      const focusCar = me && me.alive ? me : leaderCar

      const focusX = focusCar ? focusCar.x : GRID / 2
      const focusY = focusCar ? focusCar.y : GRID / 2

      const viewW = VIEW_CELLS
      const u = CANVAS / viewW // Screen pixels per world tile (e.g. 768 / 22 = 34.9px)
      const viewH = CANVAS / u

      const camX = Math.max(0, Math.min(GRID - viewW, focusX - viewW / 2))
      const camY = Math.max(0, Math.min(GRID - viewH, focusY - viewH / 2))
      const offX = camX * u
      const offY = camY * u

      // --- 2. Background Track Blit -----------------------------------------
      if (track) {
        ctx.drawImage(
          track,
          camX * TILE_RES,
          camY * TILE_RES,
          viewW * TILE_RES,
          viewH * TILE_RES,
          0,
          0,
          CANVAS,
          CANVAS,
        )
      }

      // --- 3. World Space Elements (Camera Offset) --------------------------
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, -offX, -offY)

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
        } else if (h.kind === 'wall') {
          // Concrete impact crash barrier
          ctx.save()
          ctx.translate(hx, hy)

          const bw = u * 0.85
          const bh = u * 0.85

          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
          ctx.fillRect(-bw / 2 + 3, -bh / 2 + 4, bw, bh)

          ctx.fillStyle = '#1e1e24'
          ctx.fillRect(-bw / 2, -bh / 2, bw, bh)

          ctx.strokeStyle = '#3f3f46'
          ctx.lineWidth = 1.5
          ctx.strokeRect(-bw / 2, -bh / 2, bw, bh)

          ctx.save()
          ctx.beginPath()
          ctx.rect(-bw / 2, -bh / 2, bw, bh)
          ctx.clip()

          ctx.strokeStyle = '#fbbf24'
          ctx.lineWidth = 3.5
          for (let d = -bw * 1.5; d <= bw * 1.5; d += 8) {
            ctx.beginPath()
            ctx.moveTo(d, -bh / 2 - 2)
            ctx.lineTo(d + bh + 4, bh / 2 + 2)
            ctx.stroke()
          }
          ctx.restore()

          const flasherPulse = Math.sin(now / 100) > 0 ? 1 : 0.2
          ctx.fillStyle = `rgba(245, 158, 11, ${0.4 + 0.6 * flasherPulse})`
          ctx.beginPath()
          ctx.arc(0, 0, u * 0.18, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1
          ctx.stroke()

          ctx.restore()
        }
      }

      // 3c. Draw Cars (Procedural GT Racer Chassis)
      for (const car of cars) {
        const cx = car.x * u
        const cy = car.y * u
        const isMe = car.id === myIdRef.current
        const alive = car.alive
        const color = palette[car.slot % 8]

        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(car.heading)

        const L = u * 1.45 // ~50px
        const W = u * 0.82 // ~29px
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

        // 4 Wheels / Tires
        const tw = L * 0.24
        const th = W * 0.2
        const steerAngle = (car.steer ?? 0) * 0.32

        // Rear tires (fixed)
        ctx.fillStyle = '#18181b'
        ctx.fillRect(-halfL * 0.65 - tw / 2, -halfW * 0.95, tw, th)
        ctx.fillRect(-halfL * 0.65 - tw / 2, halfW * 0.95 - th, tw, th)
        ctx.fillStyle = '#52525b'
        ctx.fillRect(-halfL * 0.65 - tw / 4, -halfW * 0.95 + 1, tw / 2, th - 2)
        ctx.fillRect(-halfL * 0.65 - tw / 4, halfW * 0.95 - th + 1, tw / 2, th - 2)

        // Front tires (steer rotation)
        for (const side of [-1, 1]) {
          ctx.save()
          const fty = side === -1 ? -halfW * 0.95 + th / 2 : halfW * 0.95 - th / 2
          ctx.translate(halfL * 0.55, fty)
          ctx.rotate(steerAngle)
          ctx.fillStyle = '#18181b'
          ctx.fillRect(-tw / 2, -th / 2, tw, th)
          ctx.fillStyle = '#52525b'
          ctx.fillRect(-tw / 4, -th / 2 + 1, tw / 2, th - 2)
          ctx.restore()
        }

        // Car Body Drop Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-halfL * 0.85 + 2, -halfW * 0.75 + 2, L * 0.85, W * 0.75, 4)
        } else {
          ctx.rect(-halfL * 0.85 + 2, -halfW * 0.75 + 2, L * 0.85, W * 0.75)
        }
        ctx.fill()

        // Aerodynamic Chassis Body
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(halfL * 0.85, 0)
        ctx.lineTo(halfL * 0.75, -halfW * 0.65)
        ctx.lineTo(halfL * 0.2, -halfW * 0.7)
        ctx.lineTo(-halfL * 0.6, -halfW * 0.7)
        ctx.lineTo(-halfL * 0.85, -halfW * 0.55)
        ctx.lineTo(-halfL * 0.85, halfW * 0.55)
        ctx.lineTo(-halfL * 0.6, halfW * 0.7)
        ctx.lineTo(halfL * 0.2, halfW * 0.7)
        ctx.lineTo(halfL * 0.75, halfW * 0.65)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = isMe ? '#ffffff' : '#0b0b0d'
        ctx.lineWidth = isMe ? 1.8 : 1.2
        ctx.stroke()

        // Front Splitter Lip
        ctx.fillStyle = '#111115'
        ctx.fillRect(halfL * 0.72, -halfW * 0.6, L * 0.12, W * 1.2)

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

        // Roof Number Roundel / Place Badge
        if (alive && car.place != null) {
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.ellipse(-L * 0.02, 0, 7.5, 7.5, 0, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#09090b'
          ctx.font = 'bold 9px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(car.place), -L * 0.02, 0.5)
        }

        // Eliminated Cross Mark
        if (!alive) {
          ctx.strokeStyle = '#ef4444'
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.moveTo(-halfL * 0.6, -halfW * 0.6)
          ctx.lineTo(halfL * 0.6, halfW * 0.6)
          ctx.moveTo(-halfL * 0.6, halfW * 0.6)
          ctx.lineTo(halfL * 0.6, -halfW * 0.6)
          ctx.stroke()
        }

        ctx.restore()

        // Local Car "YOU" Floating Indicator
        if (isMe && alive) {
          ctx.save()
          const bob = Math.sin(now / 150) * 2.5
          const indicatorY = cy - u * 1.1 + bob

          ctx.fillStyle = '#3ad1c4'
          ctx.beginPath()
          ctx.moveTo(cx, indicatorY + 5)
          ctx.lineTo(cx - 5, indicatorY - 2)
          ctx.lineTo(cx + 5, indicatorY - 2)
          ctx.closePath()
          ctx.fill()

          ctx.fillStyle = 'rgba(11, 11, 13, 0.85)'
          ctx.fillRect(cx - 14, indicatorY - 15, 28, 12)
          ctx.strokeStyle = '#3ad1c4'
          ctx.lineWidth = 1
          ctx.strokeRect(cx - 14, indicatorY - 15, 28, 12)

          ctx.fillStyle = '#3ad1c4'
          ctx.font = 'bold 8px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('YOU', cx, indicatorY - 9)

          ctx.restore()
        }
      }

      ctx.restore() // Restore world transform

      // --- 4. Top-Right Minimap (Circuit Radar) ------------------------------
      const pad = 14
      const mmW = Math.round(CANVAS * MINIMAP_FRACTION)
      const mmH = mmW
      const mmX = CANVAS - mmW - pad
      const mmY = pad

      // Dynamic fade when any car is under the minimap
      const nearMap = u * 1.5
      const behindMap = cars.some((c) => {
        if (!c.alive) return false
        const sx = c.x * u - offX
        const sy = c.y * u - offY
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

      // Camera Viewport Box on Minimap
      const camVx = mmX + 4 + (camX / GRID) * (mmW - 8)
      const camVy = mmY + 4 + (camY / GRID) * (mmH - 8)
      const camVw = (viewW / GRID) * (mmW - 8)
      const camVh = (viewH / GRID) * (mmH - 8)

      ctx.fillStyle = 'rgba(58, 209, 196, 0.1)'
      ctx.fillRect(camVx, camVy, camVw, camVh)
      ctx.strokeStyle = '#3ad1c4'
      ctx.lineWidth = 1.2
      ctx.strokeRect(camVx, camVy, camVw, camVh)

      // Driver Blips
      const lastCarId = sampled.order?.[sampled.order.length - 1]
      for (const car of cars) {
        const bx = mmX + 4 + (car.x / GRID) * (mmW - 8)
        const by = mmY + 4 + (car.y / GRID) * (mmH - 8)
        const isMeCar = car.id === myIdRef.current
        const isCarLast = sampled.phase === 'racing' && car.id === lastCarId
        const carColor = palette[car.slot % 8]

        if (!car.alive) {
          ctx.fillStyle = '#52525b'
          ctx.beginPath()
          ctx.arc(bx, by, 2, 0, Math.PI * 2)
          ctx.fill()
          continue
        }

        ctx.fillStyle = carColor
        ctx.beginPath()
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2)
        ctx.fill()

        if (isCarLast) {
          const pulse = 1 + 0.3 * Math.sin(now / 120)
          ctx.strokeStyle = '#ef4444'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(bx, by, 5 * pulse, 0, Math.PI * 2)
          ctx.stroke()
        }

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
