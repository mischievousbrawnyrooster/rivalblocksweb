import test from 'node:test'
import assert from 'node:assert/strict'
import { filterSortRegions } from './servers.js'
import { isValidEmail } from './validate.js'

const sample = [
  { id: 'b', label: 'Beta', status: 'operational', players: 10, tickRate: 128, uptime: 99.1 },
  { id: 'a', label: 'Alpha', status: 'degraded', players: 30, tickRate: 64, uptime: 98.0 },
  { id: 'c', label: 'Gamma', status: 'operational', players: 20, tickRate: 128, uptime: 99.9 },
  { id: 'd', label: 'Delta', status: 'maintenance', players: 0, tickRate: 0, uptime: 99.5 },
]

const ids = (rows) => rows.map((r) => r.id)

test('filters by each status', () => {
  assert.deepEqual(ids(filterSortRegions(sample, { status: 'operational' })), ['b', 'c'])
  assert.deepEqual(ids(filterSortRegions(sample, { status: 'degraded' })), ['a'])
  assert.deepEqual(ids(filterSortRegions(sample, { status: 'maintenance' })), ['d'])
})

test('status "all" and no options keep every region', () => {
  assert.equal(filterSortRegions(sample, { status: 'all' }).length, 4)
  assert.equal(filterSortRegions(sample).length, 4)
})

test('sorts by each key', () => {
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'label' })), ['a', 'b', 'd', 'c'])
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'players' })), ['a', 'c', 'b', 'd'])
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'uptime' })), ['c', 'd', 'b', 'a'])
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'tickRate' }))[3], 'd')
})

test('unknown sortBy falls back to label order instead of throwing', () => {
  assert.deepEqual(ids(filterSortRegions(sample, { sortBy: 'nope' })), ['a', 'b', 'd', 'c'])
})

test('a filter matching nothing returns an empty array', () => {
  assert.deepEqual(filterSortRegions(sample, { status: 'on fire' }), [])
})

test('does not mutate or reorder the input array', () => {
  const before = ids(sample)
  filterSortRegions(sample, { sortBy: 'players' })
  assert.deepEqual(ids(sample), before)
})

test('accepts real addresses', () => {
  assert.ok(isValidEmail('player@rivalblocks.gg'))
  assert.ok(isValidEmail('  padded@example.co.uk  '))
})

test('rejects malformed addresses', () => {
  for (const bad of ['', '   ', 'nope', 'no@domain', '@example.com', 'a b@example.com', 'two@@example.com', null, undefined, 42]) {
    assert.equal(isValidEmail(bad), false, `should reject ${JSON.stringify(bad)}`)
  }
})
