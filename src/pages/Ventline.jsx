import { useEffect, useRef, useState } from 'react'
import { useTitle } from '../lib/useTitle.js'
import { makeBuffer } from '../lib/snapshotBuffer.js'
import { projectWorld, projectMap, mapMarkers, mapLabelX } from '../lib/ventlineView.js'
import { SPHERE, SCORE, EFFECT_SHUTTERS, COMPACT_SCALE } from '../../server/ventline.js'

const W = 960
const H = 600
// Every drone, yours included, is drawn this far behind the newest snapshot,
// blended between two the server sent. Drawn at the newest, your drone and the
// camera locked to it stepped whenever a frame arrived late. Sized to the longest
// gap between frames (31 ms when a Windows timer skips a tick) plus jitter.
const DELAY_MS = 40
const HINT = 'Space, click, or tap to flap. Wide service gaps score 1; narrow ↯ gaps score 2. Touch a sphere to collect it.'
// Every kind has its own mark, so none is told apart by colour alone. Colour
// only says the pool: green survival kinds float in the wide gap, amber score
// kinds in the narrow one.
// U+FE0E asks for the text form: without it Windows draws the snowflake as a colour emoji.
const GLYPH = { shield: '◇', bumper: '⇕', coolant: '❄︎', compact: '▣', charge: '↯', overdrive: '×2' }
const POWERUPS = [
  ['shield', 'Shield', 'absorbs one shutter'],
  ['bumper', 'Bumper', 'one bounce off the ceiling or floor'],
  ['coolant', 'Coolant', `slower for ${EFFECT_SHUTTERS} shutters`],
  ['compact', 'Compact', `smaller for ${EFFECT_SHUTTERS} shutters`],
  ['charge', 'Charge', '+2 on your next clear'],
  ['overdrive', 'Overdrive', `double points for ${EFFECT_SHUTTERS} shutters`],
]
const sphereColor = (kind, c) => SCORE.includes(kind) ? c.warn : c.live
const vars = ['bg', 'surface', 'line', 'fg', 'muted', 'flare', 'live', 'warn', 'tile', 'hole',
  ...Array.from({ length: 8 }, (_, i) => `player-${i + 1}`)]
const palette = () => {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(vars.map(key => [key, css.getPropertyValue(`--${key}`).trim()]))
}

function polygon(ctx, points, fill) {
  ctx.fillStyle = fill
  ctx.beginPath()
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.closePath()
  ctx.fill()
}

function drawGate(ctx, gate, cameraX, c) {
  const x = projectWorld(gate.x, 0, cameraX, 1).x
  if (x < -50 || x > W + 50) return
  const gaps = [
    { ...gate.service, label: 'SERVICE', color: c.live },
    { ...gate.charged, label: 'CHARGED', color: c.warn },
  ].sort((a, b) => a.lo - b.lo)
  const slabs = [[0, gaps[0].lo], [gaps[0].hi, gaps[1].lo], [gaps[1].hi, H]]
  for (const [top, bottom] of slabs) {
    ctx.fillStyle = c.tile
    ctx.fillRect(x, top, gate.w, bottom - top)
    ctx.fillStyle = c.line
    ctx.fillRect(x + 5, top + 4, 4, Math.max(0, bottom - top - 8))
    ctx.fillStyle = c.fg
    for (let y = top + 18; y < bottom - 8; y += 42) {
      ctx.beginPath()
      ctx.arc(x + gate.w / 2, y, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  for (const gap of gaps) {
    ctx.strokeStyle = gap.color
    ctx.lineWidth = gap.label === 'CHARGED' ? 3 : 2
    ctx.strokeRect(x - 3, gap.lo, gate.w + 6, gap.hi - gap.lo)
    ctx.fillStyle = gap.color
    ctx.font = 'bold 12px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.fillText(gap.label, x + gate.w + 11, gap.lo + 17)
    if (gap.label === 'CHARGED') {
      ctx.font = 'bold 17px ui-sans-serif, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('↯', x + gate.w / 2, gap.lo + 21)
    }
  }
}

// A pickup sphere spins about a tilted axis that slowly turns, inside a ring that
// turns the other way. Only the drawing moves: the sphere stays where the server
// placed it, so what you see is what you can touch.
function drawSphere(ctx, sphere, cameraX, c, now, reduced) {
  const { x, y } = projectWorld(sphere.x, sphere.y, cameraX, 1)
  if (x < -40 || x > W + 40) return
  const color = sphereColor(sphere.kind, c)
  const r = SPHERE
  const spin = reduced ? 0.6 : now / 450
  const turn = reduced ? -0.35 : now / 1400
  const ring = (from, to) => {
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.7, r * 0.55, -turn * 1.6, from, to); ctx.stroke()
  }
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.45
  ring(Math.PI, Math.PI * 2)
  ctx.globalAlpha = 1
  ctx.shadowColor = color
  ctx.shadowBlur = 16
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  const shade = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 0, -r * 0.2, -r * 0.2, r * 1.25)
  shade.addColorStop(0, 'rgba(255,255,255,0.75)')
  shade.addColorStop(0.3, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = shade
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.rotate(turn)
  ctx.strokeStyle = c.hole
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 1
  for (let k = 0; k < 3; k++) {
    ctx.beginPath()
    ctx.ellipse(0, 0, Math.abs(Math.sin(spin + k * Math.PI / 3)) * r, r, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.3, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
  ctx.globalAlpha = 0.9
  ring(0, Math.PI)
  ctx.globalAlpha = 1
  ctx.fillStyle = c.hole
  ctx.font = `bold ${sphere.kind === 'overdrive' ? 10 : 12}px ui-sans-serif, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(GLYPH[sphere.kind], 0, 0.5)
  ctx.restore()
}

function drawDrone(ctx, player, cameraX, c, flash, alpha = 1, label = '') {
  if (!Number.isFinite(player?.x) || !Number.isFinite(player?.y)) return
  const { x, y } = projectWorld(player.x, player.y, cameraX, 1)
  if (flash) polygon(ctx, [[x - 15, y - 5], [x - 38, y], [x - 15, y + 5]], c.flare)
  ctx.save()
  ctx.translate(x, y)
  ctx.globalAlpha = alpha * (player.alive ? 1 : 0.48)
  // Compact shrinks the body by the same scale the rules shrink its hitbox.
  const scale = player.compact ? COMPACT_SCALE : 1
  ctx.save()
  ctx.scale(scale, scale)
  polygon(ctx, [[-18, 0], [-6, -11], [13, -10], [21, 0], [13, 10], [-6, 11]], c[`player-${(player.slot ?? 0) + 1}`])
  polygon(ctx, [[-3, -9], [14, -8], [18, 0], [14, 8], [-3, 9]], c.fg)
  ctx.fillStyle = c.bg
  ctx.fillRect(2, -4, 8, 8)
  ctx.strokeStyle = c.fg
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-10, -13); ctx.lineTo(10, -13)
  ctx.moveTo(-10, 13); ctx.lineTo(10, 13)
  ctx.stroke()
  ctx.restore()
  if (player.shield) {
    ctx.strokeStyle = c.live
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(0, 0, 23 * scale, 0, Math.PI * 2); ctx.stroke()
  }
  const held = ['charge', 'bumper', 'coolant', 'compact', 'overdrive'].filter(kind => player[kind]).map(kind => GLYPH[kind])
  if (held.length) {
    ctx.fillStyle = c.fg
    ctx.font = 'bold 12px ui-sans-serif, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(held.join(' '), 0, 33 * scale + 4)
  }
  if (label) {
    if (alpha < 1) ctx.globalAlpha = player.alive ? 0.8 : 0.4
    ctx.fillStyle = c.fg
    ctx.textAlign = 'center'
    ctx.font = 'bold 11px ui-monospace, monospace'
    ctx.fillText(label, 0, -31)
  }
  ctx.restore()
}

function drawMap(ctx, snap, c, now, crashUntil, frozenCrashes) {
  ctx.clearRect(0, 0, 176, 128)
  if (!snap?.viewedId) return
  const x = 8, y = 22, w = 160, h = 100
  const map = projectMap(snap, w, h)
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = c.surface
  ctx.fillRect(-8, -22, w + 16, h + 30)
  ctx.strokeStyle = c.line
  ctx.strokeRect(-8.5, -22.5, w + 17, h + 31)
  ctx.fillStyle = c.fg
  ctx.font = 'bold 11px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.fillText('ROUTE', 0, -7)
  ctx.fillStyle = c.hole
  ctx.fillRect(0, 0, w, h)
  for (const gate of map.gates) {
    const gaps = [gate.service, gate.charged].sort((a, b) => a.lo - b.lo)
    ctx.fillStyle = c.tile
    for (const [top, bottom] of [[0, gaps[0].lo], [gaps[0].hi, gaps[1].lo], [gaps[1].hi, h]]) {
      ctx.fillRect(gate.x, top, Math.max(3, gate.w), bottom - top)
    }
    ctx.fillStyle = c.live
    ctx.fillRect(gate.x - 1, gate.service.lo, Math.max(5, gate.w + 2), 2)
    ctx.fillStyle = c.warn
    ctx.fillRect(gate.x - 1, gate.charged.lo, Math.max(5, gate.w + 2), 2)
    ctx.font = 'bold 10px ui-sans-serif, sans-serif'
    for (const sphere of gate.spheres ?? []) {
      ctx.fillStyle = sphereColor(sphere.kind, c)
      ctx.fillText(GLYPH[sphere.kind], gate.x + 4, sphere.y + 3)
    }
  }
  for (const marker of mapMarkers(map.players, now, crashUntil, frozenCrashes)) {
    if (marker.x < 0 || marker.x > w || marker.y < 0 || marker.y > h) continue
    ctx.strokeStyle = marker.solid ? c.flare : c.fg
    ctx.fillStyle = marker.solid ? c.flare : c.hole
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(marker.x, marker.y, 4, 0, Math.PI * 2)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = document.documentElement.dataset.theme === 'light' ? c.surface : c.fg
    ctx.font = 'bold 10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    const label = marker.labels.join(' ')
    ctx.fillText(label, mapLabelX(marker.x, w, ctx.measureText(label).width),
      marker.y < 12 ? marker.y + 16 : marker.y - 7)
  }
  ctx.restore()
}

function draw(ctx, snap, ownId, now, cueUntil, reduced, c) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = c.hole
  ctx.fillRect(0, 0, W, H)
  // Sparse cutaway seams give the bay scale without competing with the gates.
  ctx.strokeStyle = c.line
  ctx.lineWidth = 1
  for (let x = 0; x < W; x += 120) {
    ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, H - 6); ctx.stroke()
  }
  // A drone crashes when its body reaches y 0 or 600, so the trims stay thin: a
  // deeper ceiling showed drones flying inside it unharmed.
  ctx.fillStyle = c.tile
  ctx.fillRect(0, 0, W, 4)
  ctx.fillRect(0, H - 4, W, 4)
  const viewed = snap?.players?.find(p => p.id === snap.viewedId)
  const cameraX = Number.isFinite(viewed?.x) ? viewed.x - 180 : -180
  for (const gate of snap?.gates ?? []) drawGate(ctx, gate, cameraX, c)
  for (const gate of snap?.gates ?? []) {
    for (const sphere of gate.spheres ?? []) drawSphere(ctx, sphere, cameraX, c, now, reduced)
  }
  for (const rival of snap?.players ?? []) {
    if (rival.id === snap.viewedId || rival.spectating) continue
    drawDrone(ctx, rival, cameraX, c, false, 0.25, `${rival.slot + 1} ${rival.name?.slice(0, 9) ?? ''}`)
  }
  if (viewed) drawDrone(ctx, viewed, cameraX, c, !reduced && now < cueUntil, 1,
    ownId && viewed.id !== ownId ? 'VIEW' : '')
}

const Stat = ({ label, children, className = '' }) => (
  <span className={`border border-line bg-bg/80 px-[0.6em] py-[0.2em] ${className}`}>
    {label} <strong>{children}</strong>
  </span>
)

export default function Ventline() {
  useTitle('Ventline')
  const [name, setName] = useState('Pilot')
  const [mode, setMode] = useState(null)
  const [connection, setConnection] = useState('idle')
  const [snap, setSnap] = useState(null)
  const [myId, setMyId] = useState(null)
  const [ready, setReady] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cue, setCue] = useState('')
  const socketRef = useRef(null)
  const canvasRef = useRef(null)
  const mapCanvasRef = useRef(null)
  const retryRef = useRef(null)
  const snapRef = useRef(null)
  const bufRef = useRef(makeBuffer(DELAY_MS))
  const finalMapRef = useRef(null)
  const finalCrashesRef = useRef(null)
  const crashUntilRef = useRef(new Map())
  const idRef = useRef(null)
  const audioRef = useRef(null)
  const mutedRef = useRef(false)
  const eventSeqRef = useRef(0)
  const cueUntilRef = useRef(0)
  const cueTimerRef = useRef(null)
  const reducedRef = useRef(false)

  const sound = (frequency, duration = 0.07) => {
    if (mutedRef.current) return
    try {
      const audio = audioRef.current ?? new (window.AudioContext || window.webkitAudioContext)()
      audioRef.current = audio
      if (audio.state === 'suspended') audio.resume()
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'triangle'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.055, audio.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration)
      oscillator.connect(gain).connect(audio.destination)
      oscillator.start(); oscillator.stop(audio.currentTime + duration)
    } catch { /* Audio is optional; flight remains playable. */ }
  }

  const send = t => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t }))
  }
  const press = () => {
    const own = snapRef.current?.players?.find(p => p.id === idRef.current)
    if (!own?.alive || snapRef.current?.phase !== 'playing') return
    send('flap')
    cueUntilRef.current = performance.now() + 95
    sound(210, 0.055)
  }

  const connect = selectedMode => {
    socketRef.current?.close()
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ventline-ws`, 'ventline.v1')
    socketRef.current = socket
    snapRef.current = null
    bufRef.current = makeBuffer(DELAY_MS)
    finalMapRef.current = null
    finalCrashesRef.current = null
    crashUntilRef.current.clear()
    idRef.current = null
    eventSeqRef.current = 0
    setSnap(null); setMyId(null); setReady(false); setCue('')
    setMode(selectedMode); setConnection('connecting')
    socket.onopen = () => {
      if (socketRef.current !== socket) return
      setConnection('open')
      socket.send(JSON.stringify({ t: 'join', mode: selectedMode, name: name.slice(0, 24) }))
    }
    socket.onmessage = event => {
      if (socketRef.current !== socket) return
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.t === 'welcome') {
        idRef.current = message.id
        setMyId(message.id)
        setReady(false)
      }
      if (message.t !== 'snap') return
      const previousPhase = snapRef.current?.phase
      for (const player of message.players ?? []) {
        if (!player.alive && snapRef.current?.players?.find(before => before.id === player.id)?.alive) {
          crashUntilRef.current.set(player.id, performance.now() + 900)
        }
      }
      const receivedAt = performance.now()
      // A run starts again from x 0. Blended with the last run's final frame, the
      // drone would sweep back across the whole bay.
      if (message.phase === 'playing' && previousPhase !== 'playing') bufRef.current = makeBuffer(DELAY_MS)
      bufRef.current.push(message, receivedAt)
      snapRef.current = message
      if (message.phase === 'over' && !finalMapRef.current) {
        finalMapRef.current = message
        finalCrashesRef.current = new Set(message.players.filter(player => !player.alive &&
          receivedAt <= (crashUntilRef.current.get(player.id) ?? 0)).map(player => player.id))
      } else if (message.phase !== 'over') {
        finalMapRef.current = null
        finalCrashesRef.current = null
      }
      setSnap(message)
      // A new run starts its effect count at 0. Reset on leaving the result, not on
      // pressing Retry: result frames still in flight would replay the last cue.
      // Ready is cleared by welcome, which the server sends with every new round.
      if (previousPhase === 'over' && message.phase !== 'over') eventSeqRef.current = 0
      const own = message.players?.find(p => p.id === idRef.current)
      if (own?.event?.seq > eventSeqRef.current) {
        eventSeqRef.current = own.event.seq
        const labels = { 'shield-pickup': 'Shield collected', 'charge-pickup': 'Score charge collected',
          'shield-use': 'Shield absorbed a shutter', 'charge-use': 'Score charge used',
          'bumper-pickup': 'Bumper ready: one bounce off the ceiling or floor', 'bumper-use': 'Bumper bounced you back',
          'coolant-pickup': `Coolant: slower for ${EFFECT_SHUTTERS} shutters`,
          'compact-pickup': `Compact: smaller for ${EFFECT_SHUTTERS} shutters`,
          'overdrive-pickup': `Overdrive: double points for ${EFFECT_SHUTTERS} shutters` }
        setCue(labels[own.event.type] ?? '')
        clearTimeout(cueTimerRef.current)
        cueTimerRef.current = setTimeout(() => setCue(''), 1800)
        cueUntilRef.current = performance.now() + 650
        sound(own.event.type?.includes('pickup') ? 660 : 390, 0.12)
      }
    }
    socket.onerror = () => { if (socketRef.current === socket) setConnection('error') }
    socket.onclose = () => { if (socketRef.current === socket) setConnection('closed') }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const mapCanvas = mapCanvasRef.current
    const mapCtx = mapCanvas.getContext('2d')
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * ratio; canvas.height = H * ratio
    mapCanvas.width = 176 * ratio; mapCanvas.height = 128 * ratio
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    mapCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => { reducedRef.current = media.matches }
    updateMotion(); media.addEventListener('change', updateMotion)
    // Read once and again on a theme flip, not every frame: reading computed style
    // per frame forced a style pass whenever the HUD had just re-rendered.
    let colors = palette()
    const theme = new MutationObserver(() => { colors = palette() })
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    let frame
    const render = now => {
      // Lobby and countdown frames carry no positions (x is null), which a blend
      // would turn into 0 and draw every pilot in the corner.
      const flying = ['playing', 'over'].includes(snapRef.current?.phase)
      const view = (flying && bufRef.current.sample(now)) || snapRef.current
      draw(ctx, view, idRef.current, now, cueUntilRef.current, reducedRef.current, colors)
      drawMap(mapCtx, finalMapRef.current ?? view, colors, now, crashUntilRef.current, finalCrashesRef.current)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame)
      media.removeEventListener('change', updateMotion)
      theme.disconnect()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.code !== 'Space') return
      const snap = snapRef.current
      if (snap?.phase !== 'playing' || !snap.players?.find(p => p.id === idRef.current)?.alive) {
        // Off a control, Space belongs to the game and never scrolls the page.
        if (snap && event.target === document.body) event.preventDefault()
        return
      }
      // While your drone flies, Space flaps wherever focus is. Solo keeps focus after
      // it is pressed, and a Space it took would restart the run instead of flapping.
      event.preventDefault()
      document.activeElement?.blur()
      if (!event.repeat) press()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  useEffect(() => () => {
    socketRef.current?.close()
    audioRef.current?.close()
    clearTimeout(cueTimerRef.current)
  }, [])

  const own = snap?.players?.find(p => p.id === myId)
  const viewed = snap?.players?.find(p => p.id === snap.viewedId)
  const isSpectator = mode === 'live' && snap && !own
  const score = own?.score ?? 0
  const phase = snap?.phase

  // Retry takes focus once the result has been on screen a moment, so Space flies
  // again without the mouse. Focused at once, a flap still being pressed as the
  // drone crashed would skip the result.
  useEffect(() => {
    if (phase !== 'over' || mode !== 'solo') return
    const timer = setTimeout(() => retryRef.current?.focus(), 700)
    return () => clearTimeout(timer)
  }, [phase, mode])

  const status = connection === 'error' || connection === 'closed'
    ? 'Connection lost. Choose Solo or Live to reconnect.'
    : connection === 'connecting' ? 'Connecting to the flight bay…'
      : !mode ? 'Choose Solo for an immediate run, or Live to fly with others.'
        : isSpectator ? `Spectating ${viewed?.name ?? 'the next pilot'}. You fly the next round.`
          : phase === 'lobby' ? ready ? 'Ready. Waiting for another pilot.' : 'Lobby. Ready when you are.'
            : phase === 'countdown' ? 'Launch countdown. Get ready to flap.'
              : phase === 'playing' ? own?.alive ? 'Flying. Press Space or tap the bay to flap.' : `Crashed. Watching ${viewed?.name ?? 'the remaining pilots'}.`
                : phase === 'over' ? mode === 'solo' ? `Run complete. ${score} points.` : 'Round complete. The next lobby opens shortly.'
                  : 'Joining the flight bay…'

  const button = 'bg-flare px-[1.2em] py-[0.45em] font-bold text-on-flare'
  const legend = (
    <ul className="mt-[0.75em] grid grid-cols-1 gap-x-[1.2em] gap-y-[0.2em] text-left sm:grid-cols-2">
      {POWERUPS.map(([kind, title, body]) => (
        <li key={kind}><span className={SCORE.includes(kind) ? 'text-warn' : 'text-live'}>{GLYPH[kind]}</span> <strong>{title}</strong> {body}</li>
      ))}
    </ul>
  )
  const lost = connection === 'error' || connection === 'closed'
  const panel = !mode ? (
    <>
      <p className="display text-[1.6em]">Choose Solo or Live</p>
      <p className="mt-[0.5em] text-muted">{HINT}</p>
      {legend}
    </>
  ) : lost || connection === 'connecting' || !snap ? (
    <p>{lost ? status : connection === 'connecting' ? status : 'Joining the flight bay…'}</p>
  ) : phase === 'lobby' ? (
    <>
      <p className="display text-[1.6em]">Lobby</p>
      <ul className="mt-[0.5em]">
        {snap.players.map(p => <li key={p.id}>{p.slot + 1} {p.name}{p.id === myId ? ' (you)' : ''}</li>)}
      </ul>
      {!own ? <p className="mt-[0.75em]">The lobby is full. You fly the next round.</p>
        : ready ? <p className="mt-[0.75em]">Ready. Waiting for another pilot.</p>
          : <button type="button" autoFocus onClick={() => { send('ready'); setReady(true) }} className={`mt-[0.75em] ${button}`}>Ready</button>}
      <p className="mt-[0.75em] text-muted">{HINT}</p>
      {legend}
    </>
  ) : phase === 'countdown' ? (
    <>
      <p className="display text-[1.6em]">Launch countdown</p>
      <p className="mt-[0.5em]">{isSpectator ? 'You fly the next round.' : 'Get ready to flap.'}</p>
    </>
  ) : phase === 'over' && mode === 'solo' ? (
    <>
      <p className="display text-[1.6em]">Run complete</p>
      <p className="mt-[0.5em]">{score} points, {own?.clean ?? 0} clean clears. Best {snap.personalBest ?? 0}.</p>
      <button ref={retryRef} type="button" onClick={() => { send('retry'); setCue('') }} className={`mt-[0.75em] ${button}`}>Retry</button>
    </>
  ) : phase === 'over' ? (
    <>
      <p className="display text-[1.6em]">Round complete</p>
      <ol className="mt-[0.5em] text-left">
        {[...snap.players].sort((a, b) => b.score - a.score || b.clean - a.clean).map(p => (
          <li key={p.id}>{p.slot + 1} {p.name}{p.id === myId ? ' (you)' : ''}: {p.score} points, {p.clean} clears{p.connected ? '' : ', left'}</li>
        ))}
      </ol>
      <p className="mt-[0.5em] text-muted">The next lobby opens shortly.</p>
    </>
  ) : null
  const banner = phase === 'playing' && mode === 'live' && !own?.alive ? status : ''

  return (
    <main className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="display text-3xl">Ventline</h1>
          <p className="hidden text-sm text-muted sm:block">Every gap is a choice.</p>
        </div>
        <form onSubmit={event => { event.preventDefault(); connect('solo') }} className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">Pilot
            <input value={name} maxLength={24} onChange={event => setName(event.target.value)} className="w-32 border border-line bg-surface px-3 py-1.5 text-fg" />
          </label>
          <button type="submit" className="bg-flare px-4 py-1.5 font-bold text-on-flare">Solo</button>
          <button type="button" onClick={() => connect('live')} className="border border-line bg-surface px-4 py-1.5 font-bold text-fg">Live</button>
        </form>
      </div>
      {/* Sized to fit the screen below the bar. Everything the game shows sits on it:
          the top and bottom eighths are always solid shutter, so nothing there can
          hide an opening, and the HUD starts right of the column the drone flies in. */}
      <div onPointerDown={event => { if (event.target === canvasRef.current && (event.button === 0 || event.pointerType === 'touch')) press() }}
        className="@container relative mx-auto cursor-pointer select-none overflow-hidden border border-line bg-bg"
        style={{ touchAction: 'none', width: 'min(100%, calc((100dvh - 9rem) * 1.6))', aspectRatio: '8 / 5' }}
        aria-label="Ventline flight area. Tap or click to flap">
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 font-mono text-fg" style={{ fontSize: 'clamp(10px, 1.45cqw, 16px)' }}>
          <div className="absolute left-[24%] right-[22%] top-[2%] flex flex-wrap gap-[0.5em]">
            <Stat label="Score" className="text-[1.15em]"><span className="text-flare">{score}</span></Stat>
            <Stat label="Best">{snap?.personalBest ?? 0}</Stat>
            <Stat label="Clears">{own?.clean ?? 0}</Stat>
            {POWERUPS.filter(([kind]) => own?.[kind]).map(([kind, title]) => (
              <span key={kind} className={`border border-line bg-bg/80 px-[0.6em] py-[0.2em] ${SCORE.includes(kind) ? 'text-warn' : 'text-live'}`}>
                {GLYPH[kind]} <strong>{title}{typeof own[kind] === 'number' ? ` ${own[kind]}` : ''}</strong>
              </span>
            ))}
          </div>
          <canvas ref={mapCanvasRef} className="absolute right-[1.5%] top-[2%] h-auto w-[18%] min-w-[110px] opacity-90" aria-hidden="true" />
          {banner && <p className="absolute left-1/2 top-[14%] -translate-x-1/2 border border-line bg-bg/85 px-[0.8em] py-[0.3em] whitespace-nowrap">{banner}</p>}
          {cue && <p className="absolute left-1/2 top-[22%] -translate-x-1/2 border border-line bg-bg/85 px-[0.8em] py-[0.3em] whitespace-nowrap text-live">{cue}</p>}
          {mode === 'live' && (phase === 'playing' || phase === 'countdown') &&
            <ul className="absolute bottom-[2%] left-[24%] right-[18%] flex flex-wrap gap-[0.5em]">
              {snap.players.map(p => (
                <li key={p.id} className="border border-line bg-bg/80 px-[0.6em] py-[0.2em]">
                  <span style={{ color: `var(--player-${p.slot + 1})` }}>{p.slot + 1}</span> {p.name.slice(0, 10)}{p.id === myId ? ' (you)' : ''} {phase === 'playing' && !p.alive ? '× ' : ''}{p.score}
                </li>
              ))}
            </ul>}
          {panel && <div className="pointer-events-auto absolute left-1/2 top-1/2 max-w-[70%] -translate-x-1/2 -translate-y-1/2 border border-line bg-surface/90 px-[1.6em] py-[1.2em] text-center font-sans">{panel}</div>}
          <button type="button" aria-pressed={muted} onClick={() => { mutedRef.current = !muted; setMuted(!muted) }}
            className="pointer-events-auto absolute bottom-[2%] right-[1.5%] border border-line bg-bg/80 px-[0.8em] py-[0.25em]">Sound {muted ? 'off' : 'on'}</button>
        </div>
      </div>
      <p role="status" className="sr-only">{status}</p>
      {cue && <p role="status" className="sr-only">{cue}</p>}
    </main>
  )
}
