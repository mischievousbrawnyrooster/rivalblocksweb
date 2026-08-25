# Blockout Royale Browser Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a playable 2–4 player multiplayer Blockout Royale match at `/play` on the RivalBlocks site, served over plain WebSocket so the traffic is readable in Wireshark.

**Architecture:** A single authoritative Node process holds one match. All rules live in a pure module (`server/game.js`) with no network or Node dependencies, so they are testable in isolation; a thin socket wrapper (`server/server.js`) parses messages, calls into the rules, and broadcasts the full match state ten times a second. The React client renders exactly what it is sent and simulates nothing.

**Tech Stack:** Node (built-in test runner), `ws`, React 19, React Router 7, Tailwind CSS v4, Vite 8, nginx.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-06-blockout-royale-browser-trial-design.md`. Read it before starting.
- **Node is not on PATH** in an already-running shell. Prepend it per command: `export PATH="/c/Program Files/nodejs:$PATH"` (Git Bash) before any `npm`/`node` call.
- **Exactly one new dependency:** `ws`. Adding any other package is a plan violation.
- **No image files.** All visuals are CSS or inline SVG. This is an existing site-wide rule.
- **In-fiction copy.** Nothing on the page may describe the game as a demo, test, mock, exercise, or placeholder. Voice is confident and technical, matching the rest of the site.
- **Status is never colour alone.** Every colour-coded state carries a glyph or text label (WCAG 1.4.1).
- **Existing style tokens only:** `bg`, `surface`, `line`, `fg`, `muted`, `flare`, `on-flare`, `live`, `warn`, `idle`, plus the `.display`, `.rule-label`, and `.blueprint` classes from `src/index.css`. No new tokens.
- **Server is authoritative.** The client never decides whether a move is legal, whether a player is eliminated, or who won.
- **Tests are Node's built-in runner only.** No framework, no fixtures, no mocking library.

---

## Post-implementation corrections (2026-08-06)

A final whole-branch review found three defects after this plan was executed. They are fixed in the working tree, but the code blocks further down this document still show the **original, pre-fix** versions — do not re-run those blocks verbatim if this plan is ever replayed. The fixes:

- **`server/game.js` — `move()` accepted inherited `Object` properties (`constructor`, `toString`, `__proto__`, ...) as directions**, driving player position to `NaN` and making elimination impossible. Fixed by looking up `DIRS` with `Object.hasOwn` instead of a bare `DIRS[dir]` truthy check.
- **`src/pages/Play.jsx` — solid tiles and holes were distinguishable by colour alone** (`bg-surface` vs `bg-bg`, ~1.1:1 contrast), violating the colour-alone constraint above. Fixed by adding `ring-1 ring-inset ring-line` to standing tiles (`solid`, `warn`), leaving holes flat — a structural cue, not just a colour shift.
- **`server/game.js` — `sanitizeName` bounded the input length only after `split`/`filter`/`join`**, so an oversized WebSocket frame could OOM the process before `try/catch` in `server/server.js` could help. Fixed by slicing to 256 chars before the per-character work, and by capping `maxPayload: 4096` on the `WebSocketServer` in `server/server.js`.

---

### Task 0: Baseline commit

The repository has zero commits and every file is untracked. Later tasks commit
individual files; without a baseline, that history is unreadable.

**Files:**
- Modify: none — this commits what already exists.

**Interfaces:**
- Consumes: nothing.
- Produces: a git history that later tasks add to.

- [ ] **Step 1: Confirm the working tree is the finished site**

Run: `git status --short`

Expected: untracked entries for `.gitignore`, `deploy/`, `docs/`, `index.html`, `package.json`, `package-lock.json`, `public/`, `src/`, `vite.config.js`. `node_modules/` and `dist/` must NOT appear — if they do, stop and fix `.gitignore` first.

- [ ] **Step 2: Verify the site currently builds and tests pass**

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test && npm run build
```
Expected: tests pass, `dist/` is written. This is the known-good baseline.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: initial commit of the RivalBlocks marketing site"
```

---

### Task 1: Match state, joining, and name handling

**Files:**
- Create: `server/game.js`
- Create: `server/game.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Constants `SIZE = 9`, `TICK_MS = 100`, `MOVE_COOLDOWN_MS = 120`, `COLLAPSE_EVERY_MS = 900`, `COLLAPSE_COUNT = 3`, `WARNING_MS = 1500`, `COUNTDOWN_MS = 3000`, `OVER_MS = 5000`, `MIN_PLAYERS = 2`, `MAX_PLAYERS = 4`, `SPAWNS`
  - `createMatch() -> state`
  - `addPlayer(state, name) -> player`
  - `removePlayer(state, id) -> void`
  - `sanitizeName(raw) -> string`
  - State shape: `{ phase, now, phaseUntil, tiles, warnAt, nextCollapseAt, players, nextId, winner }`
  - Player shape: `{ id, name, playing, alive, x, y, lastMoveAt }`

- [ ] **Step 1: Write the failing test**

Create `server/game.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, addPlayer, removePlayer, sanitizeName, SIZE } from './game.js'

test('a new match is a full board with nobody on it', () => {
  const m = createMatch()
  assert.equal(m.phase, 'waiting')
  assert.equal(m.tiles.length, SIZE * SIZE)
  assert.ok(m.tiles.every((t) => t === 'solid'))
  assert.deepEqual(m.players, [])
  assert.equal(m.winner, null)
})

test('joining assigns rising ids and nobody has a piece yet', () => {
  const m = createMatch()
  const a = addPlayer(m, 'ada')
  const b = addPlayer(m, 'bo')
  assert.equal(a.id, 1)
  assert.equal(b.id, 2)
  assert.equal(a.playing, false)
  assert.equal(a.alive, false)
  assert.equal(m.players.length, 2)
})

test('leaving removes exactly one player and tolerates an unknown id', () => {
  const m = createMatch()
  const a = addPlayer(m, 'ada')
  addPlayer(m, 'bo')
  removePlayer(m, a.id)
  assert.deepEqual(m.players.map((p) => p.name), ['bo'])
  removePlayer(m, 999)
  assert.equal(m.players.length, 1)
})

test('names are trimmed, capped, stripped of control characters, never empty', () => {
  assert.equal(sanitizeName('  jiaqi  '), 'jiaqi')
  assert.equal(sanitizeName('jia qi'), 'jia qi', 'an inner space survives')
  assert.equal(sanitizeName('x'.repeat(40)).length, 16)
  assert.equal(sanitizeName('a' + String.fromCharCode(0) + 'bc'), 'abc')
  assert.equal(sanitizeName('a' + String.fromCharCode(127) + 'bc'), 'abc')
  assert.equal(sanitizeName(''), 'Player')
  assert.equal(sanitizeName('   '), 'Player')
  assert.equal(sanitizeName(null), 'Player')
  assert.equal(sanitizeName(undefined), 'Player')
  assert.equal(sanitizeName(42), '42')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test server/game.test.js
```
Expected: FAIL — `Cannot find module .../server/game.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `server/game.js`:

```js
// Rules for one Blockout Royale match. Pure: no sockets, no Node APIs, no
// imports. Everything here is exercised by game.test.js.

// --- Tuning ------------------------------------------------------------
// The collapse rate is what decides whether a round is tense or tedious, and
// no amount of reasoning settles it. Play the game and move the numbers.
export const SIZE = 9
export const TICK_MS = 100
export const MOVE_COOLDOWN_MS = 120
export const COLLAPSE_EVERY_MS = 900
export const COLLAPSE_COUNT = 3
export const WARNING_MS = 1500
export const COUNTDOWN_MS = 3000
export const OVER_MS = 5000
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 4

// Opposite corners first, so a two-player round starts as far apart as it can.
export const SPAWNS = [
  [0, 0],
  [SIZE - 1, SIZE - 1],
  [SIZE - 1, 0],
  [0, SIZE - 1],
]

const NAME_MAX = 16

// A code-point test rather than a regex range. An escape sequence for a
// control character is exactly the kind of thing an editor or a copy-paste
// silently mangles; arithmetic on the code point cannot be mangled.
const isPrintable = (ch) => {
  const code = ch.codePointAt(0)
  return code > 31 && code !== 127
}

/** Trims, strips control characters, caps length, and never returns empty. */
export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    .split('')
    .filter(isPrintable)
    .join('')
    .trim()
    .slice(0, NAME_MAX)
  return clean || 'Player'
}

export function createMatch() {
  return {
    phase: 'waiting',
    now: 0,
    phaseUntil: 0,
    tiles: new Array(SIZE * SIZE).fill('solid'),
    warnAt: new Array(SIZE * SIZE).fill(0),
    nextCollapseAt: Infinity,
    players: [],
    nextId: 1,
    winner: null,
  }
}

/** Joins the match. A piece is only handed out when a round starts. */
export function addPlayer(state, name) {
  const player = {
    id: state.nextId++,
    name: sanitizeName(name),
    playing: false,
    alive: false,
    x: 0,
    y: 0,
    lastMoveAt: 0,
  }
  state.players.push(player)
  return player
}

export function removePlayer(state, id) {
  const i = state.players.findIndex((p) => p.id === id)
  if (i !== -1) state.players.splice(i, 1)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test server/game.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the new tests into `npm test`**

In `package.json`, change the `test` script:

```json
"test": "node --test src/lib/lib.test.js server/game.test.js"
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS — the existing library tests and the four new ones.

- [ ] **Step 7: Commit**

```bash
git add server/game.js server/game.test.js package.json
git commit -m "feat(game): match state, joining, and name sanitising"
```

---

### Task 2: Movement rules

**Files:**
- Modify: `server/game.js`
- Modify: `server/game.test.js`

**Interfaces:**
- Consumes: Task 1's `createMatch`, `addPlayer`, state and player shapes, `SIZE`, `MOVE_COOLDOWN_MS`, `SPAWNS`.
- Produces:
  - `move(state, id, dir) -> boolean` — `dir` is one of `'up' | 'down' | 'left' | 'right'`; returns whether the move was applied.
  - `startRound(state) -> void` — exported so tests can reach the `playing` phase without driving the tick loop. Assigns pieces to the first `MAX_PLAYERS` players in join order.

A move is rejected when: the phase is not `playing`; the id is unknown; the player has no piece or is already out; the direction is unrecognised; the cooldown has not elapsed; the destination is off the grid, `gone`, or occupied. Rejection is silent — the player simply does not move.

- [ ] **Step 1: Write the failing test**

In `server/game.test.js`, replace the existing import from `./game.js` with:

```js
import {
  createMatch,
  addPlayer,
  removePlayer,
  sanitizeName,
  move,
  startRound,
  SIZE,
  MOVE_COOLDOWN_MS,
  MAX_PLAYERS,
} from './game.js'
```

Then append:

```js
/** A match in the `playing` phase with n players and no random collapses. */
function playing(n) {
  const m = createMatch()
  for (let i = 0; i < n; i++) addPlayer(m, `p${i}`)
  startRound(m)
  m.nextCollapseAt = Infinity // tests collapse tiles by hand, never at random
  return m
}

test('a round hands pieces to at most four players, in join order', () => {
  const m = playing(5)
  assert.equal(m.players.filter((p) => p.playing).length, MAX_PLAYERS)
  assert.equal(m.players[4].playing, false, 'the fifth player spectates')
  assert.ok(m.players.slice(0, MAX_PLAYERS).every((p) => p.alive))
})

test('a move off the grid is rejected', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.deepEqual([p.x, p.y], [0, 0])
  assert.equal(move(m, p.id, 'up'), false)
  assert.equal(move(m, p.id, 'left'), false)
  assert.deepEqual([p.x, p.y], [0, 0])
})

test('a move into a hole is rejected', () => {
  const m = playing(2)
  const p = m.players[0]
  m.tiles[0 * SIZE + 1] = 'gone'
  assert.equal(move(m, p.id, 'right'), false)
  assert.equal(p.x, 0)
})

test('a move onto another player is rejected', () => {
  const m = playing(2)
  const [a, b] = m.players
  b.x = 1
  b.y = 0
  assert.equal(move(m, a.id, 'right'), false)
  assert.equal(a.x, 0)
})

test('a legal move is applied', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.equal(move(m, p.id, 'right'), true)
  assert.deepEqual([p.x, p.y], [1, 0])
})

test('the move cooldown stops a client from teleporting', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.equal(move(m, p.id, 'right'), true)
  assert.equal(move(m, p.id, 'right'), false, 'second move in the same instant')
  m.now += MOVE_COOLDOWN_MS
  assert.equal(move(m, p.id, 'right'), true)
  assert.equal(p.x, 2)
})

test('moves are ignored outside the playing phase and for unknown ids', () => {
  const m = playing(2)
  const p = m.players[0]
  assert.equal(move(m, 999, 'right'), false)
  assert.equal(move(m, p.id, 'sideways'), false)
  m.phase = 'over'
  assert.equal(move(m, p.id, 'right'), false)
})

test('an eliminated player cannot move', () => {
  const m = playing(2)
  const p = m.players[0]
  p.alive = false
  assert.equal(move(m, p.id, 'right'), false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/game.test.js`
Expected: FAIL — `move` and `startRound` are not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `server/game.js`:

```js
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** Clears the board and hands pieces to the first MAX_PLAYERS in join order. */
export function startRound(state) {
  state.tiles.fill('solid')
  state.warnAt.fill(0)
  state.winner = null
  state.nextCollapseAt = state.now + COLLAPSE_EVERY_MS
  state.players.forEach((p, i) => {
    p.playing = i < MAX_PLAYERS
    p.alive = p.playing
    if (p.playing) {
      ;[p.x, p.y] = SPAWNS[i]
      // Backdated, or the very first move of the round hits its own cooldown.
      p.lastMoveAt = state.now - MOVE_COOLDOWN_MS
    }
  })
  state.phase = 'playing'
}

/** Applies one step. Returns false, silently, for anything illegal. */
export function move(state, id, dir) {
  if (state.phase !== 'playing') return false

  const p = state.players.find((q) => q.id === id)
  if (!p || !p.playing || !p.alive) return false
  if (state.now - p.lastMoveAt < MOVE_COOLDOWN_MS) return false

  const step = DIRS[dir]
  if (!step) return false

  const x = p.x + step[0]
  const y = p.y + step[1]
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false
  if (state.tiles[y * SIZE + x] === 'gone') return false
  if (state.players.some((o) => o !== p && o.playing && o.alive && o.x === x && o.y === y)) {
    return false
  }

  p.x = x
  p.y = y
  p.lastMoveAt = state.now
  return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add server/game.js server/game.test.js
git commit -m "feat(game): server-authoritative movement with cooldown"
```

---

### Task 3: The tick — collapse, elimination, phases, and the wire snapshot

**Files:**
- Modify: `server/game.js`
- Modify: `server/game.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces:
  - `tick(state, dt, rng = Math.random) -> void` — advances `state.now` by `dt` milliseconds and drives all phase changes. `rng` is injectable purely so tests are deterministic.
  - `snapshot(state) -> object` — the `{ t: 'state', ... }` message broadcast to clients.

Phase machine: `waiting` → (`MIN_PLAYERS` connected) → `countdown` → (`COUNTDOWN_MS`) → `playing` → (≤1 alive) → `over` → (`OVER_MS`) → `countdown`, or back to `waiting` if fewer than `MIN_PLAYERS` remain.

- [ ] **Step 1: Write the failing test**

In `server/game.test.js`, replace the import from `./game.js` again, this time with the full set:

```js
import {
  createMatch,
  addPlayer,
  removePlayer,
  sanitizeName,
  move,
  startRound,
  tick,
  snapshot,
  SIZE,
  TICK_MS,
  MOVE_COOLDOWN_MS,
  MAX_PLAYERS,
  COLLAPSE_COUNT,
  WARNING_MS,
  COUNTDOWN_MS,
  OVER_MS,
} from './game.js'
```

Then append:

```js
/** Drops the tile under a player and ticks once so it resolves. */
function collapseUnder(m, p) {
  const i = p.y * SIZE + p.x
  m.tiles[i] = 'warn'
  m.warnAt[i] = m.now
  tick(m, TICK_MS)
}

test('one player is not enough to start; a second one starts the countdown', () => {
  const m = createMatch()
  addPlayer(m, 'ada')
  tick(m, TICK_MS)
  assert.equal(m.phase, 'waiting')
  addPlayer(m, 'bo')
  tick(m, TICK_MS)
  assert.equal(m.phase, 'countdown')
  tick(m, COUNTDOWN_MS)
  assert.equal(m.phase, 'playing')
})

test('the countdown aborts if players leave before it finishes', () => {
  const m = createMatch()
  const a = addPlayer(m, 'ada')
  addPlayer(m, 'bo')
  tick(m, TICK_MS)
  assert.equal(m.phase, 'countdown')
  removePlayer(m, a.id)
  tick(m, TICK_MS)
  assert.equal(m.phase, 'waiting')
})

test('a collapse wave marks solid tiles as warning, not gone', () => {
  const m = playing(2)
  m.nextCollapseAt = m.now
  tick(m, TICK_MS, () => 0)
  assert.equal(m.tiles.filter((t) => t === 'warn').length, COLLAPSE_COUNT)
  assert.equal(m.tiles.filter((t) => t === 'gone').length, 0)
})

test('a warning tile falls away after the warning delay', () => {
  const m = playing(2)
  m.tiles[40] = 'warn'
  m.warnAt[40] = m.now + WARNING_MS
  tick(m, WARNING_MS - TICK_MS)
  assert.equal(m.tiles[40], 'warn', 'still standing before the delay elapses')
  tick(m, TICK_MS)
  assert.equal(m.tiles[40], 'gone')
})

test('a player on a tile that falls away is eliminated', () => {
  const m = playing(3)
  const p = m.players[0]
  collapseUnder(m, p)
  assert.equal(m.tiles[p.y * SIZE + p.x], 'gone')
  assert.equal(p.alive, false)
  assert.equal(m.phase, 'playing', 'two are still standing')
})

test('the last player standing wins and the round ends', () => {
  const m = playing(2)
  const [a, b] = m.players
  collapseUnder(m, a)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, b.name)
})

test('a mutual wipeout ends the round with no winner', () => {
  const m = playing(2)
  for (const p of m.players) {
    const i = p.y * SIZE + p.x
    m.tiles[i] = 'warn'
    m.warnAt[i] = m.now
  }
  tick(m, TICK_MS)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, null)
})

test('a player who disconnects mid-round hands the win to the survivor', () => {
  const m = playing(2)
  const [a, b] = m.players
  removePlayer(m, a.id)
  tick(m, TICK_MS)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, b.name)
})

test('a spectator gets a piece in the next round', () => {
  const m = playing(5)
  const spectator = m.players[4]
  assert.equal(spectator.playing, false)
  removePlayer(m, m.players[0].id)
  for (const p of m.players.filter((q) => q.playing && q.alive).slice(1)) {
    collapseUnder(m, p)
  }
  assert.equal(m.phase, 'over')
  tick(m, OVER_MS)
  assert.equal(m.phase, 'countdown')
  tick(m, COUNTDOWN_MS)
  assert.equal(m.phase, 'playing')
  assert.equal(spectator.playing, true)
})

test('an emptied match falls back to waiting instead of restarting', () => {
  const m = playing(2)
  const [a, b] = m.players
  collapseUnder(m, a)
  removePlayer(m, b.id)
  tick(m, OVER_MS)
  assert.equal(m.phase, 'waiting')
  assert.equal(m.winner, null)
})

test('the snapshot carries everything a client needs and nothing private', () => {
  const m = playing(2)
  const s = snapshot(m)
  assert.equal(s.t, 'state')
  assert.equal(s.phase, 'playing')
  assert.equal(s.size, SIZE)
  assert.equal(s.tiles.length, SIZE * SIZE)
  assert.equal(s.players.length, 2)
  assert.deepEqual(
    Object.keys(s.players[0]).sort(),
    ['alive', 'id', 'name', 'playing', 'x', 'y'],
  )
  assert.equal(s.winner, null)
})

test('the snapshot counts down the seconds for timed phases', () => {
  const m = createMatch()
  addPlayer(m, 'ada')
  addPlayer(m, 'bo')
  tick(m, TICK_MS)
  assert.equal(snapshot(m).secs, Math.ceil(COUNTDOWN_MS / 1000))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/game.test.js`
Expected: FAIL — `tick` and `snapshot` are not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `server/game.js`:

```js
function startCountdown(state) {
  state.phase = 'countdown'
  state.phaseUntil = state.now + COUNTDOWN_MS
  state.winner = null
}

function endRound(state, survivor) {
  state.phase = 'over'
  state.winner = survivor ? survivor.name : null
  state.phaseUntil = state.now + OVER_MS
}

// ponytail: rescans the whole grid once per pick. At 81 tiles and three picks
// that is nothing; revisit only if the grid ever gets large.
function collapse(state, rng) {
  for (let n = 0; n < COLLAPSE_COUNT; n++) {
    const solid = []
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] === 'solid') solid.push(i)
    }
    if (solid.length === 0) return
    const i = solid[Math.floor(rng() * solid.length)]
    state.tiles[i] = 'warn'
    state.warnAt[i] = state.now + WARNING_MS
  }
}

/** Turns due warnings into holes and takes anyone standing on them with it. */
function resolveWarnings(state) {
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] !== 'warn' || state.now < state.warnAt[i]) continue
    state.tiles[i] = 'gone'
    for (const p of state.players) {
      if (p.playing && p.alive && p.y * SIZE + p.x === i) p.alive = false
    }
  }
}

/**
 * Advances the match by dt milliseconds. `rng` is injectable so the collapse
 * order is deterministic under test; nothing else uses it.
 */
export function tick(state, dt, rng = Math.random) {
  state.now += dt

  if (state.phase === 'waiting') {
    if (state.players.length >= MIN_PLAYERS) startCountdown(state)
    return
  }

  if (state.phase === 'countdown') {
    if (state.players.length < MIN_PLAYERS) {
      state.phase = 'waiting'
    } else if (state.now >= state.phaseUntil) {
      startRound(state)
    }
    return
  }

  if (state.phase === 'over') {
    if (state.now < state.phaseUntil) return
    if (state.players.length >= MIN_PLAYERS) {
      startCountdown(state)
    } else {
      state.phase = 'waiting'
      state.winner = null
    }
    return
  }

  // playing
  while (state.now >= state.nextCollapseAt) {
    collapse(state, rng)
    state.nextCollapseAt += COLLAPSE_EVERY_MS
  }
  resolveWarnings(state)

  const standing = state.players.filter((p) => p.playing && p.alive)
  if (standing.length <= 1) endRound(state, standing[0] ?? null)
}

/**
 * The one message shape broadcast to clients.
 * ponytail: full-state broadcast every tick, no diffing. 81 tiles and four
 * players is a small object, and a client never needs earlier messages to
 * render. Delta-encode only if the grid ever exceeds ~400 tiles.
 */
export function snapshot(state) {
  const timed = state.phase === 'countdown' || state.phase === 'over'
  return {
    t: 'state',
    phase: state.phase,
    size: SIZE,
    secs: timed ? Math.max(0, Math.ceil((state.phaseUntil - state.now) / 1000)) : 0,
    winner: state.winner,
    tiles: state.tiles,
    players: state.players.map(({ id, name, x, y, playing, alive }) => ({
      id,
      name,
      x,
      y,
      playing,
      alive,
    })),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add server/game.js server/game.test.js
git commit -m "feat(game): collapse, elimination, phase machine, and snapshot"
```

---

### Task 4: The WebSocket server

**Files:**
- Create: `server/server.js`
- Modify: `package.json` (add `ws`, add a `game` script)

**Interfaces:**
- Consumes: `createMatch`, `addPlayer`, `removePlayer`, `move`, `tick`, `snapshot`, `TICK_MS`, `SIZE` from `server/game.js`.
- Produces: a process listening on `127.0.0.1:8081` speaking the protocol in the spec. No exports.

Not unit-tested — it contains no rules, only wiring. Verified by connecting to it.

- [ ] **Step 1: Install the dependency**

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm install ws
```
Expected: `ws` appears under `dependencies` in `package.json`. Confirm nothing else was added:
```bash
git diff package.json
```

- [ ] **Step 2: Write the server**

Create `server/server.js`:

```js
// Socket wiring for one Blockout Royale match. Contains no rules — every
// decision is made by game.js. Binds to loopback; nginx is what faces the
// network.

import { WebSocketServer } from 'ws'
import {
  createMatch,
  addPlayer,
  removePlayer,
  move,
  tick,
  snapshot,
  TICK_MS,
  SIZE,
} from './game.js'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 8081

const match = createMatch()
const wss = new WebSocketServer({ host: HOST, port: PORT })

wss.on('connection', (ws) => {
  let player = null

  ws.on('message', (raw) => {
    let msg
    // One malformed client must not be able to take the match down.
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg?.t === 'join' && !player) {
      player = addPlayer(match, msg.name)
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, size: SIZE }))
    } else if (msg?.t === 'move' && player) {
      move(match, player.id, msg.dir)
    }
  })

  ws.on('close', () => {
    if (player) removePlayer(match, player.id)
  })

  // A client that drops mid-frame is not a server error.
  ws.on('error', () => ws.close())
})

setInterval(() => {
  tick(match, TICK_MS)
  const frame = JSON.stringify(snapshot(match))
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(frame)
  }
}, TICK_MS)

console.log(`Blockout Royale match server on ws://${HOST}:${PORT}`)
```

- [ ] **Step 3: Add a run script**

In `package.json`, add to `scripts`:

```json
"game": "node server/server.js"
```

- [ ] **Step 4: Verify it runs and speaks the protocol**

In one terminal:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run game
```
Expected: `Blockout Royale match server on ws://127.0.0.1:8081`.

In a second terminal, connect two clients and confirm a round starts:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
node -e '
const { WebSocket } = require("ws");
const seen = new Set();
for (const name of ["ada", "bo"]) {
  const ws = new WebSocket("ws://127.0.0.1:8081");
  ws.on("open", () => ws.send(JSON.stringify({ t: "join", name })));
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    const key = name + m.phase;
    if (m.t === "state" && !seen.has(key)) {
      seen.add(key);
      console.log(name, m.phase, m.players.map((p) => p.name).join(","));
    }
  });
}
setTimeout(() => process.exit(0), 6000);
'
```
Expected: both clients report `waiting`, then `countdown`, then `playing`, with both names listed. Stop the server with Ctrl-C afterwards.

- [ ] **Step 5: Commit**

```bash
git add server/server.js package.json package-lock.json
git commit -m "feat(game): websocket match server"
```

---

### Task 5: The Play page

**Files:**
- Create: `src/pages/Play.jsx`
- Modify: `src/App.jsx`
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: the protocol from Task 4 — sends `{t:'join',name}` and `{t:'move',dir}`, receives `{t:'welcome',id,size}` and `{t:'state',phase,size,secs,winner,tiles,players}` — and `useTitle` from `src/lib/useTitle.js`.
- Produces: a default-exported `Play` component mounted at `/play`.

- [ ] **Step 1: Add the dev proxy**

Replace `vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Mirrors what nginx does in production, so /ws works the same in both.
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8081', ws: true },
    },
  },
})
```

- [ ] **Step 2: Write the page**

Create `src/pages/Play.jsx`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTitle } from '../lib/useTitle.js'

// Keyed on e.code, so the binding survives a different keyboard layout.
const KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
}

const TILE = {
  solid: 'bg-surface',
  warn: 'bg-warn text-bg',
  gone: 'bg-bg',
}

// Each piece also carries its initial, so players are told apart without
// relying on colour.
const PIECE = [
  'bg-flare text-on-flare',
  'bg-live text-bg',
  'bg-warn text-bg',
  'bg-idle text-bg',
]

function statusLine(game, myId) {
  if (!game) return 'Connecting to the match server.'
  const mine = game.players.find((p) => p.id === myId)
  switch (game.phase) {
    case 'waiting':
      return `Holding for players. ${game.players.length} connected, 2 needed to drop.`
    case 'countdown':
      return `Round starts in ${game.secs}.`
    case 'over':
      return game.winner
        ? `${game.winner} takes the round. Next drop in ${game.secs}.`
        : `No survivors. Next drop in ${game.secs}.`
    default:
      if (mine && !mine.playing) return 'Spectating. You are in on the next round.'
      if (mine && !mine.alive) return 'You went down with the floor. Round still live.'
      return `Round live. ${game.players.filter((p) => p.playing && p.alive).length} still standing.`
  }
}

function Arrow({ dir, glyph, label, onMove }) {
  return (
    <button
      type="button"
      onClick={() => onMove(dir)}
      className="flex h-12 items-center justify-center border border-line text-muted transition-colors hover:border-flare hover:text-flare"
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </button>
  )
}

export default function Play() {
  useTitle('Blockout Royale — Browser Trial')

  const [name, setName] = useState('')
  const [status, setStatus] = useState('idle') // idle | connecting | live | closed
  const [myId, setMyId] = useState(null)
  const [game, setGame] = useState(null)
  const wsRef = useRef(null)

  const send = useCallback((dir) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'move', dir }))
    }
  }, [])

  const connect = useCallback((playerName) => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${scheme}://${window.location.host}/ws`)
    wsRef.current = ws
    setStatus('connecting')

    ws.onopen = () => {
      setStatus('live')
      ws.send(JSON.stringify({ t: 'join', name: playerName }))
    }
    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.t === 'welcome') setMyId(msg.id)
      else if (msg.t === 'state') setGame(msg)
    }
    // ponytail: manual reconnect only. Add backoff retry if the link proves flaky.
    ws.onclose = () => setStatus('closed')
    ws.onerror = () => ws.close()
  }, [])

  // Leaving the page must drop the socket, or the server holds a ghost player.
  useEffect(() => () => wsRef.current?.close(), [])

  useEffect(() => {
    if (status !== 'live') return undefined
    function onKey(e) {
      const dir = KEYS[e.code]
      if (!dir) return
      e.preventDefault() // arrows must not scroll the page mid-round
      send(dir)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, send])

  // ---------- Name entry ----------
  if (status === 'idle') {
    return (
      <section className="blueprint mx-auto max-w-xl px-5 py-20">
        <p className="rule-label">Blockout Royale</p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">Browser trial</h1>
        <p className="mt-5 leading-relaxed text-muted">
          Two to four players, one shrinking grid. Tiles flash before they go.
          Stand on one when it does and you are out. Last one up takes the round.
        </p>
        <form
          className="mt-8 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            connect(name)
          }}
        >
          <label htmlFor="player-name" className="sr-only">
            Player name
          </label>
          <input
            id="player-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            placeholder="Your name"
            className="min-w-48 flex-1 border border-line bg-surface px-4 py-3.5 text-sm"
          />
          <button
            type="submit"
            className="bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
          >
            Drop in
          </button>
        </form>
      </section>
    )
  }

  // ---------- Disconnected ----------
  if (status === 'closed') {
    return (
      <section className="mx-auto max-w-xl px-5 py-20">
        <h1 className="display text-3xl">Connection lost</h1>
        <p className="mt-4 text-muted">
          The match server stopped answering. Your slot has been released.
        </p>
        <button
          type="button"
          onClick={() => connect(name)}
          className="mt-8 border border-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-flare transition-colors hover:bg-flare hover:text-on-flare"
        >
          Reconnect
        </button>
      </section>
    )
  }

  // ---------- Board ----------
  const size = game?.size ?? 9
  const slots = game ? game.players.filter((p) => p.playing) : []
  const occupied = new Map()
  slots.forEach((p, i) => {
    if (p.alive) occupied.set(p.y * size + p.x, { player: p, slot: i })
  })

  return (
    <section className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="display text-3xl">Blockout Royale</h1>
        <Link
          to="/games/blockout-royale"
          className="text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
        >
          About the game →
        </Link>
      </div>

      <p aria-live="polite" className="mt-3 border-l-2 border-flare pl-4 text-sm text-muted">
        {statusLine(game, myId)}
      </p>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_14rem]">
        <div
          role="img"
          aria-label={`Match grid, ${size} by ${size} tiles`}
          className="grid gap-px border border-line bg-line p-px"
          style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        >
          {(game?.tiles ?? []).map((t, i) => {
            const here = occupied.get(i)
            return (
              <div
                key={i}
                className={`flex aspect-square items-center justify-center text-[0.65rem] font-bold ${TILE[t]}`}
              >
                {here ? (
                  <span
                    className={`flex h-4/5 w-4/5 items-center justify-center ${PIECE[here.slot]}`}
                  >
                    {here.player.name.slice(0, 1).toUpperCase()}
                  </span>
                ) : (
                  t === 'warn' && <span aria-hidden="true">▲</span>
                )}
              </div>
            )
          })}
        </div>

        <div>
          <p className="rule-label">In the round</p>
          <ul className="mt-3 space-y-2">
            {slots.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`flex h-5 w-5 items-center justify-center text-[0.65rem] font-bold ${PIECE[i]}`}
                  aria-hidden="true"
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className={p.alive ? '' : 'text-muted line-through'}>{p.name}</span>
                {p.id === myId && <span className="rule-label">you</span>}
              </li>
            ))}
            {slots.length === 0 && <li className="text-sm text-muted">Nobody yet.</li>}
          </ul>

          <p className="rule-label mt-8">Controls</p>
          <p className="mt-2 text-sm text-muted">Arrow keys or WASD.</p>
          <div className="mt-3 grid w-40 grid-cols-3 gap-1.5">
            <span />
            <Arrow dir="up" glyph="▲" label="Move up" onMove={send} />
            <span />
            <Arrow dir="left" glyph="◀" label="Move left" onMove={send} />
            <span />
            <Arrow dir="right" glyph="▶" label="Move right" onMove={send} />
            <span />
            <Arrow dir="down" glyph="▼" label="Move down" onMove={send} />
            <span />
          </div>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Add the route**

In `src/App.jsx`, add the import beside the others and the route inside `<Route element={<Layout />}>`, above the `*` route:

```jsx
import Play from './pages/Play.jsx'
```
```jsx
<Route path="play" element={<Play />} />
```

- [ ] **Step 4: Play it**

Two terminals:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run game
```
```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run dev
```
Open `http://localhost:5173/play` in two browser windows, join with different names, and confirm:
- the first window says it is holding for players; the second starts the countdown
- arrow keys move your piece and the other window sees it
- tiles flash with a ▲ before turning into holes
- standing on a flashing tile eliminates you
- the last player standing is named as the winner and a new round starts
- closing one window releases that player and the other wins

- [ ] **Step 5: Check it does not scroll sideways or break the build**

Run: `npm run build`
Expected: build succeeds. Then narrow the browser to phone width on `/play` and confirm the board and the arrow buttons fit with no horizontal page scroll. Toggle to light theme and confirm warning tiles and pieces are still legible.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Play.jsx src/App.jsx vite.config.js
git commit -m "feat(play): browser trial page at /play"
```

---

### Task 6: Site links

**Files:**
- Modify: `src/components/Nav.jsx:5-9`
- Modify: `src/pages/GameDetail.jsx:60-73`

**Interfaces:**
- Consumes: the `/play` route from Task 5.
- Produces: nothing other tasks depend on.

`GameDetail` currently renders a dead "Play free" `<button>` for every title. Only Blockout Royale is playable, so that title gets a real link and the others keep the button.

- [ ] **Step 1: Add the nav link**

In `src/components/Nav.jsx`, extend the `links` array. Both the desktop and mobile menus map over it, so one line covers both:

```jsx
const links = [
  { to: '/games', label: 'Games' },
  { to: '/servers', label: 'Servers' },
  { to: '/play', label: 'Play' },
  { to: '/about', label: 'Studio' },
]
```

- [ ] **Step 2: Turn the CTA into a real link on Blockout Royale**

In `src/pages/GameDetail.jsx`, replace the `Play free` `<button>` element with:

```jsx
{game.slug === 'blockout-royale' ? (
  <Link
    to="/play"
    className="bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
  >
    Play in browser
  </Link>
) : (
  <button
    type="button"
    className="bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
  >
    Play free
  </button>
)}
```

`Link` is already imported in this file.

- [ ] **Step 3: Verify both links**

With `npm run dev` and `npm run game` running:
- "Play" appears in the header on desktop and inside the mobile menu, and highlights when you are on `/play`
- `/games/blockout-royale` shows "Play in browser" and it lands on `/play`
- `/games/deepshaft` still shows the plain "Play free" button
- Tab through the header and the game page: every control takes visible focus

- [ ] **Step 4: Commit**

```bash
git add src/components/Nav.jsx src/pages/GameDetail.jsx
git commit -m "feat(play): link the browser trial from the nav and game page"
```

---

### Task 7: Deployment

**Files:**
- Modify: `deploy/nginx.conf`
- Create: `deploy/rivalblocks-game.service`
- Modify: `deploy/DEPLOY.md`

**Interfaces:**
- Consumes: the server from Task 4 listening on `127.0.0.1:8081`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the WebSocket proxy**

In `deploy/nginx.conf`, insert above `location / {`:

```nginx
    # The game server. nginx matches the longest prefix, so this wins over
    # location / regardless of order — it sits here for readability.
    # Without the Upgrade headers the handshake fails and the board never loads.
    location /ws {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        # A quiet match must not be culled at the default 60s.
        proxy_read_timeout 1h;
    }
```

- [ ] **Step 2: Write the systemd unit**

Create `deploy/rivalblocks-game.service`:

```ini
[Unit]
Description=RivalBlocks Blockout Royale match server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/rivalblocks-game
ExecStart=/usr/bin/node server/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Document the deployment**

Append to `deploy/DEPLOY.md`:

````markdown
## The game server

`/play` needs a process holding the match. nginx keeps serving the site
exactly as before and proxies `/ws` to it.

### Install Node (once)

```bash
sudo apt update
sudo apt install -y nodejs
node --version
```

`npm` is deliberately not installed. The only dependency, `ws`, is pure
JavaScript with no build step and no dependencies of its own, so copying the
folder is a complete install — and the VM needs no internet access.

### Put the server in place

From Windows, `server/` and `node_modules/ws` travel over the same VMware
shared folder as `dist/`:

```bash
sudo rm -rf /opt/rivalblocks-game
sudo mkdir -p /opt/rivalblocks-game/node_modules
sudo cp -r /mnt/hgfs/<share-name>/server /opt/rivalblocks-game/
sudo cp -r /mnt/hgfs/<share-name>/node_modules/ws /opt/rivalblocks-game/node_modules/
sudo chown -R www-data:www-data /opt/rivalblocks-game
```

Check it starts before handing it to systemd:

```bash
sudo -u www-data node /opt/rivalblocks-game/server/server.js
```

Expect `Blockout Royale match server on ws://127.0.0.1:8081`. Ctrl-C.

### Run it under systemd (once)

```bash
sudo cp /mnt/hgfs/<share-name>/deploy/rivalblocks-game.service \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rivalblocks-game
systemctl status rivalblocks-game
```

### Reload nginx with the proxy

```bash
sudo cp /mnt/hgfs/<share-name>/deploy/nginx.conf \
        /etc/nginx/sites-available/rivalblocks
sudo nginx -t
sudo systemctl reload nginx
```

### Test

From another machine, open `http://<vm-ip>/play` in two browser windows, join
with two names, and play a round.

If the board never appears, the handshake is the first suspect:

```bash
curl -i -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  http://localhost/ws
```

Expect `HTTP/1.1 101 Switching Protocols`. Anything else means the `location
/ws` block did not take, or the service is down — check
`journalctl -u rivalblocks-game -n 50`.

### Redeploying the game

```bash
sudo systemctl stop rivalblocks-game
# re-copy server/ as above
sudo systemctl start rivalblocks-game
```

nginx needs nothing unless its config changed.

### What is on the wire

Traffic between browser and VM is plain `ws://` on port 80. Anyone running
Wireshark on this network reads player names, every move, and the full board
state as JSON, with no decryption step. That is fine here — the protocol
carries no credentials and no personal data, and the site is already plain
HTTP on a trusted internal network. Put TLS in front of both before this goes
anywhere wider.
````

- [ ] **Step 4: Verify the config parses**

There is no nginx on the Windows workstation, so `sudo nginx -t` on the VM is
the only real check. Run it there before reloading. Confirm locally instead
that the file is well-formed by eye: braces balanced, every directive ends in
a semicolon, `location /ws` sits inside the `server` block.

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx.conf deploy/rivalblocks-game.service deploy/DEPLOY.md
git commit -m "docs(deploy): run the match server behind nginx"
```

---

## Final verification

- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Two browsers on different machines complete a round against each other
- [ ] A third and fourth player can join and appear in the next round
- [ ] A fifth player spectates and is dealt in when a slot frees
- [ ] Wireshark on the lab network, filtered to `websocket`, shows the join and move messages and the state broadcasts as readable JSON
- [ ] Keyboard-only: tab to the name field, join, and play using arrow keys; the arrow buttons are reachable and labelled
- [ ] Light and dark themes both render the board legibly, and warning tiles are identifiable without colour
- [ ] `/play` reloads correctly on the VM (nginx SPA fallback still applies)
