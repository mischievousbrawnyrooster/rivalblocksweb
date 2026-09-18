# Cutline: System Architecture & Design Specification

A top-down elimination circuit racer. Eight works haulers run the service loops
of the plant, and at the end of every lap the car running last is cut.

---

## 1. Overview & In-Fiction Premise

**Cutline** is set in the same industrial works as **Blastworks**. Between
shifts the plant's service loops are run as a circuit, and the haulers that
move stock between galleries are raced on them. The format is the works
format: nobody is timed, nobody is lapped, and at the end of every lap the
hauler running last leaves the track. Seven cuts, one hauler left.

Tagline: *Nobody remembers who led lap one.*

Genre line for the CMS: *Elimination circuit racer, up to 8*

### Why this game exists

The repository has seven titles and two of them are already races: Void
Drillers is an excavation race and Cipher Run is a typing race. Neither is a
driving game. Cutline is the first title where the verb is steering, and it is
deliberately built on the cheapest renderer in the repo (Canvas 2D) rather
than the most expensive, because the design work here is in the handling model
and the cut, not in the picture.

### Studio Rules & Invariants

* **Strict three-layer architecture**:
  * Pure rules engine: `server/cutline.js` (zero Node APIs, zero timers, zero
    I/O, zero external imports).
  * Network adapter: `server/cutline-server.js` (WebSocket lifecycle on port
    8088 `/cutline-ws`, snapshot broadcasts, zero game decisions).
  * Shared pure logic: `server/board.js` (`board-cutline.json`).
  * Client: `src/pages/Cutline.jsx` (Canvas 2D, renders and forwards input,
    judges nothing).
* **Server authoritative for everything.** Move legality, contact, lap
  validation, the cut, the winner.
* **No client-side prediction.** The client renders only positions the server
  has authored. Interpolation via `src/lib/snapshotBuffer.js` is permitted and
  used; prediction is not.
* **Cleartext protocol.** JSON over plain `ws://`, `maxPayload: 4096`,
  `perMessageDeflate: false`, so frames stay readable in Wireshark.
* **Deterministic testing.** Randomness injected as an rng argument, never
  `Math.random` in a test path. Constants referenced, never literals.
* **Procedural art only.** Nothing the canvas draws loads a file. The single
  exception is the marketing cover at `public/art/cutline.jpg`.
* **Status never by colour alone** (WCAG 1.4.1). A car carries a number and a
  heading indicator as well as a colour token.
* **Zero em dashes in copy.**

---

## 2. The Control Model, And Why The Genre Works Here

Racing is the genre most sensitive to input latency, and this repository bans
client-side prediction outright. The design answer is the control model, and
it is the single most load-bearing decision in this spec.

**Steering is a rate, not a target.** The client sends held input state at
60 Hz:

```
{ t: 'input', steer: -1 | 0 | 1, throttle: 0 | 1, brake: 0 | 1, use: bool }
```

The server retains the last input per player and applies it on every tick.
Holding left turns the car continuously for as long as it is held. A round
trip of 40 ms therefore makes a turn begin 40 ms late and end 40 ms late,
which is felt as heavy steering rather than as the car fighting the driver.

**A position-target control model is forbidden.** Pointing at a spot and
driving to it, mouse steering, or any scheme where the client names a
destination rather than a rate, puts the delay between the driver's hand and
the car's nose, which is the failure mode that makes networked racers feel
broken. This is an invariant, not a preference.

**Rendering.** `src/lib/snapshotBuffer.js` is reused unchanged in behaviour
with `DELAY_MS = 60`, and the local car is drawn live via `sample(now, liveId)`
exactly as Blockout Royale 3D draws the body its camera follows. One
correction is required in that file: it unconditionally blends `fall`, which a
car snapshot does not carry, producing `NaN` in a field the racer never reads.
The blend is guarded so it applies only when the field is finite. Blockout 3D
behaviour is unchanged and `snapshotBuffer.test.js` gains a case covering a
snapshot without `fall`.

**`heading` is not interpolated.** At 60 Hz a car turns at most about three
degrees per tick, which is invisible on a 12 px sprite. Heading comes off the
newer frame untouched, the same way tiles, phase and the board already do.

---

## 3. Pure Rules Engine (`server/cutline.js`)

### 3.1 Constants & Configuration

```js
export const TICK_MS = 16            // 60 Hz simulation
export const SEND_MS = 16            // client input rate
export const DELAY_MS = 60           // client interpolation window

export const GRID = 96               // square, the arena is carved out of it
export const TRACK_WIDTH = 7         // tiles of tarmac across the racing surface
export const CHECKPOINT_COUNT = 12

export const MAX_PLAYERS = 8
export const MIN_PLAYERS = 2
export const BOT_FILL_TO = 4
export const MIN_LAPS = 3
export const GRACE_LAPS = 1          // lap 1 takes no cut

export const COUNTDOWN_MS = 4000
export const POST_RACE_GRACE_MS = 8000

// Handling, in tiles and seconds
export const TOP_SPEED = 14.0
export const ACCEL = 18.0
export const BRAKE = 26.0
export const DRAG = 1.2
export const TURN_RATE = 3.2         // rad/s at low speed
export const TURN_FALLOFF = 0.45     // fraction of turn rate lost at top speed

export const OFFTRACK_CAP = 6.5
export const OFFTRACK_DRAG = 6.0
export const WALL_HIT_KEEP = 0.25    // speed retained on wall contact

export const SLIP_RANGE = 3.5
export const SLIP_CONE = 0.7         // dot product against the leader's nose
export const SLIP_BOOST = 1.18

export const BOOST_MS = 3000         // the carried boost item
export const STRIP_BOOST_MS = 1200   // crossing an S_BOOST strip on the track
export const BOOST_MULT = 1.35       // shared by both
export const SLICK_TTL_MS = 9000
export const SLICK_RADIUS = 1.1
export const WALL_TTL_MS = 8000
export const PICKUP_RESPAWN_MS = 6000
export const MAX_HAZARDS = 16

export const BOT_NAMES = ['Ladle', 'Tap', 'Cinder', 'Bloom', 'Skip', 'Tundish', 'Runner']
```

**`MAX_PLAYERS` is derived from the starting slots on the line**, the same way
Blockout derives it from `SPAWNS.length`. Raising capacity means adding
starting slots, never editing the number.

### 3.2 Surfaces & The Grip Table

```js
export const S_WALL = 0
export const S_TARMAC = 1
export const S_KERB = 2
export const S_BOOST = 3
export const S_OIL = 4
export const S_PICKUP = 5
export const S_LINE = 6              // the cut line

export const SURFACE_CHARS = ['W', 'T', 'K', 'B', 'O', 'P', 'L']

// Lateral grip per surface, in units of "how fast sideways velocity bleeds off".
// This one table is where a circuit's entire character lives.
export const GRIP = {
  [S_TARMAC]: 7.0,
  [S_KERB]: 4.0,
  [S_BOOST]: 7.0,
  [S_OIL]: 0.6,
  [S_PICKUP]: 7.0,
  [S_LINE]: 7.0,
}
```

Surface lookup is a single array index into the static grid. There is no
proximity search and no spatial index, because the track never moves.

### 3.3 Handling

The standard arcade drift model, about fifteen lines, applied per car per tick:

```
1. heading += steer * TURN_RATE * (1 - TURN_FALLOFF * speed / TOP_SPEED) * dt
2. thrust along the nose:  v += unit(heading) * throttle * ACCEL * dt
3. braking and drag reduce the forward component only
4. split v into forward and lateral components relative to heading
5. lateral *= (1 - GRIP[surface] * dt)      // low grip slides, high grip bites
6. recompose v from forward and lateral
7. clamp to the effective top speed (base, times boost, times slipstream)
8. integrate position, then resolve contact
```

Crossing an `S_BOOST` strip sets the same boost window the item does, for
`STRIP_BOOST_MS` rather than `BOOST_MS`. There is one boost effect in the game
and two ways to acquire it, so the strip needs no separate code path.

Low grip is drift. Oil is grip near zero, so a car crossing a slick keeps its
momentum and loses its ability to change direction, which is the correct
feeling and needs no special case anywhere else.

**Off the racing surface** (a car overlapping `S_WALL`), `OFFTRACK_DRAG` and
`OFFTRACK_CAP` apply. **Contact with a wall** retains `WALL_HIT_KEEP` of speed
and reflects the velocity across the contact normal. **Car on car** contact is
a symmetric positional push with no damage and no spin, so contact is a
nuisance rather than a weapon.

### 3.4 Circuit Generation

Each circuit is produced by `carve(seed)` from its own fixed seed, so the code
stays procedural and no track asset file exists, while a given circuit is
byte-identical every time it is raced. Track knowledge is therefore a real
skill and lap records are comparable.

```js
export const CIRCUITS = [
  { name: 'Foundry Loop', seed: 1201 },
  { name: 'Coolant Bend', seed: 1340 },
  { name: 'The Spindle',  seed: 1477 },
  { name: 'Slag Pit',     seed: 1602 },
  { name: 'Draw Bench',   seed: 1755 },
  { name: 'Cinder Yard',  seed: 1888 },
  { name: 'Ladle Row',    seed: 1931 },
  { name: 'Tap Hole',     seed: 2064 },
]
```

Generation steps:

1. Lay control points around a circle at the grid centre, each radius jittered
   by the seeded rng within a bounded band.
2. Smooth the ring into a closed centerline by repeated midpoint averaging, so
   no corner is sharper than a hauler can take.
3. Walk the centerline and stamp `TRACK_WIDTH` tarmac tiles across the normal
   at every step. Everything unstamped stays `S_WALL`.
4. Stamp `S_KERB` on the outermost tile of each edge.
5. Place `S_BOOST` on straights and `S_OIL` on corner exits, both chosen
   deterministically from the same rng.
6. Place `S_PICKUP` tiles at even intervals along the centerline.
7. Stamp `S_LINE` across the track at centerline index 0.
8. Emit `CHECKPOINT_COUNT` checkpoints at even centerline indices.

Three by-products fall out of this for free and none of them is separate code:
the **centerline is the bot racing line**, the **checkpoints** come from the
same walk, and the **starting slots** are the centerline positions immediately
behind the line.

### 3.5 Map Encoding

The grid is run-length encoded into a short string by `encodeMap` and
`decodeMap`, the identical pattern used by `server/voiddrillers.js`. A 96 by 96
grid is 9,216 tiles and is overwhelmingly long runs of wall, so the encoded
form is small.

**The encoded track is sent once, in `welcome`**, exactly as Void Drillers
sends its shaft at `voiddrillers-server.js:65`. It is never part of a snapshot,
because it never changes.

### 3.6 Dynamic Hazards

Dropped slicks and walls are **a short list in the snapshot, never writes into
the track grid**:

```js
state.hazards = [{ kind: 'slick' | 'wall', x, y, until, by }]
```

Capped at `MAX_HAZARDS`, oldest evicted first. Collision is a small loop over
at most sixteen entries against at most eight cars, which is cheaper than any
index would be. Keeping the grid immutable is what allows it to be sent once,
and it is also what keeps the per-tick snapshot to eight cars plus a handful of
hazards, comfortably under a kilobyte.

### 3.7 Laps, Running Order And The Cut

**Checkpoints must be taken in order.** A car holds `nextCp`, advanced only
when it overlaps the checkpoint it is actually waiting for. Crossing `S_LINE`
counts a lap only when `nextCp` has wrapped all the way round. This is what
stops a driver cutting the infield, and it is why the checkpoint ring is
generated rather than optional.

**Running order** is the tuple `(laps, checkpoints passed, negative distance to
the next checkpoint)`, sorted descending. The HUD needs this for position
display regardless, so the cut costs nothing extra to compute.

**The cut fires when the leader crosses the line.** At that moment the car
last in the running order is eliminated immediately, wherever it happens to be
on the track. The race does not wait for the tail to trail in. A car about to
be lapped is gone before it is lapped, which is the point of the format.

* Lap 1 takes no cut (`GRACE_LAPS`), so the field settles before anyone leaves.
* `state.laps = Math.max(MIN_LAPS, fieldSize)` fixed at the start of the race.
  Eight cars is eight laps, at a target lap of roughly eighteen seconds, which
  is about two and a half minutes of race.
* An eliminated car stops simulating and is drawn greyed on the client, so the
  player still watches the race out.
* The last car running is the winner; `state.final = true` on the edge into
  `over`.

### 3.8 Slipstream

```
A car gains SLIP_BOOST to its top speed when it is
  within SLIP_RANGE of another live car, and
  behind that car's nose (dot(unit(gap), unit(leaderHeading)) > SLIP_CONE)
```

Six lines, pure, and trivially testable in isolation. **Slipstream is the only
catch-up mechanic in the game**, and that is deliberate (see 3.9).

### 3.9 The Kit, And A Deliberate Omission

One slot. Driving over an `S_PICKUP` tile fills it if empty and starts that
tile's `PICKUP_RESPAWN_MS` cooldown. `use` spends it.

| Item | Effect |
|---|---|
| `boost` | `BOOST_MULT` top speed and accel for `BOOST_MS` |
| `slick` | Drops an oil hazard behind the car. Any car entering it loses grip until `SLICK_TTL_MS` expires |
| `wall` | Drops a barrier hazard behind the car, blocking a line until `WALL_TTL_MS` expires |

**The bag is not weighted by position.** A car running last draws from exactly
the same odds as the leader. There are no rubber-banded catch-up items. The
catch-up mechanic in this game is slipstream, which rewards a driver for having
closed the gap rather than for having failed to, and that is consistent with
the studio's stated position on ranked integrity. This is written down here
because it is precisely the kind of decision somebody will later try to "fix".

### 3.10 Bots

Bots steer toward a lookahead point on the generated centerline, run full
throttle, and brake when the angle to the lookahead exceeds a threshold. Each
bot carries a noise term so the field has a skill spread rather than eight
identical laps. Bots are filled to `BOT_FILL_TO` and stood down as human
players arrive, the same as every other title.

The racing line costs nothing because circuit generation already produced it.

### 3.11 Phases

`waiting | countdown | racing | over`

A race starts at `MIN_PLAYERS` drivers, or at once when a lone driver asks for
bots, the same lobby rule Cipher Run and Void Drillers use. The request clears
when the last human leaves.

There is no voting phase. Circuits rotate through `CIRCUITS` on each restart.

---

## 4. Network Adapter (`server/cutline-server.js`)

Port 8088, path `/cutline-ws`, subprotocol `cutline.v1`. Contains no game
rules. Responsibilities: connection lifecycle, message parsing and clamping,
the tick loop, broadcast, board banking, and restart after
`POST_RACE_GRACE_MS` on the match clock.

**The path deliberately does not begin with `/ws`.** nginx and vite both match
proxy keys by prefix, so any path starting `/ws` is silently swallowed by the
Blockout rule and connects the player to the wrong game.

### Client to server

```
{ t: 'join',  name }
{ t: 'input', steer, throttle, brake, use }
{ t: 'admin', key }                            // kick, restart, bots, botsonly
```

Input is clamped, never trusted: `steer` coerced to `-1 | 0 | 1`, `throttle`,
`brake` and `use` coerced to booleans, anything non finite dropped.

### Server to client

```
{ t: 'welcome', id, slot, circuit: { name, size, map, checkpoints } }
{ t: 'state',   phase, now, lap, laps, cars[], hazards[], order[], cut, board }
{ t: 'full' }
```

`snapshot()` returns live references and is stringified synchronously in the
same turn as `tick()`, as in every other title. Snapshots are never retained
across an await, a timer or a later tick.

---

## 5. Leaderboard

Registered in `server/board.js`:

```js
{
  file: 'board-cutline.json',
  game: 'cutline',
  mode: null,
  title: 'Cutline',
  fights: false,
  bests: [{ key: 'fastestTime', label: 'Fastest lap', short: 'Lap' }],
}
```

**`fastestTime` is reused rather than a new key added.** The `label` is already
per board, and `fastestTime` is already validated by `isRow` and ranked lower
is better at `board.js:124`, so banking fastest lap under it costs zero changes
to the validator or the ranker. Only the `BOARDS` row is new.

* `fights: false`. Nobody is killed. Being cut is not a death and is not banked
  as one, so Cutline contributes nothing to cross title kill and death totals.
* **Banked once per match**, on the edge into `over` with `final`, the same
  unit Fracture Line and Blastworks bank. Rounds are not a unit here; a race is.
* **A fastest lap banks only from a race that reached the flag, and only from a
  lap with every checkpoint taken in order.** A lone driver circling an idle
  lobby cannot set a record, and neither can a cut corner.

---

## 6. Client (`src/pages/Cutline.jsx`)

### 6.1 The camera is that there is no camera

A 96 by 96 grid at 8 px is 768 px, so the entire circuit is on screen at once
and there is no camera code at all. This is not only the cheaper build, it is
the better design: elimination is only dramatic if the player can see who is
about to be cut, and a chase camera would hide exactly the car the format is
about.

### 6.2 The track is pre-rendered once

On `welcome` the RLE is decoded and all 9,216 tiles are painted to an offscreen
canvas. It never changes, so every subsequent frame is one `drawImage` plus at
most eight cars and sixteen hazards. Tarmac, kerb and wall textures are
generated procedurally in the page, in the manner of `src/lib/wallTiles.js`.
Nothing the canvas draws loads a file.

If the texture code outgrows the page it moves to `src/lib/trackTiles.js`. It
is not created up front; `wallTiles.js` and `fireTiles.js` exist because they
earned separate files, not on principle.

### 6.3 Identity and status

Each car carries a `--player-N` colour token, a number, and a heading
indicator. Status is never carried by colour alone: a boosted car shows a wake,
a car that has lost grip trails a slide mark, an eliminated car is greyed and drawn with a
cross. Player colour tokens are never reused for surfaces or hazards.

### 6.4 HUD

Position, lap counter, held item, and a cut warning strip naming the car
currently last. The cut warning is the primary read of the whole game, so it is
fixed height and never reflows.

Canvas reads the raw `:root` variables (`--bg`, `--tile`, `--player-N`), never
the `--color-*` aliases, which resolve empty at runtime under Tailwind v4.

---

## 7. Verification & Test Suite (`server/cutline.test.js`)

Target roughly 55 tests. Constants referenced, never literals. Randomness
injected.

### Circuit generation

* **Every seeded circuit is closed and drivable.** Walk the centerline and
  assert it returns to its start and that consecutive points are adjacent. This
  is the racing equivalent of Blockout's `keepLargestRegion()`: a generator
  that can emit a broken loop is a softlocked race, and this is the single
  highest value test in the file.
* Every circuit's racing surface is one connected region.
* The same seed produces an identical grid. Different seeds differ.
* `encodeMap` and `decodeMap` round trip.
* Every generated circuit places exactly `CHECKPOINT_COUNT` checkpoints and at
  least `MAX_PLAYERS` starting slots.

### Laps and the cut

* Checkpoints taken out of order do not advance `nextCp`.
* Crossing the line with checkpoints missed does not count a lap.
* An infield shortcut does not count a lap.
* The cut fires when the leader crosses, not when the last car finishes.
* The cut removes the car last in running order at that instant.
* Lap 1 takes no cut.
* `laps` adapts to field size and never falls below `MIN_LAPS`.
* The last car running wins and sets `final`.

### Handling and slipstream

* Lateral velocity bleeds off faster on tarmac than on oil.
* Off the racing surface, speed is capped at `OFFTRACK_CAP`.
* Wall contact retains `WALL_HIT_KEEP` of speed.
* Slipstream applies behind and in range.
* Slipstream does not apply beside, ahead, or out of range.
* Slipstream does not apply from an eliminated car.

### Kit and hazards

* A pickup fills an empty slot and not a full one, and starts a cooldown.
* `use` on an empty slot is a no-op.
* A slick drops behind the car, not on it.
* Hazards expire and are evicted at `MAX_HAZARDS`.
* The bag draw is independent of running position (statistical over a seeded
  run).

### Input hardening

* Out of range, non finite, missing and hostile `steer` values leave the car
  unchanged and never produce `NaN` in a position.
* Joining beyond `MAX_PLAYERS` is refused.
* A name from a join screen is sanitised.

### Shared code

* `snapshotBuffer` handles a snapshot with no `fall` field without producing
  `NaN`, and Blockout 3D's existing cases still pass.

---

## 8. Registration & Deployment

Four new files: `server/cutline.js`, `server/cutline-server.js`,
`server/cutline.test.js`, `src/pages/Cutline.jsx`.

Eighteen edited: the sixteen Cipher Run paid, plus two in the shared snapshot
buffer. `deploy/rivalblocks-ws.conf` is **not** among them, despite being a
deploy file: it holds shared proxy headers only and carries no per game content.

| File | Change |
|---|---|
| `package.json` | `"cutline": "node server/cutline-server.js"`, and the test file in `npm test` |
| `vite.config.js` | `'/cutline-ws': { target: 'ws://127.0.0.1:8088', ws: true }` |
| `src/App.jsx` | route `play/cutline` |
| `src/data/games.js` | CMS entry, slug `cutline`, `coverImage: '/art/cutline.jpg'` |
| `src/data/servers.js` | server copy |
| `src/lib/favicons.js` | favicon registration |
| `src/pages/LeaderboardPage.jsx` | title registration |
| `src/lib/snapshotBuffer.js` | guard the `fall` blend |
| `src/lib/snapshotBuffer.test.js` | case for a snapshot without `fall` |
| `server/board.js` | the `BOARDS` row |
| `server/board.test.js` | coverage for the new row |
| `deploy/nginx.conf` | `/cutline-ws` to 8088 |
| `deploy/rivalblocks.lua` | games row, path map, and the prose comments that currently say 8081 to 8087 |
| `deploy/rivalblocks.run`, `rivalblocks@.service`, `deploy/DEPLOY.md` | instance `rivalblocks@cutline` |
| `CLAUDE.md`, `GEMINI.md` | the new invariants |

One asset: `public/art/cutline.jpg`, one 1376 by 768 cover, committed at JPEG
quality 82.

**The subprotocol name and the dissector move together.** `cutline.v1` is
announced in `src/pages/Cutline.jsx` and registered in `deploy/rivalblocks.lua`
in the same commit. Renaming one without the other errors nowhere; the game
simply stops being named in a capture.

### What is deliberately not built

* **No shared racing abstraction.** One racing game does not get a framework.
* **No `src/lib/trackTiles.js` up front.** It is created only if the texture
  code outgrows the page.
* **No spline track model.** Considered and rejected: hazards, oil and boosts
  would each need their own spatial system, where a tile grid needs none, and
  nothing in this repository is spline shaped to copy from.
* **No rigid body physics library.** The pure rules module forbids imports, and
  convincing car to car bumping is not worth a solver.
* **No circuit vote.** Circuits rotate. A vote phase is a cheap later addition
  if the lobby wants something to do, and Cipher Run already has the pattern.
* **No position weighted item bag.** See 3.9.

---

## 9. Open Risks

1. **Lap time tuning.** The eighteen second target lap is an estimate, not a
   measurement. `TRACK_WIDTH`, `TOP_SPEED` and the control point radius band
   move together, and the first thing to measure once the generator works is an
   actual lap. If laps run long, an eight car race runs long with them, which
   is the failure `ROUND_TARGET = 1` exists to fix in Blockout 3D.
2. **Corner sharpness.** The smoothing pass in step 2 of generation is what
   guarantees no corner is sharper than a hauler can take. Too few passes
   produces a circuit with a corner that cannot be driven; too many produces
   eight circuits that are all ovals. This needs a measured bound asserted in a
   test, not a guessed constant.
3. **The cut on a spun car.** A car spun on the line at the instant the leader
   crosses is cut for bad luck rather than bad driving. Acceptable for a first
   version, and worth revisiting if it reads as unfair in play.
