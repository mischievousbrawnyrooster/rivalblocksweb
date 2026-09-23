# Cutline Camera Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Cutline three camera views, top-down, chase and bumper, with a player toggle, rendered by one three.js scene that replaces the Canvas 2D world renderer.

**Architecture:** A pure `raceCamera.js` owns every piece of maths that maps the game to three.js: the axis mapping, car and wheel orientation, the three view poses and their smoothing. A pure `wallBlocks.js` turns the grid into wall boxes. `cutlineScene.js` owns the three.js scene and holds no maths worth testing. The page keeps its socket, input and snapshot buffer, hands each frame to the scene, and draws the HUD, minimap and labels on a 2D canvas stacked above the WebGL one.

**Tech Stack:** React 19, three.js 0.185 (already a dependency), Vite 8, `node --test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-cutline-camera-views-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **There is no client-side prediction anywhere and there never will be.** The camera may only ease toward poses the server already sent. It never extrapolates ahead of them.
- **Game `y` maps to three.js `+z`, never `-z`.** Mapping it to `-z` mirrors the world, so a right-hand steer shows as a left turn and the minimap disagrees with the view. Verified: `+z` is correct in 10 of 10 handedness checks, `-z` is mirrored in 10 of 10.
- **The server, `server/cutline.js`, and the snapshot shape do not change.**
- **`raceCamera.js` and `wallBlocks.js` have zero imports** and no DOM or three.js. They are tested with `node --test`.
- **Steering is never rotated by the camera.** Cutline steers a rate relative to the car. Blockout Royale 3D rotates input by camera yaw in `followCamera.worldDir`; copying that here would break Cutline.
- **Bumper position is locked, never smoothed.** At `TOP_SPEED` any position lag leaves the camera behind the bumper.
- **Heading is smoothed along the shortest arc.**
- **Nothing a canvas or WebGL surface draws may load a file.** Every model is three.js primitives; every texture is a canvas drawn in code.
- **Canvas code reads raw `:root` variables** (`--bg`, `--tile`, `--player-N`), never `--color-*`, which resolve empty at runtime under Tailwind v4.
- **Status is never carried by colour alone** (WCAG 1.4.1). Every car shows its number and its status as text.
- **three.js must never enter the main bundle chunk.** Cutline is a lazy route.
- **Zero em dashes in comments and copy.**
- **Tests reference constants, never literals.**
- **Node is not on PATH in a fresh shell.** Prefix every command: `export PATH="/c/Program Files/nodejs:$PATH"`

## Review Focus

The five failure modes the spec implies but no feature test would naturally exercise, most likely to bite a player first. Each has its test in the task that owns the code.

1. **A new circuit arrives on restart** and the old ground texture and wall mesh are never freed, so GPU memory grows every race until the tab dies. Pinned in Task 4 (`setTrack` disposes first) and verified in Task 6 by watching `stats()` stay flat across restarts.
2. **The player navigates away and back** and the WebGL context is never released. Browsers cap live contexts at around 16 and then silently kill the oldest. Pinned in Task 4 (`dispose` calls `forceContextLoss`) and verified in Task 6.
3. **There is no car to follow**: the lobby, a spectator, or the player's car not yet in the snapshot. The camera must hold still, not snap to the origin or go to NaN. Pinned by a test in Task 1.
4. **A tab left in the background for minutes** resumes with a frame time of minutes. Smoothing must not overshoot or produce NaN. Pinned by a test in Task 1 (`MAX_DT`).
5. **The page resizes** and the WebGL canvas and the overlay canvas drift apart, so every label floats away from its car. Pinned in Task 6: both canvases share one container and labels are placed from normalised projection, never from WebGL pixel sizes.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/raceCamera.js` | Game-to-three.js mapping, car and wheel orientation, view poses, smoothing |
| `src/lib/raceCamera.test.js` | Tests for the above |
| `src/lib/wallBlocks.js` | Grid in, wall boxes bordering the road out |
| `src/lib/wallBlocks.test.js` | Tests for the above |
| `src/lib/cutlineScene.js` | The three.js scene. No game rules, no simulation, no prediction |
| `scripts/check-bundle.mjs` | Fails if three.js is in the main chunk after a build |

**Modified:** `src/pages/Cutline.jsx`, `src/App.jsx`, `package.json`, `CLAUDE.md`, `GEMINI.md`.

---

## Task 1: `raceCamera.js`, the camera and world mapping

Pure maths. Every correctness risk in this feature that can be tested without a GPU lives here, so it goes first and is tested hardest.

**Files:**
- Create: `src/lib/raceCamera.js`
- Create: `src/lib/raceCamera.test.js`
- Modify: `package.json` (add the test file to `npm test`)

**Interfaces:**
- Consumes: nothing.
- Produces: `VIEWS`, `DEFAULT_VIEW`, `isView(v)`, `nextView(v)`, `toWorld(x, y, h) -> [x, h, y]`, `yawFor(heading)`, `wheelYawFor(steer)`, `angleDelta(a, b)`, `ease(rate, dt)`, `targetPose(view, car, heading, nose)`, `upFor(position, target, heading)`, `makeRaceCamera()`, `stepCamera(cam, view, car, dt, nose) -> { position, target, up, fov } | null`, `chaseClearance()`, and the constants `CAR_ROOF`, `VIEW_CELLS`, `TOP_FOV`, `TOP_HEIGHT`, `CHASE_DIST`, `CHASE_HEIGHT`, `CHASE_LOOK_AHEAD`, `CHASE_FOV`, `BUMPER_EYE`, `BUMPER_FOV`, `BUMPER_SIGHT`, `WALL_HEIGHT`, `CHASE_CLEAR_MAX`, `HEADING_RATE`, `TOP_POS_RATE`, `CHASE_POS_RATE`, `FOV_RATE`, `MAX_DT`, `MAX_WHEEL_ANGLE`, `AIR_LIFT`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/raceCamera.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEWS,
  DEFAULT_VIEW,
  isView,
  nextView,
  toWorld,
  yawFor,
  wheelYawFor,
  angleDelta,
  ease,
  targetPose,
  upFor,
  makeRaceCamera,
  stepCamera,
  chaseClearance,
  CHASE_CLEAR_MAX,
  MAX_DT,
  HEADING_RATE,
} from './raceCamera.js'
import { CAR_LENGTH } from '../../server/cutline.js'

const near = (a, b, why, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${why}: ${a} vs ${b}`)
const sub = (a, b) => a.map((v, i) => v - b[i])
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
const len = (a) => Math.hypot(...a)
const norm = (a) => a.map((v) => v / (len(a) || 1))
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const NOSE = CAR_LENGTH / 2
const car = (x, y, heading) => ({ x, y, heading })

/** Run the camera forward until it has settled, at 60 frames a second. */
function settle(cam, view, c, frames = 600) {
  let pose = null
  for (let i = 0; i < frames; i++) pose = stepCamera(cam, view, c, 1 / 60, NOSE)
  return pose
}

test('game y maps to three.js +z, so the world is not mirrored', () => {
  // Mapping y to -z mirrors the world: a right-hand steer shows as a left turn
  // and the minimap disagrees with the view. Nothing errors when that happens.
  assert.deepEqual(toWorld(3, 7, 2), [3, 2, 7])
})

test('in top-down view the car’s right-hand side is on the right of the screen', () => {
  for (const heading of [-Math.PI / 2, 0, 0.7, 2.4, -2.1]) {
    const cam = makeRaceCamera()
    const pose = settle(cam, 'top', car(40, 40, heading))
    const view = norm(sub(pose.target, pose.position))
    const screenRight = cross(view, pose.up)
    const carRight = [-Math.sin(heading), 0, Math.cos(heading)]
    for (let i = 0; i < 3; i++) near(screenRight[i], carRight[i], `heading ${heading} axis ${i}`, 1e-6)
  }
})

test('in chase view the car’s right-hand side is on the right of the screen', () => {
  for (const heading of [0, 0.7, 2.4, -2.1]) {
    const cam = makeRaceCamera()
    const pose = settle(cam, 'chase', car(40, 40, heading))
    const view = norm(sub(pose.target, pose.position))
    const screenRight = norm(cross(view, pose.up))
    const carRight = [-Math.sin(heading), 0, Math.cos(heading)]
    assert.ok(dot(screenRight, carRight) > 0.99, `heading ${heading}: right-hand side must be screen-right`)
  }
})

test('a car model built facing +x points along its heading', () => {
  // three.js rotates about +y as x' = x cos(a) + z sin(a), z' = -x sin(a) + z cos(a).
  // The model's nose is +x, and it must end up along (cos h, 0, sin h).
  for (const heading of [0, 0.5, 2, -1.3]) {
    const a = yawFor(heading)
    near(Math.cos(a), Math.cos(heading), `cos at ${heading}`)
    near(-Math.sin(a), Math.sin(heading), `sin at ${heading}`)
  }
})

test('steering right turns the front wheels toward the car’s right-hand side', () => {
  // In the model frame the nose is +x and the car's right is +z. A wheel yawed
  // by a points along (cos a, 0, -sin a), so turning right needs -sin a > 0.
  assert.ok(-Math.sin(wheelYawFor(1)) > 0, 'steer +1 must point the wheels right')
  assert.ok(-Math.sin(wheelYawFor(-1)) < 0, 'steer -1 must point the wheels left')
  assert.equal(wheelYawFor(0), 0)
})

test('heading is smoothed along the shortest arc', () => {
  near(angleDelta((179 * Math.PI) / 180, (-179 * Math.PI) / 180), (2 * Math.PI) / 180, 'd', 1e-9)
  near(angleDelta((-179 * Math.PI) / 180, (179 * Math.PI) / 180), (-2 * Math.PI) / 180, 'd', 1e-9)

  const cam = makeRaceCamera()
  stepCamera(cam, 'chase', car(40, 40, (179 * Math.PI) / 180), 1 / 60, NOSE)
  for (let i = 0; i < 120; i++) {
    stepCamera(cam, 'chase', car(40, 40, (-179 * Math.PI) / 180), 1 / 60, NOSE)
    // It must travel the 2 degrees through +/-180, never the 358 through 0.
    assert.ok(Math.abs(Math.cos(cam.heading) + 1) < 0.01, `frame ${i}: camera swung through 0 degrees`)
  }
})

test('smoothing is frame-rate independent', () => {
  // Two half steps land exactly where one full step does, for a still target.
  const k = ease(HEADING_RATE, 1 / 30)
  const k2 = ease(HEADING_RATE, 1 / 60)
  near(1 - k, (1 - k2) * (1 - k2), 'remaining fraction', 1e-12)
})

test('the bumper camera is locked to the car, with no position lag', () => {
  const cam = makeRaceCamera()
  stepCamera(cam, 'bumper', car(40, 40, 0), 1 / 60, NOSE)
  const moved = car(45, 41, 0)
  const pose = stepCamera(cam, 'bumper', moved, 1 / 60, NOSE)
  const want = targetPose('bumper', moved, cam.heading, NOSE)
  for (let i = 0; i < 3; i++) near(pose.position[i], want.position[i], `axis ${i}`)
})

test('switching into bumper is a cut; switching into chase eases', () => {
  const into = makeRaceCamera()
  settle(into, 'chase', car(40, 40, 0))
  const bumper = stepCamera(into, 'bumper', car(40, 40, 0), 1 / 60, NOSE)
  const wantB = targetPose('bumper', car(40, 40, 0), into.heading, NOSE)
  near(bumper.position[0], wantB.position[0], 'bumper x is immediate')

  const out = makeRaceCamera()
  settle(out, 'top', car(40, 40, 0))
  const chase = stepCamera(out, 'chase', car(40, 40, 0), 1 / 60, NOSE)
  const wantC = targetPose('chase', car(40, 40, 0), out.heading, NOSE)
  assert.ok(Math.abs(chase.position[1] - wantC.position[1]) > 1, 'chase must ease, not cut')
})

test('the camera settles on a car that is standing still', () => {
  const cam = makeRaceCamera()
  const c = car(30, 50, 1.1)
  const pose = settle(cam, 'chase', c)
  const want = targetPose('chase', c, 1.1, NOSE)
  for (let i = 0; i < 3; i++) near(pose.position[i], want.position[i], `axis ${i}`, 1e-6)
})

test('up is always perpendicular to the view, including through a view switch', () => {
  // three.js lookAt breaks when up is parallel to the view, and top-down looks
  // straight down while chase uses world up. A switch passes through that case.
  const cam = makeRaceCamera()
  settle(cam, 'chase', car(40, 40, 0.9))
  for (let i = 0; i < 180; i++) {
    const pose = stepCamera(cam, i < 90 ? 'top' : 'chase', car(40, 40, 0.9), 1 / 60, NOSE)
    const view = norm(sub(pose.target, pose.position))
    assert.ok(pose.up.every(Number.isFinite), `frame ${i}: up is not finite`)
    near(len(pose.up), 1, `frame ${i}: up length`, 1e-9)
    assert.ok(Math.abs(dot(pose.up, view)) < 1e-9, `frame ${i}: up is not perpendicular to the view`)
  }
})

test('with no car to follow the camera holds still', () => {
  const fresh = makeRaceCamera()
  assert.equal(stepCamera(fresh, 'chase', null, 1 / 60, NOSE), null, 'never placed, so nothing to show')

  const cam = makeRaceCamera()
  const placed = settle(cam, 'chase', car(40, 40, 0))
  for (const missing of [null, undefined, { x: NaN, y: 3 }, { x: 3 }]) {
    const pose = stepCamera(cam, 'chase', missing, 1 / 60, NOSE)
    assert.deepEqual(pose.position, placed.position, `${JSON.stringify(missing)} must not move the camera`)
  }
})

test('a hostile or enormous frame time never overshoots or produces NaN', () => {
  for (const dt of [0, -1, NaN, Infinity, 600]) {
    const cam = makeRaceCamera()
    settle(cam, 'chase', car(10, 10, 0))
    const before = cam.position[0]
    const pose = stepCamera(cam, 'chase', car(80, 10, 0), dt, NOSE)
    const want = targetPose('chase', car(80, 10, 0), cam.heading, NOSE)
    assert.ok(pose.position.every(Number.isFinite), `dt ${dt}: position went non-finite`)
    const lo = Math.min(before, want.position[0])
    const hi = Math.max(before, want.position[0])
    assert.ok(pose.position[0] >= lo - 1e-9 && pose.position[0] <= hi + 1e-9, `dt ${dt}: overshot`)
  }
  assert.ok(MAX_DT > 0 && MAX_DT <= 0.25)
})

test('a missing heading keeps the last one rather than going to NaN', () => {
  const cam = makeRaceCamera()
  settle(cam, 'chase', car(40, 40, 0.5))
  const pose = stepCamera(cam, 'chase', { x: 40, y: 40 }, 1 / 60, NOSE)
  assert.ok(pose.position.every(Number.isFinite))
  near(cam.heading, 0.5, 'heading kept', 1e-6)
})

test('the chase camera sees over any wall more than a little behind the car', () => {
  assert.ok(
    chaseClearance() < CHASE_CLEAR_MAX,
    `walls closer than ${chaseClearance().toFixed(2)} tiles behind the car block the view`,
  )
})

test('views cycle, and an unknown view falls back to the default', () => {
  assert.equal(nextView('top'), 'chase')
  assert.equal(nextView('chase'), 'bumper')
  assert.equal(nextView('bumper'), 'top')
  assert.equal(nextView('garbage'), DEFAULT_VIEW)
  assert.ok(isView(DEFAULT_VIEW))
  assert.ok(!isView('__proto__'))
  assert.equal(VIEWS.length, 3)
})
```

Add `src/lib/raceCamera.test.js` to the `test` script in `package.json`, after `src/lib/followCamera.test.js`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test src/lib/raceCamera.test.js
```

Expected: FAIL, `Cannot find module './raceCamera.js'`.

- [ ] **Step 3: Implement**

Create `src/lib/raceCamera.js`:

```js
// Camera poses and world mapping for Cutline's three views. Pure: no three.js,
// no DOM, no import. Everything here is exercised by raceCamera.test.js.
//
// World axes. Game (x, y) on the ground maps to three.js (x, height, y). Game y
// goes to +z and never -z: -z mirrors the world, so a right-hand steer shows as a
// left turn and the minimap disagrees with the view, and nothing errors.
//
// No prediction. The camera eases toward poses built from snapshots the server
// already sent. It trails them; it never runs ahead of them.

export const VIEWS = ['top', 'chase', 'bumper']
export const DEFAULT_VIEW = 'chase'

export const CAR_ROOF = 0.45

// Top-down. The height is DERIVED from how much track the 2D view showed: at
// field of view f a camera at height h sees 2 * h * tan(f / 2) across.
export const VIEW_CELLS = 22
export const TOP_FOV = 35
export const TOP_HEIGHT = VIEW_CELLS / (2 * Math.tan(((TOP_FOV / 2) * Math.PI) / 180))

export const CHASE_DIST = 5.5
export const CHASE_HEIGHT = 3.0
export const CHASE_LOOK_AHEAD = 3.0
export const CHASE_FOV = 65

export const BUMPER_EYE = 0.55
export const BUMPER_FOV = 75
export const BUMPER_SIGHT = 10

// Walls and the chase camera are one setting: see chaseClearance.
export const WALL_HEIGHT = 1.0
export const CHASE_CLEAR_MAX = 1.5

export const HEADING_RATE = 20
export const TOP_POS_RATE = 25
export const CHASE_POS_RATE = 12
export const FOV_RATE = 10
// A frame longer than this is a tab coming back from the background, not a frame.
export const MAX_DT = 0.1

export const MAX_WHEEL_ANGLE = 0.32
// How high a car rises at the top of a jump, in tiles. Render only.
export const AIR_LIFT = 1.2

export const isView = (v) => VIEWS.includes(v)

export function nextView(view) {
  const i = VIEWS.indexOf(view)
  return i < 0 ? DEFAULT_VIEW : VIEWS[(i + 1) % VIEWS.length]
}

/** Game (x, y) at height h, as a three.js position. */
export const toWorld = (x, y, h = 0) => [x, h, y]

/**
 * The three.js yaw for a model built facing +x. three.js rotates about +y as
 * x' = x cos(a) + z sin(a), z' = -x sin(a) + z cos(a), so a heading h needs -h.
 */
export const yawFor = (heading) => -heading

/**
 * Front wheel yaw for a steer of -1, 0 or 1. In the model the car's right is +z,
 * and a wheel yawed by a points along (cos a, 0, -sin a), so right needs a < 0.
 */
export const wheelYawFor = (steer) => (steer ? -steer * MAX_WHEEL_ANGLE : 0)

/** The shortest signed turn from a to b, in [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Frame-rate independent easing: two half steps equal one full step. */
export const ease = (rate, dt) => 1 - Math.exp(-rate * dt)

const forwardOf = (h) => [Math.cos(h), 0, Math.sin(h)]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/**
 * Where a view wants the camera, for a car at a heading. `nose` is how far ahead
 * of the car's centre the bumper camera sits, passed in by the page as
 * CAR_LENGTH / 2 so this module needs no import.
 */
export function targetPose(view, car, heading, nose) {
  const f = forwardOf(heading)
  const cx = car.x
  const cz = car.y
  if (view === 'top') {
    return { position: [cx, TOP_HEIGHT, cz], target: [cx, 0, cz], fov: TOP_FOV }
  }
  if (view === 'bumper') {
    const ex = cx + f[0] * nose
    const ez = cz + f[2] * nose
    return {
      position: [ex, BUMPER_EYE, ez],
      target: [ex + f[0] * BUMPER_SIGHT, BUMPER_EYE, ez + f[2] * BUMPER_SIGHT],
      fov: BUMPER_FOV,
    }
  }
  return {
    position: [cx - f[0] * CHASE_DIST, CHASE_HEIGHT, cz - f[2] * CHASE_DIST],
    target: [cx + f[0] * CHASE_LOOK_AHEAD, CAR_ROOF, cz + f[2] * CHASE_LOOK_AHEAD],
    fov: CHASE_FOV,
  }
}

/**
 * The camera's up vector, derived from where it is looking so it is always
 * perpendicular to the view. three.js lookAt breaks when up is parallel to the
 * view, and top-down looks straight down while the other views use world up, so
 * any fixed up vector goes degenerate partway through a switch. This is the true
 * up of a camera pitched down by the view's angle and facing its horizontal
 * direction, which is perpendicular by construction. Looking straight down there
 * is no horizontal direction, so the heading supplies it, and screen-up becomes
 * the car's heading, which is what heading-up top-down means.
 */
export function upFor(position, target, heading) {
  const v = norm(sub(target, position))
  const horizontal = Math.hypot(v[0], v[2])
  const f = forwardOf(heading)
  const hdir = norm([v[0] + f[0] * 1e-3, 0, v[2] + f[2] * 1e-3])
  return norm([hdir[0] * -v[1], horizontal, hdir[2] * -v[1]])
}

export function makeRaceCamera() {
  return { ready: false, heading: 0, position: [0, 0, 0], target: [0, 0, 0], fov: CHASE_FOV }
}

const poseOf = (cam) => ({
  position: cam.position.slice(),
  target: cam.target.slice(),
  up: upFor(cam.position, cam.target, cam.heading),
  fov: cam.fov,
})

/**
 * Advance the camera one frame toward the pose its view wants. Returns the pose
 * to apply, or null if the camera has never had a car to place itself on.
 */
export function stepCamera(cam, view, car, dt, nose) {
  const v = isView(view) ? view : DEFAULT_VIEW

  // Nothing to follow: the lobby, a spectator, or a car not yet in a snapshot.
  // Hold where we are rather than going to the origin or to NaN.
  if (!car || !Number.isFinite(car.x) || !Number.isFinite(car.y)) {
    return cam.ready ? poseOf(cam) : null
  }

  const t = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0
  const heading = Number.isFinite(car.heading) ? car.heading : cam.heading

  if (!cam.ready) {
    // First frame: place the camera exactly, rather than easing in from the origin.
    const p = targetPose(v, car, heading, nose)
    cam.heading = heading
    cam.position = p.position.slice()
    cam.target = p.target.slice()
    cam.fov = p.fov
    cam.ready = true
    return poseOf(cam)
  }

  cam.heading += angleDelta(cam.heading, heading) * ease(HEADING_RATE, t)
  // Kept in [-PI, PI] so a long session of turning one way cannot grow it without bound.
  cam.heading = Math.atan2(Math.sin(cam.heading), Math.cos(cam.heading))

  const p = targetPose(v, car, cam.heading, nose)
  if (v === 'bumper') {
    // Locked. Any lag leaves the camera behind the bumper, inside the car. That
    // holds during a switch too, so switching into bumper is a deliberate cut.
    cam.position = p.position.slice()
    cam.target = p.target.slice()
  } else {
    const k = ease(v === 'top' ? TOP_POS_RATE : CHASE_POS_RATE, t)
    cam.position = lerp3(cam.position, p.position, k)
    cam.target = lerp3(cam.target, p.target, k)
  }
  cam.fov += (p.fov - cam.fov) * ease(FOV_RATE, t)
  return poseOf(cam)
}

/**
 * How far behind the car a wall must be before the chase camera sees over it.
 * The sightline from camera to roof stands at
 * CAR_ROOF + (CHASE_HEIGHT - CAR_ROOF) * (d / CHASE_DIST) at distance d behind
 * the car, so it clears WALL_HEIGHT once d exceeds this. Raise WALL_HEIGHT or
 * lower CHASE_HEIGHT and a player loses sight of their car in a hairpin.
 */
export function chaseClearance() {
  return ((WALL_HEIGHT - CAR_ROOF) / (CHASE_HEIGHT - CAR_ROOF)) * CHASE_DIST
}
```

- [ ] **Step 4: Run the tests, then prove two of them discriminate**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test src/lib/raceCamera.test.js
npm test
```

Expected: PASS.

Then prove the two most important tests are not hollow:
1. Temporarily change `toWorld` to return `[x, h, -y]`. Confirm the top-down handedness test fails. Restore.
2. Temporarily replace `angleDelta` with `(a, b) => b - a`. Confirm the shortest-arc test fails. Restore.

Put both failing outputs in your report.

- [ ] **Step 5: Commit**

```bash
git add src/lib/raceCamera.js src/lib/raceCamera.test.js package.json
git commit -m "feat(cutline): pure camera poses and world mapping for three views"
```

---

## Task 2: `wallBlocks.js`, the walls worth drawing

**Files:**
- Create: `src/lib/wallBlocks.js`
- Create: `src/lib/wallBlocks.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing. The test imports `server/cutline.js` for real circuits; the module itself takes the grid, its size and the wall value as arguments.
- Produces: `wallBlocks(grid, size, wall) -> Array<{ x, y }>`.

**Why 8-way adjacency.** Only walls bordering the road are drawn. With 4-way adjacency, a wall tile that touches the road only diagonally is skipped, which leaves a hole at every convex corner. Measured across all eight circuits that is 1,039 holes you could see straight through. With 8-way adjacency there are 548 to 1,043 boxes per circuit.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/wallBlocks.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { wallBlocks } from './wallBlocks.js'
import { CIRCUITS, carve, GRID, S_WALL } from '../../server/cutline.js'

// Headroom over the measured maximum of 1,043, so a regression that boxes every
// wall tile (up to 6,600) fails loudly.
const WALL_BOX_CEILING = 1200

const roadAt = (grid, x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && grid[y * GRID + x] !== S_WALL
const touchesRoad = (grid, x, y) => {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && roadAt(grid, x + dx, y + dy)) return true
    }
  }
  return false
}

test('a small grid gets exactly the walls around its road, corners included', () => {
  // 5 by 5, one road tile in the middle: all 8 neighbours are walls that touch it.
  const W = 0
  const R = 1
  const g = new Uint8Array(25).fill(W)
  g[2 * 5 + 2] = R
  const got = wallBlocks(g, 5, W).map((b) => `${b.x},${b.y}`).sort()
  const want = ['1,1', '2,1', '3,1', '1,2', '3,2', '1,3', '2,3', '3,3'].sort()
  assert.deepEqual(got, want, 'the diagonal corners must be boxed, or the ring has holes')
})

test('every wall touching the road is boxed, and nothing else', () => {
  for (const circuit of CIRCUITS) {
    const { grid } = carve(circuit.seed)
    const boxes = wallBlocks(grid, GRID, S_WALL)
    const boxed = new Set(boxes.map((b) => b.y * GRID + b.x))

    for (const b of boxes) {
      assert.equal(grid[b.y * GRID + b.x], S_WALL, `${circuit.name}: a box sits on the road at ${b.x},${b.y}`)
      assert.ok(touchesRoad(grid, b.x, b.y), `${circuit.name}: a box is buried in solid wall at ${b.x},${b.y}`)
    }
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (grid[y * GRID + x] === S_WALL && touchesRoad(grid, x, y)) {
          assert.ok(boxed.has(y * GRID + x), `${circuit.name}: a wall beside the road at ${x},${y} is missing`)
        }
      }
    }
    assert.ok(boxes.length <= WALL_BOX_CEILING, `${circuit.name}: ${boxes.length} boxes`)
  }
})

test('a grid with no road produces no walls', () => {
  assert.deepEqual(wallBlocks(new Uint8Array(16), 4, 0), [])
})
```

Add `src/lib/wallBlocks.test.js` to the `test` script, after `src/lib/raceCamera.test.js`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test src/lib/wallBlocks.test.js
```

Expected: FAIL, `Cannot find module './wallBlocks.js'`.

- [ ] **Step 3: Implement**

Create `src/lib/wallBlocks.js`:

```js
// The wall tiles worth drawing in 3D. Pure and import-free: the grid, its size
// and the value that means wall are passed in. Exercised by wallBlocks.test.js.
//
// Only walls beside the road are drawn, which is 548 to 1,043 boxes per circuit
// out of up to 6,600 wall tiles. Adjacency is 8-way: at 4-way, a wall that meets
// the road only at a corner is skipped, and every convex corner of the circuit
// gets a hole you can see through. Measured, that was 1,039 holes.

export function wallBlocks(grid, size, wall) {
  const road = (x, y) => x >= 0 && y >= 0 && x < size && y < size && grid[y * size + x] !== wall
  const out = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x] !== wall) continue
      let beside = false
      for (let dy = -1; dy <= 1 && !beside; dy++) {
        for (let dx = -1; dx <= 1 && !beside; dx++) {
          if ((dx || dy) && road(x + dx, y + dy)) beside = true
        }
      }
      if (beside) out.push({ x, y })
    }
  }
  return out
}
```

- [ ] **Step 4: Run the tests, then prove the corner test discriminates**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test src/lib/wallBlocks.test.js && npm test
```

Temporarily restrict the neighbourhood to 4-way (`dx === 0 || dy === 0`). Confirm the small-grid test fails on the missing diagonal corners. Restore, and put the output in your report.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallBlocks.js src/lib/wallBlocks.test.js package.json
git commit -m "feat(cutline): pick the wall tiles worth drawing, corners included"
```

---

## Task 3: Load Cutline lazily, and guard the bundle

Done before the page imports three.js, so there is never a commit where three.js sits in the main chunk.

**Files:**
- Create: `scripts/check-bundle.mjs`
- Modify: `src/App.jsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run check:bundle`, and `LoadingRoute` / `RouteLoadError` components taking a `title`.

- [ ] **Step 1: Write the check first**

Create `scripts/check-bundle.mjs`:

```js
// Fails if three.js is in the chunk every page loads. Run after `npm run build`.
//
// three.js is ~570 KB. Blockout Royale 3D and Cutline are lazy routes so the
// marketing pages never download it; importing either eagerly would quietly
// add it to every page and nothing else would notice.
//
// The marker is a string three.js keeps through minification. The check also
// requires it to appear in SOME chunk: if a future three.js drops the string,
// this fails loudly instead of passing forever.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const MARKER = 'THREE.WebGLRenderer'

let html
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf8')
} catch {
  console.error('check-bundle: no dist/index.html. Run `npm run build` first.')
  process.exit(1)
}

const entry = html.match(/src="\/(assets\/[^"]+\.js)"/)?.[1]
if (!entry) {
  console.error('check-bundle: could not find the entry script in dist/index.html.')
  process.exit(1)
}

const chunks = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js'))
const withThree = chunks.filter((f) => readFileSync(join(DIST, 'assets', f), 'utf8').includes(MARKER))

if (withThree.length === 0) {
  console.error(`check-bundle: no chunk contains "${MARKER}". The marker no longer identifies three.js; update it.`)
  process.exit(1)
}
if (withThree.includes(entry.replace('assets/', ''))) {
  console.error(`check-bundle: three.js is in the main chunk ${entry}. Every page now downloads it.`)
  process.exit(1)
}
console.log(`check-bundle: ok. three.js only in ${withThree.join(', ')}`)
```

Add to `package.json` scripts:

```json
    "check:bundle": "node scripts/check-bundle.mjs",
```

- [ ] **Step 2: Run it against the current build**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run build && npm run check:bundle
```

Expected: PASS today, three.js only in the Blockout 3D chunk.

Then prove it catches the failure it exists for: temporarily add `import * as THREE from 'three'; console.log(THREE.REVISION)` to `src/main.jsx`, rebuild, confirm `check:bundle` FAILS naming the main chunk, remove the lines, rebuild, confirm it passes.

- [ ] **Step 3: Make Cutline a lazy route**

In `src/App.jsx`, replace `import Cutline from './pages/Cutline.jsx'` with a lazy import beside Blockout 3D's, and update the comment, which says Blockout 3D is the only such route:

```jsx
// The routes that pull in three.js. Split on their own so the marketing pages,
// everything else in this app, never pay for a renderer they never mount.
// `npm run check:bundle` fails if three.js ever reaches the main chunk.
const Blockout3D = lazy(() => import('./pages/Blockout3D.jsx'))
const Cutline = lazy(() => import('./pages/Cutline.jsx'))
```

Generalise the loading card and error boundary. Their copy currently names Blockout Royale 3D:

```jsx
function LoadingRoute({ title, line }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <p className="rule-label">{title}</p>
      <p className="display mt-2 text-2xl">{line}</p>
    </div>
  )
}

// React.lazy only covers the pending state; a chunk 404 after a redeploy throws
// during render, and with no boundary above it React unmounts the whole tree,
// not just this route. Scoped to one route, so the failure stays a card in the
// play area and the nav and every other page keep working.
class RouteLoadError extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <p className="rule-label">{this.props.title}</p>
        <h1 className="display mt-2 text-2xl">{this.props.headline}</h1>
        <p className="mt-4 leading-relaxed text-muted">
          A newer version of the site shipped while this tab was open. Reload
          to pick it up.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
        >
          Reload
        </button>
      </div>
    )
  }
}
```

Wrap both routes. Blockout 3D keeps its exact existing copy:

```jsx
        <Route
          path="play/cutline"
          element={
            <RouteLoadError title="Cutline" headline="The circuit did not load">
              <Suspense fallback={<LoadingRoute title="Cutline" line="Loading the circuit…" />}>
                <Cutline />
              </Suspense>
            </RouteLoadError>
          }
        />
        <Route
          path="play/blockout-royale-3d"
          element={
            <RouteLoadError title="Blockout Royale 3D" headline="The stack did not load">
              <Suspense fallback={<LoadingRoute title="Blockout Royale 3D" line="Loading the stack…" />}>
                <Blockout3D />
              </Suspense>
            </RouteLoadError>
          }
        />
```

Delete the old `LoadingStack` and `StackLoadError`.

- [ ] **Step 4: Verify**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run build && npm run check:bundle && npm test
```

Expected: build clean, check passes, suite passes. Confirm `dist/assets/` now has a separate `Cutline-*.js` chunk.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-bundle.mjs src/App.jsx package.json
git commit -m "feat(site): load Cutline lazily and fail the build check if three.js reaches the main chunk"
```

---

## Task 4: The scene, part one: renderer, ground, walls, camera

A scene that can show an empty circuit and fly a camera over it. Cars and objects come in Task 5.

**Files:**
- Create: `src/lib/cutlineScene.js`

**Interfaces:**
- Consumes: `toWorld`, `WALL_HEIGHT` from `raceCamera.js`; `GRID` from `server/cutline.js`.
- Produces: `makeCutlineScene(canvas) -> { maxTextureSize, setTrack(groundCanvas, wallBoxes), update(frame), project(x, y, h), resize(w, h), stats(), dispose() }`. `frame` is `{ pose }` in this task; Task 5 extends it.

No unit tests: this module is three.js and a GPU. Its maths lives in `raceCamera.js`. Verified by building and, in Task 6, by running it.

**Ground alignment.** Physics puts tile `x` at `[x - 0.5, x + 0.5]`, because `surfaceAt` rounds. The plane therefore spans `[-0.5, GRID - 0.5]` on both axes. The 2D renderer drew each tile at `[x, x + 1]`, half a tile from where the physics put it; this corrects that as a side effect.

**Texture orientation.** A `PlaneGeometry` lies in xy facing +z. Rotated by `-PI / 2` about x, local +y maps to world -z. With `CanvasTexture`'s default `flipY`, the canvas's top row lands at the small-z end of the plane, which is game `y = 0`. That matches the `y -> +z` mapping, so the ground is not mirrored.

- [ ] **Step 1: Implement**

Create `src/lib/cutlineScene.js`:

```js
// The three.js scene for Cutline. It draws what the server sent and nothing else:
// no rule, no simulation, no prediction. Every piece of maths worth testing, the
// axis mapping, car orientation and the camera, lives in raceCamera.js.
//
// Nothing here loads a file. Models are three.js primitives and the ground is a
// canvas drawn in code, so the first frame never waits on the network.
import * as THREE from 'three'
import { GRID } from '../../server/cutline.js'
import { toWorld, WALL_HEIGHT } from './raceCamera.js'

function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function makeCutlineScene(canvas) {
  // Throws where WebGL is unavailable. The page catches it and says so.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(token('--bg', '#0b0b0d'))
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400)

  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const sun = new THREE.DirectionalLight(0xffffff, 0.85)
  sun.position.set(30, 60, 20)
  scene.add(sun)

  const wallGeo = new THREE.BoxGeometry(1, WALL_HEIGHT, 1)
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x2a2a31 })
  const scratch = new THREE.Object3D()
  const probe = new THREE.Vector3()

  let groundTex = null
  let groundGeo = null
  let groundMat = null
  let ground = null
  let walls = null

  function disposeTrack() {
    if (ground) scene.remove(ground)
    if (walls) scene.remove(walls)
    groundTex?.dispose()
    groundGeo?.dispose()
    groundMat?.dispose()
    walls?.dispose()
    groundTex = groundGeo = groundMat = ground = walls = null
  }

  return {
    /** The largest texture this GPU takes, so the page can pick a ground resolution. */
    maxTextureSize: renderer.capabilities.maxTextureSize,

    /**
     * Build a circuit. A new circuit arrives on every restart, so the old one is
     * disposed first: a texture and a mesh per race that are never freed is GPU
     * memory that grows until the tab dies.
     */
    setTrack(groundCanvas, wallBoxes) {
      disposeTrack()

      groundTex = new THREE.CanvasTexture(groundCanvas)
      groundTex.colorSpace = THREE.SRGBColorSpace
      groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      groundGeo = new THREE.PlaneGeometry(GRID, GRID)
      groundMat = new THREE.MeshLambertMaterial({ map: groundTex })
      ground = new THREE.Mesh(groundGeo, groundMat)
      ground.rotation.x = -Math.PI / 2
      // Tile x spans [x - 0.5, x + 0.5], matching the physics.
      ground.position.set(GRID / 2 - 0.5, 0, GRID / 2 - 0.5)
      scene.add(ground)

      walls = new THREE.InstancedMesh(wallGeo, wallMat, Math.max(1, wallBoxes.length))
      wallBoxes.forEach((b, i) => {
        scratch.position.set(...toWorld(b.x, b.y, WALL_HEIGHT / 2))
        scratch.updateMatrix()
        walls.setMatrixAt(i, scratch.matrix)
      })
      walls.count = wallBoxes.length
      walls.instanceMatrix.needsUpdate = true
      scene.add(walls)
    },

    /** Apply a camera pose and draw one frame. */
    update(frame) {
      const pose = frame?.pose
      if (pose) {
        camera.position.set(...pose.position)
        // up before lookAt: lookAt reads it.
        camera.up.set(...pose.up)
        camera.lookAt(...pose.target)
        if (camera.fov !== pose.fov) {
          camera.fov = pose.fov
          camera.updateProjectionMatrix()
        }
      }
      renderer.render(scene, camera)
    },

    /**
     * Where a game point lands on the canvas, as fractions of its width and
     * height, so the overlay can place labels at any size or pixel ratio.
     * `visible` is false behind the camera or beyond the far plane.
     */
    project(x, y, h = 0) {
      probe.set(...toWorld(x, y, h)).project(camera)
      return {
        fx: (probe.x + 1) / 2,
        fy: (1 - probe.y) / 2,
        visible: probe.z > -1 && probe.z < 1,
      }
    },

    resize(w, h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    },

    /** GPU objects alive right now, for spotting a leak across restarts. */
    stats() {
      return { ...renderer.info.memory }
    },

    /**
     * Release everything. forceContextLoss matters: renderer.dispose() alone does
     * not free the WebGL context, browsers cap live contexts at around 16, and
     * navigating to Cutline and away repeatedly would eventually have the browser
     * silently kill the oldest one.
     */
    dispose() {
      disposeTrack()
      wallGeo.dispose()
      wallMat.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
```

- [ ] **Step 2: Verify it builds**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run build && npm run check:bundle
```

Nothing imports the scene yet, so the check still passes. Running it waits for Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cutlineScene.js
git commit -m "feat(cutline): three.js scene with the prerendered ground and road walls"
```

---

## Task 5: The scene, part two: cars, pickups, hazards, skids

**Files:**
- Modify: `src/lib/cutlineScene.js`

**Interfaces:**
- Consumes: `yawFor`, `wheelYawFor`, `CAR_ROOF`, `AIR_LIFT`, `toWorld` from `raceCamera.js`; `CAR_LENGTH`, `CAR_WIDTH`, `MAX_PLAYERS` from `server/cutline.js`.
- Produces: `update(frame)` now also takes `{ cars, hazards, pickups, skids, palette, hideId, now }`.

Car dimensions come from the same `CAR_LENGTH` and `CAR_WIDTH` the hitbox derives from, so the car you see and the car you hit stay the same size.

- [ ] **Step 1: Implement**

Extend the imports:

```js
import { GRID, CAR_LENGTH, CAR_WIDTH, MAX_PLAYERS } from '../../server/cutline.js'
import { toWorld, yawFor, wheelYawFor, WALL_HEIGHT, CAR_ROOF, AIR_LIFT } from './raceCamera.js'
```

Add, at module level:

```js
const MAX_PICKUPS = 64
const MAX_HAZARDS = 32   // the server caps at 16; this is headroom, not a rule
const MAX_SKIDS = 500    // the cap the 2D renderer used

/** One car, built facing +x. Returns the parts update() needs to move. */
function buildCar(shared) {
  const paint = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true })
  const brake = new THREE.MeshBasicMaterial({ color: 0x3a0b0b })
  const group = new THREE.Group()

  const body = new THREE.Mesh(shared.body, paint)
  body.position.y = 0.2
  const cabin = new THREE.Mesh(shared.cabin, shared.glass)
  cabin.position.set(-CAR_LENGTH * 0.05, CAR_ROOF - 0.1, 0)
  group.add(body, cabin)

  const front = []
  for (const [fx, fz] of [
    [0.31, -0.46], [0.31, 0.46], [-0.31, -0.46], [-0.31, 0.46],
  ]) {
    const wheel = new THREE.Mesh(shared.wheel, shared.tyre)
    const pivot = new THREE.Group()
    pivot.position.set(CAR_LENGTH * fx, 0.14, CAR_WIDTH * fz)
    pivot.add(wheel)
    group.add(pivot)
    if (fx > 0) front.push(pivot)
  }

  for (const fz of [-0.3, 0.3]) {
    const head = new THREE.Mesh(shared.lamp, shared.headlight)
    head.position.set(CAR_LENGTH / 2, 0.22, CAR_WIDTH * fz)
    const tail = new THREE.Mesh(shared.lamp, brake)
    tail.position.set(-CAR_LENGTH / 2, 0.22, CAR_WIDTH * fz)
    group.add(head, tail)
  }

  // The shadow stays on the ground while the car rises, so it is a sibling of
  // the car rather than a child that would be lifted with it.
  const shadow = new THREE.Mesh(shared.shadow, shared.shadowMat)
  shadow.rotation.x = -Math.PI / 2

  return { group, shadow, paint, brake, front, slot: -1 }
}
```

Inside `makeCutlineScene`, after the lights, build the shared geometry, the car pool and the instanced layers:

```js
  const shared = {
    body: new THREE.BoxGeometry(CAR_LENGTH, 0.22, CAR_WIDTH),
    cabin: new THREE.BoxGeometry(CAR_LENGTH * 0.45, 0.2, CAR_WIDTH * 0.8),
    wheel: new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12).rotateX(Math.PI / 2),
    lamp: new THREE.BoxGeometry(0.05, 0.08, 0.12),
    shadow: new THREE.CircleGeometry(CAR_LENGTH * 0.55, 20),
    glass: new THREE.MeshLambertMaterial({ color: 0x14141a }),
    tyre: new THREE.MeshLambertMaterial({ color: 0x111114 }),
    headlight: new THREE.MeshBasicMaterial({ color: 0xfff5d6 }),
    shadowMat: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  }
  const pool = Array.from({ length: MAX_PLAYERS }, () => {
    const c = buildCar(shared)
    c.group.visible = false
    c.shadow.visible = false
    scene.add(c.group, c.shadow)
    return c
  })

  const pickupGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55)
  const pickupMat = new THREE.MeshLambertMaterial({ color: 0x3ad1c4 })
  const pickups = new THREE.InstancedMesh(pickupGeo, pickupMat, MAX_PICKUPS)
  pickups.count = 0
  scene.add(pickups)

  const slickGeo = new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2)
  const slickMat = new THREE.MeshBasicMaterial({ color: 0x09090c, transparent: true, opacity: 0.8 })
  const slicks = new THREE.InstancedMesh(slickGeo, slickMat, MAX_HAZARDS)
  slicks.count = 0
  const peelGeo = new THREE.TorusGeometry(0.22, 0.07, 6, 12, Math.PI).rotateX(-Math.PI / 2)
  const peelMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 })
  const peels = new THREE.InstancedMesh(peelGeo, peelMat, MAX_HAZARDS)
  peels.count = 0
  // An unknown hazard kind draws as this rather than as nothing, so a kind added
  // to the server shows up wrong instead of invisible.
  const unknownGeo = new THREE.OctahedronGeometry(0.35)
  const unknownMat = new THREE.MeshBasicMaterial({ color: 0xff00ff })
  const unknowns = new THREE.InstancedMesh(unknownGeo, unknownMat, MAX_HAZARDS)
  unknowns.count = 0
  scene.add(slicks, peels, unknowns)

  // InstancedMesh has no per-instance opacity, so skids are one fixed shade and
  // simply expire. The page drops them after 3.5s, as the 2D renderer did.
  const skidGeo = new THREE.PlaneGeometry(0.16, 0.16).rotateX(-Math.PI / 2)
  const skidMat = new THREE.MeshBasicMaterial({ color: 0x0c0c10, transparent: true, opacity: 0.45 })
  const skids = new THREE.InstancedMesh(skidGeo, skidMat, MAX_SKIDS)
  skids.count = 0
  scene.add(skids)

  function place(mesh, i, x, y, h, yaw = 0) {
    scratch.position.set(...toWorld(x, y, h))
    scratch.rotation.set(0, yaw, 0)
    scratch.updateMatrix()
    mesh.setMatrixAt(i, scratch.matrix)
  }
```

Replace the body of `update(frame)` so it moves every object, then applies the camera and renders:

```js
    update(frame) {
      const now = frame?.now ?? 0
      const cars = frame?.cars ?? []
      const palette = frame?.palette ?? []

      for (let i = 0; i < pool.length; i++) {
        const c = pool[i]
        const car = cars[i]
        const show = Boolean(car) && car.id !== frame?.hideId
        c.group.visible = show
        c.shadow.visible = show
        if (!show) continue

        if (c.slot !== car.slot) {
          c.paint.color.set(palette[car.slot % palette.length] ?? '#ffffff')
          c.slot = car.slot
        }
        c.paint.opacity = car.alive ? 1 : 0.35

        const lift = car.airborne ? Math.sin((car.airT ?? 0) * Math.PI) * AIR_LIFT : 0
        c.group.position.set(...toWorld(car.x, car.y, lift))
        c.group.rotation.y = yawFor(car.heading)
        for (const w of c.front) w.rotation.y = wheelYawFor(car.steer ?? 0)
        c.brake.color.set(car.brake ? 0xff3030 : 0x3a0b0b)
        c.shadow.position.set(...toWorld(car.x, car.y, 0.01))
      }

      const ps = frame?.pickups ?? []
      pickups.count = Math.min(ps.length, MAX_PICKUPS)
      for (let i = 0; i < pickups.count; i++) {
        const p = ps[i]
        place(pickups, i, p.x, p.y, 0.55 + Math.sin(now / 300 + p.x) * 0.12, now / 700 + p.y)
      }
      pickups.instanceMatrix.needsUpdate = true

      let s = 0
      let b = 0
      let u = 0
      for (const h of frame?.hazards ?? []) {
        if (h.kind === 'slick' && s < MAX_HAZARDS) place(slicks, s++, h.x, h.y, 0.02)
        else if (h.kind === 'banana' && b < MAX_HAZARDS) place(peels, b++, h.x, h.y, 0.08)
        else if (u < MAX_HAZARDS) place(unknowns, u++, h.x, h.y, 0.4, now / 400)
      }
      slicks.count = s
      peels.count = b
      unknowns.count = u
      slicks.instanceMatrix.needsUpdate = true
      peels.instanceMatrix.needsUpdate = true
      unknowns.instanceMatrix.needsUpdate = true

      const sk = frame?.skids ?? []
      skids.count = Math.min(sk.length, MAX_SKIDS)
      for (let i = 0; i < skids.count; i++) place(skids, i, sk[i].x, sk[i].y, 0.005)
      skids.instanceMatrix.needsUpdate = true

      const pose = frame?.pose
      if (pose) {
        camera.position.set(...pose.position)
        camera.up.set(...pose.up)
        camera.lookAt(...pose.target)
        if (camera.fov !== pose.fov) {
          camera.fov = pose.fov
          camera.updateProjectionMatrix()
        }
      }
      renderer.render(scene, camera)
    },
```

Extend `dispose()` to free what this task added, before `renderer.dispose()`:

```js
      for (const c of pool) {
        c.paint.dispose()
        c.brake.dispose()
      }
      for (const g of [shared.body, shared.cabin, shared.wheel, shared.lamp, shared.shadow]) g.dispose()
      for (const m of [shared.glass, shared.tyre, shared.headlight, shared.shadowMat]) m.dispose()
      for (const mesh of [pickups, slicks, peels, unknowns, skids]) mesh.dispose()
      for (const g of [pickupGeo, slickGeo, peelGeo, unknownGeo, skidGeo]) g.dispose()
      for (const m of [pickupMat, slickMat, peelMat, unknownMat, skidMat]) m.dispose()
```

- [ ] **Step 2: Verify it builds**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run build && npm run check:bundle && npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/cutlineScene.js
git commit -m "feat(cutline): 3D cars, pickups, hazards and skid marks"
```

---

## Task 6: Put the scene in the page

The largest task. The 2D world renderer is deleted and the scene takes over. The camera view is fixed to `DEFAULT_VIEW` here; Task 7 adds the toggle.

**Files:**
- Modify: `src/pages/Cutline.jsx`

**Interfaces:**
- Consumes: `makeCutlineScene` (Tasks 4 and 5), `makeRaceCamera`, `stepCamera`, `DEFAULT_VIEW`, `CAR_ROOF` (Task 1), `wallBlocks` (Task 2), `CAR_LENGTH`, `GRID`, `S_WALL` from `server/cutline.js`.
- Produces: a `viewRef` holding the current view, read by the render loop, which Task 7 drives.

Read `src/pages/Cutline.jsx` in full before editing. The render loop is one function inside a `useEffect`, divided by comments: `--- 1. Follow Camera & Heading-Up Orientation`, `--- 2. Render World Inside Rotated & Translated Camera Transform`, `3a` to `3d` (skids, hazards, pickups, cars), `--- 3. Screen Space UI Elements`, `--- 4. Top-Right Minimap`, `--- 5. Non-Racing Overlay Banners`.

- [ ] **Step 1: Two canvases in one container**

Replace the single `<canvas ref={canvasRef} ... />` with a container holding the WebGL canvas and a 2D overlay above it. Both fill the same box, so they can never drift apart when the page resizes:

```jsx
          <div ref={stageRef} className="relative w-full max-w-[768px] aspect-square border border-line bg-bg">
            <canvas
              ref={glRef}
              role="img"
              aria-label={`Cutline circuit. ${statusLine(hud, myId)}`}
              className="absolute inset-0 h-full w-full select-none"
            />
            <canvas
              ref={overlayRef}
              width={CANVAS}
              height={CANVAS}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            {webglFailed && (
              <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                <p className="leading-relaxed text-muted">
                  This race needs WebGL, and this browser has it turned off or does
                  not support it.
                </p>
              </div>
            )}
          </div>
```

The overlay keeps its 768 by 768 drawing buffer, so the existing minimap and banner code, which is written in those coordinates, keeps working unchanged.

Add the refs and state: `stageRef`, `glRef`, `overlayRef`, `sceneRef`, `camRef = useRef(makeRaceCamera())`, `viewRef = useRef(DEFAULT_VIEW)`, `gridRef`, `trackVersionRef` (a number), `builtVersionRef`, and `const [webglFailed, setWebglFailed] = useState(false)`. `overlayRef` replaces `canvasRef`: the render loop's `canvas` and `ctx` now come from the overlay. Delete the page's own `const VIEW_CELLS = 22` and import `VIEW_CELLS` from `raceCamera.js` instead (same value, one definition); the overlay still uses `u = CANVAS / VIEW_CELLS` as its pixel scale for margins.

- [ ] **Step 2: Scene lifecycle**

A `useEffect` that creates the scene once the socket is live, keeps it sized to its container, and releases it on unmount:

```jsx
  useEffect(() => {
    if (status !== 'live' || !glRef.current || !stageRef.current) return
    let scene
    try {
      scene = makeCutlineScene(glRef.current)
    } catch {
      setWebglFailed(true)
      return
    }
    sceneRef.current = scene
    builtVersionRef.current = -1 // force the current circuit to build on this scene

    const stage = stageRef.current
    const fit = () => scene.resize(stage.clientWidth, stage.clientHeight)
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(stage)

    return () => {
      watch.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [status])
```

- [ ] **Step 3: Build the circuit once the scene can say how large a texture it takes**

`prerender` gains a tile-resolution parameter, and every use of `TILE_RES` inside it becomes that parameter:

```js
function prerender(map, tileRes = TILE_RES) {
  const off = document.createElement('canvas')
  off.width = GRID * tileRes
  off.height = GRID * tileRes
  // ... unchanged, with T = tileRes
```

In the `welcome` handler, stop prerendering immediately. Store the grid and bump a version, because the scene may not exist yet when `welcome` arrives:

```js
        gridRef.current = decode(msg.circuit?.map ?? '')
        trackVersionRef.current += 1
```

At the top of the render loop, build the circuit when a new one has arrived and the scene exists:

```js
      const scene = sceneRef.current
      if (scene && gridRef.current && builtVersionRef.current !== trackVersionRef.current) {
        // 32 pixels a tile is 3072 square, 36 MB. WebGL2 only guarantees 2048,
        // so a GPU that cannot take it gets 16 pixels a tile and looks softer
        // rather than failing to draw.
        const tileRes = scene.maxTextureSize >= GRID * TILE_RES ? TILE_RES : TILE_RES / 2
        const ground = prerender(gridRef.current, tileRes)
        trackCanvasRef.current = ground // the minimap draws from the same canvas
        scene.setTrack(ground, wallBlocks(gridRef.current, GRID, S_WALL))
        builtVersionRef.current = trackVersionRef.current
      }
```

- [ ] **Step 4: Replace the world renderer**

In section `1`, keep `me`, `aliveCars`, `leaderCar`, `focusCar`, `focusX`, `focusY`, `focusHeading` (the minimap's wedge reads the last three) and `u`. Delete `screenX`, `screenY` and `camRot`. Delete section `2` and the drawing in `3a` to `3d`: the rotated world transform and the 2D drawing of the track blit, skids, hazards, pickups, headlights and cars. Keep the skid **bookkeeping** from `3a`, the part that pushes points for sliding cars and drops them after 3.5s, and delete only its drawing.

Replace the frame's opening `fillStyle` and `fillRect` with `ctx.clearRect(0, 0, CANVAS, CANVAS)`. Replace the `if (!sampled)` branch's fixed-camera track blit with a bare render, which shows the background until the first snapshot lands a moment later:

```js
      if (!sampled) {
        sceneRef.current?.update({ now, pose: null })
        rafId = requestAnimationFrame(frame)
        return
      }
```

In their place, step the camera and hand the frame to the scene:

```js
      const dt = (now - (lastFrameRef.current || now)) / 1000
      lastFrameRef.current = now
      const pose = stepCamera(camRef.current, viewRef.current, focusCar, dt, CAR_LENGTH / 2)
      scene?.update({
        cars,
        hazards: sampled.hazards ?? [],
        pickups: sampled.pickups ?? [],
        skids: skidsRef.current,
        palette,
        now,
        pose,
        // The car the camera rides on is hidden in the bumper view, where it
        // would fill the screen. That is the leader's car while spectating.
        hideId: viewRef.current === 'bumper' ? focusCar?.id : null,
      })
```

Add `lastFrameRef = useRef(0)`. Keep the existing `focusCar` and `leaderCar` logic, which picks the car the camera follows.

- [ ] **Step 5: The overlay, reprojected**

The overlay is a 2D context on `overlayRef`, 768 by 768. Clear it each frame with `clearRect`, not a fill, so the 3D view shows through.

Two things in the old overlay computed screen positions from the deleted 2D camera, and must use `scene.project` instead:

1. **The "YOU" marker.** Replace `screenX` and `screenY` with a projection of the player's car:

```js
      const at = me && scene ? scene.project(me.x, me.y, CAR_ROOF + 0.9) : null
      if (me && me.alive && at?.visible) {
        const screenX = at.fx * CANVAS
        const screenY = at.fy * CANVAS
        // ... the existing marker drawing, unchanged
      }
```

Keep the existing `bob`, and set `indicatorY = screenY + bob`: the projection already sits above the roof, so the old `- u * 1.25` offset is not needed. In the bumper view your car is hidden and the projection lands at or behind the camera, so `visible` is false and the marker is simply not drawn.

2. **The minimap fade**, which dims the minimap when a car passes under it. Replace the `cosCam` / `sinCam` rotation with a projection:

```js
      const behindMap = cars.some((c) => {
        if (!c.alive || !scene) return false
        const p = scene.project(c.x, c.y, CAR_ROOF)
        if (!p.visible) return false
        const sx = p.fx * CANVAS
        const sy = p.fy * CANVAS
        return sx > mmX - nearMap && sx < mmX + mmW + nearMap && sy > mmY - nearMap && sy < mmY + mmH + nearMap
      })
```

The rest of the minimap, the banners and the HUD stay as they are.

- [ ] **Step 6: Number and status for every car**

Status is never carried by colour alone. The 2D view drew each car's number on the car and showed boosting, drafting, sliding, spinning and airborne as visual effects. In 3D, draw them as upright overlay text above each visible car:

```js
      for (const c of cars) {
        if (!scene || (viewRef.current === 'bumper' && c.id === focusCar?.id)) continue
        const p = scene.project(c.x, c.y, CAR_ROOF + 0.55)
        if (!p.visible) continue
        const tags = [
          c.boosting && 'BOOST',
          c.drafting && 'DRAFT',
          c.sliding && 'SLIDE',
          c.spinning && 'SPIN',
          c.airborne && 'AIR',
          !c.alive && 'OUT',
        ].filter(Boolean)
        const x = p.fx * CANVAS
        const y = p.fy * CANVAS
        overlay.font = 'bold 12px monospace'
        overlay.textAlign = 'center'
        overlay.fillStyle = 'rgba(11, 11, 13, 0.8)'
        overlay.fillRect(x - 14, y - 16, 28, 14)
        overlay.fillStyle = '#ffffff'
        overlay.fillText(String(c.place ?? c.slot + 1), x, y - 5)
        if (tags.length) {
          overlay.font = 'bold 9px monospace'
          overlay.fillText(tags.join(' '), x, y + 8)
        }
      }
```

- [ ] **Step 7: Run it**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test && npm run build && npm run check:bundle
```

Then run the game. **Check nothing else holds port 8088 first**, because a stale match server answers on old code and makes the check meaningless:

```bash
netstat -ano | grep 8088
npm run cutline      # one shell
npm run dev          # another
```

Open `http://localhost:5173/play/cutline`, enter the grid, start with bots, and check each of these, reporting on each:

- The circuit appears with walls standing up beside the road, and matches the minimap. **A left-hand corner on the minimap is a left-hand corner in the view.**
- Steering right turns the car right and its front wheels to the right.
- Cars drive along the painted road without a half-tile offset.
- A jump lifts the car with its shadow staying on the ground.
- Every car shows its number, and its status words when boosting, drafting, sliding, spinning or airborne.
- **Review Focus 1, restarts do not leak:** in the browser console, read `stats()` after the first race, let three races restart, read it again. `textures` and `geometries` must return to the same counts, not climb. Expose it for the check with a temporary `window.__cutline = sceneRef` and remove it before committing.
- **Review Focus 2, contexts are released:** navigate to the home page and back to Cutline twenty times. No `Too many active WebGL contexts` warning may appear in the console.
- **Review Focus 5, resize keeps labels on cars:** resize the window narrow and wide. The number labels must stay above their cars.
- The home page network panel requests no three.js chunk.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Cutline.jsx
git commit -m "feat(cutline): render the race in 3D, with the HUD and minimap over it"
```

---

## Task 7: The view toggle

**Files:**
- Modify: `src/pages/Cutline.jsx`

**Interfaces:**
- Consumes: `viewRef` (Task 6), `nextView`, `isView`, `DEFAULT_VIEW` (Task 1).
- Produces: nothing further.

- [ ] **Step 1: State, persistence and the key**

```js
const VIEW_KEY = 'cutline.view'

function loadView() {
  // localStorage can throw in a private window or with storage blocked.
  try {
    const v = window.localStorage.getItem(VIEW_KEY)
    return isView(v) ? v : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

const VIEW_LABEL = { top: 'Top-down', chase: 'Chase', bumper: 'Bumper' }
```

In the component:

```js
  const [view, setView] = useState(loadView)
  viewRef.current = view

  const cycleView = useCallback(() => {
    setView((v) => {
      const next = nextView(v)
      try {
        window.localStorage.setItem(VIEW_KEY, next)
      } catch {
        // Not remembered, but the view still changes.
      }
      return next
    })
  }, [])
```

Initialise `viewRef` from `loadView()` rather than `DEFAULT_VIEW`, so the first frame already uses the saved view.

In the existing `keydown` handler, before the driving keys are recorded:

```js
      // C cycles the view. Not while typing a name, and not on key repeat, or
      // holding it spins through every view.
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName))
      if (e.code === 'KeyC' && !e.repeat && !typing) {
        cycleView()
        return
      }
```

Add `cycleView` to that effect's dependency list.

Steering is **not** changed. It stays relative to the car in every view.

- [ ] **Step 2: The button**

In the HUD panel beside the canvas:

```jsx
            <button
              type="button"
              onClick={cycleView}
              className="border border-line bg-surface px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-fg transition-colors hover:border-flare hover:text-flare"
            >
              View: {VIEW_LABEL[view]} (C)
            </button>
```

- [ ] **Step 3: Run it**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test && npm run build && npm run check:bundle
```

Run the game as in Task 6 and check: `C` cycles top-down, chase, bumper; holding `C` changes the view once; typing a name containing `c` on the join screen does not change the view; the choice survives a reload; switching into bumper cuts and switching out of it eases; your own car is hidden only in bumper.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Cutline.jsx
git commit -m "feat(cutline): toggle between top-down, chase and bumper views"
```

---

## Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md`, `GEMINI.md`

- [ ] **Step 1: Record the invariants**

In `CLAUDE.md`, add to the architecture table:

```
| `src/lib/raceCamera.js` | Game-to-three.js mapping, view poses, smoothing | three.js, the DOM, any import |
| `src/lib/wallBlocks.js` | Which wall tiles are drawn in 3D | three.js, the DOM, any import |
| `src/lib/cutlineScene.js` | Cutline's three.js scene | Game rules, simulation, prediction |
```

Change the `src/pages/Cutline.jsx` row to "WebGL and overlay canvases, input, HUD", and add to the commands block:

```
npm run check:bundle   # after build: fails if three.js reaches the main chunk
```

Under "Invariants that fail silently":

```markdown
- **Cutline: game y maps to three.js +z, never -z.** `toWorld` is the only place
  the mapping lives. Mapping y to -z mirrors the world: a right-hand steer shows
  as a left turn and the minimap disagrees with the view, and nothing errors.
- **Cutline: the camera up vector is derived from the view, never fixed.**
  three.js `lookAt` breaks when up is parallel to the view, and top-down looks
  straight down while chase uses world up, so any fixed up vector goes degenerate
  partway through a switch. `upFor` is perpendicular to the view by construction.
- **Cutline: bumper position is locked, never smoothed.** At top speed any lag
  leaves the camera behind the bumper, inside the car. Switching into bumper is
  therefore a cut, on purpose.
- **Cutline: steering is never rotated by the camera.** Blockout Royale 3D rotates
  input by camera yaw in `followCamera.worldDir`. Cutline steers a rate relative to
  the car, and copying that rotation would break it.
- **Cutline: `WALL_HEIGHT` and the chase camera height are one setting.**
  `chaseClearance` says how far behind the car a wall must be before the chase
  camera sees over it, and a test holds it under `CHASE_CLEAR_MAX`.
- **Cutline is a lazy route, and `npm run check:bundle` enforces it.** three.js is
  ~570 KB. Importing Cutline or Blockout 3D eagerly would add it to every page.
- **Cutline's ground is the 2D prerender, used as one texture.** `setTrack`
  disposes the previous circuit first, and `dispose` calls `forceContextLoss`.
  Without the first, GPU memory grows every restart; without the second, WebGL
  contexts leak on navigation until the browser kills the oldest.
```

Mirror the same additions into `GEMINI.md`, matching its structure.

- [ ] **Step 2: Verify and commit**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test && npm run build && npm run check:bundle
git add CLAUDE.md GEMINI.md
git commit -m "docs(cutline): record the camera view invariants"
```

---

## Self-Review

**Spec coverage.** Section 3.1 (how the ground survives) is Task 4. Section 3.2 (files) is Tasks 1 to 5. Section 3.3 (data flow) is Task 6. Section 4 (cameras, smoothing, walls, controls) is Tasks 1 and 7. Section 5 (the scene) is Tasks 4 and 5. Section 6 (lazy loading, WebGL failure, bundle check) is Tasks 3 and 6. Section 8 (testing) is Tasks 1, 2, 3 and the manual steps of 6 and 7. Section 9 (not built) is respected: no camera collision, no cockpit interior, no free look, no 2D fallback.

**One spec test deliberately not written.** Section 8 lists "`TOP_HEIGHT` frames `VIEW_CELLS` tiles at `TOP_FOV`". `TOP_HEIGHT` is computed by that very formula in its own declaration, so a test would re-derive the same expression and could not fail. It is left out under the hollow-test rule rather than written to satisfy a checklist.

**Two things the plan corrects beyond the spec.** Walls use 8-way adjacency, because 4-way leaves 1,039 holes at convex corners; the spec's measured count of 453 to 867 was 4-way and becomes 548 to 1,043. The ground plane is aligned to the physics at `[x - 0.5, x + 0.5]`, which fixes a half-tile offset the 2D renderer had.

**Placeholder scan.** No TBD or TODO. Every code step carries code. Tasks 4 to 7 have no unit tests because they are three.js and the DOM; every piece of their maths is in the tested `raceCamera.js`, and their verification steps are concrete.

**Type consistency.** `stepCamera` returns `{ position, target, up, fov }` or `null` in Task 1, and Task 6 passes it straight to `update({ pose })`, which handles `null` by leaving the camera where it is. `project` returns `{ fx, fy, visible }` in Task 4 and Task 6 multiplies by `CANVAS`. `wallBlocks` returns `{ x, y }` in Task 2 and Task 4 reads exactly those. `setTrack(groundCanvas, wallBoxes)` has the same signature in Tasks 4 and 6.
