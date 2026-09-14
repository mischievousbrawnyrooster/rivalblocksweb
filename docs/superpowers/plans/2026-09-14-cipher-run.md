# Cipher Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Cipher Run, an authoritative multiplayer cyberpunk terminal typing decryption race game with 18 curated protocols, Monkeytype standard WPM/accuracy tracking, live multi-lane Chibi Cyber Sprinter animation, solo time attack, and global leaderboards.

**Architecture:** Three-layer architecture matching repository standards: pure rules engine (`server/cipherrun.js`), WebSocket network adapter on port 8087 (`server/cipherrun-server.js`), shared pure leaderboard persistence (`server/board.js`), and React client interface (`src/pages/CipherRun.jsx`) with live multi-lane anime sprite animation.

**Tech Stack:** Node.js (v24 native test runner), WebSocket (`ws`), React, Tailwind CSS v4, HTML Canvas & CSS Sprite Animation, Vite dev proxy.

**Spec:** `docs/superpowers/specs/2026-09-14-cipher-run-design.md`

## Global Constraints
- Node is installed at `C:\Program Files\nodejs`. When running PowerShell commands: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"`.
- Pure Rules Engine in `server/cipherrun.js` must have zero external imports, zero Node APIs, zero sockets, zero timers, zero I/O.
- Leaderboard logic in `server/board.js` must remain pure and runnable in both browser and Node.js.
- WebSockets run plain `ws://` on port 8087 without TLS, `perMessageDeflate: false`, and `maxPayload: 4096`.
- Copy style: Terse phrasing, short sentences, and strictly no em dashes in marketing copy.
- Tests reference constants rather than hardcoded literals.
- Repo files use CRLF line endings on Windows.

---

### Task 1: Pure Rules Engine & Deterministic Test Suite

**Files:**
- Create: `server/cipherrun.js`
- Test: `server/cipherrun.test.js`

**Interfaces:**
- Produces:
  - `PROTOCOLS`: Array of 18 protocol objects `{ id, title, tier, text }`
  - `make(options)`: Returns initial match state `{ phase, protocol, players, ... }`
  - `join(match, playerInfo)`: Seats player and returns player object
  - `leave(match, playerId)`: Removes player and resolves match if empty
  - `processInput(match, playerId, input)`: Processes keystroke, updates cursor, errors, WPM, accuracy, and glitch lockout
  - `tick(match, dtMs, rng)`: Advances countdown, calculates WPM, drives bots, and checks victory
  - `snapshot(match)`: Returns serialized public state frame for wire broadcast
  - Constants: `TICK_MS`, `COUNTDOWN_MS`, `LOCKOUT_MS`, `CONSECUTIVE_ERROR_LIMIT`, `MAX_PLAYERS`, `BOT_FILL_TO`

- [ ] **Step 1: Write failing unit tests for rules engine**

Create `server/cipherrun.test.js` covering:
- WPM calculation matching Monkeytype standard (`(correct / 5) / (time / 60)`)
- Accuracy calculation (`(correct / total) * 100`)
- Exact character matching, backspace recovery, and spacebar word skipping
- Terminal glitch lockout triggering on 3 consecutive errors and blocking keystrokes during 350ms freeze
- Match lifecycle transitions from `waiting` to `countdown` (5s) to `racing` to `over`
- First player to complete text wins the match
- AI bot typers generating realistic WPM and recovering from simulated typos

- [ ] **Step 2: Run test to verify RED**

Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node --test server/cipherrun.test.js`
Expected: FAIL with "Cannot find module './cipherrun.js'"

- [ ] **Step 3: Implement pure rules engine in `server/cipherrun.js`**

Implement all exports:
- Protocol registry with all 18 curated protocols
- Monkeytype standard WPM, Raw WPM, Accuracy, and Progress math
- Keystroke processor handling alphanumeric inputs, Backspace, Spacebar word jump, and Glitch Lockout
- Natural bot typist simulator in `driveBots(match, rng)`
- Authoritative snapshot serializer `snapshot(match)`

- [ ] **Step 4: Run test to verify GREEN**

Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node --test server/cipherrun.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/cipherrun.js server/cipherrun.test.js
git commit -m "feat(cipherrun): pure rules engine, protocols, and test suite"
```

---

### Task 2: Network Adapter & Server Lifecycle

**Files:**
- Create: `server/cipherrun-server.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `server/cipherrun.js` (`make`, `join`, `leave`, `processInput`, `tick`, `snapshot`, `TICK_MS`, `BOT_FILL_TO`)
- Consumes: `server/board.js` (`boardFor`), `server/board-store.js` (`keeper`)
- Produces: WebSocket server on port 8087 (`/cipherrun-ws`) supporting `'cipherrun.v1'` subprotocol, handling join, input, restart, and admin frames

- [ ] **Step 1: Implement WebSocket network adapter in `server/cipherrun-server.js`**

Implement:
- WebSocketServer on port 8087, cleartext `ws://`, `maxPayload: 4096`, `perMessageDeflate: false`
- Support for subprotocol `'cipherrun.v1'`
- Welcome frame `{ t: 'welcome', id, slot, mode, protocol }`
- Input relay `{ t: 'input', key, cursor }`
- Solo time attack mode launch and multiplayer lobby queueing
- 30 Hz tick loop with synchronous snapshot serialization and board banking
- Automatic match reset after 6 seconds in `over` phase

- [ ] **Step 2: Add `"cipher": "node server/cipherrun-server.js"` to `package.json` scripts**

- [ ] **Step 3: Verify server startup and quick tick cycle**

Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node -e "import('./server/cipherrun-server.js'); setTimeout(() => process.exit(0), 800)"`
Expected: "Cipher Run match server on ws://127.0.0.1:8087" without uncaught errors

- [ ] **Step 4: Commit**

```bash
git add server/cipherrun-server.js package.json
git commit -m "feat(cipherrun): WebSocket network adapter and npm cipher script"
```

---

### Task 3: Shared Leaderboard Storage & Pure Logic

**Files:**
- Modify: `server/board.js`
- Modify: `server/board.test.js`

**Interfaces:**
- Produces: `board-cipherrun.json` registered in `BOARDS`, ranking by `wins` first, then `peakWpm`, then `avgAcc`, then `fastestTime`

- [ ] **Step 1: Write failing unit test in `server/board.test.js` for Cipher Run board**

Test:
- `boardFor('cipherrun')` finds `board-cipherrun.json` with single writer
- `merge()` records `wpm` (as `peakWpm`) and `acc` (as `avgAcc`) alongside `wins` and `fastestTime`
- `rank()` sorts typing board by wins and peak WPM

- [ ] **Step 2: Run test to verify RED**

Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node --test --test-name-pattern="cipherrun" server/board.test.js`
Expected: FAIL

- [ ] **Step 3: Update `server/board.js`**

- Add `{ file: 'board-cipherrun.json', game: 'cipherrun', mode: null, title: 'Cipher Run' }` to `BOARDS`
- Support `peakWpm` and `avgAcc` in `rowFor`, `isRow`, `merge`, `rank`, and `combine`

- [ ] **Step 4: Run test to verify GREEN**

Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node --test server/board.test.js`
Expected: All 38+ tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/board.js server/board.test.js
git commit -m "feat(cipherrun): leaderboard registration and typing metric tracking"
```

---

### Task 4: Key Art, Catalog, Proxy, & Routing Integration

**Files:**
- Modify: `src/data/games.js`
- Modify: `src/data/servers.js`
- Modify: `vite.config.js`
- Modify: `src/lib/favicons.js`
- Modify: `src/App.jsx`
- Modify: `src/pages/PlayIndex.jsx`
- Modify: `src/pages/LeaderboardPage.jsx`

- [ ] **Step 1: Add Cipher Run to games catalog in `src/data/games.js`**

Add entry:
- id: `'cipher-run'`
- title: `'Cipher Run'`
- tagline: `'Terminal Decryption Race'`
- route: `'/play/cipher-run'`
- port: `8087`
- wsPath: `'/cipherrun-ws'`
- art: `'/art/cipher-run.jpg'`
- description with strictly zero em dashes

- [ ] **Step 2: Add server status entry in `src/data/servers.js` and dev proxy in `vite.config.js`**

Add `/cipherrun-ws` proxy target to `ws://127.0.0.1:8087`.

- [ ] **Step 3: Add favicon mark in `src/lib/favicons.js`, route in `src/App.jsx`, playPath in `LeaderboardPage.jsx`, and game in `PlayIndex.jsx`**

- [ ] **Step 4: Verify build succeeds**

Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm.cmd run build`
Expected: Build succeeds with new route

- [ ] **Step 5: Commit**

```bash
git add src/data/games.js src/data/servers.js vite.config.js src/lib/favicons.js src/App.jsx src/pages/PlayIndex.jsx src/pages/LeaderboardPage.jsx
git commit -m "feat(cipherrun): catalog, routing, dev proxy, and favicon integration"
```

---

### Task 5: Client Dual-Layer Terminal UI with Anime Chibi Sprinters

**Files:**
- Create: `src/pages/CipherRun.jsx`
- Modify: `src/components/Leaderboard.jsx` (optional WPM/accuracy column rendering for Cipher Run)

**Interfaces:**
- Consumes: WebSocket connection to `/cipherrun-ws`
- Displays:
  - Multi-lane Race Deck with animated Chibi Cyber Sprinters (`/art/runner-sprites.jpg`)
  - Word-dash impulse on spacebar completion
  - Leg pump stride cadence scaling with real-time WPM
  - Glitch stumble animation on 3 consecutive errors
  - Decryption text buffer with character-by-character color cues (green correct, red error, amber cursor, gray pending)
  - Telemetry gauges (WPM, Raw WPM, Accuracy, Time)
  - Solo protocol selector drawer

- [ ] **Step 1: Implement `src/pages/CipherRun.jsx`**

Implement:
- WebSocket connection with loopback fallback
- Input capture handling physical keyboard and mobile devices
- Character buffer rendering with exact monospace font alignments
- Race Deck canvas/CSS renderer drawing each racer's animated Chibi Sprinter from `/art/runner-sprites.jpg` with slot color filters and dust puffs
- Live telemetry bar displaying WPM, Raw WPM, Accuracy, and Elapsed Time
- Glitch static overlay on lockout
- Solo protocol browser drawer

- [ ] **Step 2: Run test suite and production build**

Run:
```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd test
npm.cmd run build
```
Expected: All tests pass, build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/pages/CipherRun.jsx src/components/Leaderboard.jsx
git commit -m "feat(cipherrun): client terminal interface and anime chibi sprinter race deck"
```

---

### Task 6: Documentation & Whole-Branch Verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`

- [ ] **Step 1: Document Cipher Run architecture and invariants in `CLAUDE.md` and `GEMINI.md`**

Record:
- Port 8087, script `npm.cmd run cipher`, route `/play/cipher-run`
- Monkeytype standard WPM calculation
- 350ms glitch lockout on 3 consecutive errors
- Chibi Sprinter animation states

- [ ] **Step 2: Run full verification suite**

Run:
```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd test
npm.cmd run build
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md GEMINI.md
git commit -m "docs(cipherrun): record typing engine invariants and command scripts"
```
