# Cutline Camera Views: Design Specification

Three camera views for Cutline, top-down, chase and bumper, with a toggle,
rendered by a single three.js scene that replaces the Canvas 2D world renderer.

---

## 1. Intent

### What was asked for

A third-person view and a first-person view, and a way for a player to toggle
between those and the existing top-down view.

### What this design assumes

* The toggle is per player and client side. Switching views changes nothing for
  anyone else and works mid-race.
* The server is untouched. All three views render the same authoritative race
  from the same snapshots.
* The top-down view keeps its current behaviour: heading-up, following the
  player's car, and showing roughly the same stretch of track.

### Decisions already taken

* **Real 3D with three.js**, not a pseudo-3D projection. three.js is already a
  dependency and Blockout Royale 3D already renders a procedural world with it.
* **One renderer for all three views.** The Canvas 2D world renderer is replaced,
  not kept alongside. Switching views moves a camera and nothing else.

### Success

* A player can race a full lap in each of the three views and switch between
  them at any point without the race stuttering or the car jumping.
* The top-down view reads recognisably as the track that was approved in 2D.
* No page other than Cutline downloads three.js.

---

## 2. Constraints From The Codebase

### No prediction, and why smoothing is allowed

There is no client-side prediction anywhere in this repository and there never
will be. A camera that eases toward the car's pose only ever trails poses the
server has already sent. It renders the recent past, never a guessed future, so
it cannot desync, for the same reason interpolation is allowed.

### Heading judder becomes visible

Car heading is not interpolated. The original spec justified that because at
60 Hz a car turns about three degrees per tick, which is invisible on a 12 pixel
car seen from above. That reasoning does not survive a camera that turns with
the car: in chase and bumper views the whole screen rotates by those steps. The
camera therefore smooths heading, even though the rules still do not interpolate
it.

### Bundle size

three.js adds roughly 570 KB. Cutline is currently imported eagerly in
`src/App.jsx`, so importing three.js from it would put that weight in the chunk
every marketing page loads. Blockout Royale 3D is lazy loaded for exactly this
reason, and Cutline must be too.

### Steering is car-relative in every view

Cutline steers a rate relative to the car, so left always means turn left and
the camera has no bearing on it. Blockout Royale 3D rotates its input by camera
yaw in `followCamera.worldDir`, and someone could reasonably "fix" Cutline to
match. That would break it. Input is never rotated by the camera here.

---

## 3. Architecture

### 3.1 How the approved look survives

`prerender()` in `src/pages/Cutline.jsx` already paints the whole circuit onto a
single canvas at `TILE_RES = 32` pixels per tile: road, kerbs, boost chevrons,
the chequered line, gravel, ramps, oil and pickup pads. That canvas becomes the
texture on **one flat ground plane**. Every approved tile is reproduced exactly,
in one draw call, and nothing about ground art has to be rebuilt.

What is built in 3D is only what should stand up off the ground:

| Thing | Now (2D) | In 3D |
|---|---|---|
| Road, kerbs, boost, line, gravel, oil, pads | painted canvas | the same canvas, as the ground texture |
| Walls | painted | boxes with height, only where a wall borders the road |
| Cars | procedural 2D chassis | procedural low-poly model |
| Ramp jumps | sprite scaled up | real height from `airT` |
| Pickups | 2D crate | floating, spinning crate |
| Slick, banana | 2D decals | flat decal, small peel model |
| Skid marks | 2D strokes | instanced quads on the ground |
| Minimap, HUD, banners | drawn on the world canvas | a 2D canvas overlay above the WebGL canvas |

### 3.2 Files

**Created:**

| File | Responsibility | Must never contain |
|---|---|---|
| `src/lib/raceCamera.js` | Camera pose and smoothing for the three views | three.js, the DOM, any import |
| `src/lib/wallBlocks.js` | Grid in, list of wall boxes out | three.js, the DOM, any import |
| `src/lib/cutlineScene.js` | The three.js scene: builds the static track once, updates cars, hazards, pickups and skids each frame | Game rules, simulation, prediction |
| `scripts/check-bundle.mjs` | Asserts three.js is absent from the main chunk after a build | |

`raceCamera.js` and `wallBlocks.js` are pure so they can be tested with
`node --test`, the same split as `followCamera.js` beside `towerScene.js`.

**Modified:**

| File | Change |
|---|---|
| `src/pages/Cutline.jsx` | The 2D world renderer is deleted. The page keeps the socket, input, snapshot buffer and `prerender`, owns a WebGL canvas and a 2D overlay canvas, and hands frames to the scene |
| `src/App.jsx` | Cutline becomes a lazy route. `StackLoadError` and `LoadingStack` are generalised to take a title, since they currently name Blockout Royale 3D in their copy |
| `package.json` | A `check:bundle` script |
| `CLAUDE.md`, `GEMINI.md` | The new invariants |

The server, the rules module and the snapshot shape do not change.

### 3.3 Data flow per frame

```
snapshot  -> snapshotBuffer.sample(now, myId)   (unchanged, interpolates others,
                                                  draws the player's car live)
sampled   -> raceCamera.step(state, view, focusCar, dt)   -> camera pose
sampled   -> cutlineScene.update(sampled, pose, view)     -> meshes moved
          -> cutlineScene.render()
sampled   -> overlay canvas: minimap, HUD, banners        (existing 2D code)
```

The page reads nothing back from the scene. The scene reads nothing back from
the camera module except a pose. Each can be replaced without touching the
others.

---

## 4. The Cameras

### 4.1 One camera, three poses

All three views are one `PerspectiveCamera`. A view is a pose and a field of
view, and nothing else.

```js
// Car roof height in world units, so camera heights are measured from something real.
export const CAR_ROOF = 0.45

// Top-down. The height is DERIVED from how much track the 2D view showed, so the
// 3D view frames the same stretch of road: at field of view f a camera at height
// h sees 2 * h * tan(f / 2) across. VIEW_CELLS moves here from the page, where it
// sized the 2D camera that this design deletes.
export const VIEW_CELLS = 22
export const TOP_FOV = 35
export const TOP_HEIGHT = VIEW_CELLS / (2 * Math.tan(((TOP_FOV / 2) * Math.PI) / 180))  // ~34.9

// Chase, third person.
export const CHASE_DIST = 5.5        // behind the car
export const CHASE_HEIGHT = 3.0      // above the ground
export const CHASE_LOOK_AHEAD = 3.0  // aims this far in front of the car
export const CHASE_FOV = 65

// Bumper, first person. On the nose, at eye height, looking along the heading.
export const BUMPER_EYE = 0.55
export const BUMPER_FOV = 75
// BUMPER_FORWARD is CAR_LENGTH / 2, imported by the page from server/cutline.js
// and passed in, so the camera sits exactly on the drawn nose.
```

The player's own car is hidden in the bumper view so it cannot block the view.

### 4.2 Smoothing

Every view eases toward its target pose using frame-rate independent exponential
smoothing, so it behaves the same at 60 fps and at 144 fps:

```
k = 1 - exp(-rate * dt)
value += (target - value) * k
```

Position lag and rotation lag feel very different, so they are set per view:

```js
export const HEADING_RATE = 20       // per second, every view
export const TOP_POS_RATE = 25
export const CHASE_POS_RATE = 12
// Bumper position is locked and has no rate.
export const FOV_RATE = 10           // field of view eases between views
```

| View | Heading | Position |
|---|---|---|
| Top-down | `HEADING_RATE` | `TOP_POS_RATE` |
| Chase | `HEADING_RATE` | `CHASE_POS_RATE` |
| Bumper | `HEADING_RATE` | **locked, no smoothing** |

**Field of view eases too**, at `FOV_RATE`. A field of view that snapped from 35
degrees to 75 while the position eased would read as the lens breaking rather
than the camera moving.

**Bumper position is never smoothed.** At `TOP_SPEED` of 14 tiles per second,
even 60 ms of position lag leaves the camera most of a tile behind the bumper,
inside the car or behind it. Heading is still smoothed, which is what removes
the judder.

**Heading must be smoothed along the shortest arc.** Easing naively from +179
degrees to -179 degrees swings the camera 358 degrees the wrong way. The angle
difference is wrapped into `[-PI, PI]` before smoothing, and a test asserts it.

### 4.3 Walls and the chase camera are one setting

A camera behind the car can end up behind a wall on a hairpin and lose sight of
the car. Rather than add camera collision, walls stay low and the chase camera
sits high enough to see over them.

```js
export const WALL_HEIGHT = 1.0
```

The sightline from the chase camera down to the car's roof, at distance `d`
behind the car, stands at

```
CAR_ROOF + (CHASE_HEIGHT - CAR_ROOF) * (d / CHASE_DIST)
```

so it clears a wall once `d` exceeds

```
(WALL_HEIGHT - CAR_ROOF) / (CHASE_HEIGHT - CAR_ROOF) * CHASE_DIST   // ~1.19 tiles
```

With these values any wall more than about 1.2 tiles behind the car is seen
over. `raceCamera.js` exports this as `chaseClearance()`, and a test asserts it
stays under `CHASE_CLEAR_MAX = 1.5`. Raise `WALL_HEIGHT` or lower `CHASE_HEIGHT`
and the test fails before a player loses sight of their car in a hairpin.

### 4.4 Controls

* `C` cycles top-down, chase, bumper, top-down.
* An on-screen button shows the current view and cycles it when clicked.
* The choice persists per browser in `localStorage`, wrapped in `try`/`catch`
  because storage can be unavailable in a private window.
* The default is **chase**, the view that was asked for first.
* Switching changes the target pose. Into top-down or chase, the smoothing
  carries the camera there, so the switch reads as a short camera move.
* **Switching into bumper is a cut, on purpose.** Bumper position is locked
  because any lag leaves the camera behind the bumper, and that holds during a
  switch as much as during a race: easing in from the chase position would fly
  the camera through the car. Heading and field of view still ease, so the cut
  is to the right place without a jolt in direction.

---

## 5. The Scene

### 5.1 Static track, built once on `welcome`

* **Ground:** one plane, `GRID` by `GRID` world units, textured with the
  `prerender()` canvas. Mipmaps on and anisotropic filtering at the renderer's
  maximum, so the texture holds up at the grazing angle of the bumper view.
* **Texture size needs a fallback.** At 32 pixels per tile the ground texture is
  3072 by 3072, which is 36 MB of GPU memory. WebGL2 only guarantees 2048 pixel
  textures. The scene reads `renderer.capabilities.maxTextureSize` and prerenders
  at 16 pixels per tile, 1536 by 1536 and 9 MB, on a device that cannot take the
  larger one. The track looks softer there rather than failing to draw.
  `prerender` therefore takes the tile resolution as a parameter.
* **Walls:** one `InstancedMesh` of boxes, `WALL_HEIGHT` tall, from
  `wallBlocks(grid)`. Only walls bordering the road get a box. Measured across
  all eight circuits that is 453 to 867 boxes, out of up to 6600 wall tiles.

### 5.2 Dynamic, updated every frame

* **Cars:** one procedural low-poly model per car, built with three.js
  primitives only: a body, a cabin, four wheels, headlights and brake lamps.
  The front wheels turn by the snapshot's `steer`, the brake lamps light by its
  `brake`, and the car rises by `airT` while airborne. Colour comes from the
  `--player-N` token, and every car keeps its number above it so identity is
  never carried by colour alone.
* **Pickups:** one `InstancedMesh` of crates, bobbing and spinning.
* **Hazards:** slicks as flat dark decals, bananas as small peel models. **Any
  hazard kind the scene does not recognise draws as a visible generic marker**
  rather than nothing. That is what stands in for a drift guard under a single
  renderer: a new kind added to the server shows up wrong rather than invisible.
* **Skid marks:** one `InstancedMesh` ring buffer of `MAX_SKIDS = 500` dark
  quads, matching the cap the 2D renderer used.

### 5.3 Lighting

One directional light and one ambient light, plus soft blob shadows under each
car, which is what the 2D view already draws. Real shadow maps are not used:
their cost is not repaid by what they would add from these angles.

### 5.4 Nothing loads a file

Every model is three.js primitives and every texture is a canvas drawn in code,
as in `towerScene.js`. A game that waits on an image stalls its first frame.

---

## 6. Loading And Failure

* `src/App.jsx` imports Cutline with `React.lazy`, inside the same kind of
  Suspense and error boundary Blockout Royale 3D uses. The boundary is
  generalised to take a title, because its copy currently names Blockout Royale
  3D.
* **If WebGL is unavailable**, the page shows a plain message saying the race
  needs WebGL, and does not attempt to draw. There is no 2D fallback renderer.
* `npm run check:bundle` builds nothing itself; it inspects `dist/` after
  `npm run build` and fails if three.js appears in the main chunk. This is the
  only check that catches someone re-importing Cutline eagerly, which would
  silently add the weight to every page on the site.

---

## 7. Performance Target

60 frames per second on a mid-range laptop, with a full grid of eight cars.

| Layer | Draw calls |
|---|---|
| Ground | 1 |
| Walls | 1 |
| Cars | about 8, one model each |
| Pickups | 1 |
| Hazards | 1 to 2 |
| Skid marks | 1 |

---

## 8. Testing

### `raceCamera.js`, pure, with `node --test`

* Each view's target pose is where the constants say, for several headings.
* **Shortest arc:** smoothing from +179 degrees toward -179 degrees moves by
  about 2 degrees, never 358.
* **Frame-rate independence:** two steps of `dt / 2` land within a small
  tolerance of one step of `dt`.
* **Bumper position is locked:** after one step it equals the target exactly.
* Smoothing converges on a stationary target.
* No NaN from a missing heading, a zero or negative `dt`, or a non-finite input.
* `chaseClearance()` stays under `CHASE_CLEAR_MAX`.
* `TOP_HEIGHT` frames `VIEW_CELLS` tiles at `TOP_FOV`, within a tile.

### `wallBlocks.js`, pure, with `node --test`

* Every wall tile that borders the road has a box.
* No box sits on a road tile.
* No box sits on a wall tile buried inside solid wall.
* The count for every circuit in `CIRCUITS` stays under a stated ceiling, so a
  regression that boxes every wall tile is caught.

### The bundle

* `npm run build && npm run check:bundle` passes, with three.js present only in
  the lazily loaded Cutline chunk.

### Manual

* A full lap in each view.
* Switching views mid-race, including mid-corner and mid-jump.
* A jump off a ramp in each view: the car rises, and its shadow stays on the
  ground beneath it.
* A hairpin in chase view: the car stays visible over the walls.
* Opening the home page with the network panel open and confirming no three.js
  chunk is requested.

---

## 9. Deliberately Not Built

* **Camera collision.** Low walls and a high chase camera make it unnecessary.
* **A cockpit interior or a visible bonnet.** The bumper view hides the
  player's car instead.
* **Free-look orbiting.** Blockout Royale 3D needs it to read a stack of floors;
  a racer points where it is driving.
* **A 2D fallback renderer.** One renderer was chosen. Without WebGL the page
  says so.
* **Spectator camera switching between other cars, replays, split-screen.**
* **Shadow maps.**

---

## 10. Risks

1. **The ground texture at the bumper view's grazing angle.** A 32 pixel tile
   seen from 0.55 tiles above the road is heavily magnified close up and heavily
   minified toward the horizon. Mipmaps and anisotropic filtering address the
   distance; close up it will look soft. If that reads badly, the fix is a
   higher resolution near band, not a different architecture.
2. **Deleting the 2D world renderer removes approved art in one step.** The
   headlights, skid marks and car detail all have to be rebuilt in 3D before the
   page looks finished. The ground carries over exactly; everything above it
   starts again.
3. **Smoothing rates are estimates.** 20 per second on heading and 12 on chase
   position are starting values. They are constants in one pure module, so
   tuning them after playtesting touches nothing else.
4. **Mobile GPU memory.** The 16 pixel fallback covers texture size, but eight
   car models, walls and the ground on a low-end phone may still miss 60 fps.
   The target is a mid-range laptop.
