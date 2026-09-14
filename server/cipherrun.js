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
export const PROTOCOLS = [
  // Tier 1: Quick Breaches (25–40 words)
  {
    id: 1,
    title: 'Protocol 01 // Handshake Bypass',
    tier: 1,
    text: 'Access request granted on port 8084. Initializing secure shell bypass across secondary gateway. Override local routing tables and dump session credentials to volatile memory before firewall intrusion detection locks the subnet.',
  },
  {
    id: 2,
    title: 'Protocol 02 // Neural Handshake',
    tier: 1,
    text: 'Synchronizing biometric pulse with mainframe clock. Buffer overflow detected at memory address zero zero four. Inject payload string into instruction pointer and force immediate privilege escalation.',
  },
  {
    id: 3,
    title: 'Protocol 03 // Orbital Uplink',
    tier: 1,
    text: 'Satellite downlink established over subsector nine. Encrypted telemetry streaming at forty megabits per second. Intercept transmission keys and deploy root certificate across all orbital relays.',
  },
  {
    id: 4,
    title: 'Protocol 04 // Core Dump',
    tier: 1,
    text: 'Kernel panic triggered by unhandled system exception. Hexadecimal register state dumped to console. Extract cryptographic hashes from stack trace before emergency watchdog restarts the host node.',
  },
  {
    id: 5,
    title: 'Protocol 05 // Ghost Route',
    tier: 1,
    text: 'Spoofing interface hardware address to match authorized maintenance terminal. Packet inspection disabled on local switch. Tunnel raw datagrams through virtual network interface to evade passive trace.',
  },
  {
    id: 6,
    title: 'Protocol 06 // Voltage Spike',
    tier: 1,
    text: 'Power distribution unit overdrawn on cooling bus. Transformer load reaching thermal ceiling. Divert auxiliary current to primary cooling towers before breaker trip causes catastrophic data corruption.',
  },
  {
    id: 7,
    title: 'Protocol 07 // Cipher Reset',
    tier: 1,
    text: 'Rotating public keys across distributed keyrings. Verification hash mismatch detected on node seven. Force unilateral ledger commit and quarantine compromised identity provider.',
  },

  // Tier 2: Kernel Overrides (50–70 words)
  {
    id: 8,
    title: 'Protocol 08 // Black Ice Penetration',
    tier: 2,
    text: 'Intrusion countermeasures activated across outer security ring. Defensive neural spikes deploying aggressive packet dropping. Route traffic through encrypted decoy proxy cluster while executing parallel buffer exploit on authentication daemon. Maintain sixty cycle clock synchronization to prevent packet loss and bypass passive sentinel telemetry.',
  },
  {
    id: 9,
    title: 'Protocol 09 // Subnet Quarantine',
    tier: 2,
    text: 'Rogue process detected executing unauthorized binary from temporary directory. Isolate internal bridge adapters and revoke access tokens across all active daemon threads. Inspect memory heap for injected shellcode, flush socket buffers, and broadcast cryptographically signed revocation certificates to adjacent security sectors.',
  },
  {
    id: 10,
    title: 'Protocol 10 // Firmware Inversion',
    tier: 2,
    text: 'Flashing custom bootloader to volatile flash memory segment. Checksum verification bypassed using forged digital signature. Overwrite low-level interrupt vectors to capture privileged system calls prior to hypervisor initialization. Keep data bus frequency steady to avoid unexpected bus contention and register parity errors.',
  },
  {
    id: 11,
    title: 'Protocol 11 // Memory Leak Exploitation',
    tier: 2,
    text: 'Unbounded heap allocation identified inside network routing module. Flood connection pool with asynchronous handshake frames until memory fragmentation triggers garbage collection stall. Seize vacated pointer tables and rewrite execution context before supervisor process triggers automated failover restart.',
  },
  {
    id: 12,
    title: 'Protocol 12 // Fiber Array Siphon',
    tier: 2,
    text: 'Tapping undersea optical link at primary repeater station. Optical carrier signal attenuated by three decibels. Decode wavelength multiplexed stream and reconstruct raw packet payload in local memory cache before automated optical loss sensors alert maintenance crew.',
  },
  {
    id: 13,
    title: 'Protocol 13 // Zero-Day Infiltration',
    tier: 2,
    text: 'Deploying unpatched privilege escalation sequence against core scheduler. System thread scheduler entering unmonitored debug state. Inject persistent administrative daemon into background task queue and scrub audit log entries to ensure zero trace presence across system event log.',
  },
  {
    id: 14,
    title: 'Protocol 14 // Logic Gate Cascade',
    tier: 2,
    text: 'Asynchronous clock drift triggering race condition in hardware bus arbitration. Exploit transient timing window to overwrite read-only register bank. Ensure pipeline flush does not invalidate current instruction cache before latching control signals high.',
  },

  // Tier 3: Black Ice Mainframes (85–125 words)
  {
    id: 15,
    title: 'Protocol 15 // Global Mainframe Takeover',
    tier: 3,
    text: 'Security mainframe operating in lockstep redundancy across four continental data nodes. Initiate synchronized distributed denial attack against secondary heartbeat monitors to force split-brain consensus failure. Once quorum fails, broadcast forged cluster configuration state asserting authority over the master coordinate server. Rewrite partition mapping tables, secure encrypted cryptographic storage vaults, and disable automated rollback hooks across all surviving peripheral machines before operational engineers re-establish out-of-band console access.',
  },
  {
    id: 16,
    title: 'Protocol 16 // Quantum Decryption Sweep',
    tier: 3,
    text: 'Shor algorithm coprocessor array operating at ninety-eight percent capacity. Factoring two thousand forty-eight bit asymmetric key exchange using superconducting flux qubits. Compensate for quantum phase decoherence by increasing microwave pulse modulation cadence. When private key factors resolve, decrypt operational transit ledger, capture active session cookies, and mirror master cryptographic keys to secure local cold storage before automated tamper sensors trigger cryptographic zeroization.',
  },
  {
    id: 17,
    title: 'Protocol 17 // Deep Archive Reconstruction',
    tier: 3,
    text: 'Magnetic tape archive indexing system corrupted during unexpected power collapse. Read magnetic flux transitions directly from raw recording head telemetry. Rebuild damaged parity blocks using Reed-Solomon error correction matrices. Splice fragmented database records into contiguous table allocations, rebuild index b-trees, and export master transaction logs to immutable storage nodes before archive drive servos overheat from continuous seek cycles.',
  },
  {
    id: 18,
    title: 'Protocol 18 // Cybernetic Defense Matrix',
    tier: 3,
    text: 'Automated facility defense grid monitoring all biometric and digital inputs. Intercept internal telemetry bus and broadcast simulated normal environmental telemetry across all sensory arrays. Neutralize autonomous sentry drone dispatch routines by injecting deadlocks into priority dispatch queues. Keep terminal bandwidth below intrusion detection thresholds, spoof operator command acknowledgments, and download classified facility schematics before physical facility lockdowns seal the vault perimeter doors.',
  },
]

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

  // Bot typing characteristics
  const botWpm = isBot ? (55 + (slot % 4) * 14 + Math.floor(Math.random() * 8)) : null

  const p = {
    id,
    name,
    slot,
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
