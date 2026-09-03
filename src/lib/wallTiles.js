/**
 * Artwork for the cover in all three games: a slab in three states of failure,
 * the indestructible boundary, and the floor it all stands on.
 *
 * Drawn once into offscreen canvases and blitted per cell, rather than pathed
 * per cell per frame — at several hundred cells and 30 Hz the second one is
 * real work, and this way the art can afford detail it could never afford
 * inline.
 *
 * No image files, per the site's rule: every pixel here is generated at runtime
 * from the theme's own tokens, so the art restyles itself when the theme flips
 * and there is nothing binary to ship.
 *
 * Each arena picks a MATERIAL. The material only ever changes the SURFACE of a
 * slab and the floor under it — the damage on top is drawn the same way for
 * all of them, so a cracked brick and a cracked steel plate are still read as
 * "cracked" by the same shapes. That separation is what keeps the three damage
 * states legible with the colour thrown away, however the arena is dressed.
 */

/** Deterministic noise. The same slab must look the same on every redraw. */
const seeded = (seed) => {
  let s = seed >>> 0
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

/** Lit from the top left, shadowed at the bottom right. Every material agrees. */
function bevel(g, s, colour, lift = 0.13, drop = 0.32) {
  g.globalAlpha = lift
  g.fillStyle = colour.fg
  g.fillRect(0, 0, s, s * 0.1)
  g.fillRect(0, 0, s * 0.1, s)
  g.globalAlpha = drop
  g.fillStyle = colour.edge
  g.fillRect(0, s - s * 0.13, s, s * 0.13)
  g.fillRect(s - s * 0.13, 0, s * 0.13, s)
  g.globalAlpha = 1
}

function outline(g, s, colour) {
  g.strokeStyle = colour.grid
  g.lineWidth = 1
  g.strokeRect(0.5, 0.5, s - 1, s - 1)
}

// --- materials -------------------------------------------------------------
// Each is { wall, floor }. Both are handed a fresh context the size of one
// tile, the palette, and a seeded rng.

const concrete = {
  wall(g, s, colour, rng) {
    g.fillStyle = colour.wall
    g.fillRect(0, 0, s, s)
    // Aggregate in the mix. Two tones so the slab reads as cast, not printed.
    for (let i = 0; i < 22; i++) {
      const light = rng() > 0.55
      g.globalAlpha = light ? 0.09 : 0.2
      g.fillStyle = light ? colour.fg : colour.edge
      g.beginPath()
      g.arc(rng() * s, rng() * s, s * (0.015 + rng() * 0.03), 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
    bevel(g, s, colour)
    outline(g, s, colour)
  },
  floor(g, s, colour, rng) {
    g.fillStyle = colour.floor
    g.fillRect(0, 0, s, s)
    g.globalAlpha = 0.3
    g.strokeStyle = colour.grid
    g.lineWidth = 1
    g.strokeRect(0.5, 0.5, s - 1, s - 1)
    g.globalAlpha = 0.12
    for (let i = 0; i < 5; i++) {
      g.fillStyle = colour.fg
      g.fillRect(rng() * s, rng() * s, s * 0.05, s * 0.05)
    }
    g.globalAlpha = 1
  },
}

const brick = {
  wall(g, s, colour, rng) {
    g.fillStyle = colour.edge
    g.fillRect(0, 0, s, s)
    // Three courses, offset every other one — the joint pattern IS the tell.
    const rows = 3
    const h = s / rows
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 0 ? 0 : -s * 0.25
      for (let c = -1; c < 3; c++) {
        const x = offset + c * s * 0.5
        g.fillStyle = colour.wall
        g.globalAlpha = 0.82 + rng() * 0.18
        g.fillRect(x + s * 0.03, r * h + s * 0.03, s * 0.5 - s * 0.06, h - s * 0.06)
      }
    }
    g.globalAlpha = 1
    bevel(g, s, colour, 0.1, 0.26)
    outline(g, s, colour)
  },
  floor(g, s, colour, rng) {
    g.fillStyle = colour.floor
    g.fillRect(0, 0, s, s)
    g.globalAlpha = 0.22
    g.strokeStyle = colour.grid
    g.lineWidth = Math.max(1, s * 0.03)
    // Short courses laid the other way, so floor and wall never read alike.
    for (let r = 0; r < 3; r++) {
      const y = (r + 0.5) * (s / 3)
      const off = r % 2 ? s * 0.25 : 0
      g.beginPath()
      g.moveTo(off, y)
      g.lineTo(off + s * 0.5, y)
      g.stroke()
    }
    g.globalAlpha = 1
    if (rng() > 0.8) {
      g.globalAlpha = 0.1
      g.fillStyle = colour.fg
      g.fillRect(s * 0.4, s * 0.4, s * 0.2, s * 0.2)
      g.globalAlpha = 1
    }
  },
}

const steel = {
  wall(g, s, colour) {
    g.fillStyle = colour.wall
    g.fillRect(0, 0, s, s)
    // Tread, then rivets at the corners: both unmistakably manufactured.
    g.globalAlpha = 0.12
    g.strokeStyle = colour.fg
    g.lineWidth = Math.max(1, s * 0.05)
    for (let i = -1; i < 3; i++) {
      g.beginPath()
      g.moveTo(i * s * 0.5, s)
      g.lineTo(i * s * 0.5 + s, 0)
      g.stroke()
    }
    g.globalAlpha = 1
    bevel(g, s, colour, 0.18, 0.3)
    for (const [rx, ry] of [
      [0.18, 0.18],
      [0.82, 0.18],
      [0.18, 0.82],
      [0.82, 0.82],
    ]) {
      g.fillStyle = colour.edge
      g.beginPath()
      g.arc(rx * s, ry * s, s * 0.06, 0, Math.PI * 2)
      g.fill()
      g.globalAlpha = 0.5
      g.fillStyle = colour.fg
      g.beginPath()
      g.arc(rx * s - s * 0.015, ry * s - s * 0.015, s * 0.03, 0, Math.PI * 2)
      g.fill()
      g.globalAlpha = 1
    }
    outline(g, s, colour)
  },
  floor(g, s, colour) {
    g.fillStyle = colour.floor
    g.fillRect(0, 0, s, s)
    // Diamond plate: four raised lozenges, which reads as a walkway.
    g.globalAlpha = 0.16
    g.fillStyle = colour.fg
    for (const [cx, cy] of [
      [0.3, 0.3],
      [0.7, 0.7],
    ]) {
      g.beginPath()
      g.moveTo(cx * s, cy * s - s * 0.12)
      g.lineTo(cx * s + s * 0.1, cy * s)
      g.lineTo(cx * s, cy * s + s * 0.12)
      g.lineTo(cx * s - s * 0.1, cy * s)
      g.closePath()
      g.fill()
    }
    g.globalAlpha = 0.28
    g.strokeStyle = colour.grid
    g.lineWidth = 1
    g.strokeRect(0.5, 0.5, s - 1, s - 1)
    g.globalAlpha = 1
  },
}

const timber = {
  wall(g, s, colour, rng) {
    g.fillStyle = colour.wall
    g.fillRect(0, 0, s, s)
    // Vertical boards with a dark gap between them, and grain along each.
    const boards = 3
    for (let b = 0; b < boards; b++) {
      const x = (b * s) / boards
      g.globalAlpha = 0.35
      g.fillStyle = colour.edge
      g.fillRect(x, 0, s * 0.02, s)
      g.globalAlpha = 0.14
      g.strokeStyle = rng() > 0.5 ? colour.fg : colour.edge
      g.lineWidth = Math.max(1, s * 0.02)
      g.beginPath()
      const gx = x + s / boards / 2 + (rng() - 0.5) * s * 0.06
      g.moveTo(gx, s * 0.08)
      g.quadraticCurveTo(gx + s * 0.05, s * 0.5, gx, s * 0.92)
      g.stroke()
    }
    g.globalAlpha = 1
    // End bands, so a crate reads as a crate.
    g.globalAlpha = 0.3
    g.fillStyle = colour.edge
    g.fillRect(0, s * 0.08, s, s * 0.05)
    g.fillRect(0, s * 0.87, s, s * 0.05)
    g.globalAlpha = 1
    bevel(g, s, colour, 0.14, 0.24)
    outline(g, s, colour)
  },
  floor(g, s, colour, rng) {
    g.fillStyle = colour.floor
    g.fillRect(0, 0, s, s)
    g.globalAlpha = 0.2
    g.strokeStyle = colour.grid
    g.lineWidth = Math.max(1, s * 0.03)
    // Long boards running across, so the floor grain crosses the wall grain.
    for (let i = 1; i < 3; i++) {
      g.beginPath()
      g.moveTo(0, (i * s) / 3)
      g.lineTo(s, (i * s) / 3)
      g.stroke()
    }
    g.globalAlpha = 0.14
    g.fillStyle = colour.edge
    g.fillRect(rng() * s * 0.8, 0, s * 0.02, s)
    g.globalAlpha = 1
  },
}

const stone = {
  wall(g, s, colour, rng) {
    g.fillStyle = colour.edge
    g.fillRect(0, 0, s, s)
    // Two or three irregular blocks with heavy joints between them.
    const cuts = [0, 0.42 + rng() * 0.16, 1]
    for (let i = 0; i < cuts.length - 1; i++) {
      const y0 = cuts[i] * s
      const y1 = cuts[i + 1] * s
      const inset = s * 0.04
      g.fillStyle = colour.wall
      g.globalAlpha = 0.85 + rng() * 0.15
      g.beginPath()
      g.moveTo(inset + rng() * s * 0.03, y0 + inset)
      g.lineTo(s - inset - rng() * s * 0.03, y0 + inset)
      g.lineTo(s - inset, y1 - inset)
      g.lineTo(inset, y1 - inset - rng() * s * 0.03)
      g.closePath()
      g.fill()
    }
    g.globalAlpha = 1
    bevel(g, s, colour, 0.1, 0.3)
    outline(g, s, colour)
  },
  floor(g, s, colour, rng) {
    g.fillStyle = colour.floor
    g.fillRect(0, 0, s, s)
    g.globalAlpha = 0.24
    g.strokeStyle = colour.grid
    g.lineWidth = Math.max(1, s * 0.035)
    // A single flagstone, nudged, so the floor never tiles too regularly.
    const n = s * (0.1 + rng() * 0.06)
    g.strokeRect(n, n, s - n * 2, s - n * 2)
    g.globalAlpha = 1
  },
}

const slag = {
  wall(g, s, colour, rng) {
    g.fillStyle = colour.wall
    g.fillRect(0, 0, s, s)
    // Angular shards piled up: deliberately the least regular of the six.
    for (let i = 0; i < 5; i++) {
      g.globalAlpha = 0.12 + rng() * 0.2
      g.fillStyle = rng() > 0.5 ? colour.fg : colour.edge
      g.beginPath()
      const cx = rng() * s
      const cy = rng() * s
      const r = s * (0.12 + rng() * 0.2)
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rng() * 0.5
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (k === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.closePath()
      g.fill()
    }
    g.globalAlpha = 1
    bevel(g, s, colour, 0.1, 0.34)
    outline(g, s, colour)
  },
  floor(g, s, colour, rng) {
    g.fillStyle = colour.floor
    g.fillRect(0, 0, s, s)
    g.globalAlpha = 0.16
    for (let i = 0; i < 7; i++) {
      g.fillStyle = rng() > 0.5 ? colour.fg : colour.grid
      g.fillRect(rng() * s, rng() * s, s * 0.06, s * 0.04)
    }
    g.globalAlpha = 0.2
    g.strokeStyle = colour.grid
    g.lineWidth = 1
    g.strokeRect(0.5, 0.5, s - 1, s - 1)
    g.globalAlpha = 1
  },
}

export const MATERIALS = { concrete, brick, steel, timber, stone, slag }

/**
 * Which material each arena is built from, across all three games.
 *
 * Kept in one place because it is art direction, not rules — and because the
 * names have to agree with the ARENAS lists on three separate servers, which is
 * far easier to check when they are all in front of you.
 */
export const ARENA_STYLE = {
  // Fracture Line
  kiln: 'brick',
  substation: 'steel',
  drydock: 'concrete',
  scrapyard: 'slag',
  // Blastworks
  foundry: 'steel',
  magazine: 'brick',
  dryhouse: 'timber',
  scrapline: 'slag',
  // Blockout Royale
  square: 'concrete',
  disc: 'steel',
  diamond: 'stone',
  cross: 'brick',
  ring: 'timber',
  scatter: 'slag',
}

export const styleFor = (arena) => ARENA_STYLE[arena] ?? 'concrete'

// --- damage ----------------------------------------------------------------
// Drawn on top of any material, identically. This is what has to stay readable
// when the colour is thrown away, so it is all geometry and no tint.

/** A fracture running edge to edge, with a lit lip along one side for depth. */
const fracture = (g, s, colour, rng, weight) => {
  const vertical = rng() > 0.5
  const start = 0.2 + rng() * 0.6
  const pts = []
  for (let i = 0; i <= 4; i++) {
    const along = i / 4
    const off = start + (rng() - 0.5) * 0.34
    pts.push(vertical ? [off * s, along * s] : [along * s, off * s])
  }

  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.strokeStyle = colour.fg
  g.globalAlpha = 0.16
  g.lineWidth = s * weight * 1.7
  g.beginPath()
  g.moveTo(pts[0][0] + 1, pts[0][1] + 1)
  for (const [x, y] of pts.slice(1)) g.lineTo(x + 1, y + 1)
  g.stroke()

  g.strokeStyle = colour.edge
  g.globalAlpha = 1
  g.lineWidth = s * weight
  g.beginPath()
  g.moveTo(pts[0][0], pts[0][1])
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y)
  g.stroke()
}

/** A bite taken out of one corner: the slab is physically shorter there. */
const chip = (g, s, colour, rng) => {
  const cx = rng() > 0.5 ? 0 : s
  const cy = rng() > 0.5 ? 0 : s
  const r = s * (0.16 + rng() * 0.12)
  g.fillStyle = colour.floor
  g.beginPath()
  g.moveTo(cx, cy)
  g.lineTo(cx + (cx ? -r : r), cy)
  g.lineTo(cx + (cx ? -r * 0.4 : r * 0.4), cy + (cy ? -r * 0.6 : r * 0.6))
  g.lineTo(cx, cy + (cy ? -r : r))
  g.closePath()
  g.fill()
}

/** A blown-out section with the reinforcement showing through it. */
const spall = (g, s, colour, rng) => {
  const cx = s * (0.3 + rng() * 0.4)
  const cy = s * (0.3 + rng() * 0.4)
  const r = s * 0.3

  g.fillStyle = colour.floor
  g.beginPath()
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const rad = r * (0.6 + rng() * 0.6)
    const x = cx + Math.cos(a) * rad
    const y = cy + Math.sin(a) * rad
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.closePath()
  g.fill()

  g.globalAlpha = 0.22
  g.strokeStyle = colour.fg
  g.lineWidth = Math.max(1, s * 0.035)
  g.stroke()

  g.globalAlpha = 0.75
  g.strokeStyle = colour.muted
  g.lineWidth = Math.max(1, s * 0.035)
  g.beginPath()
  g.moveTo(cx - r * 0.9, cy - r * 0.25)
  g.lineTo(cx + r * 0.9, cy - r * 0.25)
  g.moveTo(cx - r * 0.25, cy - r * 0.9)
  g.lineTo(cx - r * 0.25, cy + r * 0.9)
  g.stroke()
  g.globalAlpha = 1
}

/** The arena boundary. Nothing damages it, so it never wears a damage state. */
const boundary = (g, s, colour) => {
  g.fillStyle = colour.edge
  g.fillRect(0, 0, s, s)
  g.globalAlpha = 0.3
  g.strokeStyle = colour.grid
  g.lineWidth = Math.max(1, s * 0.06)
  g.beginPath()
  for (let i = -1; i < 3; i++) {
    g.moveTo(i * s * 0.5, 0)
    g.lineTo(i * s * 0.5 + s, s)
  }
  g.stroke()
  g.globalAlpha = 1
  g.strokeStyle = colour.grid
  g.lineWidth = 1
  g.strokeRect(0.5, 0.5, s - 1, s - 1)
}

/**
 * Builds every tile for one theme, one cell size and one material. Cheap enough
 * to throw away and rebuild whenever any of the three changes, which is the
 * only time it happens.
 *
 * Returns `border` and `floor` plus `states`, indexed by damage taken: 0 is
 * untouched, 1 has lost a point, 2 is one round from gone. Each state carries a
 * few cuts of the same idea so a wall of slabs does not look stamped.
 */
export function makeWallTiles(colour, px, style = 'concrete') {
  const s = Math.max(8, Math.round(px))
  const mat = MATERIALS[style] ?? MATERIALS.concrete
  const paint = (draw) => {
    const c = document.createElement('canvas')
    c.width = s
    c.height = s
    draw(c.getContext('2d'), s)
    return c
  }

  const intact = [0, 1].map((v) =>
    paint((g) => {
      mat.wall(g, s, colour, seeded(1013 + v * 97))
    }),
  )

  const chipped = [0, 1, 2].map((v) =>
    paint((g) => {
      const rng = seeded(4051 + v * 313)
      mat.wall(g, s, colour, rng)
      fracture(g, s, colour, rng, 0.055)
      chip(g, s, colour, rng)
    }),
  )

  const failing = [0, 1, 2].map((v) =>
    paint((g) => {
      const rng = seeded(7919 + v * 577)
      mat.wall(g, s, colour, rng)
      fracture(g, s, colour, rng, 0.075)
      fracture(g, s, colour, rng, 0.06)
      spall(g, s, colour, rng)
      chip(g, s, colour, rng)
    }),
  )

  return {
    border: paint((g) => boundary(g, s, colour)),
    // A few cuts, so a large open floor does not visibly repeat.
    floor: [0, 1, 2].map((v) =>
      paint((g) => {
        mat.floor(g, s, colour, seeded(2207 + v * 149))
      }),
    ),
    states: [intact, chipped, failing],
  }
}
