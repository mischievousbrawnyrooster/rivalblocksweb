# Cutline Handling, Drift and Speedometer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heavier, less on-rails handling, a Shift drift that scores points for fun, a body that leans, pitches and bounces, and a needle speedometer.

**Architecture:** Every rule change lands in `server/cutline.js` (`stepCar`, `resolveContact`, `applyInput`, `snapshot`) and is tested in `server/cutline.test.js`. The page only draws: a new pure module `src/lib/carPose.js` turns received snapshots into lean, pitch and bounce, `src/lib/cutlineScene.js` applies them and draws drift smoke, and `src/pages/Cutline.jsx` sends the Shift key and draws the drift HUD and the needle speedometer.

**Tech Stack:** Node `node:test`, React 19, three.js, Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-09-25-cutline-handling-drift-design.md`

## Global Constraints

- Node is not on PATH: prefix every `node`/`npm` command with `export PATH="/c/Program Files/nodejs:$PATH" &&` (Git Bash).
- `server/cutline.js` stays pure: zero imports, zero Node APIs, no `Date.now`, no `Math.random` outside the injected `rng`.
- No client-side prediction. The page draws only values from snapshots it has received.
- The speed envelope is fixed: `TOP_SPEED` 14, `BOOST_MULT` 1.35, `SLIP_BOOST` 1.18, `RAMP_MIN_SPEED` 8, `AIR_MS` 700 do not change.
- Steering stays a rate: `steer` is `-1 | 0 | 1` held input; nothing sends a target heading or position.
- Tests reference constants, never literals, for anything tunable. Feel targets from the spec are named test-local constants.
- A full snapshot of eight cars stays under 4096 bytes.
- Status is never colour alone (WCAG 1.4.1): drift banked vs lost differ in words and shape.
- The overlay HUD uses the literal hex colours already in `drawHud` (`#ecebe6`, `#8f8d86`, `#f97316`, `#3ad1c4`, `#eab308`); never a player colour for status.
- Site copy: no em dashes, terse. Code comments are exempt.
- Server edits need the match server restarted (`npm run cutline`) to be seen in the browser; vite hot-reloads the page.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Hostile `drift` input (`NaN`, `'1'`, `{}`, `2`) must clamp to `false` and never reach the physics. Test in Task 4.
- A drift carried over a ramp or a spring hop must lose its chain and still land normally. Test in Task 4.
- A drift into a hole must lose its chain, not bank it when the car is set down at speed 0. Test in Task 4.
- A race restarting while cars drift must start every car with no chain, no score and no end popup. Test in Task 4.
- A backgrounded tab returning with a multi-second `dt` (or `0`, `NaN`) must leave `carPose` finite and inside its clamps. Test in Task 6.

## Baseline (measured before any change)

`4 bots, rng () => 0.5, 90 s per circuit`, the method Task 9 commits as `server/cutline-laps.mjs`:

```
Foundry Loop  laps  4  median 31.66s
Coolant Bend  laps 13  median 17.10s
The Spindle   laps  6  median 24.34s
Slag Pit      laps  8  median 25.17s
Draw Bench    laps  8  median 26.75s
Cinder Yard   laps  7  median 29.58s
Ladle Row     laps 12  median 17.95s
Tap Hole      laps  8  median 27.78s
ALL median 25.14s over 66 laps
```

A prototype of Tasks 1 to 4 measured `ALL median 25.22s over 64 laps` with every circuit still lapping, 0 to top speed in 2.85 s and top speed to a stop in 0.99 s. The whole Cutline suite passed against it except the one test Task 1 updates.

---

### Task 1: Steering builds up

**Files:**
- Modify: `server/cutline.js` (constants after `TURN_FALLOFF` ~line 1330; `join` car object ~line 1283; `applyInput` block ~line 1433; `stepCar` step 1 ~line 1484; `startRace` ~line 2268; `snapshot` `steer` ~line 2424)
- Test: `server/cutline.test.js` (append at end; edit the snapshot steer test ~line 1573 and the airborne test ~line 2226)

**Interfaces:**
- Produces: `export const STEER_IN`, `export const STEER_OUT`; car field `steerNow` (number in [-1, 1]); snapshot `steer` now carries `steerNow` rounded to 0.01; test helpers `openGround()` and `drive(match, car, seconds)` and the namespace import `hd` in `cutline.test.js`, used by Tasks 2 to 5.

- [ ] **Step 1: Write the failing test**

Append to the end of `server/cutline.test.js`:

```js
// --- Handling: steering builds, grip fades, weight, walls, contact, drift -----
import * as hd from './cutline.js'

/** A match whose whole grid is tarmac, with one car at rest facing +x. */
function openGround() {
  const match = racing(1)
  match.grid.fill(S_TARMAC)
  const [car] = [...match.cars.values()]
  Object.assign(car, { x: 5, y: GRID / 2, heading: 0, vx: 0, vy: 0 })
  return { match, car }
}

/** Step a car for `seconds` at the real tick, wrapping it back before the far edge. */
function drive(match, car, seconds) {
  for (let t = 0; t < seconds * 1000; t += TICK_MS) {
    stepCar(match, car, TICK_MS / 1000)
    if (car.x > GRID - 5) car.x = 5
  }
}

test('steering builds to full lock over STEER_IN and lets go over STEER_OUT', () => {
  const { match, car } = openGround()
  applyInput(match, car.id, { steer: 1 })
  stepCar(match, car, TICK_MS / 1000)
  assert.ok(car.steerNow > 0 && car.steerNow < 1, `one tick must not reach full lock, got ${car.steerNow}`)

  drive(match, car, hd.STEER_IN)
  assert.equal(car.steerNow, 1, 'held for STEER_IN, the wheel reaches full lock')

  applyInput(match, car.id, { steer: 0 })
  // One extra tick: five steps of 0.2 from 1 land a hair above 0 in floating point.
  drive(match, car, hd.STEER_OUT + TICK_MS / 1000)
  assert.equal(car.steerNow, 0, 'released for STEER_OUT, the wheel is back at centre')
  assert.ok(hd.STEER_OUT < hd.STEER_IN, 'letting go is quicker than turning in')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test --test-name-pattern="steering builds" server/cutline.test.js`
Expected: FAIL, `one tick must not reach full lock, got undefined`

- [ ] **Step 3: Write minimal implementation**

In `server/cutline.js`, after `export const TURN_FALLOFF = 0.45 ...`:

```js
export const STEER_IN = 0.15         // seconds from centre to full lock
export const STEER_OUT = 0.08        // seconds from full lock back to centre
```

In `join`'s car object, after `vy: 0,`:

```js
    steerNow: 0,
```

In `startRace`'s per-car reset, after `car.steer = 0`:

```js
    car.steerNow = 0
```

Directly after `applyInput` (before `topSpeedOf`), add:

```js
/**
 * The wheel follows the held key rather than jumping to it: full lock after
 * STEER_IN, back to centre after STEER_OUT. The heading still turns at a rate
 * the server applies, so the no-prediction steering model is untouched; only
 * how fast that rate arrives has changed.
 */
function steerToward(car, dt) {
  const target = car.steer ?? 0
  const now = car.steerNow ?? 0
  // Toward centre (letting go, or crossing to the other lock) is the quicker move.
  const outward = target !== 0 && Math.sign(target) === Math.sign(now || target)
  const step = dt / (outward ? STEER_IN : STEER_OUT)
  car.steerNow = Math.abs(target - now) <= step ? target : now + Math.sign(target - now) * step
}
```

In `stepCar`, replace:

```js
  // 1. Steer. A rate, never a target: this is what makes the game playable
  //    without client-side prediction.
  const speed = Math.hypot(car.vx, car.vy)
```

with:

```js
  // 1. Steer. A rate, never a target: this is what makes the game playable
  //    without client-side prediction. steerNow eases toward the held key;
  //    the heading still turns at a rate.
  steerToward(car, dt)
  const speed = Math.hypot(car.vx, car.vy)
```

and in the same step replace `car.heading += (car.steer ?? 0) * TURN_RATE * falloff * steerAuthority * dt` with:

```js
    car.heading += car.steerNow * TURN_RATE * falloff * steerAuthority * dt
```

In `snapshot`, replace the `steer` comment and line:

```js
      // The page turns the front wheels by `steer` and lights the brake lamps by
      // `brake`. Both are held input the server already owns, and without them on
      // the wire the page silently drew straight wheels and dark lamps forever,
      // because an absent field reads as a falsy one.
      steer: car.steer ?? 0,
```

with:

```js
      // The page turns the front wheels by `steer` and lights the brake lamps by
      // `brake`. Without them on the wire the page silently drew straight wheels
      // and dark lamps forever, because an absent field reads as a falsy one.
      // `steer` is the eased wheel, so the drawn wheels turn in as the car does.
      steer: Math.round((car.steerNow ?? 0) * 100) / 100,
```

- [ ] **Step 4: Update the two existing tests the eased wheel changes**

In `'the snapshot carries the held steer and brake the page draws with'`, the snapshot now carries the eased wheel, so let it settle before reading. Replace:

```js
  applyInput(match, car.id, { steer: -1, brake: 1, throttle: 1 })
  const left = snapshot(match).cars.find((c) => c.id === car.id)
```

with:

```js
  // Lock to lock is STEER_OUT to centre then STEER_IN out; twice that is slack.
  const settle = () => {
    for (let t = 0; t <= 2 * (hd.STEER_IN + hd.STEER_OUT) * 1000; t += TICK_MS) stepCar(match, car, TICK_MS / 1000)
  }
  applyInput(match, car.id, { steer: -1, brake: 1, throttle: 1 })
  settle()
  const left = snapshot(match).cars.find((c) => c.id === car.id)
```

and replace:

```js
  applyInput(match, car.id, { steer: 1, brake: 0, throttle: 1 })
  const right = snapshot(match).cars.find((c) => c.id === car.id)
```

with:

```js
  applyInput(match, car.id, { steer: 1, brake: 0, throttle: 1 })
  settle()
  const right = snapshot(match).cars.find((c) => c.id === car.id)
```

In the airborne test (the block commented `// Airborne steering: angular turn rate is scaled down by AIR_STEER.`), both halves set `car.steer = 1`. The wheel would carry over from the first half into the second and break the ratio, so hold it at full lock in both. After each of the two `car.steer = 1` lines add:

```js
  car.steerNow = 1
```

- [ ] **Step 5: Run the Cutline suite**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test server/cutline.test.js 2>&1 | tail -8`
Expected: all pass, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): the wheel builds to full lock instead of snapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Grip fades with speed, and the car has weight

**Files:**
- Modify: `server/cutline.js` (handling constants ~line 1325; `stepCar` steps 3 and 4)
- Test: `server/cutline.test.js` (append)

**Interfaces:**
- Consumes: `openGround()`, `drive()`, `hd` from Task 1; existing `placed()`, `speedOf()`.
- Produces: `export const ACCEL_FADE`, `export const GRIP_FALLOFF`, `export const LIFT_GRIP`; `ACCEL` 17, `BRAKE` 11, `DRAG` 0.5. Brake cuts thrust.

- [ ] **Step 1: Write the failing tests**

Append:

```js
// The spec's feel targets, as measured on the prototype: 0 to top in about 3 s
// (the old handling took 2.3) and top to a stop in about 1 s (it took 0.4).
const FEEL_TO_TOP_S = [2.5, 3.5]
const FEEL_TO_STOP_S = [0.8, 1.2]

test('full throttle still reaches TOP_SPEED, and takes its time doing it', () => {
  assert.ok(hd.ACCEL * (1 - hd.ACCEL_FADE) > hd.DRAG * TOP_SPEED, 'thrust at the cap must beat drag, or top speed is unreachable')
  const { match, car } = openGround()
  applyInput(match, car.id, { throttle: 1 })
  let t = 0
  while (speedOf(car) < TOP_SPEED * 0.99 && t < 10) {
    stepCar(match, car, TICK_MS / 1000)
    t += TICK_MS / 1000
    if (car.x > GRID - 5) car.x = 5
  }
  assert.ok(t > FEEL_TO_TOP_S[0] && t < FEEL_TO_TOP_S[1], `0 to top took ${t.toFixed(2)} s`)
})

test('braking from top speed stops the car in about a second, even on the throttle', () => {
  const { match, car } = openGround()
  placed(match, car, { x: 5, y: GRID / 2, heading: 0, speed: TOP_SPEED })
  // Throttle held too: every bot brakes like this, and the brake must win.
  applyInput(match, car.id, { brake: 1, throttle: 1 })
  let t = 0
  while (car.vx > 0 && t < 5) {
    stepCar(match, car, TICK_MS / 1000)
    t += TICK_MS / 1000
  }
  assert.ok(t > FEEL_TO_STOP_S[0] && t < FEEL_TO_STOP_S[1], `top to a stop took ${t.toFixed(2)} s`)
})

test('a fast car holds less sideways grip than a slow one, and more off the throttle', () => {
  // The same sideways slide in three situations: how much survives one step.
  const kept = (speed, throttle) => {
    const { match, car } = openGround()
    placed(match, car, { x: 20, y: GRID / 2, heading: 0, speed, lateral: 3 })
    applyInput(match, car.id, { throttle: throttle ? 1 : 0 })
    stepCar(match, car, 0.05)
    return Math.abs(car.vy) // heading 0, so lateral is vy
  }
  assert.ok(kept(TOP_SPEED, true) > kept(2, true), 'grip must fade with speed')
  assert.ok(kept(TOP_SPEED, true) > kept(TOP_SPEED, false), 'lifting must give some grip back')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test --test-name-pattern="TOP_SPEED, and takes|stops the car in about|sideways grip than" server/cutline.test.js`
Expected: FAIL. The first on `hd.ACCEL_FADE` being undefined (`NaN > ...` is false), the second on `top to a stop took 0.4x s`, the third on `grip must fade with speed`.

- [ ] **Step 3: Write minimal implementation**

In `server/cutline.js`, replace:

```js
export const ACCEL = 18.0
export const BRAKE = 26.0
export const DRAG = 1.2
```

with:

```js
export const ACCEL = 17.0            // thrust from a standstill
export const ACCEL_FADE = 0.56       // fraction of that thrust gone at the speed cap
export const BRAKE = 11.0            // top speed to a stop in about a second
export const DRAG = 0.5              // low, so a lifted car rolls on
```

After `export const STEER_OUT ...` add:

```js
// Grip fades with speed, so a fast corner pushes wide unless the driver lifts.
export const GRIP_FALLOFF = 0.35     // fraction of lateral grip gone at top speed, on the throttle
export const LIFT_GRIP = 0.4         // fraction of that loss still felt off the throttle
```

In `stepCar` step 3, replace:

```js
  if (car.throttle) fwd += ACCEL * (match.now < car.boostUntil ? BOOST_MULT : 1) * drive * dt
```

with:

```js
  // Thrust is strong from a standstill and fades toward the cap, so the last
  // few km/h take their time. Braking cuts it: with a brake this soft, a car
  // holding both (as every bot does) sped up below about 7 tiles/s.
  if (car.throttle && !car.brake) {
    const fade = 1 - ACCEL_FADE * Math.min(1, Math.max(0, fwd) / cap)
    fwd += ACCEL * (match.now < car.boostUntil ? BOOST_MULT : 1) * drive * fade * dt
  }
```

In step 4, replace:

```js
  const grip = car.onSlick ? Math.min(base, GRIP[S_OIL]) : base
  lat *= Math.max(0, 1 - grip * dt)
```

with:

```js
  let grip = car.onSlick ? Math.min(base, GRIP[S_OIL]) : base
  // Less of it at speed, and less still on the throttle.
  const load = Math.min(1, speed / TOP_SPEED)
  grip *= 1 - GRIP_FALLOFF * load * load * (car.throttle ? 1 : LIFT_GRIP)
  lat *= Math.max(0, 1 - grip * dt)
```

- [ ] **Step 4: Run the Cutline suite**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test server/cutline.test.js 2>&1 | tail -8`
Expected: all pass. The bot tests (`bots drive the generated racing line and complete laps`, `a race resolves to exactly one winner`) must pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): grip fades with speed, and the car has weight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Walls and car contact

**Files:**
- Modify: `server/cutline.js` (`WALL_HIT_KEEP` constant ~line 1334; `stepCar` step 6; new `wallHit` after `stepCar`; `resolveContact`)
- Test: `server/cutline.test.js` (import list ~line 477; wall test ~line 588; comment ~line 2216; append)

**Interfaces:**
- Consumes: `openGround()`, `hd` from Task 1.
- Produces: `export const WALL_BOUNCE, WALL_SCRUB, WALL_ALIGN, WALL_GLANCE, CAR_BOUNCE`; `WALL_HIT_KEEP` removed; `function wallHit(match, car, hitX, hitY, vx, vy)` (module private), which Task 4 extends.

- [ ] **Step 1: Write the failing tests**

Append:

```js
/** Turn row `wy` of an open ground into wall, across the whole grid. */
function wallRow(match, wy) {
  for (let x = 0; x < GRID; x++) match.grid[wy * GRID + x] = S_WALL
}

/** Step until the car's +y velocity flips at the wall; returns speed and heading just before. */
function untilWall(match, car) {
  for (let i = 0; i < 120; i++) {
    const before = { v: speedOf(car), heading: car.heading, vy: car.vy }
    stepCar(match, car, TICK_MS / 1000)
    if (before.vy > 0 && car.vy <= 0) return before
  }
  return null
}

test('a glancing wall hit keeps nearly all its speed and turns the car along the wall', () => {
  const { match, car } = openGround()
  const wy = GRID / 2 + 2
  wallRow(match, wy)
  placed(match, car, { x: 20, y: wy - 1.3, heading: 0.2, speed: 10 })
  const before = untilWall(match, car)
  assert.ok(before, 'the car never reached the wall')
  assert.ok(speedOf(car) > before.v * 0.9, `a glancing hit must keep its speed: ${before.v} to ${speedOf(car)}`)
  assert.ok(Math.abs(car.heading) < Math.abs(before.heading), 'a glancing hit turns the nose toward the wall line')
})

test('a square wall hit nearly stops the car and leaves its heading alone', () => {
  const { match, car } = openGround()
  const wy = GRID / 2 + 2
  wallRow(match, wy)
  placed(match, car, { x: 20, y: wy - 1.5, heading: Math.PI / 2, speed: 10 })
  const before = untilWall(match, car)
  assert.ok(before, 'the car never reached the wall')
  assert.ok(speedOf(car) <= before.v * hd.WALL_BOUNCE + 0.001, `square on, only WALL_BOUNCE comes back: ${speedOf(car)}`)
  assert.equal(car.heading, before.heading, 'a square hit does not turn the car')
})

test('a rear-end hit shoves the car ahead and costs the one behind, conserving momentum', () => {
  const match = racing(2)
  match.grid.fill(S_TARMAC)
  const [a, b] = [...match.cars.values()]
  const line = () => {
    placed(match, a, { x: 40, y: 40, heading: 0, speed: 10 })
    placed(match, b, { x: 40 + CAR_LENGTH * 0.9, y: 40, heading: 0, speed: 4 })
  }
  line()
  const before = a.vx + b.vx
  resolveContact(match)
  assert.ok(b.vx > 4, 'the car ahead is shoved forward')
  assert.ok(a.vx < 10, 'the car behind loses speed')
  assert.ok(Math.abs(a.vx + b.vx - before) < 1e-9, 'equal masses: momentum is conserved')

  // A ghost is not there to be hit: nothing changes hands.
  line()
  a.ghostUntil = match.now + 1000
  resolveContact(match)
  assert.equal(a.vx, 10)
  assert.equal(b.vx, 4)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test --test-name-pattern="glancing wall|square wall|rear-end hit" server/cutline.test.js`
Expected: FAIL. Glancing on `turns the nose toward the wall line`; square on `only WALL_BOUNCE comes back` (`hd.WALL_BOUNCE` undefined); rear-end on `the car ahead is shoved forward`.

- [ ] **Step 3: Write minimal implementation**

In `server/cutline.js`, replace `export const WALL_HIT_KEEP = 0.25` with:

```js
// A wall hit splits velocity into the part into the wall and the part along it.
export const WALL_BOUNCE = 0.15      // fraction of the into-wall speed that comes back out
export const WALL_SCRUB = 0.25       // along-wall speed lost per unit of impact
export const WALL_ALIGN = 0.5        // fraction of the gap to the wall's line a glancing hit turns the nose
export const WALL_GLANCE = 0.7       // impact above which a hit is square on and turns nothing
export const CAR_BOUNCE = 0.3        // restitution between two cars of equal mass
```

In `stepCar` step 6, replace:

```js
  const nx = car.x + car.vx * dt
  if (cornersInWall(match, car, nx, car.y) > 0 && !offTrack && !airborne) {
    car.vx *= -WALL_HIT_KEEP
  } else {
    car.x = nx
  }

  const ny = car.y + car.vy * dt
  if (cornersInWall(match, car, car.x, ny) > 0 && !offTrack && !airborne) {
    car.vy *= -WALL_HIT_KEEP
  } else {
    car.y = ny
  }
```

with:

```js
  const hitVx = car.vx
  const hitVy = car.vy
  let hitX = false
  let hitY = false
  const nx = car.x + car.vx * dt
  if (cornersInWall(match, car, nx, car.y) > 0 && !offTrack && !airborne) {
    hitX = true
  } else {
    car.x = nx
  }

  const ny = car.y + car.vy * dt
  if (cornersInWall(match, car, car.x, ny) > 0 && !offTrack && !airborne) {
    hitY = true
  } else {
    car.y = ny
  }
  if (hitX || hitY) wallHit(match, car, hitX, hitY, hitVx, hitVy)
```

After `stepCar`, before `capsule`, add:

```js
/**
 * A grid wall faces along x or y, so the blocked axis is its normal. The part
 * of the velocity into it bounces back at WALL_BOUNCE; the part along it is
 * scrubbed by how square the hit was. A glancing hit also turns the nose toward
 * the wall's line, so a car straightens out along it rather than grinding.
 */
function wallHit(match, car, hitX, hitY, vx, vy) {
  const speed = Math.hypot(vx, vy)
  if (speed === 0) return
  const impact = Math.min(1, Math.hypot(hitX ? vx : 0, hitY ? vy : 0) / speed)
  const keep = 1 - WALL_SCRUB * impact
  car.vx = hitX ? -vx * WALL_BOUNCE : vx * keep
  car.vy = hitY ? -vy * WALL_BOUNCE : vy * keep
  const tx = hitX ? 0 : vx
  const ty = hitY ? 0 : vy
  if (impact < WALL_GLANCE && (tx !== 0 || ty !== 0)) {
    const along = Math.atan2(ty, tx)
    const d = Math.atan2(Math.sin(along - car.heading), Math.cos(along - car.heading))
    // Not a car reversing along the wall: only a nose already pointing its way.
    if (Math.abs(d) < Math.PI / 2) car.heading += d * WALL_ALIGN
  }
}
```

In `resolveContact`, after:

```js
      a.x -= ux * push
      a.y -= uy * push
      b.x += ux * push
      b.y += uy * push
```

add:

```js
      // Trade momentum along the contact, equal masses, a little bounce. Only
      // when closing: two cars already parting keep their own speeds.
      const closing = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy
      if (closing < 0) {
        const j = (-(1 + CAR_BOUNCE) * closing) / 2
        a.vx -= j * ux
        a.vy -= j * uy
        b.vx += j * ux
        b.vy += j * uy
      }
```

- [ ] **Step 4: Update the tests that named `WALL_HIT_KEEP`**

A named import of a missing export is a SyntaxError, so the whole file would fail to load. In the import block near line 477, delete the line `  WALL_HIT_KEEP,`.

Rename the test `'a car driven into a wall keeps only WALL_HIT_KEEP of its speed'` to `'a car driven square into a wall bounces back only a little'`. In its body, replace the comment lines:

```js
      // WALL_HIT_KEEP reflects velocity, it does not merely damp it: the
      // component driving into the wall must reverse sign, and by enough
      // that this cannot be explained by ordinary drag alone. A fixed ratio
      // is used here rather than one built from WALL_HIT_KEEP itself,
```

with:

```js
      // WALL_BOUNCE reflects velocity, it does not merely damp it: the
      // component driving into the wall must reverse sign, and by enough
      // that this cannot be explained by ordinary drag alone. A fixed ratio
      // is used here rather than one built from WALL_BOUNCE itself,
```

In the airborne test, replace `// Grounded car facing a wall rebounds with -WALL_HIT_KEEP.` with `// Grounded car facing a wall rebounds with -WALL_BOUNCE.`

- [ ] **Step 5: Run the Cutline suite**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test server/cutline.test.js 2>&1 | tail -8`
Expected: all pass, including `cars touching a wall are never stuck` (the 3-second unstick test) and the bot tests.

- [ ] **Step 6: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): glancing wall hits keep speed, and cars trade momentum

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Drift rules

**Files:**
- Modify: `server/cutline.js` (constants; `join`; `applyInput`; `stepCar`; `wallHit`; `startRace`; new `updateDrift`, `endDrift`)
- Test: `server/cutline.test.js` (append)

**Interfaces:**
- Consumes: `openGround()`, `hd`, `wallRow()` from Tasks 1 and 3; `wallHit` from Task 3.
- Produces: `export const DRIFT_MIN_SPEED, DRIFT_TURN, DRIFT_FALLOFF, DRIFT_GRIP, DRIFT_DRAG, DRIFT_POINTS, DRIFT_SHOW_MS`. Car fields: `drift` (boolean, held input), `driftDir` (`-1 | 0 | 1`), `driftChain` (number), `driftScore` (integer), `driftEnd` (`{ pts, lost, at } | null`). Input message field `drift: 1 | true`. Task 5 puts these on the wire; Task 8 sends the input.

- [ ] **Step 1: Write the failing tests**

Append:

```js
/** An open-ground car already drifting right at about 9 tiles/s. */
function drifting() {
  const { match, car } = openGround()
  placed(match, car, { x: GRID / 2, y: GRID / 2, heading: 0, speed: 9 })
  applyInput(match, car.id, { throttle: 1, steer: 1, drift: 1 })
  for (let i = 0; i < 20; i++) stepCar(match, car, TICK_MS / 1000)
  assert.equal(car.driftDir, 1, 'the setup must be drifting')
  assert.ok(car.driftChain > 0, 'the setup must have built a chain')
  return { match, car }
}

const lostIt = (car, why) => {
  assert.equal(car.driftDir, 0, `${why}: the drift must end`)
  assert.equal(car.driftScore, 0, `${why}: nothing is banked`)
  assert.equal(car.driftEnd?.lost, true, `${why}: the end is recorded as lost`)
}

test('drift input is clamped to a boolean', () => {
  const { match, car } = openGround()
  for (const drift of [NaN, 'yes', '1', {}, [], null, undefined, 2]) {
    applyInput(match, car.id, { drift })
    assert.equal(car.drift, false, `${JSON.stringify(drift)} must not hold a drift`)
  }
  applyInput(match, car.id, { drift: 1 })
  assert.equal(car.drift, true)
  applyInput(match, car.id, { drift: true })
  assert.equal(car.drift, true)
})

test('a drift needs Shift, a steer and DRIFT_MIN_SPEED', () => {
  const at = (speed, input) => {
    const { match, car } = openGround()
    placed(match, car, { x: 20, y: GRID / 2, heading: 0, speed })
    applyInput(match, car.id, input)
    stepCar(match, car, TICK_MS / 1000)
    stepCar(match, car, TICK_MS / 1000)
    return car.driftDir
  }
  const fast = hd.DRIFT_MIN_SPEED + 2
  assert.equal(at(fast, { drift: 1, steer: 1, throttle: 1 }), 1, 'right steer drifts right')
  assert.equal(at(fast, { drift: 1, steer: -1, throttle: 1 }), -1, 'left steer drifts left')
  assert.equal(at(hd.DRIFT_MIN_SPEED - 1, { drift: 1, steer: 1, throttle: 1 }), 0, 'too slow')
  assert.equal(at(fast, { drift: 1, steer: 0, throttle: 1 }), 0, 'no steer')
  assert.equal(at(fast, { drift: 0, steer: 1, throttle: 1 }), 0, 'no Shift')
})

test('at the same speed a drift turns the path tighter than grip and keeps its speed', () => {
  const turned = (drift) => {
    const { match, car } = openGround()
    placed(match, car, { x: GRID / 2, y: GRID / 2, heading: 0, speed: 9 })
    applyInput(match, car.id, { throttle: 1, steer: 1, drift: drift ? 1 : 0 })
    let path = 0
    let last = 0
    for (let t = 0; t < 500; t += TICK_MS) {
      const h = car.heading
      stepCar(match, car, TICK_MS / 1000)
      assert.ok(car.heading - h <= TURN_RATE * hd.DRIFT_TURN * (TICK_MS / 1000) + 1e-9, 'a step never out-turns TURN_RATE * DRIFT_TURN')
      const dir = Math.atan2(car.vy, car.vx)
      path += Math.atan2(Math.sin(dir - last), Math.cos(dir - last))
      last = dir
    }
    return { path, speed: speedOf(car) }
  }
  const grip = turned(false)
  const drift = turned(true)
  assert.ok(drift.path > grip.path * 1.5, `drift turned ${drift.path.toFixed(2)} rad, grip ${grip.path.toFixed(2)}`)
  assert.ok(drift.speed > grip.speed * 0.9, `a drift carries its speed: ${drift.speed.toFixed(2)} vs ${grip.speed.toFixed(2)}`)
})

test('letting go of Shift banks the chain', () => {
  const { match, car } = drifting()
  const chain = car.driftChain
  applyInput(match, car.id, { throttle: 1, steer: 1, drift: 0 })
  stepCar(match, car, TICK_MS / 1000)
  assert.equal(car.driftDir, 0)
  assert.equal(car.driftScore, Math.round(chain))
  assert.deepEqual({ pts: car.driftEnd.pts, lost: car.driftEnd.lost }, { pts: Math.round(chain), lost: false })
})

test('a spin, leaving the ground, a hole or a wall loses the chain', () => {
  {
    const { match, car } = drifting()
    car.spinUntil = match.now + hd.SPIN_MS
    stepCar(match, car, TICK_MS / 1000)
    lostIt(car, 'spun')
  }
  {
    const { match, car } = drifting()
    car.airUntil = match.now + hd.AIR_MS
    car.airMs = hd.AIR_MS
    stepCar(match, car, TICK_MS / 1000)
    lostIt(car, 'airborne')
    for (let t = 0; t < hd.AIR_MS + 200; t += TICK_MS) {
      match.now += TICK_MS
      stepCar(match, car, TICK_MS / 1000)
    }
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y), 'it lands in one piece')
  }
  {
    const { match, car } = drifting()
    car.fellIn = { x: car.x, y: car.y, heading: 0, width: 3 }
    car.fallUntil = match.now + hd.FALL_MS
    stepCar(match, car, TICK_MS / 1000)
    lostIt(car, 'down a hole')
  }
  {
    const { match, car } = drifting()
    // One row ahead of a car already turned to face +y, so it cannot miss.
    wallRow(match, Math.round(car.y) + 1)
    for (let i = 0; i < 120 && car.driftDir; i++) stepCar(match, car, TICK_MS / 1000)
    lostIt(car, 'into a wall')
  }
})

test('a new race starts every car with no drift and no drift points', () => {
  const match = racing(2)
  for (const car of match.cars.values()) {
    Object.assign(car, { drift: true, driftDir: 1, driftChain: 500, driftScore: 9000, driftEnd: { pts: 500, lost: false, at: match.now } })
  }
  startRace(match)
  for (const car of match.cars.values()) {
    assert.equal(car.drift, false)
    assert.equal(car.driftDir, 0)
    assert.equal(car.driftChain, 0)
    assert.equal(car.driftScore, 0)
    assert.equal(car.driftEnd, null)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test --test-name-pattern="drift|Shift|new race starts every car" server/cutline.test.js`
Expected: FAIL. `drift input is clamped` on `car.drift` being `undefined`; the others on `the setup must be drifting` or `driftDir` being `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `server/cutline.js`, after the `CAR_BOUNCE` constant, add:

```js
// --- Drift -----------------------------------------------------------------
// Shift and a steer at speed lets the back step out: the car turns tighter than
// grip allows and carries its speed round, at a cost in drag. Faster through a
// hairpin, slower through a sweeper. The chain it builds is for fun and is never
// banked on the board.
export const DRIFT_MIN_SPEED = 6     // tiles per second, 60 km/h
export const DRIFT_TURN = 1.8        // turn rate multiple while drifting
export const DRIFT_FALLOFF = 0.3     // fraction of TURN_FALLOFF a drift still suffers
export const DRIFT_GRIP = 6.0        // sets the slip angle only: speed is kept, not scrubbed
export const DRIFT_DRAG = 1.0        // what a drift costs, per second, as a fraction of speed
export const DRIFT_POINTS = 100      // per tile/s of speed per radian of slip per second
export const DRIFT_SHOW_MS = 1200    // how long a banked or lost chain stays on the wire
```

In `join`'s car object, after `steerNow: 0,`:

```js
    drift: false,
    driftDir: 0,
    driftChain: 0,
    driftScore: 0,
    driftEnd: null,
```

In `startRace`'s per-car reset, after `car.steerNow = 0`:

```js
    car.drift = false
    car.driftDir = 0
    car.driftChain = 0
    car.driftScore = 0
    car.driftEnd = null
```

In `applyInput`, after `car.brake = ...`:

```js
  car.drift = raw.drift === 1 || raw.drift === true
```

After `steerToward`, add:

```js
/** Start a drift, or end one cleanly. The ways to lose one are checked at the top of stepCar. */
function updateDrift(match, car, speed, airborne, spinning) {
  if (car.driftDir) {
    if (!car.drift || speed < DRIFT_MIN_SPEED) endDrift(match, car, false)
  } else if (car.drift && !airborne && !spinning && speed >= DRIFT_MIN_SPEED && car.steerNow !== 0) {
    // Locked to the side it was turned into until it ends.
    car.driftDir = Math.sign(car.steerNow)
    car.driftChain = 0
  }
}

/**
 * Bank the chain, or lose it. Either way the outcome is recorded for the page,
 * which draws what the rules decided and never works it out for itself.
 */
function endDrift(match, car, lost) {
  const pts = Math.round(car.driftChain ?? 0)
  if (!lost) car.driftScore = (car.driftScore ?? 0) + pts
  if (pts > 0) car.driftEnd = { pts, lost, at: match.now }
  car.driftDir = 0
  car.driftChain = 0
}
```

In `stepCar`, directly after the first line `if (!car.alive || !Number.isFinite(dt) || dt <= 0) return`, add:

```js
  // A drift is lost by going down a hole, leaving the ground or being spun.
  // Checked before the early returns below, which a falling or flying car takes.
  if (car.driftDir && (isFalling(match, car) || match.now < (car.airUntil ?? 0) || match.now < (car.spinUntil ?? 0))) {
    endDrift(match, car, true)
  }
```

In step 1, replace:

```js
  const spinning = match.now < (car.spinUntil ?? 0)
  if (spinning) {
    // The wheel is not yours. Input is ignored outright rather than scaled, so a
    // spin cannot be steered out of by holding the opposite lock.
    car.heading += SPIN_RATE * dt
  } else {
```

with:

```js
  const spinning = match.now < (car.spinUntil ?? 0)
  updateDrift(match, car, speed, airborne, spinning)
  if (spinning) {
    // The wheel is not yours. Input is ignored outright rather than scaled, so a
    // spin cannot be steered out of by holding the opposite lock.
    car.heading += SPIN_RATE * dt
  } else if (car.driftDir) {
    // Into the drift tightens it, centred holds it, counter-steer opens it.
    const trim = 0.75 + 0.25 * car.steerNow * car.driftDir
    const held = 1 - TURN_FALLOFF * DRIFT_FALLOFF * Math.min(1, speed / TOP_SPEED)
    car.heading += car.driftDir * TURN_RATE * DRIFT_TURN * held * trim * dt
  } else {
```

In step 4, replace:

```js
  let grip = car.onSlick ? Math.min(base, GRIP[S_OIL]) : base
  // Less of it at speed, and less still on the throttle.
  const load = Math.min(1, speed / TOP_SPEED)
  grip *= 1 - GRIP_FALLOFF * load * load * (car.throttle ? 1 : LIFT_GRIP)
  lat *= Math.max(0, 1 - grip * dt)
```

with:

```js
  let grip = car.onSlick ? Math.min(base, GRIP[S_OIL]) : base
  if (car.driftDir) grip = Math.min(grip, DRIFT_GRIP)
  // Less of it at speed, and less still on the throttle.
  const load = Math.min(1, speed / TOP_SPEED)
  grip *= 1 - GRIP_FALLOFF * load * load * (car.throttle ? 1 : LIFT_GRIP)
  const latBefore = lat
  lat *= Math.max(0, 1 - grip * dt)
  // A drift turns sideways speed into forward speed instead of scrubbing it.
  // Scrubbed, the turn rate a hairpin needs bled speed faster than any throttle
  // could replace; this is what lets a drift carry its speed round.
  if (car.driftDir) {
    fwd = Math.sign(fwd || 1) * Math.sqrt(Math.max(0, fwd * fwd + latBefore * latBefore - lat * lat))
    fwd -= fwd * DRIFT_DRAG * dt
  }
```

In step 5, after `car.vy = fwd * sin + lat * cos`, add:

```js
  // Points for style: faster and more sideways earns more.
  if (car.driftDir) car.driftChain += Math.hypot(fwd, lat) * Math.abs(Math.atan2(lat, fwd)) * DRIFT_POINTS * dt
```

In `wallHit`, make the first line of the body:

```js
  if (car.driftDir) endDrift(match, car, true)
```

- [ ] **Step 4: Run the Cutline suite**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test server/cutline.test.js 2>&1 | tail -8`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): drift on Shift, with a chain that banks or is lost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Drift on the wire, inside the 4 KB frame

**Files:**
- Modify: `server/cutline.js` (`snapshot` car fields ~lines 2400 to 2440)
- Test: `server/cutline.test.js` (the airborne snapshot test ~line 2276; append)

**Interfaces:**
- Consumes: car drift fields from Task 4.
- Produces: snapshot car fields, each sent only while it applies: `drafting`, `boosting`, `sliding`, `spinning`, `airborne` (`true`); `drift` (`-1 | 1`) and `driftChain` (integer) while drifting; `driftScore` (integer) once above 0; `driftEnd: { pts, lost }` for `DRIFT_SHOW_MS` after an end. Tasks 7 and 8 read these.

- [ ] **Step 1: Write the failing tests**

Append:

```js
test('drift fields and status flags ride the snapshot only while they apply', () => {
  const match = racing(2)
  const [car] = [...match.cars.values()]
  const mine = () => snapshot(match).cars.find((c) => c.id === car.id)

  const idle = mine()
  for (const k of ['drift', 'driftChain', 'driftScore', 'driftEnd', 'drafting', 'boosting', 'sliding', 'spinning', 'airborne']) {
    assert.equal(k in idle, false, `${k} must be absent on a car doing nothing`)
  }

  Object.assign(car, { driftDir: -1, driftChain: 123.6, driftScore: 400 })
  const on = mine()
  assert.equal(on.drift, -1)
  assert.equal(on.driftChain, 124)
  assert.equal(on.driftScore, 400)

  car.driftEnd = { pts: 124, lost: true, at: match.now }
  assert.deepEqual(mine().driftEnd, { pts: 124, lost: true })
  match.now += hd.DRIFT_SHOW_MS
  assert.equal('driftEnd' in mine(), false, 'an ended chain is shown for DRIFT_SHOW_MS, then dropped')
})

test('eight cars drifting, boosting and drafting, with chains ending, fit the 4 KB frame', () => {
  const match = racing(MAX_PLAYERS)
  for (let i = 0; i < MAX_HAZARDS; i++) {
    match.hazards.push({ kind: 'slick', x: 40, y: 40, until: 9e9, by: 'p-1' })
  }
  for (const car of match.cars.values()) {
    Object.assign(car, {
      driftDir: 1,
      driftChain: 99999,
      driftScore: 99999,
      driftEnd: { pts: 99999, lost: false, at: match.now },
      boostUntil: match.now + 1000,
      drafting: true,
    })
  }
  const bytes = JSON.stringify(snapshot(match)).length
  assert.ok(bytes < 4096, `a full drifting frame is ${bytes} bytes, over maxPayload`)
})
```

In the existing test ending `assert.equal(after.airborne, false)` (~line 2276), replace that line with:

```js
  assert.ok(!after.airborne, 'a landed car is not airborne')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test --test-name-pattern="ride the snapshot only|fit the 4 KB frame" server/cutline.test.js`
Expected: the first FAILS on `drafting must be absent on a car doing nothing`. The second PASSES for now, because no drift field is on the wire yet; it is the guard for Step 3. Measured while planning: with Step 3 the worst case is 4031 bytes; with the drift fields but without the flag change it would be 4431.

- [ ] **Step 3: Write minimal implementation**

In `snapshot`, replace:

```js
      drafting: Boolean(car.drafting),
      boosting: match.now < car.boostUntil,
      sliding: Boolean(car.onSlick),
      spinning: match.now < (car.spinUntil ?? 0),
      airborne: match.now < (car.airUntil ?? 0),
```

with:

```js
      // Status flags are sent only while true, like the rare ones below: sent as
      // false on every car every tick they cost 670 bytes a frame, and the frame
      // needed that room for drift. The page reads a missing flag as false.
      ...(car.drafting && { drafting: true }),
      ...(match.now < car.boostUntil && { boosting: true }),
      ...(car.onSlick && { sliding: true }),
      ...(match.now < (car.spinUntil ?? 0) && { spinning: true }),
      ...(match.now < (car.airUntil ?? 0) && { airborne: true }),
```

After `...(match.now < (car.shockedUntil ?? 0) && { shocked: true }),`, add:

```js
      // Drift: the side and chain while drifting, the race total once there is
      // one, and how the last chain ended for DRIFT_SHOW_MS. The page draws the
      // end the rules decided; it never compares frames to guess it.
      ...(car.driftDir && { drift: car.driftDir, driftChain: Math.round(car.driftChain) }),
      ...(car.driftScore > 0 && { driftScore: car.driftScore }),
      ...(car.driftEnd && match.now - car.driftEnd.at < DRIFT_SHOW_MS && { driftEnd: { pts: car.driftEnd.pts, lost: car.driftEnd.lost } }),
```

- [ ] **Step 4: Run the Cutline suite and the page tests**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test server/cutline.test.js src/lib/*.test.js 2>&1 | tail -8`
Expected: all pass. The worst case sits about 65 bytes under the limit, so if the 4 KB test fails, report the byte count; do not raise the limit.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): drift rides the snapshot, and status flags only while true

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `carPose`, lean, pitch and bounce from received snapshots

**Files:**
- Create: `src/lib/carPose.js`
- Test: `src/lib/carPose.test.js`

**Interfaces:**
- Produces: `export const MAX_ROLL, MAX_PITCH, BOUNCE_KICK`; `export function makePose()` returns a state object; `export function stepPose(pose, car, dt)` mutates and returns `pose` with `roll` (radians, positive = leaning to the car's left, the outside of a right turn), `pitch` (radians, positive = nose up) and `bounce` (tiles, negative = dipped). `car` is `{ heading, speed, airborne }` from a sampled snapshot; `dt` is seconds. Task 7 calls these.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/carPose.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { makePose, stepPose, MAX_ROLL, MAX_PITCH, BOUNCE_KICK } from './carPose.js'

const FRAME = 1 / 60

/** Run a pose through `seconds` of frames, `at(t)` giving the car each frame. */
function run(pose, seconds, at) {
  for (let t = 0; t < seconds; t += FRAME) stepPose(pose, at(t), FRAME)
  return pose
}

test('a car standing still sits flat', () => {
  const pose = run(makePose(), 1, () => ({ heading: 0.4, speed: 0 }))
  // Near zero, not equal: strict equal is Object.is, and -0 is not 0.
  for (const k of ['roll', 'pitch', 'bounce']) assert.ok(Math.abs(pose[k]) < 1e-12, `${k} is ${pose[k]}`)
})

test('the body leans out of a turn, whichever way it turns', () => {
  // Heading rising is a right turn (steer +1); the body leans left, outward.
  const right = run(makePose(), 0.5, (t) => ({ heading: t * 2, speed: 10 }))
  const left = run(makePose(), 0.5, (t) => ({ heading: -t * 2, speed: 10 }))
  assert.ok(right.roll > 0, `a right turn leans left: ${right.roll}`)
  assert.ok(left.roll < 0, `a left turn leans right: ${left.roll}`)
})

test('the nose lifts under throttle and dips under braking', () => {
  const up = run(makePose(), 0.3, (t) => ({ heading: 0, speed: t * 15 }))
  const down = run(makePose(), 0.3, (t) => ({ heading: 0, speed: 14 - t * 15 }))
  assert.ok(up.pitch > 0, `accelerating: ${up.pitch}`)
  assert.ok(down.pitch < 0, `braking: ${down.pitch}`)
})

test('lean and pitch never pass their limits', () => {
  const pose = run(makePose(), 0.5, (t) => ({ heading: t * 40, speed: 30 + t * 200 }))
  assert.ok(Math.abs(pose.roll) <= MAX_ROLL + 1e-12, `roll ${pose.roll}`)
  assert.ok(Math.abs(pose.pitch) <= MAX_PITCH + 1e-12, `pitch ${pose.pitch}`)
})

test('touching down dips the body, and it settles within half a second', () => {
  const pose = makePose()
  stepPose(pose, { heading: 0, speed: 10, airborne: true }, FRAME)
  stepPose(pose, { heading: 0, speed: 10, airborne: true }, FRAME)
  stepPose(pose, { heading: 0, speed: 10, airborne: false }, FRAME)
  assert.ok(pose.bounce < 0, `landing must dip: ${pose.bounce}`)
  run(pose, 0.5, () => ({ heading: 0, speed: 10 }))
  assert.ok(Math.abs(pose.bounce) < BOUNCE_KICK * 0.1, `still bouncing after 0.5 s: ${pose.bounce}`)
})

test('a tab coming back after seconds away, or a bad dt, leaves the pose finite and in bounds', () => {
  const pose = makePose()
  stepPose(pose, { heading: 0, speed: 10 }, FRAME)
  for (const dt of [5, 0, -1, NaN, Infinity]) {
    stepPose(pose, { heading: 3, speed: 0, airborne: false }, dt)
    for (const k of ['roll', 'pitch', 'bounce']) assert.ok(Number.isFinite(pose[k]), `${k} went non finite at dt ${dt}`)
    assert.ok(Math.abs(pose.roll) <= MAX_ROLL + 1e-12)
    assert.ok(Math.abs(pose.pitch) <= MAX_PITCH + 1e-12)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test src/lib/carPose.test.js`
Expected: FAIL, `Cannot find module ... carPose.js`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/carPose.js`:

```js
// How a car's body sits on its wheels: lean, pitch and bounce. Pure and
// import-free; exercised by carPose.test.js. Render only: every input is a
// value from a snapshot the page has already received, and nothing here
// guesses ahead of one. The rules have no body roll, the same way they have
// no ramp height (carLift.js).

export const MAX_ROLL = 0.1          // rad, about 6 degrees
export const MAX_PITCH = 0.05        // rad, about 3 degrees
export const BOUNCE_KICK = 0.12      // tiles the body dips on touchdown
const ROLL_PER_ACCEL = 0.006         // rad of lean per tile/s² sideways
const PITCH_PER_ACCEL = 0.004        // rad of pitch per tile/s² forward
const EASE = 10                      // 1/s: how fast lean and pitch follow
const SPRING = 90                    // 1/s²: suspension stiffness
const DAMP = 14                      // 1/s: how fast the bounce settles, a little under critical
const MAX_DT = 0.05                  // a longer frame is stepped as this, so nothing overshoots

const clamp = (v, m) => Math.max(-m, Math.min(m, v))

export function makePose() {
  return { heading: null, speed: 0, airborne: false, roll: 0, pitch: 0, bounce: 0, bounceV: 0 }
}

/**
 * Advance one car's body by one frame. `car` is `{ heading, speed, airborne }`
 * from the sampled snapshot. Sideways acceleration is speed times yaw rate;
 * forward acceleration is the change in an eased speed, because `speed` arrives
 * in steps at the snapshot rate and its raw difference would twitch.
 */
export function stepPose(pose, car, dt) {
  const heading = Number.isFinite(car?.heading) ? car.heading : 0
  const speed = Number.isFinite(car?.speed) ? car.speed : 0
  const airborne = Boolean(car?.airborne)
  if (!(dt > 0)) return pose
  const h = Math.min(dt, MAX_DT)

  if (pose.heading === null) {
    pose.heading = heading
    pose.speed = speed
    pose.airborne = airborne
    return pose
  }

  const k = 1 - Math.exp(-EASE * h)
  const yawRate = Math.atan2(Math.sin(heading - pose.heading), Math.cos(heading - pose.heading)) / h
  const eased = pose.speed + (speed - pose.speed) * k
  const forward = (eased - pose.speed) / h

  pose.roll += (clamp(speed * yawRate * ROLL_PER_ACCEL, MAX_ROLL) - pose.roll) * k
  pose.pitch += (clamp(forward * PITCH_PER_ACCEL, MAX_PITCH) - pose.pitch) * k

  // Touchdown dips the body; a damped spring brings it back.
  if (pose.airborne && !airborne) pose.bounce = -BOUNCE_KICK
  pose.bounceV += (-SPRING * pose.bounce - DAMP * pose.bounceV) * h
  pose.bounce += pose.bounceV * h

  pose.heading = heading
  pose.speed = eased
  pose.airborne = airborne
  return pose
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --test src/lib/carPose.test.js`
Expected: PASS, 6 tests. If `settles within half a second` fails, raise `DAMP` toward critical damping (`2 * Math.sqrt(SPRING)` is about 19) rather than loosening the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/carPose.js src/lib/carPose.test.js
git commit -m "feat(cutline): carPose, lean, pitch and bounce from received snapshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The body moves, and drifting cars smoke

**Files:**
- Modify: `src/lib/cutlineScene.js` (imports; `buildCar`; shared layers; `update`; `dispose`)
- Modify: `src/pages/Cutline.jsx` (refs ~line 652; `connect` ~line 665 and welcome ~line 700 resets; skid loop ~line 914; `scene.update` call ~line 941)

**Interfaces:**
- Consumes: `makePose`, `stepPose` from Task 6; snapshot `drift` and `airborne` from Task 5.
- Produces: `export const SMOKE_MS` and `export const MAX_SMOKE` from `cutlineScene.js`; `scene.update` accepts `smoke: [{ x, y, at }]`.

No unit test: this is three.js wiring, which the repo does not test (`cutlineScene.js` has no test file). The maths it applies is Task 6's, which is tested. Verification is the build, the bundle check and a look in the browser.

- [ ] **Step 1: Chassis group in `buildCar`**

In `src/lib/cutlineScene.js`, add to the imports:

```js
import { makePose, stepPose } from './carPose.js'
```

In `buildCar`, replace:

```js
  const body = new THREE.Mesh(shared.body, paint)
  body.position.y = 0.2
  const cabin = new THREE.Mesh(shared.cabin, shared.glass)
  cabin.position.set(-CAR_LENGTH * 0.05, CAR_ROOF - 0.1, 0)
  group.add(body, cabin)
```

with:

```js
  // The body, cabin and lamps lean, pitch and bounce as one; the wheels stay
  // on the road. carPose.js decides how far.
  const chassis = new THREE.Group()
  group.add(chassis)
  const body = new THREE.Mesh(shared.body, paint)
  body.position.y = 0.2
  const cabin = new THREE.Mesh(shared.cabin, shared.glass)
  cabin.position.set(-CAR_LENGTH * 0.05, CAR_ROOF - 0.1, 0)
  chassis.add(body, cabin)
```

In the lamp loop, replace `group.add(head, tail)` with `chassis.add(head, tail)`. Replace the return with:

```js
  return { group, chassis, shadow, paint, brake, front, bubble, color: null }
```

- [ ] **Step 2: Smoke layer and pose state**

After `const MAX_SKIDS = 500 ...` add:

```js
export const MAX_SMOKE = 256
export const SMOKE_MS = 600 // how long a drift's tyre smoke hangs before it is gone
```

After the skid layer (`scene.add(skids)`), add:

```js
  // Tyre smoke from a drift: puffs that rise and swell as they age. One shade,
  // like skids, since an InstancedMesh has no per-instance opacity.
  const smokeGeo = new THREE.IcosahedronGeometry(0.22, 0)
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0xbfbfc4, transparent: true, opacity: 0.3, depthWrite: false })
  const smoke = dynamicLayer(smokeGeo, smokeMat, MAX_SMOKE)
  scene.add(smoke)

  // Per car id, not per pool slot: the pool is indexed by join order, which a
  // car leaving reshuffles.
  const poses = new Map()
  let lastNow = 0
```

- [ ] **Step 3: Apply the pose and draw the smoke in `update`**

At the top of `update(frame)`, after `const palette = frame?.palette ?? []`:

```js
      const dt = lastNow ? (now - lastNow) / 1000 : 0
      lastNow = now
```

In the per-car loop, after `c.group.rotation.y = yawFor(car.heading)`:

```js
        let pose = poses.get(car.id)
        if (!pose) poses.set(car.id, (pose = makePose()))
        stepPose(pose, car, dt)
        // The car's right is +z, so leaning left (positive roll) turns about x
        // the negative way; nose up is positive about z.
        c.chassis.rotation.set(-pose.roll, 0, pose.pitch)
        c.chassis.position.y = pose.bounce
```

After the per-car loop, before `const ps = frame?.pickups ?? []`:

```js
      if (poses.size > cars.length) {
        const here = new Set(cars.map((car) => car.id))
        for (const id of poses.keys()) if (!here.has(id)) poses.delete(id)
      }
```

After the skid block (`skids.instanceMatrix.needsUpdate = true`):

```js
      const sm = frame?.smoke ?? []
      smoke.count = Math.min(sm.length, MAX_SMOKE)
      for (let i = 0; i < smoke.count; i++) {
        const age = Math.min(1, (now - sm[i].at) / SMOKE_MS)
        scratch.position.set(...toWorld(sm[i].x, sm[i].y, 0.15 + age * 0.6))
        scratch.rotation.set(0, age * 2, 0)
        scratch.scale.setScalar(0.6 + age * 1.6)
        scratch.updateMatrix()
        smoke.setMatrixAt(i, scratch.matrix)
      }
      scratch.scale.set(1, 1, 1)
      smoke.instanceMatrix.needsUpdate = true
```

In `dispose`, change the three layer lists to include the smoke:

```js
      for (const mesh of [pickups, slicks, peels, pucks, decoys, unknowns, skids, smoke]) mesh.dispose()
      for (const g of [pickupGeo, slickGeo, peelGeo, puckGeo, decoyGeo, unknownGeo, skidGeo, smokeGeo]) g.dispose()
      for (const m of [pickupMat, slickMat, peelMat, puckMat, decoyMat, unknownMat, skidMat, smokeMat]) m.dispose()
```

- [ ] **Step 4: The page drops skids and smoke for drifting cars**

In `src/pages/Cutline.jsx`, change the scene import to:

```js
import { makeCutlineScene, SMOKE_MS, MAX_SMOKE } from '../lib/cutlineScene.js'
```

After `const skidsRef = useRef([])`:

```js
  const smokeRef = useRef([])
```

Everywhere `skidsRef.current = []` appears (in `connect` and in the `welcome` handler), add on the next line:

```js
    smokeRef.current = []
```

(indented to match the line above it).

In the skid loop, replace `if (car.alive && car.sliding) {` with:

```js
        if (car.alive && (car.sliding || car.drift)) {
```

and after that `if` block's closing brace (still inside `for (const car of cars)`), add:

```js
        // A drift smokes from the tail.
        if (car.alive && car.drift) {
          smokeRef.current.push({ x: car.x - Math.cos(car.heading) * 0.6, y: car.y - Math.sin(car.heading) * 0.6, at: now })
        }
```

After `skidsRef.current = skidsRef.current.filter((s) => now - s.at < 3500)`:

```js
      smokeRef.current = smokeRef.current.filter((s) => now - s.at < SMOKE_MS).slice(-MAX_SMOKE)
```

In the `scene?.update({` call, after `skids: skidsRef.current,`:

```js
        smoke: smokeRef.current,
```

- [ ] **Step 5: Build and check the bundle**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run build 2>&1 | tail -3 && npm run check:bundle`
Expected: build succeeds (the existing chunk-size warning is fine); `check:bundle` passes (three.js stays out of the main chunk).

- [ ] **Step 6: Look at it**

Run `npm run dev` and `npm run cutline` in two terminals (restart `cutline` if it was already running), open `http://localhost:5173/cutline`, start against bots.
Expected: the body leans out of corners and dips under braking while the wheels stay on the road; a car landing from a ramp dips and settles; holding Shift and a steer at speed lays skid marks and grey puffs from the tail.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cutlineScene.js src/pages/Cutline.jsx
git commit -m "feat(cutline): the body leans, pitches and bounces, and drifts smoke

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Shift to drift, the drift HUD and the needle speedometer

**Files:**
- Modify: `src/pages/Cutline.jsx` (imports; speedometer constants and `drawHud` ~lines 436 to 540; new `drawDrift`; refs; input loop ~line 766; HUD call ~line 1135; `sr-only` ~line 1369; roster ~lines 1400 to 1450; controls list ~line 1470)

**Interfaces:**
- Consumes: snapshot `drift`, `driftChain`, `driftScore`, `driftEnd`, `boosting`, `drafting` from Task 5; `DRIFT_SHOW_MS` from `server/cutline.js`.
- Produces: input message field `drift: 0 | 1`.

No unit test: canvas drawing and JSX, which the repo checks by building and looking. The rules these draw are tested in Tasks 4 and 5.

- [ ] **Step 1: Send Shift**

Add `DRIFT_SHOW_MS,` to the import list from `'../../server/cutline.js'` (after `SLIP_BOOST,`).

In the input loop, after `const use = keys.has('Space') || keys.has('KeyE') || keys.has('KeyF')`:

```js
      const drift = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0
```

and in the sent object, after `use,`:

```js
          drift,
```

- [ ] **Step 2: Replace the speedometer with a needle dial**

`KMH_PER_TILE`, `SPEEDO_MAX` and `HUD_PAD` stay as they are. In `drawHud`, replace everything from `// Bottom right: the speedometer.` down to (not including) the final `ctx.restore()` with:

```js
  // Bottom right: the speedometer.
  drawSpeedo(ctx, me, shownSpeed)
```

Add after `drawHud`:

```js
/**
 * A needle dial: ticks every 20 km/h and a number every 40. The stretch past
 * plain top speed is hatched and labelled BOOST, so it reads without colour.
 */
function drawSpeedo(ctx, me, shownSpeed) {
  const r = 66
  const cx = CANVAS - HUD_PAD - r - 8
  const cy = CANVAS - HUD_PAD - r - 8
  const maxKmh = SPEEDO_MAX * KMH_PER_TILE
  const topKmh = TOP_SPEED * KMH_PER_TILE
  const start = Math.PI * 0.75
  const sweep = Math.PI * 1.5
  const angleAt = (kmh) => start + sweep * Math.max(0, Math.min(1, kmh / maxKmh))
  const at = (a, rad) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]

  ctx.save()
  ctx.fillStyle = 'rgba(11, 11, 15, 0.85)'
  ctx.beginPath()
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2)
  ctx.fill()

  // The boost zone: a hatched band from top speed to the end of the dial.
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, angleAt(topKmh), angleAt(maxKmh))
  ctx.arc(cx, cy, r - 12, angleAt(maxKmh), angleAt(topKmh), true)
  ctx.closePath()
  ctx.clip()
  ctx.strokeStyle = 'rgba(249, 115, 22, 0.75)'
  ctx.lineWidth = 2
  for (let d = -3 * r; d < r; d += 6) {
    ctx.beginPath()
    ctx.moveTo(cx + d, cy - r)
    ctx.lineTo(cx + d + 2 * r, cy + r)
    ctx.stroke()
  }
  ctx.restore()

  ctx.strokeStyle = '#ecebe6'
  ctx.fillStyle = '#8f8d86'
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let kmh = 0; kmh <= maxKmh; kmh += 20) {
    const a = angleAt(kmh)
    const long = kmh % 40 === 0
    ctx.lineWidth = long ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(...at(a, r - (long ? 10 : 6)))
    ctx.lineTo(...at(a, r))
    ctx.stroke()
    if (long) ctx.fillText(String(kmh), ...at(a, r - 21))
  }
  ctx.fillStyle = '#f97316'
  ctx.font = 'bold 8px monospace'
  ctx.fillText('BOOST', ...at(angleAt((topKmh + maxKmh) / 2), r - 33))

  // The needle, from a short tail through the hub.
  const a = angleAt(shownSpeed * KMH_PER_TILE)
  ctx.strokeStyle = me.boosting ? '#f97316' : '#ecebe6'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(...at(a + Math.PI, 10))
  ctx.lineTo(...at(a, r - 8))
  ctx.stroke()
  ctx.fillStyle = '#ecebe6'
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fill()

  // The reading sits in the gap at the bottom of the dial.
  ctx.font = 'bold 20px monospace'
  ctx.fillText(String(Math.round(shownSpeed * KMH_PER_TILE)), cx, cy + 34)
  ctx.fillStyle = '#8f8d86'
  ctx.font = '9px monospace'
  ctx.fillText('KM/H', cx, cy + 49)
  const tag = me.boosting ? 'BOOST' : me.drafting ? 'DRAFT' : ''
  if (tag) {
    ctx.fillStyle = me.boosting ? '#f97316' : '#3ad1c4'
    ctx.font = 'bold 9px monospace'
    ctx.fillText(tag, cx, cy + 61)
  }
  ctx.restore()
}
```

- [ ] **Step 3: Drift total in the top-left panel**

In `drawHud`, change `panel(ctx, HUD_PAD, HUD_PAD, 196, 92)` to `panel(ctx, HUD_PAD, HUD_PAD, 196, 110)`, and after the `LEADER` `fillText` line add:

```js
  ctx.fillText(`DRIFT ${(me.driftScore ?? 0).toLocaleString('en-US')}`, HUD_PAD + 12, HUD_PAD + 100)
```

- [ ] **Step 4: The drift counter and its end**

Add after `drawSpeedo`:

```js
/**
 * The drift chain, top centre: growing and beating faster while it builds,
 * then shown as +N when banked or LOST struck through when lost. The words and
 * the strike carry which, not only the colour.
 */
function drawDrift(ctx, me, now, end) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const x = CANVAS / 2

  if (me.drift) {
    const chain = me.driftChain ?? 0
    const beat = 1 + 0.06 * Math.sin(now / Math.max(45, 140 - chain / 40))
    ctx.fillStyle = 'rgba(11, 11, 15, 0.8)'
    ctx.fillRect(x - 90, 22, 180, 58)
    ctx.fillStyle = '#8f8d86'
    ctx.font = 'bold 11px monospace'
    ctx.fillText('DRIFT', x, 36)
    ctx.save()
    ctx.translate(x, 60)
    ctx.scale(beat, beat)
    ctx.fillStyle = '#ecebe6'
    ctx.font = 'bold 28px monospace'
    ctx.fillText(chain.toLocaleString('en-US'), 0, 0)
    ctx.restore()
  }

  if (end) {
    const t = Math.min(1, (now - end.at) / DRIFT_SHOW_MS)
    const y = 104 - t * 30
    const pts = end.pts.toLocaleString('en-US')
    ctx.globalAlpha = 1 - t
    if (end.lost) {
      ctx.fillStyle = '#eab308'
      ctx.font = 'bold 18px monospace'
      ctx.fillText('LOST', x, y)
      ctx.font = 'bold 14px monospace'
      ctx.fillText(pts, x, y + 20)
      const w = ctx.measureText(pts).width
      ctx.fillRect(x - w / 2 - 2, y + 19, w + 4, 2)
    } else {
      ctx.fillStyle = '#3ad1c4'
      ctx.font = 'bold 22px monospace'
      ctx.fillText(`+${pts}`, x, y)
    }
  }
  ctx.restore()
}
```

After `const shownSpeedRef = useRef(0)` add:

```js
  // When this client first saw the current drift end, so its popup rises and
  // fades from then. The rules decide the end; this only times the drawing.
  const driftEndRef = useRef({ key: null, at: 0 })
```

In the frame loop, inside `if (me) {` after the `drawHud(...)` call and before the wrong-way line:

```js
        const endKey = me.driftEnd ? `${me.driftEnd.pts}:${me.driftEnd.lost}` : null
        if (endKey !== driftEndRef.current.key) driftEndRef.current = { key: endKey, at: now }
        if (sampled.phase === 'racing' && (me.drift || me.driftEnd)) {
          drawDrift(ctx, me, now, me.driftEnd && { ...me.driftEnd, at: driftEndRef.current.at })
        }
```

- [ ] **Step 5: Screen reader, roster and controls**

In the `sr-only` paragraph, after the `Item:` line:

```jsx
            {`Drift points: ${(me?.driftScore ?? 0).toLocaleString('en-US')}. `}
```

In the Driver Roster header, replace `<p className="rule-label">Best Lap</p>` with:

```jsx
              <p className="rule-label">Drift / Best Lap</p>
```

In each roster row, replace:

```jsx
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted">
                      {formatLapTime(car.bestLapMs)}
                    </span>
```

with:

```jsx
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted">
                      {car.driftScore ? car.driftScore.toLocaleString('en-US') : '-'}
                    </span>
                    <span className="w-16 text-right font-mono text-xs tabular-nums text-muted">
                      {formatLapTime(car.bestLapMs)}
                    </span>
```

In the Controls list, after the `Brake / Reverse` row:

```jsx
              <div className="flex justify-between gap-3">
                <dt>Drift</dt>
                <dd className="font-mono text-xs text-fg">Shift + steer</dd>
              </div>
```

- [ ] **Step 6: Build**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run build 2>&1 | tail -3 && npm run check:bundle`
Expected: build succeeds; `check:bundle` passes.

- [ ] **Step 7: Look at it**

With `npm run dev` and a freshly restarted `npm run cutline`, open `/cutline` and race.
Expected: the needle sweeps 0 to 220 with ticks every 20 and numbers every 40, the band past 140 is hatched and labelled BOOST, and the reading sits in the gap below. Shift and a steer above 60 km/h shows `DRIFT` with a growing number at the top centre; letting go shows `+N` rising and fading; hitting a wall mid-drift shows `LOST` with the number struck through. The top-left panel and the roster show the drift total, and the Controls list shows Shift + steer.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Cutline.jsx
git commit -m "feat(cutline): Shift to drift, the drift HUD and a needle speedometer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Measure, and write down what now fails silently

**Files:**
- Create: `server/cutline-laps.mjs`
- Modify: `server/cutline.js` (the `// Measured lap time` comment above `TOP_SPEED`)
- Modify: `CLAUDE.md` (Commands; the Cutline invariants)

**Interfaces:**
- Produces: `node server/cutline-laps.mjs`, which the bot AI task reuses.

- [ ] **Step 1: Commit the measurement tool**

Create `server/cutline-laps.mjs`:

```js
// Offline lap timing. Never imported by the game: it runs 4 bots on every
// circuit with a fixed rng and prints each circuit's median lap, so a handling
// or bot change is judged by measurement rather than by feel alone.
//
// Run: export PATH="/c/Program Files/nodejs:$PATH" && node server/cutline-laps.mjs
import { CIRCUITS, BOT_NAMES, make, join, startRace, tick, TICK_MS } from './cutline.js'

const RUN_MS = 90000
const BOTS = 4
const all = []

for (let i = 0; i < CIRCUITS.length; i++) {
  const match = make({ circuitIndex: i })
  for (let b = 0; b < BOTS; b++) join(match, { name: BOT_NAMES[b], bot: true }, () => 0.5)
  startRace(match)

  const laps = []
  const seen = new Map()
  for (let t = 0; t < RUN_MS && match.phase === 'racing'; t += TICK_MS) {
    tick(match, TICK_MS, () => 0.5)
    for (const car of match.cars.values()) {
      const at = seen.get(car.id) ?? { lap: 0, since: 0 }
      if (car.lap > at.lap) {
        // The roll off the grid is not a lap.
        if (at.lap > 0) laps.push(match.elapsed - at.since)
        seen.set(car.id, { lap: car.lap, since: match.elapsed })
      } else {
        seen.set(car.id, at)
      }
    }
  }

  laps.sort((a, b) => a - b)
  all.push(...laps)
  const s = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(2) : '  -  ')
  console.log(`${CIRCUITS[i].name.padEnd(13)} laps ${String(laps.length).padStart(2)}  median ${s(laps[Math.floor(laps.length / 2)])}s  range ${s(laps[0])}-${s(laps.at(-1))}s`)
}

all.sort((a, b) => a - b)
console.log(`ALL median ${(all[Math.floor(all.length / 2)] / 1000).toFixed(2)}s over ${all.length} laps`)
```

- [ ] **Step 2: Measure**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node server/cutline-laps.mjs`
Expected: every circuit shows at least 3 laps. Compare against the Baseline section of this plan. Any circuit at 0 laps, or a median more than 25% slower than its baseline, is a regression: stop and report it rather than tuning around it here.

- [ ] **Step 3: Update the lap-time comment**

In `server/cutline.js`, replace the comment block above `export const TOP_SPEED` (from `// Measured lap time (Task 7, after the driveBots aim-anchor fix)` through `// the fix.`) with, filling in the numbers Step 2 printed:

```js
// Measured lap time (server/cutline-laps.mjs: 4 bots, rng 0.5, 90 s a
// circuit). Before the weight, grip-fade and drift handling: median 25.14 s
// over 66 laps. After: median <ALL median>s over <N> laps, every circuit
// lapping. The old note here (11.87 s) predated the current track generator.
```

- [ ] **Step 4: Update CLAUDE.md**

In the Commands block, after `node server/cutline-select.mjs   # regenerate CIRCUITS by measured difference`, add:

```
node server/cutline-laps.mjs     # median bot lap per circuit, for tuning handling
```

In `## Invariants that fail silently`, replace the bullet beginning `- **Cutline: rare snapshot flags are sent only while true.**` with:

```markdown
- **Cutline: status flags are sent only while true.** `drafting`, `boosting`,
  `sliding`, `spinning`, `airborne`, `shield`, `ghost`, `shocked`, `hop`,
  `wrongWay`, `falling`, `land`, `drift`, `driftChain`, `driftScore` and
  `driftEnd` would push a frame of eight cars past its 4 KB budget if every car
  always carried them; the page reads a missing flag as false. The first five
  were sent as `false` until drift needed the 670 bytes they cost.
```

After the bullet beginning `- **Cutline: a car's collision shape derives from the car that is drawn.**`, add:

```markdown
- **Cutline: handling changes never touch the speed envelope.** `TOP_SPEED`,
  `BOOST_MULT`, `SLIP_BOOST`, `RAMP_MIN_SPEED` and `AIR_MS` are what every ramp
  landing, pad flight, hole and the eight selected circuits were checked
  against. Weight, grip fade and drift change how a car reaches those speeds,
  never the speeds.
- **Cutline: `steerNow` eases the wheel, not the heading.** The held key moves
  `steerNow` over `STEER_IN` / `STEER_OUT` and the heading still turns at a
  rate. A test that sets `car.steer` and expects full lock on the next step
  must set `steerNow` too, or the wheel carries over from its last setup.
- **Cutline: brake cuts thrust.** With `BRAKE` soft enough for a one second
  stop, a car holding both accelerated below about 7 tiles/s, and every bot
  holds both.
- **Cutline: a drift keeps its speed; `DRIFT_GRIP` only sets the slip angle.**
  Sideways speed is turned forward, not scrubbed. Scrubbed, the turn rate a
  hairpin needs bled speed faster than any throttle could replace.
- **Cutline: a drift chain's end is a rule.** `endDrift` decides banked or
  lost, and the snapshot carries `driftEnd` for `DRIFT_SHOW_MS`; the page never
  compares frames to guess it. Drift points are never banked on the board.
- **Cutline: `carPose` reads only received snapshots.** Lean, pitch and bounce
  come from interpolated heading and speed, render only, like `carLift`.
```

- [ ] **Step 5: Full verification**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -3 && npm run check:bundle`
Expected: `fail 0`; build succeeds; bundle check passes.

- [ ] **Step 6: Commit**

```bash
git add server/cutline-laps.mjs server/cutline.js CLAUDE.md
git commit -m "docs(cutline): measure handling by lap time, and record its invariants

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Feel pass**

Ask the driver to race two or three circuits and say what feels off. Every value is a named constant (`STEER_IN`, `GRIP_FALLOFF`, `ACCEL`, `BRAKE`, `WALL_*`, `DRIFT_*`, and the `carPose` constants), so each adjustment is a one-line change followed by Step 2 and Step 5 again.
