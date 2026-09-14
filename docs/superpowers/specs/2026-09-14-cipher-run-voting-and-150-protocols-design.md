# Cipher Run: Pre-Round Difficulty Voting & 151 Curated Protocols Design Spec

**Date**: 2026-09-14  
**Status**: Draft  
**Scope**: Server rules engine (`server/cipherrun.js`), protocol corpus (`server/cipherrun-protocols.js`), network adapter (`server/cipherrun-server.js`), deterministic unit test suite (`server/cipherrun.test.js`), client dual-layer voting UI (`src/pages/CipherRun.jsx`).

---

## 1. Overview & Objectives

Cipher Run is an authoritative multiplayer cyberpunk typing decryption race. Currently, the game operates on 18 curated protocols across 3 difficulty tiers.

This specification expands the game to:
1. **151 Curated Protocols**:
   - 50 Short Protocols (Tier 1, 15 to 25 words).
   - 50 Medium Protocols (Tier 2, 40 to 60 words).
   - 50 Long Protocols (Tier 3, 85 to 125 words).
   - 1 Easter Egg Protocol (Protocol 151: "I LOVE RIVALBLOCKS." repeated 20 times).
2. **Pre-Round Multi-Client Difficulty Voting**:
   - Authoritative 5-second voting phase (`VOTE_DURATION_MS = 5000`) before each race countdown.
   - Home-row hotkeys (`1` Short, `2` Medium, `3` Long) and interactive clickable voting cards.
   - Real-time vote tallies and consensus percentages broadcast via server snapshots.
   - Authoritative tie-breaker and 2% Easter Egg roll mechanics.

---

## 2. Paragraph Database & Generation Architecture

### 2.1 Storage & Structure (`server/cipherrun-protocols.js`)

To keep `server/cipherrun.js` clean, pure, and focused on simulation rules, all 151 protocols will reside in `server/cipherrun-protocols.js` and be re-exported by `server/cipherrun.js`.

Each protocol object conforms to:
```javascript
{
  id: number,          // 1..151
  title: string,       // e.g. "Protocol 01 // Memory Buffer Flush"
  tier: 1 | 2 | 3,     // 1 = Short, 2 = Medium, 3 = Long
  category: string,   // "short" | "medium" | "long" | "easter_egg"
  text: string,        // In-fiction cyberpunk technical prose
}
```

### 2.2 Difficulty Tiers

- **Tier 1: Short (Protocols 1 to 50)**:
  - **Word count**: 15 to 25 words (~90 to 160 characters).
  - **Theme**: Rapid memory dumps, privilege escalations, emergency port overrides, telemetry bypasses.
  - **Pacing**: 10 to 25 seconds per race.
- **Tier 2: Medium (Protocols 51 to 100)**:
  - **Word count**: 40 to 60 words (~240 to 380 characters).
  - **Theme**: Hardware bus arbitration, cryptographic key cracking, neural subnet routing, pipeline flush logic.
  - **Pacing**: 30 to 60 seconds per race.
- **Tier 3: Long (Protocols 101 to 150)**:
  - **Word count**: 85 to 125 words (~550 to 820 characters).
  - **Theme**: Deep orbital mainframe takeovers, quantum decryption sweeps, hardened vault penetrations, automated countermeasure evasion.
  - **Pacing**: 60 to 120 seconds per race.
- **Easter Egg: Protocol 151 (Subliminal Devotion Directive)**:
  - **Title**: `Protocol 151 // Subliminal Devotion Directive`
  - **Tier**: 1 (selectable across any tier via 2% roll)
  - **Category**: `easter_egg`
  - **Text**: `"I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS. I LOVE RIVALBLOCKS."`
  - Exactly 20 repetitions, 60 words, 420 characters.

### 2.3 Style & Editorial Standards
- Strictly technical, immersive cyberpunk terminology.
- Balanced keyboard distribution (common punctuation, numbers, capitalization, mixed hand movement).
- **Strictly zero em dashes (`—`)** anywhere in titles or body text.

### 2.4 Three-Subagent Parallel Authoring Plan
During execution, three subagents will run concurrently to generate the paragraphs:
- **Subagent 1 (Short Protocol Author)**: Drafts protocols 1 to 50 adhering to 15 to 25 word limits.
- **Subagent 2 (Medium Protocol Author)**: Drafts protocols 51 to 100 adhering to 40 to 60 word limits.
- **Subagent 3 (Long Protocol Author)**: Drafts protocols 101 to 150 adhering to 85 to 125 word limits.

---

## 3. Rules Engine State Machine & Voting Mechanics (`server/cipherrun.js`)

### 3.1 Phase Transitions

```
[ waiting ] ──(players present / start)──> [ voting (5s) ] ──(timer = 0)──> [ countdown (5s) ]
     ▲                                             │                               │
     │                                             │ (resolve tier & protocol)     │
     │                                             ▼                               ▼
[ over (6s podium) ] <───(race finishes)──── [ racing ] <────────────── (countdown = 0)
```

- **`waiting`**: Match idle in lobby. Moves to `voting` when human joins or ready is triggered.
- **`voting` (`VOTE_DURATION_MS = 5000`)**:
  - `match.voteTimer` counts down from 5000ms.
  - `match.votes`: Map of `playerId -> tier (1 | 2 | 3)`.
  - Players can cast or change their vote anytime during this window.
- **Resolution when `voteTimer <= 0`**:
  1. Tally votes for Tier 1, Tier 2, Tier 3.
  2. If a single tier has the strict plurality, it wins.
  3. If tied (or zero votes cast), pick randomly among the tied top tiers using injected `rng()`.
  4. **Easter Egg Check**: Roll `rng() < 0.02` (2% probability).
     - If true: Select Protocol 151. `match.easterEgg = true`.
     - If false: Draw randomly from the 50 protocols of the winning tier. `match.easterEgg = false`.
  5. Set `match.protocol` to the chosen protocol.
  6. Transition to `phase = 'countdown'` (`COUNTDOWN_MS = 5000`).
- **`countdown`**: 5-second countdown with selected text already displayed on all clients.
- **`racing`**: Real-time typing race.
- **`over` (`POST_RACE_GRACE_MS = 6000`)**: 6-second podium celebration. When timer expires, restarts into `voting` if players remain.

### 3.2 Pure API Functions

- `castVote(match, playerId, tier)`: Records vote in `match.votes`. Clamps `tier` to `1 | 2 | 3`.
- `getVoteTallies(match)`: Returns `{ short: count, medium: count, long: count, total: count }`.
- `resolveVote(match, rng)`: Resolves winning tier, executes 2% Easter Egg roll, and assigns `match.protocol`.
- `snapshot(match)`: Public state broadcast including `voteTimer`, `votes`, `easterEgg`, `winningTier`.

---

## 4. Network Wire Protocol (`server/cipherrun-server.js`)

### 4.1 Client to Server Frames

- **Cast Vote Frame**:
  ```json
  { "t": "vote", "tier": 1 }
  ```
  *(Tier accepts numeric `1`, `2`, `3` or strings `"short"`, `"medium"`, `"long"`).*

### 4.2 Server to Client Snapshot

```json
{
  "t": "snap",
  "seq": 142,
  "phase": "voting",
  "voteTimer": 4,
  "votes": {
    "short": 2,
    "medium": 1,
    "long": 0,
    "total": 3
  },
  "myVote": 1,
  "easterEgg": false,
  "protocol": {
    "id": 14,
    "title": "Protocol 14 // Logic Gate Cascade",
    "tier": 2,
    "length": 268
  },
  "players": [...]
}
```

---

## 5. Client Dual-Layer Voting UI (`src/pages/CipherRun.jsx`)

### 5.1 Interactive Vote Deck (during `phase === 'voting'`)
- Positioned above the text buffer in the active terminal region.
- **Header**: `PROTOCOL CONSENSUS WINDOW // VOTE CLOSES IN [ 5s ]` with animated progress line.
- **Three Voting Cards**:
  - `[1] SHORT BREACH` (15 to 25 words // Fast Infiltration // Vote Count & Bar)
  - `[2] MEDIUM OVERRIDE` (40 to 60 words // Kernel Bus Control // Vote Count & Bar)
  - `[3] LONG MAINFRAME` (85 to 125 words // Black Ice Penetration // Vote Count & Bar)
- **Home-Row Keyboard Controls**:
  - Pressing `1`, `2`, or `3` submits a vote without taking hands off the home row.
  - Clicking any card submits a vote.
  - Active selection is highlighted in neon flare orange with an active radio glyph (`◉`).

### 5.2 Protocol 151 Easter Egg Visuals
- When `snap.easterEgg` is true:
  - Header displays flashing warning banner:
    `[!] ANOMALOUS OVERRIDE DETECTED // PROTOCOL 151 SUBLIMINAL DEVOTION CASCADE [!]`
  - Text buffer renders the 20 repetitions in neon flare text.
  - Chibi sprinters trigger celebratory dash and cheer frames.

### 5.3 Solo Drawer Expansion
- The Protocol Selection Drawer expands to navigate all 151 protocols by tier tabs (`Tier 1 (50)`, `Tier 2 (50)`, `Tier 3 (50)`, `Easter Egg (1)`).
- Allows solo operators to practice any specific protocol on demand.

---

## 6. Verification Plan

### 6.1 Automated Unit Tests (`server/cipherrun.test.js`)
- Verify all 151 protocols exist, have unique IDs, valid titles, valid word counts, and zero em dashes.
- Test `castVote()` records votes and ignores invalid tiers.
- Test `resolveVote()` plurality win resolution.
- Test `resolveVote()` tie-breaker randomness with deterministic RNG.
- Test `resolveVote()` 2% Easter Egg roll triggers Protocol 151.
- Test snapshot serialization during `voting` phase.

### 6.2 Full Test Suite & Production Build
- Run `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm.cmd test`.
- Run `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm.cmd run build`.
