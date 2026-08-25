// Every image on this site is generated here. There are no image files.
//
// Columns of isometric cubes drawn as inline SVG from a seeded PRNG, so a
// given seed always renders the same scene — the "screenshots" stay stable
// across reloads and builds.

const HALF_W = 16 // half the width of a cube's top face
const HALF_D = 9 // half its depth
const CH = 22 // extrusion height per cube unit

/** Small deterministic PRNG (mulberry32). Same seed, same scene, always. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Height map per variant. 0 means "no column here" — a hole in the world. */
function buildColumns(variant, seed) {
  const rand = rng(seed)
  const n = variant === 'arena' ? 6 : 7
  const cols = []

  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      let h = 0
      let accent = false
      const r = rand()

      if (variant === 'arena') {
        // A contested floor: mostly low, two tall towers, some blown-out gaps.
        h = r < 0.16 ? 0 : 1 + Math.floor(rand() * 3)
        const tower = (x === 1 && y === 4) || (x === 4 && y === 1)
        if (tower) {
          h = 5
          accent = true
        }
      } else if (variant === 'cavern') {
        // A solid mass with a shaft cut down the middle.
        const shaft = x >= 2 && x <= 4 && y >= 2 && y <= 4
        h = shaft ? 0 : 2 + Math.floor(rand() * 4)
        accent = !shaft && rand() < 0.14 // ore
      } else {
        // platforms: a thin grid that is already falling apart.
        h = r < 0.34 ? 0 : rand() < 0.18 ? 2 : 1
        accent = h > 0 && rand() < 0.1
      }

      if (h > 0) cols.push({ x, y, h, accent })
    }
  }

  // Painter's algorithm: back to front.
  cols.sort((a, b) => a.x + a.y - (b.x + b.y))
  return { cols, n }
}

function Column({ x, y, h, accent }) {
  const sx = (x - y) * HALF_W
  const sy = (x + y) * HALF_D - h * CH
  const ext = h * CH

  const top = accent ? 'var(--flare)' : 'var(--art-top)'
  const left = accent ? 'var(--flare)' : 'var(--art-left)'
  const right = accent ? 'var(--flare)' : 'var(--art-right)'

  return (
    <g>
      <polygon
        points={`${sx},${sy - HALF_D} ${sx + HALF_W},${sy} ${sx},${sy + HALF_D} ${sx - HALF_W},${sy}`}
        fill={top}
      />
      <polygon
        points={`${sx - HALF_W},${sy} ${sx},${sy + HALF_D} ${sx},${sy + HALF_D + ext} ${sx - HALF_W},${sy + ext}`}
        fill={left}
        opacity={accent ? 0.68 : 1}
      />
      <polygon
        points={`${sx},${sy + HALF_D} ${sx + HALF_W},${sy} ${sx + HALF_W},${sy + ext} ${sx},${sy + HALF_D + ext}`}
        fill={right}
        opacity={accent ? 0.45 : 1}
      />
    </g>
  )
}

/**
 * @param {'arena'|'cavern'|'platforms'} variant
 * @param {number} seed          deterministic scene selector
 * @param {string} [title]       when given the SVG is exposed as an image with
 *                               this label; otherwise it is decorative and hidden
 */
export default function BlockArt({ variant = 'arena', seed = 1, title, className = '' }) {
  const { cols, n } = buildColumns(variant, seed)
  const maxH = cols.reduce((m, c) => Math.max(m, c.h), 1)

  const minX = -(n - 1) * HALF_W - HALF_W - 12
  const width = (n - 1) * 2 * HALF_W + 2 * HALF_W + 24
  const minY = -maxH * CH - HALF_D - 12
  const height = maxH * CH + (2 * n - 2) * HALF_D + 2 * HALF_D + 24

  const labelled = Boolean(title)

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      className={className}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : 'true'}
      focusable="false"
    >
      {labelled && <title>{title}</title>}
      <defs>
        <radialGradient id={`glow-${variant}-${seed}`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="var(--flare)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--flare)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect
        x={minX}
        y={minY}
        width={width}
        height={height}
        fill={`url(#glow-${variant}-${seed})`}
      />
      {cols.map((c) => (
        <Column key={`${c.x}-${c.y}`} {...c} />
      ))}
    </svg>
  )
}
