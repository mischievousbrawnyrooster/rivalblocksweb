# Void Drillers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Void Drillers, an authoritative 2D side-view vertical excavation descent race game where drillers race down a 260-block destructible geological shaft to reach the subterranean Extraction Vault before being crushed by the descending Void.

**Architecture:**
Follows strict three-layer repository architecture:
1. `server/voiddrillers.js`: Pure simulation rules engine. Manages 20×260 strata grid, continuous driller physics, AABB collisions, raycast drilling, drill thermal dynamics, gas pockets, geode boosts, void acceleration, and win conditions. Zero external imports, zero Node APIs, zero timers, zero I/O.
2. `server/voiddrillers-server.js`: Network adapter. WebSocket server on port 8086 (`/voiddrillers-ws`), validating input packets, ticking rules engine at 30 Hz, and broadcasting delta-compressed snapshots.
3. `src/pages/VoidDrillers.jsx`: Client presentation layer. 2D HTML5 Canvas rendering, camera descent tracking, procedural particles, WCAG 1.4.1 structural block glyphs, mech driller character, HUD telemetry, and ad flank layout.

**Tech Stack:** JavaScript (ES Modules), Node.js (`node --test`), WebSocket (`ws`), HTML5 Canvas, React, Vite, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-09-11-void-drillers-design.md`

## Global Constraints

- Node path: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"` (Windows PowerShell).
- Rules engine `server/voiddrillers.js` must be 100% pure: zero external imports, zero Node APIs, zero sockets, zero timers.
- Strict server authority: client transmits intent (`{ t: 'input', dx, thrust, drill, aim }`), server validates movement and collisions.
- Wire optimization: Full shaft sent once on join via run-length encoded string; 30 Hz snapshots transmit only dynamic entity state and delta block events.
- Accessibility (WCAG 1.4.1): Block types and statuses must never be communicated by color alone. Structural textures and unique unicode glyphs (`·`, `≡`, `#`, `⊗`, `◈`, `▲`) are mandatory.
- Procedural rendering: Zero external image textures used in the canvas. All mining visuals, particles, and character sprites are rendered procedurally.
- Strictly no em dashes in copy (use colons, periods, or standard hyphens).
- WebSockets run cleartext on port 8086 with `maxPayload: 4096`.
- Line endings must be CRLF (`\r\n`).

---

### Task 1: Pure Rules Engine & Deterministic Test Suite

**Files:**
- Create: `server/voiddrillers.js`
- Create: `server/voiddrillers.test.js`

**Interfaces:**
- Consumes: None (pure rules module)
- Produces:
  - Constants: `WIDTH = 20`, `DEPTH = 260`, `BLOCK_AIR = 0`, `BLOCK_DIRT = 1`, `BLOCK_STONE = 2`, `BLOCK_BEDROCK = 3`, `BLOCK_GAS = 4`, `BLOCK_GEODE = 5`, `BLOCK_VAULT = 6`, `TICK_MS = 33`, `GRACE_MS = 4000`, `VAULT_Y = 250`.
  - Functions: `make(options)`, `join(match, playerInfo)`, `leave(match, playerId)`, `setInput(match, playerId, input)`, `tick(match, dtMs)`, `snapshot(match)`, `encodeMap(grid)`.

- [ ] **Step 1: Write failing tests for shaft generation, boundaries, and run-length encoding**

Create `server/voiddrillers.test.js`:
```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  make,
  join,
  leave,
  setInput,
  tick,
  snapshot,
  encodeMap,
  WIDTH,
  DEPTH,
  BLOCK_AIR,
  BLOCK_DIRT,
  BLOCK_STONE,
  BLOCK_BEDROCK,
  BLOCK_GAS,
  BLOCK_GEODE,
  BLOCK_VAULT,
  TICK_MS,
  GRACE_MS,
  VAULT_Y
} from './voiddrillers.js'

test('shaft generation initializes correct dimensions and boundary bedrock', () => {
  const m = make({ seed: 42 })
  assert.equal(m.width, WIDTH)
  assert.equal(m.depth, DEPTH)
  assert.equal(m.grid.length, WIDTH * DEPTH)

  // Boundary columns (x = 0 and x = WIDTH - 1) must be bedrock
  for (let y = 0; y < DEPTH; y++) {
    assert.equal(m.grid[y * WIDTH + 0], BLOCK_BEDROCK, `left boundary bedrock at y=${y}`)
    assert.equal(m.grid[y * WIDTH + (WIDTH - 1)], BLOCK_BEDROCK, `right boundary bedrock at y=${y}`)
  }

  // Bottom barrier must be bedrock
  for (let x = 0; x < WIDTH; x++) {
    assert.equal(m.grid[(DEPTH - 1) * WIDTH + x], BLOCK_BEDROCK, `bottom bedrock at x=${x}`)
  }

  // Vault zone at y >= VAULT_Y contains vault platform
  for (let x = 1; x < WIDTH - 1; x++) {
    assert.equal(m.grid[VAULT_Y * WIDTH + x], BLOCK_VAULT, `vault tile at x=${x}`)
  }
})

test('run-length encoding serializes and compresses the shaft map', () => {
  const m = make({ seed: 101 })
  const encoded = encodeMap(m.grid)
  assert.equal(typeof encoded, 'string')
  assert.equal(encoded.length > 0, true)
  assert.equal(encoded.length < m.grid.length, true, 'compressed string is smaller than raw array')
})
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
node --test server/voiddrillers.test.js
```
Expected: FAIL with module `./voiddrillers.js` not found.

- [ ] **Step 3: Implement core constants, shaft generation, and map encoding in `server/voiddrillers.js`**

Implement `server/voiddrillers.js` with:
- Grid layout: 20 cols × 260 rows.
- Bedrock border walls, launch gantry at `y = 1`, extraction vault platform at `y = VAULT_Y`.
- Strata population using deterministic seeded pseudo-random number generator:
  - Top 0-10: Soft dirt and air pockets.
  - Middle 11-249: Dirt veins, stone deposits (durability 3), gas pockets, geode crystal caches.
- `encodeMap(grid)` using run-length encoding (e.g. `20B5D...`).

- [ ] **Step 4: Add failing tests for player physics, gravity, and AABB collision**

In `server/voiddrillers.test.js`, add:
```js
test('player joins at launch gantry and respects gravity and solid collisions', () => {
  const m = make({ seed: 123 })
  const p = join(m, { id: 'p1', name: 'DrillerOne' })
  assert.ok(p)
  assert.equal(p.alive, true)
  assert.equal(p.y, 1.0)

  // Advance simulation by 5 ticks with no inputs
  const initialY = p.y
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)

  // Player stands solid on gantry block
  assert.equal(p.y, initialY, 'player stands on solid gantry')

  // Remove block under player and verify falling
  const belowIdx = Math.floor(p.y + 1) * WIDTH + Math.floor(p.x)
  m.grid[belowIdx] = BLOCK_AIR
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)
  assert.equal(p.y > initialY, true, 'player accelerates downward under gravity')
})
```

- [ ] **Step 5: Implement player movement, gravity, jetpack, and AABB collision in `server/voiddrillers.js`**

Implement in `server/voiddrillers.js`:
- `join(match, { id, name })` and `leave(match, id)`.
- `setInput(match, id, { dx, thrust, drill, aim })`.
- Physics update in `tick(match, dtMs)`:
  - Bounding box collision against solid tiles (`type !== BLOCK_AIR`).
  - Horizontal movement (`dx * 4.5` blocks/sec).
  - Gravity acceleration (`14.0` blocks/sec²) capped at terminal fall speed (`12.0` blocks/sec).
  - Jetpack thrust (`-18.0` blocks/sec²) consuming fuel.
  - Ground check: replenishes fuel when resting on a solid block.

- [ ] **Step 6: Add failing tests for drilling, thermal dynamics, geode boost, and gas pockets**

In `server/voiddrillers.test.js`, add:
```js
test('drilling damages blocks, builds heat, and triggers overheat lockout', () => {
  const m = make({ seed: 777 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0

  // Place a stone block directly below player (durability 3)
  const targetIdx = 11 * WIDTH + 5
  m.grid[targetIdx] = BLOCK_STONE
  m.hp[targetIdx] = 3

  // Aim downwards (PI / 2) and drill
  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })

  // Tick for 250ms (two drill pulses)
  for (let i = 0; i < 8; i++) tick(m, TICK_MS)

  assert.equal(m.hp[targetIdx] < 3, true, 'stone block sustained damage')
  assert.equal(p.heat > 0, true, 'drill heat accumulated')

  // Continue drilling until overheated
  while (!p.overheated) {
    tick(m, TICK_MS)
  }
  assert.equal(p.overheated, true, 'overheat breaker tripped at 100% heat')

  // While overheated, drill does not damage
  const hpBefore = m.hp[targetIdx]
  tick(m, TICK_MS)
  assert.equal(m.hp[targetIdx], hpBefore, 'overheated drill produces zero damage')
})

test('destroying gas pocket generates expanding hazard', () => {
  const m = make({ seed: 888 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0
  const gasIdx = 11 * WIDTH + 5
  m.grid[gasIdx] = BLOCK_GAS
  m.hp[gasIdx] = 1

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })
  // Drill the gas block
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)

  assert.equal(m.grid[gasIdx], BLOCK_AIR, 'gas block popped into air')
  assert.equal(m.hazards.length > 0, true, 'expanding gas hazard created')
})

test('collecting geode clears heat and activates super drill', () => {
  const m = make({ seed: 999 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0
  p.heat = 0.8
  const geodeIdx = 11 * WIDTH + 5
  m.grid[geodeIdx] = BLOCK_GEODE
  m.hp[geodeIdx] = 1

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)

  assert.equal(m.grid[geodeIdx], BLOCK_AIR)
  assert.equal(p.heat, 0, 'drill heat flushed')
  assert.equal(p.superDrillTimer > 0, true, 'super drill active')
})
```

- [ ] **Step 7: Implement drilling raycast, thermal dissipation, hazards, and boosts in `server/voiddrillers.js`**

Implement:
- Block targeting: find closest block cell within reach radius (`1.35`) in aim direction.
- Block damage: decrement `hp[idx]`. When `hp <= 0`, replace with `BLOCK_AIR` and log delta `{ i: idx, t: BLOCK_AIR }`.
- Bedrock immunity: cannot be damaged.
- Heat accumulation (`+0.25/sec`) and dissipation (`-0.30/sec` when idle). Overheat lockout at `heat >= 1.0` for 1.8 seconds.
- Gas explosion: pushes a hazard circle `{ x, y, r: 2.0, ttl: 4000 }` to `m.hazards`.
- Geode reward: `p.heat = 0`, `p.superDrillTimer = 3000` (instantly breaks stone in 1 pulse).

- [ ] **Step 8: Add failing tests for Crush Void descent and match victory**

In `server/voiddrillers.test.js`, add:
```js
test('crush void advances after grace period and crushes drillers', () => {
  const m = make({ seed: 555 })
  const p = join(m, { id: 'p1', name: 'SlowDriller' })
  p.x = 5.0
  p.y = 1.0

  assert.equal(m.voidY, -4.0)

  // Advance past grace period (4000 ms)
  for (let t = 0; t < 5000; t += TICK_MS) tick(m, TICK_MS)

  assert.equal(m.voidY > 0, true, 'void is descending')

  // Advance until void passes player position
  while (m.voidY < p.y) {
    tick(m, TICK_MS)
  }
  tick(m, TICK_MS)

  assert.equal(p.alive, false, 'player eliminated by crush void')
  assert.equal(m.phase, 'over', 'match over when all drillers crushed')
})

test('first driller to touch extraction vault wins', () => {
  const m = make({ seed: 333 })
  const p1 = join(m, { id: 'p1', name: 'Speedy' })
  const p2 = join(m, { id: 'p2', name: 'Second' })

  // Teleport p1 onto the extraction vault
  p1.y = VAULT_Y + 0.5
  tick(m, TICK_MS)

  assert.equal(m.phase, 'over')
  assert.equal(m.winner, 'p1', 'p1 reached vault and won match')
})
```

- [ ] **Step 9: Implement Void descent and win conditions in `server/voiddrillers.js`**

Implement:
- Void timer: remains at `-4.0` while `m.elapsed < GRACE_MS`.
- Void motion: speed accelerates down the shaft: `0.5 + (m.elapsed - GRACE_MS) * 0.00001` blocks/ms.
- Elimination: any alive player with `p.y <= m.voidY` is set to `p.alive = false`.
- Win check:
  - If any player reaches `p.y >= VAULT_Y`, `m.winner = p.id`, `m.phase = 'over'`.
  - If only 1 player remains alive among multiple, or all are dead, resolve winner / wipeout.
- Export `snapshot(match)` returning minimal payload with deltas and hazards.

- [ ] **Step 10: Run full test suite to verify 100% pass**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
node --test server/voiddrillers.test.js
```
Expected: PASS all tests.

- [ ] **Step 11: Commit**

```powershell
git add server/voiddrillers.js server/voiddrillers.test.js
git commit -m "feat(voiddrillers): pure rules engine, strata generation, and test suite"
```

---

### Task 2: Network Adapter & Server Lifecycle

**Files:**
- Create: `server/voiddrillers-server.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `make`, `join`, `leave`, `setInput`, `tick`, `snapshot`, `encodeMap`, `TICK_MS` from `server/voiddrillers.js`.
- Produces: WebSocket server listening on `127.0.0.1:8086`, npm script `"drillers": "node server/voiddrillers-server.js"`.

- [ ] **Step 1: Implement `server/voiddrillers-server.js`**

Implement WebSocket network adapter following the strict repository pattern from `server/blastworks-server.js` and `server/fracture-server.js`:
- WebSocket server on port `8086`.
- `maxPayload: 4096`, `perMessageDeflate: false`.
- Connection lifecycle:
  - On connection: create client socket wrapper, listen for message frames.
  - Handle `{ t: 'join', name }`: sanitize player name (slice to 256 chars, regex filter), assign player to match, send `{ t: 'welcome', id, slot, width, depth, map: encodeMap(match.grid) }`.
  - Handle `{ t: 'input', dx, thrust, drill, aim }`: validate values, forward to `setInput(match, id, ...)`.
  - On disconnect: call `leave(match, id)`.
- Game loop:
  - Fixed 30 Hz interval (`TICK_MS = 33`).
  - Execute `tick(match, TICK_MS)`.
  - Produce `snap = snapshot(match)`.
  - Broadcast `JSON.stringify(snap)` to all active sockets synchronously in the tick.
  - Automatically handle match restart after victory podium delay (5 seconds).

- [ ] **Step 2: Add `"drillers"` script to `package.json`**

In `package.json`, add under `"scripts"`:
```json
"drillers": "node server/voiddrillers-server.js",
```

- [ ] **Step 3: Verify server starts and responds to connections**

Run a brief smoke script using `node -e` or quick test to ensure the server starts cleanly on port 8086 and shuts down without errors:
```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
node -e "import('./server/voiddrillers-server.js'); setTimeout(() => process.exit(0), 1000)"
```

- [ ] **Step 4: Commit**

```powershell
git add server/voiddrillers-server.js package.json
git commit -m "feat(voiddrillers): WebSocket network adapter and npm drillers script"
```

---

### Task 3: Key Art Generation & Site Catalog Integration

**Files:**
- Create: `public/art/void-drillers.jpg` (via `generate_image`)
- Modify: `src/data/games.js`
- Modify: `src/data/servers.js`
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: Key art prompt, server port `8086`.
- Produces: Catalog metadata, server listing, Vite proxy route `/voiddrillers-ws`.

- [ ] **Step 1: Generate key artwork for Void Drillers**

Call `generate_image` tool:
- Prompt: "High-octane action key art for Void Drillers video game. Futuristic mechanized mining cyber-drillers wearing pressurized industrial exosuits with heavy rotating drill arms and blazing blue jetpack thrusters, digging frantically downward through crumbling subterranean strata, rock fragments and golden sparks spraying, while an ominous dark matter void vortex collapses from the ceiling above. Industrial sci-fi cyberpunk aesthetic, vivid lighting, sharp cinematic detail, 16:9 aspect ratio."
- ImageName: `void_drillers_art`
- Copy resulting artifact to `public/art/void-drillers.jpg`.

- [ ] **Step 2: Add Void Drillers to `src/data/games.js`**

Add entry to `games` array in `src/data/games.js`:
- `slug: 'void-drillers'`
- `title: 'Void Drillers'`
- `tagline: 'Dig fast or get swallowed.'`
- `cover: '/art/void-drillers.jpg'`
- `artHero: '/art/void-drillers.jpg'`
- `artAction: '/art/void-drillers.jpg'`
- `status: 'online'`
- `port: 8086`
- `route: '/play/void-drillers'`
- `players: '1-8'`
- `genre: 'Excavation Race'`
- `perspective: '2D Side Descent'`
- Controls, mechanics, lore description (terse phrasing, strictly no em dashes).

- [ ] **Step 3: Add Void Drillers to `src/data/servers.js`**

Add server card to `src/data/servers.js`:
- Port 8086, slug `'void-drillers'`, title `'Void Drillers'`.

- [ ] **Step 4: Add dev proxy in `vite.config.js`**

Add proxy entry in `vite.config.js`:
```js
'/voiddrillers-ws': {
  target: 'http://127.0.0.1:8086',
  ws: true,
  rewriteWsOrigin: true
}
```

- [ ] **Step 5: Run tests and build to verify catalog validity**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd test
npm.cmd run build
```
Expected: All tests pass and build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add public/art/void-drillers.jpg src/data/games.js src/data/servers.js vite.config.js
git commit -m "feat(voiddrillers): key art and site catalog integration"
```

---

### Task 4: Client 2D Canvas & Gameplay Page

**Files:**
- Create: `src/pages/VoidDrillers.jsx`
- Modify: `src/App.jsx`
- Modify: `src/pages/PlayIndex.jsx`

**Interfaces:**
- Consumes: WebSocket `/voiddrillers-ws`, catalog entries, `FlankingAds`.
- Produces: Route `/play/void-drillers`, interactive canvas game.

- [ ] **Step 1: Implement `src/pages/VoidDrillers.jsx`**

Implement complete client canvas page with:
- Connection handling to `/voiddrillers-ws` (with fallback to direct port `8086` if standalone).
- Keyboard & mouse uplink:
  - Keys `A` / `D` or Left / Right: horizontal walk direction.
  - Keys `W` / `Space` / Up: jetpack thruster.
  - Mouse position on canvas: calculates aim angle in radians relative to player center.
  - Mouse Left Button or `F`: holds drill trigger.
- Map buffer: initializes Uint8Array on `welcome` frame from RLE string; applies `snap.deltas` directly to buffer.
- Canvas render loop (60 FPS `requestAnimationFrame`):
  - Virtual coordinates: `BLOCK_SIZE = 28` pixels.
  - Camera tracking: `cameraY` smooth damp interpolation tracking local player vertical position.
  - Viewport culling: only draws visible rows in shaft window.
  - Procedural block rendering (WCAG 1.4.1):
    - Dirt: brown stippled dots.
    - Stone: slate with horizontal strata lines (`≡`).
    - Bedrock: dark crosshatch pattern (`#`).
    - Gas: amber glow with hazard symbol (`⊗`).
    - Geode: cyan faceted gem (`◈`).
    - Vault: yellow/black industrial warning chevrons (`▲`).
  - Crush Void ceiling: dark pulsing grinder effect along `voidY` with downward warning chevrons.
  - Character rendering: procedural mechanized suit with directional drill arm and jetpack flame particles.
  - Particle system: drill sparks, crumbling rock dust, exhaust trails.
  - HUD overlay:
    - Depth counter (meters).
    - Proximity alert when void is near.
    - Heat gauge (with `OVERHEATED` alert).
    - Jetpack fuel meter.
    - Mini shaft telemetry strip on the right border.
  - Match victory / eliminated overlay banner.
  - Surrounding UI: flanked by `FlankingAds` and responsive banner ad.

- [ ] **Step 2: Wire route in `src/App.jsx`**

Import `VoidDrillers` from `./pages/VoidDrillers.jsx` and add route:
```jsx
<Route path="/play/void-drillers" element={<VoidDrillers />} />
```

- [ ] **Step 3: Add card to `src/pages/PlayIndex.jsx`**

Ensure Void Drillers appears on the games index page `/play` with quick-launch button.

- [ ] **Step 4: Build and test frontend**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd run build
npm.cmd test
```
Expected: Build passes with 0 errors.

- [ ] **Step 5: Commit**

```powershell
git add src/pages/VoidDrillers.jsx src/App.jsx src/pages/PlayIndex.jsx
git commit -m "feat(voiddrillers): client canvas gameplay page, HUD, and route"
```

---

### Task 5: Invariants Documentation & End-to-End Verification

**Files:**
- Modify: `GEMINI.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: All completed components.
- Produces: Updated repository documentation and passing end-to-end verification.

- [ ] **Step 1: Update `GEMINI.md` and `CLAUDE.md`**

Add Void Drillers documentation:
- Rules engine invariants (`server/voiddrillers.js`): Pure functions, zero imports, 20×260 strata grid.
- Network invariants (`server/voiddrillers-server.js`): Port 8086 (`/voiddrillers-ws`), 30 Hz delta snapshots.
- Wire optimization: Full map RLE string on join, delta updates during match.
- WCAG 1.4.1 compliance: Structural textures and unicode glyphs on all block strata.
- Strictly no em dashes.

- [ ] **Step 2: Run full automated test suite**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd test
```
Expected: All tests in `src/lib` and `server/*.test.js` pass cleanly.

- [ ] **Step 3: Run production build**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd run build
```
Expected: Clean build to `dist/`.

- [ ] **Step 4: Commit documentation and final adjustments**

```powershell
git add GEMINI.md CLAUDE.md
git commit -m "docs: document Void Drillers architecture, port 8086, and game invariants"
```

