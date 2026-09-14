import { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTitle } from '../lib/useTitle.js'
import Leaderboard from '../components/Leaderboard.jsx'
import { PROTOCOLS } from '../../server/cipherrun.js'

const SEND_INTERVAL_MS = 25
const SLOT_COLORS = [
  '#ff6b1a', // 0: Flare Orange
  '#00f2fe', // 1: Cyber Cyan
  '#10b981', // 2: Neon Emerald
  '#f43f5e', // 3: Magenta
  '#f59e0b', // 4: Amber
  '#a855f7', // 5: Purple
  '#84cc16', // 6: Lime
  '#3b82f6', // 7: Electric Blue
]
const SLOT_ICONS = ['◈', '✶', 'Ψ', '≡', '⊔', '✚', '◎', '⊗']

// Sprite Sheet coordinates from /art/runner-sprites.jpg (1376 x 768)
const RUN_FRAMES = [
  { sx: 50, sy: 20, sw: 160, sh: 175 },
  { sx: 275, sy: 20, sw: 160, sh: 175 },
  { sx: 500, sy: 20, sw: 160, sh: 175 },
  { sx: 730, sy: 20, sw: 160, sh: 175 },
  { sx: 960, sy: 20, sw: 160, sh: 175 },
  { sx: 1190, sy: 20, sw: 160, sh: 175 },
]

const DASH_FRAMES = [
  { sx: 430, sy: 220, sw: 230, sh: 170 },
  { sx: 740, sy: 220, sw: 230, sh: 170 },
]

const STUMBLE_FRAMES = [
  { sx: 470, sy: 420, sw: 190, sh: 160 },
  { sx: 720, sy: 420, sw: 200, sh: 160 },
]

const CHEER_FRAMES = [
  { sx: 510, sy: 580, sw: 170, sh: 175 },
  { sx: 730, sy: 580, sw: 180, sh: 175 },
]

export default function CipherRun() {
  useTitle('Cipher Run')

  const [status, setStatus] = useState('connecting') // connecting | live | closed | full
  const [protocol, setProtocol] = useState(PROTOCOLS[0])
  const [myId, setMyId] = useState(null)
  const [mySlot, setMySlot] = useState(0)
  const [name, setName] = useState('Operator')
  const [hasJoined, setHasJoined] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [selectedTier, setSelectedTier] = useState(1)

  // Local typing buffer
  const [cursor, setCursor] = useState(0)
  const [charStates, setCharStates] = useState([]) // Array of 'correct' | 'error' | 'pending'
  const [dashTimer, setDashTimer] = useState(0)
  const [glitchActive, setGlitchActive] = useState(false)

  // Remote snapshot state
  const [snap, setSnap] = useState(null)

  const wsRef = useRef(null)
  const snapRef = useRef(null)
  const canvasRef = useRef(null)
  const inputRef = useRef(null)
  const spriteImgRef = useRef(null)
  const interpProgressRef = useRef(new Map())
  const particlesRef = useRef([])

  // Load sprite sheet image
  useEffect(() => {
    const img = new Image()
    img.src = '/art/runner-sprites.jpg'
    img.onload = () => {
      spriteImgRef.current = img
    }
  }, [])

  // Initialize character states when protocol text changes
  useEffect(() => {
    if (protocol?.text) {
      setCharStates(new Array(protocol.text.length).fill('pending'))
      setCursor(0)
    }
  }, [protocol])

  // WebSocket Connection
  const connect = useCallback((playerName, chosenProtocolId = null) => {
    setStatus('connecting')
    let failedPrimary = false
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const primaryUrl = `${scheme}://${window.location.host}/cipherrun-ws`
    const fallbackUrl = 'ws://127.0.0.1:8087'

    function openSocket(url, isFallback = false) {
      const ws = new WebSocket(url, 'cipherrun.v1')
      wsRef.current = ws

      ws.onopen = () => {
        if (wsRef.current !== ws) return
        setStatus('live')
        ws.send(
          JSON.stringify({
            t: 'join',
            name: playerName || 'Operator',
            protocolId: chosenProtocolId,
          }),
        )
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
          setMyId(msg.id)
          setMySlot(msg.slot)
          if (msg.protocol) {
            setProtocol(msg.protocol)
            setCharStates(new Array(msg.protocol.text.length).fill('pending'))
            setCursor(0)
          }
          setHasJoined(true)
        } else if (msg.t === 'full') {
          setStatus('full')
        } else if (msg.t === 'snap') {
          snapRef.current = msg
          setSnap(msg)

          const me = msg.players?.find((p) => p.id === myId)
          if (me) {
            setGlitchActive(Boolean(me.glitch))
          }
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
  }, [myId])

  useEffect(() => () => wsRef.current?.close(), [])

  // Input Handling
  const handleKey = useCallback(
    (e) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN || !protocol?.text) return
      if (snap?.phase !== 'racing' || glitchActive) return

      const text = protocol.text
      const key = e.key

      if (key === 'Backspace') {
        e.preventDefault()
        if (cursor > 0) {
          const nextCursor = cursor - 1
          setCursor(nextCursor)
          setCharStates((prev) => {
            const next = [...prev]
            next[nextCursor] = 'pending'
            return next
          })
          ws.send(JSON.stringify({ t: 'input', key: 'Backspace', cursor: nextCursor }))
        }
        return
      }

      // Spacebar Word Jump when skipping mistyped words
      if (key === ' ' && charStates[cursor] === 'error') {
        e.preventDefault()
        const nextSpace = text.indexOf(' ', cursor)
        if (nextSpace !== -1) {
          const target = nextSpace + 1
          setCursor(target)
          setCharStates((prev) => {
            const next = [...prev]
            for (let i = cursor; i < target; i++) {
              if (next[i] === 'pending') next[i] = 'error'
            }
            return next
          })
          ws.send(JSON.stringify({ t: 'input', key: ' ', cursor: target }))
          return
        }
      }

      // Printable single characters
      if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        const expected = text[cursor]
        const isMatch = key === expected

        setCharStates((prev) => {
          const next = [...prev]
          next[cursor] = isMatch ? 'correct' : 'error'
          return next
        })

        if (isMatch) {
          const nextCursor = cursor + 1
          setCursor(nextCursor)

          // Trigger dash boost on word boundaries
          if (expected === ' ' || nextCursor >= text.length) {
            setDashTimer(Date.now() + 320)
            // Spawn little dust particles
            particlesRef.current.push({
              x: 0,
              y: 0,
              vx: -(20 + Math.random() * 30),
              vy: -(10 + Math.random() * 20),
              life: 0.35,
            })
          }
        }

        ws.send(JSON.stringify({ t: 'input', key, cursor }))
      }
    },
    [protocol, cursor, snap?.phase, glitchActive, charStates],
  )

  // Attach global keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Canvas Animation Render Loop for Multi-Lane Race Deck
  useEffect(() => {
    let animId
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')

    function render() {
      const w = (canvas.width = canvas.parentElement.clientWidth)
      const racers = snapRef.current?.players || []
      const laneCount = Math.max(4, racers.length)
      const laneHeight = 54
      canvas.height = laneCount * laneHeight + 24

      // 1. Dark Cyber Track Background
      ctx.fillStyle = '#090d16'
      ctx.fillRect(0, 0, w, canvas.height)

      // Grid scanlines
      ctx.strokeStyle = '#1e293b'
      ctx.lineWidth = 1
      for (let y = 0; y < canvas.height; y += 18) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      const startX = 64
      const finishX = w - 80
      const trackWidth = finishX - startX

      // Checkered Finish Line Tape
      ctx.save()
      const finishWidth = 14
      const finishBlocks = Math.floor(canvas.height / 10)
      for (let b = 0; b < finishBlocks; b++) {
        ctx.fillStyle = b % 2 === 0 ? '#ff6b1a' : '#ecebe6'
        ctx.fillRect(finishX, b * 10, finishWidth, 10)
      }
      ctx.restore()

      // 2. Render each racer lane
      racers.forEach((p, idx) => {
        const laneY = idx * laneHeight + 12

        // Lane border
        ctx.strokeStyle = '#182234'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, laneY + laneHeight)
        ctx.lineTo(w, laneY + laneHeight)
        ctx.stroke()

        // Progress calculation with smooth interpolation
        const currentInterp = interpProgressRef.current.get(p.id) ?? p.progress
        const targetProgress = p.progress
        const nextInterp = currentInterp + (targetProgress - currentInterp) * 0.18
        interpProgressRef.current.set(p.id, nextInterp)

        const runnerX = startX + (trackWidth * (nextInterp / 100))
        const runnerY = laneY + 4

        // Neon progress trail
        const slotColor = SLOT_COLORS[p.slot % SLOT_COLORS.length]
        ctx.strokeStyle = slotColor
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(startX, laneY + 42)
        ctx.lineTo(runnerX + 10, laneY + 42)
        ctx.stroke()

        // Name & Telemetry Badge above runner
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillStyle = '#94a3b8'
        ctx.fillText(p.name, runnerX - 6, laneY + 12)

        ctx.fillStyle = slotColor
        ctx.font = 'bold 10px ui-monospace, monospace'
        const wpmLabel = `${p.wpm?.toFixed(0) || 0} WPM`
        ctx.fillText(wpmLabel, runnerX + 46, laneY + 12)

        // Select Animation Frame
        let frame = RUN_FRAMES[0]
        const now = Date.now()

        if (p.finished) {
          frame = CHEER_FRAMES[Math.floor(now / 220) % 2]
        } else if (p.glitch) {
          frame = STUMBLE_FRAMES[Math.floor(now / 140) % 2]
        } else if (p.id === myId && dashTimer > now) {
          frame = DASH_FRAMES[Math.floor(now / 100) % 2]
        } else if ((p.wpm || 0) > 0) {
          const speedFactor = Math.max(1, (p.wpm || 40) / 14)
          const runIdx = Math.floor((now * speedFactor) / 1000) % 6
          frame = RUN_FRAMES[runIdx]
        }

        // Draw Chibi Sprinter
        if (spriteImgRef.current) {
          ctx.save()
          // Hue shift by slot
          const hueDeg = (p.slot * 45) % 360
          ctx.filter = `hue-rotate(${hueDeg}deg)`

          ctx.drawImage(
            spriteImgRef.current,
            frame.sx,
            frame.sy,
            frame.sw,
            frame.sh,
            runnerX,
            runnerY + 10,
            42,
            38,
          )
          ctx.restore()
        }
      })

      animId = requestAnimationFrame(render)
    }

    animId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animId)
  }, [myId, dashTimer])

  // Restart match or switch protocol
  const handleRestart = (protoId = null) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ t: 'restart', protocolId: protoId }))
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 text-fg">
      {/* Game Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-xl text-flare font-mono">&gt;&nbsp;_</span>
            <h1 className="display text-3xl font-bold tracking-tight">Cipher Run</h1>
            <span className="rounded bg-surface px-2.5 py-0.5 font-mono text-xs text-flare border border-line">
              PORT 8087
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Terminal Decryption Race // Monkeytype Standard WPM
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDrawer(!showDrawer)}
            className="border border-line bg-surface px-4 py-2 text-xs font-mono uppercase tracking-wider text-fg transition-colors hover:border-flare"
          >
            {showDrawer ? 'Close Protocols' : 'Select Protocol (18)'}
          </button>
          <button
            type="button"
            onClick={() => handleRestart(protocol?.id)}
            className="border border-line bg-surface px-4 py-2 text-xs font-mono uppercase tracking-wider text-muted transition-colors hover:text-fg"
          >
            Restart
          </button>
        </div>
      </div>

      {/* Protocol Selection Drawer */}
      {showDrawer && (
        <div className="my-6 border border-line bg-surface p-5 transition-all">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <h3 className="rule-label">Mainframe Protocol Archive</h3>
            <div className="flex gap-2">
              {[1, 2, 3].map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setSelectedTier(tier)}
                  className={`px-3 py-1 text-xs font-mono uppercase ${selectedTier === tier ? 'bg-flare text-on-flare' : 'bg-bg text-muted'}`}
                >
                  Tier {tier}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROTOCOLS.filter((p) => p.tier === selectedTier).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  handleRestart(p.id)
                  setShowDrawer(false)
                }}
                className={`flex flex-col rounded border p-3 text-left transition-colors ${protocol?.id === p.id ? 'border-flare bg-bg' : 'border-line/60 bg-bg/50 hover:border-line'}`}
              >
                <span className="font-mono text-xs text-flare font-bold">{p.title}</span>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{p.text}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lobby Connect / Join Screen */}
      {!hasJoined && (
        <div className="my-10 border border-line bg-surface p-8 text-center">
          <h2 className="display text-2xl">Access Security Gateway</h2>
          <p className="mt-2 text-sm text-muted">
            Enter your handle to initialize telemetry and join the active race lobby.
          </p>
          <div className="mx-auto mt-6 flex max-w-sm gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Operator Handle"
              maxLength={16}
              className="flex-1 border border-line bg-bg px-4 py-2.5 font-mono text-sm text-fg outline-none focus:border-flare"
            />
            <button
              type="button"
              onClick={() => connect(name)}
              className="bg-flare px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-on-flare transition-opacity hover:opacity-90"
            >
              Connect
            </button>
          </div>
        </div>
      )}

      {/* Main Race Track Deck */}
      {hasJoined && (
        <div className="mt-6 border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-muted">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE RACE DECK</span>
            </div>
            <span>CHECKERED TAPE (100%)</span>
          </div>
          <div className="relative w-full overflow-hidden">
            <canvas ref={canvasRef} className="block w-full" />
          </div>
        </div>
      )}

      {/* Active Decryption Terminal */}
      {hasJoined && (
        <div className="mt-6 border border-line bg-surface">
          {/* Protocol Info Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="text-flare font-bold">[{protocol?.title}]</span>
              <span className="text-muted">TIER {protocol?.tier}</span>
            </div>
            <div className="flex gap-4 text-muted">
              <span>LENGTH: {protocol?.text?.length || 0} CHARS</span>
              <span>PHASE: {snap?.phase?.toUpperCase() || 'WAITING'}</span>
            </div>
          </div>

          {/* Countdown Banner */}
          {snap?.phase === 'countdown' && (
            <div className="bg-flare/10 border-b border-flare/30 px-5 py-3 text-center font-mono">
              <span className="text-sm font-bold text-flare animate-pulse">
                BREACH INITIALIZATION IN {snap.countdown}s...
              </span>
            </div>
          )}

          {/* Glitch Lockout Banner */}
          {glitchActive && (
            <div className="bg-rose-950/60 border-b border-rose-500 px-5 py-2.5 text-center font-mono animate-bounce">
              <span className="text-xs font-bold text-rose-300">
                ⚠ FIREWALL BREAKER LOCKOUT // STATIC FREEZE [350ms]
              </span>
            </div>
          )}

          {/* Monospace Character Buffer */}
          <div
            onClick={() => inputRef.current?.focus()}
            className="min-h-[160px] p-6 font-mono text-lg leading-relaxed tracking-wide select-none cursor-text bg-[#090d16]"
          >
            {protocol?.text?.split('').map((ch, idx) => {
              const state = charStates[idx]
              const isCursor = idx === cursor

              if (state === 'correct') {
                return (
                  <span key={idx} className="text-emerald-400">
                    {ch}
                  </span>
                )
              }
              if (state === 'error') {
                return (
                  <span key={idx} className="bg-rose-950/80 text-rose-300 border-b-2 border-rose-500">
                    {ch}
                  </span>
                )
              }
              if (isCursor) {
                return (
                  <span
                    key={idx}
                    className="relative bg-amber-400/20 text-amber-300 font-bold border-b-2 border-amber-400"
                  >
                    {ch}
                  </span>
                )
              }
              return (
                <span key={idx} className="text-slate-500/70">
                  {ch}
                </span>
              )
            })}
          </div>

          {/* Telemetry Bar (Monkeytype Standard) */}
          <div className="grid grid-cols-2 gap-4 border-t border-line bg-bg p-5 sm:grid-cols-4 font-mono text-center">
            <div className="border border-line/60 bg-surface p-3">
              <p className="rule-label">WPM (Net)</p>
              <p className="display mt-1 text-2xl font-bold text-flare">
                {snap?.players?.find((p) => p.id === myId)?.wpm?.toFixed(0) || '0'}
              </p>
            </div>
            <div className="border border-line/60 bg-surface p-3">
              <p className="rule-label">Raw WPM</p>
              <p className="display mt-1 text-2xl font-bold text-fg">
                {snap?.players?.find((p) => p.id === myId)?.rawWpm?.toFixed(0) || '0'}
              </p>
            </div>
            <div className="border border-line/60 bg-surface p-3">
              <p className="rule-label">Accuracy</p>
              <p className="display mt-1 text-2xl font-bold text-emerald-400">
                {snap?.players?.find((p) => p.id === myId)?.acc?.toFixed(1) || '100.0'}%
              </p>
            </div>
            <div className="border border-line/60 bg-surface p-3">
              <p className="rule-label">Time</p>
              <p className="display mt-1 text-2xl font-bold text-muted">
                {((snap?.elapsed || 0) / 1000).toFixed(1)}s
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Post-Match Standings Modal */}
      {snap?.phase === 'over' && (
        <div className="mt-8 border border-flare bg-surface p-6 font-mono">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <h3 className="display text-xl text-flare">Match Complete // Standings</h3>
            <span className="text-xs text-muted">NEXT PROTOCOL IN 6s</span>
          </div>
          <div className="mt-4 space-y-2">
            {[...(snap?.players || [])]
              .sort((a, b) => (b.wpm || 0) - (a.wpm || 0))
              .map((p, idx) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between border p-3 text-sm ${p.id === snap.winner ? 'border-flare bg-flare/10' : 'border-line/60 bg-bg'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-muted font-bold">#{idx + 1}</span>
                    <span className="font-bold text-fg">{p.name}</span>
                    {p.id === snap.winner && (
                      <span className="rounded bg-flare px-2 py-0.5 text-xs font-bold text-on-flare">
                        WINNER
                      </span>
                    )}
                  </div>
                  <div className="flex gap-6 text-xs text-muted">
                    <span>{p.wpm?.toFixed(0) || 0} WPM</span>
                    <span>{p.acc?.toFixed(1) || 100}% ACC</span>
                    <span>{p.finishTime ? `${(p.finishTime / 1000).toFixed(2)}s` : 'DNF'}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Standing Leaderboard Strip */}
      <div className="mt-12 border-t border-line pt-8">
        <div className="flex items-center justify-between mb-4">
          <p className="rule-label">Standing Records</p>
          <Link to="/leaderboard" className="text-xs font-mono text-flare hover:underline">
            Full Board →
          </Link>
        </div>
        <Leaderboard entries={snap?.board || []} you={name} full={false} />
      </div>
    </div>
  )
}
