// Tab icons, drawn rather than filed.
//
// No image files anywhere in this project, favicons included — these are SVG
// source turned into a data URI at runtime. That also means they cost no
// request and cannot 404.
//
// Each one carries its own dark ground rather than sitting transparent on the
// tab bar. A transparent mark disappears against whichever bar the browser
// happens to draw, and there is no media query to save you inside a favicon.
//
// Drawn on a 32 unit grid and read at sixteen pixels, so every shape here is
// deliberately blunt: solid blocks, one seam, no strokes thinner than three
// units and no detail that survives being halved.

const GROUND = '#16161a' // --bg
const FLARE = '#ff6b1a' // --flare
const PAPER = '#ecebe6' // --fg

const wrap = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
  `<rect width="32" height="32" fill="${GROUND}"/>${body}</svg>`

export const MARKS = {
  // The studio: two blocks laying claim to the same corner. The site's own
  // mark is a single flare square, and this is that square with a rival.
  rivalblocks: wrap(
    `<rect x="4" y="4" width="13" height="13" fill="${FLARE}"/>` +
      `<rect x="15" y="15" width="13" height="13" fill="${PAPER}"/>`,
  ),

  // Blockout Royale: four tiles of floor with one already gone. The whole game
  // in one missing square.
  blockout: wrap(
    `<rect x="4" y="4" width="11" height="11" fill="${FLARE}"/>` +
      `<rect x="17" y="4" width="11" height="11" fill="${FLARE}"/>` +
      `<rect x="4" y="17" width="11" height="11" fill="${FLARE}"/>`,
  ),

  // Fracture Line: cover, split. The seam is cut out of the tile rather than
  // drawn over it, so it reads as a break and not as a scratch.
  fracture: wrap(
    `<rect x="4" y="4" width="24" height="24" fill="${FLARE}"/>` +
      `<path d="M15 4 L11 12 L18 17 L13 28" stroke="${GROUND}" stroke-width="3.5" fill="none"/>`,
  ),

  // Blastworks: the cross a charge throws, with the charge still in it. Never
  // a square — the whole point of the game is that a blast has arms.
  blastworks: wrap(
    `<rect x="13" y="4" width="6" height="24" fill="${FLARE}"/>` +
      `<rect x="4" y="13" width="24" height="6" fill="${FLARE}"/>` +
      `<circle cx="16" cy="16" r="4" fill="${PAPER}"/>`,
  ),
}

/**
 * A mark as something a `<link rel="icon">` will take.
 *
 * Encoded rather than base64: it stays readable in the page source, and the
 * `#` in every colour would otherwise cut the URI short at the first one.
 */
export const markHref = (name) =>
  `data:image/svg+xml,${encodeURIComponent(MARKS[name] ?? MARKS.rivalblocks)}`
