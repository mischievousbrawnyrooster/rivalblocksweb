# Cipher Run Difficulty Voting & 151 Protocols Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Cipher Run with 151 technical cyberpunk typing protocols across 3 difficulty tiers (50 short, 50 medium, 50 long, plus Protocol 151 Easter Egg), and implement an authoritative 5-second pre-round difficulty voting phase with real-time consensus tallies and home-row keyboard hotkeys.

**Architecture:** A dedicated pure data file `server/cipherrun-protocols.js` stores the 151 protocols, re-exported by `server/cipherrun.js`. The pure rules engine implements a `voting` phase (`VOTE_DURATION_MS = 5000`) before `countdown`, resolving pluralities, ties, and 2% Easter Egg rolls with injected RNG. The WebSocket server relays votes and broadcasts tallies. The client UI renders an interactive Cyber Vote Deck with `1`/`2`/`3` keybindings, live progress bars, and an Easter Egg alert banner.

**Tech Stack:** Node.js (pure ES modules), WebSockets (`ws`), React, Tailwind CSS, Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-09-14-cipher-run-voting-and-150-protocols-design.md`

## Global Constraints

- Pure rules engine: `server/cipherrun.js` and `server/cipherrun-protocols.js` must contain zero external imports, zero Node APIs, zero timers, zero I/O.
- Network adapter: `server/cipherrun-server.js` contains zero game decisions, only relays inputs and broadcasts snapshots.
- Strict server authority: client only transmits intent (`{ t: 'vote', tier }`), server decides winning tier and protocol.
- Zero em dashes: strictly NO em dashes (`—`) in any titles, protocols, copy, or docs.
- Windows environment: use `$env:PATH = "C:\Program Files\nodejs;$env:PATH"` and `npm.cmd`.
- Line endings must be CRLF (`\r\n`).

---

### Task 1: Protocol Corpus Generation & Storage (`server/cipherrun-protocols.js`, `server/cipherrun.js`)

**Files:**
- Create: `server/cipherrun-protocols.js`
- Modify: `server/cipherrun.js`
- Test: `server/cipherrun.test.js`

**Interfaces:**
- Produces: `PROTOCOLS` (array of 151 protocol objects `{ id, title, tier, category, text }`), `EASTER_EGG_PROTOCOL` (id 151).
- Subagents: 3 parallel subagents generate 50 short (IDs 1-50, 15-25 words), 50 medium (IDs 51-100, 40-60 words), and 50 long (IDs 101-150, 85-125 words).

- [ ] **Step 1: Dispatch 3 parallel subagents to generate the 50 Short, 50 Medium, and 50 Long protocols**
  - Subagent 1: Drafts IDs 1 to 50 (Tier 1 Short, 15 to 25 words).
  - Subagent 2: Drafts IDs 51 to 100 (Tier 2 Medium, 40 to 60 words).
  - Subagent 3: Drafts IDs 101 to 150 (Tier 3 Long, 85 to 125 words).
- [ ] **Step 2: Assemble `server/cipherrun-protocols.js` with all 151 protocols**
  - Include IDs 1 to 150.
  - Include Protocol 151: Title `Protocol 151 // Subliminal Devotion Directive`, text `"I LOVE RIVALBLOCKS. "` repeated 20 times.
- [ ] **Step 3: Update `server/cipherrun.js` to re-export `PROTOCOLS` from `server/cipherrun-protocols.js`**
- [ ] **Step 4: Write failing unit test in `server/cipherrun.test.js`**
  - Test verifying exactly 151 protocols exist.
  - Test verifying 50 tier 1, 50 tier 2, 50 tier 3, and 1 easter egg protocol.
  - Test verifying word count bounds for all tiers.
  - Test verifying zero em dashes across all 151 titles and texts.
- [ ] **Step 5: Run tests to verify pass**
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node --test server/cipherrun.test.js`
- [ ] **Step 6: Commit**
  ```bash
  git add server/cipherrun-protocols.js server/cipherrun.js server/cipherrun.test.js
  git commit -m "feat(cipherrun): add 151 curated typing protocols and easter egg"
  ```

---

### Task 2: Rules Engine Voting State Machine & Easter Egg Roll (`server/cipherrun.js`, `server/cipherrun.test.js`)

**Files:**
- Modify: `server/cipherrun.js`
- Test: `server/cipherrun.test.js`

**Interfaces:**
- Produces: `VOTE_DURATION_MS = 5000`, `castVote(match, playerId, tier)`, `getVoteTallies(match)`, `resolveVote(match, rng)`, updated `tick()`, updated `snapshot()`.

- [ ] **Step 1: Write failing unit tests for voting in `server/cipherrun.test.js`**
  - Test `castVote()` records votes for tier 1, 2, 3 and rejects invalid values.
  - Test `getVoteTallies()` calculates counts and percentages.
  - Test `resolveVote()` picks winning tier by plurality.
  - Test `resolveVote()` breaks ties randomly with deterministic RNG.
  - Test `resolveVote()` triggers Protocol 151 when 2% roll passes.
  - Test `tick()` transitions `waiting` -> `voting` -> `countdown` on timer expiration.
  - Test `snapshot()` exposes `voteTimer`, `votes`, `easterEgg`.
- [ ] **Step 2: Run test to verify RED**
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node --test server/cipherrun.test.js`
- [ ] **Step 3: Implement voting state machine in `server/cipherrun.js`**
  - Add `VOTE_DURATION_MS = 5000` constant.
  - Update `make()`: initialize `votes: new Map()`, `voteTimer: VOTE_DURATION_MS`, `easterEgg: false`.
  - Implement `castVote(match, playerId, tier)`.
  - Implement `getVoteTallies(match)`.
  - Implement `resolveVote(match, rng)`.
  - Update `tick()` to decrement `voteTimer`, call `resolveVote()` when expired, and transition to `countdown`.
  - Update `snapshot()` to include `voteTimer`, `votes`, `easterEgg`.
- [ ] **Step 4: Run tests to verify GREEN**
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node --test server/cipherrun.test.js`
- [ ] **Step 5: Commit**
  ```bash
  git add server/cipherrun.js server/cipherrun.test.js
  git commit -m "feat(cipherrun): authoritative voting state machine and easter egg roll"
  ```

---

### Task 3: WebSocket Network Adapter Voting Lifecycle (`server/cipherrun-server.js`)

**Files:**
- Modify: `server/cipherrun-server.js`

**Interfaces:**
- Consumes: `castVote`, `VOTE_DURATION_MS`, `resolveVote`, `PROTOCOLS` from `server/cipherrun.js`.
- Produces: WebSocket frame handling for `{ t: 'vote', tier }`, broadcast of voting state snapshots.

- [ ] **Step 1: Handle `{ t: 'vote', tier }` message in `server/cipherrun-server.js`**
  - Parse and normalize `msg.tier` (numeric `1`, `2`, `3` or strings `"short"`, `"medium"`, `"long"`).
  - Call `castVote(match, ws.player.id, tierNum)`.
- [ ] **Step 2: Ensure match transitions to `voting` on restart or initial player join**
  - Reset votes on match restart.
  - Broadcast 30 Hz snapshots containing `phase: 'voting'` and live vote tallies.
- [ ] **Step 3: Verify server boots, accepts vote frames, and ticks cleanly**
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node -e "import('./server/cipherrun-server.js'); setTimeout(() => process.exit(0), 800)"`
- [ ] **Step 4: Run full test suite**
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm.cmd test`
- [ ] **Step 5: Commit**
  ```bash
  git add server/cipherrun-server.js
  git commit -m "feat(cipherrun): handle vote websocket frames and relay tallies"
  ```

---

### Task 4: Client Dual-Layer Voting UI & Easter Egg Visuals (`src/pages/CipherRun.jsx`)

**Files:**
- Modify: `src/pages/CipherRun.jsx`

**Interfaces:**
- Consumes: Snapshot `phase === 'voting'`, `voteTimer`, `votes`, `easterEgg`.
- Produces: Interactive 3-card voting UI, keyboard listeners `1`, `2`, `3`, Easter Egg warning banner, expanded 151-protocol drawer.

- [ ] **Step 1: Add Vote Deck overlay in `src/pages/CipherRun.jsx` during `phase === 'voting'`**
  - Render 3 difficulty cards:
    - Card 1: `[1] Short (15-25 words)` // Live vote count & bar.
    - Card 2: `[2] Medium (40-60 words)` // Live vote count & bar.
    - Card 3: `[3] Long (85-125 words)` // Live vote count & bar.
  - Active selection highlighted in flare orange.
  - Animated 5s countdown header: `PROTOCOL CONSENSUS // TIME REMAINING: [ Xs ]`.
- [ ] **Step 2: Add keyboard hotkey listener for `1`, `2`, `3`**
  - Pressing `1`, `2`, or `3` when `snap.phase === 'voting'` calls `handleVote(1 | 2 | 3)` and sends `{ t: 'vote', tier: N }`.
- [ ] **Step 3: Implement Protocol 151 Easter Egg aesthetics**
  - When `snap.easterEgg` is true:
    - Display flashing emergency header: `[!] ANOMALOUS OVERRIDE DETECTED // PROTOCOL 151 DEVOTION CASCADE [!]`.
    - Render repeating `"I LOVE RIVALBLOCKS."` in flare orange monospace text.
- [ ] **Step 4: Update Solo Protocol Drawer**
  - Add tabs for `Tier 1 (50)`, `Tier 2 (50)`, `Tier 3 (50)`, `Easter Egg (1)`.
  - Allow instant solo practice for all 151 protocols.
- [ ] **Step 5: Run test suite and build verification**
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm.cmd test`
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm.cmd run build`
- [ ] **Step 6: Commit**
  ```bash
  git add src/pages/CipherRun.jsx
  git commit -m "feat(cipherrun): interactive vote deck, home-row hotkeys, and easter egg banner"
  ```

---

### Task 5: Whole-Branch Verification & Documentation (`CLAUDE.md`, `GEMINI.md`)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`

- [ ] **Step 1: Update documentation in `CLAUDE.md` and `GEMINI.md`**
  - Record 151 protocols (50 short, 50 medium, 50 long, Protocol 151 Easter Egg).
  - Record authoritative 5s pre-round voting phase and home-row hotkeys (`1`, `2`, `3`).
  - Maintain strictly zero em dashes in all documentation.
- [ ] **Step 2: Run complete automated test suite**
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm.cmd test`
- [ ] **Step 3: Run complete static production build**
  Run: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm.cmd run build`
- [ ] **Step 4: Commit**
  ```bash
  git add CLAUDE.md GEMINI.md
  git commit -m "docs(cipherrun): document 151 protocols, voting state machine, and easter egg"
  ```

