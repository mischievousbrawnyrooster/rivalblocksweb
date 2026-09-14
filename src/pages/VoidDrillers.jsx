import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import SidebarAd from '../components/SidebarAd.jsx'
import BannerAd from '../components/BannerAd.jsx'
import { useTitle } from '../lib/useTitle.js'
import { useFavicon } from '../lib/useFavicon.js'

// Shaft and grid dimensions matching server/voiddrillers.js
const WIDTH = 20
const DEPTH = 260
const TOTAL_BLOCKS = WIDTH * DEPTH
const BLOCK_PX = 28
const SHAFT_WIDTH_PX = WIDTH * BLOCK_PX // 560
const MINIMAP_WIDTH_PX = 80
const CANVAS_WIDTH = SHAFT_WIDTH_PX + MINIMAP_WIDTH_PX // 640
const CANVAS_HEIGHT = 700
const VAULT_Y = 250
const SEND_MS = 16

const BLOCK_AIR = 0
const BLOCK_DIRT = 1
const BLOCK_STONE = 2
const BLOCK_BEDROCK = 3
const BLOCK_GAS = 4
const BLOCK_GEODE = 5
const BLOCK_VAULT = 6

const CHAR_TO_BLOCK = {
  A: BLOCK_AIR,
  D: BLOCK_DIRT,
  S: BLOCK_STONE,
  B: BLOCK_BEDROCK,
  G: BLOCK_GAS,
  C: BLOCK_GEODE,
  E: BLOCK_GEODE,
  V: BLOCK_VAULT,
}

// Silhouette icons and distinct colors for each player slot
const PIECE_ICON = ['🦊', '🐺', '🐙', '🦈', '🐝', '🐸', '🦅', '🐧']
const PLAYER_COLORS = [
  '#ff6b1a', // slot 0: flare
  '#3b82f6', // slot 1: blue
  '#10b981', // slot 2: emerald
  '#a855f7', // slot 3: purple
  '#f59e0b', // slot 4: amber
  '#ec4899', // slot 5: pink
  '#06b6d4', // slot 6: cyan
  '#84cc16', // slot 7: lime
]

function decodeMap(str) {
  if (!str) return new Uint8Array(0)
  const out = []
  const re = /(\d+)([A-Za-z_]+)/g
  let match
  while ((match = re.exec(str)) !== null) {
    const count = parseInt(match[1], 10)
    const char = match[2].toUpperCase()
    const type = Object.hasOwn(CHAR_TO_BLOCK, char) ? CHAR_TO_BLOCK[char] : BLOCK_AIR
    for (let i = 0; i < count; i++) {
      out.push(type)
    }
  }
  return new Uint8Array(out)
}

function statusLine(snap, myId) {
  if (!snap) return 'Connecting to excavation shaft server.'
  const me = snap.players?.find((p) => p.id === myId)
  if (snap.phase === 'over') {
    if (snap.winner) {
      const winnerName = snap.players?.find((p) => p.id === snap.winner)?.name ?? 'A driller'
      return `${winnerName} reached the extraction vault. Restarting shortly.`
    }
    return 'The crush void swallowed the shaft. No survivors. Restarting shortly.'
  }
  if (me && !me.alive) {
    return 'Crushed by the void. Spectating remaining drillers.'
  }
  const living = snap.players?.filter((p) => p.alive).length ?? 0
  const depth = me ? Math.floor(Math.max(0, me.y)) : 0
  return `Descent active. Depth: ${depth}m / 260m. ${living} drillers active.`
}

export default function VoidDrillers() {
  useTitle('Void Drillers')
  useFavicon('void-drillers')

  const [name, setName] = useState('')
  const [status, setStatus] = useState('idle') // idle | connecting | live | closed | full
  const [myId, setMyId] = useState(null)
  const [hud, setHud] = useState(null)

  const wsRef = useRef(null)
  const canvasRef = useRef(null)
  const mapRef = useRef(null)
  const snapRef = useRef(null)
  const myIdRef = useRef(null)
  const keysRef = useRef(new Set())
  const mouseDownRef = useRef(false)
  const mousePosRef = useRef({ x: SHAFT_WIDTH_PX / 2, y: CANVAS_HEIGHT / 2 })
  const hasMouseRef = useRef(false)
  const cameraYRef = useRef(0)
  const particlesRef = useRef([])
  const lastSendTimeRef = useRef(0)
  const interpRef = useRef(new Map())
  const voidYRef = useRef(null)

  // Spawn procedural spark, flame, and dust particles
  const addParticle = useCallback((p) => {
    if (particlesRef.current.length < 240) {
      particlesRef.current.push(p)
    }
  }, [])

  const spawnBreakParticles = useCallback(
    (worldX, worldY, blockType) => {
      let color = '#5a4738'
      let count = 6
      if (blockType === BLOCK_STONE) {
        color = '#64748b'
        count = 7
      } else if (blockType === BLOCK_GAS) {
        color = '#f59e0b'
        count = 10
      } else if (blockType === BLOCK_GEODE) {
        color = '#22d3ee'
        count = 12
      } else if (blockType === BLOCK_VAULT) {
        color = '#eab308'
        count = 8
      }

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const spd = 40 + Math.random() * 80
        addParticle({
          x: worldX,
          y: worldY,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - 20,
          color,
          size: 1.5 + Math.random() * 2.5,
          alpha: 1,
          life: 0.35 + Math.random() * 0.25,
          maxLife: 0.6,
        })
      }
    },
    [addParticle],
  )

  // Send input packet to authoritative server
  const sendInput = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !myIdRef.current) return
    const snap = snapRef.current
    const me = snap?.players?.find((p) => p.id === myIdRef.current)
    if (!me || !me.alive) return

    const keys = keysRef.current
    const left = keys.has('KeyA') || keys.has('ArrowLeft')
    const right = keys.has('KeyD') || keys.has('ArrowRight')
    const dx = left && right ? 0 : left ? -1 : right ? 1 : 0
    const thrust = keys.has('KeyW') || keys.has('ArrowUp') || keys.has('Space')
    const drill = mouseDownRef.current || keys.has('KeyF')

    let aim = Math.PI / 2
    if (hasMouseRef.current) {
      const myPos = interpRef.current.get(me.id) ?? me
      const playerScreenX = (myPos.x + 0.4) * BLOCK_PX
      const playerScreenY = (myPos.y + 0.45 - cameraYRef.current) * BLOCK_PX + CANVAS_HEIGHT * 0.38
      aim = Math.atan2(mousePosRef.current.y - playerScreenY, mousePosRef.current.x - playerScreenX)
    } else if (dx !== 0) {
      aim = dx > 0 ? Math.PI / 4 : (3 * Math.PI) / 4
    }

    ws.send(
      JSON.stringify({
        t: 'input',
        dx,
        thrust,
        drill,
        aim: Number(aim.toFixed(2)),
      }),
    )
    lastSendTimeRef.current = performance.now()
  }, [])

  // Connect to WebSocket with loopback fallback
  const connect = useCallback(
    (playerName) => {
      setStatus('connecting')
      let failedPrimary = false
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const primaryUrl = `${scheme}://${window.location.host}/voiddrillers-ws`
      const fallbackUrl = 'ws://127.0.0.1:8086'

      function openSocket(url, isFallback = false) {
        const ws = new WebSocket(url, 'voiddrillers.v1')
        wsRef.current = ws

        ws.onopen = () => {
          if (wsRef.current !== ws) return
          setStatus('live')
          ws.send(JSON.stringify({ t: 'join', name: playerName || 'Driller' }))
        }

        ws.onmessage = (e) => {
          if (wsRef.current !== ws) return
          let msg
          try {
            msg = JSON.parse(e.data)
          } catch {
            return
          }

          if (msg.t === 'welcome') {
            myIdRef.current = msg.id
            setMyId(msg.id)
            mapRef.current = decodeMap(msg.map)
            interpRef.current.clear()
            voidYRef.current = null
          } else if (msg.t === 'full') {
            setStatus('full')
          } else if (msg.t === 'snap') {
            if (msg.deltas && mapRef.current) {
              for (const d of msg.deltas) {
                if (typeof d.i === 'number' && d.i >= 0 && d.i < mapRef.current.length) {
                  const oldType = mapRef.current[d.i]
                  mapRef.current[d.i] = d.t
                  if (oldType !== BLOCK_AIR && d.t === BLOCK_AIR) {
                    const bx = (d.i % WIDTH) * BLOCK_PX + BLOCK_PX / 2
                    const by = Math.floor(d.i / WIDTH) * BLOCK_PX + BLOCK_PX / 2
                    spawnBreakParticles(bx, by, oldType)
                  }
                }
              }
            }
            snapRef.current = msg
            setHud(msg)
          }
        }

        ws.onerror = () => {
          if (!isFallback && !failedPrimary) {
            failedPrimary = true
            ws.close()
            openSocket(fallbackUrl, true)
          } else {
            ws.close()
          }
        }

        ws.onclose = () => {
          if (wsRef.current !== ws) return
          if (!isFallback && !failedPrimary) {
            failedPrimary = true
            openSocket(fallbackUrl, true)
            return
          }
          setStatus((s) => (s === 'full' ? s : 'closed'))
        }
      }

      openSocket(primaryUrl, false)
    },
    [spawnBreakParticles],
  )

  useEffect(() => () => wsRef.current?.close(), [])

  // Input listeners
  useEffect(() => {
    if (status !== 'live') return undefined

    const onKeyDown = (e) => {
      if (
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        e.preventDefault()
      }
      if (!keysRef.current.has(e.code)) {
        keysRef.current.add(e.code)
        sendInput()
      }
    }

    const onKeyUp = (e) => {
      if (keysRef.current.has(e.code)) {
        keysRef.current.delete(e.code)
        sendInput()
      }
    }

    const onBlur = () => {
      keysRef.current.clear()
      mouseDownRef.current = false
      sendInput()
    }

    const interval = setInterval(() => {
      sendInput()
    }, SEND_MS)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      clearInterval(interval)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [status, sendInput])

  // Mouse input handlers
  const handleCanvasMouseMove = useCallback(
    (e) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      mousePosRef.current = {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      }
      hasMouseRef.current = true
      sendInput()
    },
    [sendInput],
  )

  const handleCanvasMouseDown = useCallback(
    (e) => {
      if (e.button === 0) {
        mouseDownRef.current = true
        sendInput()
      }
    },
    [sendInput],
  )

  const handleCanvasMouseUp = useCallback(
    (e) => {
      if (e.button === 0) {
        mouseDownRef.current = false
        sendInput()
      }
    },
    [sendInput],
  )

  // 60 FPS Canvas Render Loop
  useEffect(() => {
    if (status !== 'live') return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    let rafId = null
    let lastTime = performance.now()

    function render(now) {
      const dt = Math.min(0.1, (now - lastTime) / 1000)
      lastTime = now

      const snap = snapRef.current
      const map = mapRef.current
      const me = snap?.players?.find((p) => p.id === myIdRef.current)

      // Smooth camera vertical follow
      let targetY = 10
      if (me) {
        const myPos = interpRef.current.get(me.id)
        targetY = myPos ? myPos.y : me.y
      } else if (snap) {
        targetY = (voidYRef.current ?? snap.voidY) + 6
      }
      cameraYRef.current += (targetY - cameraYRef.current) * Math.min(1, dt * 10)
      const cameraY = cameraYRef.current

      const toScreenY = (wy) => (wy - cameraY) * BLOCK_PX + CANVAS_HEIGHT * 0.38

      // Clear Canvas
      ctx.fillStyle = '#0a0c10'
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

      // 1. Render Shaft Blocks with Viewport Culling
      if (map && map.length >= TOTAL_BLOCKS) {
        const minRow = Math.max(0, Math.floor(cameraY - (CANVAS_HEIGHT * 0.38) / BLOCK_PX - 1))
        const maxRow = Math.min(DEPTH - 1, Math.ceil(cameraY + (CANVAS_HEIGHT * 0.62) / BLOCK_PX + 1))

        for (let r = minRow; r <= maxRow; r++) {
          const sy = toScreenY(r)
          for (let c = 0; c < WIDTH; c++) {
            const block = map[r * WIDTH + c]
            if (block === BLOCK_AIR) continue

            const sx = c * BLOCK_PX

            if (block === BLOCK_DIRT) {
              // Dirt: stippled dot texture
              ctx.fillStyle = '#3a2d23'
              ctx.fillRect(sx, sy, BLOCK_PX, BLOCK_PX)
              ctx.strokeStyle = '#271d16'
              ctx.lineWidth = 1
              ctx.strokeRect(sx + 0.5, sy + 0.5, BLOCK_PX - 1, BLOCK_PX - 1)

              // Stippled dots
              ctx.fillStyle = '#5c4839'
              ctx.fillRect(sx + 5, sy + 6, 2, 2)
              ctx.fillRect(sx + 19, sy + 7, 2, 2)
              ctx.fillRect(sx + 11, sy + 18, 2, 2)
              ctx.fillRect(sx + 21, sy + 21, 2, 2)
              ctx.fillStyle = '#1c1510'
              ctx.fillRect(sx + 14, sy + 12, 1.5, 1.5)
            } else if (block === BLOCK_STONE) {
              // Stone: slate horizontal strata bands and unicode glyph ≡
              ctx.fillStyle = '#222b35'
              ctx.fillRect(sx, sy, BLOCK_PX, BLOCK_PX)
              ctx.strokeStyle = '#384759'
              ctx.lineWidth = 1.5
              ctx.beginPath()
              ctx.moveTo(sx, sy + 8)
              ctx.lineTo(sx + BLOCK_PX, sy + 8)
              ctx.moveTo(sx, sy + 20)
              ctx.lineTo(sx + BLOCK_PX, sy + 20)
              ctx.stroke()

              ctx.strokeStyle = '#151b22'
              ctx.lineWidth = 1
              ctx.strokeRect(sx + 0.5, sy + 0.5, BLOCK_PX - 1, BLOCK_PX - 1)

              ctx.fillStyle = '#64748b'
              ctx.font = 'bold 13px monospace'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText('≡', sx + 14, sy + 14)
            } else if (block === BLOCK_BEDROCK) {
              // Bedrock: dark crosshatch pattern #
              ctx.fillStyle = '#0d1017'
              ctx.fillRect(sx, sy, BLOCK_PX, BLOCK_PX)
              ctx.strokeStyle = '#1e293b'
              ctx.lineWidth = 1.5
              ctx.strokeRect(sx + 0.5, sy + 0.5, BLOCK_PX - 1, BLOCK_PX - 1)

              ctx.strokeStyle = '#334155'
              ctx.lineWidth = 1.5
              ctx.beginPath()
              // Vertical hatch lines
              ctx.moveTo(sx + 9, sy + 2)
              ctx.lineTo(sx + 9, sy + BLOCK_PX - 2)
              ctx.moveTo(sx + 19, sy + 2)
              ctx.lineTo(sx + 19, sy + BLOCK_PX - 2)
              // Horizontal hatch lines
              ctx.moveTo(sx + 2, sy + 9)
              ctx.lineTo(sx + BLOCK_PX - 2, sy + 9)
              ctx.moveTo(sx + 2, sy + 19)
              ctx.lineTo(sx + BLOCK_PX - 2, sy + 19)
              ctx.stroke()
            } else if (block === BLOCK_GAS) {
              // Gas: amber warning border with hazard glyph ⊗
              ctx.fillStyle = '#451a03'
              ctx.fillRect(sx, sy, BLOCK_PX, BLOCK_PX)
              ctx.strokeStyle = '#f59e0b'
              ctx.lineWidth = 2
              ctx.strokeRect(sx + 1, sy + 1, BLOCK_PX - 2, BLOCK_PX - 2)

              ctx.fillStyle = '#fbbf24'
              ctx.font = 'bold 14px monospace'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText('⊗', sx + 14, sy + 14)
            } else if (block === BLOCK_GEODE) {
              // Geode: cyan crystal with diamond glyph ◈
              ctx.fillStyle = '#082f49'
              ctx.fillRect(sx, sy, BLOCK_PX, BLOCK_PX)
              ctx.strokeStyle = '#06b6d4'
              ctx.lineWidth = 2
              ctx.strokeRect(sx + 1, sy + 1, BLOCK_PX - 2, BLOCK_PX - 2)

              ctx.fillStyle = '#22d3ee'
              ctx.font = 'bold 15px monospace'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText('◈', sx + 14, sy + 14)
            } else if (block === BLOCK_VAULT) {
              // Vault: yellow/black industrial warning chevrons ▲
              ctx.fillStyle = '#1c1917'
              ctx.fillRect(sx, sy, BLOCK_PX, BLOCK_PX)
              ctx.strokeStyle = '#eab308'
              ctx.lineWidth = 2
              ctx.strokeRect(sx + 1, sy + 1, BLOCK_PX - 2, BLOCK_PX - 2)

              ctx.fillStyle = '#eab308'
              ctx.font = 'bold 14px monospace'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText('▲', sx + 14, sy + 14)
            }
          }
        }
      }

      // 2. Extraction Vault Landing Zone Floor Indicator
      const vaultScreenY = toScreenY(VAULT_Y)
      if (vaultScreenY >= 0 && vaultScreenY <= CANVAS_HEIGHT) {
        ctx.strokeStyle = '#eab308'
        ctx.lineWidth = 2
        ctx.setLineDash([8, 4])
        ctx.beginPath()
        ctx.moveTo(0, vaultScreenY)
        ctx.lineTo(SHAFT_WIDTH_PX, vaultScreenY)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.fillStyle = '#eab308'
        ctx.font = 'bold 11px monospace'
        ctx.textAlign = 'left'
        ctx.fillText('EXTRACTION VAULT PLATFORM (TOUCHDOWN TO WIN)', 12, vaultScreenY - 6)
      }

      // 3. Render Toxic Gas Hazards
      if (snap?.hazards) {
        for (const h of snap.hazards) {
          const hx = h.x * BLOCK_PX
          const hy = toScreenY(h.y)
          const hr = h.r * BLOCK_PX

          const grad = ctx.createRadialGradient(hx, hy, hr * 0.1, hx, hy, hr)
          grad.addColorStop(0, 'rgba(245, 158, 11, 0.45)')
          grad.addColorStop(0.7, 'rgba(217, 119, 6, 0.22)')
          grad.addColorStop(1, 'rgba(180, 83, 9, 0)')

          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(hx, hy, hr, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = 'rgba(251, 191, 36, 0.7)'
          ctx.font = 'bold 18px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('⊗', hx, hy)
        }
      }

      // 4. Update and Render Particles
      const particles = particlesRef.current
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life -= dt
        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.alpha = Math.max(0, p.life / p.maxLife)

        const py = toScreenY(p.y / BLOCK_PX)
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.alpha
        ctx.fillRect(p.x - p.size / 2, py - p.size / 2, p.size, p.size)
      }
      ctx.globalAlpha = 1

      // 5. Render Players
      if (snap?.players) {
        const activeIds = new Set()
        for (const p of snap.players) {
          activeIds.add(p.id)
          let pos = interpRef.current.get(p.id)
          if (!pos) {
            pos = { x: p.x, y: p.y }
            interpRef.current.set(p.id, pos)
          } else {
            const dx = p.x - pos.x
            const dy = p.y - pos.y
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
              pos.x = p.x
              pos.y = p.y
            } else {
              const factor = Math.min(1, dt * 30)
              pos.x += dx * factor
              pos.y += dy * factor
            }
          }

          const px = pos.x * BLOCK_PX
          const py = toScreenY(pos.y)
          const pw = 0.8 * BLOCK_PX // ~22.4px
          const ph = 0.9 * BLOCK_PX // ~25.2px
          const pcx = px + pw / 2
          const pcy = py + ph / 2
          const slotColor = PLAYER_COLORS[p.slot % PLAYER_COLORS.length]

          if (!p.alive) {
            // Crushed wreck
            ctx.fillStyle = '#374151'
            ctx.fillRect(px, py + ph - 8, pw, 8)
            ctx.fillStyle = '#9ca3af'
            ctx.font = 'bold 12px monospace'
            ctx.textAlign = 'center'
            ctx.fillText('†', pcx, py + ph - 10)
            continue
          }

          // Jetpack thruster flame particles
          if (p.vy < -0.5 || (p.id === myIdRef.current && keysRef.current.has('KeyW'))) {
            for (let f = 0; f < 2; f++) {
              addParticle({
                x: pcx + (Math.random() - 0.5) * 8,
                y: (pos.y + 0.9) * BLOCK_PX,
                vx: (Math.random() - 0.5) * 30,
                vy: 50 + Math.random() * 80,
                color: Math.random() > 0.4 ? '#ff6b1a' : '#fbbf24',
                size: 2 + Math.random() * 2,
                alpha: 1,
                life: 0.2 + Math.random() * 0.15,
                maxLife: 0.35,
              })
            }
          }

          // Drill sparks when actively drilling
          if (p.drilling) {
            const tipDist = 24
            const tipX = pcx + Math.cos(p.aim) * tipDist
            const tipWorldY = (pos.y + 0.45) * BLOCK_PX + Math.sin(p.aim) * tipDist
            for (let s = 0; s < 2; s++) {
              addParticle({
                x: tipX,
                y: tipWorldY,
                vx: -Math.cos(p.aim) * (30 + Math.random() * 60) + (Math.random() - 0.5) * 40,
                vy: -Math.sin(p.aim) * (30 + Math.random() * 60) + (Math.random() - 0.5) * 40,
                color: p.superDrill ? '#22d3ee' : '#f59e0b',
                size: 1.5 + Math.random() * 2,
                alpha: 1,
                life: 0.15 + Math.random() * 0.15,
                maxLife: 0.3,
              })
            }
          }

          // Mechanized Exosuit Body
          ctx.fillStyle = '#1e293b'
          ctx.fillRect(px, py, pw, ph)

          // Suit armor plates in player slot color
          ctx.fillStyle = slotColor
          ctx.fillRect(px + 2, py + 2, pw - 4, 6) // Shoulder plate
          ctx.fillRect(px + 4, py + 12, pw - 8, ph - 14) // Torso chassis

          // Jetpack pack on back
          ctx.fillStyle = '#0f172a'
          ctx.fillRect(px - 3, py + 4, 4, ph - 8)

          // Visor slit
          ctx.fillStyle = p.overheated ? '#ef4444' : p.superDrill ? '#22d3ee' : '#67e8f9'
          ctx.fillRect(px + pw / 2 - 4, py + 4, 8, 3)

          // Rotating drill arm
          ctx.save()
          ctx.translate(pcx, pcy)
          ctx.rotate(p.aim)

          // Mechanical arm bracket
          ctx.fillStyle = '#475569'
          ctx.fillRect(0, -3, 10, 6)

          // Drill head conical bit
          ctx.fillStyle = p.overheated ? '#dc2626' : p.superDrill ? '#06b6d4' : '#cbd5e1'
          ctx.beginPath()
          ctx.moveTo(10, -6)
          ctx.lineTo(24, 0)
          ctx.lineTo(10, 6)
          ctx.closePath()
          ctx.fill()

          // Rotating flutes / stripes on drill bit
          ctx.strokeStyle = '#0f172a'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          const fluteOffset = p.drilling ? (now * 0.04) % 6 : 0
          ctx.moveTo(12 + fluteOffset, -4)
          ctx.lineTo(14 + fluteOffset, 4)
          ctx.stroke()

          ctx.restore()

          // Player name tag and silhouette
          ctx.font = 'bold 10px monospace'
          ctx.textAlign = 'center'
          ctx.fillStyle = '#f8fafc'
          ctx.fillText(`${PIECE_ICON[p.slot % 8]} ${p.name}`, pcx, py - 6)

          if (p.id === myIdRef.current) {
            ctx.fillStyle = '#ff6b1a'
            ctx.fillText('▼ YOU', pcx, py - 18)
          }
        }

        // Clean up departed players
        for (const id of interpRef.current.keys()) {
          if (!activeIds.has(id)) {
            interpRef.current.delete(id)
          }
        }
      }

      // 6. Render Crush Void Grinder Horizon
      if (snap) {
        if (voidYRef.current === null) {
          voidYRef.current = snap.voidY
        } else {
          const dVoid = snap.voidY - voidYRef.current
          if (Math.abs(dVoid) > 5) {
            voidYRef.current = snap.voidY
          } else {
            voidYRef.current += dVoid * Math.min(1, dt * 25)
          }
        }
        const voidY = voidYRef.current
        const voidScreenY = toScreenY(voidY)
        if (voidScreenY >= -120) {
          // Crushed void interior
          const voidGrad = ctx.createLinearGradient(0, 0, 0, Math.max(0, voidScreenY))
          voidGrad.addColorStop(0, '#020205')
          voidGrad.addColorStop(0.7, '#14051a')
          voidGrad.addColorStop(1, '#2a0827')
          ctx.fillStyle = voidGrad
          ctx.fillRect(0, 0, SHAFT_WIDTH_PX, Math.max(0, voidScreenY))

          // Grinder Horizon Teeth
          const toothW = 20
          const toothH = 14
          ctx.fillStyle = '#ff6b1a'
          ctx.beginPath()
          for (let tx = 0; tx < SHAFT_WIDTH_PX; tx += toothW) {
            ctx.moveTo(tx, voidScreenY)
            ctx.lineTo(tx + toothW / 2, voidScreenY + toothH)
            ctx.lineTo(tx + toothW, voidScreenY)
          }
          ctx.closePath()
          ctx.fill()

          // Dark hazard chevrons bar along horizon
          ctx.fillStyle = '#18181b'
          ctx.fillRect(0, voidScreenY - 6, SHAFT_WIDTH_PX, 6)
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth = 2
          ctx.setLineDash([8, 8])
          ctx.beginPath()
          ctx.moveTo(0, voidScreenY - 3)
          ctx.lineTo(SHAFT_WIDTH_PX, voidScreenY - 3)
          ctx.stroke()
          ctx.setLineDash([])

          // Void grinder sparks
          if (Math.random() < 0.35) {
            addParticle({
              x: Math.random() * SHAFT_WIDTH_PX,
              y: voidY * BLOCK_PX,
              vx: (Math.random() - 0.5) * 40,
              vy: 30 + Math.random() * 60,
              color: Math.random() > 0.5 ? '#a855f7' : '#ff6b1a',
              size: 2 + Math.random() * 2,
              alpha: 1,
              life: 0.25 + Math.random() * 0.25,
              maxLife: 0.5,
            })
          }
        }
      }

      // 7. Right-Edge Shaft Minimap Telemetry Strip
      const stripX = SHAFT_WIDTH_PX + 8
      const stripY = 12
      const stripW = MINIMAP_WIDTH_PX - 16
      const stripH = CANVAS_HEIGHT - 24

      ctx.fillStyle = 'rgba(15, 18, 24, 0.95)'
      ctx.fillRect(stripX, stripY, stripW, stripH)
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.strokeRect(stripX + 0.5, stripY + 0.5, stripW - 1, stripH - 1)

      ctx.fillStyle = '#94a3b8'
      ctx.font = 'bold 9px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('SHAFT', stripX + stripW / 2, stripY + 12)
      ctx.fillText('260m', stripX + stripW / 2, stripY + 22)

      const miniTrackTop = stripY + 28
      const miniTrackH = stripH - 40
      const toMiniY = (wy) => miniTrackTop + Math.max(0, Math.min(1, wy / DEPTH)) * miniTrackH

      // Shaft background well
      ctx.fillStyle = '#090b0e'
      ctx.fillRect(stripX + 8, miniTrackTop, stripW - 16, miniTrackH)

      // Vault mark on minimap
      const miniVaultY = toMiniY(VAULT_Y)
      ctx.strokeStyle = '#eab308'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(stripX + 6, miniVaultY)
      ctx.lineTo(stripX + stripW - 6, miniVaultY)
      ctx.stroke()

      // Crush Void on minimap
      if (snap) {
        const miniVoidY = toMiniY(voidYRef.current ?? snap.voidY)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.45)'
        ctx.fillRect(stripX + 8, miniTrackTop, stripW - 16, Math.max(2, miniVoidY - miniTrackTop))

        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(stripX + 4, miniVoidY)
        ctx.lineTo(stripX + stripW - 4, miniVoidY)
        ctx.stroke()
      }

      // Player pips on minimap
      if (snap?.players) {
        for (const p of snap.players) {
          const pos = interpRef.current.get(p.id)
          const myPip = toMiniY(pos ? pos.y : p.y)
          const isMe = p.id === myIdRef.current
          const col = PLAYER_COLORS[p.slot % PLAYER_COLORS.length]

          if (!p.alive) {
            ctx.fillStyle = '#6b7280'
            ctx.font = 'bold 9px monospace'
            ctx.fillText('✕', stripX + stripW / 2, myPip)
            continue
          }

          ctx.fillStyle = col
          ctx.beginPath()
          ctx.arc(stripX + stripW / 2, myPip, isMe ? 4.5 : 3, 0, Math.PI * 2)
          ctx.fill()

          if (isMe) {
            ctx.strokeStyle = '#ff6b1a'
            ctx.lineWidth = 1.5
            ctx.stroke()

            ctx.fillStyle = '#ff6b1a'
            ctx.font = 'bold 8px monospace'
            ctx.textAlign = 'right'
            ctx.fillText('YOU', stripX - 2, myPip + 3)
          }
        }
      }

      // 8. Top-Left HUD Overlay
      const hudX = 14
      const hudY = 14
      const hudW = 210
      const hudH = 104

      ctx.fillStyle = 'rgba(10, 12, 16, 0.88)'
      ctx.fillRect(hudX, hudY, hudW, hudH)
      ctx.strokeStyle = 'rgba(255, 107, 26, 0.5)'
      ctx.lineWidth = 1
      ctx.strokeRect(hudX + 0.5, hudY + 0.5, hudW - 1, hudH - 1)

      const myDepth = me ? Math.floor(Math.max(0, me.y)) : 0
      const voidDist = me && snap ? Math.max(0, me.y - snap.voidY).toFixed(1) : '0.0'
      const isCriticalVoid = Number(voidDist) < 8.0 && snap?.phase === 'playing'

      // Depth Gauge
      ctx.fillStyle = '#e2e8f0'
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`DEPTH: ${myDepth}m / 260m`, hudX + 10, hudY + 18)

      // Void Proximity Alert
      ctx.fillStyle = isCriticalVoid ? '#ef4444' : '#fb923c'
      ctx.font = 'bold 10px monospace'
      const voidText = isCriticalVoid
        ? `VOID: ${voidDist}m (DANGER)`
        : `VOID: ${voidDist}m BEHIND`
      ctx.fillText(voidText, hudX + 10, hudY + 34)

      // Drill Core Heat Gauge
      const heat = me ? me.heat : 0
      const isOverheated = Boolean(me?.overheated)
      const isSuperDrill = Boolean(me?.superDrill)

      ctx.fillStyle = isOverheated ? '#ef4444' : isSuperDrill ? '#22d3ee' : '#94a3b8'
      ctx.font = 'bold 10px monospace'
      const heatTitle = isOverheated
        ? 'HEAT: OVERHEATED (LOCKOUT)'
        : isSuperDrill
          ? 'HEAT: SUPER CHARGED'
          : `HEAT: ${(heat * 100).toFixed(0)}%`
      ctx.fillText(heatTitle, hudX + 10, hudY + 54)

      // Segmented Heat Bar (10 segments)
      const segW = 16
      const segH = 8
      for (let s = 0; s < 10; s++) {
        const segX = hudX + 10 + s * (segW + 2)
        const filled = s < Math.round(heat * 10)
        ctx.fillStyle = filled
          ? isOverheated || s >= 8
            ? '#ef4444'
            : s >= 5
              ? '#f59e0b'
              : '#10b981'
          : '#1e293b'
        ctx.fillRect(segX, hudY + 60, segW, segH)
      }

      // Jetpack Fuel Gauge
      const fuel = me ? me.fuel : 1.0
      ctx.fillStyle = '#94a3b8'
      ctx.font = 'bold 10px monospace'
      ctx.fillText(`JETPACK FUEL: ${(fuel * 100).toFixed(0)}%`, hudX + 10, hudY + 84)

      ctx.fillStyle = '#1e293b'
      ctx.fillRect(hudX + 10, hudY + 90, 180, 6)
      ctx.fillStyle = fuel > 0.25 ? '#06b6d4' : '#ef4444'
      ctx.fillRect(hudX + 10, hudY + 90, 180 * Math.max(0, Math.min(1, fuel)), 6)

      // 9. Centered Victory / Elimination Overlays
      if (snap?.phase === 'over') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

        const bannerW = 420
        const bannerH = 150
        const bx = (CANVAS_WIDTH - bannerW) / 2
        const by = (CANVAS_HEIGHT - bannerH) / 2

        ctx.fillStyle = '#0f172a'
        ctx.fillRect(bx, by, bannerW, bannerH)
        ctx.strokeStyle = '#ff6b1a'
        ctx.lineWidth = 2
        ctx.strokeRect(bx, by, bannerW, bannerH)

        const iWon = snap.winner === myIdRef.current
        const winnerObj = snap.players?.find((p) => p.id === snap.winner)

        ctx.textAlign = 'center'
        ctx.fillStyle = '#ff6b1a'
        ctx.font = 'bold 12px monospace'
        ctx.fillText('MATCH COMPLETE', bx + bannerW / 2, by + 32)

        ctx.fillStyle = '#f8fafc'
        ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif'
        if (iWon) {
          ctx.fillText('YOU REACHED THE VAULT', bx + bannerW / 2, by + 68)
        } else if (winnerObj) {
          ctx.fillText(`${winnerObj.name} TAKES THE MATCH`, bx + bannerW / 2, by + 68)
        } else {
          ctx.fillText('CRUSH VOID CONSUMED ALL', bx + bannerW / 2, by + 68)
        }

        ctx.fillStyle = '#94a3b8'
        ctx.font = '13px monospace'
        ctx.fillText('Next excavation descent starting shortly...', bx + bannerW / 2, by + 106)
      } else if (me && !me.alive && snap?.phase === 'playing') {
        const warnW = 360
        const warnH = 64
        const wx = (SHAFT_WIDTH_PX - warnW) / 2
        const wy = CANVAS_HEIGHT - 90

        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'
        ctx.fillRect(wx, wy, warnW, warnH)
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 1.5
        ctx.strokeRect(wx, wy, warnW, warnH)

        ctx.textAlign = 'center'
        ctx.fillStyle = '#ef4444'
        ctx.font = 'bold 12px monospace'
        ctx.fillText('CRUSHED BY THE VOID', wx + warnW / 2, wy + 26)
        ctx.fillStyle = '#94a3b8'
        ctx.font = '11px monospace'
        ctx.fillText('Spectating remaining drillers.', wx + warnW / 2, wy + 46)
      }

      rafId = requestAnimationFrame(render)
    }

    rafId = requestAnimationFrame(render)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [status])

  // ---------- Idle / Name entry ----------
  if (status === 'idle') {
    return (
      <section className="blueprint mx-auto max-w-xl px-5 py-20">
        <p className="rule-label">Void Drillers</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">Void Drillers</h1>
        <p className="mt-5 leading-relaxed text-muted">
          A vertical excavation race down a 260-block shaft. Drill fast, manage core heat, and
          reach the extraction vault before the crush void swallows the ceiling.
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

  // ---------- Server Full ----------
  if (status === 'full') {
    return (
      <section className="mx-auto max-w-xl px-5 py-20 text-center">
        <p className="rule-label">Void Drillers</p>
        <h1 className="display mt-2 text-3xl">Shaft capacity full</h1>
        <p className="mt-4 text-muted">
          All eight excavation slots are currently occupied. Please wait for an opening.
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

  // ---------- Disconnected ----------
  if (status === 'closed') {
    return (
      <section className="mx-auto max-w-xl px-5 py-20 text-center">
        <p className="rule-label">Void Drillers</p>
        <h1 className="display mt-2 text-3xl">Connection lost</h1>
        <p className="mt-4 text-muted">
          The match server stopped answering. Your excavation slot has been released.
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

  // ---------- Active Game View ----------
  const me = hud?.players?.find((p) => p.id === myId)
  const players = hud?.players ?? []
  const sortedPlayers = [...players].sort((a, b) => b.y - a.y)

  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="display text-3xl">Void Drillers</h1>
          <span className="rule-label">260m Shaft Excavation</span>
        </div>
        <Link
          to="/games/void-drillers"
          className="text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
        >
          About the game →
        </Link>
      </div>

      <p aria-live="polite" className="mt-3 border-l-2 border-flare pl-4 text-sm text-muted">
        {statusLine(hud, myId)}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[640px_1fr] items-start justify-center">
        {/* Canvas Area */}
        <div className="relative mx-auto w-full max-w-[640px]">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            role="img"
            aria-label={`Void Drillers match canvas. ${statusLine(hud, myId)}`}
            onMouseMove={handleCanvasMouseMove}
            onMouseDown={handleCanvasMouseDown}
            onMouseUp={handleCanvasMouseUp}
            className="w-full border border-line bg-bg aspect-[640/700] select-none cursor-crosshair"
          />

          {/* Telemetry Bar Under Canvas */}
          <div className="mt-3 grid gap-px border border-line bg-line sm:grid-cols-4 text-xs">
            <div className="bg-bg p-2.5">
              <p className="rule-label">Depth</p>
              <p className="mt-1 font-mono text-sm tabular-nums text-fg">
                {me ? Math.floor(Math.max(0, me.y)) : 0}m / 260m
              </p>
            </div>
            <div className="bg-bg p-2.5">
              <p className="rule-label">Crush Void</p>
              <p className="mt-1 font-mono text-sm tabular-nums text-flare">
                {me && hud ? Math.max(0, me.y - hud.voidY).toFixed(1) : 0}m behind
              </p>
            </div>
            <div className="bg-bg p-2.5">
              <p className="rule-label">Thermal Status</p>
              <p
                className={`mt-1 font-mono text-sm tabular-nums ${me?.overheated ? 'text-danger font-bold' : me?.superDrill ? 'text-live font-bold' : 'text-fg'}`}
              >
                {me?.overheated
                  ? 'OVERHEATED'
                  : me?.superDrill
                    ? 'SUPER CHARGED'
                    : `${((me?.heat ?? 0) * 100).toFixed(0)}%`}
              </p>
            </div>
            <div className="bg-bg p-2.5">
              <p className="rule-label">Jetpack Fuel</p>
              <p className="mt-1 font-mono text-sm tabular-nums text-fg">
                {((me?.fuel ?? 1) * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar Roster and Controls */}
        <div className="space-y-8">
          <div>
            <div className="flex items-baseline justify-between">
              <p className="rule-label">Driller Roster</p>
              <p className="rule-label">Depth</p>
            </div>
            <ul className="mt-3 space-y-2">
              {sortedPlayers.map((p) => {
                const isMe = p.id === myId
                const isAlive = p.alive
                const color = PLAYER_COLORS[p.slot % PLAYER_COLORS.length]

                return (
                  <li key={p.id} className="flex items-center gap-2.5 text-sm">
                    <span
                      style={{ backgroundColor: color }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-[0.7rem] text-bg font-bold"
                      aria-hidden="true"
                    >
                      {PIECE_ICON[p.slot % PIECE_ICON.length]}
                    </span>
                    <span
                      className={`truncate ${!isAlive ? 'text-muted line-through' : 'text-fg'}`}
                    >
                      {p.name}
                    </span>
                    {isMe && <span className="rule-label shrink-0">you</span>}
                    {p.overheated && (
                      <span className="text-[0.625rem] text-danger font-mono uppercase tracking-wider">
                        Lockout
                      </span>
                    )}
                    {p.superDrill && (
                      <span className="text-[0.625rem] text-live font-mono uppercase tracking-wider">
                        Super
                      </span>
                    )}
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted">
                      {Math.floor(Math.max(0, p.y))}m
                    </span>
                  </li>
                )
              })}
              {sortedPlayers.length === 0 && <li className="text-sm text-muted">Connecting...</li>}
            </ul>
          </div>

          <div>
            <p className="rule-label">Controls</p>
            <dl className="mt-2 space-y-1.5 text-sm text-muted">
              <div className="flex justify-between gap-3">
                <dt>Move horizontal</dt>
                <dd className="font-mono text-xs text-fg">A / D or Left / Right</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Jetpack thruster</dt>
                <dd className="font-mono text-xs text-fg">W, Space, or Up Arrow</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Aim drill bit</dt>
                <dd className="font-mono text-xs text-fg">Mouse pointer</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Trigger drill</dt>
                <dd className="font-mono text-xs text-fg">Hold Left Click or F</dd>
              </div>
            </dl>
          </div>

          <div>
            <p className="rule-label">Strata Guide</p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted">
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-fg">· Dirt:</span>
                <span>Fast excavation, soft resistance.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-fg">≡ Stone:</span>
                <span>Dense bedrock strata, sustained drilling.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-flare">⊗ Gas:</span>
                <span>Pockets detonate on contact with drill bit.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-live">◈ Geode:</span>
                <span>Shatter to vent core heat and supercharge bit.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono font-bold text-fg">▲ Vault:</span>
                <span>Touchdown beacon at 250m to win match.</span>
              </li>
            </ul>
          </div>

          <SidebarAd className="mt-4" />
        </div>
      </div>

      <BannerAd className="mt-12" />
    </section>
  )
}
