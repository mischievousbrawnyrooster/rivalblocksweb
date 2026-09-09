# Blockout Royale 3D: Jump, Pointer Lock, 3D Astronauts & 3D Powerups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement authoritative Jump mechanics (replacing stomp), pointer-lock mouse look, procedural 3D chibi astronaut characters (like *Among Us*), animated 3D powerup collectibles, and single-round match scoring in Blockout Royale 3D.

**Architecture:** 
Follows strict three-layer architecture:
1. `server/blockout3d.js` purely calculates authoritative jump movement boost, gap clearance, and single-round match ending without external imports or timers.
2. `server/blockout3d-server.js` relays `{ t: 'jump' }` frames from client to rules engine.
3. `src/lib/towerScene.js` constructs procedural Three.js 3D chibi astronaut character groups, animated 3D powerup tokens, directional body rotation, and jump elevation arcs.
4. `src/pages/Blockout3D.jsx` captures canvas pointer lock for mouse look, sends jump inputs on Space, and cleans up multi-round HUD.

**Tech Stack:** Three.js, React, Node.js (`node --test`), WebSocket.

**Spec:** `docs/superpowers/specs/2026-09-09-blockout-3d-jump-controls-visuals-design.md`

## Global Constraints

- Prefix every command with: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"` (Windows / PowerShell) or `export PATH="/c/Program Files/nodejs:$PATH"` (Git Bash).
- `server/blockout3d.js` must be pure: zero external imports, zero Node APIs, zero sockets, zero timers.
- Zero image files: all 3D artwork must use procedural Three.js primitives (`BoxGeometry`, `CapsuleGeometry`, `CylinderGeometry`, `IcosahedronGeometry`, `TorusGeometry`, etc.) and canvas textures.
- Status is never communicated by color alone (WCAG 1.4.1). Silhouette emoji billboard glyphs must be preserved above player heads.
- Strict server authority: client sends intent (`{ t: 'jump' }`), server decides jump trajectory and landing. No client-side prediction.
- Tests reference constants, never hardcoded literals (`ROUND_TARGET`, `JUMP_DURATION_MS`, `JUMP_COOLDOWN_MS`).
- Line endings must be CRLF (`\r\n`).
- Strictly no em dashes in copy.

---

### Task 1: Authoritative Jump Mechanic & Single-Round Target

**Files:**
- Modify: `server/blockout3d.js`
- Modify: `server/blockout3d-server.js`
- Modify: `server/blockout3d.test.js`

**Interfaces:**
- Consumes: `state`, `p`
- Produces: `jump(state, id)`, `snapshot(state)` containing `jumping` and `jumpProgress`, `ROUND_TARGET = 1`

- [ ] **Step 1: Write failing tests for jump mechanics and single-round target**

In `server/blockout3d.test.js`, replace stomp tests with jump tests and update `ROUND_TARGET` tests:

```js
test('a jump initiates an airborne state and cooldown', () => {
  const m = make(2)
  playing(m, 2)
  const p = m.players[0]
  assert.equal(jump(m, p.id), true)
  assert.equal(p.jumpUntil > m.now, true)
  assert.equal(p.jumpReadyAt > m.now, true)
  // Cannot jump again while airborne or cooling down
  assert.equal(jump(m, p.id), false)
})

test('a jump ignores holes while airborne and clears 1-tile gaps', () => {
  const m = make(2)
  playing(m, 2)
  const p = m.players[0]
  // Place player at (1.5, 1.5) on floor 0
  p.x = 1.5
  p.y = 1.5
  p.z = 0
  // Dig a hole directly ahead at (2, 1)
  const holeIdx = idx(2, 1, 0)
  m.tiles[holeIdx] = 'gone'

  // Jump forward towards the hole
  p.dir = [1, 0]
  p.face = [1, 0]
  assert.equal(jump(m, p.id), true)

  // Step into the hole while jump is active
  p.x = 2.5
  resolveFalls(m)
  assert.equal(p.fallUntil, 0, 'did not fall while jumping')

  // Advance time past jump duration while still over hole
  m.now += JUMP_DURATION_MS + 10
  resolveFalls(m)
  assert.equal(p.fallUntil > 0, true, 'fell after jump ended on hole')
})

test('a match concludes after 1 round win', () => {
  const m = make(2)
  playing(m, 2)
  const [a, b] = m.players
  eliminate(m, b, a.id)
  tick(m, 1)
  assert.equal(m.phase, 'over')
  assert.equal(m.final, true, 'match is final on first round win')
  assert.equal(a.wins, 1)
})
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
node --test --test-name-pattern="jump" server/blockout3d.test.js
```
Expected: FAIL with `jump is not defined`.

- [ ] **Step 3: Implement Jump, Single-Round rules, and 60 FPS tick in `server/blockout3d.js`**

1. Set `ROUND_TARGET = 1` and `TICK_MS = 16` (60 Hz server rate):
   ```js
   export const ROUND_TARGET = 1
   export const TICK_MS = 16
   ```
2. Define jump constants:
   ```js
   export const JUMP_DURATION_MS = 420
   export const JUMP_COOLDOWN_MS = 750
   export const JUMP_SPEED_BOOST = 1.25
   ```
3. Update `seat()` and `startRound()` player state:
   Replace `stompAt: 0, stompReadyAt: 0` with:
   ```js
   jumpUntil: 0,
   jumpReadyAt: 0,
   ```
4. Implement `jump(state, id)`:
   ```js
   export function jump(state, id) {
     if (state.phase !== 'playing') return false
     const p = state.players.find((q) => q.id === id)
     if (!p || !p.playing || !p.alive || p.fallUntil) return false
     if (state.now < p.jumpUntil || state.now < p.jumpReadyAt) return false
     p.jumpUntil = state.now + JUMP_DURATION_MS
     p.jumpReadyAt = state.now + JUMP_COOLDOWN_MS
     return true
   }
   ```
5. In `stepPlayers(state, dt)`, apply jump speed multiplier:
   ```js
   const speed = (state.now < p.dashUntil ? DASH_SPEED : SPEED) * (state.now < p.jumpUntil ? JUMP_SPEED_BOOST : 1)
   ```
6. In `resolveFalls(state)`:
   ```js
   const jumping = state.now < p.jumpUntil
   if (!jumping && state.tiles[tileUnder(state, p)] !== 'solid') {
     startFall(state, p, 0)
   }
   ```
7. In `snapshot(state)`:
   Replace `stomping: p.stompAt > 0` with:
   ```js
   jumping: state.now < p.jumpUntil,
   jumpProgress: p.jumpUntil ? Math.max(0, Math.min(1, 1 - (p.jumpUntil - state.now) / JUMP_DURATION_MS)) : 0,
   ```
8. Remove obsolete `stomp` functions and references from `server/blockout3d.js`.

- [ ] **Step 4: Update `server/blockout3d-server.js` message handler**

Replace `{ t: 'stomp' }` with `{ t: 'jump' }`:
```js
    } else if (msg?.t === 'jump' && player) {
      jump(match, player.id)
    }
```
Update import to import `jump` instead of `stomp`.

- [ ] **Step 5: Run full server test suite**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd test
```
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add server/blockout3d.js server/blockout3d-server.js server/blockout3d.test.js
git commit -m "feat(blockout3d): authoritative jump mechanics and single-round match scoring"
```

---

### Task 2: Pointer Lock Mouse Look & Jump Controls

**Files:**
- Modify: `src/pages/Blockout3D.jsx`

**Interfaces:**
- Consumes: `orbit(cam, dx, dy)` from `src/lib/followCamera.js`, `wsRef`
- Produces: Pointer lock controls, Space jump trigger, single-round HUD

- [ ] **Step 1: Add Pointer Lock state and canvas click handler**

In `src/pages/Blockout3D.jsx`:
1. Track pointer lock state in a ref/state:
   ```js
   const [isLocked, setIsLocked] = useState(false)
   ```
2. Add click handler on the canvas element:
   ```js
   const requestLock = useCallback(() => {
     if (canvasRef.current && document.pointerLockElement !== canvasRef.current) {
       canvasRef.current.requestPointerLock()
     }
   }, [])
   ```
3. Listen to `pointerlockchange` on `document`:
   ```js
   useEffect(() => {
     const onLockChange = () => {
       setIsLocked(document.pointerLockElement === canvasRef.current)
     }
     document.addEventListener('pointerlockchange', onLockChange)
     return () => document.removeEventListener('pointerlockchange', onLockChange)
   }, [])
   ```

- [ ] **Step 2: Update mouse move handler to use pointer lock movement**

In `src/pages/Blockout3D.jsx` scene `useEffect`:
Replace old pointerdown/move/up dragging logic with:
```js
    const mm = (e) => {
      if (document.pointerLockElement !== canvasRef.current) return
      orbit(camRef.current, e.movementX, e.movementY)
    }
    window.addEventListener('mousemove', mm)
```
Clean up event listener in return block.

- [ ] **Step 3: Update Space key binding to send Jump**

In `src/pages/Blockout3D.jsx` keydown listener:
Replace `stomp` with `jump`:
```js
      if (e.code === 'Space') {
        wsRef.current?.send(JSON.stringify({ t: 'jump' }))
        e.preventDefault()
        return
      }
```

- [ ] **Step 4: Update HUD for single-round matches & pointer lock hint**

1. In scoreboard header:
   Replace `{me?.wins ?? 0} of {hud?.target ?? DEFAULT_TARGET}` with simply `{me?.wins ?? 0}` wins or match counter.
2. Render pointer lock banner over canvas when `joined && !isLocked`:
   ```jsx
   {!isLocked && joined && (
     <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 bg-bg/80 px-3 py-1 text-xs text-muted border border-line">
       Click arena to control camera. Press Esc to release mouse.
     </div>
   )}
   ```
3. Update `statusLine`:
   When `game.phase === 'over'`, always display:
   ```js
   const what = 'takes the match'
   ```
4. Transition to 60 FPS input & render stream:
   Update constants in `src/pages/Blockout3D.jsx`:
   ```js
   const DELAY_MS = 60
   const SEND_MS = 16
   ```

- [ ] **Step 5: Verify build & tests**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd run build
npm.cmd test
```
Expected: Build passes with 0 errors, tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Blockout3D.jsx
git commit -m "feat(blockout3d): pointer lock camera controls and jump input"
```

---

### Task 3: Prominent 3D Collectible Powerups

**Files:**
- Modify: `src/lib/towerScene.js`

**Interfaces:**
- Consumes: `view.powerups`, `worldY`
- Produces: Spinning, bobbing composite 3D powerup meshes

- [ ] **Step 1: Create 3D powerup compound geometry and materials**

In `src/lib/towerScene.js`:
1. Replace `OctahedronGeometry(0.28)` with:
   - Core: `THREE.IcosahedronGeometry(0.36, 0)`
   - Orbital Ring: `THREE.TorusGeometry(0.52, 0.05, 8, 24)`
2. Create InstancedMesh for cores and rings (up to 64):
   ```js
   const pickCoreGeo = new THREE.IcosahedronGeometry(0.36, 0)
   const pickRingGeo = new THREE.TorusGeometry(0.52, 0.045, 8, 24)
   const pickMat = new THREE.MeshLambertMaterial({
     color: token('--flare', '#ff6b1a'),
     emissive: token('--flare', '#ff6b1a'),
     emissiveIntensity: 0.25,
   })
   const pickCores = new THREE.InstancedMesh(pickCoreGeo, pickMat, 64)
   const pickRings = new THREE.InstancedMesh(pickRingGeo, pickMat, 64)
   pickCores.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
   pickRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
   scene.add(pickCores)
   scene.add(pickRings)
   ```

- [ ] **Step 2: Animate spinning and hovering in `update()`**

In `update(view, ...)`:
Compute time-based rotation and bobbing:
```js
      const tSec = performance.now() * 0.001
      const bob = Math.sin(tSec * 3.5) * 0.12
      const rotCore = tSec * 1.8
      const rotRing = -tSec * 2.2
      const rotM = new THREE.Matrix4()
      const ringTiltM = new THREE.Matrix4().makeRotationX(Math.PI / 4)

      let n = 0
      for (const key of Object.keys(view.powerups ?? {})) {
        if (n >= 64) break
        const i = Number(key)
        const z = Math.floor(i / (size * size))
        const px = (i % size) + 0.5
        const py = worldY(z) + 0.65 + bob
        const pz = (Math.floor(i / size) % size) + 0.5

        // Core translation and rotation
        m4.makeTranslation(px, py, pz)
        rotM.makeRotationY(rotCore)
        m4.multiply(rotM)
        pickCores.setMatrixAt(n, m4)

        // Orbital ring translation and counter-rotation
        m4.makeTranslation(px, py, pz)
        rotM.makeRotationY(rotRing)
        m4.multiply(ringTiltM)
        m4.multiply(rotM)
        pickRings.setMatrixAt(n, m4)
        n++
      }
      for (let i = n; i < 64; i++) {
        pickCores.setMatrixAt(i, hidden)
        pickRings.setMatrixAt(i, hidden)
      }
      pickCores.instanceMatrix.needsUpdate = true
      pickRings.instanceMatrix.needsUpdate = true
```

- [ ] **Step 3: Update `dispose()` to clean up powerup meshes and geometries**

```js
      pickCoreGeo.dispose()
      pickRingGeo.dispose()
      pickMat.dispose()
      pickCores.dispose()
      pickRings.dispose()
```

- [ ] **Step 4: Verify build and tests**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd run build
npm.cmd test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/towerScene.js
git commit -m "feat(blockout3d): prominent animated 3D powerup collectibles"
```

---

### Task 4: 3D Chibi Astronaut Character & Jump Arc

**Files:**
- Modify: `src/lib/towerScene.js`

**Interfaces:**
- Consumes: `view.players` (`p.x, p.y, p.z, p.jumping, p.jumpProgress, p.fall`), `worldY`
- Produces: 3D Among Us style astronaut character group, directional facing, jump elevation arc

- [ ] **Step 1: Design procedural Chibi Astronaut character factory**

In `src/lib/towerScene.js`:
Create a helper to assemble an astronaut `THREE.Group`:
- **Body**: `THREE.CapsuleGeometry(0.24, 0.38, 8, 16)` tinted with `playerColor(slot)`.
- **Visor**: `THREE.BoxGeometry(0.26, 0.16, 0.14)` with rounded edges or small capsule in shiny cyan (`#7ce8ff`), positioned forward at `z = 0.18, y = 0.12`.
- **Backpack (Oxygen Tank)**: `THREE.BoxGeometry(0.26, 0.34, 0.14)` in player slot color mounted at `z = -0.18, y = 0.04`.
- **Feet**: Two small cylinders (`THREE.CylinderGeometry(0.08, 0.08, 0.18)`) positioned at `x = ±0.12, y = -0.26`.

```js
function createAstronaut(slot, slotColor) {
  const group = new THREE.Group()
  const mat = new THREE.MeshLambertMaterial({ color: slotColor })
  const visorMat = new THREE.MeshLambertMaterial({ color: '#7ce8ff' })

  // Suit Body
  const bodyGeo = new THREE.CapsuleGeometry(0.24, 0.36, 8, 16)
  const body = new THREE.Mesh(bodyGeo, mat)
  body.position.y = 0.12
  group.add(body)

  // Visor
  const visorGeo = new THREE.BoxGeometry(0.26, 0.16, 0.12)
  const visor = new THREE.Mesh(visorGeo, visorMat)
  visor.position.set(0, 0.18, 0.2)
  group.add(visor)

  // Oxygen Tank Backpack
  const packGeo = new THREE.BoxGeometry(0.24, 0.32, 0.12)
  const pack = new THREE.Mesh(packGeo, mat)
  pack.position.set(0, 0.12, -0.2)
  group.add(pack)

  // Left & Right Boots
  const bootGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.16, 8)
  const leftBoot = new THREE.Mesh(bootGeo, mat)
  leftBoot.position.set(-0.11, -0.14, 0)
  group.add(leftBoot)

  const rightBoot = new THREE.Mesh(bootGeo, mat)
  rightBoot.position.set(0.11, -0.14, 0)
  group.add(rightBoot)

  group.userData = { body, pack, leftBoot, rightBoot, mat, visorMat }
  return group
}
```

- [ ] **Step 2: Update player creation and animation in `update()`**

1. Replace `new THREE.Mesh(bodyGeo, ...)` with `createAstronaut(slot, playerColor(slot))`.
2. Compute jump arc height:
   ```js
   const jumpArc = p.jumping ? 4 * 0.85 * p.jumpProgress * (1 - p.jumpProgress) : 0
   ```
3. Set group position:
   ```js
   mesh.position.set(p.x, worldY(p.z, p.fall) + 0.52 + jumpArc, p.y)
   ```
4. Update directional rotation:
   If player has moved (`p.x, p.y` delta or tracking previous position), compute angle:
   ```js
   if (mesh.userData.lastX !== undefined) {
     const dx = p.x - mesh.userData.lastX
     const dy = p.y - mesh.userData.lastY
     if (dx * dx + dy * dy > 0.0001) {
       mesh.rotation.y = Math.atan2(dx, dy)
     }
   }
   mesh.userData.lastX = p.x
   mesh.userData.lastY = p.y
   ```
5. Position floating silhouette emoji billboard label above astronaut's head:
   ```js
   label.position.set(p.x, worldY(p.z, p.fall) + 1.25 + jumpArc, p.y)
   ```

- [ ] **Step 3: Update `dispose()` to clean up astronaut geometries and materials**

- [ ] **Step 4: Verify build and tests**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd run build
npm.cmd test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/towerScene.js
git commit -m "feat(blockout3d): 3D chibi astronaut character models and jump animation"
```

---

### Task 5: Invariants Update & Verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Record jump gap clearance and single-round match invariants**

In `CLAUDE.md`:
1. Document that Blockout 3D matches are single-round (`ROUND_TARGET = 1`).
2. Document that Jump clears 1-tile gaps authoritatively without falling during `state.now < p.jumpUntil`, falling only when landing on an invalid tile when jump concludes.
3. Document that 3D characters and powerups are built from procedural Three.js primitives without external textures.

- [ ] **Step 2: Run full verification suite**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd test
npm.cmd run build
```
Expected: All tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(blockout3d): record jump, pointer lock, and 3D visual invariants"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-09-blockout-3d-jump-controls-visuals.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

