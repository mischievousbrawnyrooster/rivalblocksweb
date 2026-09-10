// How a Blockout Royale 3D floor tile is coloured. Kept out of towerScene.js
// because none of it needs a GPU or a DOM: this decides *which* role a tile
// wears and how much its shade varies, and the renderer resolves a role to an
// actual colour. That split is what makes the precedence below testable.
//
// Colour is never the only signal for any of these states — see the structural
// treatments in towerScene.js (a warned tile sinks and grows a post, a foreseen
// one rises and grows a chevron, a plated one thickens and grows a ring). This
// module is the hue half of a pair, not a status channel on its own.

/**
 * Precedence, most urgent first. A tile is regularly in more than one state at
 * once — plating a tile the wave is already coming for is the whole point of
 * `anchor` — so something has to decide which one the surface wears.
 *
 * `warn` outranks everything because it is the only state with a deadline
 * measured in a second or two. `soon` outranks `plate` for the same reason:
 * knowing a tile is next matters more than knowing it is armoured. Nothing is
 * lost by a plate losing the tint, because a plated tile is also visibly
 * thicker and carries a ring marker of its own.
 */
export const ROLE_ORDER = ['warn', 'soon', 'plate', 'deck']

/**
 * The role a tile's surface wears, given every state it is currently in.
 *
 * @param {{warned?: boolean, foreseen?: boolean, plated?: boolean}} state
 * @returns {'warn'|'soon'|'plate'|'deck'}
 */
export function tileRole({ warned = false, foreseen = false, plated = false } = {}) {
  if (warned) return 'warn'
  if (foreseen) return 'soon'
  if (plated) return 'plate'
  return 'deck'
}

/**
 * How far a single tile's brightness may stray from its deck's tint, either
 * way. Small on purpose: enough that a deck reads as a surface with grain
 * rather than one flat sheet, not enough that a player mistakes a dark tile
 * for a state.
 */
export const SHADE_RANGE = 0.06

/**
 * A tile's brightness multiplier, in `[1 - SHADE_RANGE, 1 + SHADE_RANGE]`.
 *
 * Deterministic in the tile's own stack index, which is the requirement that
 * rules out `Math.random`: a tile that re-rolled its shade every frame would
 * shimmer, and the whole board would crawl. Hashed rather than ramped because
 * a ramp across the index would read as a gradient sweeping the floor; the
 * hash scatters neighbours so it reads as grain.
 *
 * @param {number} index stack index, `z * SIZE * SIZE + y * SIZE + x`
 * @returns {number}
 */
export function tileShade(index) {
  // Math.imul, because these constants overflow 32 bits and plain `*` would
  // silently lose the low bits that carry all the scatter.
  let h = Math.imul(index + 1, 2654435761)
  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = h >>> 0
  const unit = (h % 1000) / 999 // 0..1 inclusive
  return 1 + (unit * 2 - 1) * SHADE_RANGE
}
