import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import BlockArt from '../components/BlockArt.jsx'
import { games } from '../data/games.js'
import { makeWallTiles } from '../lib/wallTiles.js'
import { useTitle } from '../lib/useTitle.js'

// The ad is for one of the studio's other titles, copy straight out of the
// catalog — so it stays in fiction and there is no second place to edit it.
const ADS = games.filter((g) => g.slug !== 'fracture-line')

// The X does nothing for this long, exactly like the real thing. It is what
// makes the pickup worth spending; the server timeout is the backstop.
const AD_CLOSE_DELAY_MS = 1500

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

// Matches the server tick. The uplink is one small frame per tick, sent
// unconditionally — a steady, readable stream in a packet capture.
const SEND_MS = 33

// Render this far behind the newest snapshot, so there are always two frames
// to interpolate between. One tick of slack over the 33 ms send interval
// covers ordinary jitter. This is the entire cost of smooth movement: no
// prediction, no reconciliation, no rollback.
const DELAY_MS = 100

// How many cells fit across the canvas. The arena is bigger than this on
// purpose: the camera follows you and clamps at the walls, so the map can grow
// without every piece shrinking. Lower is more zoomed in.
const VIEW_CELLS = 26

// The minimap is a fifth of the canvas wide, parked in the top-right corner.
// It renders the same snapshot everything else does — no extra request, no
// second channel, nothing the wire does not already carry in plain JSON.
const MINIMAP_FRACTION = 0.2

// Each kind gets its own glyph, so a pickup is never identified by colour.
const POWERUP = {
  sprint: {
    glyph: '»',
    label: 'Sprint',
    blurb: 'Move faster for a few seconds.',
  },
  shield: {
    glyph: '◈',
    label: 'Shield',
    blurb: 'Absorbs the next round that hits you.',
  },
  overcharge: {
    glyph: '✶',
    label: 'Overcharge',
    blurb: 'Rounds hit twice as hard and punch through one layer of cover.',
  },
  bulwark: {
    glyph: '⊔',
    label: 'Bulwark',
    blurb: 'Throws up a U of cover, closed side facing whoever is nearest.',
  },
  rapid: {
    glyph: '≡',
    label: 'Rapid fire',
    blurb: 'Cycles your weapon four times faster.',
  },
  shotgun: {
    glyph: 'Ψ',
    label: 'Shotgun',
    blurb: 'Five pellets a pull. Hits hard up close, dies off at range.',
  },
  medkit: {
    glyph: '✚',
    label: 'Medkit',
    blurb: 'Heals two, and banks the rest as overheal if you are already full.',
  },
  sword: {
    glyph: '†',
    label: 'Sword',
    blurb: 'Swing instead of shoot. Anything you can reach dies outright.',
  },
  bomb: {
    glyph: '◎',
    label: 'Bombs',
    blurb: 'Your block charges become bombs. Each one levels a whole line.',
  },
  popup: {
    glyph: '▣',
    label: 'Popup ad',
    blurb: 'Drops an ad over every rival\u2019s view. They have to close it.',
  },
}

// One icon per slot, and deliberately eight silhouettes that are nothing like
// each other — this is what tells players apart when colour cannot, so it does
// more work than the tint does. Same order as PIECE, so a player's icon and
// colour always agree.
const PIECE_ICON = [
  '\u{1F98A}',
  '\u{1F43A}',
  '\u{1F419}',
  '\u{1F988}',
  '\u{1F41D}',
  '\u{1F438}',
  '\u{1F985}',
  '\u{1F427}',
]
const ICON_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'

// Own tokens, not reused status colours. Written out in full because Tailwind
// only ever sees class names that appear literally in the source.
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

// How long each piece of combat feedback stays on screen. Short enough that
// two hits in a row read as two hits, long enough to notice at all.
const FX_MS = { flash: 260, mark: 400, dmg: 900, swing: 240, blast: 520 }
const FEED_MS = 5000

const lerp = (a, b, t) => a + (b - a) * t
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

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
    return `Waiting for ${short === 1 ? 'one more player' : `${short} more players`}. ${game.players.length} of ${game.min ?? 2} in the arena.`
  }
  if (game.phase === 'over') {
    return `${game.winner} takes the match. Next one in ${game.secs}.`
  }
  if (mine && !mine.alive) return 'Down. Redeploying shortly.'
  return `Match live. First to ${game.target} eliminations.`
}

export default function Fracture() {
  useTitle('Fracture Line — Browser Trial')

  const [name, setName] = useState('')
  const [status, setStatus] = useState('idle') // idle | connecting | live | closed | full
  const [myId, setMyId] = useState(null)
  // Only the HUD re-renders on state; the arena draws from the buffer instead,
  // so React never sees 30 renders a second.
  const [hud, setHud] = useState(null)
  // The kill feed is HTML rather than canvas text: a screen reader can read it,
  // and expiry is presentation, so the server never has to remember it.
  const [feed, setFeed] = useState([])

  const wsRef = useRef(null)
  const canvasRef = useRef(null)
  const bufRef = useRef([])
  const myIdRef = useRef(null)
  const keysRef = useRef(new Set())
  const aimRef = useRef(0)
  const fireRef = useRef(false)
  // Where the pointer is, in canvas pixels, and whether it has ever moved.
  // Until it does, aim follows the last direction walked, so the game is
  // playable on a keyboard alone.
  const pointerRef = useRef(null)
  const drawnRef = useRef(null) // my last drawn position, for aiming
  const fxRef = useRef([]) // transient combat feedback, pruned as it ages
  // Eased rather than switched, so a player skimming the corner does not make
  // the minimap strobe.
  const mmAlphaRef = useRef(1)
  const fxIdRef = useRef(0)
  // Only the winner's own client celebrates, which is why the server sends an
  // id and not just a name — two people may be called the same thing.
  const [party, setParty] = useState([])
  // An ad you have closed stays closed until the next one arrives.
  const [ad, setAd] = useState({ closed: false, which: 0, left: 20, top: 20 })
  const adWasRef = useRef(0)
  const won = hud?.phase === 'over' && myId !== null && hud.winnerId === myId

  // Turns one tick's events into things you can see. The server says what
  // happened; how long it lingers is entirely this side's business.
  const absorb = useCallback((msg) => {
    const at = performance.now()
    const nameOf = (id) => msg.players.find((p) => p.id === id)?.name ?? 'someone'
    const mine = myIdRef.current
    for (const e of msg.events) {
      if (e.k === 'kill') {
        setFeed((f) => [
          ...f.slice(-5),
          {
            id: fxIdRef.current++,
            by: nameOf(e.by),
            of: nameOf(e.of),
            // Blowing yourself up is the one way both ends are the same person.
            self: e.by === e.of,
            at,
          },
        ])
        continue
      }
      if (e.k === 'swing') {
        fxRef.current.push({
          k: 'swing',
          x: e.x,
          y: e.y,
          aim: e.aim,
          r: e.r,
          arc: e.arc,
          at,
        })
        continue
      }
      if (e.k === 'blast') {
        fxRef.current.push({ k: 'blast', axis: e.axis, line: e.at, at })
        continue
      }
      fxRef.current.push({ k: 'flash', of: e.of, at })
      if (e.by === mine) fxRef.current.push({ k: 'mark', x: e.x, y: e.y, dmg: e.dmg, at })
      if (e.of === mine) fxRef.current.push({ k: 'dmg', x: e.x, y: e.y, at })
    }
  }, [])

  const send = useCallback((msg) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const connect = useCallback(
    (playerName) => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${scheme}://${window.location.host}/fracture-ws`)
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
        } else if (msg.t === 'state' && Array.isArray(msg.walls)) {
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

  // Leaving the page must drop the socket, or the server holds a ghost player.
  useEffect(() => () => wsRef.current?.close(), [])

  // ---------- Input ----------
  useEffect(() => {
    if (status !== 'live') return undefined

    const onKey = (down) => (e) => {
      if (e.code === 'Space') {
        e.preventDefault() // space scrolls the page by default
        fireRef.current = down
        return
      }
      if (e.code === 'KeyE') {
        e.preventDefault()
        if (down) send({ t: 'use' })
        return
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        e.preventDefault()
        if (down) send({ t: 'dash' })
        return
      }
      if (e.code === 'KeyQ') {
        e.preventDefault()
        if (down) send({ t: 'build' })
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
    const blur = () => {
      keysRef.current.clear()
      fireRef.current = false
    }

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
      const me = drawnRef.current
      if (pointerRef.current && me) {
        aimRef.current = Math.atan2(pointerRef.current.y - me.y, pointerRef.current.x - me.x)
      } else if (dx || dy) {
        // Without a pointer, you shoot the way you walk.
        aimRef.current = Math.atan2(dy, dx)
      }
      send({ t: 'input', dx, dy, aim: aimRef.current, fire: fireRef.current })
    }, SEND_MS)
    return () => clearInterval(id)
  }, [status, send])

  // ---------- Render ----------
  useEffect(() => {
    if (status !== 'live') return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')

    // Canvas has no tokens of its own, so the theme's are read out of CSS.
    // Re-read only when the theme actually flips, never per frame.
    let theme = null
    let colour = {}
    let tiles = null
    let tilesPx = 0
    const readTheme = () => {
      const css = getComputedStyle(document.documentElement)
      const v = (n) => css.getPropertyValue(n).trim()
      colour = {
        floor: v('--bg'),
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
      }

      const [a, b, t] = bracket(buf, performance.now() - DELAY_MS)
      // Walls come from the older frame, so a wall never disappears before the
      // round that broke it has visibly arrived.
      const { w, h, walls, powerups } = a

      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = Math.round((cssW * h) / w)
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
        canvas.style.height = `${cssH}px`
      }
      // Zoom is set by how many cells we want across, not by the arena size,
      // so a bigger map no longer means smaller pieces.
      const viewW = Math.min(VIEW_CELLS, w)
      const u = canvas.width / viewW // pixels per cell
      const viewH = canvas.height / u

      // Centre on yourself, clamped so the view never runs off the arena. Dead
      // or spectating, sit on the middle of the map instead.
      const mineA = a.players.find((q) => q.id === myIdRef.current)
      const mineB = b.players.find((q) => q.id === myIdRef.current)
      const focusX = mineA?.alive && mineB?.alive ? lerp(mineA.x, mineB.x, t) : (mineA?.x ?? w / 2)
      const focusY = mineA?.alive && mineB?.alive ? lerp(mineA.y, mineB.y, t) : (mineA?.y ?? h / 2)
      const camX = clamp(focusX - viewW / 2, 0, Math.max(0, w - viewW))
      const camY = clamp(focusY - viewH / 2, 0, Math.max(0, h - viewH))
      const offX = camX * u
      const offY = camY * u

      // Background is painted in screen space; everything after it is drawn in
      // world coordinates with the camera baked into the transform.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = colour.floor
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(1, 0, 0, 1, -offX, -offY)

      // Floor grid. Faint, and the only thing on screen that is decoration.
      ctx.strokeStyle = colour.grid
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      for (let x = Math.max(1, Math.floor(camX)); x < Math.min(w, camX + viewW + 1); x++) {
        ctx.moveTo(x * u, 0)
        ctx.lineTo(x * u, h * u)
      }
      for (let y = Math.max(1, Math.floor(camY)); y < Math.min(h, camY + viewH + 1); y++) {
        ctx.moveTo(0, y * u)
        ctx.lineTo(w * u, y * u)
      }
      ctx.stroke()
      ctx.globalAlpha = 1

      // Walls. Each slab is a prepared tile rather than a path built per cell
      // per frame — the art can carry detail this way, and blitting 500 images
      // is cheaper than pathing 500 outlines and cracks.
      // Damage reads structurally: unbroken, fractured with a bitten corner,
      // then holed with the reinforcement showing. Never by tint alone.
      const px = Math.max(8, Math.round(u))
      if (!tiles || tilesPx !== px) {
        tiles = makeWallTiles(colour, px)
        tilesPx = px
      }

      // Cull to the camera. The arena is 960 cells and most of them are off
      // screen at this zoom; drawing them all was fine at 32x20 and is waste now.
      const x0 = Math.max(0, Math.floor(camX) - 1)
      const x1 = Math.min(w - 1, Math.ceil(camX + viewW) + 1)
      const y0 = Math.max(0, Math.floor(camY) - 1)
      const y1 = Math.min(h - 1, Math.ceil(camY + viewH) + 1)
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const i = gy * w + gx
          const hp = walls[i]
          if (!hp) continue
          const border = gx === 0 || gy === 0 || gx === w - 1 || gy === h - 1
          let art = tiles.border
          if (!border) {
            // Which cut of this damage state, chosen off the cell so a given
            // slab keeps the same face for as long as it stands.
            const cuts = tiles.states[Math.min(2, Math.max(0, 3 - hp))]
            art = cuts[(gx * 31 + gy * 17) % cuts.length]
          }
          ctx.drawImage(art, gx * u, gy * u, u, u)
        }
      }

      // Pickups: glyph on the floor, one per kind.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${Math.round(u * 0.8)}px ui-sans-serif, system-ui, sans-serif`
      for (const [i, kind] of Object.entries(powerups)) {
        const cx = ((Number(i) % w) + 0.5) * u
        const cy = (Math.floor(Number(i) / w) + 0.5) * u
        ctx.strokeStyle = colour.flare
        ctx.lineWidth = Math.max(1, u * 0.06)
        ctx.strokeRect(cx - u * 0.42, cy - u * 0.42, u * 0.84, u * 0.84)
        ctx.fillStyle = colour.flare
        ctx.fillText(POWERUP[kind]?.glyph ?? '?', cx, cy + u * 0.04)
      }

      const tintOf = new Map(
        a.players.map((q, i) => [q.id, colour.players[i % colour.players.length]]),
      )
      const iconOf = new Map(a.players.map((q, i) => [q.id, PIECE_ICON[i % PIECE_ICON.length]]))

      // Where a bomb is about to go off, whether or not you can see the bomb.
      // The band is the blast footprint, so the question it answers is the one
      // that matters: am I standing in it. It darkens as the fuse runs down.
      for (const bomb of a.bombs ?? []) {
        const urgency = a.bombFuse ? 1 - bomb.in / a.bombFuse : 1
        ctx.globalAlpha = 0.1 + urgency * 0.28
        ctx.fillStyle = colour.warn
        if (bomb.axis === 'x') ctx.fillRect(0, bomb.y * u, w * u, u)
        else ctx.fillRect(bomb.x * u, 0, u, h * u)
        ctx.globalAlpha = 1
      }

      // Bombs. The bar through the middle shows which way it will go off, and
      // the ring closing in is the fuse — both shapes, so neither depends on
      // being able to pick the colour out.
      for (const bomb of a.bombs ?? []) {
        const bx = (bomb.x + 0.5) * u
        const by = (bomb.y + 0.5) * u
        const left = a.bombFuse ? bomb.in / a.bombFuse : 1
        ctx.fillStyle = colour.edge
        ctx.fillRect(bx - u * 0.4, by - u * 0.4, u * 0.8, u * 0.8)
        ctx.strokeStyle = colour.warn
        ctx.lineWidth = Math.max(1, u * 0.1)
        ctx.beginPath()
        if (bomb.axis === 'x') {
          ctx.moveTo(bx - u * 0.42, by)
          ctx.lineTo(bx + u * 0.42, by)
        } else {
          ctx.moveTo(bx, by - u * 0.42)
          ctx.lineTo(bx, by + u * 0.42)
        }
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(bx, by, u * (0.15 + 0.4 * left), 0, Math.PI * 2)
        ctx.stroke()
      }

      // Bullets. A pierced round is drawn as a longer streak, so it is told
      // apart by shape rather than by colour alone.
      const byId = (arr) => new Map(arr.map((e) => [e.id, e]))
      const bulletsB = byId(b.bullets)
      for (const from of a.bullets) {
        const to = bulletsB.get(from.id)
        const x = (to ? lerp(from.x, to.x, t) : from.x) * u
        const y = (to ? lerp(from.y, to.y, t) : from.y) * u
        ctx.fillStyle = colour.fg
        if (from.p) {
          ctx.fillRect(x - u * 0.3, y - u * 0.07, u * 0.6, u * 0.14)
        } else {
          ctx.beginPath()
          ctx.arc(x, y, u * 0.11, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Players.
      const playersB = byId(b.players)
      const drawnAt = new Map()
      a.players.forEach((from, slot) => {
        if (!from.alive) return
        const to = playersB.get(from.id)
        const x = (to && to.alive ? lerp(from.x, to.x, t) : from.x) * u
        const y = (to && to.alive ? lerp(from.y, to.y, t) : from.y) * u
        const aim = to && to.alive ? from.aim + (to.aim - from.aim) * t : from.aim
        const isMe = from.id === myIdRef.current
        const r = u * (isMe ? 0.4 : 0.34)
        const tint = tintOf.get(from.id)

        if (isMe) {
          // A halo under your own piece. In a crowd of eight the one question
          // that has to answer itself instantly is which of these is me.
          ctx.globalAlpha = 0.16
          ctx.fillStyle = colour.flare
          ctx.beginPath()
          ctx.arc(x, y, r * 2.6, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }

        // Barrel, drawn first so the body sits on top of its root.
        ctx.strokeStyle = tint
        ctx.lineWidth = from.overcharged ? u * 0.22 : u * 0.13
        ctx.beginPath()
        ctx.moveTo(x, y)
        const reach = from.sword ? r * 3.2 : from.shotgun ? r * 1.5 : r * 2
        ctx.lineTo(x + Math.cos(aim) * reach, y + Math.sin(aim) * reach)
        ctx.stroke()
        if (from.shotgun) {
          // A stubby crossbar, so a loaded shotgun is legible from the shape
          // of the piece rather than from a colour or a HUD line.
          const bx = x + Math.cos(aim) * reach
          const by = y + Math.sin(aim) * reach
          ctx.beginPath()
          ctx.moveTo(
            bx + Math.cos(aim + Math.PI / 2) * r * 0.7,
            by + Math.sin(aim + Math.PI / 2) * r * 0.7,
          )
          ctx.lineTo(
            bx + Math.cos(aim - Math.PI / 2) * r * 0.7,
            by + Math.sin(aim - Math.PI / 2) * r * 0.7,
          )
          ctx.stroke()
        }

        ctx.fillStyle = tint
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()

        if (from.shielded) {
          ctx.strokeStyle = colour.fg
          ctx.lineWidth = Math.max(1, u * 0.08)
          ctx.beginPath()
          ctx.arc(x, y, r * 1.45, 0, Math.PI * 2)
          ctx.stroke()
        }

        if (from.deathless) {
          // Nothing touches this one, and everyone else should be able to see
          // that before they waste a magazine finding out.
          ctx.strokeStyle = colour.warn
          ctx.lineWidth = Math.max(1, u * 0.07)
          for (const ring of [1.7, 1.95]) {
            ctx.beginPath()
            ctx.arc(x, y, r * ring, 0, Math.PI * 2)
            ctx.stroke()
          }
        }

        ctx.font = `${Math.round(r * 1.5)}px ${ICON_FONT}`
        ctx.fillText(iconOf.get(from.id), x, y + r * 0.06)

        // Health as pips above the head: countable, not a colour gradient.
        // Overheal adds pips beyond the normal run and stacks them double
        // height, so a buffered player is legible by shape alone.
        const hpMax = a.hpMax ?? 3
        const slots = Math.max(hpMax, from.hp)
        const pip = u * 0.16
        const py = y - r - pip * 1.6
        const px0 = x - (slots * pip * 1.35) / 2
        for (let i = 0; i < slots; i++) {
          const filled = i < from.hp
          const over = i >= hpMax
          const px = px0 + i * pip * 1.35
          ctx.fillStyle = filled ? (over ? colour.fg : tint) : colour.grid
          ctx.fillRect(px, py, pip, pip * 0.5)
          if (filled && over) ctx.fillRect(px, py - pip * 0.45, pip, pip * 0.35)
        }

        drawnAt.set(from.id, { x, y })
        if (isMe) {
          drawnRef.current = { x: x - offX, y: y - offY }
          // A caret above the pips: visible even when the halo is lost against
          // a bright floor, and it points at exactly one piece.
          const cy0 = py - pip * 1.4
          ctx.fillStyle = colour.flare
          ctx.beginPath()
          ctx.moveTo(x, cy0)
          ctx.lineTo(x - u * 0.17, cy0 - u * 0.24)
          ctx.lineTo(x + u * 0.17, cy0 - u * 0.24)
          ctx.closePath()
          ctx.fill()
          const ring = r * 1.9
          const left = from.dashIn ?? 0
          ctx.lineWidth = Math.max(1, u * 0.07)
          if (left > 0) {
            // Recharging: an open track that fills clockwise. The ring closing
            // up IS the tell that the dash is back, so it reads without having
            // to look away from the fight.
            ctx.strokeStyle = colour.grid
            ctx.beginPath()
            ctx.arc(x, y, ring, 0, Math.PI * 2)
            ctx.stroke()
            ctx.strokeStyle = colour.flare
            ctx.beginPath()
            ctx.arc(
              x,
              y,
              ring,
              -Math.PI / 2,
              -Math.PI / 2 + (1 - left / (a.dashMax || 1)) * Math.PI * 2,
            )
            ctx.stroke()
          } else {
            ctx.strokeStyle = colour.flare
            ctx.beginPath()
            ctx.arc(x, y, ring, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      })

      // Combat feedback. Drawn against the interpolated positions rather than
      // the raw event coordinates, so a flash sits on the player it belongs to
      // instead of 100 ms ahead of them.
      const nowMs = performance.now()
      fxRef.current = fxRef.current.filter((f) => nowMs - f.at < FX_MS[f.k])
      for (const f of fxRef.current) {
        const age = (nowMs - f.at) / FX_MS[f.k]
        ctx.globalAlpha = 1 - age

        if (f.k === 'flash') {
          const at = drawnAt.get(f.of)
          if (!at) continue
          ctx.strokeStyle = colour.fg
          ctx.lineWidth = Math.max(1, u * 0.12)
          ctx.beginPath()
          ctx.arc(at.x, at.y, u * (0.4 + age * 0.5), 0, Math.PI * 2)
          ctx.stroke()
        } else if (f.k === 'mark') {
          // Confirmation that your round landed. An absorbed hit is a ring and
          // a real one is a cross, so the two are told apart by shape.
          const x = f.x * u
          const y = f.y * u
          const r = u * (0.3 + age * 0.35)
          ctx.strokeStyle = colour.flare
          ctx.lineWidth = Math.max(1, u * 0.1)
          ctx.beginPath()
          if (f.dmg === 0) {
            ctx.arc(x, y, r, 0, Math.PI * 2)
          } else {
            ctx.moveTo(x - r, y - r)
            ctx.lineTo(x + r, y + r)
            ctx.moveTo(x + r, y - r)
            ctx.lineTo(x - r, y + r)
          }
          ctx.stroke()
        } else if (f.k === 'swing') {
          ctx.strokeStyle = colour.fg
          ctx.lineWidth = Math.max(2, u * 0.16)
          ctx.beginPath()
          ctx.arc(f.x * u, f.y * u, f.r * u * (0.8 + age * 0.3), f.aim - f.arc, f.aim + f.arc)
          ctx.stroke()
        } else if (f.k === 'blast') {
          ctx.fillStyle = colour.warn
          const thick = u * (0.9 + age * 1.6)
          if (f.axis === 'x') {
            ctx.fillRect(0, (f.line + 0.5) * u - thick / 2, w * u, thick)
          } else {
            ctx.fillRect((f.line + 0.5) * u - thick / 2, 0, thick, h * u)
          }
        } else if (f.k === 'dmg') {
          // Which way it came from. A wedge, not a tint, so it survives being
          // colour-blind and being in the corner of your eye.
          const me = drawnRef.current
          if (!me) continue
          const dir = Math.atan2(f.y * u - me.y, f.x * u - me.x)
          ctx.strokeStyle = colour.warn
          ctx.lineWidth = Math.max(2, u * 0.22)
          ctx.beginPath()
          ctx.arc(me.x, me.y, u * (2.1 + age * 0.6), dir - 0.42, dir + 0.42)
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1

      // Anything off the edge of the view still gets a marker pinned to that
      // edge, so the camera never hides a threat — it only moves it.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const pad = u * 0.6
      const offscreen = (wx, wy) => {
        const sx = wx * u - offX
        const sy = wy * u - offY
        if (sx >= 0 && sy >= 0 && sx <= canvas.width && sy <= canvas.height) return null
        const mx = clamp(sx, pad, canvas.width - pad)
        const my = clamp(sy, pad, canvas.height - pad)
        return { mx, my, angle: Math.atan2(sy - my, sx - mx) }
      }

      const pointer = (mx, my, angle, r) => {
        ctx.beginPath()
        ctx.moveTo(mx + Math.cos(angle) * r * 1.6, my + Math.sin(angle) * r * 1.6)
        ctx.lineTo(mx + Math.cos(angle + 2.5) * r * 0.9, my + Math.sin(angle + 2.5) * r * 0.9)
        ctx.lineTo(mx + Math.cos(angle - 2.5) * r * 0.9, my + Math.sin(angle - 2.5) * r * 0.9)
        ctx.closePath()
        ctx.fill()
      }

      for (const bomb of a.bombs ?? []) {
        const at = offscreen(bomb.x + 0.5, bomb.y + 0.5)
        if (!at) continue
        const left = a.bombFuse ? bomb.in / a.bombFuse : 1
        const r = u * 0.34
        ctx.fillStyle = colour.warn
        pointer(at.mx, at.my, at.angle, r)
        ctx.fillStyle = colour.edge
        ctx.fillRect(at.mx - r, at.my - r, r * 2, r * 2)
        ctx.strokeStyle = colour.warn
        ctx.lineWidth = Math.max(1, u * 0.09)
        ctx.strokeRect(at.mx - r, at.my - r, r * 2, r * 2)
        ctx.beginPath()
        ctx.arc(at.mx, at.my, r * (0.3 + 0.8 * left), 0, Math.PI * 2)
        ctx.stroke()
      }

      for (const q of a.players) {
        if (!q.alive || q.id === myIdRef.current) continue
        const at = offscreen(q.x, q.y)
        if (!at) continue
        const r = u * 0.3
        const tint = tintOf.get(q.id)
        ctx.fillStyle = tint
        pointer(at.mx, at.my, at.angle, r)
        ctx.beginPath()
        ctx.arc(at.mx, at.my, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.font = `${Math.round(r * 1.3)}px ${ICON_FONT}`
        ctx.fillText(iconOf.get(q.id), at.mx, at.my + r * 0.06)
      }

      // Minimap. The whole arena at a glance, plus the rectangle showing what
      // the camera is currently looking at.
      const mmW = canvas.width * MINIMAP_FRACTION
      const mmH = (mmW * h) / w
      const mmX = canvas.width - mmW - pad
      const mmY = pad
      const ms = mmW / w

      // Anyone alive behind the minimap — you included — fades it down, because
      // a corner of the arena you cannot see is worse than a map you cannot
      // read. It eases back up the moment the corner is clear.
      const nearMap = u * 1.2
      const behindMap = a.players.some((q) => {
        if (!q.alive) return false
        const sx = q.x * u - offX
        const sy = q.y * u - offY
        return (
          sx > mmX - nearMap &&
          sx < mmX + mmW + nearMap &&
          sy > mmY - nearMap &&
          sy < mmY + mmH + nearMap
        )
      })
      mmAlphaRef.current += ((behindMap ? 0.25 : 1) - mmAlphaRef.current) * 0.18
      const mmA = mmAlphaRef.current

      ctx.globalAlpha = mmA * 0.85
      ctx.fillStyle = colour.floor
      ctx.fillRect(mmX, mmY, mmW, mmH)
      ctx.globalAlpha = mmA
      ctx.fillStyle = colour.wall
      for (let i = 0; i < walls.length; i++) {
        if (!walls[i]) continue
        ctx.fillRect(mmX + (i % w) * ms, mmY + Math.floor(i / w) * ms, ms, ms)
      }
      // Pickups, as diamonds so they are not mistaken for a player's dot.
      ctx.fillStyle = colour.flare
      for (const key of Object.keys(powerups)) {
        const i = Number(key)
        const px2 = mmX + ((i % w) + 0.5) * ms
        const py2 = mmY + (Math.floor(i / w) + 0.5) * ms
        const d = ms * 1.6
        ctx.beginPath()
        ctx.moveTo(px2, py2 - d)
        ctx.lineTo(px2 + d, py2)
        ctx.lineTo(px2, py2 + d)
        ctx.lineTo(px2 - d, py2)
        ctx.closePath()
        ctx.fill()
      }

      ctx.fillStyle = colour.warn
      for (const bomb of a.bombs ?? []) {
        ctx.fillRect(mmX + bomb.x * ms - ms * 0.5, mmY + bomb.y * ms - ms * 0.5, ms * 2, ms * 2)
      }
      for (const q of a.players) {
        if (!q.alive) continue
        const mine = q.id === myIdRef.current
        ctx.fillStyle = tintOf.get(q.id)
        ctx.beginPath()
        ctx.arc(mmX + q.x * ms, mmY + q.y * ms, ms * (mine ? 1.5 : 1.1), 0, Math.PI * 2)
        ctx.fill()
        if (mine) {
          // Your own dot carries a ring, so you are never hunting for yourself.
          ctx.strokeStyle = colour.fg
          ctx.lineWidth = Math.max(1, ms * 0.5)
          ctx.stroke()
        }
      }
      ctx.strokeStyle = colour.flare
      ctx.lineWidth = Math.max(1, ms * 0.5)
      ctx.strokeRect(mmX + camX * ms, mmY + camY * ms, viewW * ms, viewH * ms)
      ctx.strokeStyle = colour.line
      ctx.lineWidth = 1
      ctx.strokeRect(mmX + 0.5, mmY + 0.5, mmW, mmH)
      ctx.globalAlpha = 1

      // An arena nobody is standing in looks identical to a dead renderer, so
      // say which one it is on the arena itself rather than only in the HUD.
      if (a.phase !== 'playing') {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        const text =
          a.phase === 'over' ? `${a.winner} takes the match` : 'Waiting for another player'
        ctx.fillStyle = colour.floor
        ctx.globalAlpha = 0.85
        ctx.fillRect(0, canvas.height / 2 - u * 1.5, canvas.width, u * 3)
        ctx.globalAlpha = 1
        ctx.strokeStyle = colour.flare
        ctx.lineWidth = Math.max(1, u * 0.06)
        ctx.beginPath()
        ctx.moveTo(0, canvas.height / 2 - u * 1.5)
        ctx.lineTo(canvas.width, canvas.height / 2 - u * 1.5)
        ctx.moveTo(0, canvas.height / 2 + u * 1.5)
        ctx.lineTo(canvas.width, canvas.height / 2 + u * 1.5)
        ctx.stroke()
        ctx.fillStyle = colour.fg
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `bold ${Math.round(u * 0.85)}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 - u * 0.3)
        ctx.fillStyle = colour.muted
        ctx.font = `${Math.round(u * 0.55)}px ui-sans-serif, system-ui, sans-serif`
        ctx.fillText(
          a.phase === 'over'
            ? `Next match in ${a.secs}`
            : 'The match starts the moment someone else drops in',
          canvas.width / 2,
          canvas.height / 2 + u * 0.85,
        )
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [status])

  // ---------- Popup ad ----------
  useEffect(() => {
    const left = hud?.players.find((p) => p.id === myId)?.adIn ?? 0
    if (left > 0 && adWasRef.current === 0) {
      setAd({
        closed: false,
        which: Math.floor(Math.random() * ADS.length),
        // Somewhere new each time, kept inside the arena so it is always
        // fully closeable.
        left: 2 + Math.random() * 50,
        top: 2 + Math.random() * 46,
      })
    }
    adWasRef.current = left
  }, [hud, myId])

  // ---------- Victory ----------
  useEffect(() => {
    if (!won) {
      setParty([])
      return
    }
    // Built once when the win lands, never per frame: regenerating this at
    // 30 Hz would restart every animation before it finished.
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

  // ---------- Pointer ----------
  const onPointerMove = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scale = canvas.width / rect.width
    pointerRef.current = {
      x: (e.clientX - rect.left) * scale,
      y: (e.clientY - rect.top) * scale,
    }
  }, [])

  // ---------- Name entry ----------
  if (status === 'idle' || status === 'full') {
    return (
      <section className="blueprint mx-auto max-w-xl px-5 py-20">
        <p className="rule-label">Fracture Line</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">Browser trial</h1>
        <p className="mt-5 leading-relaxed text-muted">
          The arena from above. Every wall in here takes damage and comes down; the map knits its
          own back together, but anything you build is yours to hold. Take what the floor gives you
          — rounds that punch through cover, a blade, a line charge — and put twelve operators down
          before anyone does the same to you. Short of a full arena, the roster fills itself.
        </p>
        {status === 'full' && (
          <p className="mt-5 border-l-2 border-warn pl-4 text-sm text-warn">
            Every slot on this server is taken. Try again in a moment.
          </p>
        )}
        <form
          className="mt-8 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            connect(name)
          }}
        >
          <label htmlFor="operator-name" className="sr-only">
            Operator name
          </label>
          <input
            id="operator-name"
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
            Deploy
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
            connect(name)
          }}
          className="mt-8 border border-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-flare transition-colors hover:bg-flare hover:text-on-flare"
        >
          Reconnect
        </button>
      </section>
    )
  }

  // ---------- Arena ----------
  const me = hud ? hud.players.find((p) => p.id === myId) : null
  const held = me && me.held ? POWERUP[me.held] : null
  const slotOf = new Map((hud?.players ?? []).map((p, i) => [p.id, i]))
  const board = hud
    ? [...hud.players].sort((x, y) => y.kills - x.kills || x.name.localeCompare(y.name))
    : []
  // Snapshots arrive at 30 Hz, so this re-evaluates constantly and old entries
  // fall off on their own without a timer to own.
  const recent = feed.filter((f) => performance.now() - f.at < FEED_MS)
  // Newest first, and only as many as the fixed box holds. Anything older
  // falls off rather than growing the column.
  const feedLines = recent.slice(-4).reverse()
  const adLeft = me?.adIn ?? 0
  const adShown = (hud?.adMax ?? 0) - adLeft
  const adCanClose = adShown >= AD_CLOSE_DELAY_MS
  const adCloseIn = Math.max(1, Math.ceil((AD_CLOSE_DELAY_MS - adShown) / 1000))
  const dashLeft = me?.dashIn ?? 0
  const dashPct = hud?.dashMax ? 1 - dashLeft / hud.dashMax : 1

  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="display text-3xl">Fracture Line</h1>
          <span className="rule-label">top-down trial</span>
          {hud?.arena && <span className="rule-label">{hud.arena}</span>}
        </div>
        <Link
          to="/games/fracture-line"
          className="text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
        >
          About the game →
        </Link>
      </div>

      <p aria-live="polite" className="mt-3 border-l-2 border-flare pl-4 text-sm text-muted">
        {statusLine(hud, myId)}
      </p>
      <p aria-live="assertive" className="sr-only">
        {adLeft > 0 && !ad.closed ? 'An advertisement is covering the arena.' : ''}
      </p>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_14rem]">
        <div className="relative">
          <canvas
            ref={canvasRef}
            onPointerMove={onPointerMove}
            onPointerDown={(e) => {
              e.preventDefault()
              if (e.button === 2) send({ t: 'build' })
              else fireRef.current = true
            }}
            onPointerUp={() => {
              fireRef.current = false
            }}
            onPointerLeave={() => {
              fireRef.current = false
            }}
            onContextMenu={(e) => e.preventDefault()}
            role="img"
            aria-label={`Fracture Line arena, ${hud?.w ?? 32} by ${hud?.h ?? 20} cells. ${statusLine(hud, myId)}`}
            className="w-full touch-none border border-line bg-bg"
          />

          {adLeft > 0 && !ad.closed && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                style={{ left: `${ad.left}%`, top: `${ad.top}%` }}
                className="pointer-events-auto absolute w-[min(26rem,90%)] border border-line bg-surface shadow-2xl"
              >
                <div className="flex items-center justify-between border-b border-line bg-bg px-3 py-2">
                  <span className="text-[0.625rem] uppercase tracking-[0.16em] text-muted">
                    Advertisement
                  </span>
                  <button
                    type="button"
                    onClick={() => setAd((a) => ({ ...a, closed: true }))}
                    disabled={!adCanClose}
                    className="min-w-16 border border-line px-2 py-1 text-[0.625rem] uppercase tracking-[0.12em] text-muted transition-colors enabled:hover:border-flare enabled:hover:text-flare disabled:opacity-40"
                  >
                    {adCanClose ? '\u2715 Close' : `${adCloseIn}\u2026`}
                  </button>
                </div>
                <div className="blueprint flex items-center gap-4 p-5">
                  <BlockArt
                    variant={ADS[ad.which].art.variant}
                    seed={ADS[ad.which].art.seed}
                    className="hidden h-24 w-24 shrink-0 sm:block"
                  />
                  <div className="min-w-0">
                    <p className="rule-label">Also from RivalBlocks</p>
                    <p className="display mt-1 text-2xl">{ADS[ad.which].title}</p>
                    <p className="mt-1 text-sm text-flare">{ADS[ad.which].tagline}</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{ADS[ad.which].genre}</p>
                    <span className="mt-3 inline-block bg-flare px-4 py-2 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-on-flare">
                      Play free now
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 grid gap-px border border-line bg-line sm:grid-cols-4">
            <div className="bg-bg p-3">
              <p className="rule-label">Health</p>
              <div
                className="mt-2 flex items-end gap-1"
                aria-label={`${me?.hp ?? 0} of ${hud?.hpMax ?? 3} health`}
              >
                {Array.from({ length: Math.max(hud?.hpMax ?? 3, me?.hp ?? 0) }, (_, i) => {
                  const filled = i < (me?.hp ?? 0)
                  const over = i >= (hud?.hpMax ?? 3)
                  return (
                    <span
                      key={i}
                      aria-hidden="true"
                      className={`flex-1 border ${over ? 'h-5' : 'h-3'} ${
                        filled
                          ? over
                            ? 'border-fg bg-fg'
                            : 'border-flare bg-flare'
                          : 'border-line'
                      }`}
                    />
                  )
                })}
              </div>
              {me?.alive === false && <p className="mt-1.5 text-xs text-muted">Down.</p>}
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">{me?.bomb ? 'Bomb charges' : 'Block charges'}</p>
              <div className="mt-2 flex gap-1.5" aria-label={`${me?.charges ?? 0} of 4 charges`}>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`h-3 flex-1 border border-line ${i < (me?.charges ?? 0) ? 'bg-flare' : ''}`}
                  />
                ))}
              </div>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Dash</p>
              <div className="mt-2 h-3 border border-line" aria-hidden="true">
                <div
                  className="h-full bg-flare"
                  style={{ width: `${Math.round(dashPct * 100)}%` }}
                />
              </div>
              <p aria-live="polite" className="mt-1.5 text-xs text-muted">
                {dashLeft > 0 ? `Recharging — ${(dashLeft / 1000).toFixed(1)}s` : 'Ready — shift'}
              </p>
            </div>

            <div className="bg-bg p-3">
              <p className="rule-label">Carrying</p>
              {held ? (
                <button
                  type="button"
                  onClick={() => send({ t: 'use' })}
                  className="mt-2 flex w-full items-center gap-2 border border-flare px-2.5 py-1.5 text-left text-sm text-flare transition-colors hover:bg-flare hover:text-on-flare"
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    {held.glyph}
                  </span>
                  <span className="truncate font-bold uppercase tracking-[0.08em]">
                    {held.label}
                  </span>
                  <span className="ml-auto text-[0.6875rem] tracking-[0.16em]">E</span>
                </button>
              ) : (
                <p className="mt-2 py-1.5 text-sm text-muted">Empty-handed.</p>
              )}
              <p aria-live="polite" className="mt-1.5 truncate text-xs text-live">
                {[
                  me?.deathless && '★ Untouchable',
                  me?.shielded && '◈ Shielded',
                  me?.overcharged && '✶ Overcharged',
                  me?.sword && '† Sword',
                  me?.bomb && '◎ Bombs',
                  me?.rapid && '≡ Rapid',
                  me?.shotgun && 'Ψ Shotgun',
                  me?.sprinting && '» Sprinting',
                ]
                  .filter(Boolean)
                  .join(' · ') || '\u00a0'}
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
                  {f.self ? '✖' : '▸'}
                </span>
                <span className="sr-only">{f.self ? 'eliminated themselves' : 'eliminated'}</span>
                <span className="text-muted">{f.self ? 'self' : f.of}</span>
              </li>
            ))}
            {feedLines.length === 0 && <li className="text-muted">Nothing yet.</li>}
          </ul>

          <div className="flex items-baseline justify-between">
            <p className="rule-label">Scoreboard</p>
            <p className="rule-label">K / D</p>
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
                <span className={`truncate ${p.alive ? '' : 'text-muted'}`}>{p.name}</span>
                {p.bot && <span className="rule-label shrink-0">bot</span>}
                {p.id === myId && <span className="rule-label shrink-0">you</span>}
                <span className="ml-auto font-mono text-xs tabular-nums">
                  {p.kills} / {p.deaths}
                  <span className="sr-only"> kills, deaths</span>
                </span>
              </li>
            ))}
            {board.length === 0 && <li className="text-sm text-muted">Nobody yet.</li>}
          </ul>

          <p className="rule-label mt-8">Controls</p>
          <dl className="mt-2 space-y-1.5 text-sm text-muted">
            <div className="flex justify-between gap-3">
              <dt>Move</dt>
              <dd className="font-mono text-xs">WASD</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Aim</dt>
              <dd className="font-mono text-xs">mouse</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{me?.sword ? 'Swing' : 'Fire'}</dt>
              <dd className="font-mono text-xs">hold click / space</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Dash</dt>
              <dd className="font-mono text-xs">shift</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{me?.bomb ? 'Lay bomb' : 'Build wall'}</dt>
              <dd className="font-mono text-xs">Q / right-click</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Use pickup</dt>
              <dd className="font-mono text-xs">E</dd>
            </div>
          </dl>
        </div>
      </div>

      {won && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
          >
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
                {me?.kills} eliminations · next match in {hud?.secs}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
