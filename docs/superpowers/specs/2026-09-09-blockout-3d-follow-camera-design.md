# Blockout Royale 3D — the follow camera

*2026-09-09*

## Why

The game shipped with an orbit camera pointed at the centre of the stack, and a
keyboard mapped to fixed world directions. Those two facts contradict each other.

`KeyW` sends `[0, -1]`, a world vector, straight to the server. The camera's yaw
lives inside `towerScene.js` and never reaches the input path. The camera starts
at 45 degrees. So W has never moved the player up the screen, not once, not even
before anyone touches the mouse — and every drag makes the mismatch worse.

Fixing that alone would take twenty lines. This document is larger because the
fix opens a better question: if the camera is going to inform the input, it may
as well follow the player, and a camera that follows the player is a different
game to read.

## What changes

A third-person follow camera, orbiting the player under mouse control, with
input rotated into world space before it is sent. Floors above the player fade
so the camera can see through them. The local player is drawn from the newest
snapshot rather than the 100 ms replay everyone else gets.

**Not** a first-person camera. That was considered and rejected: this game's
core skill is reading which tiles are flagged across five floors, and `foresight`
exists to show the next wave *across every floor*. A first-person view deletes
most of that information, and the 100 ms replay is felt far more sharply from
inside a body than from behind one.

## The camera module

**`src/lib/followCamera.js`** — pure. No imports, no three.js, no DOM. It runs
under `node --test` alongside `board.js` and `snapshotBuffer.js`, and it exists
because the maths it holds is the maths that already shipped wrong once.

```js
makeCamera()                      // → { yaw, pitch }
orbit(cam, dx, dy)                // applies a pointer drag, clamps pitch
poseFor(cam, body, floorGap)      // → { position, target } in world space
worldDir(cam, ix, iy)             // → the input vector, rotated into world space
```

### `worldDir` is the fix

The camera at yaw θ sits at `target + (sin θ, cos θ) · dist` and looks inward, so

```
forward = (−sin θ, −cos θ)
right   = ( cos θ, −sin θ)
world   = forward · (−iy) + right · ix
```

An input of `[0, −1]` becomes `forward`; `[1, 0]` becomes `right`. At yaw 0 it
returns the input unchanged, which is exactly why the bug survived review: the
code looks correct until you notice the camera never starts at zero.

The page calls this immediately before sending, so the server's contract does not
change at all. It still receives a world-space unit vector and still knows nothing
about cameras. `p.face`, which `blink` and `bridge` depend on, keeps working
because it is derived from the same vector.

### `poseFor`

Places the camera behind the body along `−forward` at `DIST`, raised by `HEIGHT`,
with its target at eye height above the body. Body world height is
`−(z + fall) · floorGap`, matching what the scene already computes, so a camera
following someone mid-drop descends with them rather than snapping on landing.

Clamped so the camera never drops below the surface of the floor the player is
standing on. It may rise above the ceiling; floors above are transparent, so that
is a legitimate vantage rather than a glitch.

### Constants

```js
export const DIST = 7.5          // world units behind the body
export const HEIGHT = 2.2        // camera lift above the body
export const EYE = 0.9           // target height above the body's feet
export const PITCH_MIN = 0.15
export const PITCH_MAX = 1.35
export const ORBIT_SPEED = 0.005
```

Guesses, all of them, and `FLOOR_GAP` is 3.4 so `DIST` and `HEIGHT` together
decide how much ceiling is in shot. They want measuring in a browser, which is
the one thing no test here can do.

## The renderer

### One mesh per floor

The single `InstancedMesh` of 845 tiles becomes `FLOORS` meshes of `SIZE²`. This
is forced rather than chosen: `InstancedMesh` has no per-instance opacity —
`instanceColor` is RGB only — so a per-floor fade needs a per-floor material.

Instance index within a floor is `y · SIZE + x`. The stack index for reading the
tile string stays `z · SIZE · SIZE + y · SIZE + x`, unchanged and still the only
index formula in the project.

Five draw calls rather than one. The rule that 845 tiles must not become 845 draw
calls is intact; the rule was never that one mesh is sacred.

### The ramp

Relative to `viewZ`, the local player's floor:

| Floor | Treatment | Why |
|---|---|---|
| Below you (`z > viewZ`) | Opaque, darkening with distance | Judging a drop is the game. Solid is legible |
| Yours (`z === viewZ`) | Opaque, full brightness | |
| Above you (`z < viewZ`) | Transparent, fading with distance | The camera must see through them, and a body about to land on you must stay visible |

Transparent floors set `depthWrite: false` and an explicit `renderOrder`. Order
them so the floor physically highest in the stack — the *lowest* `z` — draws
first, and each floor nearer the player draws after it. The camera in this design
always sits at or above the player looking down, so that is back-to-front from
its point of view. Without both settings the transparent slabs flicker against
each other as the camera turns, which is the standard way this goes wrong.

Recall that `z = 0` is the top of the stack and `z` increases downward, so "above
you" is the *lower* index. The existing brightness-only depth cue stays for the
floors below; the fade is added only above.

### What does not change

Posts, pickups, bodies and their labels stay as single meshes spanning the stack,
opaque. A warn post seen through a faded floor above is information rather than
clutter, and splitting them per floor buys nothing. The billboard initial, the
warned-tile sink, the foreseen-tile rise and the plated-tile thickening all
survive untouched — they are structural cues and this change is about opacity.

### Following, and not following

The camera follows the local player's interpolated position. There are three
states where there is no local player to follow — the lobby, spectating past
capacity, and after elimination — and in all three the camera returns to the
stack-centre overview it uses today. Forgetting this is how the camera ends up at
the origin staring into the void, so it is called out here rather than left to be
discovered.

### The scene's interface

`scene.orbit()` disappears. The scene stops owning yaw, pitch and distance
entirely and receives a pose:

```js
scene.update(view, { viewZ, slotOf, pose })
```

The page owns the camera object, feeds it pointer deltas, and passes the result
down. That is the same direction of travel as `snapshotBuffer.js`: state and maths
out of the renderer, into something that can be tested.

## Two clocks

`snapshotBuffer.sample(now, liveId)` gains a second argument. The player matching
`liveId` is taken from the newest frame verbatim; everyone else is interpolated
100 ms back exactly as now.

This is not prediction and does not weaken the rule. Prediction means simulating
ahead of the server, and nothing here does. The local player is still drawn only
where the server has already put them; the client simply declines to hold that
position back by three frames before showing it to you.

The cost is honest: the local body advances at the 30 Hz server tick rather than
continuously, so it can microstep. From behind your own body that is nearly
invisible, and the camera gaining 100 ms of responsiveness is what makes a
following camera feel attached rather than dragged.

Doing this inside the buffer rather than the page keeps it pure and testable, and
keeps the React component free of clock logic.

## Testing

Everything in `followCamera.js` is tested, and one of those tests is the bug:

- **at the default yaw, W does not return `[0, −1]`** — fails against today's code
- at yaw 0, W returns `[0, −1]` and D returns `[1, 0]`
- at yaw π/2, W returns `[−1, 0]`
- a diagonal preserves magnitude, so W+D is not faster than W
- `orbit` clamps pitch at both ends
- `poseFor` places the camera behind the body and never below its floor
- `poseFor` follows a body mid-drop rather than snapping on landing

`snapshotBuffer` gains tests that `liveId` is taken from the newest frame while
others interpolate, and that an absent or unknown `liveId` changes nothing.

The renderer stays untested, as `towerScene.js`, `wallTiles.js` and `fireTiles.js`
all are. There is no browser harness in this repo and this change does not justify
building one.

## What only a browser can settle

Listed explicitly, because every visual claim in the last run went unverified and
one of them was a shipped bug:

- whether `DIST`, `HEIGHT` and `PITCH_MAX` frame the stack usefully at
  `FLOOR_GAP = 3.4`, or put the ceiling in your face
- whether the transparency ramp reads as depth or as murk, and whether the
  `renderOrder` and `depthWrite` settings actually stop the flicker
- whether a body on a faded floor above is genuinely visible enough to react to
- whether the local player's 30 Hz microstepping is noticeable from behind
- whether the camera behaves when a drop carries you through two floors
- whether mouse-look needs pointer capture to feel right, or a drag is enough

## Non-goals

- First person. Rejected above, on legibility.
- Client-side prediction. Still banned, still not needed.
- Camera collision against tiles. The floors above are transparent, so there is
  nothing to collide with that matters.
- Touching the other three games. Their cameras are fine because their boards are
  flat.
- A browser test harness.
