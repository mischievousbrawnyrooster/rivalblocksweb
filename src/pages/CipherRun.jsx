import { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTitle } from '../lib/useTitle.js'
import Leaderboard from '../components/Leaderboard.jsx'
import { boardFor } from '../../server/board.js'
import { PROTOCOLS, MAX_PLAYERS } from '../../server/cipherrun.js'

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
// Colours for the status line over the terminal. Written out whole so Tailwind finds them.
const STATUS_TONE = {
  flare: 'border-flare/30 bg-flare/10 text-flare',
  rose: 'border-rose-500 bg-rose-950/60 text-rose-300',
  amber: 'border-amber-500/70 bg-amber-950/50 text-amber-300',
  emerald: 'border-emerald-500/70 bg-emerald-950/50 text-emerald-300',
}

// Sprite Sheet variations (1376 x 768)
const SPRITE_VARIATIONS = [
  {
    id: 'hacker',
    name: 'Street Hacker',
    tag: 'CYBER-01',
    desc: 'Neon Orange Hoodie & Visor',
    src: '/art/runner-sprites.png',
    color: '#ff6b1a',
  },
  {
    id: 'ninja',
    name: 'Cyber Shinobi',
    tag: 'CYBER-02',
    desc: 'Tech-Ninja Cowl & Violet Scarf',
    src: '/art/runner-sprites-1.png',
    color: '#a855f7',
  },
  {
    id: 'android',
    name: 'Mecha Android',
    tag: 'CYBER-03',
    desc: 'Cyber Catgirl & Jet Boosters',
    src: '/art/runner-sprites-2.png',
    color: '#00f2fe',
  },
  {
    id: 'tactical',
    name: 'Tactical Merc',
    tag: 'CYBER-04',
    desc: 'Hazard Jacket & Spiky Hair',
    src: '/art/runner-sprites-3.png',
    color: '#f59e0b',
  },
  {
    id: 'idol',
    name: 'Neon Speedster',
    tag: 'CYBER-05',
    desc: 'Hot Pink Twintails & Skates',
    src: '/art/runner-sprites-4.png',
    color: '#f43f5e',
  },
  {
    id: 'glitch',
    name: 'Glitch Phantom',
    tag: 'CYBER-06',
    desc: 'Matrix Coat & Data Code',
    src: '/art/runner-sprites-5.png',
    color: '#10b981',
  },
]

// Frame boxes on the 1376 x 768 sheets, measured from the art so no figure is
// clipped. All six sheets share this layout. Every frame is drawn at one scale
// with its feet on the lane baseline, so a pose is never stretched to fit a box.
const SPRITE_SCALE = 0.22

const RUN_FRAMES = [116, 301, 493, 688, 884, 1075].map((sx) => ({ sx, sy: 15, sw: 172, sh: 179 }))

const DASH_FRAMES = [
  { sx: 392, sy: 215, sw: 296, sh: 170 },
  { sx: 705, sy: 215, sw: 260, sh: 170 },
]

const STUMBLE_FRAMES = [
  { sx: 506, sy: 408, sw: 186, sh: 171 },
  { sx: 702, sy: 408, sw: 226, sh: 171 },
]

const CHEER_FRAMES = [
  { sx: 489, sy: 579, sw: 203, sh: 188 },
  { sx: 710, sy: 579, sw: 180, sh: 188 },
]

/** One frame of a 1376 x 768 sprite sheet as a plain element, for the runner picker. */
function SpriteFrame({ src, frame = RUN_FRAMES[0], height }) {
  const s = height / frame.sh
  return (
    <div
      aria-hidden="true"
      style={{
        width: frame.sw * s,
        height,
        backgroundImage: `url(${src})`,
        backgroundSize: `${1376 * s}px ${768 * s}px`,
        backgroundPosition: `-${frame.sx * s}px -${frame.sy * s}px`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  )
}

export default function CipherRun() {
  useTitle('Cipher Run')

  const [status, setStatus] = useState('connecting') // connecting | live | closed | full
  const [protocol, setProtocol] = useState(PROTOCOLS[0])
  const [myId, setMyId] = useState(null)
  const [name, setName] = useState('Operator')
  const [selectedAvatar, setSelectedAvatar] = useState(0)
  const [showSprinters, setShowSprinters] = useState(false)
  const [hasJoined, setHasJoined] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [selectedTier, setSelectedTier] = useState(1)
  const [myVote, setMyVote] = useState(null)

  const [dashTimer, setDashTimer] = useState(0)

  // Remote snapshot state
  const [snap, setSnap] = useState(null)

  const wsRef = useRef(null)
  const snapRef = useRef(null)
  const protocolRef = useRef(protocol)
  const canvasRef = useRef(null)
  const spriteImagesRef = useRef([])
  const interpProgressRef = useRef(new Map())
  const myIdRef = useRef(null)
  const lastCursorRef = useRef(0)

  // Cast vote for tier (1: Short, 2: Medium, 3: Long)
  const handleVote = useCallback((tier) => {
    setMyVote(tier)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ t: 'vote', tier }))
    }
  }, [])

  // Preload all sprite sheet variations
  useEffect(() => {
    const images = SPRITE_VARIATIONS.map((v) => {
      const img = new Image()
      img.src = v.src
      return img
    })
    spriteImagesRef.current = images
  }, [])

  // WebSocket Connection
  const connect = useCallback((playerName, avatarIndex = 0) => {
    setStatus('connecting')
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'

    function openSocket(url) {
      const ws = new WebSocket(url, 'cipherrun.v1')
      wsRef.current = ws

      ws.onopen = () => {
        if (wsRef.current !== ws) return
        setStatus('live')
        ws.send(
          JSON.stringify({
            t: 'join',
            name: playerName || 'Operator',
            avatar: avatarIndex,
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
          myIdRef.current = msg.id
          setMyId(msg.id)
          if (msg.protocol) {
            protocolRef.current = msg.protocol
            setProtocol(msg.protocol)
          }
          setHasJoined(true)
        } else if (msg.t === 'full') {
          setStatus('full')
        } else if (msg.t === 'snap') {
          snapRef.current = msg
          setSnap(msg)

          if (msg.protocol?.id && msg.protocol.id !== protocolRef.current?.id) {
            const fullProto = PROTOCOLS.find((p) => p.id === msg.protocol.id) || msg.protocol
            protocolRef.current = fullProto
            setProtocol(fullProto)
          }

          if (msg.phase !== 'voting') {
            setMyVote(null)
          }

          // Dash when the server moves my cursor past a cleanly typed space
          const me = msg.players?.find((p) => p.id === myIdRef.current)
          if (me) {
            const landed = me.cursor - 1
            if (
              me.cursor > lastCursorRef.current &&
              protocolRef.current?.text?.[landed] === ' ' &&
              !me.wrong?.some(([i]) => i === landed)
            ) {
              setDashTimer(Date.now() + 320)
            }
            lastCursorRef.current = me.cursor
          }
        }
      }

      // No fallback address: Vite in dev and nginx deployed both proxy this path,
      // and a direct 127.0.0.1 would dial the player's own machine.
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        if (wsRef.current !== ws) return
        setStatus((s) => (s === 'full' ? s : 'closed'))
      }
    }

    openSocket(`${scheme}://${window.location.host}/cipherrun-ws`)
  }, [myId])

  useEffect(() => () => wsRef.current?.close(), [])

  // Input Handling. The server judges every key; the page only forwards it and
  // draws what comes back, so its text can never drift from the server's.
  const handleKey = useCallback(
    (e) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return

      // Pre-round consensus voting hotkeys
      if (snap?.phase === 'voting') {
        if (e.key === '1' || e.key === '2' || e.key === '3') {
          e.preventDefault()
          handleVote(Number(e.key))
          return
        }
      }

      if (snap?.phase !== 'racing') return

      if (e.key === 'Backspace' || (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault()
        // Ctrl+Backspace (Alt+Backspace on a Mac) erases the whole word.
        const word = e.key === 'Backspace' && (e.ctrlKey || e.altKey)
        ws.send(JSON.stringify({ t: 'input', key: e.key, word }))
      }
    },
    [snap?.phase, handleVote],
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

        // Select sprite image and metadata for racer
        const spriteIdx = p.avatar != null
          ? (p.avatar % SPRITE_VARIATIONS.length)
          : (p.slot % SPRITE_VARIATIONS.length)
        const spriteImg = spriteImagesRef.current[spriteIdx] || spriteImagesRef.current[0]
        const variation = SPRITE_VARIATIONS[spriteIdx] || SPRITE_VARIATIONS[0]

        // Name & Telemetry Badge above runner
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillStyle = '#94a3b8'
        const labelText = p.name
        ctx.fillText(labelText, runnerX - 6, laneY + 12)
        const nameWidth = ctx.measureText(labelText).width

        ctx.fillStyle = variation.color || slotColor
        ctx.font = 'bold 10px ui-monospace, monospace'
        const wpmLabel = `${p.wpm?.toFixed(0) || 0} WPM`
        ctx.fillText(wpmLabel, runnerX - 6 + nameWidth + 8, laneY + 12)

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

        // Draw Chibi Sprinter centred on the runner, feet on the baseline
        if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
          const dw = frame.sw * SPRITE_SCALE
          const dh = frame.sh * SPRITE_SCALE
          ctx.drawImage(
            spriteImg,
            frame.sx,
            frame.sy,
            frame.sw,
            frame.sh,
            runnerX + 21 - dw / 2,
            runnerY + 48 - dh,
            dw,
            dh,
          )
        }
      })

      animId = requestAnimationFrame(render)
    }

    animId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animId)
  }, [myId, dashTimer, selectedAvatar])

  // Select or change runner avatar
  const handleAvatarSelect = (idx) => {
    setSelectedAvatar(idx)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ t: 'avatar', avatar: idx }))
    }
  }

  // A pick from the archive: raced next, in place of the vote
  const sendPick = (protocolId) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ t: 'pick', protocolId }))
    }
  }

  // My typing state, exactly as the server last sent it
  const me = snap?.players?.find((p) => p.id === myId)
  const cursor = me?.cursor ?? 0
  const wrong = new Map(me?.wrong)
  const glitchActive = Boolean(me?.glitch)
  const textLength = protocol?.text?.length ?? 0

  // The one message over the terminal, most urgent first, as [tone, text]. It
  // sits in a line of fixed height, so a message coming or going never moves
  // the text being typed.
  let notice = null
  if (snap?.phase === 'countdown') {
    notice = ['flare', `BREACH INITIALIZATION IN ${snap.countdown}s...`]
  } else if (snap?.phase === 'racing') {
    if (glitchActive) {
      notice = ['rose', '⚠ FIREWALL BREAKER LOCKOUT // STATIC FREEZE [350ms]']
    } else if (!me?.finished && textLength > 0 && cursor >= textLength && wrong.size > 0) {
      notice = ['rose', `⚠ ${wrong.size} UNCORRECTED ${wrong.size === 1 ? 'TYPO' : 'TYPOS'} // BACKSPACE TO CLEAR BEFORE THE BREACH COUNTS`]
    } else if (me?.finished) {
      notice = ['emerald', '✓ BREACH SUCCESSFUL // AWAITING REMAINING OPERATORS OR TIMEOUT...']
    } else if (snap.finishCountdown > 0) {
      const by = snap.players?.find((p) => p.id === snap.winner)?.name || 'OPERATOR'
      notice = ['amber', `[!] FIRST BREACH CONFIRMED BY ${by} // SYSTEM PURGE IN [ ${snap.finishCountdown}s ]`]
    }
  }

  // A refused or dropped connection gets a screen of its own, with a way back in.
  if (status === 'full' || status === 'closed') {
    const full = status === 'full'
    return (
      <section className="mx-auto max-w-xl px-5 py-20 text-center">
        <p className="rule-label">Cipher Run</p>
        <h1 className="display mt-2 text-3xl">{full ? 'Every lane is taken' : 'Connection lost'}</h1>
        <p className="mt-4 text-muted">
          {full
            ? `All ${MAX_PLAYERS} operator lanes are in use. Try again when one opens.`
            : 'The race server stopped answering. Your lane has been released.'}
        </p>
        <button
          type="button"
          onClick={() => connect(name, selectedAvatar)}
          className="mt-8 bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
        >
          {full ? 'Try again' : 'Reconnect'}
        </button>
      </section>
    )
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
          {hasJoined && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSprinters(!showSprinters)}
                className="flex items-center gap-2 border border-line bg-surface px-3 py-2 text-xs font-mono uppercase tracking-wider text-fg transition-colors hover:border-flare"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: SPRITE_VARIATIONS[selectedAvatar]?.color }}
                />
                <span>Sprinter: {SPRITE_VARIATIONS[selectedAvatar]?.name}</span>
              </button>
              {showSprinters && (
                <div className="absolute right-0 top-full mt-2 z-20 w-64 border border-line bg-surface p-2 shadow-lg">
                  <div className="text-[10px] font-mono text-muted uppercase px-2 py-1 border-b border-line mb-1">
                    Switch Active Runner
                  </div>
                  {SPRITE_VARIATIONS.map((v, idx) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        handleAvatarSelect(idx)
                        setShowSprinters(false)
                      }}
                      className={`flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 text-xs font-mono transition-colors ${
                        selectedAvatar === idx ? 'bg-bg text-flare font-bold' : 'text-fg hover:bg-bg/50'
                      }`}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: v.color }}
                      />
                      <span className="flex-1">{v.name}</span>
                      <span className="text-[10px] text-muted">{v.tag}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowDrawer(!showDrawer)}
            className="border border-line bg-surface px-4 py-2 text-xs font-mono uppercase tracking-wider text-fg transition-colors hover:border-flare"
          >
            {showDrawer ? 'Close Protocols' : 'Select Protocol (151)'}
          </button>
        </div>
      </div>

      {/* Protocol Selection Drawer */}
      {showDrawer && (
        <div className="my-6 border border-line bg-surface p-5 transition-all">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <h3 className="rule-label">Mainframe Protocol Archive (151 Protocols)</h3>
            <div className="flex flex-wrap gap-2">
              {[
                { tier: 1, label: 'Tier 1 Short (50)' },
                { tier: 2, label: 'Tier 2 Medium (50)' },
                { tier: 3, label: 'Tier 3 Long (50)' },
                { tier: 4, label: 'Easter Egg (1)' },
              ].map((tab) => (
                <button
                  key={tab.tier}
                  type="button"
                  onClick={() => setSelectedTier(tab.tier)}
                  className={`px-3 py-1 text-xs font-mono uppercase transition-colors ${
                    selectedTier === tab.tier ? 'bg-flare text-on-flare font-bold' : 'bg-bg text-muted hover:text-fg'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid max-h-96 overflow-y-auto pr-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROTOCOLS.filter((p) => {
              if (selectedTier === 4) return p.id === 151
              if (selectedTier === 1) return p.tier === 1 && p.id <= 50
              return p.tier === selectedTier
            }).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  sendPick(p.id)
                  setShowDrawer(false)
                }}
                className={`flex flex-col rounded border p-3 text-left transition-colors ${
                  (snap?.picked ?? protocol?.id) === p.id
                    ? 'border-flare bg-bg shadow-sm'
                    : 'border-line/60 bg-bg/50 hover:border-line'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-mono text-xs text-flare font-bold">{p.title}</span>
                  <span className="text-[10px] font-mono text-muted">
                    {p.text.trim().split(/\s+/).length} words
                  </span>
                </div>
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
            Enter your handle, choose your chibi cyber sprinter, and join the active race lobby.
          </p>

          {/* Sprinter Avatar Selection Grid */}
          <div className="mx-auto mt-6 max-w-2xl">
            <div className="mb-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted">
              Select Runner Unit (6 Variations)
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
              {SPRITE_VARIATIONS.map((v, idx) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedAvatar(idx)}
                  className={`flex flex-col items-center rounded border p-3 transition-all text-center ${
                    selectedAvatar === idx
                      ? 'border-flare bg-bg shadow-sm scale-102'
                      : 'border-line/60 bg-bg/40 hover:border-line hover:bg-bg/70'
                  }`}
                >
                  <div
                    className="mb-2 flex h-16 w-16 items-center justify-center rounded border"
                    style={{ borderColor: v.color, backgroundColor: `${v.color}18` }}
                  >
                    <SpriteFrame src={v.src} height={54} />
                  </div>
                  <span className="font-mono text-xs font-bold leading-tight text-fg">
                    {v.name}
                  </span>
                  <span className="mt-1 font-mono text-[10px] text-muted leading-tight">
                    {v.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

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
              onClick={() => connect(name, selectedAvatar)}
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
              {snap?.picked && (
                <span className="text-flare">NEXT: {PROTOCOLS.find((p) => p.id === snap.picked)?.title}</span>
              )}
            </div>
          </div>

          {/* Lobby: hold for a rival operator, or start against bots */}
          {snap?.phase === 'waiting' && (
            <div className="border-b border-line bg-[#0c121e] p-5 font-mono">
              <p className="text-xs font-bold uppercase tracking-wider text-flare">Waiting for a rival operator</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                The race holds until another operator connects. Start now and daemons take the empty lanes.
              </p>
              <button
                type="button"
                onClick={() => wsRef.current?.send(JSON.stringify({ t: 'ready' }))}
                className="mt-4 bg-flare px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-flare transition-opacity hover:opacity-90"
              >
                Start with bots
              </button>
            </div>
          )}

          {/* Vote Deck during phase === 'voting' */}
          {snap?.phase === 'voting' && (
            <div className="border-b border-line bg-[#0c121e] p-5 font-mono">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-flare animate-ping" />
                  <span className="font-bold text-flare uppercase tracking-wider">
                    PROTOCOL CONSENSUS WINDOW // VOTE CLOSES IN [ {snap.voteTimer ?? 5}s ]
                  </span>
                </div>
                <div className="text-[11px] text-muted">
                  PRESS <kbd className="rounded bg-bg px-1.5 py-0.5 text-fg border border-line">1</kbd> <kbd className="rounded bg-bg px-1.5 py-0.5 text-fg border border-line">2</kbd> <kbd className="rounded bg-bg px-1.5 py-0.5 text-fg border border-line">3</kbd> OR CLICK TO VOTE
                </div>
              </div>

              {/* 3 Difficulty Cards */}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    tier: 1,
                    hotkey: '1',
                    name: 'SHORT BREACH',
                    words: '15 to 25 words',
                    desc: 'Fast Infiltration',
                    count: snap.votes?.short || 0,
                  },
                  {
                    tier: 2,
                    hotkey: '2',
                    name: 'MEDIUM OVERRIDE',
                    words: '40 to 60 words',
                    desc: 'Kernel Bus Control',
                    count: snap.votes?.medium || 0,
                  },
                  {
                    tier: 3,
                    hotkey: '3',
                    name: 'LONG MAINFRAME',
                    words: '85 to 125 words',
                    desc: 'Black Ice Penetration',
                    count: snap.votes?.long || 0,
                  },
                ].map((card) => {
                  const total = snap.votes?.total || 0
                  const pct = total > 0 ? Math.round((card.count / total) * 100) : 0
                  const isVoted = myVote === card.tier

                  return (
                    <button
                      key={card.tier}
                      type="button"
                      onClick={() => handleVote(card.tier)}
                      className={`relative flex flex-col rounded border p-4 text-left transition-all ${
                        isVoted
                          ? 'border-flare bg-flare/10 shadow-sm ring-1 ring-flare'
                          : 'border-line/60 bg-surface hover:border-line hover:bg-bg/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm ${isVoted ? 'text-flare font-bold' : 'text-muted'}`}>
                            {isVoted ? '◉' : '○'}
                          </span>
                          <span className="font-bold text-xs text-fg tracking-wide">
                            [{card.hotkey}] {card.name}
                          </span>
                        </div>
                        <span className="rounded bg-bg px-2 py-0.5 text-[10px] font-bold text-flare border border-line">
                          {card.count} {card.count === 1 ? 'VOTE' : 'VOTES'}
                        </span>
                      </div>

                      <div className="mt-2 text-[11px] text-muted">
                        <div>{card.words}</div>
                        <div className="text-[10px] text-slate-400">{card.desc}</div>
                      </div>

                      {/* Vote share progress bar */}
                      <div className="mt-3">
                        <div className="flex justify-between text-[10px] text-muted mb-1 font-mono">
                          <span>CONSENSUS</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-bg overflow-hidden border border-line/40">
                          <div
                            className={`h-full transition-all duration-300 ${isVoted ? 'bg-flare' : 'bg-slate-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Easter Egg Devotion Banner */}
          {snap?.easterEgg && (
            <div className="bg-flare/20 border-b-2 border-flare px-5 py-3 text-center font-mono animate-pulse">
              <span className="text-xs sm:text-sm font-bold text-flare tracking-widest">
                [!] ANOMALOUS OVERRIDE DETECTED // PROTOCOL 151 SUBLIMINAL DEVOTION CASCADE [!]
              </span>
            </div>
          )}

          {/* Status line: always the same height while a race is on, so the text below never moves */}
          {(snap?.phase === 'countdown' || snap?.phase === 'racing') && (
            <div
              className={`flex h-11 items-center justify-center overflow-hidden border-b px-5 text-center font-mono text-[11px] font-bold tracking-wider sm:text-xs ${
                notice ? STATUS_TONE[notice[0]] : 'border-line'
              }`}
            >
              {notice && <span className="line-clamp-2">{notice[1]}</span>}
            </div>
          )}

          {/* Monospace Character Buffer */}
          <div
            className={`min-h-[160px] p-6 font-mono text-lg leading-relaxed tracking-wide select-none cursor-text whitespace-pre-wrap ${
              snap?.easterEgg
                ? 'bg-[#150a04] border-t border-flare/50 shadow-inner'
                : 'bg-[#090d16]'
            }`}
          >
            {protocol?.text?.split('').map((ch, idx) => {
              const typed = wrong.get(idx)

              if (typed !== undefined) {
                return (
                  <span
                    key={idx}
                    className="bg-rose-950/80 text-rose-300 border-b-2 border-rose-500 font-bold"
                  >
                    {typed === ' ' ? '␣' : typed}
                  </span>
                )
              }
              if (idx < cursor) {
                return (
                  <span key={idx} className="text-emerald-400">
                    {ch}
                  </span>
                )
              }
              if (idx === cursor) {
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
            <span className="text-xs text-muted">NEXT RACE IN {snap.nextRaceIn ?? 0}s</span>
          </div>
          <div className="mt-4 space-y-2">
            {/* Finishers first, in the order they breached; then everyone else by how far they got */}
            {[...(snap?.players || [])]
              .sort((a, b) =>
                a.finished !== b.finished
                  ? (a.finished ? -1 : 1)
                  : a.finished
                    ? a.finishTime - b.finishTime
                    : (b.progress || 0) - (a.progress || 0),
              )
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
        <Leaderboard entries={snap?.board || []} you={name} spec={boardFor('cipherrun')} />
      </div>
    </div>
  )
}
