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
npm.cmd run cutline  # Cutline                      127.0.0.1:8088  ← /cutline-ws
node server/cutline-select.mjs   # regenerate CIRCUITS by measured difference
npm.cmd run build    # static production build to dist/
npm.cmd run check:bundle   # after build: fails if three.js reaches the main chunk
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

The project contains a static marketing SPA and seven authoritative multiplayer games sharing one build.

### Strict Three-Layer Architecture

| Component / Layer | Files | Responsibilities | Constraints (Must NEVER contain) |
|---|---|---|---|
| **Rules Engine** | `server/game.js`, `server/fracture.js`, `server/blastworks.js`, `server/blockout3d.js`, `server/voiddrillers.js`, `server/cipherrun.js`, `server/cutline.js` | Authoritative match state, movement, collision, elimination, powerups, tick logic | **Zero external imports, zero Node APIs, zero sockets, zero timers, zero I/O**. Completely pure functions. |
| **Network Adapter** | `server/server.js`, `server/fracture-server.js`, `server/blastworks-server.js`, `server/blockout3d-server.js`, `server/voiddrillers-server.js`, `server/cipherrun-server.js`, `server/cutline-server.js` | WebSocket lifecycle, frame parsing, validation, snapshot broadcasts | **Zero game decisions or simulation logic**. Only relays client input and broadcasts snapshots. |
| **Shared Pure Logic** | `server/board.js` | Leaderboard merging, ranking, K/D math | **Runs in both Node.js and the browser**. No Node APIs, no clock (`Date.now` passed in). |
| **Storage Layer** | `server/board-store.js` | Reading/writing the leaderboard JSON files | **Single-writer per file**. No locking needed. Corrupted files fall back to empty boards. |
| **Client UI** | `src/pages/Play.jsx`, `src/pages/Fracture.jsx`, `src/pages/Blastworks.jsx`, `src/pages/Blockout3D.jsx`, `src/pages/VoidDrillers.jsx`, `src/pages/CipherRun.jsx`, `src/pages/Cutline.jsx` | Canvas / DOM rendering, keyboard/mouse input uplink | **No client-side simulation, prediction, or rollback**. Pure rendering of authoritative server snapshots. |
| **Cutline 3D** | `src/lib/cutlineScene.js` (three.js scene), `src/lib/raceCamera.js` (world mapping, view poses, smoothing), `src/lib/wallBlocks.js` (walls drawn in 3D), `src/lib/carLift.js` (a car's drawn height) | Drawing the race in 3D under three views | The scene holds no rules. The other three are **pure, import-free and tested**. |


---

## Key Invariants & Security Hardening

1. **Strict Server Authority**:
   - The client only transmits intent (`{t: 'join' | 'move' | 'input' | 'use'}`).
   - The server decides position, collision, validity, elimination, and victory.
   - Snapshots are broadcast at 10 Hz (grid games), 30 Hz (Fracture Line), or 60 Hz (Blockout 3D, Void Drillers, Cutline).
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
   - Eight board files (`board-blockout.json`, `board-blockout3d.json`, `board-fracture.json`, `board-blastworks-lastman.json`, `board-blastworks-deathmatch.json`, `board-voiddrillers.json`, `board-cipherrun.json`, `board-cutline.json`).
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

### Cutline (Elimination Circuit Racer)
- **Steering Rate Control**: Steering is transmitted as a held rate (`steer: -1 | 0 | 1`) at 60 Hz (`TURN_RATE = 2.4` rad/s, `TURN_FALLOFF = 0.35`). Network latency is felt as steering inertia rather than nose-position drift, keeping the controls tight under strict server authority without prediction.
- **Lattice Cycle**: A circuit is a closed cycle on a lattice, not a polar curve. The old centreline was `r(angle)` as a sum of harmonics, which is single valued in angle, so it always bent around the grid centre: every corner turned the same way and curvature was global, which is why every circuit read as the same deformed circle. A lattice cycle never revisits a vertex, which is what makes self-intersection impossible, and `cycleAccepted` refuses an oval rather than repairing one. `MIN_SIGN_CHANGES` is the rule that does that; loosening it brings the old defect back in a new shape.
- **Derived Constants**: `LATTICE_CELL` is derived from `SEGMENT_WIDTH_MAX + MIN_WALL`. Two parallel corridors that merge read as a shortcut nobody designed, and the checkpoint ring rejects the lap that results. Every geometric constant derives from `SEGMENT_WIDTH_MAX` or from `meta[i].width`, never from a number written twice. A hardcoded `CHECKPOINT_RADIUS` of 4.0 survived one widening of the road and silently put the outer racing line out of reach: a car 4 tiles off centre missed 10 of 11 checkpoints and its lap never counted, which reads as a lap counter that randomly stops.
- **Shortcuts**: Checkpoints sit only on the trunk, never on a shortcut branch and never inside the stretch a branch skips. Both routes then pass every checkpoint in order and the ring needs no knowledge that a branch exists.
- **Ramps**: Ramp height is render only. The rules track `airUntil` and nothing else; `airT` exists for the page to draw an arc with. Giving the rules a z axis would make this a different game. The grid says where a ramp is but not which way it faces, so `carve` also returns `ramps` (`{x, y, heading, width}`, at the strip's middle tile) and `welcome` ships them; the page draws a wedge rising the way the lap runs. A car is drawn at `carLift`, the higher of the ramp under it and its jump arc, so it rides up the slope into the arc with no step.
- **Camera Views**: Top-down, chase and bumper, cycled with `C` and remembered in `localStorage`. Game y maps to three.js +z via `toWorld`, never -z, which would mirror the world silently. The camera up vector is derived from the view by `upFor`, never fixed, or `lookAt` degenerates mid-switch. Bumper position is locked, never smoothed, so switching into it is a cut. Steering is never rotated by the camera: unlike Blockout 3D, Cutline steers a rate relative to the car.
- **No Live-Car Exemption**: Cutline interpolates your own car like every other (`sample(now)`, no `liveId`). Snapshots land unevenly (measured on Windows: 46 Hz, gaps of 16 or 30 ms), and the newest-snapshot exemption froze the car on 67 of 165 frames, which read as stuttering behind a chase camera.
- **WebGL Lifecycle**: Cutline is a lazy route (`npm run check:bundle` enforces it). `setTrack` disposes the previous circuit first and `dispose` calls `forceContextLoss`; without them GPU memory grows every restart and contexts pile up as a player clicks around the site.
- **Collision Shape**: The car's collision shape derives from the car that is drawn. `CAR_LENGTH` and `CAR_WIDTH` are the page's dimensions and the hitbox's, and `CAR_RADIUS` derives from `CAR_WIDTH`. They drifted once: the page drew a body 1.45 by 0.82 while walls were tested at a single point at the car's centre, so a nose could sit most of a tile inside a wall with nothing registering.
- **Corner Vocabulary**: `MAX_CORNER_RAD` is the tightest entry in `CORNERS`, not a ceiling every circuit hugs. Corner speeds are derived from the handling model: `v = TURN_RATE / (k + TURN_RATE * TURN_FALLOFF / TOP_SPEED)`. The vocabulary spans flat out to 33% of top speed on purpose, because a racer whose corners never need a brake has removed the main thing a driver does.
- **Static Track & Dynamic Hazards**: Carved track grids are run-length encoded and sent once on join via `welcome`. Active oil slicks and wall barriers reside in `state.hazards` (capped at `MAX_HAZARDS = 24`) rather than altering track tiles, keeping snapshots under 1 KB.
- **Instant Cut on Leader Lap**: The moment the race leader crosses the start/finish line, the driver currently running in last place is cut immediately, regardless of where they are on the circuit.
- **Flat Item Bag & Pure Slipstream**: Pickup crates yield boost, slick, or wall with equal probability regardless of race standing. Slipstream drafting behind leading cars is the sole catch-up mechanic.
- **Winning Lap Record**: Only race winners can bank lap records under `fastestTime`, preserving competitive leaderboards.

---


## Design, Styling & Copy Rules

- **Zero Image Files**: All artwork is procedural CSS, inline SVG (`BlockArt.jsx`), or dynamically generated offscreen canvas textures (`wallTiles.js`, `fireTiles.js`).
- **WCAG 1.4.1 Accessibility**: Status is never communicated by color alone. Standing tiles, warning tiles, holes, and pickups always carry structural rings, borders, and unique unicode glyphs (`»`, `◈`, `✶`, `⊔`, `≡`, `Ψ`, `✚`, `†`, `◎`, `⊗`).
- **Tailwind v4 CSS-First**: Only use `@theme` tokens from `src/index.css`. Do not add `tailwind.config.js`.
- **In-Fiction Tone**: The studio and games are treated as 100% real. Never use words like "demo", "mock", or "placeholder".
- **Copy Style**: Terse phrasing, short sentences, and **strictly no em dashes** in site marketing copy (`src/data/games.js`, `src/data/servers.js`, and pages).

