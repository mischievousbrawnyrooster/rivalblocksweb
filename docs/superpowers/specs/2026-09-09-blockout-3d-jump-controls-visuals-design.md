# Blockout Royale 3D: Jump, Pointer Lock, 3D Astronauts & 3D Powerups Design

**Date:** 2026-09-09  
**Status:** Approved design ready for implementation planning

---

## 1. Problem Statement & Motivation

Blockout Royale 3D has established authoritative server simulation, dual-clock interpolation, follow-camera maths, and per-floor fading. However, five gameplay and visual issues remain:

1. **Camera Controls**: Camera rotation currently relies on pointer click-and-drag. In a 3D arena, players expect fluid first-person/third-person mouse navigation where mouse movement naturally rotates the camera.
2. **Floor Stomp vs. Jump**: Pressing `Space` triggers a stomp that winds up and breaks the floor tile directly below the player. Breaking one's own standing tile is self-defeating; players need a **Jump** action that lets them leap across 1-tile gaps, avoid collapsing tiles, and traverse the arena dynamically.
3. **Powerup Visibility in 3D**: Powerups in `towerScene.js` are rendered as tiny, flat 0.28-unit orange diamonds without icons. They are practically invisible from the follow camera.
4. **Character Aesthetics**: Players are currently rendered as static rectangular prisms (`BoxGeometry(0.62, 0.9, 0.62)`) that do not rotate in their walking direction. Players need distinct, appealing 3D characters: stylized chibi mini-astronauts (resembling the beans from *Among Us*) that face their movement direction and animate while running and jumping.
5. **Match Pacing & Best of 3**: Flat Blockout and Blockout 3D originally used `ROUND_TARGET = 3`. In Blockout 3D, matches are intense multi-floor battles where each round should be decisive and count as a standalone match victory.

---

## 2. Architectural Structure

The design follows the strict three-layer architecture and codebase constraints:

| Layer | Files | Responsibilities | Constraints |
|---|---|---|---|
| **Authoritative Rules Engine** | `server/blockout3d.js` | Authoritative jump simulation, gap clearance, single-round target | Pure functions, zero imports, no sockets, no timers |
| **Network Adapter** | `server/blockout3d-server.js` | Relays `{ t: 'jump' }` frame to rules engine | Zero game simulation logic |
| **3D Rendering** | `src/lib/towerScene.js` | Chibi astronaut composite mesh, 3D spinning powerups, jump arc | Procedural Three.js primitives only, zero image files |
| **Client UI & Controls** | `src/pages/Blockout3D.jsx` | Pointer lock capture, mouse look uplink, Space key jump binding, HUD cleanup | No client simulation or prediction |

---

## 3. Detailed Component Specifications

### 3.1 Jump Mechanic & Authoritative Gap Clearance

#### Player State
In `server/blockout3d.js`:
- Remove `stompAt` and `stompReadyAt` from player state.
- Add `jumpUntil: 0` (timestamp when current airborne jump concludes).
- Add `jumpReadyAt: 0` (timestamp when jump cooldown concludes).

#### Constants
- `JUMP_DURATION_MS = 420`: Total airborne duration of a jump.
- `JUMP_COOLDOWN_MS = 750`: Time between consecutive jumps.
- `JUMP_SPEED_BOOST = 1.25`: Multiplier applied to base movement speed while jumping.

#### Physics & Rules
1. **Triggering**: Export function `jump(state, id)`.
   - Ignored if player is not `playing`, not `alive`, currently jumping (`state.now < p.jumpUntil`), or cooling down (`state.now < p.jumpReadyAt`).
   - Ignored if player is currently falling (`p.fallUntil > 0`).
   - Sets `p.jumpUntil = state.now + JUMP_DURATION_MS`.
   - Sets `p.jumpReadyAt = state.now + JUMP_COOLDOWN_MS`.
   - Returns `true` if initiated, `false` otherwise.
2. **Movement**:
   - In `stepPlayers(state, dt)`: When `state.now < p.jumpUntil`, player movement calculates with `speed * JUMP_SPEED_BOOST`.
3. **Authoritative Gap Clearance**:
   - In `resolveFalls(state)`: When checking if a player is standing over a hole or collapsing tile (`state.tiles[here] !== 'solid'`), skip triggering `startFall` if `state.now < p.jumpUntil`.
   - When `state.now >= p.jumpUntil`: If the player lands on a hole or gone tile, `startFall(state, p, 0)` triggers immediately on the next tick.
4. **Snapshot Representation**:
   - `snapshot(state)` replaces `stomping: p.stompAt > 0` with:
     - `jumping: state.now < p.jumpUntil`
     - `jumpProgress: p.jumpUntil ? Math.max(0, Math.min(1, 1 - (p.jumpUntil - state.now) / JUMP_DURATION_MS)) : 0`

---

### 3.2 Mouse Look via Pointer Lock API

In `src/pages/Blockout3D.jsx`:
1. **Capture**: Clicking on the `<canvas>` invokes `canvasRef.current.requestPointerLock()`.
2. **Pointer Lock State**: Track whether document.pointerLockElement is the active canvas.
3. **Movement**:
   - When pointer locked, `pointermove` (or `mousemove`) reads `e.movementX` and `e.movementY`.
   - Directly calls `orbit(camRef.current, e.movementX, e.movementY)`.
   - Removes old `dragging`, `pointerdown`, and `pointerup` state machines.
4. **Release**: Pressing `Escape` naturally exits pointer lock via browser default behavior.
5. **HUD Overlay**: Display a subtle prompt when unlocked: `"Click arena to look around. Esc to release."`

---

### 3.3 Chibi Mini-Astronaut 3D Character Design

In `src/lib/towerScene.js`:
Instead of a single `BoxGeometry`, each player body is a `THREE.Group` consisting of procedural primitives:

1. **Body / Torso**:
   - Capsule or rounded cylinder (`THREE.CapsuleGeometry(0.28, 0.42, 8, 16)` or rounded Box) representing the bean suit.
   - Material: `THREE.MeshLambertMaterial` using the player's slot color (`playerColor(slot)`).
2. **Visor**:
   - Oval glass visor (`THREE.CapsuleGeometry(0.12, 0.22, 6, 12)` rotated horizontally, or rounded Box) placed on the upper front of the body.
   - Material: `THREE.MeshLambertMaterial({ color: '#7ce8ff' })` with glossy cyan visor tint.
3. **Oxygen Tank / Backpack**:
   - Box attached to the back of the torso (`THREE.BoxGeometry(0.32, 0.42, 0.16)`).
   - Material: Same player slot color.
4. **Stubby Boots / Legs**:
   - Two small rounded pill legs (`THREE.CylinderGeometry(0.1, 0.1, 0.22)` or small capsules) under the base.
   - Legs perform a subtle alternating stride animation when the player is moving (`p.x` or `p.y` changing).
5. **Directional Rotation**:
   - The character group smoothly orients towards the player's movement direction `p.face` using `Math.atan2(p.face[0], p.face[1])`.
6. **Jump Elevation Arc**:
   - When `p.jumping` is true, the character's vertical position adds a parabolic arc offset:
     $$y_{\text{offset}} = 4 \cdot H_{\text{jump}} \cdot \text{progress} \cdot (1 - \text{progress})$$
     where $H_{\text{jump}} = 0.85$ world units.
7. **Billboard Icon**:
   - The slot silhouette emoji (`PIECE_ICON`) remains mounted as a floating billboard sprite above the helmet for WCAG 1.4.1 non-color identification.

---

### 3.4 Prominent 3D Collectible Powerups

In `src/lib/towerScene.js`:
Powerups are rendered using a composite 3D collectible object:

1. **Geometry**:
   - **Core Gem**: `THREE.IcosahedronGeometry(0.35, 0)` or `THREE.DodecahedronGeometry(0.32)`.
   - **Orbital Ring**: `THREE.TorusGeometry(0.48, 0.04, 8, 24)` tilted at 45 degrees.
2. **Animation**:
   - Each frame, the core rotates around its Y-axis (`rotation.y += 0.03`).
   - The orbital ring counter-rotates around its X and Z axes.
   - Position incorporates a smooth vertical hovering bob:
     $$y = \text{worldY}(z) + 0.65 + 0.12 \cdot \sin(\text{time} \cdot 3.5)$$
3. **Coloring**:
   - Base material utilizes the bright accent token (`--flare`, `#ff6b1a`).
4. **Visibility Across Floors**:
   - Render order and materials ensure powerups are clearly visible from above and do not clip inside floor slabs.

---

### 3.5 Single-Round Match Scoring

1. **`server/blockout3d.js`**:
   - Change `ROUND_TARGET = 1`.
   - When a round ends in `endRound`, the survivor increments `wins` and immediately sets `state.final = true`.
2. **`src/pages/Blockout3D.jsx`**:
   - Remove the `"X of 3"` display in the scoreboard header.
   - Update `statusLine` to report match victory directly on round completion.
3. **`server/blockout3d.test.js`**:
   - Update tests verifying single-round match conclusion and eliminate obsolete multi-round target checks.

---

### 3.6 60 FPS Transition (60 Hz Simulation & Uplink)

1. **`server/blockout3d.js`**:
   - Change `TICK_MS = 16` (advancing simulation at 60 Hz).
2. **`server/blockout3d-server.js`**:
   - Ticks and broadcasts snapshot packets at 60 Hz (`TICK_MS = 16`).
3. **`src/pages/Blockout3D.jsx`**:
   - `SEND_MS = 16`: Input send interval matches the 60 Hz server rate.
   - `DELAY_MS = 60`: Interpolation buffer window reduced from 100 ms to 60 ms (~3-4 server frames), halving interpolation delay while preserving smooth jitter-free interpolation.

---

## 4. Verification Plan

### Automated Tests
- Server rules test suite:
  ```powershell
  $env:PATH = "C:\Program Files\nodejs;$env:PATH"
  npm.cmd test
  ```
  Expected: All server rules, jump physics, gap clearance, and match finality tests pass.
- Production build:
  ```powershell
  $env:PATH = "C:\Program Files\nodejs;$env:PATH"
  npm.cmd run build
  ```

### Manual Interactive Checklist
Run `npm.cmd run dev` and `npm.cmd run blockout3d`, then verify in browser at `http://localhost:5173/play/blockout-royale-3d`:
1. Clicking canvas locks the mouse; moving mouse looks around smoothly without button dragging; Esc releases.
2. Character displays as a 3D chibi astronaut with visor and oxygen tank, facing the movement direction.
3. Pressing Space performs an aerial jump over 1-tile holes without falling.
4. Landing on a hole after a jump begins downward falling into the floor below.
5. Powerups appear as rotating, bobbing 3D gems with orbital rings.
6. Winning a round concludes the match immediately without requiring 3 rounds.

