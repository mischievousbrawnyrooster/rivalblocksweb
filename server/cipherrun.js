// Pure authoritative rules engine for Cipher Run. Zero external imports, zero Node APIs,
// zero sockets, zero timers, zero I/O. Everything here is exercised by cipherrun.test.js.

export const TICK_MS = 33 // ~30 Hz tick loop
export const VOTE_DURATION_MS = 5000 // 5-second pre-round difficulty vote
export const COUNTDOWN_MS = 5000 // 5-second synchronized start
export const POST_RACE_GRACE_MS = 6000 // 6 seconds to view finish standings
export const FINISH_ALLOWANCE_MS = 20000 // 20-second allowance for remaining players to finish
export const LOCKOUT_MS = 350 // Terminal static freeze on consecutive errors
export const CONSECUTIVE_ERROR_LIMIT = 3
export const MAX_PLAYERS = 8
export const MIN_PLAYERS = 2 // operators it takes to start a race without bots
export const AVATARS = 6 // runner sprite sheets the page draws, numbered from 0
export const BOT_FILL_TO = 4
export const BOT_NAMES = ['ZeroCool', 'AcidBurn', 'Crash', 'Phantom', 'Vector', 'Cereal', 'Daemon']

// --- Curated Mainframe Protocols ------------------------------------------
import { PROTOCOLS } from './cipherrun-protocols.js'
export { PROTOCOLS }


// --- Typing Mathematics (Monkeytype Standard) ------------------------------

/** WPM: (characters / 5) / (elapsed minutes). Net WPM counts correct characters, raw WPM every keystroke. */
export function calculateWpm(correctChars, elapsedMs) {
  if (!elapsedMs || elapsedMs <= 0 || !correctChars || correctChars <= 0) return 0
  const minutes = elapsedMs / 60000
  const words = correctChars / 5
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

/**
 * Words finished with no typo left in them: what moves a runner up the track.
 * A word counts once the cursor is past the space after it, or past the last
 * letter of the text, so a runner steps forward a clean word at a time and
 * rushing ahead with typos standing moves it nowhere.
 */
function wordsDone(text, cursor, errors) {
  let done = 0
  let letters = 0
  let clean = true
  for (let i = 0; i < Math.min(cursor, text.length); i++) {
    if (errors.has(i)) clean = false
    if (text[i] !== ' ') letters++
    if (text[i] === ' ' || i === text.length - 1) {
      if (clean && letters > 0) done++
      clean = true
      letters = 0
    }
  }
  return done
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
    phase: 'waiting', // waiting | voting | countdown | racing | over
    countdown: COUNTDOWN_MS,
    voteTimer: VOTE_DURATION_MS,
    votes: new Map(), // playerId -> 1 | 2 | 3
    easterEgg: false,
    elapsed: 0,
    now: 0,
    winner: null,
    finishTimer: 0,
    overSince: 0,
    board: options.board ?? [],
    botFill: options.botFill ?? BOT_FILL_TO,
    botsWanted: options.botsWanted ?? false, // set by an operator pressing Start with bots
    picked: PROTOCOLS.some((p) => p.id === options.picked) ? options.picked : null, // archive pick, raced next
    botsOnly: options.botsOnly ?? false,
  }
}

// --- Pre-Round Voting -----------------------------------------------------
/** A vote for tier 1, 2 or 3, the only values the page sends. */
export function castVote(match, playerId, tier) {
  if (!match.players.has(playerId) || match.phase !== 'voting' || ![1, 2, 3].includes(tier)) return false
  match.votes.set(playerId, tier)
  return true
}

export function getVoteTallies(match) {
  const votes = [...match.votes.values()]
  const count = (tier) => votes.filter((v) => v === tier).length
  return { short: count(1), medium: count(2), long: count(3), total: votes.length }
}

export function resolveVote(match, rng = Math.random) {
  for (const p of match.players.values()) {
    p.cursor = 0
    p.correctKeystrokes = 0
    p.totalKeystrokes = 0
    p.consecutiveErrors = 0
    p.lockoutUntil = 0
    p.finished = false
    p.finishTime = null
    p.finalWpm = 0
    p.finalAcc = 100
    p.errors.clear()
  }

  match.winner = null
  match.finishTimer = 0
  // A new race, so the next results screen gets a countdown of its own.
  match.overSince = 0

  // An archive pick decides the race outright: no vote count, no easter egg roll.
  if (match.picked) {
    const chosen = PROTOCOLS.find((p) => p.id === match.picked)
    match.picked = null
    match.protocol = chosen
    match.easterEgg = chosen.category === 'easter_egg'
    return { winningTier: chosen.tier, protocol: chosen, easterEgg: match.easterEgg }
  }

  // Easter Egg roll: 2% probability
  if (rng() < 0.02) {
    const egg = PROTOCOLS.find((p) => p.id === 151)
    if (egg) {
      match.protocol = egg
      match.easterEgg = true
      return { winningTier: egg.tier, protocol: egg, easterEgg: true }
    }
  }

  match.easterEgg = false
  const tallies = getVoteTallies(match)
  const counts = { 1: tallies.short, 2: tallies.medium, 3: tallies.long }
  const maxVotes = Math.max(counts[1], counts[2], counts[3])

  let candidateTiers
  if (maxVotes === 0) {
    candidateTiers = [1, 2, 3]
  } else {
    candidateTiers = [1, 2, 3].filter((t) => counts[t] === maxVotes)
  }

  const winningTier = candidateTiers[Math.floor(rng() * candidateTiers.length)]
  const tierProtocols = PROTOCOLS.filter((p) => p.tier === winningTier && p.category !== 'easter_egg')
  const chosen = tierProtocols[Math.floor(rng() * tierProtocols.length)] ?? PROTOCOLS[0]

  match.protocol = chosen
  return { winningTier, protocol: chosen, easterEgg: false }
}

/**
 * An operator's pick from the protocol archive. It replaces the vote: a vote
 * under way ends at once, and a race under way keeps its text and races the
 * pick next.
 */
export function pickProtocol(match, playerId, protocolId) {
  if (!match.players.has(playerId) || !PROTOCOLS.some((p) => p.id === protocolId)) return false
  match.picked = protocolId
  return true
}

/** A runner number the page has a sprite sheet for, or null. */
const validAvatar = (v) => (Number.isInteger(v) && v >= 0 && v < AVATARS ? v : null)

/** An operator switching runner. Refused unless it is one of the AVATARS sheets. */
export function setAvatar(match, playerId, avatar) {
  const p = match.players.get(playerId)
  if (!p || validAvatar(avatar) === null) return false
  p.avatar = avatar
  return true
}

// --- Player Roster --------------------------------------------------------
export function join(match, playerInfo = {}, rng = Math.random) {
  const isBot = Boolean(playerInfo.bot)
  if (!isBot && match.players.size >= MAX_PLAYERS) {
    const bot = [...match.players.values()].find((p) => p.bot)
    if (bot) leave(match, bot.id)
  }
  if (match.players.size >= MAX_PLAYERS) return null

  // A restart carries players in under their old ids while the counter starts
  // again from 1, so an id already in the roster is skipped, never reused.
  let id = playerInfo.id
  while (!id || match.players.has(id)) id = `${isBot ? 'bot' : 'p'}-${match.nextId++}`
  const name = sanitizeName(playerInfo.name)
  const slot = match.nextSlot++
  const avatar = validAvatar(playerInfo.avatar) ?? slot % AVATARS

  // Bot typing characteristics, drawn from the injected rng so a seeded run repeats
  const botWpm = isBot ? (55 + (slot % 4) * 14 + Math.floor(rng() * 8)) : null

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
    errors: new Map(), // position -> the wrong key typed there
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
  match.votes.delete(playerId)
  // A race whose last unfinished operator walked out is concluded by the next tick.
  if (match.players.size === 0) match.phase = 'waiting'
}

// --- Keystroke Processing -------------------------------------------------
export function processInput(match, playerId, input = {}) {
  const p = match.players.get(playerId)
  if (!p || p.finished || match.phase !== 'racing') return false

  // 1. Check Glitch Breaker Lockout
  if (match.now < p.lockoutUntil) return false

  const text = match.protocol.text
  const key = String(input.key ?? '')
  if (key !== 'Backspace' && key.length !== 1) return false

  // 2. Backspace: step back one letter, erasing the typo if one sits there.
  // Correct keypresses stay counted, so accuracy is not taken back.
  // With `word` (Ctrl+Backspace) it keeps stepping, as a text editor does: over
  // any spaces just behind the cursor, then back to the start of that word.
  if (key === 'Backspace') {
    const back = () => {
      p.cursor -= 1
      if (p.errors.delete(p.cursor)) p.consecutiveErrors = Math.max(0, p.consecutiveErrors - 1)
    }
    if (input.word === true) {
      while (p.cursor > 0 && text[p.cursor - 1] === ' ') back()
      while (p.cursor > 0 && text[p.cursor - 1] !== ' ') back()
    } else if (p.cursor > 0) {
      back()
    }
    return true
  }

  // Do not accept keystrokes beyond text boundary
  if (p.cursor >= text.length) return false

  // 3. Character Matching. Space is an ordinary key: only Backspace clears a typo.
  p.totalKeystrokes += 1

  if (key === text[p.cursor]) {
    p.correctKeystrokes += 1
    p.consecutiveErrors = 0
    p.cursor += 1

    // Check breach completion (requires zero uncorrected errors)
    if (p.cursor >= text.length && p.errors.size === 0) {
      p.finished = true
      p.finishTime = match.elapsed
      p.finalWpm = calculateWpm(text.length, match.elapsed)
      p.finalAcc = calculateAccuracy(p.correctKeystrokes, p.totalKeystrokes)

      if (!match.winner) {
        match.winner = p.id
        match.finishTimer = FINISH_ALLOWANCE_MS
      }

      // Conclude immediately if all players in the match have finished
      const living = [...match.players.values()]
      if (living.length > 0 && living.every((q) => q.finished)) {
        match.phase = 'over'
      }
    }
    return true
  }

  // Typo occurred: remember the wrong key so the page can show it, and advance past it
  p.consecutiveErrors += 1
  p.errors.set(p.cursor, key)
  p.cursor += 1

  // 4. Trigger Glitch Breaker on 3 consecutive errors; the freeze starts a fresh count
  if (p.consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
    p.lockoutUntil = match.now + LOCKOUT_MS
    p.consecutiveErrors = 0
  }

  return true
}

// --- Bot Driver -----------------------------------------------------------
function ensureBots(match, rng) {
  const humans = [...match.players.values()].filter((p) => !p.bot).length
  if (humans === 0 && !match.botsOnly) {
    // Nobody left who asked for bots: the next operator starts in the lobby.
    match.botsWanted = false
    for (const b of [...match.players.values()].filter((p) => p.bot)) {
      leave(match, b.id)
    }
    return
  }

  const fillTarget = match.botsWanted || match.botsOnly ? match.botFill : 0
  const bots = [...match.players.values()].filter((p) => p.bot)
  const want = Math.max(0, Math.min(fillTarget, MAX_PLAYERS) - humans)

  for (let i = bots.length; i > want; i--) leave(match, bots[i - 1].id)
  for (let i = bots.length; i < want; i++) {
    const taken = new Set([...match.players.values()].map((q) => q.name))
    const botName = BOT_NAMES.find((n) => !taken.has(n)) ?? `Daemon ${match.nextId}`
    join(match, { name: botName, bot: true }, rng)
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
  ensureBots(match, rng)

  const humans = [...match.players.values()].filter((p) => !p.bot).length

  // Advance Phase
  if (match.phase === 'waiting') {
    // The lobby: hold for a rival operator unless someone asked for bots.
    if (humans >= MIN_PLAYERS || match.botsWanted || match.botsOnly) {
      match.phase = 'voting'
      match.voteTimer = VOTE_DURATION_MS
      match.votes.clear()
      match.easterEgg = false
    }
  }
  if (match.phase === 'voting') {
    match.voteTimer = Math.max(0, match.voteTimer - dtMs)
    // A pick from the archive has already decided it, so the vote ends at once.
    if (match.voteTimer <= 0 || match.picked) {
      resolveVote(match, rng)
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

    if (match.winner) {
      match.finishTimer = Math.max(0, match.finishTimer - dtMs)
    }

    // Conclude if everyone is finished or the 20-second finish allowance expired
    const living = [...match.players.values()]
    const allFinished = living.length > 0 && living.every((p) => p.finished)
    const allowanceExpired = match.winner && match.finishTimer <= 0

    if (allFinished || allowanceExpired) {
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
  const words = match.protocol.text.split(' ').filter(Boolean).length

  for (const p of match.players.values()) {
    // Net WPM counts letters still correct on screen; accuracy counts every keypress
    const wpm = p.finished ? p.finalWpm : calculateWpm(p.cursor - p.errors.size, match.elapsed)
    const rawWpm = calculateWpm(p.totalKeystrokes, match.elapsed)
    const acc = p.finished ? p.finalAcc : calculateAccuracy(p.correctKeystrokes, p.totalKeystrokes)
    const progress = calculateProgress(wordsDone(match.protocol.text, p.cursor, p.errors), words)

    players.push({
      id: p.id,
      name: p.name,
      slot: p.slot,
      avatar: p.avatar,
      bot: p.bot,
      cursor: p.cursor,
      wrong: [...p.errors], // [position, key] pairs the page draws in red
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
    phase: match.phase,
    countdown: Math.ceil(match.countdown / 1000),
    voteTimer: Math.ceil(match.voteTimer / 1000),
    votes: getVoteTallies(match),
    easterEgg: Boolean(match.easterEgg),
    elapsed: match.elapsed,
    winner: match.winner,
    finishCountdown: match.winner && match.phase === 'racing' ? Math.ceil(match.finishTimer / 1000) : 0,
    // Seconds the results screen has left, on the same clock the server restarts by.
    nextRaceIn:
      match.phase === 'over'
        ? Math.max(0, Math.ceil((POST_RACE_GRACE_MS - (match.now - (match.overSince || match.now))) / 1000))
        : 0,
    picked: match.picked,
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
