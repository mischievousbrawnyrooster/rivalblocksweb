import test from 'node:test'
import assert from 'node:assert/strict'
import { rampLift, carLift, RAMP_HEIGHT, RAMP_LENGTH, AIR_LIFT } from './carLift.js'

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
  near(carLift({ x: 40, y: 40, airborne: true, airT: 0.5 }, r), AIR_LIFT, 'top of a jump')
  near(carLift({ x: 10.5, y: 10, airborne: true, airT: 0 }, r), RAMP_HEIGHT, 'launched at the lip, not dropped to the ground')
  assert.equal(carLift({ x: 40, y: 40, airborne: false }, r), 0, 'on flat track')
  assert.equal(carLift(null, r), 0, 'no car')
})

test('the lip is lower than the jump it launches, so a launched car rises off it', () => {
  assert.ok(RAMP_HEIGHT < AIR_LIFT)
})
