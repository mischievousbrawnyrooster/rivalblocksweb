/**
 * Procedural artwork for powerups across all games:
 * - Blastworks: bomb, range, speed, kick, glove, remote, vest, square, drill
 * - Blockout Royale: shield, dash, sinkhole, patch, blink, swap, foresight
 * - Fracture Line: sprint, shield, overcharge, bulwark, rapid, shotgun,
 *                  medkit, sword, bomb, mine, grapple, cloak, popup
 *
 * Pre-rendered into offscreen canvases at canvas tile resolution.
 * Zero raster image files. Fully theme-reactive.
 * Meets WCAG 1.4.1: status is structurally distinct without colour alone.
 */

export const PICKUP_KINDS = [
  'bomb',
  'range',
  'speed',
  'dash',
  'sprint',
  'kick',
  'glove',
  'remote',
  'vest',
  'shield',
  'square',
  'drill',
  'sinkhole',
  'patch',
  'medkit',
  'blink',
  'swap',
  'foresight',
  'overcharge',
  'bulwark',
  'rapid',
  'shotgun',
  'sword',
  'mine',
  'grapple',
  'cloak',
  'popup',
  'shove',
  'hover',
  'bridge',
  'anchor',
]

/** Renders the beveled industrial chassis base for all pickup capsules */
function drawChassis(g, s, colour) {
  const pad = Math.max(1, Math.round(s * 0.1))
  const box = s - pad * 2

  // Background chassis plate
  g.fillStyle = colour.edge
  g.fillRect(pad, pad, box, box)

  // Inner inset panel
  const inPad = Math.max(1, Math.round(s * 0.05))
  g.fillStyle = colour.grid
  g.globalAlpha = 0.5
  g.fillRect(pad + inPad, pad + inPad, box - inPad * 2, box - inPad * 2)
  g.globalAlpha = 1

  // 3D Bevel: top-left highlight, bottom-right shadow
  g.globalAlpha = 0.25
  g.fillStyle = colour.fg
  g.fillRect(pad, pad, box, Math.max(1, s * 0.04))
  g.fillRect(pad, pad, Math.max(1, s * 0.04), box)

  g.globalAlpha = 0.4
  g.fillStyle = colour.edge
  g.fillRect(pad, pad + box - Math.max(1, s * 0.04), box, Math.max(1, s * 0.04))
  g.fillRect(pad + box - Math.max(1, s * 0.04), pad, Math.max(1, s * 0.04), box)
  g.globalAlpha = 1

  // Outer border
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1, s * 0.045)
  g.strokeRect(pad + 0.5, pad + 0.5, box - 1, box - 1)

  // Corner brackets / tabs
  const tab = Math.max(2, s * 0.08)
  g.fillStyle = colour.flare
  g.fillRect(pad, pad, tab, Math.max(1, s * 0.03))
  g.fillRect(pad, pad, Math.max(1, s * 0.03), tab)
  g.fillRect(pad + box - tab, pad, tab, Math.max(1, s * 0.03))
  g.fillRect(pad + box - Math.max(1, s * 0.03), pad, Math.max(1, s * 0.03), tab)
  g.fillRect(pad, pad + box - Math.max(1, s * 0.03), tab, Math.max(1, s * 0.03))
  g.fillRect(pad, pad + box - tab, Math.max(1, s * 0.03), tab)
  g.fillRect(pad + box - tab, pad + box - Math.max(1, s * 0.03), tab, Math.max(1, s * 0.03))
  g.fillRect(pad + box - Math.max(1, s * 0.03), pad + box - tab, Math.max(1, s * 0.03), tab)
}

function drawBomb(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.54
  const r = s * 0.2

  g.fillStyle = colour.fg
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = colour.edge
  g.lineWidth = Math.max(1, s * 0.03)
  g.stroke()

  g.fillStyle = colour.edge
  g.beginPath()
  g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.35, 0, Math.PI * 2)
  g.fill()

  g.fillStyle = colour.flare
  g.fillRect(cx - r * 0.35, cy - r - s * 0.06, r * 0.7, s * 0.06)

  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1, s * 0.04)
  g.beginPath()
  g.moveTo(cx, cy - r - s * 0.05)
  g.quadraticCurveTo(cx + s * 0.1, cy - r - s * 0.14, cx + s * 0.16, cy - r - s * 0.1)
  g.stroke()

  g.fillStyle = colour.warn
  const sx = cx + s * 0.16
  const sy = cy - r - s * 0.1
  const sr = Math.max(1.5, s * 0.04)
  g.beginPath()
  g.arc(sx, sy, sr, 0, Math.PI * 2)
  g.fill()
}

function drawRange(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  const sd = s * 0.16
  const sr = Math.max(1, s * 0.025)
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    g.fillStyle = colour.warn
    g.beginPath()
    g.moveTo(cx + dx * sd, cy + dy * (sd - sr * 1.5))
    g.lineTo(cx + dx * (sd + sr * 1.5), cy + dy * sd)
    g.lineTo(cx + dx * sd, cy + dy * (sd + sr * 1.5))
    g.lineTo(cx + dx * (sd - sr * 1.5), cy + dy * sd)
    g.closePath()
    g.fill()
  }

  const baseW = s * 0.055
  const midW = s * 0.08
  const tipLen = s * 0.28

  const drawArm = (dx, dy, px, py) => {
    g.fillStyle = colour.flare
    g.beginPath()
    g.moveTo(cx + px * baseW, cy + py * baseW)
    g.lineTo(cx + dx * (tipLen * 0.6) + px * midW, cy + dy * (tipLen * 0.6) + py * midW)
    g.lineTo(cx + dx * tipLen, cy + dy * tipLen)
    g.lineTo(cx + dx * (tipLen * 0.6) - px * midW, cy + dy * (tipLen * 0.6) - py * midW)
    g.lineTo(cx - px * baseW, cy - py * baseW)
    g.closePath()
    g.fill()

    g.fillStyle = colour.warn
    g.beginPath()
    g.moveTo(cx + px * (baseW * 0.5), cy + py * (baseW * 0.5))
    g.lineTo(cx + dx * (tipLen * 0.55) + px * (midW * 0.5), cy + dy * (tipLen * 0.55) + py * (midW * 0.5))
    g.lineTo(cx + dx * (tipLen * 0.85), cy + dy * (tipLen * 0.85))
    g.lineTo(cx + dx * (tipLen * 0.55) - px * (midW * 0.5), cy + dy * (tipLen * 0.55) - py * (midW * 0.5))
    g.lineTo(cx - px * (baseW * 0.5), cy - py * (baseW * 0.5))
    g.closePath()
    g.fill()
  }

  drawArm(0, -1, 1, 0)
  drawArm(0, 1, 1, 0)
  drawArm(1, 0, 0, 1)
  drawArm(-1, 0, 0, 1)

  g.fillStyle = colour.flare
  g.beginPath()
  g.arc(cx, cy, s * 0.11, 0, Math.PI * 2)
  g.fill()

  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy, s * 0.075, 0, Math.PI * 2)
  g.fill()

  g.fillStyle = colour.fg
  g.beginPath()
  g.arc(cx, cy, s * 0.04, 0, Math.PI * 2)
  g.fill()
}

function drawSpeed(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5
  const w = s * 0.09
  const h = s * 0.18
  const lw = Math.max(2, s * 0.06)

  g.lineWidth = lw
  const offsets = [-s * 0.14, 0, s * 0.14]
  const colours = [colour.muted, colour.flare, colour.fg]

  for (let i = 0; i < 3; i++) {
    const ox = cx + offsets[i]
    g.strokeStyle = colours[i]
    g.beginPath()
    g.moveTo(ox - w * 0.5, cy - h)
    g.lineTo(ox + w * 0.5, cy)
    g.lineTo(ox - w * 0.5, cy + h)
    g.stroke()
  }
}

function drawKick(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  g.fillStyle = colour.fg
  g.beginPath()
  g.moveTo(cx - s * 0.22, cy - s * 0.18)
  g.lineTo(cx - s * 0.1, cy - s * 0.18)
  g.lineTo(cx - s * 0.06, cy + s * 0.05)
  g.lineTo(cx + s * 0.04, cy + s * 0.05)
  g.lineTo(cx + s * 0.04, cy + s * 0.16)
  g.lineTo(cx - s * 0.22, cy + s * 0.16)
  g.closePath()
  g.fill()

  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1, s * 0.04)
  g.beginPath()
  g.moveTo(cx + s * 0.08, cy)
  g.lineTo(cx + s * 0.16, cy - s * 0.08)
  g.moveTo(cx + s * 0.09, cy + s * 0.08)
  g.lineTo(cx + s * 0.19, cy + s * 0.08)
  g.moveTo(cx + s * 0.08, cy + s * 0.14)
  g.lineTo(cx + s * 0.16, cy + s * 0.2)
  g.stroke()

  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx + s * 0.21, cy - s * 0.02, Math.max(2, s * 0.07), 0, Math.PI * 2)
  g.fill()
}

function drawGlove(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.52

  g.fillStyle = colour.muted
  g.fillRect(cx - s * 0.15, cy + s * 0.08, s * 0.3, s * 0.1)

  g.fillStyle = colour.fg
  g.fillRect(cx - s * 0.13, cy - s * 0.05, s * 0.26, s * 0.12)

  const fw = s * 0.05
  const fgap = s * 0.02
  const fx0 = cx - s * 0.12
  for (let i = 0; i < 4; i++) {
    const x = fx0 + i * (fw + fgap)
    const fh = i === 1 || i === 2 ? s * 0.15 : s * 0.11
    g.fillRect(x, cy - s * 0.05 - fh, fw, fh)
  }

  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1.5, s * 0.05)
  g.beginPath()
  g.moveTo(cx - s * 0.08, cy - s * 0.17)
  g.lineTo(cx, cy - s * 0.25)
  g.lineTo(cx + s * 0.08, cy - s * 0.17)
  g.stroke()
}

function drawRemote(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.54
  const w = s * 0.28
  const h = s * 0.36

  g.fillStyle = colour.fg
  g.fillRect(cx - w / 2, cy - h / 2, w, h)
  g.strokeStyle = colour.edge
  g.lineWidth = Math.max(1, s * 0.03)
  g.strokeRect(cx - w / 2, cy - h / 2, w, h)

  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1, s * 0.04)
  g.beginPath()
  g.moveTo(cx - w * 0.28, cy - h / 2)
  g.lineTo(cx - w * 0.28, cy - h / 2 - s * 0.12)
  g.stroke()

  g.lineWidth = Math.max(1, s * 0.03)
  g.beginPath()
  g.arc(cx - w * 0.28, cy - h / 2 - s * 0.12, s * 0.06, -Math.PI * 0.7, 0)
  g.stroke()
  g.beginPath()
  g.arc(cx - w * 0.28, cy - h / 2 - s * 0.12, s * 0.11, -Math.PI * 0.7, 0)
  g.stroke()

  g.fillStyle = colour.flare
  g.beginPath()
  g.arc(cx, cy, s * 0.08, 0, Math.PI * 2)
  g.fill()

  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx + w * 0.22, cy - h * 0.28, Math.max(1, s * 0.025), 0, Math.PI * 2)
  g.fill()
}

function drawVest(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  g.fillStyle = colour.fg
  g.beginPath()
  g.moveTo(cx - s * 0.16, cy - s * 0.2)
  g.lineTo(cx - s * 0.06, cy - s * 0.2)
  g.lineTo(cx, cy - s * 0.1)
  g.lineTo(cx + s * 0.06, cy - s * 0.2)
  g.lineTo(cx + s * 0.16, cy - s * 0.2)
  g.lineTo(cx + s * 0.2, cy - s * 0.06)
  g.lineTo(cx + s * 0.14, cy + s * 0.2)
  g.lineTo(cx - s * 0.14, cy + s * 0.2)
  g.lineTo(cx - s * 0.2, cy - s * 0.06)
  g.closePath()
  g.fill()

  g.strokeStyle = colour.edge
  g.lineWidth = Math.max(1, s * 0.03)
  g.stroke()

  g.fillStyle = colour.warn
  g.beginPath()
  g.moveTo(cx, cy - s * 0.04)
  g.lineTo(cx + s * 0.07, cy + s * 0.05)
  g.lineTo(cx, cy + s * 0.14)
  g.lineTo(cx - s * 0.07, cy + s * 0.05)
  g.closePath()
  g.fill()
}

function drawSquare(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5
  const cell = s * 0.1
  const gap = s * 0.03
  const start = -cell * 1.5 - gap

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = cx + start + c * (cell + gap)
      const y = cy + start + r * (cell + gap)
      const isCorner = (r === 0 || r === 2) && (c === 0 || c === 2)
      const isCenter = r === 1 && c === 1
      g.fillStyle = isCenter ? colour.warn : isCorner ? colour.flare : colour.fg
      g.fillRect(x, y, cell, cell)
    }
  }

  g.strokeStyle = colour.edge
  g.lineWidth = Math.max(1, s * 0.02)
  g.strokeRect(cx + start, cy + start, cell * 3 + gap * 2, cell * 3 + gap * 2)
}

function drawDrill(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.52

  g.fillStyle = colour.muted
  g.fillRect(cx - s * 0.12, cy - s * 0.22, s * 0.24, s * 0.09)

  g.fillStyle = colour.fg
  g.beginPath()
  g.moveTo(cx - s * 0.13, cy - s * 0.13)
  g.lineTo(cx + s * 0.13, cy - s * 0.13)
  g.lineTo(cx, cy + s * 0.24)
  g.closePath()
  g.fill()

  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1, s * 0.035)
  g.beginPath()
  g.moveTo(cx - s * 0.11, cy - s * 0.08)
  g.lineTo(cx + s * 0.08, cy - s * 0.03)
  g.moveTo(cx - s * 0.08, cy + s * 0.02)
  g.lineTo(cx + s * 0.05, cy + s * 0.07)
  g.moveTo(cx - s * 0.05, cy + s * 0.12)
  g.lineTo(cx + s * 0.02, cy + s * 0.17)
  g.stroke()

  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy + s * 0.22, Math.max(1.5, s * 0.03), 0, Math.PI * 2)
  g.fill()
}

function drawSinkhole(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  // Vortex pit
  g.fillStyle = colour.edge
  g.beginPath()
  g.arc(cx, cy, s * 0.22, 0, Math.PI * 2)
  g.fill()

  // Inward concentric spiral rings
  g.strokeStyle = colour.warn
  g.lineWidth = Math.max(1, s * 0.03)
  g.beginPath()
  g.arc(cx, cy, s * 0.15, 0, Math.PI * 1.6)
  g.stroke()
  g.beginPath()
  g.arc(cx, cy, s * 0.08, 0, Math.PI * 1.8)
  g.stroke()

  // 4 corner targeting crosshairs
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1.5, s * 0.04)
  const d = s * 0.24
  const l = s * 0.08
  g.beginPath()
  // Top-left
  g.moveTo(cx - d, cy - d + l)
  g.lineTo(cx - d, cy - d)
  g.lineTo(cx - d + l, cy - d)
  // Top-right
  g.moveTo(cx + d - l, cy - d)
  g.lineTo(cx + d, cy - d)
  g.lineTo(cx + d, cy - d + l)
  // Bottom-right
  g.moveTo(cx + d, cy + d - l)
  g.lineTo(cx + d, cy + d)
  g.lineTo(cx + d - l, cy + d)
  // Bottom-left
  g.moveTo(cx - d + l, cy + d)
  g.lineTo(cx - d, cy + d)
  g.lineTo(cx - d, cy + d - l)
  g.stroke()
}

function drawPatch(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  // 3x3 background blueprint grid
  const gsize = s * 0.44
  const gstep = gsize / 3
  g.strokeStyle = colour.grid
  g.lineWidth = 1
  g.strokeRect(cx - gsize / 2, cy - gsize / 2, gsize, gsize)
  g.beginPath()
  g.moveTo(cx - gsize / 2 + gstep, cy - gsize / 2)
  g.lineTo(cx - gsize / 2 + gstep, cy + gsize / 2)
  g.moveTo(cx - gsize / 2 + gstep * 2, cy - gsize / 2)
  g.lineTo(cx - gsize / 2 + gstep * 2, cy + gsize / 2)
  g.moveTo(cx - gsize / 2, cy - gsize / 2 + gstep)
  g.lineTo(cx + gsize / 2, cy - gsize / 2 + gstep)
  g.moveTo(cx - gsize / 2, cy - gsize / 2 + gstep * 2)
  g.lineTo(cx + gsize / 2, cy - gsize / 2 + gstep * 2)
  g.stroke()

  // Prominent medical/structural repair cross
  const cw = s * 0.12
  const ch = s * 0.34
  g.fillStyle = colour.fg
  g.fillRect(cx - cw / 2, cy - ch / 2, cw, ch)
  g.fillRect(cx - ch / 2, cy - cw / 2, ch, cw)

  // Inner warm core
  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy, s * 0.05, 0, Math.PI * 2)
  g.fill()
}

function drawBlink(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  // Origin point
  g.fillStyle = colour.muted
  g.beginPath()
  g.arc(cx - s * 0.18, cy + s * 0.12, Math.max(2, s * 0.06), 0, Math.PI * 2)
  g.fill()

  // Leap arc
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(2, s * 0.05)
  g.beginPath()
  g.moveTo(cx - s * 0.18, cy + s * 0.12)
  g.quadraticCurveTo(cx, cy - s * 0.3, cx + s * 0.18, cy - s * 0.08)
  g.stroke()

  // Destination flash
  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx + s * 0.18, cy - s * 0.08, Math.max(2, s * 0.08), 0, Math.PI * 2)
  g.fill()
  g.fillStyle = colour.fg
  g.beginPath()
  g.arc(cx + s * 0.18, cy - s * 0.08, Math.max(1, s * 0.04), 0, Math.PI * 2)
  g.fill()
}

function drawSwap(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5
  const r = s * 0.18

  // Two orbital exchange arcs
  g.lineWidth = Math.max(2, s * 0.045)

  // Top arc (moving right)
  g.strokeStyle = colour.flare
  g.beginPath()
  g.arc(cx, cy, r, -Math.PI * 0.8, -Math.PI * 0.1)
  g.stroke()
  // Top arrow head
  g.fillStyle = colour.flare
  g.beginPath()
  g.moveTo(cx + r * 0.95, cy - r * 0.25)
  g.lineTo(cx + r * 0.6, cy - r * 0.7)
  g.lineTo(cx + r * 0.45, cy - r * 0.15)
  g.closePath()
  g.fill()

  // Bottom arc (moving left)
  g.strokeStyle = colour.fg
  g.beginPath()
  g.arc(cx, cy, r, Math.PI * 0.2, Math.PI * 0.9)
  g.stroke()
  // Bottom arrow head
  g.fillStyle = colour.fg
  g.beginPath()
  g.moveTo(cx - r * 0.95, cy + r * 0.25)
  g.lineTo(cx - r * 0.6, cy + r * 0.7)
  g.lineTo(cx - r * 0.45, cy + r * 0.15)
  g.closePath()
  g.fill()
}

function drawForesight(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  // All-seeing eye contour
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(2, s * 0.045)
  g.beginPath()
  g.moveTo(cx - s * 0.25, cy)
  g.quadraticCurveTo(cx, cy - s * 0.2, cx + s * 0.25, cy)
  g.quadraticCurveTo(cx, cy + s * 0.2, cx - s * 0.25, cy)
  g.stroke()

  // Iris ring
  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy, s * 0.1, 0, Math.PI * 2)
  g.fill()

  // Pupil
  g.fillStyle = colour.edge
  g.beginPath()
  g.arc(cx, cy, s * 0.05, 0, Math.PI * 2)
  g.fill()

  // Specular gleam
  g.fillStyle = colour.fg
  g.beginPath()
  g.arc(cx - s * 0.03, cy - s * 0.03, s * 0.025, 0, Math.PI * 2)
  g.fill()
}

function drawOvercharge(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  // High-energy bullet round pointing up
  g.fillStyle = colour.fg
  g.beginPath()
  g.moveTo(cx - s * 0.08, cy + s * 0.18)
  g.lineTo(cx - s * 0.08, cy - s * 0.05)
  g.quadraticCurveTo(cx, cy - s * 0.25, cx + s * 0.08, cy - s * 0.05)
  g.lineTo(cx + s * 0.08, cy + s * 0.18)
  g.closePath()
  g.fill()

  // Energetic shockwave rings
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1.5, s * 0.04)
  g.beginPath()
  g.arc(cx, cy - s * 0.08, s * 0.15, -Math.PI * 0.75, -Math.PI * 0.25)
  g.stroke()
  g.strokeStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy - s * 0.14, s * 0.2, -Math.PI * 0.75, -Math.PI * 0.25)
  g.stroke()

  // Plasma core spark
  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy, s * 0.04, 0, Math.PI * 2)
  g.fill()
}

function drawBulwark(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5
  const w = s * 0.44
  const h = s * 0.38
  const thick = s * 0.11

  // U-shaped barricade fortress
  g.fillStyle = colour.fg
  // Left wall
  g.fillRect(cx - w / 2, cy - h / 2, thick, h)
  // Right wall
  g.fillRect(cx + w / 2 - thick, cy - h / 2, thick, h)
  // Bottom wall
  g.fillRect(cx - w / 2, cy + h / 2 - thick, w, thick)

  // Top rim hazard stripes
  g.fillStyle = colour.flare
  g.fillRect(cx - w / 2, cy - h / 2, thick, thick * 0.5)
  g.fillRect(cx + w / 2 - thick, cy - h / 2, thick, thick * 0.5)
}

function drawRapid(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5
  const h = s * 0.06
  const len = s * 0.38

  // Three high-speed burst tracers
  const offsets = [-s * 0.12, 0, s * 0.12]
  for (let i = 0; i < 3; i++) {
    const y = cy + offsets[i]
    g.fillStyle = colour.warn
    g.fillRect(cx - len / 2, y - h / 2, s * 0.08, h)
    g.fillStyle = colour.flare
    g.fillRect(cx - len / 2 + s * 0.08, y - h / 2, s * 0.12, h)
    g.fillStyle = colour.fg
    g.fillRect(cx - len / 2 + s * 0.2, y - h / 2, s * 0.18, h)
  }
}

function drawShotgun(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.56

  // Shotgun shell base
  g.fillStyle = colour.flare
  g.fillRect(cx - s * 0.08, cy - s * 0.05, s * 0.16, s * 0.14)
  g.fillStyle = colour.warn
  g.fillRect(cx - s * 0.08, cy + s * 0.09, s * 0.16, s * 0.05)

  // 5 divergent buckshot pellets
  const pellets = [
    [-s * 0.22, -s * 0.26],
    [-s * 0.11, -s * 0.32],
    [0, -s * 0.35],
    [s * 0.11, -s * 0.32],
    [s * 0.22, -s * 0.26],
  ]
  for (const [px, py] of pellets) {
    g.strokeStyle = colour.flare
    g.lineWidth = Math.max(1, s * 0.02)
    g.beginPath()
    g.moveTo(cx, cy - s * 0.05)
    g.lineTo(cx + px, cy + py)
    g.stroke()

    g.fillStyle = colour.fg
    g.beginPath()
    g.arc(cx + px, cy + py, Math.max(1.5, s * 0.035), 0, Math.PI * 2)
    g.fill()
  }
}

function drawSword(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  // Angled tactical blade
  g.strokeStyle = colour.fg
  g.lineWidth = Math.max(2, s * 0.06)
  g.beginPath()
  g.moveTo(cx - s * 0.18, cy + s * 0.18)
  g.lineTo(cx + s * 0.16, cy - s * 0.16)
  g.stroke()

  // Crossguard
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(2, s * 0.07)
  g.beginPath()
  g.moveTo(cx - s * 0.15 - s * 0.08, cy + s * 0.15 - s * 0.08)
  g.lineTo(cx - s * 0.15 + s * 0.08, cy + s * 0.15 + s * 0.08)
  g.stroke()

  // Slashing swoosh
  g.strokeStyle = colour.warn
  g.lineWidth = Math.max(1, s * 0.03)
  g.beginPath()
  g.arc(cx, cy, s * 0.24, -Math.PI * 0.7, -Math.PI * 0.1)
  g.stroke()
}

function drawMine(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5
  const r = s * 0.18

  // Proximity mine disk
  g.fillStyle = colour.fg
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()

  // 4 contact horns
  g.fillStyle = colour.edge
  g.beginPath()
  g.arc(cx, cy, r * 0.7, 0, Math.PI * 2)
  g.fill()

  // Blinking active center sensor
  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy, s * 0.06, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = colour.flare
  g.beginPath()
  g.arc(cx, cy, s * 0.03, 0, Math.PI * 2)
  g.fill()
}

function drawGrapple(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5

  // Wire cable
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1, s * 0.03)
  g.beginPath()
  g.moveTo(cx, cy + s * 0.22)
  g.lineTo(cx, cy - s * 0.05)
  g.stroke()

  // 3-pronged anchor claw
  g.strokeStyle = colour.fg
  g.lineWidth = Math.max(1.5, s * 0.05)
  g.beginPath()
  // Center spike
  g.moveTo(cx, cy - s * 0.05)
  g.lineTo(cx, cy - s * 0.22)
  // Left hook
  g.moveTo(cx, cy - s * 0.05)
  g.lineTo(cx - s * 0.15, cy - s * 0.12)
  g.lineTo(cx - s * 0.15, cy - s * 0.2)
  // Right hook
  g.moveTo(cx, cy - s * 0.05)
  g.lineTo(cx + s * 0.15, cy - s * 0.12)
  g.lineTo(cx + s * 0.15, cy - s * 0.2)
  g.stroke()
}

function drawCloak(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5
  const r = s * 0.2

  // Hexagonal stealth camouflage shield
  g.strokeStyle = colour.fg
  g.lineWidth = Math.max(1.5, s * 0.04)
  g.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.closePath()
  g.stroke()

  // Inner refractive ghost dot
  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy, s * 0.06, 0, Math.PI * 2)
  g.fill()
}

function drawPopup(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s * 0.5
  const cy = s * 0.5
  const w = s * 0.36
  const h = s * 0.3

  // Window background
  g.fillStyle = colour.edge
  g.fillRect(cx - w / 2, cy - h / 2, w, h)
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1, s * 0.03)
  g.strokeRect(cx - w / 2, cy - h / 2, w, h)

  // Title bar
  g.fillStyle = colour.flare
  g.fillRect(cx - w / 2, cy - h / 2, w, s * 0.08)

  // Close [X]
  g.strokeStyle = colour.fg
  g.lineWidth = Math.max(1, s * 0.025)
  const xx = cx + w / 2 - s * 0.04
  const xy = cy - h / 2 + s * 0.04
  g.beginPath()
  g.moveTo(xx - s * 0.02, xy - s * 0.02)
  g.lineTo(xx + s * 0.02, xy + s * 0.02)
  g.moveTo(xx + s * 0.02, xy - s * 0.02)
  g.lineTo(xx - s * 0.02, xy + s * 0.02)
  g.stroke()

  // Exclamation mark in window body
  g.fillStyle = colour.warn
  g.fillRect(cx - s * 0.02, cy - s * 0.02, s * 0.04, s * 0.08)
  g.fillRect(cx - s * 0.02, cy + s * 0.09, s * 0.04, s * 0.03)
}

function drawShove(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s / 2
  const cy = s / 2

  // Concentric kinetic shockwave impulse rings
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1, s * 0.04)
  g.beginPath()
  g.arc(cx, cy, s * 0.22, 0, Math.PI * 2)
  g.stroke()

  g.beginPath()
  g.arc(cx, cy, s * 0.12, 0, Math.PI * 2)
  g.stroke()

  // Central kinetic charge core
  g.fillStyle = colour.warn
  g.beginPath()
  g.arc(cx, cy, s * 0.05, 0, Math.PI * 2)
  g.fill()

  // 4 cardinal outward impulse force arrows
  const arm = s * 0.28
  const head = s * 0.07
  g.strokeStyle = colour.warn
  g.lineWidth = Math.max(1.5, s * 0.045)
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const tipX = cx + dx * arm
    const tipY = cy + dy * arm
    g.beginPath()
    g.moveTo(cx + dx * s * 0.14, cy + dy * s * 0.14)
    g.lineTo(tipX, tipY)
    g.stroke()

    g.fillStyle = colour.warn
    g.beginPath()
    if (dx === 0) {
      g.moveTo(tipX, tipY)
      g.lineTo(tipX - head, tipY - dy * head)
      g.lineTo(tipX + head, tipY - dy * head)
    } else {
      g.moveTo(tipX, tipY)
      g.lineTo(tipX - dx * head, tipY - head)
      g.lineTo(tipX - dx * head, tipY + head)
    }
    g.closePath()
    g.fill()
  }
}

function drawHover(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s / 2
  const cy = s / 2

  // 1. Sleek swept-wing aerodynamic hover glider chassis
  g.fillStyle = colour.edge
  g.beginPath()
  g.moveTo(cx, cy - s * 0.22) // Nose tip
  g.lineTo(cx + s * 0.26, cy + s * 0.08) // Right wingtip
  g.lineTo(cx + s * 0.14, cy + s * 0.12) // Right inner notch
  g.lineTo(cx, cy + s * 0.04) // Keel center
  g.lineTo(cx - s * 0.14, cy + s * 0.12) // Left inner notch
  g.lineTo(cx - s * 0.26, cy + s * 0.08) // Left wingtip
  g.closePath()
  g.fill()

  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1.5, s * 0.045)
  g.stroke()

  // 2. Dual high-velocity ion thruster pods (left & right)
  g.fillStyle = colour.flare
  const podW = s * 0.07
  const podH = s * 0.14
  g.fillRect(cx - s * 0.2 - podW / 2, cy - s * 0.02, podW, podH)
  g.fillRect(cx + s * 0.2 - podW / 2, cy - s * 0.02, podW, podH)

  // 3. High-speed propulsion thrust flames (dual angled jet exhaust)
  g.fillStyle = colour.warn
  // Left jet exhaust plume
  g.beginPath()
  g.moveTo(cx - s * 0.24, cy + s * 0.13)
  g.lineTo(cx - s * 0.2, cy + s * 0.25)
  g.lineTo(cx - s * 0.16, cy + s * 0.13)
  g.closePath()
  g.fill()

  // Right jet exhaust plume
  g.beginPath()
  g.moveTo(cx + s * 0.16, cy + s * 0.13)
  g.lineTo(cx + s * 0.2, cy + s * 0.25)
  g.lineTo(cx + s * 0.24, cy + s * 0.13)
  g.closePath()
  g.fill()

  // 4. Central high-speed kinetic arrow chevrons (acceleration burst)
  g.strokeStyle = colour.warn
  g.lineWidth = Math.max(1.5, s * 0.045)
  g.beginPath()
  // Lower chevron
  g.moveTo(cx - s * 0.09, cy - s * 0.02)
  g.lineTo(cx, cy - s * 0.1)
  g.lineTo(cx + s * 0.09, cy - s * 0.02)
  // Upper speed dart
  g.moveTo(cx - s * 0.07, cy - s * 0.1)
  g.lineTo(cx, cy - s * 0.18)
  g.lineTo(cx + s * 0.07, cy - s * 0.1)
  g.stroke()

  // 5. Central glowing anti-gravity gyro / turbine core
  g.fillStyle = colour.flare
  g.beginPath()
  g.arc(cx, cy + s * 0.01, s * 0.045, 0, Math.PI * 2)
  g.fill()
}

function drawBridge(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s / 2
  const cy = s / 2
  const bw = s * 0.6
  const bh = s * 0.24

  // Top & bottom structural steel girders
  g.fillStyle = colour.flare
  g.fillRect(cx - bw / 2, cy - bh / 2, bw, Math.max(1.5, s * 0.05))
  g.fillRect(cx - bw / 2, cy + bh / 2 - Math.max(1.5, s * 0.05), bw, Math.max(1.5, s * 0.05))

  // Vertical support piers and interlocking diagonal trusses
  g.strokeStyle = colour.warn
  g.lineWidth = Math.max(1, s * 0.035)
  g.beginPath()
  g.moveTo(cx - bw * 0.4, cy - bh / 2)
  g.lineTo(cx - bw * 0.4, cy + bh / 2)
  g.moveTo(cx, cy - bh / 2)
  g.lineTo(cx, cy + bh / 2)
  g.moveTo(cx + bw * 0.4, cy - bh / 2)
  g.lineTo(cx + bw * 0.4, cy + bh / 2)
  g.moveTo(cx - bw * 0.4, cy - bh / 2)
  g.lineTo(cx, cy + bh / 2)
  g.moveTo(cx, cy - bh / 2)
  g.lineTo(cx - bw * 0.4, cy + bh / 2)
  g.moveTo(cx, cy - bh / 2)
  g.lineTo(cx + bw * 0.4, cy + bh / 2)
  g.moveTo(cx + bw * 0.4, cy - bh / 2)
  g.lineTo(cx, cy + bh / 2)
  g.stroke()

  // Central runway road strip
  g.fillStyle = colour.fg
  g.fillRect(cx - bw * 0.45, cy - s * 0.02, bw * 0.9, s * 0.04)
}

function drawAnchor(g, s, colour) {
  drawChassis(g, s, colour)
  const cx = s / 2
  const cy = s / 2

  // Top ring / shackle
  g.strokeStyle = colour.flare
  g.lineWidth = Math.max(1.5, s * 0.045)
  g.beginPath()
  g.arc(cx, cy - s * 0.22, s * 0.08, 0, Math.PI * 2)
  g.stroke()

  // Horizontal stock / crossbar with end stops
  g.fillStyle = colour.flare
  g.fillRect(cx - s * 0.24, cy - s * 0.13, s * 0.48, Math.max(1.5, s * 0.045))
  g.fillRect(cx - s * 0.25, cy - s * 0.16, s * 0.04, s * 0.1)
  g.fillRect(cx + s * 0.21, cy - s * 0.16, s * 0.04, s * 0.1)

  // Vertical shank
  g.fillStyle = colour.flare
  g.fillRect(cx - s * 0.03, cy - s * 0.14, s * 0.06, s * 0.38)

  // Bottom curved crescent arms with triangular flukes
  g.strokeStyle = colour.warn
  g.lineWidth = Math.max(2, s * 0.06)
  g.beginPath()
  g.arc(cx, cy + s * 0.06, s * 0.22, Math.PI * 0.15, Math.PI * 0.85)
  g.stroke()

  // Fluke spearhead tips
  const fluke = s * 0.07
  g.fillStyle = colour.warn
  // Left fluke
  g.beginPath()
  g.moveTo(cx - s * 0.2, cy + s * 0.14)
  g.lineTo(cx - s * 0.2 - fluke, cy + s * 0.08)
  g.lineTo(cx - s * 0.14, cy + s * 0.1)
  g.closePath()
  g.fill()

  // Right fluke
  g.beginPath()
  g.moveTo(cx + s * 0.2, cy + s * 0.14)
  g.lineTo(cx + s * 0.2 + fluke, cy + s * 0.08)
  g.lineTo(cx + s * 0.14, cy + s * 0.1)
  g.closePath()
  g.fill()
}

/**
 * Builds offscreen canvases for powerup pickups across all games.
 * Aliases shared powerups (speed/dash/sprint, vest/shield, patch/medkit, etc.).
 */
export function makePickupArt(colour, px) {
  const s = Math.max(8, Math.round(px))
  const paint = (draw) => {
    const c = document.createElement('canvas')
    c.width = s
    c.height = s
    draw(c.getContext('2d'), s, colour)
    return c
  }

  // Base distinctive renderers
  const bomb = paint(drawBomb)
  const range = paint(drawRange)
  const speed = paint(drawSpeed)
  const kick = paint(drawKick)
  const glove = paint(drawGlove)
  const remote = paint(drawRemote)
  const vest = paint(drawVest)
  const square = paint(drawSquare)
  const drill = paint(drawDrill)
  const sinkhole = paint(drawSinkhole)
  const patch = paint(drawPatch)
  const blink = paint(drawBlink)
  const swap = paint(drawSwap)
  const foresight = paint(drawForesight)
  const overcharge = paint(drawOvercharge)
  const bulwark = paint(drawBulwark)
  const rapid = paint(drawRapid)
  const shotgun = paint(drawShotgun)
  const sword = paint(drawSword)
  const mine = paint(drawMine)
  const grapple = paint(drawGrapple)
  const cloak = paint(drawCloak)
  const popup = paint(drawPopup)
  const shove = paint(drawShove)
  const hover = paint(drawHover)
  const bridge = paint(drawBridge)
  const anchor = paint(drawAnchor)

  return {
    bomb,
    range,
    speed,
    dash: speed,
    sprint: speed,
    kick,
    glove,
    remote,
    vest,
    shield: vest,
    square,
    drill,
    sinkhole,
    patch,
    medkit: patch,
    blink,
    swap,
    foresight,
    overcharge,
    bulwark,
    rapid,
    shotgun,
    sword,
    mine,
    grapple,
    cloak,
    popup,
    shove,
    hover,
    bridge,
    anchor,
  }
}
