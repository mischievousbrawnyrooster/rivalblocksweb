import test from 'node:test'
import assert from 'node:assert/strict'
import {
  makeCamera,
  orbit,
  worldDir,
  poseFor,
  DIST,
  EYE,
  PITCH_MIN,
  PITCH_MAX,
  ORBIT_SPEED,
} from './followCamera.js'

const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} vs ${b}`)

test('the shipped bug: at the default angle, W does not move you up the grid', () => {
  const cam = makeCamera()
  const [x, y] = worldDir(cam, 0, -1)
  // The old code sent [0, -1] verbatim at every camera angle, which is why W
  // never moved the player up the screen. Anything that returns it unchanged
  // here has reintroduced that.
  assert.ok(Math.abs(x) > 0.1, `W must not stay on the grid axis, got ${x}`)
  near(Math.hypot(x, y), 1, 'and it is still a unit vector')
})

test('facing along the grid, the input passes through unchanged', () => {
  const cam = { yaw: 0, pitch: 0.6 }
  assert.deepEqual(worldDir(cam, 0, -1).map(Math.round), [0, -1], 'W')
  assert.deepEqual(worldDir(cam, 1, 0).map(Math.round), [1, 0], 'D')
  assert.deepEqual(worldDir(cam, 0, 1).map(Math.round), [0, 1], 'S')
  assert.deepEqual(worldDir(cam, -1, 0).map(Math.round), [-1, 0], 'A')
})

test('a quarter turn sends W along the other axis', () => {
  const cam = { yaw: Math.PI / 2, pitch: 0.6 }
  const [x, y] = worldDir(cam, 0, -1)
  near(x, -1, 'W now points along -x')
  near(y, 0, 'and not along y at all')
})

test('a diagonal is not a faster way to travel', () => {
  const cam = makeCamera()
  const straight = worldDir(cam, 0, -1)
  const diagonal = worldDir(cam, 1, -1)
  near(Math.hypot(...straight), 1, 'W alone')
  near(Math.hypot(...diagonal), Math.hypot(1, 1), 'W and D together keep their input magnitude')
})

test('a drag turns the camera and pitch stops at both ends', () => {
  const cam = makeCamera()
  const wasYaw = cam.yaw
  orbit(cam, 100, 0)
  near(cam.yaw, wasYaw - 100 * ORBIT_SPEED, 'yaw follows the drag')

  orbit(cam, 0, -100000)
  assert.equal(cam.pitch, PITCH_MAX, 'never past the top')
  orbit(cam, 0, 100000)
  assert.equal(cam.pitch, PITCH_MIN, 'never under the floor')
})

test('the camera sits behind the body, never beneath its floor', () => {
  const cam = { yaw: 0, pitch: 0.6 }
  const body = { x: 6.5, y: 6.5, z: 2, fall: 0 }
  const gap = 3.4
  const { position, target } = poseFor(cam, body, gap)

  const feet = -(body.z * gap)
  near(target[0], body.x, 'target tracks the body in x')
  near(target[2], body.y, 'and in z')
  near(target[1], feet + EYE, 'looking at eye height')

  // At yaw 0 the camera sits on the +z side, which is behind a body facing -z.
  assert.ok(position[2] > target[2], 'behind the body')
  assert.ok(position[1] > feet, 'above the floor it is standing on')
  const back = Math.hypot(position[0] - target[0], position[2] - target[2])
  assert.ok(back > 0 && back <= DIST, `pulled back by no more than DIST, got ${back}`)
})

test('the camera descends with a body that is mid-drop', () => {
  const cam = makeCamera()
  const gap = 3.4
  const high = poseFor(cam, { x: 6.5, y: 6.5, z: 1, fall: 0 }, gap)
  const mid = poseFor(cam, { x: 6.5, y: 6.5, z: 1, fall: 0.5 }, gap)
  assert.ok(mid.target[1] < high.target[1], 'the target follows the fall')
  near(high.target[1] - mid.target[1], gap * 0.5, 'proportionally, not on landing')
})

test('a body with no fall field is treated as grounded', () => {
  const cam = makeCamera()
  const a = poseFor(cam, { x: 1, y: 1, z: 0 }, 3.4)
  const b = poseFor(cam, { x: 1, y: 1, z: 0, fall: 0 }, 3.4)
  assert.deepEqual(a, b)
})
