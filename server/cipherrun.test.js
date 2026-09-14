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
  VOTE_DURATION_MS,
  calculateWpm,
  calculateRawWpm,
  calculateAccuracy,
  calculateProgress,
  make,
  join,
  leave,
  castVote,
  getVoteTallies,
  resolveVote,
  processInput,
  tick,
  snapshot,
} from './cipherrun.js'

test('PROTOCOLS contains 151 curated in-fiction breach protocols across 3 tiers plus easter egg', () => {
  assert.equal(PROTOCOLS.length, 151)

  const shortTier = PROTOCOLS.filter((p) => p.tier === 1 && p.id <= 50)
  const medTier = PROTOCOLS.filter((p) => p.tier === 2)
  const longTier = PROTOCOLS.filter((p) => p.tier === 3)
  const easterEgg = PROTOCOLS.find((p) => p.id === 151)

  assert.equal(shortTier.length, 50, 'should have 50 Tier 1 Short protocols')
  assert.equal(medTier.length, 50, 'should have 50 Tier 2 Medium protocols')
  assert.equal(longTier.length, 50, 'should have 50 Tier 3 Long protocols')
  assert.ok(easterEgg, 'Protocol 151 easter egg must exist')
  assert.equal(easterEgg.category, 'easter_egg')

  // Verify IDs are sequential 1..151
  for (let i = 0; i < PROTOCOLS.length; i++) {
    assert.equal(PROTOCOLS[i].id, i + 1, `Protocol at index ${i} must have id ${i + 1}`)
  }

  // Word count bounds: Short (15-25 words)
  for (const p of shortTier) {
    const wordCount = p.text.trim().split(/\s+/).length
    assert.ok(wordCount >= 15 && wordCount <= 25, `Protocol ${p.id} word count ${wordCount} must be 15-25`)
  }

  // Word count bounds: Medium (40-60 words)
  for (const p of medTier) {
    const wordCount = p.text.trim().split(/\s+/).length
    assert.ok(wordCount >= 40 && wordCount <= 60, `Protocol ${p.id} word count ${wordCount} must be 40-60`)
  }

  // Word count bounds: Long (85-125 words)
  for (const p of longTier) {
    const wordCount = p.text.trim().split(/\s+/).length
    assert.ok(wordCount >= 85 && wordCount <= 125, `Protocol ${p.id} word count ${wordCount} must be 85-125`)
  }

  // Easter Egg repetition check
  const occurrences = (easterEgg.text.match(/I LOVE RIVALBLOCKS\./g) || []).length
  assert.equal(occurrences, 20, 'Easter Egg must contain I LOVE RIVALBLOCKS. exactly 20 times')

  // Zero em dashes or double dashes in titles or texts
  for (const p of PROTOCOLS) {
    assert.ok(!p.title.includes('—'), `Protocol ${p.id} title must not contain em dash`)
    assert.ok(!p.title.includes('--'), `Protocol ${p.id} title must not contain double dash`)
    assert.ok(!p.text.includes('—'), `Protocol ${p.id} text must not contain em dash`)
    assert.ok(!p.text.includes('--'), `Protocol ${p.id} text must not contain double dash`)
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
  const m = make({ protocolId: 1 })
  const text = m.protocol.text
  const p = join(m, { name: 'Alice' })
  m.phase = 'racing'

  // Type first character correctly, then mistake '§'
  processInput(m, p.id, { key: text[0], cursor: 0 })
  processInput(m, p.id, { key: '§', cursor: 1 })
  assert.equal(p.cursor, 1)

  // Pressing Space jumps to the next word boundary (after the first space)
  processInput(m, p.id, { key: ' ', cursor: 1 })
  const nextWordIndex = text.indexOf(' ') + 1
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

test('castVote records valid votes and rejects invalid tiers or unknown players', () => {
  const m = make()
  const p1 = join(m, { name: 'Alice' })
  const p2 = join(m, { name: 'Bob' })

  assert.equal(castVote(m, p1.id, 1), true)
  assert.equal(m.votes.get(p1.id), 1)

  // Accepts string aliases
  assert.equal(castVote(m, p1.id, 'medium'), true)
  assert.equal(m.votes.get(p1.id), 2)

  assert.equal(castVote(m, p2.id, '3'), true)
  assert.equal(m.votes.get(p2.id), 3)

  // Rejects invalid tiers
  assert.equal(castVote(m, p1.id, 0), false)
  assert.equal(castVote(m, p1.id, 4), false)
  assert.equal(castVote(m, p1.id, 'invalid'), false)
  assert.equal(m.votes.get(p1.id), 2) // Remains unchanged

  // Rejects unknown player ID
  assert.equal(castVote(m, 'unknown-player', 1), false)
})

test('getVoteTallies calculates short, medium, long and total counts', () => {
  const m = make()
  const p1 = join(m, { name: 'Alice' })
  const p2 = join(m, { name: 'Bob' })
  const p3 = join(m, { name: 'Charlie' })

  let t = getVoteTallies(m)
  assert.deepEqual(t, { short: 0, medium: 0, long: 0, total: 0 })

  castVote(m, p1.id, 1)
  castVote(m, p2.id, 1)
  castVote(m, p3.id, 3)

  t = getVoteTallies(m)
  assert.deepEqual(t, { short: 2, medium: 0, long: 1, total: 3 })
})

test('resolveVote selects winning tier by plurality and chooses protocol from that tier', () => {
  const m = make()
  const p1 = join(m, { name: 'Alice' })
  const p2 = join(m, { name: 'Bob' })
  const p3 = join(m, { name: 'Charlie' })

  castVote(m, p1.id, 2)
  castVote(m, p2.id, 2)
  castVote(m, p3.id, 1)

  // deterministic RNG that does not roll easter egg (0.5 >= 0.02)
  const res = resolveVote(m, () => 0.5)
  assert.equal(res.winningTier, 2)
  assert.equal(res.easterEgg, false)
  assert.equal(m.protocol.tier, 2)
  assert.ok(m.protocol.id >= 51 && m.protocol.id <= 100)
  assert.equal(m.easterEgg, false)
})

test('resolveVote breaks ties randomly among top tied tiers', () => {
  const m = make()
  const p1 = join(m, { name: 'Alice' })
  const p2 = join(m, { name: 'Bob' })

  castVote(m, p1.id, 1)
  castVote(m, p2.id, 3)

  // Tie between tier 1 and tier 3.
  let calls = 0
  const rngTier1 = () => {
    calls++
    if (calls === 1) return 0.5 // easter egg check >= 0.02
    if (calls === 2) return 0.0 // candidate index 0 -> tier 1
    return 0.1
  }
  const res1 = resolveVote(m, rngTier1)
  assert.equal(res1.winningTier, 1)
  assert.equal(m.protocol.tier, 1)

  calls = 0
  const rngTier3 = () => {
    calls++
    if (calls === 1) return 0.5 // easter egg check >= 0.02
    if (calls === 2) return 0.99 // candidate index 1 -> tier 3
    return 0.1
  }
  const res3 = resolveVote(m, rngTier3)
  assert.equal(res3.winningTier, 3)
  assert.equal(m.protocol.tier, 3)
})

test('resolveVote triggers Protocol 151 when 2% easter egg roll passes', () => {
  const m = make()
  const p1 = join(m, { name: 'Alice' })
  castVote(m, p1.id, 3)

  // RNG returns 0.01 (< 0.02), triggering Easter Egg
  const res = resolveVote(m, () => 0.01)
  assert.equal(res.easterEgg, true)
  assert.equal(res.protocol.id, 151)
  assert.equal(m.easterEgg, true)
  assert.equal(m.protocol.id, 151)
})

test('tick advances state machine waiting -> voting -> countdown -> racing', () => {
  const m = make({ protocolId: 1 })
  const p = join(m, { name: 'Alice' })

  // First human triggers transition to voting
  tick(m, TICK_MS)
  assert.equal(m.phase, 'voting')
  assert.ok(m.voteTimer <= VOTE_DURATION_MS)

  castVote(m, p.id, 2)

  // Advance through remaining voting timer
  tick(m, VOTE_DURATION_MS)
  assert.equal(m.phase, 'countdown')
  assert.ok(m.countdown <= COUNTDOWN_MS)
  assert.equal(m.protocol.tier, 2)

  // Advance through countdown to racing
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

test('snapshot exposes voteTimer, votes tally, and easterEgg flag', () => {
  const m = make({ protocolId: 1 })
  const p = join(m, { name: 'Alice' })
  tick(m, TICK_MS) // enters voting
  castVote(m, p.id, 1)

  const s = JSON.parse(JSON.stringify(snapshot(m)))
  assert.equal(s.phase, 'voting')
  assert.equal(typeof s.voteTimer, 'number')
  assert.deepEqual(s.votes, { short: 1, medium: 0, long: 0, total: 1 })
  assert.equal(s.easterEgg, false)
})

