import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import BannerAd from '../components/BannerAd.jsx'
import Leaderboard from '../components/Leaderboard.jsx'
import { boardFor } from '../../server/board.js'
import { makeBuffer } from '../lib/snapshotBuffer.js'
import { useTitle } from '../lib/useTitle.js'
import { useFavicon } from '../lib/useFavicon.js'
import { makeCutlineScene } from '../lib/cutlineScene.js'
import {
  makeRaceCamera,
  stepCamera,
  nextView,
  isView,
  DEFAULT_VIEW,
  CAR_ROOF,
  VIEW_CELLS,
} from '../lib/raceCamera.js'
import { wallBlocks, holeFaces } from '../lib/wallBlocks.js'
import { carLift, drawnHeading } from '../lib/carLift.js'
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
  S_HOLE,
  SURFACE_CHARS,
  decodeMap,
  CAR_LENGTH,
  TOP_SPEED,
  BOOST_MULT,
  SLIP_BOOST,
} from '../../server/cutline.js'

const CANVAS = 768
const TILE_RES = 32
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
 * Paint the circuit once to an offscreen canvas, `tileRes` pixels a tile.
 *
 * The track never changes during a race, so this is painted once per circuit and
 * used twice: as the 3D scene's ground texture and as the minimap.
 */
function prerender(map, tileRes = TILE_RES) {
  const off = document.createElement('canvas')
  off.width = GRID * tileRes
  off.height = GRID * tileRes
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

  const T = tileRes

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const surface = map[y * GRID + x]
      if (surface === S_WALL) continue

      // A hole is left clear: the 3D ground is cut out there so its pit shows
      // through, and on the minimap it reads as a gap in the road.
      if (surface === S_HOLE) {
        g.clearRect(x * T, y * T, T, T)
        continue
      }

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

const ITEM_NAMES = {
  boost: 'BOOST',
  slick: 'OIL',
  banana: 'BANANA',
  shield: 'SHIELD',
  spring: 'SPRING',
  shock: 'SHOCK',
  puck: 'PUCK',
  ghost: 'GHOST',
  decoy: 'DECOY',
}

function itemLabel(item) {
  return ITEM_NAMES[item] ?? 'EMPTY'
}

/**
 * An item's icon, drawn in code like every other pixel the game shows, centred
 * on (cx, cy) in a box `s` across. Each has its own shape, so none relies on
 * colour to be told apart.
 */
function drawItemIcon(ctx, item, cx, cy, s) {
  const h = s / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(2, s * 0.09)
  if (item === 'boost') {
    // Two chevrons, pointing forward.
    ctx.strokeStyle = '#f97316'
    for (const dx of [-h * 0.35, h * 0.2]) {
      ctx.beginPath()
      ctx.moveTo(dx - h * 0.25, -h * 0.55)
      ctx.lineTo(dx + h * 0.25, 0)
      ctx.lineTo(dx - h * 0.25, h * 0.55)
      ctx.stroke()
    }
  } else if (item === 'slick') {
    // A drop of oil.
    ctx.fillStyle = '#1e1e26'
    ctx.strokeStyle = '#38bdf8'
    ctx.beginPath()
    ctx.moveTo(0, -h * 0.75)
    ctx.bezierCurveTo(h * 0.7, -h * 0.05, h * 0.55, h * 0.7, 0, h * 0.7)
    ctx.bezierCurveTo(-h * 0.55, h * 0.7, -h * 0.7, -h * 0.05, 0, -h * 0.75)
    ctx.fill()
    ctx.stroke()
  } else if (item === 'banana') {
    // A crescent with a stalk.
    ctx.fillStyle = '#facc15'
    ctx.beginPath()
    ctx.arc(0, -h * 0.25, h * 0.7, Math.PI * 0.15, Math.PI * 0.85)
    ctx.arc(0, h * 0.05, h * 0.62, Math.PI * 0.85, Math.PI * 0.15, true)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#713f12'
    ctx.beginPath()
    ctx.moveTo(-h * 0.6, h * 0.05)
    ctx.lineTo(-h * 0.78, -h * 0.25)
    ctx.stroke()
  } else if (item === 'shield') {
    // A shield outline with a bar across it.
    ctx.strokeStyle = '#3ad1c4'
    ctx.fillStyle = 'rgba(58, 209, 196, 0.2)'
    ctx.beginPath()
    ctx.moveTo(0, -h * 0.75)
    ctx.lineTo(h * 0.6, -h * 0.5)
    ctx.lineTo(h * 0.5, h * 0.2)
    ctx.lineTo(0, h * 0.75)
    ctx.lineTo(-h * 0.5, h * 0.2)
    ctx.lineTo(-h * 0.6, -h * 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (item === 'spring') {
    // A coil with an arrow up.
    ctx.strokeStyle = '#a3e635'
    ctx.beginPath()
    ctx.moveTo(-h * 0.45, h * 0.7)
    for (let i = 0; i < 4; i++) ctx.lineTo(i % 2 ? -h * 0.45 : h * 0.45, h * 0.45 - i * h * 0.3)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, -h * 0.25)
    ctx.lineTo(0, -h * 0.8)
    ctx.moveTo(-h * 0.25, -h * 0.55)
    ctx.lineTo(0, -h * 0.8)
    ctx.lineTo(h * 0.25, -h * 0.55)
    ctx.stroke()
  } else if (item === 'shock') {
    // A lightning bolt.
    ctx.fillStyle = '#facc15'
    ctx.beginPath()
    ctx.moveTo(h * 0.15, -h * 0.8)
    ctx.lineTo(-h * 0.45, h * 0.1)
    ctx.lineTo(-h * 0.02, h * 0.1)
    ctx.lineTo(-h * 0.2, h * 0.8)
    ctx.lineTo(h * 0.45, -h * 0.15)
    ctx.lineTo(h * 0.02, -h * 0.15)
    ctx.closePath()
    ctx.fill()
  } else if (item === 'puck') {
    // A disc with speed lines behind it.
    ctx.fillStyle = '#f97316'
    ctx.beginPath()
    ctx.arc(h * 0.25, 0, h * 0.42, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#f97316'
    for (const dy of [-h * 0.3, 0, h * 0.3]) {
      ctx.beginPath()
      ctx.moveTo(-h * 0.8, dy)
      ctx.lineTo(-h * 0.35, dy)
      ctx.stroke()
    }
  } else if (item === 'ghost') {
    // A sheet with a wavy hem and two eyes.
    ctx.fillStyle = 'rgba(236, 235, 230, 0.85)'
    ctx.beginPath()
    ctx.arc(0, -h * 0.2, h * 0.5, Math.PI, 0)
    ctx.lineTo(h * 0.5, h * 0.7)
    for (let i = 0; i < 4; i++) ctx.lineTo(h * 0.5 - (i + 0.5) * h * 0.25, i % 2 ? h * 0.7 : h * 0.45)
    ctx.lineTo(-h * 0.5, h * 0.7)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#16161a'
    for (const dx of [-h * 0.2, h * 0.2]) {
      ctx.beginPath()
      ctx.arc(dx, -h * 0.2, h * 0.09, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (item === 'decoy') {
    // An item box stood on its corner, with a question mark.
    ctx.strokeStyle = '#3ad1c4'
    ctx.beginPath()
    ctx.moveTo(0, -h * 0.8)
    ctx.lineTo(h * 0.8, 0)
    ctx.lineTo(0, h * 0.8)
    ctx.lineTo(-h * 0.8, 0)
    ctx.closePath()
    ctx.stroke()
    ctx.fillStyle = '#3ad1c4'
    ctx.font = `bold ${Math.round(s * 0.45)}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('?', 0, h * 0.05)
  } else {
    // An empty slot.
    ctx.strokeStyle = '#4b4b52'
    ctx.setLineDash([4, 4])
    ctx.strokeRect(-h * 0.6, -h * 0.6, h * 1.2, h * 1.2)
  }
  ctx.restore()
}

// The speedometer reads in km/h, ten to a tile a second, and its dial runs to
// the fastest a car can go: boosted and in a slipstream.
const KMH_PER_TILE = 10
const SPEEDO_MAX = TOP_SPEED * BOOST_MULT * SLIP_BOOST
const HUD_PAD = 14

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(11, 11, 15, 0.8)'
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 6)
    ctx.fill()
  } else {
    ctx.fillRect(x, y, w, h)
  }
}

/**
 * The driver's HUD, drawn into the game rather than under it, so place, lap,
 * item and speed are read without looking away from the road. Every value is
 * text; colour only decorates it.
 */
function drawHud(ctx, { me, total, lap, laps, leader, shownSpeed }) {
  ctx.save()
  ctx.textBaseline = 'alphabetic'

  // Top left: place, lap, leader.
  panel(ctx, HUD_PAD, HUD_PAD, 196, 92)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#ecebe6'
  ctx.font = 'bold 34px monospace'
  const place = me.place != null ? `P${me.place}` : 'P-'
  ctx.fillText(place, HUD_PAD + 12, HUD_PAD + 40)
  const placeW = ctx.measureText(place).width
  ctx.fillStyle = '#8f8d86'
  ctx.font = 'bold 16px monospace'
  ctx.fillText(`/${total}`, HUD_PAD + 14 + placeW, HUD_PAD + 40)
  ctx.fillStyle = '#ecebe6'
  ctx.font = 'bold 16px monospace'
  ctx.fillText(`LAP ${Math.min(lap + 1, laps)}/${laps}`, HUD_PAD + 12, HUD_PAD + 64)
  ctx.fillStyle = '#8f8d86'
  ctx.font = '11px monospace'
  const lead = leader ? leader.name : '-'
  ctx.fillText(`LEADER ${lead.length > 16 ? lead.slice(0, 15) + '.' : lead}`, HUD_PAD + 12, HUD_PAD + 82)

  // Bottom left: the item slot, as its icon and its name.
  const itemY = CANVAS - HUD_PAD - 72
  panel(ctx, HUD_PAD, itemY, 196, 72)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.fillRect(HUD_PAD + 8, itemY + 8, 56, 56)
  drawItemIcon(ctx, me.item, HUD_PAD + 36, itemY + 36, 44)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#8f8d86'
  ctx.font = '10px monospace'
  ctx.fillText('ITEM  SPACE', HUD_PAD + 76, itemY + 26)
  ctx.fillStyle = me.item ? '#ecebe6' : '#8f8d86'
  ctx.font = 'bold 20px monospace'
  ctx.fillText(itemLabel(me.item), HUD_PAD + 76, itemY + 52)

  // Bottom right: the speedometer.
  const r = 62
  const cx = CANVAS - HUD_PAD - r - 8
  const cy = CANVAS - HUD_PAD - r - 8
  ctx.fillStyle = 'rgba(11, 11, 15, 0.8)'
  ctx.beginPath()
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2)
  ctx.fill()
  const start = Math.PI * 0.75
  const sweep = Math.PI * 1.5
  const frac = Math.max(0, Math.min(1, shownSpeed / SPEEDO_MAX))
  ctx.lineCap = 'round'
  ctx.lineWidth = 7
  ctx.strokeStyle = '#2b2b31'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 4, start, start + sweep)
  ctx.stroke()
  ctx.strokeStyle = me.boosting ? '#f97316' : '#3ad1c4'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 4, start, start + sweep * Math.max(0.001, frac))
  ctx.stroke()
  // A tick where plain top speed sits, so boost and slipstream read as extra.
  const topAt = start + sweep * (TOP_SPEED / SPEEDO_MAX)
  ctx.strokeStyle = '#ecebe6'
  ctx.lineWidth = 2
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(cx + Math.cos(topAt) * (r - 12), cy + Math.sin(topAt) * (r - 12))
  ctx.lineTo(cx + Math.cos(topAt) * (r + 3), cy + Math.sin(topAt) * (r + 3))
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ecebe6'
  ctx.font = 'bold 30px monospace'
  ctx.fillText(String(Math.round(shownSpeed * KMH_PER_TILE)), cx, cy + 8)
  ctx.fillStyle = '#8f8d86'
  ctx.font = '10px monospace'
  ctx.fillText('KM/H', cx, cy + 24)
  const tag = me.boosting ? 'BOOST' : me.drafting ? 'DRAFT' : ''
  if (tag) {
    ctx.fillStyle = me.boosting ? '#f97316' : '#3ad1c4'
    ctx.font = 'bold 10px monospace'
    ctx.fillText(tag, cx, cy + 42)
  }
  ctx.restore()
}

/** Driving against the course. Words first; the colour only backs them up. */
function drawWrongWay(ctx, now) {
  ctx.save()
  const pulse = 0.75 + 0.25 * Math.sin(now / 160)
  const y = CANVAS * 0.22
  ctx.fillStyle = `rgba(11, 11, 15, ${0.85 * pulse})`
  ctx.fillRect(CANVAS / 2 - 170, y - 34, 340, 68)
  ctx.strokeStyle = '#eab308'
  ctx.lineWidth = 2
  ctx.strokeRect(CANVAS / 2 - 170, y - 34, 340, 68)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#eab308'
  ctx.font = 'bold 30px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('WRONG WAY', CANVAS / 2, y - 6)
  ctx.fillStyle = '#ecebe6'
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('Turn around', CANVAS / 2, y + 20)
  ctx.restore()
}

const VIEW_KEY = 'cutline.view'
const VIEW_LABEL = { top: 'Top-down', chase: 'Chase', bumper: 'Bumper' }

function loadView() {
  // localStorage can throw in a private window or with storage blocked.
  try {
    const v = window.localStorage.getItem(VIEW_KEY)
    return isView(v) ? v : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
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
  // The WebGL canvas draws the world; the overlay canvas above it draws the HUD,
  // labels and minimap. Both fill `stageRef`, so they cannot drift apart.
  const stageRef = useRef(null)
  const glRef = useRef(null)
  const overlayRef = useRef(null)
  const sceneRef = useRef(null)
  const [webglFailed, setWebglFailed] = useState(false)
  const camRef = useRef(makeRaceCamera())
  // State for the button label, mirrored into a ref for the render loop, which
  // runs outside React and must see a change on its very next frame.
  const [view, setView] = useState(loadView)
  const viewRef = useRef(view)
  viewRef.current = view
  const cycleView = useCallback(() => {
    setView((v) => {
      const next = nextView(v)
      try {
        window.localStorage.setItem(VIEW_KEY, next)
      } catch {
        // Not remembered, but the view still changes.
      }
      return next
    })
  }, [])
  const lastFrameRef = useRef(0)
  // The speed the dial shows, eased toward the snapshot's so the needle glides.
  const shownSpeedRef = useRef(0)
  // A circuit arrives in `welcome`, possibly before the scene exists, so it is
  // held here and built by the render loop when the versions disagree.
  const gridRef = useRef(null)
  const rampsRef = useRef([])
  const trackVersionRef = useRef(0)
  const builtVersionRef = useRef(-1)
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
        gridRef.current = decode(msg.circuit?.map ?? '')
        rampsRef.current = Array.isArray(msg.circuit?.ramps) ? msg.circuit.ramps : []
        trackVersionRef.current += 1
        // A restart puts every car back on a new grid: place the camera there
        // outright rather than swooping across the old circuit to find it, and
        // drop skid marks that belong to the old track.
        camRef.current = makeRaceCamera()
        skidsRef.current = []
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
      // C cycles the view. Not on key repeat, or holding it spins through every
      // view, and not with a modifier, so copying text leaves the view alone.
      // Steering is untouched: it is relative to the car in every view.
      if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) cycleView()
        return
      }
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
  }, [cycleView])

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

  // --- Scene lifecycle ------------------------------------------------------
  // One scene per live connection, sized to its container. Disposing it on the
  // way out releases the WebGL context as well as GPU memory; browsers cap live
  // contexts, so a context kept per visit would eventually be killed for us.
  useEffect(() => {
    if (status !== 'live' || !glRef.current || !stageRef.current) return
    let scene
    try {
      scene = makeCutlineScene(glRef.current)
    } catch {
      setWebglFailed(true)
      return
    }
    sceneRef.current = scene
    builtVersionRef.current = -1 // a new scene has no circuit yet

    const stage = stageRef.current
    const fit = () => scene.resize(stage.clientWidth, stage.clientHeight)
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(stage)

    return () => {
      watch.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [status])

  // --- Render loop ----------------------------------------------------------
  useEffect(() => {
    if (status !== 'live') return

    let rafId
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const frame = () => {
      const now = performance.now()
      // Your own car is interpolated like everyone else's, never drawn at the
      // newest snapshot. Snapshots land unevenly (measured on Windows: 46 Hz,
      // gaps of 16 or 30 ms), so the newest one froze the car on 67 of 165
      // frames and then jumped it double. In 2D the world stepped with it and
      // hid that; behind a chase camera it reads as the car stuttering.
      // Interpolated: no frozen frames, for 60 ms of delay. Blockout 3D exempts
      // its player because its camera is steered by the mouse; this one is not.
      const sampled = bufRef.current.sample(now)
      const scene = sceneRef.current

      if (scene && gridRef.current && builtVersionRef.current !== trackVersionRef.current) {
        // 32 pixels a tile is 3072 square, 36 MB. WebGL2 only guarantees 2048,
        // so a GPU that cannot take it gets 16 pixels a tile and looks softer
        // rather than failing to draw.
        const tileRes = scene.maxTextureSize >= GRID * TILE_RES ? TILE_RES : TILE_RES / 2
        const ground = prerender(gridRef.current, tileRes)
        trackCanvasRef.current = ground // the minimap draws from the same canvas
        scene.setTrack(ground, wallBlocks(gridRef.current, GRID, S_WALL), rampsRef.current, holeFaces(gridRef.current, GRID, S_HOLE))
        builtVersionRef.current = trackVersionRef.current
      }
      const track = trackCanvasRef.current

      // Cleared, not filled: the 3D view shows through wherever the overlay
      // draws nothing.
      ctx.clearRect(0, 0, CANVAS, CANVAS)

      if (!sampled) {
        // Background only, for the moment before the first snapshot lands.
        scene?.update({ now, pose: null })
        rafId = requestAnimationFrame(frame)
        return
      }

      // The buffer blends whichever array it was given the key for, so this is
      // the interpolated list, not the raw newest frame.
      // A car on a pad jump is drawn, and followed, turning toward the stretch it
      // will land on, rather than snapping round on touchdown.
      const cars = (sampled.cars ?? []).map((c) => (Number.isFinite(c.land) ? { ...c, heading: drawnHeading(c) } : c))
      const palette = resolvePalette()

      // --- 1. The car the camera follows -----------------------------------
      const me = cars.find((c) => c.id === myIdRef.current)
      const aliveCars = cars.filter((c) => c.alive)
      // `cars` arrives in join order, not running order, so the first entry is
      // whoever joined first. The leader is the car the server placed first.
      const leaderCar = cars.find((c) => c.place === 1) ?? aliveCars[0] ?? cars[0]
      const focusCar = me && me.alive ? me : leaderCar

      const focusX = focusCar ? focusCar.x : GRID / 2
      const focusY = focusCar ? focusCar.y : GRID / 2
      const focusHeading = focusCar ? focusCar.heading : -Math.PI / 2

      // Overlay pixels per tile at the top-down zoom, the scale of its margins.
      const u = CANVAS / VIEW_CELLS

      // --- 2. Skid marks. Kept here, drawn by the scene ----------------------
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

      // --- 3. The 3D view ----------------------------------------------------
      // Frame time for smoothing. stepCamera clamps a long one, so a tab coming
      // back from the background does not overshoot.
      const dt = (now - (lastFrameRef.current || now)) / 1000
      lastFrameRef.current = now
      const view = viewRef.current
      // The bumper eye rides the car up ramps and over jumps.
      const followed = focusCar && { ...focusCar, lift: carLift(focusCar, rampsRef.current) }
      const pose = stepCamera(camRef.current, view, followed, dt, CAR_LENGTH / 2)
      scene?.update({
        cars,
        hazards: sampled.hazards ?? [],
        pickups: sampled.pickups ?? [],
        skids: skidsRef.current,
        palette,
        now,
        pose,
        // The car the camera rides on is hidden in the bumper view, where it
        // would fill the screen. That is the leader's car while spectating.
        hideId: view === 'bumper' ? focusCar?.id : null,
      })

      // --- 4. A label over every car -----------------------------------------
      // Status is never carried by colour alone. The 2D view drew the place on
      // each roof and showed boosting, drafting and the rest as effects; here
      // they are words, upright over each car whatever the camera is doing.
      // Placed by projection, never by WebGL pixel sizes, so they stay on their
      // cars at any page width.
      if (scene) {
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (const c of cars) {
          if (view === 'bumper' && c.id === focusCar?.id) continue
          const at = scene.project(c.x, c.y, CAR_ROOF + 0.25)
          if (!at.visible) continue
          const x = at.fx * CANVAS
          const y = at.fy * CANVAS

          ctx.fillStyle = 'rgba(11, 11, 13, 0.8)'
          ctx.fillRect(x - 14, y - 16, 28, 14)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 12px monospace'
          ctx.fillText(String(c.place ?? c.slot + 1), x, y - 9)

          const tags = [
            c.boosting && 'BOOST',
            c.drafting && 'DRAFT',
            c.sliding && 'SLIDE',
            c.spinning && 'SPIN',
            c.airborne && 'AIR',
            c.shield && 'SHIELD',
            c.ghost && 'GHOST',
            c.shocked && 'SHOCK',
            c.falling && 'FELL',
            !c.alive && 'OUT',
          ].filter(Boolean)
          if (tags.length) {
            const text = tags.join(' ')
            ctx.font = 'bold 9px monospace'
            const w = ctx.measureText(text).width + 6
            ctx.fillStyle = 'rgba(11, 11, 13, 0.8)'
            ctx.fillRect(x - w / 2, y, w, 12)
            ctx.fillStyle = '#ffffff'
            ctx.fillText(text, x, y + 6)
          }

          // Your own car carries YOU above its label. In top-down, height barely
          // moves a point on screen, so this is offset in pixels from the label
          // rather than projected from a greater height, which would overlap it.
          if (c.id === myIdRef.current && c.alive) {
            const bob = Math.sin(now / 150) * 2.5
            const indicatorY = y - 25 + bob

            ctx.fillStyle = '#3ad1c4'
            ctx.beginPath()
            ctx.moveTo(x, indicatorY + 5)
            ctx.lineTo(x - 5, indicatorY - 2)
            ctx.lineTo(x + 5, indicatorY - 2)
            ctx.closePath()
            ctx.fill()

            ctx.fillStyle = 'rgba(11, 11, 13, 0.85)'
            ctx.fillRect(x - 14, indicatorY - 15, 28, 12)
            ctx.strokeStyle = '#3ad1c4'
            ctx.lineWidth = 1
            ctx.strokeRect(x - 14, indicatorY - 15, 28, 12)

            ctx.fillStyle = '#3ad1c4'
            ctx.font = 'bold 8px monospace'
            ctx.fillText('YOU', x, indicatorY - 9)
          }
        }
        ctx.restore()
      }

      // --- 5. Top-Right Minimap (Circuit Radar) ------------------------------
      const pad = 14
      const mmW = Math.round(CANVAS * MINIMAP_FRACTION)
      const mmH = mmW
      const mmX = CANVAS - mmW - pad
      const mmY = pad

      // Dynamic fade when any car is under the minimap in screen space
      const nearMap = u * 1.5
      const behindMap = cars.some((c) => {
        if (!c.alive || !scene) return false
        const at = scene.project(c.x, c.y, CAR_ROOF)
        if (!at.visible) return false
        const sx = at.fx * CANVAS
        const sy = at.fy * CANVAS
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

      // --- 5b. Driver HUD and the wrong-way warning ----------------------------
      if (me) {
        shownSpeedRef.current += ((me.speed ?? 0) - shownSpeedRef.current) * (1 - Math.exp(-12 * Math.min(dt, 0.1)))
        drawHud(ctx, {
          me,
          total: cars.length,
          lap: sampled.lap ?? 0,
          laps: sampled.laps ?? 0,
          leader: leaderCar,
          shownSpeed: shownSpeedRef.current,
        })
        if (me.wrongWay && sampled.phase === 'racing') drawWrongWay(ctx, now)
      }

      // --- 6. Non-Racing Overlay Banners ------------------------------------
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
          <div
            ref={stageRef}
            className="relative w-full max-w-[768px] aspect-square border border-line bg-bg"
          >
            <canvas
              ref={glRef}
              role="img"
              aria-label={`Cutline circuit. ${statusLine(hud, myId)}`}
              className="absolute inset-0 block h-full w-full select-none"
            />
            {/* Keeps its 768 by 768 drawing buffer, so the minimap and banners
                are drawn in the same coordinates they always were. */}
            <canvas
              ref={overlayRef}
              width={CANVAS}
              height={CANVAS}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 block h-full w-full"
            />
            {webglFailed && (
              <div className="absolute inset-0 flex items-center justify-center bg-bg p-8 text-center">
                <p className="leading-relaxed text-muted">
                  This race needs WebGL, and this browser has it turned off or
                  does not support it.
                </p>
              </div>
            )}
            {/* On the game, not under it, so it is in reach when the view fills
                the screen. The overlay canvas passes clicks through to it. */}
            <button
              type="button"
              onClick={cycleView}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 border border-line bg-bg/80 px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-fg transition-colors hover:border-flare hover:text-flare"
            >
              View: {VIEW_LABEL[view]} (C)
            </button>
          </div>

          {/* The HUD is drawn into the game; this is the same reading for a
              screen reader, which cannot see the canvas. */}
          <p className="sr-only">
            {me?.place != null ? `Place ${me.place} of ${cars.length}. ` : ''}
            {hud ? `Lap ${Math.min(hud.lap + 1, hud.laps)} of ${hud.laps}. ` : ''}
            {`Item: ${itemLabel(me?.item)}. `}
            {leaderCar ? `Leader: ${leaderCar.name}.` : ''}
          </p>

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
                    {car.airborne && isAlive && (
                      <span className="text-[0.625rem] text-warn font-mono uppercase tracking-wider">
                        Air ◬
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
        </div>
      </div>

      <BannerAd className="mt-12" />
    </section>
  )
}
