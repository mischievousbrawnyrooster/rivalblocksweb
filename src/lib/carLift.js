// How high a car is drawn above the track. Pure and import-free; exercised by
// carLift.test.js. Render only: the rules have no z axis, and a car's height is
// a function of positions the server already sent, never a guess ahead of them.

// A ramp is a wedge RAMP_LENGTH tiles deep, rising to RAMP_HEIGHT at its lip.
export const RAMP_HEIGHT = 0.35
export const RAMP_LENGTH = 1
// How high a jump arcs above the line from the lip to the landing, in tiles.
export const AIR_LIFT = 1.2
// How deep a hole's pit is drawn, and how far a car that fell in sinks.
export const PIT_DEPTH = 2.5

/** The ramp surface under (x, y), or null off every ramp. */
function rampUnder(ramps, x, y) {
  let best = null
  for (const r of ramps ?? []) {
    const dx = x - r.x
    const dy = y - r.y
    const along = dx * Math.cos(r.heading) + dy * Math.sin(r.heading)
    const across = -dx * Math.sin(r.heading) + dy * Math.cos(r.heading)
    if (Math.abs(across) > r.width / 2 || Math.abs(along) > RAMP_LENGTH / 2) continue
    best = Math.max(best ?? 0, (RAMP_HEIGHT * (along + RAMP_LENGTH / 2)) / RAMP_LENGTH)
  }
  return best
}

/**
 * The height of the ramp surface under (x, y), or 0 off every ramp. A ramp is
 * `{ x, y, heading, width }` from the server's welcome, centred on its point and
 * rising the way it faces, which is the way the lap runs.
 */
export const rampLift = (ramps, x, y) => rampUnder(ramps, x, y) ?? 0

/**
 * A car's drawn height.
 *
 * On a ramp it rides the slope. The rules renew a car's flight on every tick it
 * spends on a ramp tile, so airT is still 0 when it leaves the lip; an arc that
 * started from the ground there dropped the car the height of the lip in one
 * frame, and the bumper camera with it. So off the ramp the jump starts at the
 * lip's height and comes down to the ground, with the arc on top.
 *
 * Not covered: a car still in the air when it crosses a second ramp has its
 * flight renewed by the rules, so it is drawn down onto that ramp's slope.
 */
export function carLift(car, ramps) {
  if (!car) return 0
  // Down a hole: it drops away, slowly at first, like a fall.
  if (car.falling) return -PIT_DEPTH * Math.min(1, (car.fallT ?? 0)) ** 2
  const under = rampUnder(ramps, car.x, car.y)
  if (!car.airborne) return under ?? 0
  const t = car.airT ?? 0
  const arc = Math.sin(t * Math.PI) * AIR_LIFT
  if (under !== null) return Math.max(under, arc)
  // A spring hop leaves from the ground; a ramp launch from the lip.
  return (car.hop ? 0 : RAMP_HEIGHT) * (1 - t) + arc
}

/**
 * The heading a car is drawn at. On a pad's jump the server turns the car to
 * face its landing stretch on touchdown; drawn as it is, that would be a snap,
 * so it is turned through the air instead, the short way round, easing in and
 * out over the flight. Every other car is drawn as the server has it.
 */
export function drawnHeading(car) {
  if (!car.airborne || !Number.isFinite(car.land)) return car.heading
  const t = Math.min(1, Math.max(0, car.airT ?? 0))
  const eased = t * t * (3 - 2 * t)
  const d = Math.atan2(Math.sin(car.land - car.heading), Math.cos(car.land - car.heading))
  return car.heading + d * eased
}
