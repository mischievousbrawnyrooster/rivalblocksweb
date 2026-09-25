# Cutline Handling, Drift and Speedometer: Design Specification

Heavier, less on-rails handling, a Shift drift that scores points for fun, a
body that leans, pitches and bounces, and a needle speedometer.

---

## 1. Intent

### What was asked for

* Car movement that is more realistic, both in how it looks and how it drives.
  The driver named four faults: steering snaps to full lock, the car grips
  perfectly at any speed, speed changes feel instant, and wall and car contact
  feel wrong.
* Drifting on Shift. Drifting accumulates points, which are for fun, and is
  visible to the player while it happens. Bots must be able to drift through
  corners too.
* A redesigned speedometer: an analogue needle dial.

### Decisions already taken

* **Light handling changes, not a tyre simulation.** A slip-angle tyre model
  would change what the game is and force every circuit to be re-measured.
* **A drift is a tighter turn, not a boost.** Faster through hairpins and tight
  corners, slower through sweepers, so it is a choice per corner. No mini-turbo
  on release.
* **Drift points are never banked on the leaderboard.** They show live, as a
  race total, and in the results table.
* **Needle dial** over an LED arc, a tachometer or an F1 bar.

### Out of scope here

* Bots deciding when to drift. That is part of the bot AI task (shortcuts,
  items, drift), done after this and after the powerup task, because bots
  should be tuned once against the final handling and the final item kit. This
  spec only makes drift an input a bot can press.

### Success

* A car builds steering, slides wide through a fast sweeper unless the driver
  lifts, takes about 3 s to reach top speed and about 1 s to brake from it.
* A glancing wall hit keeps the car moving along the wall; a head-on hit stops
  it. A car hit from behind is shoved forward.
* Shift through a hairpin carries more speed than grip does, lays skid marks and
  smoke, and shows a growing counter that banks or is lost.
* Every circuit still passes its ramp, pad, hole and checkpoint checks with no
  re-selection, and bots still finish laps on all eight.

---

## 2. The constraint that keeps this contained

**The speed envelope does not change.** `TOP_SPEED`, `BOOST_MULT`,
`SLIP_BOOST`, `RAMP_MIN_SPEED` and `AIR_MS` keep their values.
`rampLandsClear`, wall-jump pad flights, hole placement, `CHECKPOINT_RADIUS` and
the eight `CIRCUITS` selected by `cutline-select.mjs` all depend on those
numbers, so none of them needs re-measuring. Only how a car reaches and holds
those speeds changes.

A drift never raises the speed cap. It changes turning and grip only.

---

## 3. Handling (server: `stepCar`, `resolveContact`)

### 3a. Steering builds

* New car field `steerNow`, moving toward held `steer` at `STEER_IN` (full lock
  in about 0.15 s) and back toward centre at `STEER_OUT` (about 0.08 s).
* `heading += steerNow * TURN_RATE * falloff * authority * dt`. Still a rate,
  never a position target: the Cutline steering invariant holds unchanged.
* A spin still ignores input outright. `steerNow` is reset to 0 by `startRace`.
* The snapshot's `steer` carries `steerNow` rounded to 0.01, so the drawn front
  wheels turn smoothly. `wheelYawFor` already takes a fraction.

### 3b. Grip falls off with speed

* Lateral grip is multiplied by `1 - GRIP_FALLOFF * (v / TOP_SPEED)^2` with
  throttle held, and by the same with `GRIP_FALLOFF * LIFT_GRIP` when lifted.
  About 35% gone at top speed on throttle, less off it.
* Applies after the surface lookup and the slick minimum, so oil, gravel and
  kerb keep their relative character.
* The `TURN_RATE` / `TURN_FALLOFF` heading formula is untouched, so `CORNERS`
  and its test still hold as the heading-rate limit. The slide makes fast
  corners a little slower in practice; the lap-time measurement records how much.

### 3c. Weight

* Thrust fades with speed: `ACCEL * (1 - ACCEL_FADE * v / cap)`. `ACCEL`,
  `ACCEL_FADE` and `DRAG` are retuned together so 0 to `TOP_SPEED` takes about
  3 s and thrust at `TOP_SPEED` still exceeds drag (a test holds this).
* `BRAKE` lowered so top speed to a stop takes about 1 s.
* Brake cuts thrust. Measured in the prototype: with the weaker brake, a car
  holding both (every bot does) accelerated below about 7 tiles/s instead of
  slowing.
* Coasting keeps the existing `DRAG`-driven slow-down, with `DRAG` lowered so
  a lifted car rolls on rather than being engine braked.
* Prototype values: `ACCEL` 17, `ACCEL_FADE` 0.56, `BRAKE` 11, `DRAG` 0.5.
  Measured 0 to top in 2.85 s and top to a stop in 0.99 s.

### 3d. Walls

The per-axis check stays; the blocked axis is the wall normal.

* The normal component bounces at `WALL_BOUNCE` (small).
* The tangential component is scrubbed by `WALL_SCRUB * impact`, where
  `impact = |v_normal| / |v|`: a glancing hit loses about 5%, a head-on hit
  keeps almost nothing.
* On a glancing hit, heading is turned toward the wall tangent by
  `WALL_ALIGN * impact`, so the car straightens out rather than grinding.
* Airborne and off-track cars keep today's exemptions.
* `WALL_HIT_KEEP` is replaced by these constants.

### 3e. Car contact

* After the existing positional separation, an equal-mass impulse along the
  contact normal with restitution `CAR_BOUNCE`, applied only when the cars are
  closing. Momentum is conserved.
* Ghosts and falling cars are still skipped, before any impulse.

---

## 4. Drift (server rules, input, snapshot)

### Input

* Page: either Shift key held sends `drift: 1` with the other held input.
* `applyInput` clamps `drift` to a boolean like `throttle` and `brake`.

### Engage and hold

* Starts when `drift` is held, `steerNow` is non-zero, speed is at least
  `DRIFT_MIN_SPEED` (about 6 tiles/s, 60 km/h), the car is grounded and not
  spinning or falling.
* Latches its side (`car.driftDir`, -1 or 1, from the steer that started it)
  until it ends.

### Physics while drifting

* Turn rate is `TURN_RATE * DRIFT_TURN` (1.8x) with `TURN_FALLOFF`
  mostly waived, driven by `driftDir` plus the driver's steer: into the drift
  tightens, centred holds, counter-steer widens.
* Sideways speed is turned into forward speed rather than scrubbed, so the
  drift carries its speed round the corner. Without this, the prototype
  showed the turn rate a hairpin needs bleeding speed faster than any throttle
  could replace. Lateral grip is `min(surface grip, DRIFT_GRIP)`, and
  `DRIFT_GRIP` (6, a little under tarmac's 7) only sets how sideways the car
  sits: about 40 to 45 degrees of slip.
* Extra drag `DRIFT_DRAG`, so a drift costs speed: little at 8 tiles/s, where
  thrust covers it, and more near the top, which is what makes a sweeper
  slower drifted than gripped.
* Measured in the prototype: at 9 tiles/s a drift turns the car's path at
  about 0.5 rad per tile, near the hairpin's 0.6, where grip manages about
  0.25 at that speed.

### End

* Clean: Shift released, or speed below `DRIFT_MIN_SPEED`.
* Lost: wall contact, a spin (`takeHit`), or leaving the ground.

### Scoring

* While drifting, `driftChain += speed * |slip angle| * DRIFT_POINTS * dt`,
  slip angle being the angle between velocity and nose.
* Clean end: chain added to `driftScore`. Lost: chain discarded.
* Either end records `driftEnd = { pts, lost, at }` for the page.
* `driftScore` resets in `startRace`. It is never passed to the board.

### Snapshot

**The frame is already near its budget.** Eight cars and a full hazard list
measure 3.8 KB today, and the drift fields add up to 85 bytes a car. So
`drafting`, `boosting`, `sliding`, `spinning` and `airborne`, sent as `false`
on every car every tick, join the rare-flag rule and are sent only while true.
That frees about 670 bytes. Every reader on the page already treats a missing
flag as false.

Rare-flag rule, sent only while true, to keep eight cars inside 4 KB:

* `driftScore`: integer, only when above 0.
* `drift` (the side) and `driftChain` (integer): only while drifting.
* `driftEnd: { pts, lost }`: only for `DRIFT_SHOW_MS` (about 1.2 s) after an end.

The page draws the outcome the rules decided. It never infers a banked or lost
chain by comparing snapshots.

### Bots

`car.drift` is one more held input, set the same way `driveBots` sets
`throttle` and `brake`. When to press it belongs to the bot AI task.

---

## 5. The page (render and HUD only)

### 5a. `src/lib/carPose.js`

Pure, like `carLift.js`: no three.js, no DOM, no imports, its own test. Per car
it keeps a little state (previous speed and heading, a spring) and returns:

* **roll:** away from the turn, proportional to `speed * yaw rate`, clamped to
  `MAX_ROLL` (about 6 degrees).
* **pitch:** nose down under deceleration, tail down under acceleration, clamped
  to `MAX_PITCH` (about 3 degrees).
* **bounce:** a damped spring kicked on the edge from airborne to grounded,
  settled in about 0.5 s.

Inputs are interpolated values from snapshots already received. That is
render, not prediction.

### 5b. Car mesh

* `buildCar`: body, cabin and lamps move into a `chassis` group that takes roll,
  pitch and bounce. Wheels stay on the ground.
* Wheel spin is dropped: the wheels are plain untextured cylinders, so a
  spinning one looks exactly like a still one.

### 5c. Drift effects

* Skid marks: the existing trigger becomes `car.sliding || car.drift`.
* Tyre smoke: puffs from the rear wheels while drifting, a fading layer built
  with `dynamicLayer` so it is never culled.

### 5d. Drift HUD (overlay canvas)

* While drifting: `DRIFT 1,240` top centre, scaling and pulsing faster as the
  chain grows.
* On `driftEnd`: `+1,240` rising and fading when clean; `LOST` with the number
  struck through when lost. Different words and shapes, not only colour
  (WCAG 1.4.1).
* Race total: a `DRIFT` line in the top-left panel.
* Driver Roster (the sidebar list, which is where best lap is shown): a Drift
  column beside Best Lap.
* The `sr-only` line includes the race total.

### 5e. Needle speedometer (`drawHud`)

* Dial from 0 to `SPEEDO_MAX` (about 223 km/h), ticks every 20 km/h, numerals
  every 40.
* Boost zone from `TOP_SPEED` to `SPEEDO_MAX`, hatched and labelled `BOOST`.
* Needle driven by the existing eased `shownSpeed`; digital readout and the
  `BOOST` / `DRAFT` tag beneath.
* The HUD's existing literal colours, so it matches the other panels.

### 5f. Controls list

Adds `Drift: Shift`.

---

## 6. Testing and tuning

### Existing tests adjusted

* "a step must never turn more than TURN_RATE allows": still true on grip;
  drift has its own bound, `TURN_RATE * DRIFT_TURN`.
* "a car driven into a wall keeps only WALL_HIT_KEEP": rewritten for 3d.
* Steering tests assuming instant full lock account for `steerNow`.

### New tests (constants, never literals)

* Steering reaches full lock within `STEER_IN` and centre within `STEER_OUT`.
* Full throttle reaches `TOP_SPEED`; braking from it stops in about 1 s.
* Lateral grip kept at top speed is less than at low speed, and more lifted
  than on throttle.
* Rear-end contact transfers speed forward and conserves momentum; ghosts and
  falling cars are skipped.
* Drift: no engage below `DRIFT_MIN_SPEED` or without steer; tighter than grip
  at equal speed; clean end banks; wall, spin and airborne lose; junk `drift`
  clamps to false.
* Snapshot: drift fields absent when not drifting; eight cars drifting stay
  under the 4 KB frame budget.
* `carPose.test.js`: flat pose at rest, roll sign follows the turn, every
  output within its clamp, the bounce settles.

### Measured tuning

* The existing method: 4 bots, fixed rng, 90 s per circuit, all eight. Median
  lap before and after, written into the comment above the handling constants.
* Bots must still finish laps on every circuit, and "a race resolves to exactly
  one winner" must pass. If the heavier braking trips bots before the AI task,
  the only change made here is `BOT_BRAKE_ANGLE`.
* A feel pass by the driver in the browser. Every value is a named constant.

### CLAUDE.md

New invariants: the speed envelope is fixed; eased steering is still a rate; a
drift chain's outcome is a rule, never a page inference; `carPose` reads only
received snapshots; drift points are never banked.
