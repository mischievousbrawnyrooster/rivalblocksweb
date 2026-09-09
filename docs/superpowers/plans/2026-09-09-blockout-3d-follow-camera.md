# Blockout 3D Follow Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Blockout Royale 3D's centre-pointed orbit camera with a third-person camera that follows the player, and rotate keyboard input into world space so W always moves up the screen.

**Architecture:** The camera's state and maths move out of the renderer into a pure, tested module. The renderer stops owning yaw and receives a pose. Tiles split from one `InstancedMesh` into one per floor so floors above the player can fade. The local player is drawn from the newest snapshot while everyone else stays smoothed.

**Tech Stack:** Node 20+ ESM, React 19, three.js 0.185, Vite 8, Tailwind v4 (CSS-first), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-09-blockout-3d-follow-camera-design.md`

## Global Constraints

- **Node is not on PATH.** Prefix every `node`/`npm` command: `export PATH="/c/Program Files/nodejs:$PATH"` (Git Bash).
- **`src/lib/followCamera.js` must be pure**: no imports, no three.js, no DOM. It runs under `node --test`.
- **`server/blockout3d.js` is not touched by this plan.** The server's input contract does not change: it still receives a world-space vector and still knows nothing about cameras.
- **No client-side prediction.** Drawing the local player at the newest *received* position is not prediction and is explicitly permitted; simulating ahead of the server is not.
- **No image files.** All artwork generated in code.
- **Status is never communicated by colour alone** (WCAG 1.4.1). The warned-tile sink, foreseen-tile rise, plated-tile thickening and billboard initial all survive this change untouched.
- **Only existing `@theme` tokens.** Canvas and WebGL code reads the raw `:root` variables (`--bg`, `--tile`, `--player-N`), never the `--color-*` aliases — `@theme inline` does not emit those.
- **Tests reference constants, never literals.**
- **In-fiction copy.** Nothing may read as a demo, mock, test or placeholder.
- The repo is CRLF. Do not run a formatter, and do not reformat code you did not write.
- **The working tree is shared.** The user edits this repo from a separate tool. Never `git add -A`, `git add .`, `git commit -a`, `git stash`, `git checkout .` or `git reset`. Stage only the files each task names.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/followCamera.js` | **Create.** Camera state and all camera maths. Pure |
| `src/lib/followCamera.test.js` | **Create.** Tests for the above, including the shipped-bug regression |
| `src/lib/snapshotBuffer.js` | **Modify.** `sample` gains a `liveId` |
| `src/lib/snapshotBuffer.test.js` | **Modify.** Two cases for `liveId` |
| `src/lib/towerScene.js` | **Modify.** Per-floor meshes, the fade, and a pose-driven camera |
| `src/pages/Blockout3D.jsx` | **Modify.** Owns the camera, rotates input, passes the pose |
| `package.json` | **Modify.** Register the new test file |
| `CLAUDE.md` | **Modify.** Two new invariants |

---

### Task 1: The pure camera module

**Files:**
- Create: `src/lib/followCamera.js`
- Create: `src/lib/followCamera.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `DIST`, `HEIGHT`, `EYE`, `PITCH_MIN`, `PITCH_MAX`, `ORBIT_SPEED`, `makeCamera()`, `orbit(cam, dx, dy)`, `worldDir(cam, ix, iy)`, `poseFor(cam, body, floorGap)`. `poseFor` returns `{ position: [x, y, z], target: [x, y, z] }` in three.js world coordinates, where world X is the grid's `x`, world Z is the grid's `y`, and world Y is height.

- [ ] **Step 1: Write the failing test**

Create `src/lib/followCamera.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  makeCamera,
  orbit,
  worldDir,
  poseFor,
  DIST,
  EYE,
  PITCH_MIN,
  PITCH_MAX,
  ORBIT_SPEED,
} from './followCamera.js'

const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} vs ${b}`)

test('the shipped bug: at the default angle, W does not move you up the grid', () => {
  const cam = makeCamera()
  const [x, y] = worldDir(cam, 0, -1)
  // The old code sent [0, -1] verbatim at every camera angle, which is why W
  // never moved the player up the screen. Anything that returns it unchanged
  // here has reintroduced that.
  assert.ok(Math.abs(x) > 0.1, `W must not stay on the grid axis, got ${x}`)
  near(Math.hypot(x, y), 1, 'and it is still a unit vector')
})

test('facing along the grid, the input passes through unchanged', () => {
  const cam = { yaw: 0, pitch: 0.6 }
  assert.deepEqual(worldDir(cam, 0, -1).map(Math.round), [0, -1], 'W')
  assert.deepEqual(worldDir(cam, 1, 0).map(Math.round), [1, 0], 'D')
  assert.deepEqual(worldDir(cam, 0, 1).map(Math.round), [0, 1], 'S')
  assert.deepEqual(worldDir(cam, -1, 0).map(Math.round), [-1, 0], 'A')
})

test('a quarter turn sends W along the other axis', () => {
  const cam = { yaw: Math.PI / 2, pitch: 0.6 }
  const [x, y] = worldDir(cam, 0, -1)
  near(x, -1, 'W now points along -x')
  near(y, 0, 'and not along y at all')
})

test('a diagonal is not a faster way to travel', () => {
  const cam = makeCamera()
  const straight = worldDir(cam, 0, -1)
  const diagonal = worldDir(cam, 1, -1)
  near(Math.hypot(...straight), 1, 'W alone')
  near(Math.hypot(...diagonal), Math.hypot(1, 1), 'W and D together keep their input magnitude')
})

test('a drag turns the camera and pitch stops at both ends', () => {
  const cam = makeCamera()
  const wasYaw = cam.yaw
  orbit(cam, 100, 0)
  near(cam.yaw, wasYaw - 100 * ORBIT_SPEED, 'yaw follows the drag')

  orbit(cam, 0, -100000)
  assert.equal(cam.pitch, PITCH_MAX, 'never past the top')
  orbit(cam, 0, 100000)
  assert.equal(cam.pitch, PITCH_MIN, 'never under the floor')
})

test('the camera sits behind the body, never beneath its floor', () => {
  const cam = { yaw: 0, pitch: 0.6 }
  const body = { x: 6.5, y: 6.5, z: 2, fall: 0 }
  const gap = 3.4
  const { position, target } = poseFor(cam, body, gap)

  const feet = -(body.z * gap)
  near(target[0], body.x, 'target tracks the body in x')
  near(target[2], body.y, 'and in z')
  near(target[1], feet + EYE, 'looking at eye height')

  // At yaw 0 the camera sits on the +z side, which is behind a body facing -z.
  assert.ok(position[2] > target[2], 'behind the body')
  assert.ok(position[1] > feet, 'above the floor it is standing on')
  const back = Math.hypot(position[0] - target[0], position[2] - target[2])
  assert.ok(back > 0 && back <= DIST, `pulled back by no more than DIST, got ${back}`)
})

test('the camera descends with a body that is mid-drop', () => {
  const cam = makeCamera()
  const gap = 3.4
  const high = poseFor(cam, { x: 6.5, y: 6.5, z: 1, fall: 0 }, gap)
  const mid = poseFor(cam, { x: 6.5, y: 6.5, z: 1, fall: 0.5 }, gap)
  assert.ok(mid.target[1] < high.target[1], 'the target follows the fall')
  near(high.target[1] - mid.target[1], gap * 0.5, 'proportionally, not on landing')
})

test('a body with no fall field is treated as grounded', () => {
  const cam = makeCamera()
  const a = poseFor(cam, { x: 1, y: 1, z: 0 }, 3.4)
  const b = poseFor(cam, { x: 1, y: 1, z: 0, fall: 0 }, 3.4)
  assert.deepEqual(a, b)
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test src/lib/followCamera.test.js
```

Expected: FAIL — `Cannot find module './followCamera.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/followCamera.js`:

```js
// The follow camera's state and maths, kept out of the renderer so they can be
// tested.
//
// This file exists because the input rotation shipped wrong. `KeyW` sent the
// fixed world vector [0, -1] straight to the server while the camera sat at 45
// degrees and its yaw never left the renderer, so W had never once moved the
// player up the screen. The maths that got that wrong is pure, so it belongs
// somewhere a test can reach it.
//
// Pure: no imports, no three.js, no DOM. World coordinates here are three.js's
// — world X is the grid's x, world Z is the grid's y, world Y is height.

export const DIST = 7.5 // how far behind the body the camera sits
export const HEIGHT = 2.2 // and how far above it
export const EYE = 0.9 // what it looks at, above the body's feet
export const PITCH_MIN = 0.15
export const PITCH_MAX = 1.35
export const ORBIT_SPEED = 0.005 // radians per pixel dragged

/** A camera looking at the stack from one corner, a little above. */
export const makeCamera = () => ({ yaw: Math.PI / 4, pitch: 0.6 })

/** Applies a pointer drag, in pixels. Mutates and returns the camera. */
export function orbit(cam, dx, dy) {
  cam.yaw -= dx * ORBIT_SPEED
  cam.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, cam.pitch - dy * ORBIT_SPEED))
  return cam
}

/**
 * The input vector, rotated out of screen space and into the world.
 *
 * The camera at yaw sits at `target + (sin, cos) * DIST` and looks inward, so
 * forward is `(-sin, -cos)` and right is `(cos, -sin)`. An input of [0, -1] is
 * forward and [1, 0] is right.
 *
 * At yaw 0 this returns the input unchanged, which is exactly how the original
 * bug survived a reading: the code looks right until you notice the camera
 * never starts at zero.
 */
export function worldDir(cam, ix, iy) {
  const s = Math.sin(cam.yaw)
  const c = Math.cos(cam.yaw)
  return [c * ix + s * iy, c * iy - s * ix]
}

/**
 * Where the camera goes, given the body it is following.
 *
 * `body.fall` runs 0 to 1 through a drop, so a camera following someone mid-air
 * descends with them rather than snapping when they land. Height is clamped so
 * the camera never ends up under the floor the body is standing on; it may rise
 * above the ceiling, because floors above are drawn transparent and that is a
 * legitimate vantage rather than a glitch.
 */
export function poseFor(cam, body, floorGap) {
  const s = Math.sin(cam.yaw)
  const c = Math.cos(cam.yaw)
  const flat = Math.cos(cam.pitch)
  const feet = -(body.z + (body.fall ?? 0)) * floorGap
  const target = [body.x, feet + EYE, body.y]
  return {
    target,
    position: [
      target[0] + s * flat * DIST,
      Math.max(feet + 0.4, target[1] + Math.sin(cam.pitch) * DIST + HEIGHT),
      target[2] + c * flat * DIST,
    ],
  }
}
```

- [ ] **Step 4: Register the test file and run it**

In `package.json`, append `src/lib/followCamera.test.js` to the `test` script, after `src/lib/snapshotBuffer.test.js`.

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test src/lib/followCamera.test.js
npm test
```

Expected: 8 new tests pass; the full suite stays green at its current count plus 8.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followCamera.js src/lib/followCamera.test.js package.json
git commit -m "feat(blockout3d): the follow camera's maths, where a test can reach it"
```

---

### Task 2: Two clocks in the snapshot buffer

**Files:**
- Modify: `src/lib/snapshotBuffer.js`
- Modify: `src/lib/snapshotBuffer.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `sample(now, liveId = null)`. The player whose `id` equals `liveId` comes from the newest frame verbatim; every other player is interpolated as before. An absent, null or unmatched `liveId` leaves behaviour exactly as it is today.

With the camera glued to the local body, the 100 ms replay becomes the whole world lagging behind the mouse. Drawing the local player at the newest position the server has already sent removes that. It is not prediction: nothing simulates ahead of the server, the client merely declines to hold a received position back by three frames.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/snapshotBuffer.test.js`:

```js
test('the live player comes from the newest frame, everyone else is smoothed', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }, { id: 2, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 2, y: 0, z: 0, fall: 0 }, { id: 2, x: 2, y: 0, z: 0, fall: 0 }] }, 100)
  const s = b.sample(150, 1)
  const live = s.players.find((p) => p.id === 1)
  const other = s.players.find((p) => p.id === 2)
  assert.equal(live.x, 2, 'the live player is where the server last put them')
  assert.ok(Math.abs(other.x - 1) < 1e-6, 'everyone else is still halfway')
})

test('an unknown or absent live id changes nothing', () => {
  const b = makeBuffer(100)
  b.push({ players: [{ id: 1, x: 0, y: 0, z: 0, fall: 0 }] }, 0)
  b.push({ players: [{ id: 1, x: 2, y: 0, z: 0, fall: 0 }] }, 100)
  const none = b.sample(150)
  const wrong = b.sample(150, 99)
  assert.ok(Math.abs(none.players[0].x - 1) < 1e-6)
  assert.deepEqual(wrong.players, none.players)
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test src/lib/snapshotBuffer.test.js
```

Expected: FAIL — the live player is interpolated to 1, not 2, because `sample` ignores its second argument.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/snapshotBuffer.js`, change the signature to `sample(now, liveId = null)` and, inside the players map, return the newest frame's row untouched when the id matches. The existing early return for a player absent from the older frame stays as it is:

```js
        players: (newer.snap.players ?? []).map((p) => {
          // The player this client is following is drawn where the server last
          // put them, not three frames back. With the camera attached to that
          // body, holding it back is felt as the whole world lagging the mouse.
          // Still not prediction: this is a position the server has already
          // sent, just not delayed.
          if (p.id === liveId) return p
          const a = was.get(p.id)
          …unchanged…
        }),
```

Update the module's header comment to say that one player may be exempted from the delay, and why that is still not prediction.

- [ ] **Step 4: Run the tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test src/lib/snapshotBuffer.test.js
npm test
```

Expected: PASS, 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/snapshotBuffer.js src/lib/snapshotBuffer.test.js
git commit -m "feat(blockout3d): draw the followed player without the replay delay"
```

---

### Task 3: One mesh per floor, and the fade

**Files:**
- Modify: `src/lib/towerScene.js`

**Interfaces:**
- Consumes: nothing new
- Produces: no interface change. `makeScene` still returns `{ update, resize, orbit, dispose }` after this task; `orbit` is removed in Task 4.

`InstancedMesh` has no per-instance opacity — `instanceColor` is RGB only — so a per-floor fade requires a per-floor material. This is forced, not preferred.

- [ ] **Step 1: Split the tile mesh**

Replace the single `tiles` mesh (currently `new THREE.InstancedMesh(tileGeo, tileMat, count)` with `count = size * size * floors`) with one mesh per floor. Keep `tileGeo` shared — only the material must be per floor.

```js
  const perFloor = size * size

  // One InstancedMesh per floor rather than one for the whole stack.
  // InstancedMesh has no per-instance opacity — instanceColor is RGB only — so
  // fading the floors above the player needs a material per floor. Five draw
  // calls, not one, and still not the 845 that drawing tiles individually
  // would cost.
  const tileGeo = new THREE.BoxGeometry(TILE * 0.94, 0.35, TILE * 0.94)
  const tileMats = []
  const tiles = []
  for (let z = 0; z < floors; z++) {
    const mat = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: true })
    const mesh = new THREE.InstancedMesh(tileGeo, mat, perFloor)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(perFloor * 3), 3)
    tileMats.push(mat)
    tiles.push(mesh)
    scene.add(mesh)
  }
```

- [ ] **Step 2: Rewrite the tile loop to write per floor**

The loop currently walks `0 … count` and calls `tiles.setMatrixAt(i, …)`. It must now walk each floor and index within it. The stack index for reading `view.tiles` is unchanged; only the instance index changes.

```js
      for (let z = 0; z < floors; z++) {
        const mesh = tiles[z]
        for (let n = 0; n < perFloor; n++) {
          const i = z * perFloor + n // stack index, for the tile string
          const ch = view.tiles[i]
          if ((ch !== SOLID && ch !== WARN) || z > view.bottom) {
            mesh.setMatrixAt(n, hidden)
            continue
          }
          const x = n % size
          const y = Math.floor(n / size)
          // …the existing lift, plate and colour logic, unchanged, writing to
          // mesh.setMatrixAt(n, …) and mesh.setColorAt(n, …)
        }
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
      }
```

Keep every structural cue exactly as it is: the warned-tile sink, the foreseen-tile rise, the plated-tile thickening and the depth darkening for floors below.

- [ ] **Step 3: Add the fade**

After the loop, set each floor's opacity and draw order from its distance to `viewZ`. `z = 0` is the top of the stack and `z` increases downward, so a floor *above* the player has the *lower* index.

```js
      for (let z = 0; z < floors; z++) {
        const mat = tileMats[z]
        const above = viewZ - z // positive when this floor is above the player
        if (above > 0) {
          // See-through, so the camera behind the player is not looking at the
          // underside of a slab — and so a body about to drop on them is still
          // visible up there.
          mat.opacity = Math.max(0.06, 0.26 - (above - 1) * 0.08)
          mat.depthWrite = false
          // Furthest above draws first: back to front for a camera that always
          // sits at or above the player.
          tiles[z].renderOrder = 1 + z
        } else {
          mat.opacity = 1
          mat.depthWrite = true
          tiles[z].renderOrder = 0
        }
      }
```

- [ ] **Step 4: Fix disposal and verify**

`dispose()` currently disposes one `tiles` mesh and one `tileMat`. Both are now arrays — dispose every mesh and every material. A missed one leaks the per-instance GPU buffers on each unmount.

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run build
grep -nE "TextureLoader|GLTFLoader|FileLoader|\.load\(" src/lib/towerScene.js
node --check src/lib/towerScene.js
npm test
```

Expected: build succeeds and still emits a separate `Blockout3D-*.js` chunk; the grep is empty; the parse check passes; tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/towerScene.js
git commit -m "feat(blockout3d): one mesh per floor, so the floors above can fade"
```

---

### Task 4: A pose-driven camera

**Files:**
- Modify: `src/lib/towerScene.js`

**Interfaces:**
- Consumes: `poseFor`'s return shape from Task 1 — `{ position: [x, y, z], target: [x, y, z] }`
- Produces: `makeScene(canvas, { size, floors })` returns `{ update, resize, dispose }`. **`orbit` is gone.** `update(view, { viewZ, slotOf, pose })` — when `pose` is absent the camera falls back to the stack-centre overview.

- [ ] **Step 1: Remove the camera state**

Delete `yaw`, `pitch`, `dist` and the whole `orbit(dx, dy)` method. The scene stops owning any camera control state; it is handed a pose and places the camera there.

Keep `target` but rename it to make its new job obvious — it is now only the fallback for when there is no body to follow:

```js
  // Where the camera looks when there is nobody to follow: the lobby, a
  // spectator past capacity, or after elimination. Without this the camera
  // ends up at the origin staring into the void.
  const overview = {
    target: [size / 2, (-FLOOR_GAP * (floors - 1)) / 2, size / 2],
    position: [size / 2 + size * 1.7, size * 1.7, size / 2 + size * 1.7],
  }
```

- [ ] **Step 2: Place the camera from the pose**

Replace the trigonometry at the end of `update` with:

```js
      const shot = pose ?? overview
      camera.position.set(shot.position[0], shot.position[1], shot.position[2])
      camera.lookAt(shot.target[0], shot.target[1], shot.target[2])
      renderer.render(scene, camera)
```

- [ ] **Step 3: Verify nothing still calls `orbit`**

```bash
grep -rn "\.orbit(" src/
```

Expected: only `src/pages/Blockout3D.jsx`, which Task 5 fixes. If anything else appears, stop and report it.

- [ ] **Step 4: Confirm it still builds**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --check src/lib/towerScene.js
npm test
```

Expected: parse passes, tests unchanged. `npm run build` will still succeed because the page's `scene.orbit(...)` call is only reached at runtime — that is fixed next.

- [ ] **Step 5: Commit**

```bash
git add src/lib/towerScene.js
git commit -m "refactor(blockout3d): the scene takes a camera pose instead of owning one"
```

---

### Task 5: Wire the page

**Files:**
- Modify: `src/pages/Blockout3D.jsx`

**Interfaces:**
- Consumes: `makeCamera`, `orbit`, `worldDir`, `poseFor` from Task 1; `sample(now, liveId)` from Task 2; `update(view, { viewZ, slotOf, pose })` from Task 4
- Produces: nothing downstream

- [ ] **Step 1: Own the camera and rotate the input**

Import the module and hold a camera in a ref beside the buffer:

```js
import { makeCamera, orbit, worldDir, poseFor } from '../lib/followCamera.js'
…
  const camRef = useRef(makeCamera())
```

In the send interval, rotate before sending. `KEYS` stays exactly as it is — it describes screen directions, and `worldDir` is what turns them into world ones:

```js
      let dx = 0
      let dy = 0
      for (const code of heldRef.current) {
        dx += KEYS[code][0]
        dy += KEYS[code][1]
      }
      // Screen directions become world directions here, and nowhere else. The
      // server's contract is unchanged: it still receives a world vector and
      // knows nothing about cameras.
      const [wx, wy] = worldDir(camRef.current, dx, dy)
      wsRef.current?.send(JSON.stringify({ t: 'input', dir: [wx, wy] }))
```

Reset the camera in `join()` alongside the other refs, so a rejoin does not inherit the last session's angle.

- [ ] **Step 2: Drive the camera from the pointer, and pass the pose**

Change the drag handler from `scene.orbit(...)` to `orbit(camRef.current, ...)`. The scene no longer has that method.

In the render loop, ask the buffer for the live player and build the pose:

```js
    const frame = () => {
      const view = bufRef.current.sample(performance.now(), meRef.current)
      if (view) {
        const me = view.players.find((p) => p.id === meRef.current)
        const slotOf = new Map(view.players.map((p, i) => [p.id, i]))
        // No body to follow in the lobby, while spectating, or once you are
        // out — the scene falls back to its overview when pose is undefined.
        const pose = me && me.playing && me.alive
          ? poseFor(camRef.current, me, FLOOR_GAP)
          : undefined
        scene.update(view, { viewZ: me?.z ?? 0, slotOf, pose })
      }
      raf = requestAnimationFrame(frame)
    }
```

`FLOOR_GAP` lives in `towerScene.js` today. Export it from there and import it here rather than writing `3.4` twice — two copies of that number is a bug waiting for someone to change one of them.

- [ ] **Step 3: Build and run the suite**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run build
npm test
grep -n "scene.orbit" src/pages/Blockout3D.jsx
```

Expected: build succeeds with two chunks; tests green; the grep is empty.

- [ ] **Step 4: Play it**

Three terminals:

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm run dev
```
```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm run blockout3d
```

Open `http://localhost:5173/play/blockout-royale-3d`, join, and confirm each of these. **This is the only place any of it can be confirmed** — report honestly on every line, including any you could not check.

- W moves you **up the screen**, at every camera angle, including before you touch the mouse
- dragging orbits the camera around your body rather than the middle of the stack
- the camera follows you, and follows you *down* through a drop rather than snapping when you land
- floors above you are see-through, and a body on one of them is visible through it
- floors below you are solid and readable, so you can pick where to drop
- the transparent floors do not flicker against each other as you turn
- your own movement feels attached to the keyboard, not dragged behind it
- in the lobby, and after you are eliminated, the camera returns to an overview of the whole stack rather than the origin

- [ ] **Step 5: Commit**

```bash
git add src/pages/Blockout3D.jsx src/lib/towerScene.js
git commit -m "feat(blockout3d): the camera follows you, and W means up the screen"
```

---

### Task 6: Record the two new rules

**Files:**
- Modify: `CLAUDE.md`

Amendments only. Every existing invariant stays exactly as written — several were learned by measurement and cost real time to discover.

- [ ] **Step 1: Amend the interpolation rule**

`CLAUDE.md` currently says prediction is banned everywhere and interpolation is permitted. Extend the interpolation paragraph with the exemption, in its existing voice:

```markdown
Blockout Royale 3D exempts one player from that delay: the client draws the
body its camera is following at the newest position received, while everyone
else stays smoothed 100 ms back (`sample(now, liveId)`). That is still not
prediction — nothing simulates ahead of the server, and the position drawn is
one the server has already sent. It is there because a camera attached to a
body feels the replay delay as the whole world lagging the mouse.
```

- [ ] **Step 2: Add the per-floor mesh invariant**

Under "Invariants that fail silently":

```markdown
- **Blockout 3D draws one `InstancedMesh` per floor, not one per stack.**
  `InstancedMesh` has no per-instance opacity — `instanceColor` is RGB only —
  so fading the floors above the player needs a material per floor. Five draw
  calls, not one, and still not the 845 that drawing tiles individually would
  cost. Merging them back into a single mesh to "tidy up" silently removes the
  fade and puts the underside of a slab between the camera and the player.
```

- [ ] **Step 3: Add the camera-maths invariant**

```markdown
- **Keyboard input is rotated by camera yaw in `followCamera.worldDir`, and
  nowhere else.** The game shipped with `KeyW` sending the fixed world vector
  `[0, -1]` while the camera sat at 45 degrees and its yaw never left the
  renderer, so W never once moved the player up the screen. The rotation is
  pure and tested precisely because it failed silently: at yaw 0 it returns the
  input unchanged, so the wrong version looks correct until you notice the
  camera never starts at zero.
```

- [ ] **Step 4: Verify nothing regressed**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test
npm run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the follow camera's two new invariants"
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: the camera module and `worldDir` (1), the two clocks (2), per-floor meshes and the transparency ramp (3), the pose interface and the no-body fallback (4), input rotation and the browser checklist (5), the documentation amendments (6). The spec's "what only a browser can settle" list is Task 5 step 4, verbatim.

**Interfaces.** `poseFor` returns `{ position, target }` as arrays in Task 1 and is consumed as arrays in Tasks 4 and 5. `sample(now, liveId)` is defined in Task 2 and called with `meRef.current` in Task 5. `scene.update(view, { viewZ, slotOf, pose })` is defined in Task 4 and called with exactly those keys in Task 5. `orbit` is removed from the scene in Task 4 and the page's last call to it is removed in Task 5 — Task 4 step 3 exists to catch any other caller before that gap opens.

**One deliberate ordering hazard.** Between Task 4 and Task 5 the page still calls `scene.orbit`, which no longer exists. The build passes because the call is only reached at runtime, and Task 4's step 4 says so explicitly rather than letting an implementer think they have broken something. Tasks 4 and 5 should not be separated by a long gap.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-09-blockout-3d-follow-camera.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.
