// The Blockout Royale 3D scene. No React, no rules, no sockets: it is handed a
// view and it paints it.
//
// No image files anywhere in this project, and that survives three.js intact —
// BoxGeometry, flat materials and two lights. Nothing here loads anything.

import * as THREE from 'three'
import { tileRole, tileShade } from './tileTint.js'

const SOLID = '.'
const WARN = '!'

// Read the hand-written `:root` custom properties directly, never the
// `--color-*` Tailwind aliases. Tailwind v4's `@theme inline` substitutes
// those into utility classes rather than emitting them as real custom
// properties, so `getComputedStyle` returns '' for a `--color-*` read and
// this falls back silently — see CLAUDE.md. `src/pages/Play.jsx` and
// `Blastworks.jsx` read the same raw names for the same reason.
const token = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export const FLOOR_GAP = 3.4 // world units between floors
const TILE = 1
const WARN_DROP = 0.18 // how far a flagged tile sinks
// The mirror of WARN_DROP, not a separate number picked independently: a
// foreseen tile has to read as the opposite of a warned one on the same
// axis, structurally, not by colour (WCAG 1.4.1) — it is still `solid` in
// `view.tiles`, just marked to be taken by the wave the server already chose.
const SOON_RISE = WARN_DROP
// A third structural signal, alongside the two above: a plated tile grows
// visibly thicker rather than changing colour, so armour reads without
// depending on a hue (WCAG 1.4.1). A tile can be both plated and warned —
// the plate still absorbs the wave that is coming for it, so it keeps BOTH
// signals at once: sunk like any warned tile, but visibly thicker than one
// that is not plated, which is what tells a defended warning apart from an
// undefended one.
const PLATE_SCALE_Y = 1.9

// Billboard glyphs. Same convention as every other game here (`PIECE_ICON` in
// Play.jsx, Blastworks.jsx, Fracture.jsx): one emoji per slot, so a player is
// told apart without colour (WCAG 1.4.1) exactly as every sibling piece's
// initial does. Drawn once into an offscreen canvas per icon, never per frame.
const PIECE_ICON = ['🦊', '🐺', '🐙', '🦈', '🐝', '🐸', '🦅', '🐧']
const ICON_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'

function makeIconTexture(glyph) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.font = `52px ${ICON_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(glyph, 32, 34)
  return new THREE.CanvasTexture(c)
}

export const POWERUP_THEMES = {
  shield:    { core: '#38bdf8', ring: '#0284c7', label: 'SHIELD',    glyph: '◈' },
  dash:      { core: '#facc15', ring: '#eab308', label: 'DASH',      glyph: '»' },
  sinkhole:  { core: '#c084fc', ring: '#9333ea', label: 'SINKHOLE',  glyph: '◍' },
  patch:     { core: '#4ade80', ring: '#16a34a', label: 'PATCH',     glyph: '✚' },
  blink:     { core: '#f472b6', ring: '#db2777', label: 'BLINK',     glyph: '↷' },
  swap:      { core: '#fb923c', ring: '#ea580c', label: 'SWAP',      glyph: '⇄' },
  foresight: { core: '#22d3ee', ring: '#0891b2', label: 'FORESIGHT', glyph: '◎' },
  shove:     { core: '#f87171', ring: '#dc2626', label: 'SHOVE',     glyph: '↦' },
  hover:     { core: '#a5b4fc', ring: '#6366f1', label: 'HOVER',     glyph: '⇧' },
  bridge:    { core: '#fcd34d', ring: '#d97706', label: 'BRIDGE',    glyph: '▬' },
  anchor:    { core: '#94a3b8', ring: '#475569', label: 'ANCHOR',    glyph: '⚓' },
  lift:      { core: '#34d399', ring: '#059669', label: 'LIFT',      glyph: '⇑' },
}

function drawHex(g, x, y, r) {
  g.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3
    const hx = x + r * Math.cos(a)
    const hy = y + r * Math.sin(a)
    if (i === 0) g.moveTo(hx, hy)
    else g.lineTo(hx, hy)
  }
  g.closePath()
  g.stroke()
}

/** Procedural sci-fi power core texture with circuit traces and reactor coils */
function makeCoreTexture() {
  const size = 256
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')

  // Base metallic crystal gradient
  const grad = g.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.45, '#d4dbe8')
  grad.addColorStop(1, '#828d9f')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)

  // Hexagonal honeycomb cyber-mesh
  g.strokeStyle = 'rgba(38, 44, 56, 0.4)'
  g.lineWidth = 2
  const r = 24
  const h = r * Math.sqrt(3)
  for (let y = -h; y < size + h; y += h) {
    for (let x = -r * 3; x < size + r * 3; x += r * 3) {
      drawHex(g, x, y, r)
      drawHex(g, x + r * 1.5, y + h / 2, r)
    }
  }

  // Energy circuit routing
  g.strokeStyle = '#ffffff'
  g.lineWidth = 3.5
  g.beginPath()
  g.moveTo(size / 2, 16)
  g.lineTo(size / 2, 72)
  g.lineTo(size / 2 + 32, 104)
  g.lineTo(size - 18, 104)

  g.moveTo(size / 2, size - 16)
  g.lineTo(size / 2, size - 72)
  g.lineTo(size / 2 - 32, size - 104)
  g.lineTo(18, size - 104)

  g.moveTo(16, size / 2)
  g.lineTo(72, size / 2)
  g.lineTo(104, size / 2 - 32)
  g.lineTo(104, 18)

  g.moveTo(size - 16, size / 2)
  g.lineTo(size - 72, size / 2)
  g.lineTo(size - 104, size / 2 + 32)
  g.lineTo(size - 104, size - 18)
  g.stroke()

  // Node terminals
  g.fillStyle = '#ffffff'
  for (const [nx, ny] of [
    [size / 2, 72],
    [size / 2, size - 72],
    [72, size / 2],
    [size - 72, size / 2],
  ]) {
    g.beginPath()
    g.arc(nx, ny, 6, 0, Math.PI * 2)
    g.fill()
  }

  // Central plasma reactor aperture
  const cx = size / 2
  const cy = size / 2
  g.fillStyle = '#181c24'
  g.beginPath()
  g.arc(cx, cy, 40, 0, Math.PI * 2)
  g.fill()

  g.strokeStyle = '#ffffff'
  g.lineWidth = 4
  g.beginPath()
  g.arc(cx, cy, 33, 0, Math.PI * 2)
  g.stroke()

  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(cx, cy, 18, 0, Math.PI * 2)
  g.fill()

  return new THREE.CanvasTexture(c)
}

function drawBadgeFrame(g, size) {
  const pad = 6
  const cut = 14
  g.beginPath()
  g.moveTo(pad + cut, pad)
  g.lineTo(size - pad - cut, pad)
  g.lineTo(size - pad, pad + cut)
  g.lineTo(size - pad, size - pad - cut)
  g.lineTo(size - pad - cut, size - pad)
  g.lineTo(pad + cut, size - pad)
  g.lineTo(pad, size - pad - cut)
  g.lineTo(pad, pad + cut)
  g.closePath()
}

function drawTechCorners(g, size) {
  const p = 6
  const l = 10
  g.beginPath()
  g.moveTo(p, p + l); g.lineTo(p, p); g.lineTo(p + l, p)
  g.moveTo(size - p - l, p); g.lineTo(size - p, p); g.lineTo(size - p, p + l)
  g.moveTo(size - p, size - p - l); g.lineTo(size - p, size - p); g.lineTo(size - p - l, size - p)
  g.moveTo(p + l, size - p); g.lineTo(p, size - p); g.lineTo(p, size - p - l)
  g.stroke()
}

function drawKindIcon(g, kind, cx, cy, theme) {
  switch (kind) {
    case 'shield': {
      g.fillStyle = theme.core
      g.beginPath()
      g.moveTo(cx, cy - 22)
      g.lineTo(cx + 19, cy - 14)
      g.quadraticCurveTo(cx + 19, cy + 9, cx, cy + 24)
      g.quadraticCurveTo(cx - 19, cy + 9, cx - 19, cy - 14)
      g.closePath()
      g.fill()
      g.strokeStyle = '#ffffff'
      g.lineWidth = 2.5
      g.stroke()

      g.fillStyle = '#0f172a'
      g.beginPath()
      g.moveTo(cx, cy - 12)
      g.lineTo(cx + 10, cy - 7)
      g.quadraticCurveTo(cx + 10, cy + 5, cx, cy + 15)
      g.quadraticCurveTo(cx - 10, cy + 5, cx - 10, cy - 7)
      g.closePath()
      g.fill()

      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(cx, cy + 2, 4, 0, Math.PI * 2)
      g.fill()
      break
    }
    case 'dash': {
      g.strokeStyle = '#ffffff'
      g.lineWidth = 4.5
      g.lineCap = 'round'
      g.lineJoin = 'round'
      for (const ox of [-14, 0, 14]) {
        g.beginPath()
        g.moveTo(cx + ox - 8, cy - 15)
        g.lineTo(cx + ox + 6, cy)
        g.lineTo(cx + ox - 8, cy + 15)
        g.stroke()
      }
      break
    }
    case 'sinkhole': {
      g.fillStyle = '#1e1035'
      g.beginPath()
      g.arc(cx, cy, 23, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = theme.core
      g.lineWidth = 2.5
      g.beginPath()
      g.arc(cx, cy, 19, 0, Math.PI * 1.6)
      g.stroke()
      g.beginPath()
      g.arc(cx, cy, 12, Math.PI * 0.8, Math.PI * 2.4)
      g.stroke()
      g.beginPath()
      g.arc(cx, cy, 5, 0, Math.PI * 1.5)
      g.stroke()

      g.strokeStyle = '#ffffff'
      g.lineWidth = 2
      for (let a = 0; a < 4; a++) {
        const ang = (a * Math.PI) / 2
        g.beginPath()
        g.moveTo(cx + Math.cos(ang) * 19, cy + Math.sin(ang) * 19)
        g.lineTo(cx + Math.cos(ang) * 26, cy + Math.sin(ang) * 26)
        g.stroke()
      }
      break
    }
    case 'patch': {
      g.strokeStyle = 'rgba(255, 255, 255, 0.35)'
      g.lineWidth = 1
      g.strokeRect(cx - 21, cy - 21, 42, 42)
      g.beginPath()
      g.moveTo(cx - 7, cy - 21); g.lineTo(cx - 7, cy + 21)
      g.moveTo(cx + 7, cy - 21); g.lineTo(cx + 7, cy + 21)
      g.moveTo(cx - 21, cy - 7); g.lineTo(cx + 21, cy - 7)
      g.moveTo(cx - 21, cy + 7); g.lineTo(cx + 21, cy + 7)
      g.stroke()

      g.fillStyle = '#ffffff'
      g.fillRect(cx - 6, cy - 19, 12, 38)
      g.fillRect(cx - 19, cy - 6, 38, 12)
      g.fillStyle = theme.core
      g.fillRect(cx - 3.5, cy - 3.5, 7, 7)
      break
    }
    case 'blink': {
      g.fillStyle = theme.ring
      g.beginPath()
      g.arc(cx - 15, cy + 11, 5.5, 0, Math.PI * 2)
      g.fill()

      g.strokeStyle = '#ffffff'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(cx - 15, cy + 11)
      g.quadraticCurveTo(cx - 2, cy - 24, cx + 13, cy - 8)
      g.stroke()

      const dX = cx + 13
      const dY = cy - 8
      g.fillStyle = theme.core
      g.beginPath()
      g.moveTo(dX, dY - 14)
      g.lineTo(dX + 4, dY - 4)
      g.lineTo(dX + 14, dY)
      g.lineTo(dX + 4, dY + 4)
      g.lineTo(dX, dY + 14)
      g.lineTo(dX - 4, dY + 4)
      g.lineTo(dX - 14, dY)
      g.lineTo(dX - 4, dY - 4)
      g.closePath()
      g.fill()
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(dX, dY, 3, 0, Math.PI * 2)
      g.fill()
      break
    }
    case 'swap': {
      g.lineWidth = 3
      g.strokeStyle = theme.core
      g.beginPath()
      g.arc(cx, cy, 17, -Math.PI * 0.85, -Math.PI * 0.1)
      g.stroke()
      g.fillStyle = theme.core
      g.beginPath()
      g.moveTo(cx + 16, cy - 3)
      g.lineTo(cx + 9, cy - 13)
      g.lineTo(cx + 5, cy - 2)
      g.closePath()
      g.fill()

      g.strokeStyle = '#ffffff'
      g.beginPath()
      g.arc(cx, cy, 17, Math.PI * 0.15, Math.PI * 0.9)
      g.stroke()
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.moveTo(cx - 16, cy + 3)
      g.lineTo(cx - 9, cy + 13)
      g.lineTo(cx - 5, cy + 2)
      g.closePath()
      g.fill()
      break
    }
    case 'foresight': {
      g.strokeStyle = '#ffffff'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(cx - 23, cy)
      g.quadraticCurveTo(cx, cy - 18, cx + 23, cy)
      g.quadraticCurveTo(cx, cy + 18, cx - 23, cy)
      g.stroke()

      g.fillStyle = theme.core
      g.beginPath()
      g.arc(cx, cy, 9.5, 0, Math.PI * 2)
      g.fill()

      g.fillStyle = '#0f172a'
      g.beginPath()
      g.arc(cx, cy, 4.5, 0, Math.PI * 2)
      g.fill()

      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(cx - 2, cy - 2, 2.5, 0, Math.PI * 2)
      g.fill()
      break
    }
    case 'shove': {
      g.fillStyle = '#ffffff'
      g.fillRect(cx - 17, cy - 9, 15, 18)
      g.beginPath()
      g.moveTo(cx - 2, cy - 11)
      g.lineTo(cx + 6, cy)
      g.lineTo(cx - 2, cy + 11)
      g.closePath()
      g.fill()

      g.strokeStyle = theme.core
      g.lineWidth = 3
      g.beginPath()
      g.arc(cx + 4, cy, 11, -Math.PI * 0.35, Math.PI * 0.35)
      g.stroke()
      g.beginPath()
      g.arc(cx + 4, cy, 18, -Math.PI * 0.35, Math.PI * 0.35)
      g.stroke()
      break
    }
    case 'hover': {
      g.fillStyle = '#ffffff'
      g.fillRect(cx - 15, cy - 10, 30, 13)
      g.fillRect(cx - 13, cy + 3, 7, 5)
      g.fillRect(cx + 6, cy + 3, 7, 5)

      g.fillStyle = theme.core
      g.beginPath()
      g.moveTo(cx - 13, cy + 8); g.lineTo(cx - 9.5, cy + 19); g.lineTo(cx - 6, cy + 8); g.closePath()
      g.fill()
      g.beginPath()
      g.moveTo(cx + 6, cy + 8); g.lineTo(cx + 9.5, cy + 19); g.lineTo(cx + 13, cy + 8); g.closePath()
      g.fill()

      g.strokeStyle = '#ffffff'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(cx - 7, cy - 15); g.lineTo(cx, cy - 22); g.lineTo(cx + 7, cy - 15)
      g.stroke()
      break
    }
    case 'bridge': {
      g.fillStyle = theme.core
      g.fillRect(cx - 23, cy - 13, 46, 5)
      g.fillRect(cx - 23, cy + 8, 46, 5)

      g.strokeStyle = '#ffffff'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(cx - 19, cy - 13); g.lineTo(cx - 9, cy + 8)
      g.lineTo(cx + 1, cy - 13); g.lineTo(cx + 11, cy + 8)
      g.lineTo(cx + 21, cy - 13)
      g.stroke()

      g.fillStyle = '#ffffff'
      g.fillRect(cx - 21, cy - 2, 42, 4)
      break
    }
    case 'anchor': {
      g.strokeStyle = theme.core
      g.lineWidth = 3
      g.beginPath()
      g.arc(cx, cy - 17, 5, 0, Math.PI * 2)
      g.stroke()

      g.fillStyle = '#ffffff'
      g.fillRect(cx - 17, cy - 10, 34, 4)
      g.fillRect(cx - 2.5, cy - 10, 5, 27)

      g.strokeStyle = '#ffffff'
      g.lineWidth = 3.5
      g.beginPath()
      g.arc(cx, cy + 4, 15, Math.PI * 0.15, Math.PI * 0.85)
      g.stroke()
      break
    }
    case 'lift': {
      g.fillStyle = theme.core
      g.beginPath()
      g.moveTo(cx, cy - 3)
      g.lineTo(cx + 15, cy + 10)
      g.lineTo(cx + 6, cy + 10)
      g.lineTo(cx + 6, cy + 20)
      g.lineTo(cx - 6, cy + 20)
      g.lineTo(cx - 6, cy + 10)
      g.lineTo(cx - 15, cy + 10)
      g.closePath()
      g.fill()

      g.fillStyle = '#ffffff'
      g.beginPath()
      g.moveTo(cx, cy - 23)
      g.lineTo(cx + 13, cy - 10)
      g.lineTo(cx + 5, cy - 10)
      g.lineTo(cx + 5, cy - 4)
      g.lineTo(cx - 5, cy - 4)
      g.lineTo(cx - 5, cy - 10)
      g.lineTo(cx - 13, cy - 10)
      g.closePath()
      g.fill()
      break
    }
    default: {
      g.fillStyle = theme.core
      g.font = 'bold 36px monospace, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(theme.glyph, cx, cy)
    }
  }
}

/**
 * Procedural high-resolution holographic badge texture for powerup collectibles.
 * Displays glowing cyber-chassis, scanlines, distinctive icon graphic, and clear text label.
 */
function makeItemTexture(kind) {
  const theme = POWERUP_THEMES[kind] ?? POWERUP_THEMES.shield
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  const cx = size / 2
  const cy = size / 2

  // 1. Dark translucent cyber-chassis backing
  g.fillStyle = 'rgba(15, 17, 24, 0.94)'
  drawBadgeFrame(g, size)
  g.fill()

  // 2. Inner ambient theme glow
  const glow = g.createRadialGradient(cx, cy - 6, 4, cx, cy - 6, 52)
  glow.addColorStop(0, theme.core + '55')
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = glow
  g.fillRect(8, 8, size - 16, size - 16)

  // 3. Neon border and mounting corners
  g.strokeStyle = theme.core
  g.lineWidth = 3
  drawBadgeFrame(g, size)
  g.stroke()

  g.strokeStyle = theme.ring
  g.lineWidth = 5
  drawTechCorners(g, size)

  // 4. Subtle holographic scanlines
  g.fillStyle = 'rgba(255, 255, 255, 0.04)'
  for (let y = 14; y < size - 14; y += 4) {
    g.fillRect(12, y, size - 24, 1.5)
  }

  // 5. Distinct procedural icon artwork
  drawKindIcon(g, kind, cx, cy - 7, theme)

  // 6. Crisp label capsule banner at bottom
  g.fillStyle = 'rgba(10, 12, 16, 0.88)'
  g.beginPath()
  g.roundRect(14, size - 26, size - 28, 16, 4)
  g.fill()
  g.strokeStyle = theme.core
  g.lineWidth = 1
  g.stroke()

  g.fillStyle = '#ffffff'
  g.font = '900 11px monospace, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(theme.label, cx, size - 18)

  return new THREE.CanvasTexture(c)
}

/**
 * Procedural platform tile texture: combines a sci-fi modular tech deck
 * (beveled frame, recessed industrial plate, corner mounting rivets)
 * with cybernetic circuit traces and a center tech node glyph.
 * Rendered once into an offscreen canvas and tinted via instanceColor.
 */
function makeTileTexture() {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')

  // Base metallic surface
  g.fillStyle = '#cfd4dc'
  g.fillRect(0, 0, size, size)

  // Outer dark boundary rim for crisp tile separation
  g.strokeStyle = '#2d3139'
  g.lineWidth = 6
  g.strokeRect(3, 3, size - 6, size - 6)

  // Inner beveled highlight and shadow
  g.strokeStyle = '#f4f6fa'
  g.lineWidth = 2
  g.strokeRect(7, 7, size - 14, size - 14)

  g.strokeStyle = '#636975'
  g.lineWidth = 2
  g.strokeRect(9, 9, size - 18, size - 18)

  // Recessed inner plate
  g.fillStyle = '#b6bcc7'
  g.fillRect(10, 10, size - 20, size - 20)

  // Subtle interior crosshatch grid lines
  g.strokeStyle = '#a4abb8'
  g.lineWidth = 1
  for (let p = 24; p < size - 20; p += 16) {
    g.beginPath()
    g.moveTo(p, 12)
    g.lineTo(p, size - 12)
    g.stroke()
    g.beginPath()
    g.moveTo(12, p)
    g.lineTo(size - 12, p)
    g.stroke()
  }

  // Corner hex rivets / bolts (4 corners)
  const rivets = [
    [18, 18],
    [size - 18, 18],
    [18, size - 18],
    [size - 18, size - 18],
  ]
  for (const [rx, ry] of rivets) {
    // Socket ring
    g.fillStyle = '#444a56'
    g.beginPath()
    g.arc(rx, ry, 5, 0, Math.PI * 2)
    g.fill()
    // Bolt rim highlight
    g.fillStyle = '#f0f3f8'
    g.beginPath()
    g.arc(rx - 0.7, ry - 0.7, 3.2, 0, Math.PI * 2)
    g.fill()
    // Bolt center
    g.fillStyle = '#5c6370'
    g.beginPath()
    g.arc(rx, ry, 1.6, 0, Math.PI * 2)
    g.fill()
  }

  // Cybernetic circuit traces / bus routes with 45-degree angled jogs
  g.strokeStyle = '#5a6270'
  g.lineWidth = 2.5
  g.beginPath()
  // Horizontal routing
  g.moveTo(26, 42)
  g.lineTo(46, 42)
  g.lineTo(54, 50)
  g.lineTo(74, 50)
  g.lineTo(82, 42)
  g.lineTo(size - 26, 42)

  g.moveTo(26, size - 42)
  g.lineTo(46, size - 42)
  g.lineTo(54, size - 50)
  g.lineTo(74, size - 50)
  g.lineTo(82, size - 42)
  g.lineTo(size - 26, size - 42)

  // Vertical routing
  g.moveTo(42, 26)
  g.lineTo(42, 42)
  g.moveTo(size - 42, 26)
  g.lineTo(size - 42, 42)
  g.moveTo(42, size - 42)
  g.lineTo(42, size - 26)
  g.moveTo(size - 42, size - 42)
  g.lineTo(size - 42, size - 26)
  g.stroke()

  // Center tech diamond node
  const mid = size / 2
  g.fillStyle = '#828a99'
  g.beginPath()
  g.moveTo(mid, mid - 15)
  g.lineTo(mid + 15, mid)
  g.lineTo(mid, mid + 15)
  g.lineTo(mid - 15, mid)
  g.closePath()
  g.fill()

  // Node highlight ring
  g.strokeStyle = '#f2f5fa'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(mid, mid - 15)
  g.lineTo(mid + 15, mid)
  g.lineTo(mid, mid + 15)
  g.lineTo(mid - 15, mid)
  g.closePath()
  g.stroke()

  // Center aperture core
  g.fillStyle = '#3a404c'
  g.beginPath()
  g.arc(mid, mid, 4.5, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(mid - 1, mid - 1, 1.8, 0, Math.PI * 2)
  g.fill()

  const tex = new THREE.CanvasTexture(c)
  return tex
}

export function createAstronaut(slot, slotColor) {
  const group = new THREE.Group()
  const mat = new THREE.MeshLambertMaterial({ color: slotColor })
  const visorMat = new THREE.MeshLambertMaterial({ color: '#7ce8ff' })

  // Torso group contains the capsule body, visor, and oxygen pack so they animate together
  const torso = new THREE.Group()

  // Suit Body
  const bodyGeo = new THREE.CapsuleGeometry(0.24, 0.36, 8, 16)
  const body = new THREE.Mesh(bodyGeo, mat)
  body.position.y = 0.12
  torso.add(body)

  // Visor
  const visorGeo = new THREE.BoxGeometry(0.26, 0.16, 0.12)
  const visor = new THREE.Mesh(visorGeo, visorMat)
  visor.position.set(0, 0.18, 0.2)
  torso.add(visor)

  // Oxygen Tank Backpack
  const packGeo = new THREE.BoxGeometry(0.24, 0.32, 0.12)
  const pack = new THREE.Mesh(packGeo, mat)
  pack.position.set(0, 0.12, -0.2)
  torso.add(pack)

  group.add(torso)

  // Left & Right Boots (translated so pivot is at hip joint for natural leg swing)
  const bootGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.16, 8)
  bootGeo.translate(0, -0.08, 0)

  const leftBoot = new THREE.Mesh(bootGeo, mat)
  leftBoot.position.set(-0.11, -0.06, 0)
  group.add(leftBoot)

  const rightBoot = new THREE.Mesh(bootGeo, mat)
  rightBoot.position.set(0.11, -0.06, 0)
  group.add(rightBoot)

  group.userData = { torso, body, visor, pack, leftBoot, rightBoot, mat, visorMat, slot, runCycle: 0 }
  return group
}

export function makeScene(canvas, { size, floors }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(token('--bg', '#16161a'))

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400)

  // Where the camera looks when there is nobody to follow: the lobby, a
  // spectator past capacity, or after elimination. Without this the camera
  // ends up at the origin staring into the void.
  const overview = {
    target: [size / 2, (-FLOOR_GAP * (floors - 1)) / 2, size / 2],
    position: [size / 2 + size * 1.7, size * 1.7, size / 2 + size * 1.7],
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 0.9)
  key.position.set(1, 2, 1)
  scene.add(key)

  const count = size * size * floors
  const perFloor = size * size

  // One InstancedMesh per floor rather than one for the whole stack.
  // InstancedMesh has no per-instance opacity — instanceColor is RGB only — so
  // fading the floors above the player needs a material per floor. Five draw
  // calls, not one, and still not the 845 that drawing tiles individually
  // would cost.
  const tileTex = makeTileTexture()
  const tileGeo = new THREE.BoxGeometry(TILE * 0.94, 0.35, TILE * 0.94)
  const tileMats = []
  const tiles = []
  for (let z = 0; z < floors; z++) {
    const mat = new THREE.MeshLambertMaterial({
      map: tileTex,
      transparent: true,
      depthWrite: true,
    })
    const mesh = new THREE.InstancedMesh(tileGeo, mat, perFloor)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(perFloor * 3), 3)
    mesh.frustumCulled = false
    tileMats.push(mat)
    tiles.push(mesh)
    scene.add(mesh)
  }

  // A flagged tile grows a post as well as changing colour. Colour alone is not
  // a status signal anywhere in this project (WCAG 1.4.1), and in three
  // dimensions a shape change is the cheapest thing there is.
  const postGeo = new THREE.BoxGeometry(0.16, 0.9, 0.16)
  const postMat = new THREE.MeshLambertMaterial({ color: token('--warn', '#e8a33d') })
  const posts = new THREE.InstancedMesh(postGeo, postMat, count)
  posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  posts.frustumCulled = false
  scene.add(posts)

  // The same trick again for the other two states. A glyph cannot go on the
  // tile face itself: all 169 tiles of a deck share one InstancedMesh and one
  // material, so a per-tile decal would need a texture atlas and a custom
  // shader. A second instanced mesh of little marker solids costs one draw
  // call each and needs neither.
  //
  // Both are emissive, because these two states are read at a distance and
  // across the transparent decks overhead, where a Lambert surface facing away
  // from the light goes flat.

  // Foreseen: a cone pointing down at the tile that is about to go. Rotated on
  // its side in the geometry so no per-instance rotation is needed.
  const soonGeo = new THREE.ConeGeometry(0.22, 0.42, 4)
  soonGeo.rotateX(Math.PI)
  const soonMat = new THREE.MeshLambertMaterial({
    color: token('--soon', '#22d3ee'),
    emissive: token('--soon', '#22d3ee'),
    emissiveIntensity: 0.55,
  })
  const soonMarks = new THREE.InstancedMesh(soonGeo, soonMat, count)
  soonMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  soonMarks.frustumCulled = false
  scene.add(soonMarks)

  // Plated: a flat ring lying on the tile, reading as a bolted-down collar.
  const plateGeo = new THREE.TorusGeometry(0.32, 0.05, 6, 16)
  plateGeo.rotateX(Math.PI / 2)
  const plateMat = new THREE.MeshLambertMaterial({
    color: token('--plate', '#dbe4f0'),
    emissive: token('--plate', '#dbe4f0'),
    emissiveIntensity: 0.35,
  })
  const plateMarks = new THREE.InstancedMesh(plateGeo, plateMat, count)
  plateMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  plateMarks.frustumCulled = false
  scene.add(plateMarks)

  const pickCoreGeo = new THREE.IcosahedronGeometry(0.46, 0)
  const pickRingGeo = new THREE.TorusGeometry(0.68, 0.08, 8, 24)
  const coreTex = makeCoreTexture()
  const pickMat = new THREE.MeshLambertMaterial({
    map: coreTex,
    color: 0xffffff,
    emissive: 0x303030,
  })
  const ringMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0x404040,
  })
  const pickCores = new THREE.InstancedMesh(pickCoreGeo, pickMat, 64)
  const pickRings = new THREE.InstancedMesh(pickRingGeo, ringMat, 64)
  pickCores.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  pickRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  pickCores.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3)
  pickRings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3)
  pickCores.frustumCulled = false
  pickRings.frustumCulled = false
  scene.add(pickCores)
  scene.add(pickRings)

  const itemTex = new Map()
  const itemMat = new Map()
  for (const kind of Object.keys(POWERUP_THEMES)) {
    const tex = makeItemTexture(kind)
    itemTex.set(kind, tex)
    itemMat.set(kind, new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }))
  }
  const pickSprites = []

  const bodies = new Map() // playerId -> Group (astronaut)
  const labels = new Map() // playerId -> Sprite, the billboard glyph above it

  // Eight small textures, built once and reused by every player who ever
  // takes that slot — never rebuilt per player and never per frame.
  const iconTex = PIECE_ICON.map(makeIconTexture)
  const iconMat = iconTex.map((map) => new THREE.SpriteMaterial({ map, transparent: true }))

  // Jetpack flame: a warm orange glow sprite shown under hovering players
  const flameCanvas = document.createElement('canvas')
  flameCanvas.width = flameCanvas.height = 64
  const fg = flameCanvas.getContext('2d')
  const flameGrad = fg.createRadialGradient(32, 32, 2, 32, 32, 28)
  flameGrad.addColorStop(0, 'rgba(255, 200, 50, 0.9)')
  flameGrad.addColorStop(0.5, 'rgba(255, 120, 20, 0.6)')
  flameGrad.addColorStop(1, 'rgba(255, 60, 10, 0)')
  fg.fillStyle = flameGrad
  fg.fillRect(0, 0, 64, 64)
  const flameTex = new THREE.CanvasTexture(flameCanvas)
  const flameMat = new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const flames = new Map() // playerId -> Sprite

  const m4 = new THREE.Matrix4()
  const scaleM = new THREE.Matrix4()
  const rotM = new THREE.Matrix4()
  const ringTiltM = new THREE.Matrix4().makeRotationX(Math.PI / 4)
  const col = new THREE.Color()
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  // Resolved once here, not per frame: these only change on a theme flip,
  // and update() runs sixty times a second.
  const warnCol = new THREE.Color(token('--warn', '#e8a33d'))
  const soonCol = new THREE.Color(token('--soon', '#22d3ee'))
  const plateCol = new THREE.Color(token('--plate', '#dbe4f0'))

  // One per deck. `--deck-0` is `--tile`, so a stack that somehow lost the new
  // tokens still draws exactly as it did before rather than turning black.
  const deckCols = []
  for (let z = 0; z < floors; z++) {
    deckCols.push(new THREE.Color(token(`--deck-${z}`, token('--tile', '#3a3a42'))))
  }
  const roleCol = { warn: warnCol, soon: soonCol, plate: plateCol }

  // Takes a slot (0-based, the player's index in the current player list —
  // the same convention Play.jsx and Blastworks.jsx key their pieces by, and
  // what keeps this in step with the scoreboard after somebody disconnects).
  const playerColor = (slot) => token(`--player-${(slot % 8) + 1}`, '#ff6b1a')

  // The scene is built once, but the site's theme toggle can flip underneath
  // it. Re-reading on the attribute change costs nothing per frame and is
  // correct, which reading once is not — every other surface on this site
  // re-themes for free because it is driven by CSS custom properties, and a
  // canvas that ignores the toggle is the one thing on the page that visibly
  // does not.
  const retheme = () => {
    scene.background.set(token('--bg', '#16161a'))
    warnCol.set(token('--warn', '#e8a33d'))
    soonCol.set(token('--soon', '#22d3ee'))
    plateCol.set(token('--plate', '#dbe4f0'))
    for (let z = 0; z < floors; z++) {
      deckCols[z].set(token(`--deck-${z}`, token('--tile', '#3a3a42')))
    }
    postMat.color.set(token('--warn', '#e8a33d'))
    soonMat.color.set(token('--soon', '#22d3ee'))
    soonMat.emissive.set(token('--soon', '#22d3ee'))
    plateMat.color.set(token('--plate', '#dbe4f0'))
    plateMat.emissive.set(token('--plate', '#dbe4f0'))
    for (const mesh of bodies.values()) {
      mesh.userData.mat.color.set(playerColor(mesh.userData.slot ?? 0))
    }
  }
  const themeWatch = new MutationObserver(retheme)
  themeWatch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  const worldY = (z, fall = 0) => -(z + fall) * FLOOR_GAP

  return {
    resize(w, h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    },

    /**
     * Paints one frame.
     *
     * `viewZ` is the floor the local player is on. Their floor is opaque, the
     * one below is ghosted so a drop is something you can aim, and the rest are
     * faint. Without that a five-deep stack is an unreadable pile of boxes.
     *
     * `view.soon` is only non-empty for a foresight holder (the server hands
     * it out per-viewer). Empty for everyone else, so this costs nothing on
     * the common path.
     */
    update(view, { viewZ = 0, slotOf, pose } = {}) {
      // Built once per frame, not scanned per tile: the loop below runs
      // `count` (845) times a frame, and .includes() in there would be the
      // per-frame allocation this file was already fixed once for.
      const soon = new Set(view.soon ?? [])
      const reinforced = new Set(view.reinforced ?? [])
      let posted = 0
      let soonMarked = 0
      let plateMarked = 0
      for (let z = 0; z < floors; z++) {
        const mesh = tiles[z]
        for (let n = 0; n < perFloor; n++) {
          const i = z * perFloor + n // stack index, for the tile string
          const ch = view.tiles[i]
          if ((ch !== SOLID && ch !== WARN) || z > view.bottom) {
            mesh.setMatrixAt(n, hidden)
            continue
          }
          const x = n % size
          const y = Math.floor(n / size)
          const warned = ch === WARN
          const foreseen = soon.has(i)
          const plated = reinforced.has(i)

          const lift = warned ? -WARN_DROP : foreseen ? SOON_RISE : 0
          m4.makeTranslation(x + 0.5, worldY(z) + lift, y + 0.5)
          // Plated: a visibly thicker slab rather than a colour change (see
          // PLATE_SCALE_Y). Composed after the translation, so the tile scales
          // about its own centre and still lands at (x, z, y).
          if (plated) m4.multiply(scaleM.makeScale(1, PLATE_SCALE_Y, 1))
          mesh.setMatrixAt(n, m4)

          // Which state the surface wears when a tile is in several at once is
          // decided in tileTint.js, not here — see the precedence there.
          const role = tileRole({ warned, foreseen, plated })
          col.copy(roleCol[role] ?? deckCols[z])
          // Grain, so a deck is a surface rather than one flat sheet. Only on
          // plain deck tiles: a state tint is a signal and must not wobble.
          if (role === 'deck') col.multiplyScalar(tileShade(i))
          // Depth cue: floors below yours darken with distance.
          const away = Math.abs(z - viewZ)
          col.multiplyScalar(away === 0 ? 1 : Math.max(0.28, 1 - away * 0.26))
          mesh.setColorAt(n, col)

          // Markers ride above the tile, and each state gets its own regardless
          // of which one won the surface — that is what stops a plated tile
          // going unreadable the moment the wave flags it.
          if (warned && posted < count) {
            m4.makeTranslation(x + 0.5, worldY(z) + 0.5, y + 0.5)
            posts.setMatrixAt(posted++, m4)
          }
          if (foreseen && soonMarked < count) {
            m4.makeTranslation(x + 0.5, worldY(z) + lift + 0.62, y + 0.5)
            soonMarks.setMatrixAt(soonMarked++, m4)
          }
          if (plated && plateMarked < count) {
            // Sits on the raised face of the thickened slab, not inside it.
            const top = 0.18 * PLATE_SCALE_Y
            m4.makeTranslation(x + 0.5, worldY(z) + lift + top, y + 0.5)
            plateMarks.setMatrixAt(plateMarked++, m4)
          }
        }
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
      }
      for (let i = posted; i < count; i++) posts.setMatrixAt(i, hidden)
      for (let i = soonMarked; i < count; i++) soonMarks.setMatrixAt(i, hidden)
      for (let i = plateMarked; i < count; i++) plateMarks.setMatrixAt(i, hidden)
      soonMarks.instanceMatrix.needsUpdate = true
      plateMarks.instanceMatrix.needsUpdate = true
      posts.instanceMatrix.needsUpdate = true
      posts.count = count

      for (let z = 0; z < floors; z++) {
        const mat = tileMats[z]
        const above = viewZ - z // positive when this floor is above the player
        const wasClear = mat.transparent
        if (above > 0) {
          mat.transparent = true
          // Translucent, not invisible. This ramp answers two questions at
          // once, and the old one only answered the first: the camera has to
          // see the player through these floors, AND the player has to be able
          // to tell whether there is anything overhead to climb to. Bottoming
          // out at 0.06 made the floor above unreadable, which matters now
          // that a hover can carry you up into it.
          mat.opacity = Math.max(0.16, 0.42 - (above - 1) * 0.09)
          mat.depthWrite = false
          // Back to front, for a camera that sits above the player: the floor
          // furthest from it is the one nearest the player, so it draws first
          // and the topmost slab draws last. The previous order was reversed,
          // which is what makes transparent floors flicker against each other
          // as the camera turns.
          tiles[z].renderOrder = above
        } else {
          mat.transparent = false
          mat.opacity = 1
          mat.depthWrite = true
          tiles[z].renderOrder = 0
        }
        // three.js bakes `transparent` into the material's compiled program, so
        // flipping it at runtime without this leaves the material drawing under
        // the old one. Only on a change: an unconditional needsUpdate would
        // recompile five shaders every frame.
        if (mat.transparent !== wasClear) mat.needsUpdate = true
      }

      const tSec = performance.now() * 0.001
      const bob = Math.sin(tSec * 3.5) * 0.12
      const rotCore = tSec * 1.8
      const rotRing = -tSec * 2.2

      let n = 0
      for (const [key, kind] of Object.entries(view.powerups ?? {})) {
        if (n >= 64) break
        const i = Number(key)
        const z = Math.floor(i / (size * size))
        const px = (i % size) + 0.5
        const py = worldY(z) + 0.82 + bob
        const pz = (Math.floor(i / size) % size) + 0.5

        // Core translation and rotation
        m4.makeTranslation(px, py, pz)
        rotM.makeRotationY(rotCore)
        m4.multiply(rotM)
        pickCores.setMatrixAt(n, m4)

        // Orbital ring translation and counter-rotation
        m4.makeTranslation(px, py, pz)
        rotM.makeRotationY(rotRing)
        m4.multiply(ringTiltM)
        m4.multiply(rotM)
        pickRings.setMatrixAt(n, m4)

        // Distinct per-powerup colors for 3D core and orbital ring
        const theme = POWERUP_THEMES[kind] ?? POWERUP_THEMES.shield
        col.set(theme.core)
        pickCores.setColorAt(n, col)
        col.set(theme.ring)
        pickRings.setColorAt(n, col)

        // Floating holographic billboard badge
        const mat = itemMat.get(kind) ?? itemMat.get('shield')
        let spr = pickSprites[n]
        if (!spr) {
          spr = new THREE.Sprite(mat)
          spr.scale.set(0.92, 0.92, 1)
          spr.renderOrder = 21
          pickSprites.push(spr)
          scene.add(spr)
        } else {
          spr.material = mat
          spr.scale.set(0.92, 0.92, 1)
          spr.renderOrder = 21
          spr.visible = true
        }
        spr.position.set(px, py + 0.68, pz)

        n++
      }
      pickCores.count = n
      pickRings.count = n
      pickCores.renderOrder = 20
      pickRings.renderOrder = 20
      pickCores.instanceMatrix.needsUpdate = true
      pickRings.instanceMatrix.needsUpdate = true
      if (pickCores.instanceColor) pickCores.instanceColor.needsUpdate = true
      if (pickRings.instanceColor) pickRings.instanceColor.needsUpdate = true

      for (let i = n; i < pickSprites.length; i++) {
        pickSprites[i].visible = false
      }

      // Slot = index in the current player list, the same convention
      // Play.jsx and Blastworks.jsx key a piece's colour and icon by, and
      // what the scoreboard already uses. The id stays fixed across a
      // disconnect; this is rebuilt every frame precisely so it does not.
      const slots = slotOf ?? new Map(view.players.map((q, i) => [q.id, i % 8]))

      const seen = new Set()
      for (const p of view.players) {
        if (!p.playing || !p.alive) continue
        seen.add(p.id)
        const slot = (slots.get(p.id) ?? 0) % 8
        let mesh = bodies.get(p.id)
        let label = labels.get(p.id)
        if (!mesh) {
          mesh = createAstronaut(slot, playerColor(slot))
          bodies.set(p.id, mesh)
          scene.add(mesh)
          // The billboard glyph. Always faces the camera (THREE.Sprite does
          // this natively), which is what makes it readable from any angle
          // the orbit control can reach.
          label = new THREE.Sprite(iconMat[slot])
          label.scale.set(0.6, 0.6, 1)
          labels.set(p.id, label)
          scene.add(label)
        }
        // A slot only changes when the player list reorders (someone
        // joining or leaving), so this is a rare write, not a per-frame one.
        if (mesh.userData.slot !== slot) {
          mesh.userData.slot = slot
          mesh.userData.mat.color.set(playerColor(slot))
          label.material = iconMat[slot]
        }
        const jumpArc = p.jumping ? 4 * 0.85 * p.jumpProgress * (1 - p.jumpProgress) : 0
        mesh.position.set(p.x, worldY(p.z, p.fall) + 0.52 + jumpArc, p.y)
        mesh.visible = true

        // Jetpack flame effect
        let flame = flames.get(p.id)
        if (p.hovering) {
          if (!flame) {
            flame = new THREE.Sprite(flameMat)
            flame.scale.set(0.7, 0.9, 1)
            flames.set(p.id, flame)
            scene.add(flame)
          }
          const flicker = 0.7 + Math.sin(performance.now() * 0.012 + p.id) * 0.3
          flame.scale.set(0.5 + flicker * 0.3, 0.6 + flicker * 0.4, 1)
          flame.position.set(p.x, worldY(p.z, p.fall) - 0.1, p.y)
          flame.visible = true
        } else if (flame) {
          flame.visible = false
        }

        let isMoving = false
        if (mesh.userData.lastX !== undefined) {
          const dx = p.x - mesh.userData.lastX
          const dy = p.y - mesh.userData.lastY
          if (dx * dx + dy * dy > 0.0001) {
            mesh.rotation.y = Math.atan2(dx, dy)
            isMoving = true
          }
        }
        mesh.userData.lastX = p.x
        mesh.userData.lastY = p.y

        const torso = mesh.userData.torso
        const leftBoot = mesh.userData.leftBoot
        const rightBoot = mesh.userData.rightBoot

        if (torso && leftBoot && rightBoot) {
          if (p.fall > 0 && !p.jumping) {
            // Falling animation: legs dangling, slight tumble
            const fallT = p.fall // 0..1 progress through the drop
            leftBoot.rotation.x = -0.3 - fallT * 0.4
            rightBoot.rotation.x = 0.2 + fallT * 0.3
            leftBoot.position.y = -0.06
            rightBoot.position.y = -0.06
            torso.rotation.x = fallT * 0.35
            torso.rotation.z = Math.sin(fallT * Math.PI * 2) * 0.15
            torso.scale.set(1, 1, 1)
          } else if (p.jumping) {
            const jp = p.jumpProgress ?? 0
            // Airborne leg tuck
            leftBoot.rotation.x = -0.42
            rightBoot.rotation.x = -0.42
            leftBoot.position.y = -0.02
            rightBoot.position.y = -0.02

            // Air pitch: tilt back on ascent, tilt forward on descent
            const airPitch = (0.5 - jp) * 0.45
            torso.rotation.x = -airPitch
            torso.rotation.z = 0

            // Squash & stretch along jump curve
            if (jp < 0.65) {
              const s = Math.sin((jp / 0.65) * Math.PI) * 0.22
              torso.scale.set(1 - s * 0.4, 1 + s, 1 - s * 0.4)
            } else {
              const s = Math.sin(((jp - 0.65) / 0.35) * Math.PI) * 0.16
              torso.scale.set(1 + s, 1 - s * 0.5, 1 + s)
            }
          } else if (isMoving) {
            mesh.userData.runCycle = (mesh.userData.runCycle ?? 0) + 0.32
            const rc = mesh.userData.runCycle

            // Alternating leg swing
            leftBoot.rotation.x = Math.sin(rc) * 0.65
            rightBoot.rotation.x = -Math.sin(rc) * 0.65

            // Lift swinging boot slightly off the floor
            leftBoot.position.y = -0.06 + Math.max(0, Math.sin(rc)) * 0.05
            rightBoot.position.y = -0.06 + Math.max(0, -Math.sin(rc)) * 0.05

            // Torso waddle (Among Us bean sway), forward lean, and bounce
            torso.rotation.x = 0.15
            torso.rotation.z = Math.sin(rc) * 0.09
            torso.position.y = Math.abs(Math.sin(rc)) * 0.03
            torso.scale.set(1, 1, 1)
          } else {
            // Idle decay back to neutral stance
            leftBoot.rotation.x *= 0.65
            rightBoot.rotation.x *= 0.65
            leftBoot.position.y = -0.06 + (leftBoot.position.y - (-0.06)) * 0.65
            rightBoot.position.y = -0.06 + (rightBoot.position.y - (-0.06)) * 0.65

            torso.rotation.x *= 0.65
            torso.rotation.z *= 0.65
            torso.position.y *= 0.65
            torso.scale.set(1, 1, 1)
          }
        }

        // A wind-up is a shape change, not a tint.
        mesh.scale.setScalar(p.stomping ? 1.25 : 1)
        label.position.set(p.x, worldY(p.z, p.fall) + 1.25 + jumpArc, p.y)
        label.visible = true
      }
      for (const [id, mesh] of bodies) {
        if (seen.has(id)) continue
        mesh.visible = false
        labels.get(id).visible = false
        const fl = flames.get(id)
        if (fl) fl.visible = false
      }

      const shot = pose ?? overview
      camera.position.set(shot.position[0], shot.position[1], shot.position[2])
      camera.lookAt(shot.target[0], shot.target[1], shot.target[2])
      renderer.render(scene, camera)
    },

    dispose() {
      themeWatch.disconnect()
      renderer.dispose()
      tileGeo.dispose()
      postGeo.dispose()
      soonGeo.dispose()
      plateGeo.dispose()
      pickCoreGeo.dispose()
      pickRingGeo.dispose()
      for (const mesh of tiles) mesh.dispose()
      posts.dispose()
      soonMarks.dispose()
      plateMarks.dispose()
      pickCores.dispose()
      pickRings.dispose()
      for (const mat of tileMats) mat.dispose()
      postMat.dispose()
      soonMat.dispose()
      plateMat.dispose()
      pickMat.dispose()
      ringMat.dispose()
      coreTex.dispose()
      for (const group of bodies.values()) {
        group.userData.body?.geometry?.dispose()
        group.userData.visor?.geometry?.dispose()
        group.userData.pack?.geometry?.dispose()
        group.userData.leftBoot?.geometry?.dispose()
        if (group.userData.rightBoot?.geometry !== group.userData.leftBoot?.geometry) {
          group.userData.rightBoot?.geometry?.dispose()
        }
        group.userData.mat?.dispose()
        group.userData.visorMat?.dispose()
      }
      for (const mat of iconMat) mat.dispose()
      for (const tex of iconTex) tex.dispose()
      for (const spr of pickSprites) {
        scene.remove(spr)
        spr.geometry?.dispose()
      }
      for (const mat of itemMat.values()) mat.dispose()
      for (const tex of itemTex.values()) tex.dispose()
      flameMat.dispose()
      flameTex.dispose()
      for (const spr of flames.values()) scene.remove(spr)
      tileTex.dispose()
    },
  }
}
