# GEMINI.md

This file provides guidance and codebase context for Antigravity when working in this repository.

## Commands & Environment (Windows / PowerShell)

Node is installed at `C:\Program Files\nodejs`. When running commands in PowerShell, prepend to `PATH` and use `npm.cmd` to bypass PowerShell script execution policy restrictions:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd test         # node --test over src/lib and server/*.test.js (339 tests)
npm.cmd run dev      # vite dev server on 0.0.0.0:5173
npm.cmd run game     # Blockout Royale              127.0.0.1:8081  ← /ws
npm.cmd run fracture # Fracture Line                127.0.0.1:8082  ← /fracture-ws
npm.cmd run blast    # Blastworks (Last Man)        127.0.0.1:8083  ← /blast-ws
npm.cmd run blast:dm # Blastworks (Deathmatch)      127.0.0.1:8084  ← /blast-dm-ws
npm.cmd run drillers # Void Drillers                127.0.0.1:8086  ← /voiddrillers-ws
npm.cmd run cipher   # Cipher Run                   127.0.0.1:8087  ← /cipherrun-ws
npm.cmd run build    # static production build to dist/
```

Single test by name pattern:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
node --test --test-name-pattern="cooldown" server/game.test.js
```

### Operational Traps
- **Play routes require both `npm.cmd run dev` AND the respective match server process.** Without the match server running, Vite's proxy will fail to forward WebSocket connections.
- **Match servers are stateful and hold all state in memory.** Modifying files under `server/` has no effect until you restart the corresponding match server. Vite hot-reloads the frontend; match servers do not.

---

## Codebase Structure & Architectural Split

The project contains a static marketing SPA and six authoritative multiplayer games sharing one build.

### Strict Three-Layer Architecture

| Component / Layer | Files | Responsibilities | Constraints (Must NEVER contain) |
|---|---|---|---|
| **Rules Engine** | `server/game.js`, `server/fracture.js`, `server/blastworks.js`, `server/blockout3d.js`, `server/voiddrillers.js`, `server/cipherrun.js` | Authoritative match state, movement, collision, elimination, powerups, tick logic | **Zero external imports, zero Node APIs, zero sockets, zero timers, zero I/O**. Completely pure functions. |
| **Network Adapter** | `server/server.js`, `server/fracture-server.js`, `server/blastworks-server.js`, `server/blockout3d-server.js`, `server/voiddrillers-server.js`, `server/cipherrun-server.js` | WebSocket lifecycle, frame parsing, validation, snapshot broadcasts | **Zero game decisions or simulation logic**. Only relays client input and broadcasts snapshots. |
| **Shared Pure Logic** | `server/board.js` | Leaderboard merging, ranking, K/D math | **Runs in both Node.js and the browser**. No Node APIs, no clock (`Date.now` passed in). |
| **Storage Layer** | `server/board-store.js` | Reading/writing the leaderboard JSON files | **Single-writer per file**. No locking needed. Corrupted files fall back to empty boards. |
| **Client UI** | `src/pages/Play.jsx`, `src/pages/Fracture.jsx`, `src/pages/Blastworks.jsx`, `src/pages/Blockout3D.jsx`, `src/pages/VoidDrillers.jsx`, `src/pages/CipherRun.jsx` | Canvas / DOM rendering, keyboard/mouse input uplink | **No client-side simulation, prediction, or rollback**. Pure rendering of authoritative server snapshots. |


---

## Key Invariants & Security Hardening

1. **Strict Server Authority**:
   - The client only transmits intent (`{t: 'join' | 'move' | 'input' | 'use'}`).
   - The server decides position, collision, validity, elimination, and victory.
   - Snapshots are broadcast at 10 Hz (grid games), 30 Hz (Fracture Line), or 60 Hz (Blockout 3D, Void Drillers).
   - In continuous games (`Fracture.jsx`), the client renders `DELAY_MS = 100` behind the latest snapshot, smoothly interpolating between two known server states without client prediction or rollback.

2. **Snapshot Reference Safety**:
   - `snapshot(match)` returns tile arrays **by live reference**.
   - `server.js` serializes `JSON.stringify(snapshot(match))` synchronously within the same event loop tick as `tick()`. Never retain a snapshot reference across an `await` or timer.

3. **Prototype Pollution Hardening**:
   - Direction lookups must use `Object.hasOwn(DIRS, dir)`. A bare `DIRS[dir]` check permits `__proto__` and `constructor`, which corrupts coordinates to `NaN` and makes players immortal.
   - Leaderboard player lists in `server/board.js` are flat arrays, never objects keyed by player name.

4. **DoS & Payload Defense**:
   - Player names are sliced to 256 characters *before* character iteration and regex filtering (`sanitizeName`).
   - WebSockets enforce `maxPayload: 4096` to prevent oversized join frames from crashing the server process.

5. **Concurrency Without Locks**:
   - Seven board files (`board-blockout.json`, `board-blockout3d.json`, `board-fracture.json`, `board-blastworks-lastman.json`, `board-blastworks-deathmatch.json`, `board-voiddrillers.json`, `board-cipherrun.json`).
   - Exactly one process writes to each file.
   - `load()` in `board-store.js` safely catches all syntax errors and returns an empty board if the file is damaged.

6. **Cleartext Protocol Posture**:
   - WebSockets run plain `ws://` on port 80 without TLS, with `perMessageDeflate: false`.
   - This design explicitly ensures game packets are readable as cleartext JSON in Wireshark for network lab inspection.

7. **Test Purity**:
   - All tests reference constants (`SIZE`, `MAX_PLAYERS`, `COLLAPSE_COUNT`) rather than hardcoded literals.
   - Randomness in tests is strictly injected via deterministic RNG (`() => 0` or seeded counters), never `Math.random()`.

---

## Game-Specific Mechanics & Balance Solutions

### Blockout Royale (2D)
- **Endgame Pacing**: `waveSize(solid)` tapers the falling tiles down to 1 via `COLLAPSE_SHARE = 0.06`, while `collapseDelay(solid)` accelerates waves from 900 ms down to 260 ms so late games stay tense instead of dragging.
- **Powerups**: Weighted towards `patch` (rebuilds a 3x3) to make pickups valuable on a collapsing board. `blink` clears holes to avoid players being trapped on isolated islands.

### Fracture Line (2.5D FPS)
- **Destructible Cover**: Bullets damage walls (`WALL_HP = 3`). Overcharge rounds penetrate cover infinitely (`PIERCE_LAYERS = Infinity`).
- **Cover Regeneration**: Damaged walls slowly heal over time to prevent the arena from degenerating into a flat, coverless room.
- **Dash Mechanic**: Steps through movement in small increments (`DASH_STEP = 0.08`) rather than teleporting, preventing wall clipping.

### Blastworks (Bomberman)
- **Stalemate Solution**:
  - In *Last Man Standing*, an inward-closing spiral wall triggers after `SUDDEN_DEATH_MS = 120000`, crushing whatever it lands on to force decisive rounds.
  - In *Deathmatch*, soft walls regrow every `REGROW_EVERY_MS = 2600` and the game terminates at `KILL_TARGET = 12`. Never combine sudden death squeeze with wall regrowth.

### Blockout Royale 3D
- **Vertical Stack**: 5 floors (`FLOORS = 5`, `SIZE = 13`). Falling drops players to the floor below rather than causing instant death.
- **Rising Void**: Eats floors from below starting at 60 s (`VOID_FIRST_MS`) and every 35 s thereafter (`VOID_EVERY_MS`).
- **Wire Optimization**: 845 tiles across 5 floors are encoded into a compact single-character string (`CHAR = { solid: '.', warn: '!', gone: '_' }`), reducing bandwidth from 300 KB/s to 25 KB/s.
- **Kill Attribution (Ruling R2)**: `p.fallBy` is reset on self-inflicted falls (walking into an existing hole), preventing old shoves from erroneously crediting kills minutes later.

### Void Drillers (2D Side Descent)
- **Excavation Shaft**: 20 columns wide by 260 blocks deep (`WIDTH = 20`, `DEPTH = 260`). Destructible strata include dirt (1 hit), stone (3 hits), gas pockets (damaging aerosol hazard), and geode crystals (heat flush + 3s super drill).
- **Continuous Physics**: Downward gravity (14.0 blocks/s²), terminal fall velocity (12.0 blocks/s²), jetpack thrusters (-18.0 blocks/s²) consuming fuel with ground recharge.
- **Thermal Dynamics**: Drilling adds heat (+0.25/s), cooling dissipates heat (-0.30/s), and reaching 100% triggers a 1.8s overheat breaker lockout.
- **Crush Void**: Descends from -4.0 after a 4000 ms grace period, accelerating with depth to crush slow drillers. First player touching the Extraction Vault at y=250 wins.
- **Delta Wire Protocol**: Full map transmitted once on join via run-length encoded string; 60 Hz snapshots transmit only dynamic entities and incremental block deltas.

### Cipher Run (Typing Decryption Race)
- **Monkeytype Standard**: 5 characters per normalized word (`(correctChars / 5) / (elapsedMinutes)`).
- **Glitch Breaker Lockout**: 3 consecutive typos trigger 350ms static freeze (`LOCKOUT_MS = 350`).
- **Error Recovery**: Backspace recovery clears typo state; Spacebar advances past word errors with uncorrected penalty.
- **151 Curated Protocols**: 50 Short (15 to 25 words), 50 Medium (40 to 60 words), 50 Long (85 to 125 words), plus Protocol 151 Easter Egg (Subliminal Devotion Directive repeating "I LOVE RIVALBLOCKS." 20 times).
- **Authoritative Pre-Round Voting**: 5-second pre-round voting phase (`VOTE_DURATION_MS = 5000`) before race countdown, with real-time consensus percentages, home-row hotkeys (`1`, `2`, `3`), random tie resolution, and a 2% Easter Egg roll.
- **Chibi Cyber Sprinters**: Procedural anime runner with 6 sprinter variations, dynamic stride cadence scaling with WPM, word-dash impulse, stumble states, and celebratory cheer states.

---


## Design, Styling & Copy Rules

- **Zero Image Files**: All artwork is procedural CSS, inline SVG (`BlockArt.jsx`), or dynamically generated offscreen canvas textures (`wallTiles.js`, `fireTiles.js`).
- **WCAG 1.4.1 Accessibility**: Status is never communicated by color alone. Standing tiles, warning tiles, holes, and pickups always carry structural rings, borders, and unique unicode glyphs (`»`, `◈`, `✶`, `⊔`, `≡`, `Ψ`, `✚`, `†`, `◎`, `⊗`).
- **Tailwind v4 CSS-First**: Only use `@theme` tokens from `src/index.css`. Do not add `tailwind.config.js`.
- **In-Fiction Tone**: The studio and games are treated as 100% real. Never use words like "demo", "mock", or "placeholder".
- **Copy Style**: Terse phrasing, short sentences, and **strictly no em dashes** in site marketing copy (`src/data/games.js`, `src/data/servers.js`, and pages).

