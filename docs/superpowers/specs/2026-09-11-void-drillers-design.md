# Void Drillers - Design Specification

*2026-09-11*

## 1. Executive Summary & Concept

Void Drillers is a high-stakes 2D side-view multiplayer excavation descent race. Players pilot pressurized mechanized drilling suits down a perilous vertical mine shaft. The shaft ceiling is consumed relentlessly from above by the **Crush Void**, a grinding wall of supermassive dark matter that destroys everything in its wake.

Drillers race downward through destructible geological strata, carving paths, managing drill core heat, conserving thruster fuel, puncturing volatile gas pockets to disrupt rivals, and unearthing geode caches for temporary super-drilling bursts. The first player to reach the subterranean Extraction Vault or survive as the last driller standing wins the match.

- **Title:** Void Drillers
- **Slug:** `void-drillers`
- **Route:** `/play/void-drillers`
- **Tagline:** *Dig fast or get swallowed.*
- **WebSocket Port:** `8086` (`/voiddrillers-ws`)
- **Key Art:** `/art/void-drillers.jpg`

---

## 2. Architecture & Three-Layer Split

Void Drillers strictly preserves the repository's three-layer architecture:

| Component / Layer | Files | Responsibilities | Constraints |
|---|---|---|---|
| **Rules Engine** | `server/voiddrillers.js` | Authoritative simulation, terrain grid, player physics, drilling raycasts, void descent, win/loss triggers | **Zero external imports, zero Node APIs, zero sockets, zero timers, zero I/O**. Completely pure functions. |
| **Network Adapter** | `server/voiddrillers-server.js` | WebSocket lifecycle, frame parsing, delta compression, 30 Hz snapshot broadcast | **Zero game decisions or simulation logic**. Relays inputs and serializes snapshots. |
| **Client UI** | `src/pages/VoidDrillers.jsx` | 2D Canvas rendering, camera tracking, particle systems, input uplink | **No client-side simulation, prediction, or rollback**. Pure rendering of authoritative server snapshots. |

---

## 3. Pure Rules Engine Mechanics (`server/voiddrillers.js`)

### 3.1 Shaft Grid & Strata
- **Dimensions:** 20 columns wide (`WIDTH = 20`) by 260 blocks deep (`DEPTH = 260`).
- **Coordinate System:**
  - `x`: `0.0` to `20.0` (horizontal column index).
  - `y`: `0.0` to `260.0` (vertical depth, increasing downward).
- **Block Types & Durability:**
  1. `AIR` (`0`): Empty tunnel. Zero resistance.
  2. `DIRT` (`1`): Soft silt. Durability `1` hit. Destroyed instantly on drill contact.
  3. `STONE` (`2`): Compressed rock. Durability `3` hits. Slows drillers down.
  4. `BEDROCK` (`3`): Indestructible boundary walls (left column `0`, right column `19`, and bottom barrier at `259`) plus strategic obstacle veins. Cannot be drilled.
  5. `GAS` (`4`): Volatile pocket. Durability `1` hit. When destroyed, triggers an expanding gas hazard zone that damages and knocks back nearby drillers.
  6. `GEODE` (`5`): Crystalline mineral cache. Durability `2` hits. When collected/shattered, instantly vents all drill heat and grants 3 seconds of `SUPER_DRILL` (1-tick stone excavation).
  7. `VAULT` (`6`): The Extraction Beacon platform at depth `y >= 250`.

### 3.2 Player Physics & Controls
- **Hitbox:** Bounding box of width `0.8` blocks and height `0.9` blocks.
- **Horizontal Movement:**
  - Walk speed: `4.5` blocks/second.
  - Horizontal inertia with instant ground grip.
- **Vertical Movement & Gravity:**
  - Gravity: `14.0` blocks/second² downward acceleration. Max fall speed: `12.0` blocks/second.
  - Jetpack Thruster: Consumes `fuel` gauge at `35%` per second. Upward thrust acceleration of `-18.0` blocks/second².
  - Fuel Recharge: Recharges at `50%` per second when feet are planted on a solid block. Cannot thrust when fuel reaches `0`.
- **Drill Action & Thermal Dynamics:**
  - Drill Range: Blocks within `1.35` distance from driller center in the direction of the aim vector.
  - Drill Rate: `8` drill pulses per second when active.
  - Drill Heat: Accumulates `25%` heat per second of active drilling.
  - Cooling: Dissipates `30%` heat per second when drill is idle.
  - Overheating: Reaching `100%` heat trips the thermal breaker, locking the drill for `1.8` seconds until cooled to `0%`.

### 3.3 The Crush Void
- Starts at `voidY = -4.0` during the opening grace period (`GRACE_MS = 4000`).
- Advances downward continuously at `BASE_VOID_SPEED = 0.5` blocks/second.
- Accelerates as depth increases: `voidSpeed = BASE_VOID_SPEED + (elapsedSec * 0.008)`, capping at `1.8` blocks/second.
- Any player whose center `y <= voidY` is crushed by dark matter and eliminated immediately.

### 3.4 Match Flow & Win Condition
1. **Lobby / Countdown:** Players join on an indestructible launch gantry at `y = 1`. Countdown runs for 3 seconds.
2. **Descent Phase:** Launch gantry disintegrates, freeing drillers into the strata.
3. **Victory:**
   - **Descent Win:** First surviving player to touch down on the Extraction Vault (`y >= 250`) claims 1st place.
   - **Survival Win:** If all other players are crushed by the void, the last surviving player wins.
4. **Post-Match:** Displays podium summary for 5 seconds, then resets the shaft.

---

## 4. Network Protocol & Wire Optimization

### 4.1 Upstream Input Frame (Client to Server)
Sent on change or at 30 Hz:
```json
{
  "t": "input",
  "dx": -1,        // -1 (left), 0 (none), 1 (right)
  "thrust": true,  // boolean: firing jetpack
  "drill": true,   // boolean: holding drill trigger
  "aim": 1.5708    // float: aim angle in radians (downwards = Math.PI / 2)
}
```

### 4.2 Downstream Initialization (`welcome`)
Sent once upon socket connection:
```json
{
  "t": "welcome",
  "id": "p-91823",
  "slot": 1,
  "width": 20,
  "depth": 260,
  "map": "20A40D10S..." // Run-length encoded initial block strata
}
```

### 4.3 Downstream Tick Snapshot (`snap` at 30 Hz)
Snapshots omit unchanged static blocks to conserve bandwidth. Only dynamic deltas are transmitted:
```json
{
  "t": "snap",
  "seq": 1420,
  "voidY": 42.6,
  "players": [
    {
      "id": "p-91823",
      "name": "DrillMaster",
      "slot": 1,
      "x": 8.4,
      "y": 62.1,
      "vx": 0.0,
      "vy": 3.2,
      "fuel": 0.85,
      "heat": 0.42,
      "aim": 1.57,
      "drilling": true,
      "alive": true,
      "overheated": false,
      "superDrill": false
    }
  ],
  "deltas": [
    { "i": 1240, "t": 0 },        // block index 1240 destroyed to air
    { "i": 1241, "t": 2, "hp": 1 } // block index 1241 damaged to 1 HP
  ],
  "hazards": [
    { "x": 14.5, "y": 70.2, "r": 2.2, "ttl": 1.8 } // expanding gas pocket
  ],
  "winner": null
}
```
**Bandwidth Efficiency:** Delta snapshots consume under 3.5 KB/s per client, preventing frame drops over cleartext WebSockets.

---

## 5. Client Canvas & Presentation Layer (`src/pages/VoidDrillers.jsx`)

### 5.1 Viewport & Camera
- Fixed aspect ratio 2D HTML5 Canvas (`800x600` virtual resolution, scaled to container).
- Smooth vertical tracking camera (`cameraY`) centered on local player with lookahead in the direction of vertical velocity.
- Depth cues: Parallax rock stratum fissures and dark subterranean mining structures in the background.

### 5.2 Accessibility & Structural Glyphs (WCAG 1.4.1)
Blocks are never identified by color alone:
- **Dirt:** Warm earth tone with speckle stipple dots (`· ·`).
- **Stone:** Slate grey with horizontal stratification bands (`≡`).
- **Bedrock:** Dark charcoal with diagonal crosshatch reinforcement (`#`).
- **Gas Pocket:** Amber glow with hazardous skull / biohazard glyph (`⊗`).
- **Geode:** Cyan crystal core with sparkling diamond glyph (`◈`).
- **Extraction Vault:** High-visibility hazard chevrons and radar beacon pulse (`▲`).

### 5.3 Particle FX
- **Drill Spray:** Dynamic orange and yellow metal spark particles ejecting from drill tip against rock faces.
- **Rock Fractures:** Dust clouds and debris fragments bursting on block destruction.
- **Thruster Plume:** Blue/white jet exhaust trails descending during thrust.
- **Crush Void Border:** Grinding dark matter tendrils, lightning arcs, and falling debris along the `voidY` horizon.

### 5.4 Heads-Up Display (HUD)
- **Top Bar:** Depth meter (`DEPTH: 142m / 260m`), Void proximity alert (`VOID: 18m BEHIND`), Player alive counter (`DRILLERS: 4 / 6`).
- **Center-Bottom Gauges:**
  - **Drill Heat:** Segmented thermal bar with warning threshold and flashing `OVERHEATED` lockout indicator.
  - **Jet Fuel:** High-capacity pressurized thruster fuel meter.
- **Right Margin Minimap:** Full vertical shaft telemetry strip showing player icons, depth milestones, and descending void line.

---

## 6. Verification & Test Plan

### 6.1 Automated Unit Tests (`server/voiddrillers.test.js`)
1. **Shaft Initialization:** Verifies dimensions, bedrock boundaries, extraction vault placement, and deterministic generation with seeded RNG.
2. **Player Movement & Collisions:** Tests ground footing, AABB wall blocking, gravity acceleration, and terminal velocity.
3. **Jetpack Mechanics:** Tests fuel consumption while thrusting, recharge on solid ground, and thrust inhibition on empty fuel.
4. **Drilling & Raycasting:** Tests single-hit dirt destruction, multi-hit stone durability decrement, and bedrock invulnerability.
5. **Thermal Dissipation:** Tests heat accumulation, overheat lockout trigger at 100%, and cooling dissipation rate.
6. **Crush Void Progression:** Tests grace period delay, downward velocity acceleration, and instant elimination of caught players.
7. **Win Condition Triggers:** Tests extraction beacon touchdown victory and last-man-standing elimination resolution.

### 6.2 Manual Verification
- Launch dev server (`npm.cmd run dev`) and game server (`npm.cmd run drillers`).
- Navigate to `http://localhost:5173/play/void-drillers`.
- Verify smooth 30 Hz rendering, camera descent tracking, drilling responsiveness, and HUD telemetry.
- Verify flanking ad banners and in-page ad breaks display correctly around the canvas layout.

