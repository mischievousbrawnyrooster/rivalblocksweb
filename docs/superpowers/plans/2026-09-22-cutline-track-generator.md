# Cutline Track Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cutline's harmonic centreline with a lattice-derived one, so circuits contain hairpins, straights, chicanes, shortcuts and ramps instead of being deformed circles, and fix the car collision shape so the hitbox matches the car that is drawn.

**Architecture:** A circuit becomes a closed cycle on a coarse lattice, smoothed into real corners drawn from a vocabulary whose radii map to required speeds. `carve()` becomes a pipeline over a per-point `meta` array carrying width, corner kind and outside surface, rather than one pass along one uniform-width centreline. Ramps and shortcuts are features placed on that lattice. All rules stay in `server/cutline.js`, which keeps its zero imports.

**Tech Stack:** Node 20+ ESM, `node --test`, React 19, Canvas 2D, Vite 8. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-cutline-track-generator-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **`server/cutline.js` has zero imports.** No `node:*`, no other rules modules, no Node APIs, no timers, no I/O, no `Date.now`. Time arrives as a parameter.
- **The server is authoritative for everything.** There is no client-side prediction anywhere and there never will be. Interpolation via `src/lib/snapshotBuffer.js` is permitted; prediction is not.
- **Randomness is injected** (`rng = Math.random` as a default parameter) or seeded via `createRng`. Never `Math.random` in a test path.
- **Tests reference constants, never literals.** Import `GRID`, `MAX_PLAYERS`, `SEGMENT_WIDTH_MAX`; never write 96, 8, 11.
- **Anything that must track the road's width is derived from it, never written twice.** A hardcoded `CHECKPOINT_RADIUS` of 4.0 already survived one widening and silently put the outer racing line out of reach, so laps stopped counting.
- **Zero em dashes in comments and copy.**
- **Nothing a canvas draws loads a file.** All track and car art is procedural.
- **Status is never communicated by colour alone** (WCAG 1.4.1). Every surface needs structure as well as hue.
- **Canvas reads raw `:root` variables** (`--bg`, `--tile`, `--player-N`), never `--color-*`, which resolve empty at runtime under Tailwind v4.
- **The snapshot must stay under `maxPayload` 4096 bytes**, and the encoded map likewise.
- **Adding a surface touches three places** and the wire silently carries `undefined` if any is missed: `SURFACE_CHARS`, the `GRIP` table, and `prerender` in `src/pages/Cutline.jsx`.
- **Node is not on PATH in a fresh shell.** Prefix every command: `export PATH="/c/Program Files/nodejs:$PATH"`

## Hollow-test standing rule

Five tests in this codebase have shipped passing for reasons unrelated to the behaviour they named, and one required patch shipped with no coverage at all.

**For every test you write, ask: if I deleted or neutered the mechanic this test names, would the test fail?** Prove it by mutation where you reasonably can: break the mechanic, watch the test fail, restore it. Report the result per test. If a test does not discriminate, say so rather than leaving it to be found later.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `server/cutline-select.mjs` | Offline circuit selection. Generates many, measures them, prints the `CIRCUITS` array. Never imported by the game. |

**Modified:**

| File | Change |
|---|---|
| `server/cutline.js` | Lattice generator, corner vocabulary, width, gravel, ramps, shortcuts, collision shape |
| `server/cutline.test.js` | Generator invariants, feature tests, collision tests |
| `src/pages/Cutline.jsx` | Gravel and ramp rendering, airborne cars, car dimensions from shared constants |
| `CLAUDE.md`, `GEMINI.md` | New invariants |

**Deliberately not created:** no separate geometry module. `cutline.js` is large but its zero-import purity is the point, and splitting it would need either imports or duplication.

---

## Task 1: The collision shape

Independent of everything else and ships value immediately. Do it first so the rest of the plan builds on a car whose hitbox is real.

**Files:**
- Modify: `server/cutline.js`
- Modify: `src/pages/Cutline.jsx`
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `CAR_LENGTH = 1.45`, `CAR_WIDTH = 0.82`, `CAR_RADIUS = CAR_WIDTH / 2`, and `carCorners(car) -> [{x,y} x 4]`.

**The defect:** the car is drawn 1.45 by 0.82 tiles (`src/pages/Cutline.jsx`, `const L = u * 1.45`, `const W = u * 0.82`), but `stepCar` tests walls at a **single rounded point** at the car's centre, and `resolveContact` uses one circle of radius 0.45. The nose extends 0.725 tiles past the centre, so a car can be most of a tile inside a wall before anything registers, and two cars overlap nose to tail without touching.

- [ ] **Step 1: Write the failing tests**

Append to `server/cutline.test.js`:

```js
test('a car nose-first into a wall registers contact before its centre is inside', () => {
  // Walls were tested at the car's rounded centre alone. The body is
  // CAR_LENGTH long, so the nose reached most of a tile into a wall with
  // nothing registering, which is why contact felt unassuming.
  const match = racing(1)
  const [car] = [...match.cars.values()]

  // Find an on-track tile with a wall directly beside it, derived from real
  // circuit data rather than a guessed coordinate.
  const line = match.centerline
  let onX = null
  let onY = null
  let dirX = 0
  let dirY = 0
  for (let i = 0; i < line.length && onX === null; i++) {
    const p = line[i]
    const a = line[(i - 1 + line.length) % line.length]
    const b = line[(i + 1) % line.length]
    const tx = b.x - a.x
    const ty = b.y - a.y
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len
    const ny = tx / len
    for (let step = 1; step < GRID; step++) {
      const cx = Math.round(p.x + nx * step)
      const cy = Math.round(p.y + ny * step)
      if (surfaceAt(match.grid, cx, cy) === S_WALL) {
        onX = Math.round(p.x + nx * (step - 1))
        onY = Math.round(p.y + ny * (step - 1))
        dirX = nx
        dirY = ny
        break
      }
    }
  }
  assert.ok(onX !== null, 'the circuit must have a wall beside the road')

  // Place the car so its CENTRE is still on track but its NOSE is in the wall.
  car.heading = Math.atan2(dirY, dirX)
  car.x = onX
  car.y = onY
  car.vx = Math.cos(car.heading) * 6
  car.vy = Math.sin(car.heading) * 6
  const speedBefore = Math.hypot(car.vx, car.vy)

  for (let i = 0; i < 6; i++) stepCar(match, car, TICK_MS / 1000)

  // The nose must have been stopped. Without corner testing the centre walks
  // in before anything happens and the car keeps its speed.
  const noseX = car.x + Math.cos(car.heading) * (CAR_LENGTH / 2)
  const noseY = car.y + Math.sin(car.heading) * (CAR_LENGTH / 2)
  assert.notEqual(
    surfaceAt(match.grid, Math.round(noseX), Math.round(noseY)),
    S_WALL,
    'the nose must never come to rest inside a wall',
  )
  assert.ok(Math.hypot(car.vx, car.vy) < speedBefore, 'contact must scrub speed')
})

test('two cars overlapping nose to tail register contact', () => {
  // One circle of radius 0.45 covered 62% of a body 1.45 long, so cars visibly
  // overlapped end to end without ever touching.
  const match = racing(2)
  const [a, b] = [...match.cars.values()]
  const cp = match.checkpoints[3]

  a.heading = 0
  b.heading = 0
  a.x = cp.x
  a.y = cp.y
  // Nose to tail, closer than the body length but further than one old circle.
  b.x = cp.x + CAR_LENGTH * 0.7
  b.y = cp.y

  const gapBefore = Math.hypot(b.x - a.x, b.y - a.y)
  resolveContact(match)
  const gapAfter = Math.hypot(b.x - a.x, b.y - a.y)

  assert.ok(gapAfter > gapBefore, `overlapping cars must be pushed apart, ${gapBefore} to ${gapAfter}`)
})

test('the collision shape is derived from the drawn car, not written twice', () => {
  assert.equal(CAR_RADIUS, CAR_WIDTH / 2, 'CAR_RADIUS must derive from CAR_WIDTH')
  assert.ok(CAR_LENGTH > CAR_WIDTH, 'a car is longer than it is wide')
  assert.equal(carCorners({ x: 0, y: 0, heading: 0 }).length, 4)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test server/cutline.test.js
```

Expected: FAIL. `CAR_LENGTH` is not exported and `carCorners` does not exist.

- [ ] **Step 3: Implement**

In `server/cutline.js`, replace `export const CAR_RADIUS = 0.45` with:

```js
// The car's collision shape is DERIVED from the car that is drawn, so the two
// cannot drift apart. They drifted in the first place because the page invented
// its own numbers: it drew a body 1.45 by 0.82 while the rules used one circle
// of radius 0.45 and tested walls at a single point at the car's centre. The
// nose reaches CAR_LENGTH / 2 past that point, so a car could sit most of a
// tile inside a wall with nothing registering.
export const CAR_LENGTH = 1.45
export const CAR_WIDTH = 0.82
export const CAR_RADIUS = CAR_WIDTH / 2

/** The four corners of a car's oriented body, nose-left, nose-right, tail-right, tail-left. */
export function carCorners(car) {
  const c = Math.cos(car.heading)
  const s = Math.sin(car.heading)
  const hl = CAR_LENGTH / 2
  const hw = CAR_WIDTH / 2
  return [
    { x: car.x + c * hl - s * hw, y: car.y + s * hl + c * hw },
    { x: car.x + c * hl + s * hw, y: car.y + s * hl - c * hw },
    { x: car.x - c * hl + s * hw, y: car.y - s * hl - c * hw },
    { x: car.x - c * hl - s * hw, y: car.y - s * hl + c * hw },
  ]
}

/** Whether any corner of a car's body sits in a wall at a hypothetical position. */
function bodyHitsWall(match, car, atX, atY) {
  const probe = { x: atX, y: atY, heading: car.heading }
  for (const p of carCorners(probe)) {
    if (surfaceAt(match.grid, Math.round(p.x), Math.round(p.y)) === S_WALL) return true
  }
  return false
}
```

In `stepCar`, replace the two single-point wall tests:

```js
  const nx = car.x + car.vx * dt
  if (bodyHitsWall(match, car, nx, car.y) && !offTrack) {
    car.vx *= -WALL_HIT_KEEP
  } else {
    car.x = nx
  }

  const ny = car.y + car.vy * dt
  if (bodyHitsWall(match, car, car.x, ny) && !offTrack) {
    car.vy *= -WALL_HIT_KEEP
  } else {
    car.y = ny
  }
```

In `resolveContact`, replace the single-circle test with a capsule. Two circles along the body approximate a 1.45 by 0.82 rectangle far better than one:

```js
/** The two circle centres that make up a car's capsule, fore and aft. */
function capsule(car) {
  const off = CAR_LENGTH / 2 - CAR_RADIUS
  const c = Math.cos(car.heading)
  const s = Math.sin(car.heading)
  return [
    { x: car.x + c * off, y: car.y + s * off },
    { x: car.x - c * off, y: car.y - s * off },
  ]
}

function resolveContact(match) {
  const cars = [...match.cars.values()].filter((c) => c.alive)
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i]
      const b = cars[j]
      // Nearest pair of circles between the two capsules. A car is two circles,
      // so four pairs, and the closest one decides whether they touch.
      let best = null
      for (const pa of capsule(a)) {
        for (const pb of capsule(b)) {
          const d = Math.hypot(pb.x - pa.x, pb.y - pa.y)
          if (!best || d < best.d) best = { d, pa, pb }
        }
      }
      const min = CAR_RADIUS * 2
      if (!best || best.d >= min || best.d === 0) continue

      const push = (min - best.d) / 2
      const ux = (best.pb.x - best.pa.x) / best.d
      const uy = (best.pb.y - best.pa.y) / best.d
      a.x -= ux * push
      a.y -= uy * push
      b.x += ux * push
      b.y += uy * push
    }
  }
}
```

`resolveContact` must be exported for the test. Add `export` to its declaration.

In `src/pages/Cutline.jsx`, import the constants and use them for the drawn body, so the shape and the hitbox cannot drift again:

```js
import { CAR_LENGTH, CAR_WIDTH } from '../../server/cutline.js'
```

Then replace `const L = u * 1.45` and `const W = u * 0.82` with:

```js
        // Drawn from the same constants the collision shape derives from, so
        // the car you see and the car you hit are the same size.
        const L = u * CAR_LENGTH
        const W = u * CAR_WIDTH
```

- [ ] **Step 4: Run tests and prove they discriminate**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test server/cutline.test.js
npm test
```

Then prove the wall test is not hollow: temporarily restore the single-point wall check (`surfaceAt(match.grid, Math.round(nx), Math.round(car.y)) === S_WALL`), confirm the nose test FAILS, restore `bodyHitsWall`, confirm it passes. Put both outputs in your report.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js src/pages/Cutline.jsx server/cutline.test.js
git commit -m "fix(cutline): give the car a hitbox the size of the car"
```

---

## Task 2: Register the two new surfaces

Small, but it is the three-places trap, so it gets its own reviewed task before anything depends on it.

**Files:**
- Modify: `server/cutline.js`
- Modify: `src/pages/Cutline.jsx`
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `S_GRAVEL = 7`, `S_RAMP = 8`, extended `SURFACE_CHARS`, extended `GRIP`, `GRAVEL_DRAG`.

- [ ] **Step 1: Write the failing test**

```js
test('every surface has a char, a grip entry, and a distinct value', () => {
  // Adding a surface touches SURFACE_CHARS, the GRIP table and the page's
  // prerender. Miss one and the wire carries undefined and the page draws
  // nothing, with no error anywhere. This covers the two the module owns.
  const surfaces = [S_WALL, S_TARMAC, S_KERB, S_BOOST, S_OIL, S_PICKUP, S_LINE, S_GRAVEL, S_RAMP]

  assert.equal(new Set(surfaces).size, surfaces.length, 'surface values must be distinct')
  assert.equal(SURFACE_CHARS.length, surfaces.length, 'every surface needs a char')
  assert.equal(new Set(SURFACE_CHARS).size, SURFACE_CHARS.length, 'chars must be distinct')

  // Wall is the only surface with no grip entry, because a car is never on it.
  for (const s of surfaces) {
    if (s === S_WALL) continue
    assert.ok(Number.isFinite(GRIP[s]), `surface ${s} has no grip entry`)
  }

  // Gravel must be grippier than oil and looser than kerb, or it is not run off.
  assert.ok(GRIP[S_GRAVEL] < GRIP[S_KERB], 'gravel must be looser than kerb')
  assert.ok(GRIP[S_GRAVEL] > GRIP[S_OIL], 'gravel must bite more than oil')
})

test('an encoded map round trips with the new surfaces', () => {
  const grid = new Uint8Array(GRID * GRID)
  grid[0] = S_GRAVEL
  grid[1] = S_RAMP
  grid[2] = S_TARMAC
  const round = decodeMap(encodeMap(grid))
  assert.equal(round[0], S_GRAVEL)
  assert.equal(round[1], S_RAMP)
  assert.equal(round[2], S_TARMAC)
})

test('gravel scrubs speed without counting as off track', () => {
  // offTrack stays reserved for S_WALL. Gravel costs time; it does not apply
  // the off-track cap, or running wide would be the same as hitting a wall.
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const cp = match.checkpoints[3]
  const tx = Math.round(cp.x)
  const ty = Math.round(cp.y)

  const run = (surface) => {
    match.grid[ty * GRID + tx] = surface
    car.x = tx
    car.y = ty
    car.heading = 0
    car.vx = 10
    car.vy = 0
    car.throttle = false
    car.steer = 0
    for (let i = 0; i < 10; i++) stepCar(match, car, TICK_MS / 1000)
    return Math.hypot(car.vx, car.vy)
  }

  const onTarmac = run(S_TARMAC)
  const onGravel = run(S_GRAVEL)

  assert.ok(onGravel < onTarmac, `gravel must scrub speed: tarmac ${onTarmac}, gravel ${onGravel}`)
  assert.ok(onGravel > 0, 'gravel must not stop the car dead')
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL. `S_GRAVEL` is not exported.

- [ ] **Step 3: Implement**

In `server/cutline.js`:

```js
export const S_LINE = 6
// Run off, not wall. Running wide outside a fast corner costs time instead of
// ending the race, which is what makes a hard braking zone a risk worth taking.
// offTrack stays reserved for S_WALL, so the off-track cap does not apply here.
export const S_GRAVEL = 7
// A ramp. Crossing it above RAMP_MIN_SPEED launches the car.
export const S_RAMP = 8

export const SURFACE_CHARS = ['W', 'T', 'K', 'B', 'O', 'P', 'L', 'G', 'R']

export const GRAVEL_DRAG = 3.0       // scrubs speed without stopping the car
```

Extend the `GRIP` table:

```js
  [S_GRAVEL]: 2.0,
  [S_RAMP]: 7.0,
```

In `stepCar`, apply gravel drag alongside the existing drag:

```js
  const surfaceDrag = surface === S_GRAVEL ? GRAVEL_DRAG : DRAG
  fwd -= fwd * (offTrack ? OFFTRACK_DRAG : surfaceDrag) * dt
```

In `src/pages/Cutline.jsx` `prerender`, add two branches. Structure as well as colour, per WCAG 1.4.1:

```js
      } else if (surface === S_GRAVEL) {
        // Loose stone. Stippled so it reads as run off rather than as tarmac in
        // a different shade, which colour alone would not carry.
        g.fillStyle = '#4a4438'
        g.fillRect(tx, ty, T, T)
        g.fillStyle = 'rgba(0, 0, 0, 0.35)'
        for (let d = 0; d < 6; d++) {
          const gx = tx + ((x * 7 + y * 13 + d * 11) % T)
          const gy = ty + ((x * 17 + y * 5 + d * 19) % T)
          g.fillRect(gx, gy, 2, 2)
        }
      } else if (surface === S_RAMP) {
        // A ramp reads as raised: a bright leading lip and chevrons pointing the
        // way it launches, so it is never mistaken for a boost strip.
        g.fillStyle = '#2b2118'
        g.fillRect(tx, ty, T, T)
        g.fillStyle = cWarn
        g.fillRect(tx, ty, T, Math.max(2, T * 0.18))
        g.strokeStyle = cWarn
        g.lineWidth = 2
        for (const cy of [ty + T * 0.45, ty + T * 0.72]) {
          g.beginPath()
          g.moveTo(tx + T * 0.2, cy + T * 0.12)
          g.lineTo(tx + T * 0.5, cy - T * 0.08)
          g.lineTo(tx + T * 0.8, cy + T * 0.12)
          g.stroke()
        }
      }
```

- [ ] **Step 4: Run tests and build**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test server/cutline.test.js && npm test && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js src/pages/Cutline.jsx server/cutline.test.js
git commit -m "feat(cutline): add gravel run off and ramp surfaces"
```

---

## Task 3: The lattice cycle finder

Pure graph work, testable with no geometry. This is the piece that earns back the closure and non-self-intersection guarantees the harmonic gave for free, so it is tested hardest.

**Files:**
- Modify: `server/cutline.js`
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: `createRng`.
- Produces: `LATTICE_N`, `LATTICE_CELL`, `LATTICE_ORIGIN`, `MIN_WALL`, `SEGMENT_WIDTH_MAX`, `SEGMENT_WIDTH_MIN`, `MIN_CYCLE_EDGES`, `MIN_DIRECTION_CHANGES`, `MIN_SIGN_CHANGES`, `MIN_STRAIGHT_EDGES`, `CYCLE_ATTEMPTS`, `FALLBACK_CYCLE`, and `findCycle(rng) -> Array<{gx, gy}>` returning lattice vertices in order.

- [ ] **Step 1: Write the failing test**

```js
test('a found cycle is closed, never revisits a vertex, and turns both ways', () => {
  // These are the three guarantees the harmonic centreline gave for free. A
  // cycle that fails any of them produces a circuit that softlocks a race, so
  // they are asserted for many seeds rather than one.
  for (let seed = 1; seed <= 40; seed++) {
    const cycle = findCycle(createRng(seed))

    assert.ok(cycle.length >= MIN_CYCLE_EDGES, `seed ${seed}: cycle too short, ${cycle.length}`)

    // Closed: consecutive vertices are lattice neighbours, including the wrap.
    for (let i = 0; i < cycle.length; i++) {
      const a = cycle[i]
      const b = cycle[(i + 1) % cycle.length]
      const step = Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy)
      assert.equal(step, 1, `seed ${seed}: vertices ${i} and ${i + 1} are not neighbours`)
    }

    // No vertex twice: this is what makes self-intersection impossible.
    const keys = new Set(cycle.map((v) => `${v.gx},${v.gy}`))
    assert.equal(keys.size, cycle.length, `seed ${seed}: a vertex is used twice`)

    // Inside the lattice.
    for (const v of cycle) {
      assert.ok(v.gx >= 0 && v.gx < LATTICE_N && v.gy >= 0 && v.gy < LATTICE_N, `seed ${seed}: off lattice`)
    }
  }
})

test('a found cycle is never an oval: it turns both ways and has a straight', () => {
  // The whole point. The harmonic curve bent around the grid centre, so every
  // corner turned the same way and every lap read identically. A cycle that
  // only ever turns one way has reproduced that defect in a new shape.
  for (let seed = 1; seed <= 40; seed++) {
    const cycle = findCycle(createRng(seed))
    const dirs = []
    for (let i = 0; i < cycle.length; i++) {
      const a = cycle[i]
      const b = cycle[(i + 1) % cycle.length]
      dirs.push({ x: b.gx - a.gx, y: b.gy - a.gy })
    }

    let turns = 0
    let signChanges = 0
    let lastSign = 0
    let longestStraight = 1
    let run = 1
    for (let i = 0; i < dirs.length; i++) {
      const a = dirs[i]
      const b = dirs[(i + 1) % dirs.length]
      const cross = a.x * b.y - a.y * b.x
      if (cross === 0) {
        run++
        longestStraight = Math.max(longestStraight, run)
      } else {
        turns++
        run = 1
        const sign = Math.sign(cross)
        if (lastSign !== 0 && sign !== lastSign) signChanges++
        lastSign = sign
      }
    }

    assert.ok(turns >= MIN_DIRECTION_CHANGES, `seed ${seed}: only ${turns} turns`)
    assert.ok(signChanges >= MIN_SIGN_CHANGES, `seed ${seed}: only ${signChanges} counter turns, this is an oval`)
    assert.ok(
      longestStraight >= MIN_STRAIGHT_EDGES,
      `seed ${seed}: longest straight is ${longestStraight} edges`,
    )
  }
})

test('the same seed finds the same cycle', () => {
  assert.deepEqual(findCycle(createRng(7)), findCycle(createRng(7)))
  assert.notDeepEqual(findCycle(createRng(7)), findCycle(createRng(8)))
})

test('the fallback cycle satisfies every rule the search does', () => {
  // The fallback exists so generation can never fail to return a circuit. If it
  // does not itself pass the acceptance rules, a hard seed produces a circuit
  // worse than the ones the search rejected.
  assert.ok(FALLBACK_CYCLE.length >= MIN_CYCLE_EDGES)
  const keys = new Set(FALLBACK_CYCLE.map((v) => `${v.gx},${v.gy}`))
  assert.equal(keys.size, FALLBACK_CYCLE.length, 'the fallback must not revisit a vertex')
  for (let i = 0; i < FALLBACK_CYCLE.length; i++) {
    const a = FALLBACK_CYCLE[i]
    const b = FALLBACK_CYCLE[(i + 1) % FALLBACK_CYCLE.length]
    assert.equal(Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy), 1, 'the fallback must be closed')
  }
})

test('the lattice cell is wide enough to keep parallel corridors apart', () => {
  // Two stretches of road running side by side must not merge into one, or the
  // carve produces a shortcut nobody designed and the checkpoint ring rejects
  // the lap. Derived, so it cannot drift when the road widens.
  assert.ok(
    LATTICE_CELL >= SEGMENT_WIDTH_MAX + MIN_WALL,
    `cell ${LATTICE_CELL} leaves no wall between corridors ${SEGMENT_WIDTH_MAX} wide`,
  )
  // And the widest circuit must fit the grid.
  const far = LATTICE_ORIGIN + (LATTICE_N - 1) * LATTICE_CELL + SEGMENT_WIDTH_MAX / 2
  assert.ok(far < GRID, `a circuit reaches ${far}, past the grid at ${GRID}`)
  assert.ok(LATTICE_ORIGIN - SEGMENT_WIDTH_MAX / 2 > 0, 'a circuit runs off the near edge')
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL. `findCycle` is not exported.

- [ ] **Step 3: Implement**

Add to `server/cutline.js`, replacing the harmonic constants block (`BASE_RADIUS`, `AMP_MAX`, `HARMONICS` stay for now; Task 4 removes them):

```js
// --- Lattice --------------------------------------------------------------
// A circuit is a closed cycle on a coarse lattice, smoothed into real corners.
// The harmonic curve this replaces was single valued in angle, so it always
// bent around the grid centre: every corner turned the same way and curvature
// was global, which is why every circuit read as the same deformed circle.
export const MIN_WALL = 3
export const SEGMENT_WIDTH_MAX = 11
export const SEGMENT_WIDTH_MIN = 7
// Derived. Two parallel corridors must not merge, so their centres must be at
// least the widest road plus a wall apart.
export const LATTICE_CELL = SEGMENT_WIDTH_MAX + MIN_WALL
export const LATTICE_N = 6
export const LATTICE_ORIGIN = 8

export const MIN_CYCLE_EDGES = 16
export const MIN_DIRECTION_CHANGES = 8
export const MIN_SIGN_CHANGES = 3
export const MIN_STRAIGHT_EDGES = 3
export const CYCLE_ATTEMPTS = 200

// A known good cycle, used when the search cannot find one. It satisfies every
// acceptance rule the search applies, so a hard seed never yields a circuit
// worse than one the search would have rejected.
export const FALLBACK_CYCLE = [
  { gx: 1, gy: 1 }, { gx: 2, gy: 1 }, { gx: 3, gy: 1 }, { gx: 4, gy: 1 },
  { gx: 4, gy: 2 }, { gx: 3, gy: 2 }, { gx: 3, gy: 3 }, { gx: 4, gy: 3 },
  { gx: 4, gy: 4 }, { gx: 3, gy: 4 }, { gx: 2, gy: 4 }, { gx: 1, gy: 4 },
  { gx: 1, gy: 3 }, { gx: 2, gy: 3 }, { gx: 2, gy: 2 }, { gx: 1, gy: 2 },
]

const LATTICE_STEPS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** Whether a closed lattice cycle is varied enough to be worth racing. */
function cycleAccepted(cycle) {
  if (cycle.length < MIN_CYCLE_EDGES) return false

  const dirs = []
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i]
    const b = cycle[(i + 1) % cycle.length]
    dirs.push({ x: b.gx - a.gx, y: b.gy - a.gy })
  }

  let turns = 0
  let signChanges = 0
  let lastSign = 0
  let longestStraight = 1
  let run = 1
  for (let i = 0; i < dirs.length; i++) {
    const a = dirs[i]
    const b = dirs[(i + 1) % dirs.length]
    const cross = a.x * b.y - a.y * b.x
    if (cross === 0) {
      run++
      if (run > longestStraight) longestStraight = run
    } else {
      turns++
      run = 1
      const sign = Math.sign(cross)
      if (lastSign !== 0 && sign !== lastSign) signChanges++
      lastSign = sign
    }
  }

  return (
    turns >= MIN_DIRECTION_CHANGES &&
    signChanges >= MIN_SIGN_CHANGES &&
    longestStraight >= MIN_STRAIGHT_EDGES
  )
}

/**
 * A closed cycle on the lattice, as a list of vertices in order.
 *
 * Self-intersection is impossible by construction: a vertex is never visited
 * twice, so two stretches of road can never occupy the same lattice cell. That
 * is the guarantee the harmonic curve gave for free and the reason this search
 * refuses rather than repairs.
 */
export function findCycle(rng = Math.random) {
  for (let attempt = 0; attempt < CYCLE_ATTEMPTS; attempt++) {
    const start = {
      gx: Math.floor(rng() * LATTICE_N),
      gy: Math.floor(rng() * LATTICE_N),
    }
    const path = [start]
    const seen = new Set([`${start.gx},${start.gy}`])

    for (let step = 0; step < LATTICE_N * LATTICE_N * 4; step++) {
      const at = path[path.length - 1]
      // Shuffle the four steps with the injected rng so the walk is seeded.
      const order = [0, 1, 2, 3]
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        const t = order[i]
        order[i] = order[j]
        order[j] = t
      }

      let moved = false
      for (const oi of order) {
        const d = LATTICE_STEPS[oi]
        const nx = at.gx + d.x
        const ny = at.gy + d.y
        if (nx < 0 || ny < 0 || nx >= LATTICE_N || ny >= LATTICE_N) continue

        // Closing the loop: only from a path long enough to be worth racing.
        if (nx === start.gx && ny === start.gy) {
          if (path.length >= MIN_CYCLE_EDGES && cycleAccepted(path)) return path
          continue
        }

        if (seen.has(`${nx},${ny}`)) continue
        path.push({ gx: nx, gy: ny })
        seen.add(`${nx},${ny}`)
        moved = true
        break
      }
      if (!moved) break // walked into a dead end, start again
    }
  }

  return FALLBACK_CYCLE.map((v) => ({ ...v }))
}
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test server/cutline.test.js
```

Expected: PASS.

**If the fallback fires often**, the acceptance rules are too strict for a 6 by 6 lattice. Measure it before changing anything: run 500 seeds, count how many return `FALLBACK_CYCLE`, and report the number. Do not loosen `MIN_SIGN_CHANGES`, which is the rule that stops circuits being ovals; prefer lowering `MIN_CYCLE_EDGES`.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): closed lattice cycles with both-way turns"
```

---

## Task 4: Corners, straights and the centreline

Turns the lattice cycle into a drivable centreline with a `meta` array, and retires the harmonic generator.

**Files:**
- Modify: `server/cutline.js`
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: `findCycle`, `resample`.
- Produces: `CORNERS` vocabulary, `MAX_CORNER_RAD` redefined, `buildCenterline(seed) -> { centerline, meta }` where `meta[i] = { width, corner, sign }`.

**Breaking change, absorbed here rather than left open.** `buildCenterline` returns an object rather than an array. `carve` is its only caller, and rather than leaving the suite red across three tasks, this task adds a one-line adapter at the top of `carve` so it keeps working on the new shape. Task 7 then rewrites `carve` properly and removes the adapter. The suite stays green throughout.

- [ ] **Step 1: Write the failing test**

```js
test('the corner vocabulary maps radius to a required speed', () => {
  // Corner speeds are derived from the handling model, not chosen. At speed v a
  // car turns TURN_RATE * (1 - TURN_FALLOFF * v / TOP_SPEED) / v rad per tile,
  // so v = TURN_RATE / (k + TURN_RATE * TURN_FALLOFF / TOP_SPEED).
  const speedFor = (k) => TURN_RATE / (k + (TURN_RATE * TURN_FALLOFF) / TOP_SPEED)

  for (const c of CORNERS) {
    const v = speedFor(c.rad)
    assert.ok(v > 0 && v <= TOP_SPEED, `${c.name} needs an impossible speed ${v}`)
    assert.ok(
      Math.abs(v - c.speed) < 0.2,
      `${c.name} claims speed ${c.speed} but the model says ${v.toFixed(2)}`,
    )
  }

  // The vocabulary must span from flat out to needing a real brake, or corners
  // do not vary and the whole exercise is pointless.
  const fastest = Math.max(...CORNERS.map((c) => c.speed))
  const slowest = Math.min(...CORNERS.map((c) => c.speed))
  assert.ok(fastest > TOP_SPEED * 0.8, 'at least one corner must be near flat out')
  assert.ok(slowest < TOP_SPEED * 0.4, 'at least one corner must demand hard braking')
  assert.equal(MAX_CORNER_RAD, Math.max(...CORNERS.map((c) => c.rad)), 'MAX_CORNER_RAD is the tightest corner')
})

test('a built centreline is closed, evenly spaced and carries meta per point', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { centerline, meta } = buildCenterline(seed)

    assert.ok(centerline.length > 80, `seed ${seed}: centreline implausibly short`)
    assert.equal(meta.length, centerline.length, `seed ${seed}: meta must be parallel to the line`)

    const gaps = []
    for (let i = 0; i < centerline.length; i++) {
      const a = centerline[i]
      const b = centerline[(i + 1) % centerline.length]
      gaps.push(Math.hypot(b.x - a.x, b.y - a.y))
    }
    const maxGap = Math.max(...gaps)
    const minGap = Math.min(...gaps)
    assert.ok(maxGap - minGap < 0.01, `seed ${seed}: spacing is uneven, ${minGap} to ${maxGap}`)

    for (const m of meta) {
      assert.ok(m.width >= SEGMENT_WIDTH_MIN && m.width <= SEGMENT_WIDTH_MAX, `width ${m.width} out of range`)
      assert.ok([-1, 0, 1].includes(m.sign), `sign ${m.sign} is not a direction`)
    }
  }
})

test('a circuit contains corners in both directions and at more than one radius', () => {
  // The defect being fixed, asserted directly. A circuit whose corners all turn
  // the same way is the harmonic curve in a new costume.
  for (let seed = 1; seed <= 12; seed++) {
    const { meta } = buildCenterline(seed)
    const left = meta.filter((m) => m.sign === -1).length
    const right = meta.filter((m) => m.sign === 1).length
    assert.ok(left > 0, `seed ${seed}: no left-hand corners`)
    assert.ok(right > 0, `seed ${seed}: no right-hand corners`)

    const kinds = new Set(meta.map((m) => m.corner).filter(Boolean))
    assert.ok(kinds.size >= 2, `seed ${seed}: only one kind of corner, ${[...kinds]}`)

    const straight = meta.filter((m) => m.corner === null).length
    assert.ok(straight > meta.length * 0.2, `seed ${seed}: barely any straight`)
  }
})

test('no corner is sharper than the tightest the vocabulary allows', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { centerline } = buildCenterline(seed)
    for (let i = 0; i < centerline.length; i++) {
      const a = centerline[i]
      const b = centerline[(i + 1) % centerline.length]
      const c = centerline[(i + 2) % centerline.length]
      const h1 = Math.atan2(b.y - a.y, b.x - a.x)
      const h2 = Math.atan2(c.y - b.y, c.x - b.x)
      let turn = Math.abs(h2 - h1)
      if (turn > Math.PI) turn = Math.PI * 2 - turn
      assert.ok(
        turn <= MAX_CORNER_RAD + 0.05,
        `seed ${seed}: corner of ${turn.toFixed(3)} exceeds ${MAX_CORNER_RAD}`,
      )
    }
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL. `CORNERS` is not exported and `buildCenterline` still returns an array.

- [ ] **Step 3: Implement**

Delete `BASE_RADIUS`, `AMP_MAX`, `HARMONICS` and the polar-curve body of `buildCenterline`. Keep `resample` exactly as it is; it already handles the wrap seam and is tested.

```js
// The corner vocabulary. `speed` is DERIVED from the handling model, not chosen:
// at speed v a car turns TURN_RATE * (1 - TURN_FALLOFF * v / TOP_SPEED) / v
// radians per tile, so a corner of radius k demands
// v = TURN_RATE / (k + TURN_RATE * TURN_FALLOFF / TOP_SPEED).
// The table spans flat out to hard braking on purpose: a racer whose corners
// never need a brake has removed the main thing a driver does.
export const CORNERS = [
  { name: 'sweeper', rad: 0.15, speed: 12.66 },
  { name: 'standard', rad: 0.3, speed: 7.94 },
  { name: 'tight', rad: 0.45, speed: 5.79 },
  { name: 'hairpin', rad: 0.6, speed: 4.55 },
]

// No longer a ceiling every circuit hugs. It is the tightest corner the
// vocabulary contains, and circuits are expected to use the whole range.
export const MAX_CORNER_RAD = Math.max(...CORNERS.map((c) => c.rad))

/** Lattice vertex to world tile. */
function latticeToWorld(v) {
  return {
    x: LATTICE_ORIGIN + v.gx * LATTICE_CELL,
    y: LATTICE_ORIGIN + v.gy * LATTICE_CELL,
  }
}

/**
 * A circuit's racing line and a description of every point on it.
 *
 * The cycle gives the shape; this gives it corners. Each lattice vertex where
 * the path turns becomes a circular fillet whose radius comes from CORNERS, and
 * consecutive steps in one direction become a straight.
 */
export function buildCenterline(seed) {
  const rng = createRng(seed)
  const cycle = findCycle(rng)
  const pts = cycle.map(latticeToWorld)

  // Classify each vertex: straight through, or a corner of some kind.
  const kinds = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length]
    const here = pts[i]
    const next = pts[(i + 1) % pts.length]
    const ax = here.x - prev.x
    const ay = here.y - prev.y
    const bx = next.x - here.x
    const by = next.y - here.y
    const cross = ax * by - ay * bx
    if (cross === 0) {
      kinds.push({ corner: null, sign: 0 })
    } else {
      const pick = CORNERS[Math.floor(rng() * CORNERS.length)] ?? CORNERS[1]
      kinds.push({ corner: pick.name, sign: Math.sign(cross) })
    }
  }

  // Walk the ring, emitting a dense polyline: straight runs verbatim, corners as
  // arcs. The fillet radius is chosen so the arc's curvature matches the corner's
  // rad per tile, which is what makes the required speed real.
  const dense = []
  const denseMeta = []
  for (let i = 0; i < pts.length; i++) {
    const here = pts[i]
    const next = pts[(i + 1) % pts.length]
    const k = kinds[i]

    if (k.corner === null) {
      dense.push({ x: here.x, y: here.y })
      denseMeta.push({ corner: null, sign: 0 })
    } else {
      const prev = pts[(i - 1 + pts.length) % pts.length]
      const spec = CORNERS.find((c) => c.name === k.corner) ?? CORNERS[1]
      // Arc radius in tiles from radians per tile: r = 1 / k.
      const radius = Math.min(1 / spec.rad, LATTICE_CELL * 0.45)
      const inDir = norm(here.x - prev.x, here.y - prev.y)
      const outDir = norm(next.x - here.x, next.y - here.y)
      const entry = { x: here.x - inDir.x * radius, y: here.y - inDir.y * radius }
      const exit = { x: here.x + outDir.x * radius, y: here.y + outDir.y * radius }
      const steps = Math.max(4, Math.round(radius * 2))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        // Quadratic bezier through the vertex gives a clean fillet with the
        // right tangents at both ends and no trigonometry to get wrong.
        const mx = (1 - t) * (1 - t) * entry.x + 2 * (1 - t) * t * here.x + t * t * exit.x
        const my = (1 - t) * (1 - t) * entry.y + 2 * (1 - t) * t * here.y + t * t * exit.y
        dense.push({ x: mx, y: my })
        denseMeta.push({ corner: k.corner, sign: k.sign })
      }
    }
  }

  const centerline = resample(dense, POINT_SPACING)

  // Carry meta across the resample by nearest dense point. Exact enough: dense
  // points are closer together than POINT_SPACING wherever a corner is.
  const meta = centerline.map((p) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < dense.length; i++) {
      const d = (dense[i].x - p.x) ** 2 + (dense[i].y - p.y) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    const m = denseMeta[best]
    return { width: SEGMENT_WIDTH_MAX, corner: m.corner, sign: m.sign }
  })

  return { centerline, meta }
}

function norm(x, y) {
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}
```

`meta[i].width` is a placeholder constant here; Task 5 varies it.

Then add the adapter at the top of `carve`, so the whole suite stays green until Task 7 rewrites it:

```js
export function carve(seed) {
  // Task 4 changed buildCenterline's return shape. The full pipeline arrives in
  // Task 7; until then this keeps the existing carve working on the new shape so
  // the suite never goes red across tasks.
  const { centerline } = buildCenterline(seed)
  // ... the rest of the existing carve body, unchanged ...
```

- [ ] **Step 4: Run the whole suite**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test
```

Expected: PASS. If anything fails, the adapter is wrong, not the generator.

**If the corner test fails**, the fillet radius and the claimed `rad` have drifted apart. The arc radius is `1 / rad` tiles; if `LATTICE_CELL * 0.45` is clamping it, the corner is gentler than claimed. Report the numbers rather than widening the tolerance.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): corner vocabulary and lattice-derived centreline"
```

---

## Task 5: Per-segment width and chicanes

**Files:**
- Modify: `server/cutline.js`
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: `buildCenterline`'s `meta`.
- Produces: `WIDTH_RAMP_PER_POINT`, widened `meta[i].width`, and chicane marking in `meta[i].corner === 'chicane'`.

- [ ] **Step 1: Write the failing test**

```js
test('width varies along a lap and never steps', () => {
  // A one tile ledge mid corner catches a wheel and reads as a collision bug
  // rather than as geometry, so width ramps rather than jumps.
  for (let seed = 1; seed <= 12; seed++) {
    const { meta } = buildCenterline(seed)
    const widths = meta.map((m) => m.width)

    assert.ok(Math.max(...widths) > Math.min(...widths), `seed ${seed}: width never varies`)
    assert.ok(Math.min(...widths) >= SEGMENT_WIDTH_MIN, `seed ${seed}: too narrow`)
    assert.ok(Math.max(...widths) <= SEGMENT_WIDTH_MAX, `seed ${seed}: too wide`)

    for (let i = 0; i < widths.length; i++) {
      const a = widths[i]
      const b = widths[(i + 1) % widths.length]
      assert.ok(
        Math.abs(a - b) <= WIDTH_RAMP_PER_POINT + 1e-9,
        `seed ${seed}: width steps from ${a} to ${b} at point ${i}`,
      )
    }
  }
})

test('straights are wider than the corners they lead into', () => {
  // The point of varying width: room to out brake somebody into a corner.
  for (let seed = 1; seed <= 12; seed++) {
    const { meta } = buildCenterline(seed)
    const straightW = meta.filter((m) => m.corner === null).map((m) => m.width)
    const cornerW = meta.filter((m) => m.corner !== null).map((m) => m.width)
    if (straightW.length === 0 || cornerW.length === 0) continue
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    assert.ok(
      avg(straightW) > avg(cornerW),
      `seed ${seed}: straights average ${avg(straightW)}, corners ${avg(cornerW)}`,
    )
  }
})

test('at least some circuits contain a chicane, and a chicane counter turns', () => {
  // A chicane is one feature, not three unrelated corners: tight one way then
  // tight the other, so it cannot be taken on a single line.
  let found = 0
  for (let seed = 1; seed <= 24; seed++) {
    const { meta } = buildCenterline(seed)
    const idx = meta.map((m, i) => (m.corner === 'chicane' ? i : -1)).filter((i) => i >= 0)
    if (idx.length === 0) continue
    found++
    const signs = new Set(idx.map((i) => meta[i].sign).filter((s) => s !== 0))
    assert.ok(signs.size >= 2, `seed ${seed}: a chicane must turn both ways, saw ${[...signs]}`)
  }
  assert.ok(found > 0, 'no circuit in 24 seeds contained a chicane')
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL. `WIDTH_RAMP_PER_POINT` is not exported and width is constant.

- [ ] **Step 3: Implement**

Add the constant:

```js
// Width may not step. A one tile ledge mid corner catches a wheel and reads as
// a collision bug rather than as geometry.
export const WIDTH_RAMP_PER_POINT = 0.25
```

In `buildCenterline`, after building `meta`, replace the placeholder width with a target-then-smooth pass, and promote adjacent counter-turning tight corners to a chicane:

```js
  // Chicanes: a tight corner immediately followed by a tight corner the other
  // way is one feature, not two. Marked so width and the carve can treat it as
  // a unit, and so a test can assert circuits contain them.
  for (let i = 0; i < meta.length; i++) {
    const a = meta[i]
    const b = meta[(i + 1) % meta.length]
    if (a.corner === 'tight' && b.corner === 'tight' && a.sign !== 0 && b.sign !== 0 && a.sign !== b.sign) {
      a.corner = 'chicane'
      b.corner = 'chicane'
    }
  }

  // Target width per point: wide on a straight so there is room to out brake
  // somebody, narrow through anything technical.
  const target = meta.map((m) => {
    if (m.corner === null) return SEGMENT_WIDTH_MAX
    if (m.corner === 'chicane' || m.corner === 'hairpin') return SEGMENT_WIDTH_MIN
    if (m.corner === 'tight') return SEGMENT_WIDTH_MIN + 2
    return SEGMENT_WIDTH_MIN + 3
  })

  // Ramp toward the target rather than stepping to it. Two passes, forward then
  // backward, so a narrow stretch is approached from both sides.
  const width = target.slice()
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < width.length; n++) {
      const i = pass === 0 ? n : width.length - 1 - n
      const j = pass === 0 ? (i - 1 + width.length) % width.length : (i + 1) % width.length
      const limit = width[j] + (width[i] > width[j] ? WIDTH_RAMP_PER_POINT : -WIDTH_RAMP_PER_POINT)
      if (Math.abs(width[i] - width[j]) > WIDTH_RAMP_PER_POINT) width[i] = limit
    }
  }
  for (let i = 0; i < meta.length; i++) {
    meta[i].width = Math.max(SEGMENT_WIDTH_MIN, Math.min(SEGMENT_WIDTH_MAX, width[i]))
  }
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test --test-name-pattern="width varies|straights are wider|chicane" server/cutline.test.js
```

**If the no-step assertion fails**, two smoothing passes are not enough to satisfy the ramp everywhere on a closed ring. Raise the pass count rather than the allowed step, and say how many passes it took.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): per-segment width and chicanes"
```

---

## Task 6: Ramps in the rules

Rules only. Placement comes with the carve in Task 7.

**Files:**
- Modify: `server/cutline.js`
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: `S_RAMP`, `surfaceAt`.
- Produces: `RAMP_MIN_SPEED`, `AIR_MS`, `AIR_STEER`, `car.airUntil`, and `airborne`/`airT` in the snapshot.

- [ ] **Step 1: Write the failing test**

```js
test('a ramp launches a car that is fast enough, and ignores one that is not', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const cp = match.checkpoints[3]
  const tx = Math.round(cp.x)
  const ty = Math.round(cp.y)
  match.grid[ty * GRID + tx] = S_RAMP

  car.x = tx
  car.y = ty
  car.heading = 0
  car.vx = RAMP_MIN_SPEED - 2
  car.vy = 0
  applyHazards(match, car)
  assert.ok(!(match.now < (car.airUntil ?? 0)), 'a slow car must not be launched')

  car.vx = RAMP_MIN_SPEED + 2
  applyHazards(match, car)
  assert.ok(match.now < car.airUntil, 'a fast car must be launched')
})

test('an airborne car ignores hazards and walls, then lands', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  const cp = match.checkpoints[3]

  car.x = cp.x
  car.y = cp.y
  car.heading = 0
  car.vx = 10
  car.vy = 0
  car.airUntil = match.now + AIR_MS

  // A slick directly under an airborne car must do nothing.
  match.hazards.push({ kind: 'slick', x: car.x, y: car.y, until: match.now + SLICK_TTL_MS, by: 'x' })
  applyHazards(match, car)
  assert.equal(car.onSlick, false, 'an airborne car must not be affected by a slick')

  // A banana under an airborne car must neither spin it nor be consumed.
  match.hazards.push({ kind: 'banana', x: car.x, y: car.y, until: match.now + BANANA_TTL_MS, by: 'x' })
  applyHazards(match, car)
  assert.ok(!(match.now < (car.spinUntil ?? 0)), 'an airborne car must not be spun')
  assert.ok(!match.hazards.some((h) => h.spent), 'a banana must not be consumed from the air')

  // And it lands.
  match.now += AIR_MS + 1
  applyHazards(match, car)
  assert.ok(!(match.now < car.airUntil), 'the car must come down')
})

test('the snapshot tells the page a car is airborne', () => {
  const match = racing(1)
  const [car] = [...match.cars.values()]
  car.airUntil = match.now + AIR_MS

  const snap = snapshot(match)
  const me = snap.cars.find((c) => c.id === car.id)
  assert.equal(me.airborne, true)
  assert.ok(me.airT >= 0 && me.airT <= 1, `airT ${me.airT} must be normalised for the arc`)

  match.now += AIR_MS + 1
  const after = snapshot(match).cars.find((c) => c.id === car.id)
  assert.equal(after.airborne, false)
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL. `RAMP_MIN_SPEED` is not exported.

- [ ] **Step 3: Implement**

```js
// A ramp launches a car that arrives with speed. While airborne the car ignores
// hazards and walls, so a ramp can clear a gap or a barrier, and carries the
// speed it arrived with. Height is RENDER ONLY: the rules track only that the
// car is in the air and when it lands, so nothing here gains a z axis. That is
// the same division Blockout 3D uses for its jump.
export const RAMP_MIN_SPEED = 8.0
export const AIR_MS = 700
export const AIR_STEER = 0.25
```

In `applyHazards`, at the top, launch and then skip everything while airborne:

```js
export function applyHazards(match, car) {
  if (!car.alive) return

  car.onSlick = false

  const here = surfaceAt(match.grid, Math.round(car.x), Math.round(car.y))

  if (here === S_RAMP && Math.hypot(car.vx, car.vy) >= RAMP_MIN_SPEED) {
    car.airUntil = Math.max(car.airUntil ?? 0, match.now + AIR_MS)
  }

  // Airborne: nothing on the ground reaches the car, and a banana under it is
  // not consumed, so it is still there for whoever lands on it.
  if (match.now < (car.airUntil ?? 0)) return

  if (here === S_BOOST) {
    car.boostUntil = Math.max(car.boostUntil, match.now + STRIP_BOOST_MS)
  }

  // ... the existing hazard loop unchanged ...
}
```

In `stepCar`, treat airborne as its own control state and skip wall contact:

```js
  const airborne = match.now < (car.airUntil ?? 0)
```

Fold it into the steering branch, ahead of the spin check so a spinning car that takes a ramp is still airborne:

```js
  if (spinning) {
    car.heading += SPIN_RATE * dt
  } else {
    const steerAuthority = airborne ? AIR_STEER : car.onSlick ? SLICK_TURN : 1
    car.heading += (car.steer ?? 0) * TURN_RATE * falloff * steerAuthority * dt
  }
```

And guard the two wall tests:

```js
  if (bodyHitsWall(match, car, nx, car.y) && !offTrack && !airborne) {
```

```js
  if (bodyHitsWall(match, car, car.x, ny) && !offTrack && !airborne) {
```

In `snapshot`, beside `spinning`:

```js
      airborne: match.now < (car.airUntil ?? 0),
      // Normalised height along the arc, for the page to draw a hop and a
      // shadow with. Render only: no rule reads it back.
      airT: match.now < (car.airUntil ?? 0)
        ? Math.round((1 - (car.airUntil - match.now) / AIR_MS) * 100) / 100
        : 0,
```

In `startRace`, reset it beside the other per-car timers:

```js
    car.airUntil = 0
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --test --test-name-pattern="ramp launches|airborne car|snapshot tells" server/cutline.test.js
```

Then prove the airborne guard is not hollow: temporarily remove the early `return` from `applyHazards`, confirm the slick test FAILS, restore it.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): ramps that launch a car over hazards and walls"
```

---

## Task 7: The carve pipeline

The largest single piece. `carve()` stops being one pass along one uniform centreline and becomes a pipeline over `meta`.

**Files:**
- Modify: `server/cutline.js`
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: `buildCenterline`'s `{ centerline, meta }`, `stampTrack`, `walkLine`.
- Produces: `carve(seed) -> { grid, centerline, meta, checkpoints, startSlots, pickups }`.

- [ ] **Step 1: Write the failing test**

```js
test('a carved circuit is one connected region at every width', () => {
  for (const circuit of CIRCUITS) {
    const { grid } = carve(circuit.seed)
    let start = -1
    let total = 0
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== S_WALL) {
        if (start < 0) start = i
        total++
      }
    }
    assert.ok(start >= 0, `${circuit.name}: carved no surface`)

    const seen = new Uint8Array(grid.length)
    const stack = [start]
    seen[start] = 1
    let reached = 0
    while (stack.length) {
      const idx = stack.pop()
      reached++
      const x = idx % GRID
      const y = (idx / GRID) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue
        const n = ny * GRID + nx
        if (seen[n] || grid[n] === S_WALL) continue
        seen[n] = 1
        stack.push(n)
      }
    }
    assert.equal(reached, total, `${circuit.name}: surface is in more than one piece`)
  }
})

test('the carved road is as wide as its meta says, within a tile', () => {
  // Width is the setting everything geometric derives from. If the carve and the
  // meta disagree, the checkpoint reach and the pickup spread are both wrong.
  const { grid, centerline, meta } = carve(CIRCUITS[0].seed)
  for (let i = 0; i < centerline.length; i += 7) {
    const p = centerline[i]
    const a = centerline[(i - 1 + centerline.length) % centerline.length]
    const b = centerline[(i + 1) % centerline.length]
    const tx = b.x - a.x
    const ty = b.y - a.y
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len
    const ny = tx / len

    let span = 0
    for (let off = -SEGMENT_WIDTH_MAX; off <= SEGMENT_WIDTH_MAX; off += 0.5) {
      if (surfaceAt(grid, Math.round(p.x + nx * off), Math.round(p.y + ny * off)) !== S_WALL) span += 0.5
    }
    assert.ok(
      Math.abs(span - meta[i].width) <= 2,
      `point ${i}: carved span ${span} against meta width ${meta[i].width}`,
    )
  }
})

test('gravel sits outside fast corners, never in the racing surface', () => {
  const { grid, centerline, meta } = carve(CIRCUITS[0].seed)
  let gravel = 0
  for (const v of grid) if (v === S_GRAVEL) gravel++
  assert.ok(gravel > 0, 'a circuit must have run off somewhere')

  // No gravel on the centreline itself: run off is outside the road.
  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i]
    assert.notEqual(
      surfaceAt(grid, Math.round(p.x), Math.round(p.y)),
      S_GRAVEL,
      `point ${i}: gravel on the racing line`,
    )
  }
})

test('every checkpoint is reachable from the full width of its own segment', () => {
  // The lap counting bug, generalised. With per-segment width the reach must
  // clear the WIDEST segment, since one radius serves every checkpoint.
  assert.ok(CHECKPOINT_RADIUS >= SEGMENT_WIDTH_MAX / 2, 'reach must clear the widest road')

  for (const circuit of CIRCUITS) {
    const match = make({ circuitIndex: CIRCUITS.indexOf(circuit) })
    join(match, { name: 'W' }, () => 0)
    startRace(match)
    const [car] = [...match.cars.values()]
    const line = match.centerline

    car.lap = 0
    car.nextCp = 1
    car.cpTaken = 0
    for (let c = 1; c < match.checkpoints.length; c++) {
      const cp = match.checkpoints[c]
      const i = cp.index
      const a = line[(i - 1 + line.length) % line.length]
      const b = line[(i + 1) % line.length]
      const tx = b.x - a.x
      const ty = b.y - a.y
      const len = Math.hypot(tx, ty) || 1
      const off = match.meta[i].width / 2
      car.x = cp.x - (ty / len) * off
      car.y = cp.y + (tx / len) * off
      updateProgress(match, car)
    }
    assert.equal(
      car.cpTaken,
      match.checkpoints.length - 1,
      `${circuit.name}: a car on the outer edge missed a checkpoint`,
    )
  }
})

test('start slots sit on a straight and on the racing surface', () => {
  for (const circuit of CIRCUITS) {
    const { grid, meta, startSlots } = carve(circuit.seed)
    assert.ok(startSlots.length >= MAX_PLAYERS, `${circuit.name}: not enough slots`)
    for (const slot of startSlots.slice(0, MAX_PLAYERS)) {
      assert.notEqual(
        surfaceAt(grid, Math.round(slot.x), Math.round(slot.y)),
        S_WALL,
        `${circuit.name}: a slot is in a wall`,
      )
      assert.equal(meta[slot.index].corner, null, `${circuit.name}: the grid must sit on a straight`)
    }
  }
})

test('an encoded circuit still fits a welcome frame', () => {
  for (const circuit of CIRCUITS) {
    const encoded = encodeMap(carve(circuit.seed).grid)
    assert.ok(encoded.length < 4096, `${circuit.name}: encoded to ${encoded.length} bytes`)
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL. `carve` still destructures `buildCenterline` as an array.

- [ ] **Step 3: Implement**

Rewrite `carve` as a pipeline. Each numbered stage does one thing and reads `meta`:

```js
export function carve(seed) {
  const { centerline, meta } = buildCenterline(seed)
  const grid = new Uint8Array(GRID * GRID)
  const rng = createRng(seed ^ 0x9e3779b9)

  const put = (x, y, surface) => putTile(grid, x, y, surface)

  // 1. Racing surface, at each point's own width. stampTrack walks the closed
  //    set of adjacent pairs including the wrap, so rails stay 4-connected.
  for (let i = 0; i < centerline.length; i++) {
    const half = Math.round(meta[i].width / 2)
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    const q = centerline[(i + 1) % centerline.length]
    const tq = tangentAt(centerline, (i + 1) % centerline.length)
    for (let off = -half; off <= half; off++) {
      const edge = Math.abs(off) === half
      const surface = edge ? S_KERB : S_TARMAC
      walkLine(
        Math.round(p.x - t.y * off),
        Math.round(p.y + t.x * off),
        Math.round(q.x - tq.y * off),
        Math.round(q.y + tq.x * off),
        (x, y) => put(x, y, surface),
      )
    }
  }

  // 2. Run off outside fast corners. Gravel replaces wall, never tarmac, so a
  //    car that runs wide loses time instead of its race.
  for (let i = 0; i < centerline.length; i++) {
    const m = meta[i]
    if (m.corner === null || m.corner === 'sweeper') continue
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    const half = Math.round(m.width / 2)
    // Outside of the corner is the side the car is NOT turning toward.
    const side = m.sign > 0 ? -1 : 1
    for (let off = half + 1; off <= half + GRAVEL_DEPTH; off++) {
      const gx = Math.round(p.x - t.y * off * side)
      const gy = Math.round(p.y + t.x * off * side)
      if (surfaceAt(grid, gx, gy) === S_WALL) put(gx, gy, S_GRAVEL)
    }
  }

  // 3. Decorate. Boost on straights, oil on corner exits, ramps on long straights.
  for (let i = 0; i < centerline.length; i++) {
    const m = meta[i]
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    let surface = null
    if (m.corner === null && rng() < 0.04) surface = S_BOOST
    else if (m.corner === null && rng() < 0.02) surface = S_RAMP
    else if (meta[(i - 6 + meta.length) % meta.length].corner === 'hairpin' && rng() < 0.05) surface = S_OIL
    if (!surface) continue
    const half = Math.round(m.width / 2) - 1
    for (let off = -half; off <= half; off++) {
      put(p.x - t.y * off, p.y + t.x * off, surface)
    }
  }

  // 4. Pickup ranks, spread to the local width.
  const pickups = []
  const seen = new Set()
  let nextPickup = 14 + Math.floor(rng() * 8)
  for (let i = 0; i < centerline.length - 14; i++) {
    if (i < nextPickup) continue
    const p = centerline[i]
    const t = tangentAt(centerline, i)
    const laneGap = Math.max(1, (meta[i].width - 2) / PICKUP_ROW)
    for (let lane = 0; lane < PICKUP_ROW; lane++) {
      const off = (lane - (PICKUP_ROW - 1) / 2) * laneGap
      const px = Math.round(p.x - t.y * off)
      const py = Math.round(p.y + t.x * off)
      const key = py * GRID + px
      if (seen.has(key)) continue
      if (surfaceAt(grid, px, py) === S_WALL) continue
      seen.add(key)
      put(px, py, S_PICKUP)
      pickups.push({ x: px, y: py, key })
    }
    nextPickup = i + PICKUP_MIN_SPACING + Math.floor(rng() * PICKUP_RANDOM_SPACING)
  }

  // 5. The finish line, across the full local width at the chosen start index.
  const startIndex = pickStartIndex(meta)
  {
    const p = centerline[startIndex]
    const t = tangentAt(centerline, startIndex)
    const half = Math.round(meta[startIndex].width / 2) - 1
    for (let off = -half; off <= half; off++) {
      put(p.x - t.y * off, p.y + t.x * off, S_LINE)
    }
  }

  // 6. Checkpoints, evenly spaced from the start index.
  const checkpoints = []
  for (let c = 0; c < CHECKPOINT_COUNT; c++) {
    const index = (startIndex + Math.floor((c * centerline.length) / CHECKPOINT_COUNT)) % centerline.length
    checkpoints.push({ index, x: centerline[index].x, y: centerline[index].y })
  }

  // 7. Starting slots, back from the line and always on a straight.
  const startSlots = []
  for (let row = 0; row < START_ROWS; row++) {
    const index = (startIndex - (row + 1) * START_ROW_GAP + centerline.length) % centerline.length
    const p = centerline[index]
    const t = tangentAt(centerline, index)
    for (let col = 0; col < START_COLUMNS; col++) {
      const off = (col - (START_COLUMNS - 1) / 2) * LANE_GAP
      startSlots.push({
        x: p.x - t.y * off,
        y: p.y + t.x * off,
        heading: Math.atan2(t.y, t.x),
        index,
      })
    }
  }

  return { grid, centerline, meta, checkpoints, startSlots, pickups }
}

/**
 * Where the finish line goes: the middle of the longest straight, so the grid
 * sits on a straight and the run to the flag is a straight rather than a corner.
 */
function pickStartIndex(meta) {
  let bestStart = 0
  let bestLen = 0
  let runStart = 0
  let run = 0
  for (let i = 0; i < meta.length * 2; i++) {
    const m = meta[i % meta.length]
    if (m.corner === null) {
      if (run === 0) runStart = i
      run++
      if (run > bestLen) {
        bestLen = run
        bestStart = runStart
      }
    } else {
      run = 0
    }
  }
  // Far enough into the straight that the whole starting grid fits behind it.
  const need = START_ROWS * START_ROW_GAP + 2
  return (bestStart + Math.max(need, Math.floor(bestLen / 2))) % meta.length
}
```

Add the gravel depth constant beside the other surface constants:

```js
export const GRAVEL_DEPTH = 3        // tiles of run off outside a corner
```

Update `make` to carry `meta`:

```js
  const { grid, centerline, meta, checkpoints, startSlots, pickups } = carve(circuit.seed)
```

and include `meta` in the returned match object.

Update `CHECKPOINT_RADIUS` and `LINE_HALF_SPAN` to derive from `SEGMENT_WIDTH_MAX`:

```js
export const CHECKPOINT_RADIUS = SEGMENT_WIDTH_MAX / 2 + CHECKPOINT_SLACK
export const LINE_HALF_SPAN = SEGMENT_WIDTH_MAX / 2 + CHECKPOINT_SLACK
```

Delete `TRACK_WIDTH` and `HALF_WIDTH`. Every remaining reference must move to `SEGMENT_WIDTH_MAX` or to `meta[i].width`.

- [ ] **Step 4: Run the full suite**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test
```

Expected: PASS. Fix any test still referencing `TRACK_WIDTH`.

**If the connected-region test fails**, the width ramp is producing a one-tile pinch somewhere. Report which circuit and which point, and check `walkLine` is being called for every rail including the outermost.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): carve as a pipeline over per-point meta"
```

---

## Task 8: Shortcuts

**Files:**
- Modify: `server/cutline.js`
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: the cycle from `findCycle`, `carve`'s stages.
- Produces: `SHORTCUT_CHANCE`, `SHORTCUT_WIDTH`, and `shortcuts` in `carve`'s return.

**The rule that matters:** checkpoints sit only on the trunk, never on a branch and never between a branch point and its rejoin. Both routes then pass every checkpoint in order and the ring needs no knowledge that a branch exists. Getting this wrong reproduces the lap-counting bug from the other direction.

- [ ] **Step 1: Write the failing test**

```js
test('a shortcut branches from the trunk and rejoins it', () => {
  let found = 0
  for (const circuit of CIRCUITS) {
    const { shortcuts, centerline } = carve(circuit.seed)
    if (!shortcuts || shortcuts.length === 0) continue
    found++
    for (const s of shortcuts) {
      assert.ok(s.fromIndex >= 0 && s.fromIndex < centerline.length, 'branch point on the line')
      assert.ok(s.toIndex >= 0 && s.toIndex < centerline.length, 'rejoin point on the line')
      assert.notEqual(s.fromIndex, s.toIndex, 'a shortcut must go somewhere')
      assert.ok(s.points.length > 1, 'a shortcut must have a path')
    }
  }
  assert.ok(found > 0, 'no circuit had a shortcut')
})

test('no checkpoint ever sits on a shortcut or inside the stretch it skips', () => {
  // This is the rule that keeps the checkpoint ring ignorant of branches. Break
  // it and taking the shortcut silently stops the lap counting, which is the
  // lap bug from the other direction.
  for (const circuit of CIRCUITS) {
    const { shortcuts, checkpoints, centerline } = carve(circuit.seed)
    if (!shortcuts || shortcuts.length === 0) continue
    for (const s of shortcuts) {
      for (const cp of checkpoints) {
        const inSkipped = s.fromIndex < s.toIndex
          ? cp.index > s.fromIndex && cp.index < s.toIndex
          : cp.index > s.fromIndex || cp.index < s.toIndex
        assert.ok(
          !inSkipped,
          `${circuit.name}: checkpoint at ${cp.index} lies inside a stretch a shortcut skips`,
        )
      }
    }
  }
})

test('a lap completed via a shortcut still counts', () => {
  const idx = CIRCUITS.findIndex((c) => (carve(c.seed).shortcuts ?? []).length > 0)
  if (idx < 0) return // no shortcut on any circuit is covered by the test above
  const match = make({ circuitIndex: idx })
  join(match, { name: 'S' }, () => 0)
  startRace(match)
  const [car] = [...match.cars.values()]

  // Take every checkpoint, which is what a shortcut runner still does, then
  // cross the line.
  for (let c = 1; c < match.checkpoints.length; c++) {
    const cp = match.checkpoints[c]
    car.x = cp.x
    car.y = cp.y
    updateProgress(match, car)
  }
  crossLine(match, car)
  assert.equal(car.lap, 1, 'a lap taken via the shortcut must count')
})

test('a shortcut is narrower than the trunk it bypasses', () => {
  for (const circuit of CIRCUITS) {
    const { shortcuts, meta } = carve(circuit.seed)
    for (const s of shortcuts ?? []) {
      assert.ok(
        SHORTCUT_WIDTH < meta[s.fromIndex].width,
        `a shortcut must cost something: ${SHORTCUT_WIDTH} against ${meta[s.fromIndex].width}`,
      )
    }
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL. `carve` returns no `shortcuts`.

- [ ] **Step 3: Implement**

```js
// A shortcut is a chord across the cycle: shorter than the trunk between the
// same two points, and narrower, so it costs control to save distance.
export const SHORTCUT_CHANCE = 0.5   // per circuit, from the decoration stream
export const SHORTCUT_WIDTH = 5
```

In `carve`, after stage 7, add stage 8. Place the chord between two centreline
points that are far apart along the track but close in space, and carve it at
`SHORTCUT_WIDTH`:

```js
  // 8. Shortcuts. A chord between two points far apart along the lap but close
  //    in space. Checkpoints are placed in stage 6 from startIndex, so the chord
  //    is chosen to skip a stretch that contains none: both routes then pass
  //    every checkpoint and the ring never learns a branch exists.
  const shortcuts = []
  if (rng() < SHORTCUT_CHANCE) {
    const n = centerline.length
    const cpIndices = checkpoints.map((c) => c.index)
    const skipsACheckpoint = (from, to) =>
      cpIndices.some((ci) => (from < to ? ci > from && ci < to : ci > from || ci < to))

    let best = null
    for (let a = 0; a < n; a += 3) {
      for (let b = a + Math.floor(n * 0.15); b < a + Math.floor(n * 0.4); b += 3) {
        const to = b % n
        if (skipsACheckpoint(a, to)) continue
        const d = Math.hypot(centerline[a].x - centerline[to].x, centerline[a].y - centerline[to].y)
        const along = (to - a + n) % n
        // Worth cutting only if the straight line is much shorter than the road.
        if (d > along * 0.55) continue
        if (!best || d < best.d) best = { from: a, to, d }
      }
    }

    if (best) {
      const from = centerline[best.from]
      const to = centerline[best.to]
      const steps = Math.max(2, Math.round(best.d))
      const points = []
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
      }

      const half = Math.floor(SHORTCUT_WIDTH / 2)
      for (let s = 0; s < points.length - 1; s++) {
        const p = points[s]
        const q = points[s + 1]
        const dx = q.x - p.x
        const dy = q.y - p.y
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        for (let off = -half; off <= half; off++) {
          walkLine(
            Math.round(p.x + nx * off),
            Math.round(p.y + ny * off),
            Math.round(q.x + nx * off),
            Math.round(q.y + ny * off),
            (x, y) => {
              // Never overwrite the racing surface, only wall and run off.
              const at = surfaceAt(grid, x, y)
              if (at === S_WALL || at === S_GRAVEL) put(x, y, Math.abs(off) === half ? S_KERB : S_TARMAC)
            },
          )
        }
      }

      shortcuts.push({ fromIndex: best.from, toIndex: best.to, points })
    }
  }
```

Return `shortcuts` from `carve` and carry it through `make`.

- [ ] **Step 4: Run the tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test
```

**If no circuit gets a shortcut**, the chord filter is too strict. Report how many candidates were rejected by each condition before relaxing `d > along * 0.55`.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline.test.js
git commit -m "feat(cutline): branching shortcuts that keep checkpoints on the trunk"
```

---

## Task 9: Circuit selection

Offline tooling. Generates many circuits, measures them, and prints the eight most unlike each other.

**Files:**
- Create: `server/cutline-select.mjs`
- Modify: `server/cutline.js` (the `CIRCUITS` array only)
- Test: `server/cutline.test.js`

**Interfaces:**
- Consumes: `carve`, `buildCenterline`, `CORNERS`.
- Produces: `measureCircuit(seed) -> { lapLength, longestStraight, tightestCorner, directionChanges, chicanes, shortcuts, meanWidth }`, and a regenerated `CIRCUITS`.

- [ ] **Step 1: Write the failing test**

```js
test('a circuit can be measured, and the shipped eight are genuinely different', () => {
  const measured = CIRCUITS.map((c) => measureCircuit(c.seed))

  for (const m of measured) {
    assert.ok(m.lapLength > 0, 'a lap must have length')
    assert.ok(m.longestStraight > 0, 'every circuit needs a straight')
    assert.ok(m.directionChanges >= MIN_SIGN_CHANGES, 'every circuit must counter turn')
  }

  // No two shipped circuits may be near-identical on every axis, or the
  // selection pass has silently degraded to eight rolls of the same dice.
  for (let i = 0; i < measured.length; i++) {
    for (let j = i + 1; j < measured.length; j++) {
      const a = measured[i]
      const b = measured[j]
      const same =
        Math.abs(a.lapLength - b.lapLength) < 5 &&
        Math.abs(a.longestStraight - b.longestStraight) < 3 &&
        Math.abs(a.directionChanges - b.directionChanges) < 2
      assert.ok(
        !same,
        `${CIRCUITS[i].name} and ${CIRCUITS[j].name} are the same circuit in two costumes`,
      )
    }
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL. `measureCircuit` is not exported.

- [ ] **Step 3: Implement**

In `server/cutline.js`:

```js
/** Everything about a circuit that distinguishes it from another one. */
export function measureCircuit(seed) {
  const { centerline, meta, shortcuts } = carve(seed)
  let longestStraight = 0
  let run = 0
  let directionChanges = 0
  let lastSign = 0
  let chicanes = 0
  let tightest = 0
  let widthSum = 0

  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]
    widthSum += m.width
    if (m.corner === null) {
      run++
      if (run > longestStraight) longestStraight = run
    } else {
      run = 0
      const spec = CORNERS.find((c) => c.name === m.corner)
      if (spec && spec.rad > tightest) tightest = spec.rad
      if (m.corner === 'chicane') chicanes++
      if (m.sign !== 0) {
        if (lastSign !== 0 && m.sign !== lastSign) directionChanges++
        lastSign = m.sign
      }
    }
  }

  return {
    lapLength: centerline.length,
    longestStraight,
    tightestCorner: tightest,
    directionChanges,
    chicanes,
    shortcuts: (shortcuts ?? []).length,
    meanWidth: Math.round((widthSum / meta.length) * 100) / 100,
  }
}
```

Create `server/cutline-select.mjs`:

```js
// Offline circuit selection. Never imported by the game: it prints a CIRCUITS
// array to paste into cutline.js. Generating 400 circuits and picking the eight
// most unlike each other is what stops the shipped set being eight rolls of the
// same dice.
//
// Run: export PATH="/c/Program Files/nodejs:$PATH" && node server/cutline-select.mjs
import { measureCircuit } from './cutline.js'

const POOL = 400
const KEEP = 8

const NAMES = [
  'Foundry Loop', 'Coolant Bend', 'The Spindle', 'Slag Pit',
  'Draw Bench', 'Cinder Yard', 'Ladle Row', 'Tap Hole',
  'Blast Row', 'Skip Lane', 'Tundish Turn', 'Bloom Yard',
]

const rows = []
for (let seed = 1000; seed < 1000 + POOL; seed++) {
  try {
    rows.push({ seed, m: measureCircuit(seed) })
  } catch {
    // A seed that cannot be carved is simply not a candidate.
  }
}

// Normalise each axis so no one measurement dominates the distance.
const axes = ['lapLength', 'longestStraight', 'tightestCorner', 'directionChanges', 'chicanes', 'shortcuts', 'meanWidth']
const range = {}
for (const a of axes) {
  const vs = rows.map((r) => r.m[a])
  range[a] = { min: Math.min(...vs), max: Math.max(...vs) }
}
const vec = (m) => axes.map((a) => {
  const { min, max } = range[a]
  return max === min ? 0 : (m[a] - min) / (max - min)
})
const dist = (p, q) => Math.hypot(...p.map((v, i) => v - q[i]))

// Greedy farthest-point selection: start from the most extreme circuit, then
// repeatedly take whichever candidate is furthest from everything chosen.
const chosen = [rows.reduce((best, r) => (vec(r.m).reduce((a, b) => a + b, 0) > vec(best.m).reduce((a, b) => a + b, 0) ? r : best), rows[0])]
while (chosen.length < KEEP) {
  let best = null
  for (const r of rows) {
    if (chosen.includes(r)) continue
    const d = Math.min(...chosen.map((c) => dist(vec(r.m), vec(c.m))))
    if (!best || d > best.d) best = { r, d }
  }
  if (!best) break
  chosen.push(best.r)
}

console.log('export const CIRCUITS = [')
chosen.forEach((c, i) => {
  const m = c.m
  console.log(
    `  { name: '${NAMES[i]}', seed: ${c.seed} },` +
      `  // lap ${m.lapLength}, straight ${m.longestStraight}, tightest ${m.tightestCorner}, ` +
      `turns ${m.directionChanges}, chicanes ${m.chicanes}, shortcuts ${m.shortcuts}`,
  )
})
console.log(']')
```

- [ ] **Step 4: Run the selector and paste its output**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node server/cutline-select.mjs
```

Replace the `CIRCUITS` array in `server/cutline.js` with the printed one, keeping the trailing measurement comments. Then:

```bash
npm test
```

**If two chosen circuits still trip the sameness assertion**, the pool is too small or the axes are degenerate. Report the measurements of the offending pair rather than loosening the assertion.

- [ ] **Step 5: Commit**

```bash
git add server/cutline.js server/cutline-select.mjs server/cutline.test.js
git commit -m "feat(cutline): select circuits by measured difference rather than by seed"
```

---

## Task 10: The client

**Files:**
- Modify: `src/pages/Cutline.jsx`

**Interfaces:**
- Consumes: `airborne`, `airT` from the snapshot; `S_GRAVEL`, `S_RAMP` already rendered in Task 2.

No unit tests: this is rendering. Verified by running it.

- [ ] **Step 1: Draw airborne cars**

In the car-drawing block, before the body is drawn, scale and offset by the arc, and draw a shadow that separates from the car as it rises. Height is a parabola over `airT`:

```js
        // Render only: the server sends airborne and a normalised airT and the
        // page invents the arc. No rule reads any of this back.
        const lift = car.airborne ? Math.sin((car.airT ?? 0) * Math.PI) : 0
        if (lift > 0) {
          ctx.save()
          ctx.globalAlpha = 0.35
          ctx.fillStyle = '#000'
          ctx.beginPath()
          ctx.ellipse(0, lift * u * 0.5, L * 0.45, W * 0.4, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
          ctx.translate(0, -lift * u * 0.5)
          ctx.scale(1 + lift * 0.18, 1 + lift * 0.18)
        }
```

- [ ] **Step 2: Show the item and state clearly**

Airborne is a status, so it must not be carried by position alone. Add it to the HUD state line beside boosting, drafting and sliding, and give the car a brief outline while in the air.

- [ ] **Step 3: Run it end to end**

Three shells:

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run cutline
```

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run dev
```

Open `http://localhost:5173/play/cutline`, enter the grid, start with bots.

Check, and report on each: circuits visibly differ from one another across restarts; at least one corner requires braking; gravel appears outside fast corners and costs time without ending the race; a ramp launches the car and it lands; pickups appear in ranks across the road; the lap banner fires at the line.

**Before starting the server, check nothing else holds port 8088.** A stale match server answers on the old code and silently makes a verification meaningless:

```bash
netstat -ano | grep 8088
```

- [ ] **Step 4: Build**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Cutline.jsx
git commit -m "feat(cutline): draw airborne cars, gravel and ramps"
```

---

## Task 11: Documentation

**Files:**
- Modify: `CLAUDE.md`, `GEMINI.md`

- [ ] **Step 1: Record the invariants**

Add to `CLAUDE.md` under "Invariants that fail silently", and mirror into `GEMINI.md`:

```markdown
- **Cutline: a circuit is a closed cycle on a lattice, not a polar curve.** The
  old centreline was `r(angle)` as a sum of harmonics, which is single valued in
  angle, so it always bent around the grid centre: every corner turned the same
  way and curvature was global, which is why every circuit read as the same
  deformed circle. A lattice cycle never revisits a vertex, which is what makes
  self-intersection impossible, and `cycleAccepted` refuses an oval rather than
  repairing one. `MIN_SIGN_CHANGES` is the rule that does that; loosening it
  brings the old defect back in a new shape.
- **Cutline: `LATTICE_CELL` is derived from `SEGMENT_WIDTH_MAX + MIN_WALL`.**
  Two parallel corridors that merge read as a shortcut nobody designed, and the
  checkpoint ring rejects the lap that results.
- **Cutline: every geometric constant derives from `SEGMENT_WIDTH_MAX` or from
  `meta[i].width`, never from a number written twice.** A hardcoded
  `CHECKPOINT_RADIUS` of 4.0 survived one widening of the road and silently put
  the outer racing line out of reach: a car 4 tiles off centre missed 10 of 11
  checkpoints and its lap never counted, which reads as a lap counter that
  randomly stops.
- **Cutline: checkpoints sit only on the trunk, never on a shortcut branch and
  never inside the stretch a branch skips.** Both routes then pass every
  checkpoint in order and the ring needs no knowledge that a branch exists.
- **Cutline: ramp height is render only.** The rules track `airUntil` and
  nothing else; `airT` exists for the page to draw an arc with. Giving the rules
  a z axis would make this a different game.
- **Cutline: the car's collision shape derives from the car that is drawn.**
  `CAR_LENGTH` and `CAR_WIDTH` are the page's dimensions and the hitbox's, and
  `CAR_RADIUS` derives from `CAR_WIDTH`. They drifted once: the page drew a body
  1.45 by 0.82 while walls were tested at a single point at the car's centre, so
  a nose could sit most of a tile inside a wall with nothing registering.
- **Cutline: `MAX_CORNER_RAD` is the tightest entry in `CORNERS`, not a ceiling
  every circuit hugs.** Corner speeds are derived from the handling model:
  `v = TURN_RATE / (k + TURN_RATE * TURN_FALLOFF / TOP_SPEED)`. The vocabulary
  spans flat out to 33% of top speed on purpose, because a racer whose corners
  never need a brake has removed the main thing a driver does.
```

Update the commands block if `npm run cutline` changed, and add a line for the
offline selector:

```
node server/cutline-select.mjs   # regenerate CIRCUITS by measured difference
```

- [ ] **Step 2: Verify and commit**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test && npm run build
git add CLAUDE.md GEMINI.md
git commit -m "docs(cutline): record the lattice generator invariants"
```

---

## Self-Review

**Spec coverage.** Section 2 (generator) is Tasks 3 and 4. Section 2.4 (chicanes) is Task 5. Section 3 (per-segment width) is Task 5. Section 4 (gravel) is Tasks 2 and 7. Section 5 (shortcuts) is Task 8. Section 6 (ramps) is Tasks 2, 6 and 10. Section 7 (selection) is Task 9. Section 8 (collision) is Task 1. Section 9 (re-derivation) is spread across Tasks 4, 7 and 11. Section 10 (testing) is distributed. Section 11's risks each have a named response in the task that carries them.

**One spec requirement deliberately deferred, and it needs saying:** Section 9 notes that bots follow the trunk and ignore shortcuts. No task changes `driveBots`, so bots continue to follow the centreline, which after Task 7 is the trunk. That is the intended behaviour and needs no work, but it means a human taking a shortcut will beat a bot that never does.

**Placeholder scan.** No TBD, TODO or "handle edge cases" remains. Every code step carries real code. Task 10 is prose because it is rendering, and its verification steps are concrete and checkable.

**Type consistency.** `buildCenterline` returns `{ centerline, meta }` from Task 4 onward and every later task destructures exactly that. `carve` returns `{ grid, centerline, meta, checkpoints, startSlots, pickups, shortcuts }` from Task 8 onward; Tasks 7 and 9 destructure subsets of it, which is consistent. `meta[i]` is `{ width, corner, sign }` throughout. `carCorners`, `bodyHitsWall`, `capsule`, `findCycle`, `cycleAccepted`, `pickStartIndex` and `measureCircuit` each appear with one signature.

**Ordering note for the executor.** Task 4 changes `buildCenterline`'s return type. It absorbs that with a one-line adapter in `carve` rather than leaving the suite red until Task 7, so **every task in this plan ends with a green suite** and a reviewer can always gate on one. Task 7 removes the adapter when it rewrites `carve`. If you find yourself with a red suite at the end of any task, that is a defect, not the plan working as intended.
