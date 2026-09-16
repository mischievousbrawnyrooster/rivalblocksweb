# Void Drillers: Per-Player Arenas, Ghost Visibility, and Sabotage Crystals

Each driller races through their own independently-generated shaft. Players see
ghost silhouettes of opponents overlaid on their own terrain and as colored dots
on the side minimap. Sabotage crystals let players send brief, mild annoyances
to rivals without affecting positioning, damage, or survival.

## Core Model Change: Per-Player Grids

### Current State

One shared `match.grid` (`Uint8Array(WIDTH * DEPTH)`) and `match.hp` array.
Every player drills the same terrain. Block deltas (`match.deltas`) are broadcast
identically to all clients.

### New State

The shared `match.grid` and `match.hp` are removed from the top-level match
object. Each player owns their own shaft:

```
p.grid    Uint8Array(WIDTH * DEPTH)   // personal terrain
p.hp      Uint8Array(WIDTH * DEPTH)   // personal block hit points
p.deltas  Array                       // per-tick block changes for this player only
p.hazards Array                       // per-player gas hazard clouds
```

On `join()`, a new shaft is generated using `createRng(match.seed + slot)` so
every player gets a unique layout. The match seed is still set once at match
creation; the slot offset guarantees each shaft differs.

Bots get their own shafts identically to human players.

### Functions That Must Read/Write Per-Player Grid

| Function | Currently reads | Change to |
|---|---|---|
| `isSolid(grid, x, y)` | `match.grid` passed in | `p.grid` passed in (no signature change) |
| `touchesVault(grid, p)` | `match.grid` | `p.grid` |
| `detonateGasPocket(match, bx, by)` | `match.grid`, `match.hp`, `match.deltas`, `match.hazards` | Accept `p` as argument; read/write `p.grid`, `p.hp`, `p.deltas`, `p.hazards` |
| `executeDrillPulse(match, p)` | `match.grid`, `match.hp`, `match.deltas` | Read/write `p.grid`, `p.hp`, `p.deltas` |
| `findBestDownwardColumn(match, bx, groundRow)` | `match.grid` | Accept `grid` parameter; pass `p.grid` |
| `driveBots(match, rng)` | `match.grid` | Use `p.grid` for the bot being driven |
| `tick(match, dtMs, rng)` | `match.grid` for collision | Use `p.grid` for each player's physics |
| `snapshot(match)` | `match.deltas`, `match.hazards` | Per-player deltas and hazards in snapshot |

### Match State Shape After Change

```js
{
  width: WIDTH,
  depth: DEPTH,
  // grid and hp REMOVED from here
  players: Map,
  nextSlot: 0,
  elapsed: 0,
  voidY: INITIAL_VOID_Y,
  seq: 0,
  phase: 'playing',
  winner: null,
  winReason: null,
  // deltas and hazards REMOVED from here (now per-player)
  board: [],
  botFill: 4,
  botsOnly: false,
  botsWanted: false,
  nextId: 1,
  seed: <number>   // NEW: preserved for generating new player shafts on join
}
```

### Map Generation Extraction

The terrain generation code currently inside `make()` must be extracted into a
standalone pure function:

```js
function generateShaft(seed) {
  const rng = createRng(seed)
  const grid = new Uint8Array(WIDTH * DEPTH)
  const hp = new Uint8Array(WIDTH * DEPTH)
  // ... existing generation logic (strata, formations, bedrock, etc.) ...
  return { grid, hp }
}
```

`make()` calls `generateShaft` zero times (no shared grid). `join()` calls
`generateShaft(match.seed + slot)` and attaches the result to the player.

---

## Wire Protocol Changes

### Welcome Frame

Currently sends one `map` (the shared grid RLE-encoded). Now sends only the
joining player's personal map:

```json
{ "t": "welcome", "id": "p-1", "slot": 0, "width": 20, "depth": 260,
  "map": "<RLE of p.grid>" }
```

No change to format, just the data source changes from `match.grid` to `p.grid`.

### Snapshot Frame

Currently sends one shared `deltas` array and one shared `hazards` array.
Now sends per-player deltas and hazards only for the receiving player, plus
ghost positions for all players:

```json
{
  "t": "snap",
  "seq": 42,
  "voidY": 12.5,
  "phase": "playing",
  "winner": null,
  "elapsed": 34200,
  "arena": "strata-shaft",
  "botFill": 4,
  "botsOnly": false,
  "deltas": [ ... ],           // THIS player's deltas only
  "hazards": [ ... ],          // THIS player's hazards only
  "players": [
    {
      "id": "p-1", "name": "Ada", "bot": false, "slot": 0,
      "x": 5.2, "y": 42.1, "vx": 0, "vy": 1.2,
      "fuel": 0.8, "heat": 0.3, "aim": 1.57,
      "drilling": true, "alive": true, "hp": 100,
      "kills": 0, "deaths": 0,
      "overheated": false, "superDrill": false,
      "grief": { "type": "fog", "ttl": 2100 },
      "griefBy": "Grace"
    },
    ...
  ],
  "board": [ ... ]
}
```

**Key change**: The server must send per-player snapshot frames instead of one
shared frame. In the tick loop of `voiddrillers-server.js`:

```js
for (const [id, clientWs] of sockets) {
  if (clientWs.readyState !== WebSocket.OPEN) continue
  const p = match.players.get(id)
  if (!p) continue
  clientWs.send(JSON.stringify(snapshotFor(match, p)))
}
// Admin/spectator clients without a player get a snapshot without deltas
```

`snapshotFor(match, p)` returns the standard snapshot but with `p.deltas` and
`p.hazards` instead of match-level ones.

---

## Cross-Player Visibility

### Ghost Silhouettes (Client-Side Rendering)

All players' `{ x, y, slot, alive, drilling, aim }` are already in the snapshot.
The client renders other players as translucent colored outlines overlaid on the
local player's shaft:

- **Opacity**: 25% of the slot color
- **Shape**: Same driller silhouette (rectangle body, drill bit indicator)
- **Position**: At the ghost's `(x, y)` coordinates in the local player's
  shaft coordinate space
- **No collision**: Ghosts do not interact with local terrain
- **Label**: Small name tag above the ghost in the same slot color at 40% opacity

### Minimap Dots

The canvas already reserves `MINIMAP_WIDTH_PX = 80` pixels on the right side.
Each player (including the local player) is drawn as a colored dot at their
y-depth on the minimap strip:

- **Local player**: Solid dot, 6px, slot color
- **Other players**: Outlined dot, 5px, slot color at 60% opacity
- **Dead players**: Crossed-out dot, muted color

The minimap shows the full shaft depth (0 to DEPTH) compressed vertically, with
the void line drawn as a horizontal red line descending.

---

## Sabotage Crystal System

### New Block Type

```js
export const BLOCK_SABOTAGE = 7
```

Added to `BLOCK_CHARS` as `'X'` and `CHAR_TO_BLOCK` as `{ X: BLOCK_SABOTAGE }`.

### Generation

Sabotage crystals spawn in subterranean strata (y >= 11, y < VAULT_Y) at ~5%
frequency, replacing some geode spawns. They use `SABOTAGE_HP = 2` (same as
geodes). In the vein generation:

```
if (r < 0.44)       DIRT
else if (r < 0.74)  STONE
else if (r < 0.79)  GAS        // was 0.84
else if (r < 0.84)  SABOTAGE   // NEW: 5%
else                GEODE      // was 16%, now 16%
```

### Drilling a Sabotage Crystal

When a player breaks a sabotage crystal (hp reaches 0), instead of the geode
effect (heat flush + super drill), the server:

1. Picks a random living opponent (not the driller, not dead players)
2. Applies a random grief effect to the target
3. Records the effect on the target's player state
4. Resets the driller's heat to 0 as a small reward (same as geode)

If there are no living opponents, the crystal just clears to air with a heat
flush (acts like a geode without super drill).

### Grief Effects

Three mild annoyance effects, all purely visual/speed, never lethal:

| Effect | Key | Duration | Server State | Client Rendering |
|---|---|---|---|---|
| **Fog** | `fog` | 3000 ms | `p.grief = { type: 'fog', ttl: 3000, by: name }` | Dark semi-transparent overlay (40% opacity) covering 60% of the shaft view, centered on the player. Edges are feathered. |
| **Tremor** | `tremor` | 2500 ms | `p.grief = { type: 'tremor', ttl: 2500, by: name }` | Canvas rendering offset jitters by +/-3px each frame (random x/y offset applied to the camera transform). |
| **Drill Chill** | `chill` | 3000 ms | `p.grief = { type: 'chill', ttl: 3000, by: name }` | Drill pulse interval doubled (`DRILL_PULSE_INTERVAL * 2`). A blue frost tint overlay at 15% opacity. "DRILL CHILLED" indicator on HUD. |

### Grief State on Player

```js
p.grief = null  // or { type: 'fog'|'tremor'|'chill', ttl: <ms>, by: <string> }
```

In `tick()`, if `p.grief` is not null, decrement `p.grief.ttl` by `dtMs`. When
ttl reaches 0, set `p.grief = null`.

Only one grief effect active per player at a time. A new sabotage replaces the
existing one.

### Drill Chill Enforcement (Server-Side)

The `chill` effect is the only grief that has a server-side mechanical impact.
In `executeDrillPulse`, when checking `p.drillTimer`:

```js
const interval = (p.grief?.type === 'chill')
  ? DRILL_PULSE_INTERVAL * 2
  : (p.superDrillTimer > 0 ? SUPER_DRILL_PULSE_INTERVAL : DRILL_PULSE_INTERVAL)
```

Fog and tremor are purely client-side visual effects with no server impact.

### Snapshot Grief Fields

Each player in the snapshot includes:

```js
grief: p.grief ? { type: p.grief.type, ttl: p.grief.ttl } : null,
griefBy: p.grief ? p.grief.by : null
```

### Client Grief Rendering

- **Fog**: After rendering the shaft and all players, draw a radial gradient
  overlay from transparent center to `rgba(15, 23, 42, 0.4)` edges
- **Tremor**: Apply `ctx.translate(shakeX, shakeY)` with random offsets before
  rendering the shaft (resets each frame)
- **Chill**: Blue tint overlay `rgba(56, 189, 248, 0.15)` over the shaft.
  "DRILL CHILLED" text rendered in blue monospace near the telemetry bar
- **Sabotage notification**: When the local player breaks a sabotage crystal,
  show "SENT [EFFECT] TO [NAME]" in a brief canvas toast (2s, fades out)
- **Incoming grief notification**: When `grief` appears on the local player,
  show "[NAME] SABOTAGED YOU" briefly

### Client Sabotage Crystal Rendering

Rendered distinctly from geodes:

- **Color**: Purple/magenta (`#a855f7`) instead of cyan
- **Glyph**: `✦` (four-pointed star) instead of `◈`
- **Break particles**: Purple/magenta burst

---

## Bot Behavior with Per-Player Arenas

Bots already have their own AI in `driveBots()`. The only change is that each
bot reads its own `p.grid` instead of `match.grid`. All bot pathfinding
functions (`findBestDownwardColumn`, gas evasion, etc.) receive `p.grid` and
`p.hazards` instead of match-level ones.

Bots ignore grief effects: `chill` does mechanically slow their drill (server
enforced), but `fog` and `tremor` are client-only and have no effect on bots.

Bots do not use sabotage crystals offensively. When a bot drills a sabotage
crystal, the grief effect is still applied to a random opponent (the server
handles it identically for bots and humans).

---

## Files Changed

### `server/voiddrillers.js` (Rules Engine)

- Extract `generateShaft(seed)` from `make()`
- Add `BLOCK_SABOTAGE = 7`, update `BLOCK_CHARS`, `CHAR_TO_BLOCK`
- `make()`: Remove `grid`, `hp`, `deltas`, `hazards` from match; store `seed`
- `join()`: Call `generateShaft(match.seed + slot)`, attach `grid`, `hp`,
  `deltas: []`, `hazards: []`, `grief: null` to player
- `detonateGasPocket()`: Accept player, use `p.grid`, `p.hp`, `p.deltas`,
  `p.hazards`
- `executeDrillPulse()`: Use `p.grid`, `p.hp`, `p.deltas`; handle
  `BLOCK_SABOTAGE` break (pick random opponent, apply grief, flush heat)
- `tick()`: Per-player collision uses `p.grid`; clear `p.deltas` per player;
  decrement `p.grief.ttl`; per-player hazard updates
- `driveBots()`: Use `p.grid` for each bot
- `snapshot()` becomes `snapshotFor(match, viewerPlayer)` with per-player
  deltas/hazards
- Add `SABOTAGE_HP = 2`, grief effect constants

### `server/voiddrillers-server.js` (Network Adapter)

- Welcome frame: `encodeMap(player.grid)` instead of `encodeMap(match.grid)`
- Snapshot loop: Per-player frames via `snapshotFor(match, p)` for each socket
- Admin/spectator clients: Snapshot without deltas

### `src/pages/VoidDrillers.jsx` (Client UI)

- Ghost silhouette rendering: Draw other players as translucent outlines
- Minimap rendering: Colored dots for all players at their y-depth
- Sabotage crystal rendering: Purple `✦` glyph, purple break particles
- Grief effect overlays: Fog gradient, tremor shake, chill tint
- Grief notifications: Toast messages for sent/received sabotage
- Add `BLOCK_SABOTAGE` to block type constants and `CHAR_TO_BLOCK`

### `server/voiddrillers.test.js` (Tests)

- Test `generateShaft()` produces valid grid
- Test each player gets a unique grid on join
- Test drilling uses per-player grid (changes in one player's grid do not
  affect another's)
- Test sabotage crystal break: grief applied to random opponent, heat flushed
- Test grief ttl countdown and expiry
- Test drill chill doubles pulse interval
- Test no opponent available: sabotage crystal acts as heat flush only
- Test snapshot contains per-player deltas and grief state

---

## Verification Plan

### Automated Tests

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
node --test server/voiddrillers.test.js
npm.cmd test
npm.cmd run build
```

### Manual Verification

1. Start `npm.cmd run drillers` and `npm.cmd run dev`
2. Open `/play/void-drillers` in two browser tabs with different names
3. Verify each player sees their own unique terrain
4. Verify ghost silhouettes of the other player are visible at ~25% opacity
5. Verify minimap shows both players as colored dots
6. Drill a purple sabotage crystal; verify the other player gets a brief
   visual effect (fog, tremor, or chill)
7. Verify the chill effect visibly slows drilling speed
8. Verify fog and tremor are purely visual and do not affect gameplay
9. Verify bots get their own shafts and drill independently
10. Verify victory and leaderboard recording still work correctly

