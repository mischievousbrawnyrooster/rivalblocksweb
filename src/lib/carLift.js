// How high a car is drawn above the track. Pure and import-free; exercised by
// carLift.test.js. Render only: the rules have no z axis, and a car's height is
// a function of positions the server already sent, never a guess ahead of them.

// A ramp is a wedge RAMP_LENGTH tiles deep, rising to RAMP_HEIGHT at its lip.
// The lip must stay below AIR_LIFT, so a launched car carries on rising off it
// instead of dipping as the jump takes over from the slope.
export const RAMP_HEIGHT = 0.35
export const RAMP_LENGTH = 1
// How high a car rises at the top of a jump, in tiles.
export const AIR_LIFT = 1.2

/**
 * The height of the ramp surface under (x, y), or 0 off every ramp. A ramp is
 * `{ x, y, heading, width }` from the server's welcome, centred on its point and
 * rising the way it faces, which is the way the lap runs.
 */
export function rampLift(ramps, x, y) {
  let best = 0
  for (const r of ramps ?? []) {
    const dx = x - r.x
    const dy = y - r.y
    const along = dx * Math.cos(r.heading) + dy * Math.sin(r.heading)
    const across = -dx * Math.sin(r.heading) + dy * Math.cos(r.heading)
    if (Math.abs(across) > r.width / 2 || Math.abs(along) > RAMP_LENGTH / 2) continue
    best = Math.max(best, (RAMP_HEIGHT * (along + RAMP_LENGTH / 2)) / RAMP_LENGTH)
  }
  return best
}

/**
 * A car's drawn height: the higher of the ramp under it and its jump arc. The
 * higher, not the sum, so a car launched on a ramp rides up the slope and then
 * arcs, with no step where one hands over to the other.
 */
export function carLift(car, ramps) {
  if (!car) return 0
  const air = car.airborne ? Math.sin((car.airT ?? 0) * Math.PI) * AIR_LIFT : 0
  return Math.max(air, rampLift(ramps, car.x, car.y))
}
