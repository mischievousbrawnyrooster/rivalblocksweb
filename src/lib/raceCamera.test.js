import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEWS,
  DEFAULT_VIEW,
  isView,
  nextView,
  toWorld,
  yawFor,
  wheelYawFor,
  angleDelta,
  ease,
  targetPose,
  makeRaceCamera,
  stepCamera,
  chaseClearance,
  CHASE_CLEAR_MAX,
  MAX_DT,
  HEADING_RATE,
} from './raceCamera.js'
import { CAR_LENGTH } from '../../server/cutline.js'

const near = (a, b, why, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${why}: ${a} vs ${b}`)
const sub = (a, b) => a.map((v, i) => v - b[i])
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
const len = (a) => Math.hypot(...a)
const norm = (a) => a.map((v) => v / (len(a) || 1))
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const NOSE = CAR_LENGTH / 2
const car = (x, y, heading) => ({ x, y, heading })

/** Run the camera forward until it has settled, at 60 frames a second. */
function settle(cam, view, c, frames = 600) {
  let pose = null
  for (let i = 0; i < frames; i++) pose = stepCamera(cam, view, c, 1 / 60, NOSE)
  return pose
}

test('game y maps to three.js +z, so the world is not mirrored', () => {
  // Mapping y to -z mirrors the world: a right-hand steer shows as a left turn
  // and the minimap disagrees with the view. Nothing errors when that happens.
  assert.deepEqual(toWorld(3, 7, 2), [3, 2, 7])
})

test('in top-down view the car’s right-hand side is on the right of the screen', () => {
  for (const heading of [-Math.PI / 2, 0, 0.7, 2.4, -2.1]) {
    const cam = makeRaceCamera()
    const pose = settle(cam, 'top', car(40, 40, heading))
    const view = norm(sub(pose.target, pose.position))
    const screenRight = cross(view, pose.up)
    const carRight = [-Math.sin(heading), 0, Math.cos(heading)]
    for (let i = 0; i < 3; i++) near(screenRight[i], carRight[i], `heading ${heading} axis ${i}`, 1e-6)
  }
})

test('in chase view the car’s right-hand side is on the right of the screen', () => {
  for (const heading of [0, 0.7, 2.4, -2.1]) {
    const cam = makeRaceCamera()
    const pose = settle(cam, 'chase', car(40, 40, heading))
    const view = norm(sub(pose.target, pose.position))
    const screenRight = norm(cross(view, pose.up))
    const carRight = [-Math.sin(heading), 0, Math.cos(heading)]
    assert.ok(dot(screenRight, carRight) > 0.99, `heading ${heading}: right-hand side must be screen-right`)
  }
})

test('a car model built facing +x points along its heading', () => {
  // three.js rotates about +y as x' = x cos(a) + z sin(a), z' = -x sin(a) + z cos(a).
  // The model's nose is +x, and it must end up along (cos h, 0, sin h).
  for (const heading of [0, 0.5, 2, -1.3]) {
    const a = yawFor(heading)
    near(Math.cos(a), Math.cos(heading), `cos at ${heading}`)
    near(-Math.sin(a), Math.sin(heading), `sin at ${heading}`)
  }
})

test('steering right turns the front wheels toward the car’s right-hand side', () => {
  // In the model frame the nose is +x and the car's right is +z. A wheel yawed
  // by a points along (cos a, 0, -sin a), so turning right needs -sin a > 0.
  assert.ok(-Math.sin(wheelYawFor(1)) > 0, 'steer +1 must point the wheels right')
  assert.ok(-Math.sin(wheelYawFor(-1)) < 0, 'steer -1 must point the wheels left')
  assert.equal(wheelYawFor(0), 0)
})

test('heading is smoothed along the shortest arc', () => {
  near(angleDelta((179 * Math.PI) / 180, (-179 * Math.PI) / 180), (2 * Math.PI) / 180, 'd', 1e-9)
  near(angleDelta((-179 * Math.PI) / 180, (179 * Math.PI) / 180), (-2 * Math.PI) / 180, 'd', 1e-9)

  const cam = makeRaceCamera()
  stepCamera(cam, 'chase', car(40, 40, (179 * Math.PI) / 180), 1 / 60, NOSE)
  for (let i = 0; i < 120; i++) {
    stepCamera(cam, 'chase', car(40, 40, (-179 * Math.PI) / 180), 1 / 60, NOSE)
    // It must travel the 2 degrees through +/-180, never the 358 through 0.
    assert.ok(Math.abs(Math.cos(cam.heading) + 1) < 0.01, `frame ${i}: camera swung through 0 degrees`)
  }
})

test('smoothing is frame-rate independent', () => {
  // Two half steps land exactly where one full step does, for a still target.
  const k = ease(HEADING_RATE, 1 / 30)
  const k2 = ease(HEADING_RATE, 1 / 60)
  near(1 - k, (1 - k2) * (1 - k2), 'remaining fraction', 1e-12)
})

test('the bumper camera is locked to the car, with no position lag', () => {
  const cam = makeRaceCamera()
  stepCamera(cam, 'bumper', car(40, 40, 0), 1 / 60, NOSE)
  const moved = car(45, 41, 0)
  const pose = stepCamera(cam, 'bumper', moved, 1 / 60, NOSE)
  const want = targetPose('bumper', moved, cam.heading, NOSE)
  for (let i = 0; i < 3; i++) near(pose.position[i], want.position[i], `axis ${i}`)
})

test('switching into bumper is a cut; switching into chase eases', () => {
  const into = makeRaceCamera()
  settle(into, 'chase', car(40, 40, 0))
  const bumper = stepCamera(into, 'bumper', car(40, 40, 0), 1 / 60, NOSE)
  const wantB = targetPose('bumper', car(40, 40, 0), into.heading, NOSE)
  near(bumper.position[0], wantB.position[0], 'bumper x is immediate')

  const out = makeRaceCamera()
  settle(out, 'top', car(40, 40, 0))
  const chase = stepCamera(out, 'chase', car(40, 40, 0), 1 / 60, NOSE)
  const wantC = targetPose('chase', car(40, 40, 0), out.heading, NOSE)
  assert.ok(Math.abs(chase.position[1] - wantC.position[1]) > 1, 'chase must ease, not cut')
})

test('the camera settles on a car that is standing still', () => {
  const cam = makeRaceCamera()
  const c = car(30, 50, 1.1)
  const pose = settle(cam, 'chase', c)
  const want = targetPose('chase', c, 1.1, NOSE)
  for (let i = 0; i < 3; i++) near(pose.position[i], want.position[i], `axis ${i}`, 1e-6)
})

test('up is always perpendicular to the view, including through a view switch', () => {
  // three.js lookAt breaks when up is parallel to the view, and top-down looks
  // straight down while chase uses world up. A switch passes through that case.
  const cam = makeRaceCamera()
  settle(cam, 'chase', car(40, 40, 0.9))
  for (let i = 0; i < 180; i++) {
    const pose = stepCamera(cam, i < 90 ? 'top' : 'chase', car(40, 40, 0.9), 1 / 60, NOSE)
    const view = norm(sub(pose.target, pose.position))
    assert.ok(pose.up.every(Number.isFinite), `frame ${i}: up is not finite`)
    near(len(pose.up), 1, `frame ${i}: up length`, 1e-9)
    assert.ok(Math.abs(dot(pose.up, view)) < 1e-9, `frame ${i}: up is not perpendicular to the view`)
  }
})

test('with no car to follow the camera holds still', () => {
  const fresh = makeRaceCamera()
  assert.equal(stepCamera(fresh, 'chase', null, 1 / 60, NOSE), null, 'never placed, so nothing to show')

  const cam = makeRaceCamera()
  const placed = settle(cam, 'chase', car(40, 40, 0))
  for (const missing of [null, undefined, { x: NaN, y: 3 }, { x: 3 }]) {
    const pose = stepCamera(cam, 'chase', missing, 1 / 60, NOSE)
    assert.deepEqual(pose.position, placed.position, `${JSON.stringify(missing)} must not move the camera`)
  }
})

test('a hostile or enormous frame time never overshoots or produces NaN', () => {
  for (const dt of [0, -1, NaN, Infinity, 600]) {
    const cam = makeRaceCamera()
    settle(cam, 'chase', car(10, 10, 0))
    const before = cam.position[0]
    const pose = stepCamera(cam, 'chase', car(80, 10, 0), dt, NOSE)
    const want = targetPose('chase', car(80, 10, 0), cam.heading, NOSE)
    assert.ok(pose.position.every(Number.isFinite), `dt ${dt}: position went non-finite`)
    const lo = Math.min(before, want.position[0])
    const hi = Math.max(before, want.position[0])
    assert.ok(pose.position[0] >= lo - 1e-9 && pose.position[0] <= hi + 1e-9, `dt ${dt}: overshot`)
  }
  assert.ok(MAX_DT > 0 && MAX_DT <= 0.25)
})

test('a missing heading keeps the last one rather than going to NaN', () => {
  const cam = makeRaceCamera()
  settle(cam, 'chase', car(40, 40, 0.5))
  const pose = stepCamera(cam, 'chase', { x: 40, y: 40 }, 1 / 60, NOSE)
  assert.ok(pose.position.every(Number.isFinite))
  near(cam.heading, 0.5, 'heading kept', 1e-6)
})

test('the chase camera sees over any wall more than a little behind the car', () => {
  assert.ok(
    chaseClearance() < CHASE_CLEAR_MAX,
    `walls closer than ${chaseClearance().toFixed(2)} tiles behind the car block the view`,
  )
})

test('views cycle, and an unknown view falls back to the default', () => {
  assert.equal(nextView('top'), 'chase')
  assert.equal(nextView('chase'), 'bumper')
  assert.equal(nextView('bumper'), 'top')
  assert.equal(nextView('garbage'), DEFAULT_VIEW)
  assert.ok(isView(DEFAULT_VIEW))
  assert.ok(!isView('__proto__'))
  assert.equal(VIEWS.length, 3)
})
