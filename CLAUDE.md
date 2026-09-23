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
npm run drillers # Void Drillers                   :8086  ← /voiddrillers-ws
npm run cipher   # Cipher Run                      :8087  ← /cipherrun-ws
npm run cutline  # Cutline                        :8088  ← /cutline-ws
node server/cutline-select.mjs   # regenerate CIRCUITS by measured difference
npm test         # node --test over src/lib and server/*.test.js
npm run build    # static output to dist/
npm run check:bundle   # after build: fails if three.js reaches the main chunk
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

1. A **static marketing SPA** for a fictional game studio. `src/data/games.js` and `src/data/servers.js` are the CMS — all copy lives there. It fetches exactly one thing: `/board/*.json`, the standing leaderboard, which is eight plain files written by the match servers and served straight off disk.
2. A **playable multiplayer game** at `/play`, the only part that touches a network.

## Game architecture

Three layers with a deliberate, enforced split:

| File | Owns | Must never contain |
|---|---|---|
| `server/game.js` | Every rule and all match state | Sockets, Node APIs, *any* import |
| `server/server.js` | Connection lifecycle, message parsing, broadcast | Any game decision |
| `server/blockout3d.js` | Every rule and all match state | Sockets, Node APIs, *any* import |
| `server/blockout3d-server.js` | Connection lifecycle, parsing, broadcast | Any game decision |
| `server/voiddrillers.js` | Every rule and all match state | Sockets, Node APIs, *any* import |
| `server/voiddrillers-server.js` | Connection lifecycle, parsing, broadcast | Any game decision |
| `server/cipherrun.js` | Every rule and all match state | Sockets, Node APIs, *any* import |
| `server/cipherrun-server.js` | Connection lifecycle, parsing, broadcast | Any game decision |
| `server/cutline.js` | Every rule and all match state | Sockets, Node APIs, *any* import |
| `server/cutline-server.js` | Connection lifecycle, parsing, broadcast | Any game decision |
| `server/board.js` | Leaderboard merging and ranking | Node APIs, imports, I/O, a clock |
| `server/board-store.js` | Reading and writing the board files | Any ranking decision |
| `src/pages/Play.jsx` | Rendering and input | Simulation, prediction, rule checks |
| `src/pages/Blockout3D.jsx` | Scene, camera, input, HUD | Simulation, prediction, rule checks |
| `src/pages/VoidDrillers.jsx` | Canvas, camera, particles, HUD | Simulation, prediction, rule checks |
| `src/pages/CipherRun.jsx` | Canvas, chibi runners, input, HUD | Simulation, prediction, rule checks |
| `src/pages/Cutline.jsx` | WebGL and overlay canvases, input, HUD | Simulation, prediction, rule checks |
| `src/lib/cutlineScene.js` | Cutline's three.js scene | Game rules, simulation, prediction |
| `src/lib/raceCamera.js` | Game-to-three.js mapping, view poses, smoothing | three.js, the DOM, any import |
| `src/lib/wallBlocks.js` | Which wall tiles are drawn in 3D | three.js, the DOM, any import |
| `src/lib/carLift.js` | How high a car is drawn: ramp slope or jump arc | three.js, the DOM, any import |


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
**Cutline does not exempt anyone** (`sample(now)`, no `liveId`). Its snapshots
land unevenly (measured on Windows: 46 Hz, gaps of 16 or 30 ms), and drawing
your own car at the newest one froze it on 67 of 165 frames and then jumped it
double. In 2D the world stepped with it and hid that; behind a chase camera it
read as the car stuttering. Interpolated, no frame freezes, for 40 ms of delay
(`DELAY_MS`, sized to the longest snapshot gap plus jitter).
Cutline has no mouse-look, so Blockout 3D's reason for the exemption does not
apply. `heading` is blended too, the short way round: taken from the newer
frame alone, a car's facing froze on 153 of 506 cornering frames and then
turned up to three times the usual amount in one.

**Full state every tick, never diffs.** `snapshot()` returns `state.tiles` **by live reference**, not a copy. That is only safe because `server.js` calls `JSON.stringify(snapshot(match))` synchronously in the same turn as `tick()`. Never retain a snapshot across an await, a timer, or a later tick, and never stash them for diffing.

## The leaderboard

Eight files, one per match server, each with **exactly one writer** (`board-blockout.json`, `board-blockout3d.json`, `board-fracture.json`, `board-blastworks-lastman.json`, `board-blastworks-deathmatch.json`, `board-voiddrillers.json`, `board-cipherrun.json`, `board-cutline.json`). That is the
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
- **What a title's board keeps is declared once, in `BOARDS`.** `fights` hides
  K/D where nobody is killed, and `bests` lists the best scores with their
  column headings. `combine` reads the same entries: kills and deaths add up
  only from titles that fight, and a best score stays filed under its own title
  (`row.bests[file]`), because a Cipher Run finish and a Void Drillers clear are
  not the same clock. A new best score is a `bests` entry, not a new column in
  `Leaderboard.jsx`.

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
- **Blockout 3D: there is one `--deck-N` token per floor, and the count is not
  checked.** `towerScene.js` reads `--deck-${z}` for every `z < FLOORS` and
  falls back to `--tile` when the token is missing. Raise `FLOORS` without
  adding a token and the new deck silently wears deck 0's grey, which looks
  deliberate and is not. Eight floors, eight tokens today.
  `--deck-0` is `--tile`'s value on purpose, and **deck 0 is the top of the
  stack, not the ground**: players spawn there, falling takes you to higher
  `z`, and `consumeFloor` climbs from `FLOORS - 1` and stops before 0. Deck 0
  is therefore the deck every match ends on, which is what makes it the neutral
  the others are judged against. The ramp warms downward, so a tint carries
  proximity to the void as well as identity.
- **Blockout 3D: a tile's colour is decided in `src/lib/tileTint.js`, never in
  the renderer.** A tile is routinely in several states at once — `anchor`
  exists to plate a tile the wave is already coming for — so `tileRole` ranks
  them (`warn` > `soon` > `plate` > `deck`) and `towerScene.js` only resolves
  the winning role to a colour. The state that loses the surface does **not**
  lose its signal: every state also has structure (sink, rise, thickness) and
  its own marker mesh, drawn regardless of which role won the tint. Moving the
  precedence into the render loop would put it out of reach of a test.

- **Each game announces a WebSocket subprotocol, and the name is load-bearing.**
  `new WebSocket(url, 'blockout.v1' | 'fracture.v1' | 'blastworks.v1' |
  'blockout3d.v1' | 'voiddrillers.v1' | 'cipherrun.v1')` in the six pages. Nothing in the app reads it back — no
  server sets `handleProtocols`, so `ws` echoes the first name offered and the
  handshake completes either way. It exists for the capture: Wireshark keys its
  `ws.protocol` dissector table on the negotiated string, and
  `deploy/rivalblocks.lua` registers against exactly these six. Rename one
  without renaming it there and nothing errors anywhere; the game just stops
  being named. Both halves move together.
  The name is only ever stated in the handshake, so it cannot name a capture
  that missed it or one taken before this existed. Two fallbacks cover that,
  both heuristics: the path in the upgrade request (`/ws`, `/fracture-ws`,
  `/blast-ws`, `/blast-dm-ws`, `/blockout3d-ws`, `/voiddrillers-ws`,
  `/cipherrun-ws`), remembered per TCP stream, and failing that our JSON shape
  on ports 8081-8087. **The path is the only
  one of the three that survives a proxy** — captured at the browser every game
  shares one port, 5173 in dev and 80 deployed, so a capture taken there is
  named by its paths or not at all. Adding another proxy path means adding it
  to the dissector too.
  The obvious route for the port fallback, Wireshark's `ws.port` table, was
  measured doing nothing: text frames are routed by the `websocket.text_type`
  preference, not by port, so only a heuristic ever sees them.

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
- **Blockout 3D: `FLOORS` and `VOID_EVERY_MS` are one setting in two places.**
  The void eats every deck but 0, so a match's ceiling is
  `VOID_FIRST_MS + (FLOORS - 1) * VOID_EVERY_MS` — 200s at five floors and 35s,
  200s again at eight floors and 20s. Raise `FLOORS` alone and the extra decks
  are paid for in match length, the failure `ROUND_TARGET = 1` exists to fix.
  `COLLAPSE_EVERY_MS` is **not** part of this pair: it is tuned against how
  fast deck 0 erodes, and deck 0 is the deck the void never reaches.
- **Blockout 3D: `FLOORS` must stay below `ARENAS.length`.** A test walks a
  rising rng through the arena list to prove floors do not all share one shape.
  Once `FLOORS` reaches `ARENAS.length` that counter wraps and the test starts
  passing for the wrong reason. Eight floors against ten shapes today.
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
- **Cutline: steering is a rate, never a position target.** The page sends
  `steer: -1 | 0 | 1` as held state at 60 Hz and the server turns the car at
  `TURN_RATE` for as long as it is held. A round trip is then felt as heavy
  steering, because a turn starts late and ends late by the same amount. A
  control model where the client names a destination instead puts the latency
  between the hand and the nose, which is the failure that makes a networked
  racer feel broken. This is the single decision that makes the genre viable
  under the no-prediction rule, and it is not a preference.
- **Cutline: the track is static and ships once; hazards are a list.** `carve()`
  produces the grid, the racing line, the checkpoints and the starting slots
  from one walk, and the grid RLE-encodes into `welcome` exactly as Void
  Drillers ships its shaft. Dropped slicks and walls never write into the grid;
  they live in `state.hazards`, capped at `MAX_HAZARDS`. Writing a hazard into
  the grid would force the whole track into every snapshot and turn a
  sub-kilobyte frame into a per-tick map.
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
- **Cutline: no drivable way round a checkpoint, and a test proves it by flood
  fill.** Parallel stretches sit `MIN_WALL` apart and corner run off digs
  `GRAVEL_DEPTH` in, so run off once ate the wall on every circuit and left
  gravel bridges skipping up to half a lap: 72 of 96 checkpoints could be driven
  round, and a lap taken that way silently never counted. Run off now never
  touches ground owned by a part of the lap more than `RUNOFF_OWN_SPAN` points
  away. A shortcut is kept only if carving it into a copy leaves no checkpoint
  that can be driven round, best first, up to `SHORTCUT_TRIES`; skipping no
  checkpoint was not enough, because a chord that starts on a checkpoint can be
  entered beside its circle.
- **Cutline: a car takes the nearest READY box in `PICKUP_REACH`.** Judged
  against the nearest box of any kind, a car passing between two got nothing
  when another car had just emptied the nearer one.
- **Cutline: moving instanced layers are never frustum culled.** An
  `InstancedMesh` computes its bounding sphere once and never again, so pickups,
  hazards and skids vanished whenever that stale sphere was off screen. Build
  them with `dynamicLayer`. Walls and ramp wedges are placed once per circuit
  before their first draw, so they keep culling.
- **Cutline: the wrong-way warning is a rule, not a page guess.**
  `updateWrongWay` judges where a car is going against the tangent of the
  nearest centre-line point, and warns after `WRONG_WAY_MS` above
  `WRONG_WAY_MIN_SPEED`. The page only draws `wrongWay` from the snapshot.
- **Cutline: the HUD is drawn into the overlay canvas, not under it.** Place,
  lap, leader, item and a speedometer (`speed` from the snapshot, eased on the
  page) sit on the game so they are seen when it fills the screen; a screen
  reader gets the same reading from an `sr-only` line. Every item has a
  procedural icon (`drawItemIcon`), each a different shape.
- **Cutline: the camera eases its offset from the car, never its absolute
  position.** Easing the absolute position made it trail a moving car by
  speed / rate, a tile at top speed, so the car drifted up the screen as it
  accelerated and looked laggy. The offset rides with the car at any speed and
  still glides through a view switch.
- **Cutline: the item kit is flat, and a spin goes through `takeHit`.** Boost,
  oil, banana, shield (6 s: oil does nothing, the next spin or shock breaks it),
  spring (a hop from the ground), shock (every other car within `SHOCK_RANGE`
  keeps `SHOCK_KEEP` of its speed), puck (runs the centre line to the car ahead,
  homes in close), ghost (3 s through cars and dropped hazards) and decoy (a
  fake box, stood on its corner so it can be told apart). A ghost is never hit
  and a shield takes the hit instead, in one place.
- **Cutline: rare snapshot flags are sent only while true.** `shield`, `ghost`,
  `shocked`, `hop`, `wrongWay`, `falling` and `land` would push a full frame of
  eight cars past its 4 KB budget if every car always carried them; the page
  reads a missing flag as false.
- **Cutline: a jump holds its speed.** In the air there is no brake, no drag
  and no off-road cap from a wall below. Every ramp's landing checks, in
  `rampLandsClear` and the tests, sample every half tile of landing distance
  from the slowest launch to boosted in a slipstream, and assume exactly that.
- **Cutline: about half the ramps have a hole past the lip.** `S_HOLE` spans
  the whole road, rows `HOLE_FROM` to `HOLE_TO` ahead of every other intact ramp
  clear of the grid. A car that drives in falls for `FALL_MS` and is set down
  past it, stopped. A fall skips far less road than a checkpoint circle is
  across, so a lap still counts, and a test walks every lane to prove it. Every
  ramp is re-checked after a hole is dug, or a boosted jump off the ramp before
  can land in it.
- **Cutline: run off has no dead-end fingers.** Refusing gravel next to another
  part of the lap left one-tile fingers into the wall; a bot that drove into one
  faced the wall forever. Gravel with fewer than two ways out goes back to wall.
- **Cutline: a wall-jump pad is a jump pad, at most one per circuit.** It sits at
  the outside of a corner facing the wall, launches only a car driving at it
  (`PAD_ALIGN`), lines it up and flies it exactly `distance` tiles past the lip
  at any speed with no steering or thrust, so every lane is checked to land on
  one later stretch. On touchdown the car faces along that stretch and is
  credited the checkpoints it flew past; the finish line is never jumped. A
  free-flight jump over a wall was tried first: its landings spread over eight
  tiles with speed and some always hit a wall, and those that did not landed
  across a road too narrow to turn in. The Spindle, Draw Bench and Cinder Yard
  have one; the others have no spot that passes.
- **Cutline: ramp height is render only.** The rules track `airUntil` and
  nothing else; `airT` exists for the page to draw an arc with. Giving the rules
  a z axis would make this a different game.
- **Cutline: ramps are listed as well as painted.** The grid says where a ramp
  is but not which way it faces, so `carve` also returns `ramps` (`{x, y,
  heading, width}`) and `welcome` ships them. The page draws a wedge rising the
  way the lap runs. The launch still reads only the grid. `rampRuns` builds the
  list from the finished grid, one entry per unbroken run of ramp tiles,
  because pickup pads are laid over some ramp tiles later in `carve`; a wedge
  over a pad lifted cars the rules never launched. Tests fail if a ramp tile
  has no wedge, if a wedge covers a tile that is not a ramp, or if bots cross a
  ramp against its facing.
- **Cutline: a car's drawn height is `carLift`.** On a ramp it rides the slope;
  off it the jump arc sits on a line from the lip's height down to the ground.
  The rules renew a car's flight on every tick it spends on a ramp tile, so
  `airT` is still 0 at the lip, and an arc that started from the ground there
  dropped the car the lip's height in one frame. The bumper eye rises by the
  same amount; chase and top-down hold steady. Not covered: a car still in the
  air when it crosses a second ramp has its flight renewed by the rules, so it
  is drawn snapping down onto that ramp.
- **Cutline: game y maps to three.js +z, never -z.** `toWorld` in
  `raceCamera.js` is the only place the mapping lives, and every camera pose is
  built through it. Mapping y to -z mirrors the world: a right-hand steer shows
  as a left turn and the minimap disagrees with the view, and nothing errors.
- **Cutline: the camera up vector is derived from the view, never fixed.**
  three.js `lookAt` breaks when up is parallel to the view, and top-down looks
  straight down while chase uses world up, so any fixed up vector goes
  degenerate partway through a switch. `upFor` is perpendicular by construction.
- **Cutline: bumper position is locked, never smoothed.** At top speed any lag
  leaves the camera behind the bumper, inside the car. Switching into bumper is
  therefore a cut, on purpose.
- **Cutline: steering is never rotated by the camera.** Blockout Royale 3D
  rotates input by camera yaw in `followCamera.worldDir`. Cutline steers a rate
  relative to the car, and copying that rotation would break it.
- **Cutline: `WALL_HEIGHT` and the chase camera height are one setting.**
  `chaseClearance` says how far behind the car a wall must be before the chase
  camera sees over it, and a test holds it under `CHASE_CLEAR_MAX`.
- **Cutline is a lazy route, and `npm run check:bundle` enforces it.** three.js
  is ~570 KB. Importing Cutline or Blockout 3D eagerly would add it to every page.
- **Cutline's ground is the 2D prerender, used as one texture.** `setTrack`
  disposes the previous circuit first, and `dispose` calls `forceContextLoss`.
  Without the first, GPU memory grows every restart; without the second, WebGL
  contexts pile up as a player clicks around the site (measured: 10 visits left
  10 live contexts) until the browser kills the oldest. Checking this with full
  page loads proves nothing, since a load frees every context anyway.
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
- **Cutline: the item bag is flat, and that is the design.** A car running last
  draws from the same odds as the leader. Slipstream is the only catch-up
  mechanic, because it rewards closing a gap rather than failing to. Weighting
  the bag by position would make the cut arbitrary rather than earned.
- **Cutline: the cut fires when the leader crosses, not when the field
  finishes.** Whoever is last in running order at that instant is out, wherever
  they are. Waiting for the tail to trail in would pace the race off its
  slowest car, which is the format's whole reason for existing.
- **Cutline banks per race, and its lap record is filed under `fastestTime`.**
  The `label` in `BOARDS` is already per title, so this needs no new key, no
  change to `isRow` and no change to `rank`. `merge` only records a time on a
  win, so the record is the best lap **among winning drives**, and the column is
  labelled "Winning lap" to say so. A faster lap from a driver who was cut is
  not banked, the same gate Cipher Run's "Fastest win" sits behind.

## Game-Specific Mechanics & Balance Solutions

### Cipher Run (Typing Decryption Race)
- **Monkeytype standard**: 5 characters per normalized word (`(correctChars / 5) / (elapsedMinutes)`).
- **Glitch Breaker Lockout**: 3 consecutive typos trigger 350ms static freeze (`LOCKOUT_MS = 350`). The freeze resets the count, so the next one takes another 3.
- **Typos must be backspaced**: a typo advances the cursor and stays red until erased. Space is an ordinary key with no word jump, and the breach only counts with zero typos left. Accuracy counts every correct keypress, even ones later erased; net WPM counts only letters still correct.
- **The page never judges a key.** It forwards each key and draws `cursor` and `wrong` from the snapshot, which the server also sends straight back to the typist after every accepted key. The page used to keep its own buffer, and it drifted from the server the moment a key landed inside a freeze.
- **Ctrl+Backspace erases the word** (Alt+Backspace on a Mac), sent as `{key:'Backspace', word:true}`. The server walks it back like a text editor: spaces behind the cursor first, then the word.
- **A lone operator waits in the lobby.** A race starts at `MIN_PLAYERS` operators, or at once when one presses Start with bots (`{t:'ready'}` sets `botsWanted`). The request clears when the last operator leaves.
- **Runners move by clean words, not by the cursor.** A snapshot's `progress` is words finished with no typo left in them over total words, so typing ahead past typos does not move the chibi.
- **Race messages share one fixed-height status line** over the terminal, most urgent first, so a message coming or going never moves the text being typed.
- **A protocol picked from the archive skips the vote.** `{t:'pick'}` ends a vote in progress at once, or waits for the next race if one is under way, and a restart carries it over. Only the admin can restart; results move on by themselves after `POST_RACE_GRACE_MS`, counted on the match clock (`nextRaceIn`).
- **151 Curated Protocols**: 50 Short (15 to 25 words), 50 Medium (40 to 60 words), 50 Long (85 to 125 words), plus Protocol 151 Easter Egg (Subliminal Devotion Directive repeating "I LOVE RIVALBLOCKS." 20 times).
- **Authoritative Pre-Round Voting**: 5-second pre-round voting phase (`VOTE_DURATION_MS = 5000`) before race countdown, with real-time consensus percentages, home-row hotkeys (`1`, `2`, `3`), random tie resolution, and a 2% Easter Egg roll.
- **Chibi Cyber Sprinters**: Procedural anime runner with 6 sprinter variations, dynamic stride cadence scaling with WPM, word-dash impulse, stumble states, and celebratory cheer states.

### Void Drillers (Per-Player Shaft Race)
- **Once the match clock runs, nobody new spawns.** A person arriving mid-round spectates it and is dealt into the next, and bots are only dealt in while `elapsed === 0`. The void passes the spawn row a few seconds in, so anything placed later is crushed on arrival.
- **Only a vault touchdown is a clear time.** A win by outlasting a rival (`winReason: 'survival'`) banks a win with no time, or a rival walking out a second in would set the record.
- **Gas knockback lives in `kx`, not `vx`.** `vx` is rebuilt from walking input every tick, so a push written there was erased before it moved anyone. `kx` rides on top of walking and dies away.

## Design rules inherited from the site

These are non-negotiable and predate the game:

- **The marketing pages carry key art; everything a game draws is still
  procedural.** `public/art/*.jpg` holds one 1376x768 cover per game plus one
  studio shot, referenced as `coverImage` in `src/data/games.js`. Every call
  site guards it — `game.coverImage ? <img> : <BlockArt>` — so `BlockArt.jsx`
  remains the fallback and is still the only artwork on `NotFound`, in the
  `Lightbox`, and in the shot grid. **Nothing a canvas or WebGL surface draws
  may load a file**: `towerScene.js`, `pickupArt.js`, `wallTiles.js` and
  `fireTiles.js` generate every pixel they show, and a game that waited on an
  image would stall its first frame. Commit art at web weight, not at whatever
  a generator emits: the first five arrived near-lossless at ~1 MB each and
  re-encoding at JPEG quality 82 cost nothing visible and saved 75%.
- **Status is never communicated by colour alone** (WCAG 1.4.1). Warning tiles carry a glyph, holes differ structurally from solid tiles, players carry their initial.
- **Player colour tokens (`--player-1..8`) are separate from status tokens** so a piece can never wear a tile's colour. Never reuse `--warn` for a player.
- **Only existing `@theme` tokens** from `src/index.css`. No new tokens without reason, no `tailwind.config.js` (Tailwind v4 is CSS-first).
- **Canvas and WebGL code reads the raw `:root` variables** (`--bg`, `--tile`, `--player-N`), never the `--color-*` aliases. Tailwind v4's `@theme inline` substitutes those into utilities rather than emitting them, so a `--color-*` read returns an empty string at runtime and silently falls back.
- **In-fiction copy.** The studio is fictional; the site never says so. Nothing may read as a demo, mock, test, or placeholder.

## Deployment

Single node, two tiers: nginx serves `dist/` and proxies eight WebSocket paths to eight Node processes on loopback, all from one systemd template unit (`rivalblocks@<instance>`). nginx also serves `/board/` straight from `BOARD_DIR`. Full sequence in `deploy/DEPLOY.md`.

**No proxy path but `/ws` itself may begin with `/ws`.** nginx and vite both match by prefix, so `/ws-fracture` is silently swallowed by the Blockout rule and connects the player to the wrong game.

Traffic is plain `ws://` on port 80 with no TLS. **This is deliberate** — the game protocol is meant to be readable in Wireshark on the lab network. `ws` leaves `perMessageDeflate` off by default, which is what keeps frames as uncompressed JSON; do not enable it. Add TLS before this is exposed beyond a trusted segment.

## Docs

`docs/superpowers/specs/` holds design docs, `docs/superpowers/plans/` the implementation plan. The plan carries a "Post-implementation corrections" note at the top — its code blocks show pre-fix versions and should not be replayed verbatim.
