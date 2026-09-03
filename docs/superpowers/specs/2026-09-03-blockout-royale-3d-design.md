# Blockout Royale 3D — design

*2026-09-03*

## What it is

A sequel to Blockout Royale, not a rival to it. The original is one floor that
disappears under you. This is five of them stacked, where the floor giving way
drops you to the next one down instead of ending your round. Height is the
resource. Falling spends it.

The stack is eaten from the bottom by a rising void, so the number of floors
beneath you shrinks whether you spend them or not. The last floor standing has
nothing under it, which makes the endgame a plain round of Blockout Royale. The
sequel finishes inside the original.

**Tagline:** *There is always further down.*

**Slug:** `blockout-royale-3d` · **Route:** `/play/blockout-royale-3d`

## Why this shape

Three existing titles are all last-man-standing or first-to-score, and all three
are played from directly above. The stack is the cheapest way to get a genuinely
new axis of decision without inventing a fourth ruleset from nothing: the tile,
the wave, the warning and the carve all mean exactly what they already mean, and
the only new question is which floor you want to be on.

Positioning it as the sequel also settles the obvious objection. A stacked
survival game is close to Blockout Royale. It is *supposed* to be — that
closeness is the product, not a defect to design around.

## The game

### The stack

Five floors of a 13×13 grid. Floor 0 is the top, floor 4 the bottom, and the
void is under floor 4. Each floor is carved into one of the six arena shapes
independently, so the footprint you land on is not the footprint you left. Every
floor runs `keepLargestRegion` after its carve; only floor 0 runs `snapSpawns`,
because that is the only floor anyone starts on.

### Falling

The tile under your centre goes, you fall. Air time is about half a second per
floor and you steer during it at reduced speed, which is what makes a landing
aimed rather than lucky. You land at floor `z + 1` on whatever tile your steering
put you over.

If that tile is already gone you keep falling. Chain drops fall out of the rules
for free and need no special case.

Nothing you can do under your own power moves you up. Two powerups can — `lift`
climbs you a floor outright, `swap` takes somebody else's — and they are the only
two, which is what keeps height scarce.

### The clock

The collapse wave picks tiles **uniformly at random from every surviving tile in
the stack**, not per floor. That is Blockout's `pickWave` with a longer array,
which means `COLLAPSE_SHARE` and `collapseDelay` — the taper and speed-up already
measured and tuned on the original — carry over working. Warned tiles flash for
`WARNING_MS` before they go, as they always have.

Picking uniformly across the whole stack means unoccupied floors erode too, so
descending is an escape into worse ground rather than into safety. That is
deliberate, and it is the first thing to measure.

### The void

Floors are consumed from the bottom on a timer, with a long and unmissable
warning. Anyone still standing on a consumed floor is eliminated.

This exists for the reason Blastworks' closing wall exists. Without it, the
correct play is to stay on floor 0 and never descend, and the match becomes a
single flat Blockout round with four unused floors decorating it. The void is
what makes height cost something to hold.

### Costing someone a life

Nothing in the game eliminates a player directly. Everything drives them down one
floor, and the void collects whoever runs out of floors. One rule, three ways to
apply it, and it kills only when it should.

| Verb | Availability | Effect |
|---|---|---|
| **Stomp** | Always, on cooldown, with a short windup | Breaks the tile under you and drops you through it |
| **Sinkhole** | Powerup, already in the original | Flags a tile under the nearest rival |
| **Landing on someone** | Any fall that ends on another player | Drives them down a floor as well |

The stomp windup is not decoration. A stomp that resolves instantly is
unreactable, and the whole point of continuous movement here was to make the air
game a skill.

### Powerups

The original's full kit of seven carries over unchanged in meaning, plus one new
kind the stack calls for. Two of the inherited seven get considerably better in
three dimensions and neither needed a rewrite to do it.

| Powerup | In 3D |
|---|---|
| `shield` | Survive one drop — you stay on the floor when your tile goes |
| `dash` | Speed multiplier for `DASH_MS` (see note below) |
| `sinkhole` | The floor-as-weapon verb; targets the nearest rival by 3D distance |
| `patch` | 3×3 of floor back around you, on your own floor |
| `blink` | A three-tile hop that clears holes, horizontal only |
| `swap` | Trade places with the nearest rival — climbs by costing them the climb |
| `foresight` | Shows the next wave for `FORESIGHT_MS`, across every floor |
| `lift` | **New.** Climbs you one floor outright |

The two upward moves are not interchangeable and both earn their place. `swap` is
zero-sum: the stack has exactly as much height after it as before, and taking a
floor means somebody else loses one. `lift` is not — it is the only thing in the
game that *creates* height, and every one collected adds a life to the match that
the void now has to spend time eating.

That makes `lift` the one item whose frequency can quietly unmake the round
timer, so it is the first knob to check when a match runs long. The powerup bag
repeats a kind once per weight point, so at weight 1 against `patch`'s 3 it is
one draw in ten — and one in ten is the *rarest* the bag can express without
raising every other weight to make room. If measurement wants it rarer than that,
the bag structure has to change, not the number.

**`DASH_COOLDOWN_MS` does not survive the port.** It is a grid-step concept —
it works by permitting one move per tick. Under continuous movement dash becomes
a multiplier on `SPEED_BASE`, which is a different tuning surface and needs its
own measurement rather than a copied number.

### Match structure

Banks per round, exactly as Blockout Royale does, for the same reason: rounds are
short and self-contained. `ROUND_TARGET` drives the victory screen and nothing
else.

Unlike flat Blockout, this game has real kills — stomps, sinkholes and landings
all have an author. Its board therefore carries a meaningful K/D column, which
the leaderboard already knows how to rank and display.

## Constants

Opening values. Every one of them is a guess until a headless harness has run
against it, following the practice the other three games were tuned by.

```js
export const SIZE = 13
export const FLOORS = 5
export const TICK_MS = 33            // matches Blastworks; continuous movement needs it

export const SPEED_BASE = 4.4        // tiles/second on the ground
export const AIR_SPEED = 2.6         // steering authority mid-drop
export const FALL_MS = 480           // per floor
export const DASH_MS = 2500
export const DASH_MULT = 1.7

export const COLLAPSE_EVERY_MS = 900
export const COLLAPSE_COUNT = 8      // across the whole stack, not per floor
export const COLLAPSE_SHARE = 0.06
export const COLLAPSE_FASTEST_MS = 260
export const WARNING_MS = 1500

export const VOID_FIRST_MS = 60000
export const VOID_EVERY_MS = 35000
export const VOID_WARN_MS = 8000

export const STOMP_COOLDOWN_MS = 6000
export const STOMP_WINDUP_MS = 350

export const POWERUP_EVERY_MS = 1600
export const POWERUP_MAX = 12
export const POWERUP_KINDS = [
  'shield', 'dash', 'sinkhole', 'patch', 'blink', 'swap', 'foresight', 'lift',
]
export const POWERUP_WEIGHTS = { patch: 3 }   // lift sits at 1 — see above
export const MIN_PLAYERS = 2
export const ROUND_TARGET = 3
export const BOT_FILL_TO = 5
```

`COLLAPSE_COUNT = 8` is derived, not chosen: at `COLLAPSE_EVERY_MS`, eight tiles
a wave taken uniformly from 845 costs floor 0 roughly 1.6 tiles a wave, which
strips about 60% of it in a minute. That is the target — floor 0 should become
untenable at roughly the moment the void takes floor 4.

`MAX_PLAYERS` stays derived from `SPAWNS.length`, as in every other game here.

## Architecture

### Fork, do not refactor

`server/blockout3d.js` is a new pure module that copies `carve`,
`keepLargestRegion`, `snapSpawns` and `pickWave` from `game.js` and adds a z axis.

`game.js` is **not** being generalised into an N-floor engine, and no shared
geometry module is being extracted. `game.js` carries a zero-imports mandate and
1,163 lines of tests against a shipped game. Destabilising that to avoid
duplicating roughly 200 lines of pure geometry is the wrong trade. Duplication is
the cheap option and this is the case it is cheap for.

### Files

| File | Owns | Must never contain |
|---|---|---|
| `server/blockout3d.js` | Every rule and all match state | Sockets, Node APIs, any import |
| `server/blockout3d-server.js` | Connection lifecycle, parsing, broadcast, banking | Any game decision |
| `server/blockout3d.test.js` | Tests against the pure module | Literals where a constant exists |
| `src/pages/Blockout3D.jsx` | Scene, camera, input, HUD | Simulation, prediction, rule checks |

Supporting edits: a fifth entry in `BOARDS` (`board-blockout3d.json`), a games
entry in `src/data/games.js`, a mark in `src/lib/favicons.js`, a route in
`App.jsx`, a vite proxy entry, an nginx location, a systemd instance and an
`npm run` script.

### Port and path

Port **8085**, path **`/blockout3d-ws`**.

The path deliberately does not begin with `/ws`. Prefix matching in both nginx
and vite would otherwise swallow it into Blockout Royale's rule and connect
players to the wrong game.

## Protocol

Client to server, unchanged in spirit:

```
{ t: 'join',  name }
{ t: 'input', dir: [dx, dy] }    // unit vector, continuous
{ t: 'use' }
{ t: 'stomp' }
```

Server to client: `{ t: 'state', ... }`, full state, every tick, never diffs.

### Tiles ship as a string

845 tiles encoded as `'solid' | 'warn' | 'gone'` strings is roughly 10 KB a
tick — 300 KB/s per client at 30 Hz, which is not acceptable. One character per
tile is 845 bytes, about 25 KB/s, the same order as Blastworks already sends.

```
'.'  solid
'!'  warned
'_'  gone
```

Indexed `z * SIZE * SIZE + y * SIZE + x`.

This is *more* readable in Wireshark than an array of quoted words, not less,
which matters because plaintext-on-the-wire is an explicit property of this
project rather than an accident. The full-state-every-tick invariant is untouched;
only the encoding gets denser.

The snapshot returns `state.tiles` by live reference as the others do, and is
safe for the same reason: the wrapper stringifies it synchronously in the same
turn as `tick()`.

### Snapshot shape

```js
{
  phase, now, size: SIZE, floors: FLOORS,
  tiles,                    // the string above
  bottom,                   // lowest surviving floor index
  voidAt,                   // when the next floor is consumed
  players: [{ id, name, x, y, z, fall, dead, kills, deaths, ... }],
  pickups: [{ x, y, z, kind }],
  board,                    // set by the wrapper, read by no rule
}
```

`fall` is drop progress from 0 to 1, which is what lets the client draw a body
between two floors without knowing anything about the rules.

## Client and rendering

**three.js**, the repo's first rendering dependency. Justified by the alternative:
raw WebGL costs several hundred lines of shader and matrix plumbing before the
first cube appears, for a picture three.js gives immediately.

**The no-image-files rule survives untouched.** `BoxGeometry`, `MeshLambertMaterial`
and two lights. No meshes, no textures, no loaders — all geometry is constructed
in code, which is the same thing `BlockArt.jsx` and `wallTiles.js` already do in
two dimensions.

One `InstancedMesh` carries all 845 tiles. Players are small individual meshes.
Colours come from the existing `--player-1..8` tokens; no new tokens.

### Interpolation, not prediction

The client renders roughly 100 ms behind and lerps between two snapshots it has
**actually received**. It never simulates ahead of the server, so no client ever
holds a state the server did not author and the desync class the other three
games avoid stays avoided here.

This distinction needs writing into CLAUDE.md explicitly. The current wording bans
both in one breath, and without the amendment the next reader sees a violation
rather than a decision.

### Reading a stack

Your floor opaque, the floor below ghosted so you can see what you are dropping
into, everything else as thin outlines. Orbit camera on drag, easing back behind
the player when released.

### Accessibility

Non-negotiable and inherited, and three dimensions make them easier rather than
harder:

- **A warned tile sinks slightly and grows a marker post.** Structural, not a
  colour change (WCAG 1.4.1).
- **A gone tile is absent.** Structurally unmistakable by construction.
- **Players carry a billboard initial**, as in every other game here.
- **Player tokens stay separate from status tokens.** A body never wears a
  tile's colour.

## Leaderboard

A fifth board file, `board-blockout3d.json`, with exactly one writer — the whole
concurrency design holds unchanged. `BOARDS` gains an entry, `useBoard` picks it
up with no code change, and the `/leaderboard` page gains a table for free.

Banks on the edge into `over`, per round, via `once()`.

## Testing

Tests live against `server/blockout3d.js`, as the ~60 for Blockout live against
`game.js`. That module's purity is what makes it possible, which is the reason it
has no imports.

- Constants, never literals. `SIZE`, `FLOORS`, `COLLAPSE_COUNT` stay tunable
  precisely because nothing hardcodes `13` or `5`.
- Randomness through an injected rng, never `Math.random`. A `playing(n)` helper
  in the shape of the existing one, forcing a known carve and freezing timers at
  `Infinity`.
- Cases the stack introduces: a drop lands on the floor below; a drop onto a gone
  tile chains; a drop onto a player pushes that player down too; a drop off the
  bottom floor eliminates; a shield eats exactly one drop; the void eliminates
  whoever is standing on a consumed floor; `swap` across floors exchanges height
  both ways; `lift` on the top floor is a no-op rather than an error; `lift`
  onto a gone tile drops you straight back down; the wave never picks a tile
  that is already gone.

Tuning gets a headless harness, as the other three did. No constant in this
document is defended by argument alone.

## Deployment

Port 8085 behind `/blockout3d-ws`. A fifth systemd instance of the existing
`rivalblocks@` template, a fifth nginx `location`, a fifth vite proxy entry. No
change to the `/board/` alias beyond the new file appearing in it.

Plain `ws://` with no TLS, unchanged and still deliberate.

## CLAUDE.md amendments

Amendments, not a rewrite. The measured invariants stay exactly as written.

1. **Split prediction from interpolation.** Prediction stays banned everywhere.
   Interpolation between received snapshots is permitted, and the reason it
   cannot desync is stated.
2. **Four becomes five** in the board and deployment sections.
3. **The layer table gains** `blockout3d.js`, `blockout3d-server.js` and
   `Blockout3D.jsx`.
4. **The commands block gains** the new script, port and path.
5. **A new invariant:** tiles ship as one character each, and the index order is
   `z * SIZE * SIZE + y * SIZE + x`.
6. **A new invariant:** the void and the collapse wave are two halves of one
   trade, in the shape of the existing Blastworks note. Without the void the
   correct play is never to leave floor 0.

Unchanged and explicitly surviving: no image files, colour is never the only
signal, full state every tick, one writer per board file, `MAX_PLAYERS` derived
from `SPAWNS.length`, tests reference constants.

## Non-goals

- Not generalising `game.js`. Blockout Royale ships as it is.
- No client-side prediction, in this game or any other.
- No new `@theme` tokens.
- No asset pipeline. If something cannot be built from geometry in code, it does
  not go in.
- No TLS change. That is a deployment decision and it is not this document's.

## Open questions

Each of these is a measurement, not an argument, and none of them blocks the
implementation plan.

1. **Should waves skip unoccupied floors?** Uniform-across-the-stack is simple
   and matches the existing invariant, but it may make descent feel
   randomly lethal rather than tactically bad. Measure the fraction of drops
   that chain immediately.
2. **`COLLAPSE_COUNT` and `VOID_EVERY_MS` against each other.** The target is
   floor 0 becoming untenable at roughly the moment the void takes floor 4. If
   the void wins the race the stack is decoration; if the collapse wins, nobody
   ever meets the void.
3. **Does `sinkhole` reach across floors?** Nearest by 3D distance usually finds
   somebody on your own floor, which is probably right. Worth confirming it does
   not quietly become a cross-floor sniping tool.
4. **`DASH_MULT`.** No inherited number to copy; needs its own pass.
5. **How much height `lift` puts back.** It is the only item that adds lives to
   the match rather than moving them, so it works directly against the void.
   Measure floors climbed per round against floors the void consumes; if players
   are gaining height faster than the stack is losing it, the round timer is
   gone and the fix is the bag, not the powerup.
6. **Match length.** Blastworks deathmatch runs seven to sixteen minutes, which is
   long. Five floors should land near three, and that wants confirming before
   anyone plays it.
