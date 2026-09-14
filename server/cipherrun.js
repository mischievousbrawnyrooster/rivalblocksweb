// Pure authoritative rules engine for Cipher Run. Zero external imports, zero Node APIs,
// zero sockets, zero timers, zero I/O. Everything here is exercised by cipherrun.test.js.

export const TICK_MS = 33 // ~30 Hz tick loop
export const COUNTDOWN_MS = 5000 // 5-second synchronized start
export const POST_RACE_GRACE_MS = 6000 // 6 seconds to view finish standings
export const LOCKOUT_MS = 350 // Terminal static freeze on consecutive errors
export const CONSECUTIVE_ERROR_LIMIT = 3
export const MAX_PLAYERS = 8
export const BOT_FILL_TO = 4
export const BOT_NAMES = ['ZeroCool', 'AcidBurn', 'Crash', 'Phantom', 'Vector', 'Cereal', 'Daemon']

// --- Curated Mainframe Protocols ------------------------------------------
import { PROTOCOLS } from './cipherrun-protocols.js'
export { PROTOCOLS }


// --- Typing Mathematics (Monkeytype Standard) ------------------------------

/** Standard WPM: (correct characters / 5) / (elapsed minutes) */
export function calculateWpm(correctChars, elapsedMs) {
  if (!elapsedMs || elapsedMs <= 0 || !correctChars || correctChars <= 0) return 0
  const minutes = elapsedMs / 60000
  const words = correctChars / 5
  return Math.round((words / minutes) * 10) / 10
}

/** Raw / Gross WPM: (total keystrokes / 5) / (elapsed minutes) */
export function calculateRawWpm(totalKeystrokes, elapsedMs) {
  if (!elapsedMs || elapsedMs <= 0 || !totalKeystrokes || totalKeystrokes <= 0) return 0
  const minutes = elapsedMs / 60000
  const words = totalKeystrokes / 5
  return Math.round((words / minutes) * 10) / 10
}

/** Accuracy Percentage: (correct characters / total keystrokes) * 100 */
export function calculateAccuracy(correctChars, totalKeystrokes) {
  if (!totalKeystrokes || totalKeystrokes <= 0) return 100
  return Math.round((correctChars / totalKeystrokes) * 1000) / 10
}

/** Progress Percentage: (cursor / total characters) * 100 */
export function calculateProgress(cursor, totalLength) {
  if (!totalLength || totalLength <= 0) return 0
  return Math.min(100, Math.round((cursor / totalLength) * 1000) / 10)
}

// --- Name Sanitization ----------------------------------------------------
function isPrintable(ch) {
  const code = ch.charCodeAt(0)
  return code >= 32 && code !== 127
}

export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    .slice(0, 256)
    .split('')
    .filter(isPrintable)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return clean ? clean.slice(0, 16) : 'Operator'
}

// --- Match Creation -------------------------------------------------------
export function make(options = {}) {
  const protocolId = options.protocolId ?? 1
  const protocol = PROTOCOLS.find((p) => p.id === protocolId) ?? PROTOCOLS[0]

  return {
    protocol,
    players: new Map(),
    nextSlot: 0,
    nextId: 1,
    seq: 0,
    phase: 'waiting', // waiting | countdown | racing | over
    countdown: COUNTDOWN_MS,
    elapsed: 0,
    now: 0,
    winner: null,
    overSince: 0,
    board: options.board ?? [],
    botFill: options.botFill ?? BOT_FILL_TO,
    botsWanted: options.botsWanted ?? true,
    botsOnly: options.botsOnly ?? false,
    mode: options.mode ?? 'race', // 'race' | 'solo'
  }
}

// --- Player Roster --------------------------------------------------------
export function join(match, playerInfo = {}) {
  const isBot = Boolean(playerInfo.bot)
  if (!isBot && match.players.size >= MAX_PLAYERS) {
    const bot = [...match.players.values()].find((p) => p.bot)
    if (bot) leave(match, bot.id)
  }
  if (match.players.size >= MAX_PLAYERS) return null

  const id = playerInfo.id || (isBot ? `bot-${match.nextId++}` : `p-${match.nextId++}`)
  const name = sanitizeName(playerInfo.name)
  const slot = match.nextSlot++
  const avatar = typeof playerInfo.avatar === 'number' && Number.isFinite(playerInfo.avatar) && playerInfo.avatar >= 0
    ? Math.floor(playerInfo.avatar) % 6
    : (slot % 6)

  // Bot typing characteristics
  const botWpm = isBot ? (55 + (slot % 4) * 14 + Math.floor(Math.random() * 8)) : null

  const p = {
    id,
    name,
    slot,
    avatar,
    bot: isBot,
    botWpm,
    botNextKeyAt: 0,
    cursor: 0,
    correctKeystrokes: 0,
    totalKeystrokes: 0,
    consecutiveErrors: 0,
    totalErrors: 0,
    lockoutUntil: 0,
    finished: false,
    finishTime: null,
    finalWpm: 0,
    finalAcc: 100,
  }

  match.players.set(id, p)
  return p
}

export function leave(match, playerId) {
  match.players.delete(playerId)
  if (match.players.size === 0) {
    match.phase = 'waiting'
    match.countdown = COUNTDOWN_MS
    match.elapsed = 0
    match.winner = null
  }
}

// --- Keystroke Processing -------------------------------------------------
export function processInput(match, playerId, input = {}) {
  const p = match.players.get(playerId)
  if (!p || p.finished || match.phase !== 'racing') return false

  // 1. Check Glitch Breaker Lockout
  if (match.now < p.lockoutUntil) return false

  const text = match.protocol.text
  const key = String(input.key ?? '')

  // 2. Backspace: Rewind cursor by 1
  if (key === 'Backspace') {
    if (p.cursor > 0) {
      p.cursor -= 1
      p.consecutiveErrors = Math.max(0, p.consecutiveErrors - 1)
    }
    return true
  }

  // 3. Spacebar Word Jump: If errors present within current word, skip to next word
  if (key === ' ' && p.consecutiveErrors > 0) {
    const nextSpace = text.indexOf(' ', p.cursor)
    if (nextSpace !== -1) {
      const skippedCount = nextSpace + 1 - p.cursor
      p.totalErrors += skippedCount
      p.totalKeystrokes += skippedCount
      p.cursor = nextSpace + 1
      p.consecutiveErrors = 0
      return true
    }
  }

  // 4. Character Matching
  const expected = text[p.cursor]
  p.totalKeystrokes += 1

  if (key === expected) {
    p.correctKeystrokes += 1
    p.consecutiveErrors = 0
    p.cursor += 1

    // Check breach completion
    if (p.cursor >= text.length) {
      p.finished = true
      p.finishTime = match.elapsed
      p.finalWpm = calculateWpm(p.correctKeystrokes, match.elapsed)
      p.finalAcc = calculateAccuracy(p.correctKeystrokes, p.totalKeystrokes)

      if (!match.winner) {
        match.winner = p.id
        match.phase = 'over'
      }
    }
    return true
  }

  // Typo occurred
  p.totalErrors += 1
  p.consecutiveErrors += 1

  // 5. Trigger Glitch Breaker on 3 consecutive errors
  if (p.consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
    p.lockoutUntil = match.now + LOCKOUT_MS
  }

  return true
}

// --- Bot Driver -----------------------------------------------------------
function ensureBots(match) {
  const humans = [...match.players.values()].filter((p) => !p.bot).length
  if (humans === 0 && !match.botsOnly) {
    for (const b of [...match.players.values()].filter((p) => p.bot)) {
      leave(match, b.id)
    }
    return
  }

  const fillTarget = match.botFill ?? BOT_FILL_TO
  const bots = [...match.players.values()].filter((p) => p.bot)
  const want = Math.max(0, Math.min(fillTarget, MAX_PLAYERS) - humans)

  for (let i = bots.length; i > want; i--) leave(match, bots[i - 1].id)
  for (let i = bots.length; i < want; i++) {
    const taken = new Set([...match.players.values()].map((q) => q.name))
    const botName = BOT_NAMES.find((n) => !taken.has(n)) ?? `Daemon ${match.nextId}`
    join(match, { name: botName, bot: true })
  }
}

export function driveBots(match, rng = Math.random) {
  if (match.phase !== 'racing') return
  const text = match.protocol.text

  for (const p of match.players.values()) {
    if (!p.bot || p.finished) continue
    if (match.now < p.botNextKeyAt || match.now < p.lockoutUntil) continue

    const baseInterval = (60000 / (p.botWpm * 5))
    const jitter = (rng() - 0.4) * 35
    p.botNextKeyAt = match.now + Math.max(25, baseInterval + jitter)

    // Simulate small chance of typo (~2%)
    if (rng() < 0.02 && p.consecutiveErrors === 0) {
      processInput(match, p.id, { key: '§' })
    } else if (p.consecutiveErrors > 0) {
      // Fix typo via Backspace
      processInput(match, p.id, { key: 'Backspace' })
    } else {
      processInput(match, p.id, { key: text[p.cursor] })
    }
  }
}

// --- Simulation Tick ------------------------------------------------------
export function tick(match, dtMs = TICK_MS, rng = Math.random) {
  match.now += dtMs
  ensureBots(match)

  const humans = [...match.players.values()].filter((p) => !p.bot).length

  // Advance Phase
  if (match.phase === 'waiting') {
    if (humans > 0 || match.botsOnly) {
      match.phase = 'countdown'
      match.countdown = COUNTDOWN_MS
    }
  } else if (match.phase === 'countdown') {
    match.countdown = Math.max(0, match.countdown - dtMs)
    if (match.countdown <= 0) {
      match.phase = 'racing'
      match.elapsed = 0
    }
  } else if (match.phase === 'racing') {
    match.elapsed += dtMs
    driveBots(match, rng)

    // If everyone is finished
    const living = [...match.players.values()]
    if (living.length > 0 && living.every((p) => p.finished)) {
      match.phase = 'over'
    }
  } else if (match.phase === 'over') {
    if (!match.overSince) {
      match.overSince = match.now
    }
  }
}

// --- Snapshot Serialization -----------------------------------------------
export function snapshot(match) {
  const players = []
  const textLen = match.protocol.text.length

  for (const p of match.players.values()) {
    const wpm = p.finished ? p.finalWpm : calculateWpm(p.correctKeystrokes, match.elapsed)
    const rawWpm = calculateRawWpm(p.totalKeystrokes, match.elapsed)
    const acc = p.finished ? p.finalAcc : calculateAccuracy(p.correctKeystrokes, p.totalKeystrokes)
    const progress = calculateProgress(p.cursor, textLen)

    players.push({
      id: p.id,
      name: p.name,
      slot: p.slot,
      avatar: p.avatar ?? (p.slot % 6),
      bot: p.bot,
      cursor: p.cursor,
      progress,
      wpm,
      rawWpm,
      acc,
      glitch: match.now < p.lockoutUntil,
      finished: p.finished,
      finishTime: p.finishTime,
    })
  }

  return {
    t: 'snap',
    seq: match.seq++,
    phase: match.phase,
    countdown: Math.ceil(match.countdown / 1000),
    elapsed: match.elapsed,
    winner: match.winner,
    protocol: {
      id: match.protocol.id,
      title: match.protocol.title,
      tier: match.protocol.tier,
      length: textLen,
    },
    players,
    board: match.board ?? [],
  }
}
