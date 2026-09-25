// How a car's body sits on its wheels: lean, pitch and bounce. Pure and
// import-free; exercised by carPose.test.js. Render only: every input is a
// value from a snapshot the page has already received, and nothing here
// guesses ahead of one. The rules have no body roll, the same way they have
// no ramp height (carLift.js).

export const MAX_ROLL = 0.1          // rad, about 6 degrees
export const MAX_PITCH = 0.05        // rad, about 3 degrees
export const BOUNCE_KICK = 0.12      // tiles the body dips on touchdown
const ROLL_PER_ACCEL = 0.006         // rad of lean per tile/s² sideways
const PITCH_PER_ACCEL = 0.004        // rad of pitch per tile/s² forward
const EASE = 10                      // 1/s: how fast lean and pitch follow
const SPRING = 90                    // 1/s²: suspension stiffness
const DAMP = 14                      // 1/s: how fast the bounce settles, a little under critical
const MAX_DT = 0.05                  // a longer frame is stepped as this, so nothing overshoots

const clamp = (v, m) => Math.max(-m, Math.min(m, v))

export function makePose() {
  return { heading: null, speed: 0, airborne: false, roll: 0, pitch: 0, bounce: 0, bounceV: 0 }
}

/**
 * Advance one car's body by one frame. `car` is `{ heading, speed, airborne }`
 * from the sampled snapshot. Sideways acceleration is speed times yaw rate;
 * forward acceleration is the change in an eased speed, because `speed` arrives
 * in steps at the snapshot rate and its raw difference would twitch.
 */
export function stepPose(pose, car, dt) {
  const heading = Number.isFinite(car?.heading) ? car.heading : 0
  const speed = Number.isFinite(car?.speed) ? car.speed : 0
  const airborne = Boolean(car?.airborne)
  if (!(dt > 0)) return pose
  const h = Math.min(dt, MAX_DT)

  if (pose.heading === null) {
    pose.heading = heading
    pose.speed = speed
    pose.airborne = airborne
    return pose
  }

  const k = 1 - Math.exp(-EASE * h)
  const yawRate = Math.atan2(Math.sin(heading - pose.heading), Math.cos(heading - pose.heading)) / h
  const eased = pose.speed + (speed - pose.speed) * k
  const forward = (eased - pose.speed) / h

  pose.roll += (clamp(speed * yawRate * ROLL_PER_ACCEL, MAX_ROLL) - pose.roll) * k
  pose.pitch += (clamp(forward * PITCH_PER_ACCEL, MAX_PITCH) - pose.pitch) * k

  // Touchdown dips the body; a damped spring brings it back.
  if (pose.airborne && !airborne) pose.bounce = -BOUNCE_KICK
  pose.bounceV += (-SPRING * pose.bounce - DAMP * pose.bounceV) * h
  pose.bounce += pose.bounceV * h

  pose.heading = heading
  pose.speed = eased
  pose.airborne = airborne
  return pose
}
