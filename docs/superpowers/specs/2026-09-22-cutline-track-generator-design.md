# Cutline Track Generator: Design Specification

Replacing the harmonic centreline with a lattice-derived one, so a circuit can
contain hairpins, straights, chicanes, shortcuts and ramps rather than being a
deformed circle. Includes the collision-shape correction, which is unrelated in
cause but lands in the same files.

---

## 1. Why This Exists

### The measured problem

Every Cutline circuit reads the same. The cause is structural, not a matter of
tuning. `buildCenterline` produces a polar curve:

```
r(angle) = BASE_RADIUS + sum over k of amp_k * sin(k * angle + phase_k)
```

That is single valued in angle, which bought three guarantees cheaply: the loop
closes with no seam, it can never cross itself, and its curvature is bounded so
`MAX_CORNER_RAD` is provable. Those guarantees are why it was chosen and they
must be preserved.

But it has two consequences that cannot be tuned away:

1. **Every corner turns the same way.** The curve always bends around the grid
   centre, so a lap is one continuous right hander. A closed loop must net one
   full revolution, but this one spends it uniformly instead of banking counter
   turns against each other.
2. **Curvature is global and smooth.** There is no way to put a hairpin in one
   place and a straight in another. Raising `MAX_CORNER_RAD` makes the whole
   circuit wobblier rather than adding a corner.

`MAX_CORNER_RAD = 0.30` was derived so that no corner ever requires braking: at
0.30 rad per tile a corner is taken at about 57% of `TOP_SPEED`. A racer whose
corners never require a brake has removed the main thing a driver does.

### What this adds

Corner variety in both directions, straights, chicanes, gravel run off,
per segment width, branching shortcuts, and ramps that jump. Plus a collision
shape that matches the car that is drawn.

---

## 2. The Generator

### 2.1 Lattice

A circuit is a closed cycle on a coarse lattice, then smoothed.

```js
export const MIN_WALL = 3            // tiles of wall between parallel corridors
export const SEGMENT_WIDTH_MAX = 11  // widest a segment may be
export const SEGMENT_WIDTH_MIN = 7   // narrowest a trunk segment may be
// Derived, not chosen. Two parallel corridors must not merge, so their centres
// must be at least the widest road plus a wall apart. Break this and the carve
// produces two stretches of track fused into one, which reads as a shortcut
// nobody designed and which the checkpoint ring will not accept.
export const LATTICE_CELL = SEGMENT_WIDTH_MAX + MIN_WALL   // 14
export const LATTICE_N = 6                                  // vertices per side
export const LATTICE_ORIGIN = 8                             // inset from the grid edge

// Acceptance thresholds for a generated cycle. A 6 by 6 lattice has 36 vertices,
// so a cycle of 16 edges is a lap that uses a meaningful part of the board
// rather than a corner of it.
export const MIN_CYCLE_EDGES = 16
export const MIN_DIRECTION_CHANGES = 8
export const MIN_SIGN_CHANGES = 3     // counter turns, what stops it being an oval
export const MIN_STRAIGHT_EDGES = 3   // collinear lattice edges that count as a straight
export const CYCLE_ATTEMPTS = 200     // walks before falling back to the known good cycle

// Width may not step. A one tile ledge mid corner catches a wheel and reads as a
// collision bug rather than as geometry.
export const WIDTH_RAMP_PER_POINT = 0.25   // tiles of width change per centreline point
```

Vertices sit at `LATTICE_ORIGIN + i * LATTICE_CELL` for `i` in `0..LATTICE_N-1`,
so 8, 22, 36, 50, 64, 78. The extreme extent of a circuit is therefore
`78 + SEGMENT_WIDTH_MAX / 2 = 83.5` against `GRID = 96`, and the near edge is
`8 - 5.5 = 2.5`. Both inside the grid with margin.

### 2.2 Finding a cycle

1. Seeded random walk on lattice edges from a random start vertex, never reusing
   an edge and never revisiting a vertex except to close.
2. On returning to the start, accept the cycle if it satisfies the acceptance
   rules below. Otherwise discard and walk again with the next rng draw.
3. Give up after `CYCLE_ATTEMPTS` walks and fall back to a known good hand
   written lattice cycle, so generation can never fail to return a circuit.

**Acceptance rules**, each of which exists to prevent a specific failure:

| Rule | Prevents |
|---|---|
| At least `MIN_CYCLE_EDGES` edges | A trivially short lap |
| At least `MIN_DIRECTION_CHANGES` turns | An oval, the thing being fixed |
| At least `MIN_SIGN_CHANGES` counter turns | A lap that curves only one way |
| No vertex used twice | Self intersection |
| A run of `MIN_STRAIGHT_EDGES` collinear edges | A circuit with no straight at all |

### 2.3 Smoothing a lattice corner into a real corner

Each lattice vertex where the path changes direction becomes a corner. The
corner's radius is drawn from a vocabulary, and its entry in the table is what
decides the speed a driver must slow to.

At speed `v` a car turns `TURN_RATE * (1 - TURN_FALLOFF * v / TOP_SPEED) / v`
radians per tile. Solving for a target `k` gives
`v = TURN_RATE / (k + TURN_RATE * TURN_FALLOFF / TOP_SPEED)`.

| Name | rad/tile | Required speed | Share of `TOP_SPEED` | Feel |
|---|---|---|---|---|
| `sweeper` | 0.15 | 12.7 | 90% | flat out |
| `standard` | 0.30 | 7.9 | 57% | lift |
| `tight` | 0.45 | 5.8 | 41% | brake |
| `hairpin` | 0.60 | 4.6 | 33% | hard brake |

`MAX_CORNER_RAD` changes meaning: it stops being a ceiling every circuit hugs
and becomes the hairpin's value, 0.60. The corner arc is generated as a circular
fillet of the radius implied by `k`, inserted between the two straights meeting
at that vertex.

### 2.4 Chicanes

A chicane is generated as one feature, not three unrelated corners: a
`tight` one way immediately followed by a `tight` the other, with a short
straight between them sized so a car cannot take both on one line. Generated on
a straight run of at least three collinear lattice edges, so there is room.

This is where the both directions requirement becomes something a driver feels
rather than a statistic a test asserts.

### 2.5 Output

`buildCenterline(seed)` keeps its signature and still returns a closed ring of
points spaced `POINT_SPACING` apart, produced by the existing `resample()`. It
gains a parallel array describing each point:

```js
{ centerline, meta }
// meta[i] = { width, surfaceOutside, corner: null | 'sweeper' | 'tight' | ..., sign: -1 | 0 | 1 }
```

Everything downstream reads `meta` rather than re-deriving geometry.

---

## 3. Per Segment Width

Width becomes a property of a stretch rather than a global constant.

* Straights and hairpin entries widen toward `SEGMENT_WIDTH_MAX`, so there is
  room to out brake somebody.
* Technical sections and chicanes narrow toward `SEGMENT_WIDTH_MIN`.
* Width changes are ramped over several centreline points rather than stepping,
  so the carve never produces a one tile ledge to catch a wheel on.

`TRACK_WIDTH` is retired as a single global. Everything that derived from it now
derives from `SEGMENT_WIDTH_MAX`, which is the value that actually bounds the
geometry:

* `CHECKPOINT_RADIUS = SEGMENT_WIDTH_MAX / 2 + CHECKPOINT_SLACK`
* `LINE_HALF_SPAN` likewise
* `LATTICE_CELL` as above

This is the same trap that produced the lap counting bug: a hardcoded
`CHECKPOINT_RADIUS` of 4.0 survived the road widening from 7 to 11 and silently
put the outer racing line out of reach, so a car 4 tiles off centre missed 10 of
11 checkpoints and its lap never counted. Anything that must track the road's
width is derived from it, never written down twice.

---

## 4. Gravel Run Off

A new surface, `S_GRAVEL`, placed outside fast corners and hairpin exits in
place of wall.

```js
export const S_GRAVEL = 7
export const GRIP_GRAVEL = 2.0       // between kerb 4.0 and oil 0.6
export const GRAVEL_DRAG = 3.0       // scrubs speed without stopping the car
```

Running wide costs time instead of ending the race, which is what makes a hard
braking zone a risk worth taking rather than a punish. Gravel is not off track:
`offTrack` stays reserved for `S_WALL`, so the existing off track cap and drag
are untouched.

**Adding a surface touches three places and the wire will carry `undefined` if
any is missed**: `SURFACE_CHARS`, the `GRIP` table, and the page's `prerender`.
The same shape as the Blockout 3D `CHAR` table invariant.

---

## 5. Shortcuts

A shortcut is a chord: a second lattice path between two vertices already on the
cycle, shorter than the trunk between them.

**Checkpoints only ever sit on the trunk, never on a branch, and never between a
branch point and its rejoin.** Both routes then pass every checkpoint in order
and the checkpoint ring needs no knowledge that a branch exists. Getting this
wrong reproduces the lap counting bug from the other direction: the lap silently
never counts.

A shortcut must be a real trade, so it pays for its distance with at least one
of:

| Cost | Mechanism |
|---|---|
| Narrower | width set to `SEGMENT_WIDTH_MIN` or below |
| Lower grip | `S_GRAVEL` surface along part of it |
| No pickups | pickup ranks are placed on the trunk only |
| Ramp gated | entry is a ramp that needs speed to clear |

Ramp gating is the most interesting because it self balances: the shortcut
rewards a driver who was already fast out of the previous corner, rather than
handing time to whoever happened to take it.

---

## 6. Ramps

```js
export const S_RAMP = 8
export const RAMP_MIN_SPEED = 8.0    // below this a ramp is just bumpy tarmac
export const AIR_MS = 700
export const AIR_STEER = 0.25        // steering authority while airborne
```

Crossing `S_RAMP` at or above `RAMP_MIN_SPEED` sets `car.airUntil`. While
`match.now < car.airUntil`:

* hazards are skipped entirely, so a slick or a banana under the car does nothing
* wall contact is skipped, so a gap or a barrier can be cleared
* steering authority is `AIR_STEER`
* speed is carried, neither gained nor scrubbed

On landing, the surface under the car is resolved normally: tarmac is clean,
gravel scrubs, wall applies the off track penalty.

**Height is render only.** The snapshot carries `airborne` and a normalised
`airT` for the page to draw an arc and a shadow with. The rules never gain a z
axis, which is what stops this becoming a 3D game. This is the same division
Blockout 3D uses for its jump: the arc is visual, the clearance is authoritative.

---

## 7. Circuit Selection

Rather than eight arbitrary seeds, generate many and keep the most distinct.

1. Generate `SELECTION_POOL` circuits from sequential seeds, where
   `SELECTION_POOL = 400`. Large enough that the measurement space is well
   covered, small enough that the offline pass finishes in seconds.
2. Measure each: lap length, longest straight, tightest corner, count of
   direction changes, chicane count, shortcut count, mean width.
3. Greedily select eight that maximise pairwise distance in that measurement
   space, so the shipped set is varied by construction rather than by luck.
4. Name each from its own measurements, drawing from the plant lexicon, and
   freeze the chosen seeds into `CIRCUITS`.

This runs **offline**, as a script under `server/`, not at match start. The
output is the same `CIRCUITS` array of `{ name, seed }` the game already has, so
nothing downstream changes and a match server never pays for selection.

---

## 8. Collision Shape

Unrelated in cause, but it lands in the same files and the same tests.

The car is drawn 1.45 by 0.82 tiles. Collision uses a circle of radius 0.45, and
wall contact tests a **single point** at the car's rounded centre. The nose
extends 0.725 tiles beyond that point, so a car can be most of a tile inside a
wall before anything registers, and two cars overlap nose to tail without ever
touching.

```js
export const CAR_LENGTH = 1.45
export const CAR_WIDTH = 0.82
export const CAR_RADIUS = CAR_WIDTH / 2     // derived, was a separate 0.45
```

* **The page draws from these constants**, so the drawn shape and the hitbox
  cannot drift apart. They drifted in the first place because the page invented
  its own numbers.
* **Walls**: test the four corners of the oriented rectangle rather than the
  centre. Four lookups per axis test, about four thousand a second at eight
  cars, which is free.
* **Car to car**: a capsule. Two circles of radius `CAR_RADIUS` centred at
  `±(CAR_LENGTH / 2 - CAR_RADIUS)` along the heading, which is the drawn body
  almost exactly, and still only a handful of distance checks.

---

## 9. What Breaks, And Must Be Re-derived

| Thing | Change |
|---|---|
| `MAX_CORNER_RAD` test | Inverts. From "no corner exceeds 0.30" to "corners span the vocabulary and appear in both directions" |
| `CHECKPOINT_RADIUS`, `LINE_HALF_SPAN` | Derive from `SEGMENT_WIDTH_MAX` rather than `TRACK_WIDTH` |
| `carve()` | Becomes a pipeline over a segment list rather than one pass along one centreline. This is the largest single piece of work |
| Bot racing line | The centreline is no longer the only path. Bots follow the trunk and ignore shortcuts in this version |
| Start slots | Must sit on a straight, never mid corner. The lattice knows which runs are straight |
| Pickup ranks | Trunk only, and their lateral spread scales with the local segment width |
| `encodeMap` size | More surfaces and more varied geometry. Must stay under `maxPayload` 4096 |
| `SURFACE_CHARS`, `GRIP`, `prerender` | Two new surfaces, three places each |

**Bots ignoring shortcuts is a deliberate limitation of this version.** A bot
that cannot judge whether a gamble paid off would take the shortcut every time
and look foolish doing it. A human taking a line no bot takes is an acceptable
first state, and is honest about what was built.

---

## 10. Testing

The existing suite's discipline holds: constants referenced never literals,
randomness injected, and every test asked whether it would fail if the mechanic
it names were removed.

### Generator invariants, asserted for every circuit in `CIRCUITS`

* The centreline is closed and evenly spaced, including across the wrap.
* The racing surface is one connected region.
* No corner exceeds the hairpin's radius.
* **Corners appear in both directions**, at least `MIN_SIGN_CHANGES` counter
  turns. This is the test that fails if the generator regresses to an oval.
* At least one straight of the required length exists.
* Every checkpoint is reachable from the full width of its local segment.
* Parallel corridors never come closer than `MIN_WALL`.
* The encoded map stays under 4096 bytes.
* The same seed produces an identical grid.

### Feature tests

* A shortcut branches and rejoins, and no checkpoint lies on a branch.
* Completing a lap via the shortcut counts, exactly as the trunk does.
* A ramp above `RAMP_MIN_SPEED` sets `airUntil`; below it does not.
* An airborne car ignores a slick, a banana and a wall it would otherwise hit.
* An airborne car lands and resolves its landing surface normally.
* Gravel scrubs speed without triggering the off track branch.
* Width varies along a lap and never steps by more than one tile per point.

### Collision tests

* A car's nose entering a wall registers contact, which it does not today.
* Two cars overlapping nose to tail register contact, which they do not today.
* `CAR_RADIUS` derives from `CAR_WIDTH`, and the page's drawn dimensions come
  from the same constants.

### Selection

* The eight chosen circuits differ from each other on the measured axes by at
  least a stated minimum, so the selection pass cannot silently degrade to eight
  similar circuits.

---

## 11. Risks

1. **Cycle search may fail to close on some seeds.** Mitigated by the attempt
   cap and the hand written fallback, so generation always returns a circuit.
   The fallback firing often would mean the acceptance rules are too strict, and
   a test asserts it fires rarely across a large seed sample.
2. **Per segment width interacts with everything geometric.** The lattice
   spacing, the checkpoint reach, the pickup spread and the start slots all
   scale off it. This is the most likely source of a bug of the class already
   hit once, where a width change silently outran a hardcoded radius.
3. **Two new surfaces mean two more places to forget.** `SURFACE_CHARS`, the
   `GRIP` table and the page's `prerender` must move together or the wire
   carries `undefined` and the page draws nothing.
4. **The carve becoming a pipeline is the largest piece of work here** and the
   most likely to need splitting into its own task during planning.
5. **Ramps introduce a state where collision is suspended.** A car that becomes
   airborne and never lands, through a mis-set `airUntil`, would pass through
   everything forever. `airUntil` is reset in `startRace` alongside every other
   per-car timer, and a test asserts an airborne car lands.
