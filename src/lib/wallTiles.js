/**
 * Artwork for the arena's cover: a cast concrete slab in three states of
 * failure, plus the indestructible boundary.
 *
 * Drawn once into offscreen canvases and blitted per cell, rather than pathed
 * per cell per frame — at 960 cells and 30 Hz the second one is real work, and
 * this way the art can afford detail it could never afford inline.
 *
 * No image files, per the site's rule: every pixel here is generated at runtime
 * from the theme's own tokens, so the slabs restyle themselves when the theme
 * flips and there is nothing binary to ship.
 *
 * The three states must be told apart with the colour thrown away, so each one
 * differs in STRUCTURE and not in tint: intact is unbroken, chipped carries a
 * fracture and a bitten corner, failing has a chunk missing with the aggregate
 * showing through.
 */

/** Deterministic noise. The same slab must look the same on every redraw. */
const seeded = (seed) => {
  let s = seed >>> 0
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}

const surface = (g, s, colour, rng) => {
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

  // A raised block: lit from the top left, shadowed at the bottom right.
  g.globalAlpha = 0.13
  g.fillStyle = colour.fg
  g.fillRect(0, 0, s, s * 0.1)
  g.fillRect(0, 0, s * 0.1, s)
  g.globalAlpha = 0.32
  g.fillStyle = colour.edge
  g.fillRect(0, s - s * 0.13, s, s * 0.13)
  g.fillRect(s - s * 0.13, 0, s * 0.13, s)

  g.globalAlpha = 1
  g.strokeStyle = colour.grid
  g.lineWidth = 1
  g.strokeRect(0.5, 0.5, s - 1, s - 1)
}

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

  // A lit rim on the upper edge of the hollow, so it reads as depth.
  g.globalAlpha = 0.22
  g.strokeStyle = colour.fg
  g.lineWidth = Math.max(1, s * 0.035)
  g.stroke()

  // Reinforcement bars crossing the gap.
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
 * Builds every tile for one theme at one cell size. Cheap enough to throw away
 * and rebuild whenever either changes, which is the only time it happens.
 *
 * Returns `border` plus `states`, indexed by damage taken: 0 is untouched,
 * 1 has lost a point, 2 is one round from gone. Each state carries a few cuts
 * of the same idea so a wall of slabs does not look stamped.
 */
export function makeWallTiles(colour, px) {
  const s = Math.max(8, Math.round(px))
  const paint = (draw) => {
    const c = document.createElement('canvas')
    c.width = s
    c.height = s
    draw(c.getContext('2d'), s)
    return c
  }

  const intact = [0, 1].map((v) =>
    paint((g) => {
      surface(g, s, colour, seeded(1013 + v * 97))
    }),
  )

  const chipped = [0, 1, 2].map((v) =>
    paint((g) => {
      const rng = seeded(4051 + v * 313)
      surface(g, s, colour, rng)
      fracture(g, s, colour, rng, 0.055)
      chip(g, s, colour, rng)
    }),
  )

  const failing = [0, 1, 2].map((v) =>
    paint((g) => {
      const rng = seeded(7919 + v * 577)
      surface(g, s, colour, rng)
      fracture(g, s, colour, rng, 0.075)
      fracture(g, s, colour, rng, 0.06)
      spall(g, s, colour, rng)
      chip(g, s, colour, rng)
    }),
  )

  return { border: paint((g) => boundary(g, s, colour)), states: [intact, chipped, failing] }
}
