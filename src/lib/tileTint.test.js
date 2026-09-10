import test from 'node:test'
import assert from 'node:assert/strict'

import { ROLE_ORDER, SHADE_RANGE, tileRole, tileShade } from './tileTint.js'

test('a tile in no state at all wears its deck tint', () => {
  assert.equal(tileRole({}), 'deck')
  assert.equal(tileRole(), 'deck', 'and calling it with nothing is the same thing')
})

test('each state alone wears itself', () => {
  assert.equal(tileRole({ warned: true }), 'warn')
  assert.equal(tileRole({ foreseen: true }), 'soon')
  assert.equal(tileRole({ plated: true }), 'plate')
})

test('a warned tile wears its warning whatever else is true of it', () => {
  // The case that matters: anchor exists to plate a tile the wave is already
  // coming for, so this combination is the normal one, not an edge case.
  assert.equal(tileRole({ warned: true, plated: true }), 'warn')
  assert.equal(tileRole({ warned: true, foreseen: true }), 'warn')
  assert.equal(tileRole({ warned: true, foreseen: true, plated: true }), 'warn')
})

test('foresight outranks plating', () => {
  assert.equal(tileRole({ foreseen: true, plated: true }), 'soon')
})

test('precedence follows ROLE_ORDER rather than diverging from it', () => {
  // Guards the documented order against the implementation drifting from it.
  const states = { warn: 'warned', soon: 'foreseen', plate: 'plated' }
  for (let i = 0; i < ROLE_ORDER.length - 1; i++) {
    const winner = ROLE_ORDER[i]
    for (let j = i + 1; j < ROLE_ORDER.length; j++) {
      const loser = ROLE_ORDER[j]
      if (loser === 'deck') continue
      const both = { [states[winner]]: true, [states[loser]]: true }
      assert.equal(tileRole(both), winner, `${winner} should outrank ${loser}`)
    }
  }
})

test('a shade stays inside SHADE_RANGE either side of the deck tint', () => {
  for (let i = 0; i < 845; i++) {
    const s = tileShade(i)
    assert.ok(s >= 1 - SHADE_RANGE, `tile ${i} shaded ${s}, below the floor`)
    assert.ok(s <= 1 + SHADE_RANGE, `tile ${i} shaded ${s}, above the ceiling`)
  }
})

test('a tile shades the same every time it is asked', () => {
  // A tile that re-rolled per frame would shimmer, so this is the property the
  // whole function exists for.
  for (const i of [0, 1, 42, 421, 844]) {
    assert.equal(tileShade(i), tileShade(i))
  }
})

test('shades actually vary, and neighbours are not a ramp', () => {
  // Without this the function could `return 1` and every test above would
  // still pass. It would also pass if the hash were replaced with the index
  // itself, which is why the neighbours are checked separately: a ramp reads
  // as a gradient sweeping the floor, not as grain.
  const shades = []
  for (let i = 0; i < 845; i++) shades.push(tileShade(i))

  const distinct = new Set(shades)
  assert.ok(distinct.size > 400, `only ${distinct.size} distinct shades across 845 tiles`)

  let rising = 0
  for (let i = 1; i < shades.length; i++) if (shades[i] > shades[i - 1]) rising++
  const share = rising / (shades.length - 1)
  assert.ok(
    share > 0.35 && share < 0.65,
    `${(share * 100).toFixed(0)}% of neighbours rise, which is a ramp rather than a scatter`,
  )
})
