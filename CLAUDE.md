# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Node is not on PATH in a fresh shell.** Prefix every `node`/`npm` command:

```bash
export PATH="/c/Program Files/nodejs:$PATH"    # Git Bash
```

```bash
npm run dev      # vite dev server on 0.0.0.0:5173
npm run game     # Blockout Royale   127.0.0.1:8081  ← /ws
npm run fracture # Fracture Line     127.0.0.1:8082  ← /fracture-ws
npm run blast    # Blastworks, last man standing  :8083  ← /blast-ws
npm run blast:dm # Blastworks, deathmatch         :8084  ← /blast-dm-ws
npm run blockout3d # Blockout Royale 3D            :8085  ← /blockout3d-ws
npm test         # node --test over src/lib and server/*.test.js
npm run build    # static output to dist/
```

Each play route needs `npm run dev` **and** its own match server. They are
separate processes on separate ports so one crashing takes nothing else down.

Single test by name:

```bash
node --test --test-name-pattern="cooldown" server/game.test.js
```

Two things that waste time if forgotten:

- **`/play` needs both `npm run dev` and `npm run game` running.** With only vite, the `/ws` proxy has nothing to forward to and the browser reports a WebSocket connection failure.
- **The match server is a long-running process holding all state in memory.** Editing anything under `server/` does nothing until you restart it. Vite hot-reloads; the game server does not.

## What this repo contains

Two things sharing one build:

1. A **static marketing SPA** for a fictional game studio. `src/data/games.js` and `src/data/servers.js` are the CMS — all copy lives there. It fetches exactly one thing: `/board/*.json`, the standing leaderboard, which is five plain files written by the match servers and served straight off disk.
2. A **playable multiplayer game** at `/play`, the only part that touches a network.

## Game architecture

Three layers with a deliberate, enforced split:

| File | Owns | Must never contain |
|---|---|---|
| `server/game.js` | Every rule and all match state | Sockets, Node APIs, *any* import |
| `server/server.js` | Connection lifecycle, message parsing, broadcast | Any game decision |
| `server/blockout3d.js` | Every rule and all match state | Sockets, Node APIs, *any* import |
| `server/blockout3d-server.js` | Connection lifecycle, parsing, broadcast | Any game decision |
| `server/board.js` | Leaderboard merging and ranking | Node APIs, imports, I/O, a clock |
| `server/board-store.js` | Reading and writing the five board files | Any ranking decision |
| `src/pages/Play.jsx` | Rendering and input | Simulation, prediction, rule checks |
| `src/pages/Blockout3D.jsx` | Scene, camera, input, HUD | Simulation, prediction, rule checks |

`game.js` has zero imports on purpose — that purity is why all ~60 tests live against it and why `server.js` and `Play.jsx` have none. Put new logic there, not in the socket wrapper.

**The server is authoritative for everything**: move legality, elimination, who won. The client sends `{t:'join'|'move'|'use'}` and renders the `{t:'state'}` snapshot it receives at 10 Hz.

**There is no client-side prediction anywhere, and there never will be.** That
is what keeps the desync class out of all four games: no client ever holds a
state the server did not author.

**Interpolation is a different thing and is allowed.** Blockout Royale 3D
renders ~60 ms behind and blends between two snapshots it has *actually
received* (`src/lib/snapshotBuffer.js`). It renders the recent past, never a
guessed future, so it cannot desync. The other three games interpolate nothing
because at their tick rates they do not need to. Do not confuse the two rules:
predicting your own input ahead of the server is banned; drawing between two
frames the server sent is not.
Blockout Royale 3D exempts one player from that delay: the client draws the
body its camera is following at the newest position received, while everyone
else stays smoothed 60 ms back (`sample(now, liveId)`). That is still not
prediction — nothing simulates ahead of the server, and the position drawn is
one the server has already sent. It is there because a camera attached to a
body feels the replay delay as the whole world lagging the mouse.

**Full state every tick, never diffs.** `snapshot()` returns `state.tiles` **by live reference**, not a copy. That is only safe because `server.js` calls `JSON.stringify(snapshot(match))` synchronously in the same turn as `tick()`. Never retain a snapshot across an await, a timer, or a later tick, and never stash them for diffing.

## The leaderboard

Five files, one per match server, each with **exactly one writer**. That is the
whole concurrency design: no two processes ever write the same path, so there
is nothing to lock. `BOARD_DIR` says where they live (`./data` in dev,
`/var/lib/rivalblocks/board` deployed).

- **A board reaches a page two ways.** In a match it rides along in the
  snapshot as `state.board`, set by the wrapper and passed through untouched —
  no rules module reads it. On a page it is a plain `GET /board/<file>.json`.
- **`server/board.js` also runs in the browser.** That is why it is pure: the
  table a player reads is sorted by the same `rank` that wrote the file, so the
  two can never disagree. It must stay free of Node APIs, imports and `Date.now`.
- **A match is banked once, on the edge into `over`.** The phase stays there
  for seconds; `once()` in board.js is what stops a wrapper counting the same
  match on every frame.
- **What a game banks differs, and the wrapper decides it.** Fracture Line and
  Blastworks bank a finished *match* (`phase === 'over'` with `final`). Blockout
  Royale banks every *round*: its rounds are short and self-contained, so the
  round is the unit worth recording. Blockout still has a match — it gained
  `ROUND_TARGET`, where before its rounds ran forever — but that only drives the
  victory screen, not the board. Blockout Royale 3D banks per round as well,
  for the same reason, and unlike flat Blockout it banks real kills and deaths
  — a stomp, a sinkhole and a landing all have an author.

## Invariants that fail silently

- **`MAX_PLAYERS` is derived: `SPAWNS.length`.** `startRound` indexes `SPAWNS` by player, so a hand-written larger capacity would place a player at `undefined`. To raise capacity, add spawn points.
- **`SIZE` and `COLLAPSE_COUNT` move together.** A round lasts roughly `(SIZE² / COLLAPSE_COUNT) × COLLAPSE_EVERY_MS`. Growing the arena alone makes rounds drag.
- **The grid is always square; the *arena* is carved out of it** by starting tiles `gone`. Shape variety therefore needs no changes to movement, collapse, rendering, or the protocol. New shapes go in `carve()` plus a name in `ARENAS`; `keepLargestRegion()` and `snapSpawns()` then make them safe automatically.
- **Direction lookup must use `Object.hasOwn(DIRS, dir)`.** A bare `DIRS[dir]` truthy check accepts `constructor`, `__proto__` etc., which drives coordinates to `NaN` and makes a player permanently un-eliminable.
- **`server/package.json` (`{"type":"module"}`) must travel with `server/`.** It is the only ESM marker the deployed copy gets. Delete it as "redundant" and the systemd unit crash-loops on any Node older than ~20.19.
- **Blastworks: regrowth and the closing wall are two halves of one trade.**
  Deathmatch regrows stock and ends on a score. Last man standing does neither,
  so past `SUDDEN_DEATH_MS` a wall closes along `SQUEEZE_ORDER` and crushes what
  it lands on. Without it the board opens up and a competent player simply walks
  away from every blast — measured, one round in six finished and the rest ran
  past thirty minutes. Never squeeze a mode that regrows, or it does both.
- **Blockout: the wave shrinks and speeds up together.** `waveSize` tapers the
  count by `COLLAPSE_SHARE` down to a single tile, and `collapseDelay` closes
  the gap from `COLLAPSE_EVERY_MS` to `COLLAPSE_FASTEST_MS` as the floor runs
  out. They are a pair: tapering alone left the endgame crawling at one tile a
  second. **Which** tiles fall stays uniformly random over the whole floor —
  never clustered — and `pickWave` is the only place any of it is decided, so
  what a foresight shows is exactly what lands.
- **`board.players` is an array, never an object keyed by name.** Names come
  straight off a join screen, so a keyed board would take `__proto__` and
  `constructor` as keys — the same hole `Object.hasOwn(DIRS, dir)` exists to
  close. An array cannot have it.
- **A damaged board file must never stop a match server.** `load` returns an
  empty board on every failure. Losing a leaderboard is a nuisance; a match
  server that will not boot is an outage.
- **Tests reference constants, never literals.** `SIZE`, `MAX_PLAYERS`, `COLLAPSE_COUNT` are tunable precisely because no test hardcodes `15` or `8`. Preserve this.
- **The test helper `playing(n)` passes `() => 0` as rng** to force `ARENAS[0] === 'square'`, and freezes `nextCollapseAt`/`nextPowerupAt` at `Infinity`. Randomness in tests goes through an injected rng, never `Math.random`.
- **Blockout 3D: tiles ship as one character each, indexed
  `z * SIZE * SIZE + y * SIZE + x`.** 845 tiles as `'solid'|'warn'|'gone'`
  strings is 183 KB/s per client at a 33 ms tick. `tileString()` is the only
  encoder and `CHAR` the only table; a fifth tile state means touching both or
  the wire silently carries `undefined`.
- **Blockout 3D: the void and the collapse wave are two halves of one trade.**
  The wave erodes every floor at once; the void eats the stack from the bottom
  and stops at floor 0. Without the void the correct play is to stand on the top
  floor and never descend, and the match is one flat Blockout round with four
  unused floors under it — the same failure the Blastworks closing wall exists
  to fix. Floor 0 is never consumed: once it is all that is left the game *is* a
  flat Blockout round, which is the ending it is built to reach.
- **Blockout 3D: `lift` is the only powerup that creates height.** Everything
  else moves it or spends it; `swap` is zero-sum by construction. If matches run
  long, `lift`'s frequency is the first thing to check, and the powerup bag
  cannot express a weight below one draw in fourteen without restructuring.
- **Blockout 3D: `kills`/`deaths` reset per round in `startRound`, because the
  board banks per round.** They are cumulative from join otherwise, so a
  best-of-three would bank a player's kills three times over and keep
  compounding across matches in one session. Each counter is scoped to the
  unit it is banked in: `wins` is match-scoped, kills and deaths are
  round-scoped.
- **Blockout 3D: `anchor` plates a tile without un-flagging it.** Plating is
  armour, not a repair. A warned tile keeps its warning and is saved when
  `resolveWarnings` spends the plate — so an anchor answers a wave you can see
  coming without cancelling it for free.
- **Blockout 3D: `hover` is one guard at the top of `startFall`.** A hole, a
  collapsing tile and a shove all drop a body through that
  one function, so guarding there covers all three. Hover checks scattered
  elsewhere would be a defect.
- **Blockout 3D picks waves only from floors somebody is standing on; flat
  Blockout picks uniformly across the whole board.** `pickWave` here used to
  pick uniformly across the whole 845-tile stack too, and thirty seeded rounds
  measured what that cost: 53% of drops chained straight into a second,
  unwarned drop — unoccupied floors below had already rotted through before
  anyone arrived on them, so a fall onto one landed on ground that was
  already gone. Restricting the candidate list to occupied floors, with
  `COLLAPSE_EVERY_MS` held at the same value so the comparison isolates this
  change alone, brought that to 38%. The divergence is deliberate, and the
  reason is the third axis: a flat board has nowhere to fall to, so eroding it
  evenly costs nothing, while a stack that erodes where nobody is looking
  punishes the descent the whole design is built around. `pickWave` falls
  back to the whole stack when no floor holds a living player, or the
  collapse would stall between rounds.
- **Blockout 3D spawns powerups only on floors with living players.**
  `spawnPowerup` restricts candidate tiles to occupied floors (`state.players.filter(p => p.playing && p.alive).map(p => p.z)`)
  so collectibles spawn directly on the platforms players are fighting on
  rather than accumulating on abandoned floors above or below. When no players
  are alive, it falls back to any solid tile in the stack.
- **Blockout 3D draws one `InstancedMesh` per floor, not one per stack.**
  `InstancedMesh` has no per-instance opacity — `instanceColor` is RGB only —
  so fading the floors above the player needs a material per floor. Five draw
  calls, not one, and still not the 845 that drawing tiles individually would
  cost. Merging them back into a single mesh to "tidy up" silently removes the
  fade and puts the underside of a slab between the camera and the player.
- **Keyboard input is rotated by camera yaw in `followCamera.worldDir`, and
  nowhere else.** The game shipped with `KeyW` sending the fixed world vector
  `[0, -1]` while the camera sat at 45 degrees and its yaw never left the
  renderer, so W never once moved the player up the screen. The rotation is
  pure and tested precisely because it failed silently: at yaw 0 it returns the
  input unchanged, so the wrong version looks correct until you notice the
  camera never starts at zero.
- **Blockout 3D matches are single-round (`ROUND_TARGET = 1`) and advance at 60 FPS (`TICK_MS = 16`).**
  Multi-round targets caused long matches across five floors. With `ROUND_TARGET = 1`,
  the first round win triggers `state.final = true` and concludes the match. Both
  the rules engine tick and client input stream run at 60 Hz (`TICK_MS = 16`,
  `SEND_MS = 16`), with the client interpolation window set to 60 ms (`DELAY_MS = 60`).
- **Blockout 3D: `jump` authoritatively clears 1-tile gaps without falling while airborne.**
  Space triggers `jump` (`JUMP_DURATION_MS = 420`, `JUMP_COOLDOWN_MS = 750`,
  `JUMP_SPEED_BOOST = 1.25`). During `state.now < p.jumpUntil`, `resolveFalls` ignores
  missing or gone tiles under the player. Falling triggers only when the landing tile
  is non-solid after the jump finishes. Jump arcs in `towerScene.js` are purely visual;
  gap clearance and landing validity are strictly server-authoritative.
- **Blockout 3D: camera navigation uses canvas pointer lock.**
  Clicking the arena engages `canvas.requestPointerLock()`, feeding raw `movementX`
  and `movementY` into `orbit()`, with Escape releasing lock. Drag-based rotation
  fails silently when the mouse leaves the window or encounters screen boundaries.
- **Blockout 3D visuals: characters and powerups use procedural Three.js primitives without image textures.**
  3D chibi astronaut characters (capsule suit, cyan visor box, oxygen tank backpack,
  stubby boot cylinders) and 3D collectible powerups (rotating icosahedron gem with
  counter-rotating tilted torus ring) use procedural geometries and materials only.
  Floating silhouette glyph billboard labels above heads preserve non-color player
  identification under WCAG 1.4.1.

## Design rules inherited from the site

These are non-negotiable and predate the game:

- **No image files.** All artwork is generated CSS, inline SVG (`BlockArt.jsx`), or procedural Three.js primitives (`towerScene.js`).
- **Status is never communicated by colour alone** (WCAG 1.4.1). Warning tiles carry a glyph, holes differ structurally from solid tiles, players carry their initial.
- **Player colour tokens (`--player-1..8`) are separate from status tokens** so a piece can never wear a tile's colour. Never reuse `--warn` for a player.
- **Only existing `@theme` tokens** from `src/index.css`. No new tokens without reason, no `tailwind.config.js` (Tailwind v4 is CSS-first).
- **Canvas and WebGL code reads the raw `:root` variables** (`--bg`, `--tile`, `--player-N`), never the `--color-*` aliases. Tailwind v4's `@theme inline` substitutes those into utilities rather than emitting them, so a `--color-*` read returns an empty string at runtime and silently falls back.
- **In-fiction copy.** The studio is fictional; the site never says so. Nothing may read as a demo, mock, test, or placeholder.

## Deployment

Single node, two tiers: nginx serves `dist/` and proxies five WebSocket paths to five Node processes on loopback, all five from one systemd template unit (`rivalblocks@<instance>`). nginx also serves `/board/` straight from `BOARD_DIR`. Full sequence in `deploy/DEPLOY.md`.

**No proxy path but `/ws` itself may begin with `/ws`.** nginx and vite both match by prefix, so `/ws-fracture` is silently swallowed by the Blockout rule and connects the player to the wrong game.

Traffic is plain `ws://` on port 80 with no TLS. **This is deliberate** — the game protocol is meant to be readable in Wireshark on the lab network. `ws` leaves `perMessageDeflate` off by default, which is what keeps frames as uncompressed JSON; do not enable it. Add TLS before this is exposed beyond a trusted segment.

## Docs

`docs/superpowers/specs/` holds design docs, `docs/superpowers/plans/` the implementation plan. The plan carries a "Post-implementation corrections" note at the top — its code blocks show pre-fix versions and should not be replayed verbatim.
