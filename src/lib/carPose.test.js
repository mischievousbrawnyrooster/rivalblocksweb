import test from 'node:test'
import assert from 'node:assert/strict'
import { makePose, stepPose, MAX_ROLL, MAX_PITCH, BOUNCE_KICK } from './carPose.js'

const FRAME = 1 / 60

/** Run a pose through `seconds` of frames, `at(t)` giving the car each frame. */
function run(pose, seconds, at) {
  for (let t = 0; t < seconds; t += FRAME) stepPose(pose, at(t), FRAME)
  return pose
}

test('a car standing still sits flat', () => {
  const pose = run(makePose(), 1, () => ({ heading: 0.4, speed: 0 }))
  // Near zero, not equal: strict equal is Object.is, and -0 is not 0.
  for (const k of ['roll', 'pitch', 'bounce']) assert.ok(Math.abs(pose[k]) < 1e-12, `${k} is ${pose[k]}`)
})

test('the body leans out of a turn, whichever way it turns', () => {
  // Heading rising is a right turn (steer +1); the body leans left, outward.
  const right = run(makePose(), 0.5, (t) => ({ heading: t * 2, speed: 10 }))
  const left = run(makePose(), 0.5, (t) => ({ heading: -t * 2, speed: 10 }))
  assert.ok(right.roll > 0, `a right turn leans left: ${right.roll}`)
  assert.ok(left.roll < 0, `a left turn leans right: ${left.roll}`)
})

test('the nose lifts under throttle and dips under braking', () => {
  const up = run(makePose(), 0.3, (t) => ({ heading: 0, speed: t * 15 }))
  const down = run(makePose(), 0.3, (t) => ({ heading: 0, speed: 14 - t * 15 }))
  assert.ok(up.pitch > 0, `accelerating: ${up.pitch}`)
  assert.ok(down.pitch < 0, `braking: ${down.pitch}`)
})

test('lean and pitch never pass their limits', () => {
  const pose = run(makePose(), 0.5, (t) => ({ heading: t * 40, speed: 30 + t * 200 }))
  assert.ok(Math.abs(pose.roll) <= MAX_ROLL + 1e-12, `roll ${pose.roll}`)
  assert.ok(Math.abs(pose.pitch) <= MAX_PITCH + 1e-12, `pitch ${pose.pitch}`)
})

test('touching down dips the body, and it settles within half a second', () => {
  const pose = makePose()
  stepPose(pose, { heading: 0, speed: 10, airborne: true }, FRAME)
  stepPose(pose, { heading: 0, speed: 10, airborne: true }, FRAME)
  stepPose(pose, { heading: 0, speed: 10, airborne: false }, FRAME)
  assert.ok(pose.bounce < 0, `landing must dip: ${pose.bounce}`)
  run(pose, 0.5, () => ({ heading: 0, speed: 10 }))
  assert.ok(Math.abs(pose.bounce) < BOUNCE_KICK * 0.1, `still bouncing after 0.5 s: ${pose.bounce}`)
})

test('a tab coming back after seconds away, or a bad dt, leaves the pose finite and in bounds', () => {
  const pose = makePose()
  stepPose(pose, { heading: 0, speed: 10 }, FRAME)
  for (const dt of [5, 0, -1, NaN, Infinity]) {
    stepPose(pose, { heading: 3, speed: 0, airborne: false }, dt)
    for (const k of ['roll', 'pitch', 'bounce']) assert.ok(Number.isFinite(pose[k]), `${k} went non finite at dt ${dt}`)
    assert.ok(Math.abs(pose.roll) <= MAX_ROLL + 1e-12)
    assert.ok(Math.abs(pose.pitch) <= MAX_PITCH + 1e-12)
  }
})
