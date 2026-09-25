import { useEffect, useRef, useState } from 'react'
import { useTitle } from '../lib/useTitle.js'
import { projectWorld, projectMap } from '../lib/ventlineView.js'

const W = 960
const H = 600
const vars = ['bg', 'surface', 'line', 'fg', 'muted', 'flare', 'live', 'warn', 'tile', 'hole', 'player-1']
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
    { ...gate.service, label: 'SERVICE', color: c.live, symbol: '◇' },
    { ...gate.charged, label: 'CHARGED', color: c.warn, symbol: '↯' },
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
    if (gate.pickup) {
      const center = (gap.lo + gap.hi) / 2
      ctx.font = 'bold 19px ui-sans-serif, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(gap.symbol, x + gate.w / 2, center + 6)
    }
  }
}

function drawDrone(ctx, player, cameraX, c, flash, alpha = 1, label = '') {
  if (!Number.isFinite(player?.x) || !Number.isFinite(player?.y)) return
  const { x, y } = projectWorld(player.x, player.y, cameraX, 1)
  if (flash) polygon(ctx, [[x - 15, y - 5], [x - 38, y], [x - 15, y + 5]], c.flare)
  ctx.save()
  ctx.translate(x, y)
  ctx.globalAlpha = alpha * (player.alive ? 1 : 0.48)
  polygon(ctx, [[-18, 0], [-6, -11], [13, -10], [21, 0], [13, 10], [-6, 11]], c['player-1'])
  polygon(ctx, [[-3, -9], [14, -8], [18, 0], [14, 8], [-3, 9]], c.fg)
  ctx.fillStyle = c.bg
  ctx.fillRect(2, -4, 8, 8)
  ctx.strokeStyle = c.fg
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-10, -13); ctx.lineTo(10, -13)
  ctx.moveTo(-10, 13); ctx.lineTo(10, 13)
  ctx.stroke()
  if (player.shield) {
    ctx.strokeStyle = c.live
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.stroke()
  }
  if (player.charge) {
    ctx.fillStyle = c.warn
    ctx.font = 'bold 16px ui-sans-serif, sans-serif'
    ctx.fillText('↯', -4, -24)
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

function drawMap(ctx, snap, c, now, crashUntil) {
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
    if (gate.pickup) {
      ctx.font = 'bold 10px ui-sans-serif, sans-serif'
      ctx.fillStyle = c.live
      ctx.fillText('◇', gate.x + 4, (gate.service.lo + gate.service.hi) / 2 + 3)
      ctx.fillStyle = c.warn
      ctx.fillText('↯', gate.x + 4, (gate.charged.lo + gate.charged.hi) / 2 + 3)
    }
  }
  for (const player of map.players) {
    if (!player.alive && now > (crashUntil.get(player.id) ?? 0)) continue
    if (player.x < 0 || player.x > w || player.y < 0 || player.y > h) continue
    ctx.strokeStyle = player.solid ? c.flare : c.fg
    ctx.fillStyle = player.solid ? c.flare : c.hole
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(player.x, player.y, 4, 0, Math.PI * 2)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = c.fg
    ctx.font = 'bold 10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(player.alive ? player.label : '×', player.labelX, player.labelY)
  }
  ctx.restore()
}

function draw(ctx, snap, previous, receivedAt, interval, ownId, now, cueUntil, reduced) {
  const c = palette()
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = c.hole
  ctx.fillRect(0, 0, W, H)
  // Sparse cutaway seams give the bay scale without competing with the gates.
  ctx.strokeStyle = c.line
  ctx.lineWidth = 1
  for (let x = 0; x < W; x += 120) {
    ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x, H - 28); ctx.stroke()
  }
  ctx.fillStyle = c.surface
  ctx.fillRect(0, 0, W, 28)
  ctx.fillRect(0, H - 28, W, 28)
  ctx.fillStyle = c.tile
  ctx.fillRect(0, 24, W, 4)
  ctx.fillRect(0, H - 28, W, 4)
  for (let x = 18; x < W; x += 72) {
    ctx.fillStyle = c.muted
    ctx.fillRect(x, 9, 4, 4)
    ctx.fillRect(x, H - 14, 4, 4)
  }
  const viewed = snap?.players?.find(p => p.id === snap.viewedId)
  const cameraX = Number.isFinite(viewed?.x) ? viewed.x - 180 : -180
  for (const gate of snap?.gates ?? []) drawGate(ctx, gate, cameraX, c)
  for (const rival of snap?.players ?? []) {
    if (rival.id === snap.viewedId || rival.spectating) continue
    const before = previous?.players?.find(player => player.id === rival.id)
    const t = reduced || !before?.alive || !rival.alive || !Number.isFinite(before.x) ||
      !Number.isFinite(before.y) ? 1 : Math.min(1, Math.max(0, (now - receivedAt) / interval))
    const pose = before && t < 1 ? { ...rival,
      x: before.x + (rival.x - before.x) * t,
      y: before.y + (rival.y - before.y) * t } : rival
    drawDrone(ctx, pose, cameraX, c, false, 0.25, `${rival.slot + 1} ${rival.name?.slice(0, 9) ?? ''}`)
  }
  if (viewed) drawDrone(ctx, viewed, cameraX, c, !reduced && now < cueUntil, 1,
    ownId && viewed.id !== ownId ? 'VIEW' : '')
  else {
    ctx.fillStyle = c.muted
    ctx.font = '18px ui-sans-serif, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Choose a flight mode to enter the bay', W / 2, H / 2)
  }
}

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
  const snapRef = useRef(null)
  const previousRef = useRef(null)
  const receivedAtRef = useRef(0)
  const intervalRef = useRef(50)
  const finalMapRef = useRef(null)
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
    previousRef.current = null
    finalMapRef.current = null
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
      previousRef.current = snapRef.current
      const receivedAt = performance.now()
      if (receivedAtRef.current) intervalRef.current = Math.max(16, receivedAt - receivedAtRef.current)
      receivedAtRef.current = receivedAt
      snapRef.current = message
      if (message.phase === 'over') finalMapRef.current ??= message
      else finalMapRef.current = null
      setSnap(message)
      if (previousPhase && previousPhase !== 'lobby' && message.phase === 'lobby') {
        setReady(false)
        eventSeqRef.current = 0
      }
      const own = message.players?.find(p => p.id === idRef.current)
      if (own?.event?.seq > eventSeqRef.current) {
        eventSeqRef.current = own.event.seq
        const labels = { 'shield-pickup': 'Shield collected', 'charge-pickup': 'Score charge collected',
          'shield-use': 'Shield absorbed a shutter', 'charge-use': 'Score charge used' }
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
    let frame
    const render = now => {
      draw(ctx, snapRef.current, previousRef.current, receivedAtRef.current, intervalRef.current,
        idRef.current, now, cueUntilRef.current, reducedRef.current)
      drawMap(mapCtx, finalMapRef.current ?? snapRef.current, palette(), now, crashUntilRef.current)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => { cancelAnimationFrame(frame); media.removeEventListener('change', updateMotion) }
  }, [])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.code !== 'Space' || event.repeat || ['INPUT', 'BUTTON', 'TEXTAREA'].includes(event.target?.tagName)) return
      if (snapRef.current?.phase !== 'playing') return
      event.preventDefault(); press()
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
  const status = connection === 'error' || connection === 'closed'
    ? 'Connection lost. Choose Solo or Live to reconnect.'
    : connection === 'connecting' ? 'Connecting to the flight bay…'
      : !mode ? 'Choose Solo for an immediate run, or Live to fly with others.'
        : isSpectator ? `Spectating ${viewed?.name ?? 'the next pilot'}. Join the next round when it resets.`
          : phase === 'lobby' ? ready ? 'Ready. Waiting for another pilot.' : 'Lobby. Ready when you are.'
            : phase === 'countdown' ? 'Launch countdown. Get ready to flap.'
              : phase === 'playing' ? own?.alive ? 'Flying. Press Space or tap the bay to flap.' : 'Drone crashed. Watching the remaining pilots.'
                : phase === 'over' ? mode === 'solo' ? 'Run complete. Retry to launch again.' : 'Round complete. The next lobby opens shortly.'
                  : 'Joining the flight bay…'

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div><h1 className="display text-4xl sm:text-6xl">Ventline</h1><p className="mt-2 text-sm text-muted">Every gap is a choice.</p></div>
        <form onSubmit={event => { event.preventDefault(); connect('solo') }} className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-muted">Pilot name
            <input value={name} maxLength={24} onChange={event => setName(event.target.value)} className="mt-1 block w-36 border border-line bg-surface px-3 py-2 text-fg" />
          </label>
          <button type="submit" className="bg-flare px-5 py-2 font-bold text-on-flare">Solo</button>
          <button type="button" onClick={() => connect('live')} className="border border-line bg-surface px-5 py-2 font-bold text-fg">Live</button>
        </form>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-line bg-surface px-4 py-3 font-mono text-sm">
        <span>Score <strong className="text-flare">{score}</strong></span>
        <span>Clean clears <strong>{own?.clean ?? 0}</strong></span>
        <span>Best <strong>{snap?.personalBest ?? 0}</strong></span>
        <span>Shield <strong>{own?.shield ? '◇ held' : 'empty'}</strong></span>
        <span>Charge <strong>{own?.charge ? '↯ held' : 'empty'}</strong></span>
      </div>
      <div onPointerDown={event => { if (event.target === canvasRef.current && (event.button === 0 || event.pointerType === 'touch')) press() }}
        className="relative cursor-pointer overflow-hidden border-x border-b border-line bg-bg"
        style={{ touchAction: 'none' }} aria-label="Ventline flight area. Tap or click to flap">
        <div className="relative h-32 border-b border-line bg-surface">
          <canvas ref={mapCanvasRef} className="pointer-events-none absolute right-1 top-0 h-32 w-44" aria-hidden="true" />
        </div>
        <canvas ref={canvasRef} className="block h-auto w-full" style={{ aspectRatio: '8 / 5' }} aria-hidden="true" />
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p role="status" className="font-semibold">{status}</p>
          <p className="mt-1 text-sm text-muted">Space, click, or tap to flap. Wide service gaps score 1; narrow ↯ gaps score 2.</p>
          {cue && <p role="status" className="mt-2 text-sm text-live">{cue}</p>}
          {phase === 'lobby' && mode === 'live' && own && !ready &&
            <button type="button" onClick={() => { send('ready'); setReady(true) }} className="mt-4 bg-flare px-5 py-2 font-bold text-on-flare">Ready</button>}
          {phase === 'over' && mode === 'solo' &&
            <button type="button" onClick={() => { send('retry'); setCue(''); eventSeqRef.current = 0 }} className="mt-4 bg-flare px-5 py-2 font-bold text-on-flare">Retry</button>}
        </div>
        <button type="button" aria-pressed={muted} onClick={() => { mutedRef.current = !muted; setMuted(!muted) }}
          className="border border-line px-4 py-2 text-sm">Sound {muted ? 'off' : 'on'}</button>
      </div>
      {mode && snap && <section className="mt-8 border-t border-line pt-5">
        <h2 className="display text-xl">{phase === 'over' ? 'Results' : 'Pilots'}</h2>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {snap.players?.map(player => <li key={player.id}>
            <strong>{player.name}{player.id === myId ? ' (you)' : ''}</strong>: {player.score} points, {player.clean} clean clears
            {phase !== 'lobby' && !player.alive ? ' · crashed' : ''}
          </li>)}
        </ul>
      </section>}
    </main>
  )
}
