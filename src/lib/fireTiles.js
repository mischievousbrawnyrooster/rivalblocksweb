/**
 * Artwork for a blast: a hot core, the arms running out of it, and the tips
 * where each arm ends.
 *
 * Drawn once into offscreen canvases and blitted per tile, the same way the
 * wall slabs are. No image files, per the site's rule — every pixel is
 * generated at runtime from the theme's own tokens, so the fire restyles itself
 * when the theme flips.
 *
 * A blast has to be readable as a blast with the colour thrown away, so the
 * shapes carry it: the core is a burst with tongues on every side, an arm is a
 * banded channel with licks along its length, and a tip is a rounded head. Put
 * together they read as one continuous cross rather than a row of squares.
 */

/** Deterministic noise. The same flame must look the same on every redraw. */
const seeded = (seed) => {
  let s = seed >>> 0
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

/** Three layers hot to cool, so the fire has depth rather than being a fill. */
const LAYERS = [
  { at: 1, key: 'warn', alpha: 0.32 },
  { at: 0.7, key: 'flare', alpha: 0.55 },
  { at: 0.4, key: 'fg', alpha: 0.9 },
]

/** A ragged blob: the shape every part of the fire is built from. */
function blob(g, cx, cy, rx, ry, rng, wobble = 0.22) {
  g.beginPath()
  const steps = 14
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const k = 1 + (rng() - 0.5) * wobble
    const x = cx + Math.cos(a) * rx * k
    const y = cy + Math.sin(a) * ry * k
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.closePath()
  g.fill()
}

/** Tongues licking outward, which is what stops it reading as a plain circle. */
function tongues(g, s, colour, rng, count, spread) {
  g.fillStyle = colour.warn
  g.globalAlpha = 0.3
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.3
    const reach = s * (0.4 + rng() * 0.16)
    g.beginPath()
    g.moveTo(s / 2 + Math.cos(a - spread) * s * 0.2, s / 2 + Math.sin(a - spread) * s * 0.2)
    g.lineTo(s / 2 + Math.cos(a) * reach, s / 2 + Math.sin(a) * reach)
    g.lineTo(s / 2 + Math.cos(a + spread) * s * 0.2, s / 2 + Math.sin(a + spread) * s * 0.2)
    g.closePath()
    g.fill()
  }
  g.globalAlpha = 1
}

/** The tile the bomb itself was on: a burst throwing heat in every direction. */
function core(g, s, colour) {
  const rng = seeded(2749)
  tongues(g, s, colour, rng, 9, 0.5)
  for (const layer of LAYERS) {
    g.fillStyle = colour[layer.key]
    g.globalAlpha = layer.alpha
    blob(g, s / 2, s / 2, s * 0.44 * layer.at, s * 0.44 * layer.at, rng, 0.3)
  }
  g.globalAlpha = 1
}

/**
 * A length of arm. Drawn horizontally and rotated for the vertical run, so the
 * banding always flows along the arm rather than across it.
 */
function arm(g, s, colour, seed) {
  const rng = seeded(seed)
  // Licks along both edges of the channel.
  g.fillStyle = colour.warn
  g.globalAlpha = 0.28
  for (let i = 0; i < 5; i++) {
    const x = s * (0.1 + i * 0.2)
    const up = rng() > 0.5
    const h = s * (0.12 + rng() * 0.16)
    g.beginPath()
    g.moveTo(x - s * 0.08, s / 2)
    g.lineTo(x, up ? s / 2 - h - s * 0.2 : s / 2 + h + s * 0.2)
    g.lineTo(x + s * 0.08, s / 2)
    g.closePath()
    g.fill()
  }
  g.globalAlpha = 1

  for (const layer of LAYERS) {
    g.fillStyle = colour[layer.key]
    g.globalAlpha = layer.alpha
    // Full width so neighbouring tiles join seamlessly, and thin so the arm
    // reads as a channel rather than a filled square.
    blob(g, s / 2, s / 2, s * 0.62, s * 0.4 * layer.at, rng, 0.16)
  }
  g.globalAlpha = 1
}

/** The far end of an arm: the same channel, capped and tapered. */
function tip(g, s, colour, seed) {
  const rng = seeded(seed)
  g.fillStyle = colour.warn
  g.globalAlpha = 0.28
  for (let i = 0; i < 4; i++) {
    const a = -0.9 + (i / 3) * 1.8
    g.beginPath()
    g.moveTo(s * 0.35, s / 2)
    g.lineTo(s * 0.35 + Math.cos(a) * s * 0.55, s / 2 + Math.sin(a) * s * 0.55)
    g.lineTo(s * 0.35 + Math.cos(a + 0.35) * s * 0.2, s / 2 + Math.sin(a + 0.35) * s * 0.2)
    g.closePath()
    g.fill()
  }
  g.globalAlpha = 1

  for (const layer of LAYERS) {
    g.fillStyle = colour[layer.key]
    g.globalAlpha = layer.alpha
    // Pulled back from the outer edge so the arm visibly ends here.
    blob(g, s * 0.42, s / 2, s * 0.44 * layer.at + s * 0.1, s * 0.4 * layer.at, rng, 0.2)
  }
  g.globalAlpha = 1
}

/**
 * Every piece of fire for one theme at one tile size.
 *
 * Returns the core, the two arm runs, and a tip per direction. The caller works
 * out which piece a burning tile needs from its burning neighbours, so none of
 * this has to travel on the wire.
 */
export function makeFireTiles(colour, px) {
  const s = Math.max(8, Math.round(px))
  const paint = (draw) => {
    const c = document.createElement('canvas')
    c.width = s
    c.height = s
    draw(c.getContext('2d'), s)
    return c
  }
  // Rotations of one drawing, so an arm and its tip always match.
  const turned = (draw, turns) =>
    paint((g) => {
      g.translate(s / 2, s / 2)
      g.rotate((turns * Math.PI) / 2)
      g.translate(-s / 2, -s / 2)
      draw(g, s)
    })

  return {
    core: paint((g) => core(g, s, colour)),
    armH: paint((g) => arm(g, s, colour, 5501)),
    armV: turned((g) => arm(g, s, colour, 5501), 1),
    tip: {
      // Indexed east, south, west, north — the order DIRS uses on the server.
      '1,0': turned((g) => tip(g, s, colour, 8837), 0),
      '0,1': turned((g) => tip(g, s, colour, 8837), 1),
      '-1,0': turned((g) => tip(g, s, colour, 8837), 2),
      '0,-1': turned((g) => tip(g, s, colour, 8837), 3),
    },
  }
}

/**
 * The charge itself, before it goes off: a cast iron shell with a collar and a
 * fuse. Drawn once and blitted like everything else here, and deliberately not
 * a plain circle — at this tile size the highlight and the collar are what make
 * it read as an object sitting on the floor rather than a dot painted on it.
 *
 * The spark on the fuse and the countdown ring are drawn live by the caller,
 * because both change every frame and neither belongs in a cached tile.
 */
export function makeBombArt(colour, px) {
  const s = Math.max(8, Math.round(px))
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')
  const r = s * 0.33
  const cx = s / 2
  const cy = s * 0.56

  // A soft contact shadow, so it sits ON the floor.
  g.globalAlpha = 0.28
  g.fillStyle = colour.edge
  g.beginPath()
  g.ellipse(cx, cy + r * 0.86, r * 0.95, r * 0.3, 0, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 1

  // Shell.
  g.fillStyle = colour.edge
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()

  // Lit from the top left, exactly like the wall slabs, so the two agree about
  // where the light in this world comes from.
  g.globalAlpha = 0.22
  g.fillStyle = colour.fg
  g.beginPath()
  g.arc(cx - r * 0.3, cy - r * 0.32, r * 0.34, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 0.1
  g.beginPath()
  g.arc(cx - r * 0.15, cy - r * 0.15, r * 0.72, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 1

  // A rim, so it keeps an edge against a dark floor.
  g.strokeStyle = colour.grid
  g.lineWidth = Math.max(1, s * 0.045)
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.stroke()

  // Collar and fuse.
  g.fillStyle = colour.muted
  g.fillRect(cx - r * 0.28, cy - r * 1.16, r * 0.56, r * 0.34)
  g.strokeStyle = colour.muted
  g.lineWidth = Math.max(1, s * 0.055)
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(cx, cy - r * 1.1)
  g.quadraticCurveTo(cx + r * 0.5, cy - r * 1.5, cx + r * 0.34, cy - r * 1.9)
  g.stroke()

  // Where the caller should put the spark, in tile-relative units.
  return { art: c, fuseX: (cx + r * 0.34) / s, fuseY: (cy - r * 1.9) / s }
}
