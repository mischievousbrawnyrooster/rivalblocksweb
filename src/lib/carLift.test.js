import test from 'node:test'
import assert from 'node:assert/strict'
import { rampLift, carLift, RAMP_HEIGHT, RAMP_LENGTH, AIR_LIFT } from './carLift.js'
import { TOP_SPEED, AIR_MS } from '../../server/cutline.js'

const near = (a, b, why, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${why}: ${a} vs ${b}`)
const ramp = (x, y, heading, width = 5) => ({ x, y, heading, width })

test('a ramp rises the way it faces, from nothing to its lip', () => {
  const r = [ramp(10, 10, 0)]
  near(rampLift(r, 10 - RAMP_LENGTH / 2, 10), 0, 'foot')
  near(rampLift(r, 10, 10), RAMP_HEIGHT / 2, 'middle')
  near(rampLift(r, 10 + RAMP_LENGTH / 2, 10), RAMP_HEIGHT, 'lip')
})

test('a ramp rises the way it faces at any heading', () => {
  for (const heading of [Math.PI / 2, -2.3, 3.0]) {
    const f = [Math.cos(heading), Math.sin(heading)]
    const r = [ramp(20, 30, heading)]
    const at = (d) => rampLift(r, 20 + f[0] * d, 30 + f[1] * d)
    near(at(-RAMP_LENGTH / 2), 0, `foot at ${heading}`)
    near(at(RAMP_LENGTH / 4), RAMP_HEIGHT * 0.75, `three quarters at ${heading}`)
    assert.ok(at(0.4) > at(-0.4), `heading ${heading}: must climb in the facing direction`)
  }
})

test('nothing is lifted beside, before or beyond a ramp', () => {
  const r = [ramp(10, 10, 0, 5)]
  assert.equal(rampLift(r, 10, 10 + 2.6), 0, 'beyond its width')
  assert.equal(rampLift(r, 10 - RAMP_LENGTH, 10), 0, 'before its foot')
  assert.equal(rampLift(r, 10 + RAMP_LENGTH, 10), 0, 'past its lip')
  assert.equal(rampLift([], 10, 10), 0, 'no ramps at all')
  assert.equal(rampLift(undefined, 10, 10), 0, 'a welcome with no ramp list')
})

test('a car is drawn at the higher of the ramp under it and its jump', () => {
  const r = [ramp(10, 10, 0)]
  near(carLift({ x: 10, y: 10, airborne: false }, r), RAMP_HEIGHT / 2, 'on the ramp, not yet launched')
  near(carLift({ x: 40, y: 40, airborne: true, airT: 0.5 }, r), RAMP_HEIGHT / 2 + AIR_LIFT, 'top of a jump')
  near(carLift({ x: 10.5, y: 10, airborne: true, airT: 0 }, r), RAMP_HEIGHT, 'launched at the lip, not dropped to the ground')
  assert.equal(carLift({ x: 40, y: 40, airborne: false }, r), 0, 'on flat track')
  assert.equal(carLift(null, r), 0, 'no car')
})

// The rules renew a car's flight on every tick it spends on a ramp tile, so
// airT is still 0 at the moment it leaves the lip. A jump arc that starts from
// the ground there drops the car the height of the lip in one frame, and the
// bumper camera drops with it.
test('a car leaving the lip is drawn at the lip, not dropped to the ground', () => {
  const r = [ramp(10, 10, 0)]
  near(carLift({ x: 10 + RAMP_LENGTH / 2 + 0.01, y: 10, airborne: true, airT: 0 }, r), RAMP_HEIGHT, 'just past the lip', 1e-6)
  near(carLift({ x: 30, y: 10, airborne: true, airT: 1 }, r), 0, 'landing')
})

test('crossing a ramp at speed never drops the car between two frames', () => {
  // The steepest natural descent, just before landing at top speed, is under
  // 0.1 tiles a frame. The lip drop this guards against was 0.27.
  const MAX_FRAME_DROP = 0.15
  const r = [ramp(10, 10, 0)]
  const perFrame = TOP_SPEED / 60
  const flight = (TOP_SPEED * AIR_MS) / 1000
  const lip = 10 + RAMP_LENGTH / 2
  let last = 0
  for (let x = 8; x < lip + flight + 1; x += perFrame) {
    const under = Math.abs(x - 10) <= RAMP_LENGTH / 2
    const airT = x > lip ? Math.min(1, (x - lip) / flight) : 0
    const lift = carLift({ x, y: 10, airborne: under || (x > lip && airT < 1), airT }, r)
    assert.ok(last - lift < MAX_FRAME_DROP, `x ${x.toFixed(2)}: fell from ${last.toFixed(3)} to ${lift.toFixed(3)} in one frame`)
    last = lift
  }
  near(last, 0, 'back on the ground after landing')
})
