import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROTOCOLS,
  TICK_MS,
  COUNTDOWN_MS,
  POST_RACE_GRACE_MS,
  LOCKOUT_MS,
  CONSECUTIVE_ERROR_LIMIT,
  MAX_PLAYERS,
  BOT_FILL_TO,
  calculateWpm,
  calculateRawWpm,
  calculateAccuracy,
  calculateProgress,
  make,
  join,
  leave,
  processInput,
  tick,
  snapshot,
} from './cipherrun.js'

test('PROTOCOLS contains 18 curated in-fiction breach protocols across 3 tiers', () => {
  assert.equal(PROTOCOLS.length, 18)
  for (const p of PROTOCOLS) {
    assert.ok(typeof p.id === 'number')
    assert.ok(typeof p.title === 'string' && p.title.length > 0)
    assert.ok([1, 2, 3].includes(p.tier))
    assert.ok(typeof p.text === 'string' && p.text.length >= 50)
  }
})

test('typing math calculates WPM, Raw WPM, and Accuracy to Monkeytype standard', () => {
  // 50 correct characters in 15 seconds (0.25 min) = (50 / 5) / 0.25 = 40 WPM
  assert.equal(calculateWpm(50, 15000), 40)
  assert.equal(calculateWpm(100, 30000), 40)
  assert.equal(calculateWpm(0, 5000), 0)

  // Raw WPM counts all keystrokes: 60 keystrokes in 15 seconds = 48 Raw WPM
  assert.equal(calculateRawWpm(60, 15000), 48)

  // Accuracy: 50 correct out of 55 total keystrokes = ~90.9%
  assert.equal(calculateAccuracy(50, 55), 90.9)
  assert.equal(calculateAccuracy(50, 50), 100)
  assert.equal(calculateAccuracy(0, 0), 100)

  // Progress: 50 characters of 200 total characters = 25%
  assert.equal(calculateProgress(50, 200), 25)
  assert.equal(calculateProgress(200, 200), 100)
})

test('make() initializes match in waiting phase with default protocol', () => {
  const m = make({ protocolId: 1 })
  assert.equal(m.phase, 'waiting')
  assert.equal(m.protocol.id, 1)
  assert.equal(m.players.size, 0)
  assert.equal(m.winner, null)
  assert.equal(m.elapsed, 0)
  assert.equal(m.countdown, COUNTDOWN_MS)
})

test('join() and leave() handle player roster and slot assignment', () => {
  const m = make()
  const p1 = join(m, { name: 'Alice' })
  assert.ok(p1)
  assert.equal(p1.name, 'Alice')
  assert.equal(p1.slot, 0)
  assert.equal(p1.avatar, 0)
  assert.equal(m.players.size, 1)

  const p2 = join(m, { name: 'Bob', avatar: 3 })
  assert.equal(p2.slot, 1)
  assert.equal(p2.avatar, 3)
  assert.equal(m.players.size, 2)

  const s = snapshot(m)
  assert.equal(s.players[0].avatar, 0)
  assert.equal(s.players[1].avatar, 3)

  leave(m, p1.id)
  assert.equal(m.players.size, 1)
  assert.equal(m.players.has(p1.id), false)
})

test('processInput matches characters and advances cursor', () => {
  const m = make({ protocolId: 1 })
  const text = m.protocol.text
  const p = join(m, { name: 'Alice' })
  m.phase = 'racing'

  // Type first character correctly
  const ok = processInput(m, p.id, { key: text[0], cursor: 0 })
  assert.equal(ok, true)
  assert.equal(p.cursor, 1)
  assert.equal(p.correctKeystrokes, 1)
  assert.equal(p.totalKeystrokes, 1)
  assert.equal(p.consecutiveErrors, 0)
})

test('processInput handles typos, increments error counts, and triggers glitch lockout', () => {
  const m = make({ protocolId: 1 })
  const p = join(m, { name: 'Alice' })
  m.phase = 'racing'

  // Typo 1
  processInput(m, p.id, { key: '§', cursor: 0 })
  assert.equal(p.cursor, 0, 'cursor must not advance on typo without spacebar')
  assert.equal(p.consecutiveErrors, 1)
  assert.equal(p.totalErrors, 1)
  assert.equal(p.lockoutUntil, 0)

  // Typo 2
  processInput(m, p.id, { key: '§', cursor: 0 })
  assert.equal(p.consecutiveErrors, 2)
  assert.equal(p.lockoutUntil, 0)

  // Typo 3: triggers Glitch Breaker Lockout
  processInput(m, p.id, { key: '§', cursor: 0 })
  assert.equal(p.consecutiveErrors, CONSECUTIVE_ERROR_LIMIT)
  assert.ok(p.lockoutUntil > m.now)

  // Keystrokes rejected during lockout
  const rejected = processInput(m, p.id, { key: m.protocol.text[0], cursor: 0 })
  assert.equal(rejected, false)
  assert.equal(p.cursor, 0)

  // Advance time past lockout
  m.now = p.lockoutUntil + 1
  const accepted = processInput(m, p.id, { key: m.protocol.text[0], cursor: 0 })
  assert.equal(accepted, true)
  assert.equal(p.cursor, 1)
  assert.equal(p.consecutiveErrors, 0)
})

test('processInput Backspace rewinds cursor and clears errors', () => {
  const m = make({ protocolId: 1 })
  const p = join(m, { name: 'Alice' })
  m.phase = 'racing'

  processInput(m, p.id, { key: m.protocol.text[0], cursor: 0 })
  assert.equal(p.cursor, 1)

  processInput(m, p.id, { key: 'Backspace', cursor: 1 })
  assert.equal(p.cursor, 0)
})

test('processInput Spacebar jumps to next word when errors exist', () => {
  const m = make({ protocolId: 1 }) // First word is "Access" followed by space
  const p = join(m, { name: 'Alice' })
  m.phase = 'racing'

  // Type 'A', then mistake 'z'
  processInput(m, p.id, { key: 'A', cursor: 0 })
  processInput(m, p.id, { key: 'z', cursor: 1 })
  assert.equal(p.cursor, 1)

  // Pressing Space jumps to the next word boundary (after the first space)
  processInput(m, p.id, { key: ' ', cursor: 1 })
  const nextWordIndex = m.protocol.text.indexOf(' ') + 1
  assert.equal(p.cursor, nextWordIndex)
})

test('reaching the end of the text completes breach and declares winner', () => {
  const m = make({ protocolId: 1 })
  // Set short custom text for test
  m.protocol = { id: 99, title: 'Test', tier: 1, text: 'Go' }
  const p = join(m, { name: 'Alice' })
  m.phase = 'racing'
  m.elapsed = 2000

  processInput(m, p.id, { key: 'G', cursor: 0 })
  assert.equal(p.finished, false)

  processInput(m, p.id, { key: 'o', cursor: 1 })
  assert.equal(p.finished, true)
  assert.equal(p.finishTime, 2000)
  assert.equal(m.winner, p.id)
  assert.equal(m.phase, 'over')
})

test('tick advances countdown from waiting/countdown to racing', () => {
  const m = make({ protocolId: 1 })
  join(m, { name: 'Alice' })

  // First human triggers countdown
  tick(m, TICK_MS)
  assert.equal(m.phase, 'countdown')
  assert.ok(m.countdown <= COUNTDOWN_MS)

  // Advance through remaining countdown
  tick(m, COUNTDOWN_MS)
  assert.equal(m.phase, 'racing')
  assert.equal(m.countdown, 0)
})

test('driveBots simulates realistic keystrokes advancing bot progress', () => {
  const m = make({ protocolId: 1 })
  m.protocol = { id: 99, title: 'Test', tier: 1, text: 'The quick brown fox jumps' }
  join(m, { name: 'Alice' })
  m.phase = 'racing'

  // Run ticks to allow bots to seat and type
  for (let i = 0; i < 40; i++) {
    tick(m, TICK_MS, () => 0.5)
  }

  const bots = [...m.players.values()].filter((p) => p.bot)
  assert.ok(bots.length > 0, 'bots should be seated')
  assert.ok(bots.some((b) => b.cursor > 0), 'bots should have typed characters')
})

test('snapshot produces JSON-safe public frame with progress and telemetry', () => {
  const m = make({ protocolId: 1 })
  const p = join(m, { name: 'Alice' })
  m.phase = 'racing'
  m.elapsed = 4500

  const s = JSON.parse(JSON.stringify(snapshot(m)))
  assert.equal(s.t, 'snap')
  assert.equal(s.phase, 'racing')
  assert.equal(s.protocol.id, 1)
  assert.equal(s.players.length, 1)
  assert.equal(s.players[0].name, 'Alice')
  assert.equal(typeof s.players[0].wpm, 'number')
  assert.equal(typeof s.players[0].progress, 'number')
})
