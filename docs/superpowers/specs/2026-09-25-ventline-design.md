# Ventline: Game Design

*2026-09-25. Draft for player review before implementation planning.*

## 1. Purpose and pitch

**Ventline** is a short, repeatable, one-button flight game for RivalBlocks. A maintenance drone crosses the block-built ventilation works while shutters keep closing off the route. Each barrier offers a wide service opening and a narrow charged opening. Both keep the drone alive; the charged opening earns an extra point. Occasional shutters add a visible shield to the service route and a score charge to the charged route.

The game adds a fast score chase to a site whose current titles are longer matches. A visitor can start alone, retry immediately, and chase an all-time high score, or join a simultaneous race against other players. The controls and scoring are identical in both modes. A typical attempt should end from a collision after roughly 30 to 90 seconds, but neither mode has a time limit. Skilled runs can continue indefinitely.

Working marketing line: *Every gap is a choice.* Genre line: *One-button drone flight, solo or up to eight.* The name and copy are in fiction; game artwork uses an original maintenance drone and factory shutters.

## 2. Decisions made with the player

- Solo runs and live races both exist.
- Live players fly the same course at the same time, without attacks or body collisions.
- Live rivals appear as translucent, named drone silhouettes on the shared course, following the VoidDrillers presentation pattern.
- A top-right rolling map shows the nearby shutter layout and player positions in both solo and live play.
- Each shutter has a wide safe opening and a narrow bonus opening. Passing either is valid.
- Powerups activate automatically after a clean clear: the service route can grant a one-use shield, and the charged route can grant a one-use score bonus.
- The course layout changes each run, within the same difficulty schedule. Everyone in one live round receives the same layout.
- Solo and live scores feed one persistent all-time high score board, using the site's existing player names without accounts.
- Both modes continue until the drone crashes. A live round ends when every participating drone has crashed.
- The look is an industrial drone in a block-built facility. **Ventline** is the chosen working title.

## 3. Flight and shutters

The game is side-on. The drone advances horizontally at the course's scrolling speed. A press gives it one upward impulse; gravity draws it down between presses. Holding the key does not create repeated thrust. Desktop controls are Space or click; touch input works inside the play area. The browser sends flap intent on the press edge rather than keyboard repeat, and the server ignores flap requests that arrive too close together. A flap sets vertical velocity rather than adding an unlimited impulse, so rapid input cannot make the drone climb without control.

The drone crashes if its body touches a shutter, ceiling, or floor, unless a held shield absorbs a shutter hit. An unprotected crash ends that player's run immediately. There are no lives or mid-run respawns. A solo player can begin a new run from the results screen without returning to a lobby.

Each shutter has two visibly separate openings:

| Opening | Shape | Points on clearing the barrier |
| --- | --- | ---: |
| Service | Broad, clearly framed | 1 |
| Charged | Narrow, marked with a lightning glyph and tighter frame | 2 |

The score is awarded once, only after the drone's full body clears a barrier without collision. The second point is awarded only if it passed through the charged opening. A held score charge adds 2 points to the next clean clear, whether service or charged, then is consumed. Score the clear using the previously held charge before granting any pickup on that barrier. Distance and time do not award points, and no client message can award a score. A run's score is its total points when it ends. The live winner is the player with the most points, so a risky route can beat a longer safe run.

Shutter 5 and every seventh shutter after it display two powerup pickups: a shield in the service opening and a score charge in the charged opening. Clearing through an opening grants its pickup automatically after the drone's full body passes the shutter. The player does not need to touch a smaller item hitbox or press another button. Each drone can hold at most one shield and one score charge. Reacquiring an already held effect leaves it at one; effects do not stack. Neither effect expires with time. An unused effect is lost when the run ends.

The shield automatically absorbs the next shutter contact and is consumed. The drone then ignores contact with that one shutter until its full body has passed it, with normal flight physics continuing. That barrier awards zero points, does not count as a clean clear, grants no pickup, and does not consume a held score charge. A shield does not prevent ceiling or floor crashes, including during the protected passage. A shutter passed this way still advances course distance and the barrier index. The HUD's gate count and live tie-break count use clean clears, not shielded passages.

Shutter spacing, service-opening width, drone size, and maximum speed are tuned together. The course generator must keep a reachable service opening after either opening of the preceding barrier; a player must never be forced into an impossible next move for taking the charged route. The charged opening remains optional and harder. Difficulty rises with barrier index through a fixed, bounded schedule, then plateaus at a difficult but physically possible setting. The seed changes opening positions, not the difficulty budget or pickup schedule at a given barrier index. Powerups cannot be required to make a course passable. No moving shutters or extra hazards are needed for the first version.

## 4. Solo and live rounds

**Solo:** the match server creates a private run with a new seed. The player can retry immediately after crashing. A deliberate restart or disconnect ends the current attempt and banks only the score already verified by the server. Solo attempts count as attempts on the title board, but never as live wins.

**Live:** two to eight ready players start after a short shared countdown. The server creates one seeded shutter sequence and independent drone state, including powerup holdings, for each player. All start at the same position and follow the same scroll, difficulty, and pickup schedule. Late arrivals spectate until the next round. A crashed player can watch the remaining players or leave to start a solo run. The spectator view follows the surviving player with the highest score, then greatest distance, then lowest stable player ID for exact ties. It switches to the next eligible player if that drone crashes. A player who disconnects is marked crashed and cannot receive a live win from that round.

The live round ends when every player has crashed or disconnected. Highest score among players who stayed connected wins. Ties are broken by barriers cleared, then distance travelled; exact ties share the win. If everyone disconnects, there is no winner. The server banks each live participant's score and win result once at round end, then returns to the lobby. A round has no clock cap; a player who stops sending input falls and crashes under normal physics.

Solo and live each generate new layouts, but generation obeys the same widths, spacing, speed, pickup schedule, and reachability rules. Live racers see precisely the same layout and pickup opportunities within their round; collecting or using an effect changes only that player's state. This makes scores comparable enough for one arcade board while keeping retries varied; it does not claim every randomly positioned course is identical in difficulty.

## 5. Server authority and data flow

The design follows the existing game split:

| Unit | Responsibility |
| --- | --- |
| `server/ventline.js` | Pure state transitions, fixed-step drone physics, deterministic shutter and pickup generation, per-drone effects, collision, scoring, and round outcome. No Node APIs, sockets, timers, or I/O. |
| `server/ventline-server.js` | WebSocket lifecycle, solo run instances, live lobby, input validation, spectator target selection, snapshots, and score banking. One process owns all Ventline runs and its board file. |
| `server/board.js` and `server/board-store.js` | Title-specific high score merge and ranking, then durable JSON storage. |
| `src/pages/Ventline.jsx` | Procedural drawing, pickup and effect HUD, input, and server-state rendering. It decides no physics, score, pickup, or collision. |

The match server uses loopback port **8089**, proxied at **`/ventline-ws`** by Vite and nginx. Clients offer WebSocket subprotocol **`ventline.v1`** and send plain JSON frames over the project's existing `ws://` lab setup. The dissector in `deploy/rivalblocks.lua` must recognize the new path and subprotocol. Keep `maxPayload: 4096` and `perMessageDeflate: false`; the path must not start with `/ws`.

The client sends a sanitized name and mode when joining, then flap and ready/retry intent. The server advances at a fixed 16 ms tick, generates a run seed, and sends snapshots containing authoritative drone positions, scores, shield and score-charge holdings, phase, the spectator target ID, and shutter and pickup descriptors covering at least one shutter behind and three ahead of the viewed drone. Live snapshots include each participant's stable ID, name, visual slot, alive/spectating state, and world position. The same snapshot supplies the main view, rival silhouettes, and rolling map; there is no separate map feed or client-side course generation. The rules module grants pickups and applies their effects; no pickup or score intent comes from clients. One process-level board writer handles completed solo runs and live rounds. Banking must be event-based or keyed by run ID: the existing `keeper` phase-edge helper cannot by itself distinguish several concurrent solo runs. A score is never accepted from a client payload.

No client-side simulation or prediction is introduced. The local drone is drawn from the newest received server position; rival silhouettes and their map markers may be interpolated between received snapshots without extrapolating beyond the latest position. A press can trigger an immediate thruster flash and sound, but cannot move the locally rendered drone before a server update. Responsiveness at the target lab latency is a playtest gate; tune flap strength, gate widths, and speed if it feels late.

## 6. High score board

Ventline writes **`board-ventline.json`**, with exactly one writer: the Ventline match process. The title board records each human name's best single-run score across solo and live, attempts, and live wins. Bots are not part of the initial design. The board sorts by best score descending, then live wins, then name for stable ties. It shows an integer **Best score** column, not a time value.

The existing cross-title leaderboard continues to rank its combined table by wins. Ventline's live wins contribute there; solo attempts add no wins. Ventline's best score remains filed under Ventline, as other title-specific bests do. Implement this as score-aware ranking for the Ventline title board without changing how existing titles rank. The title board retains the existing cap of 200 names and the established behavior for missing or damaged board files.

Names are the site's current identity model. This verifies the *score*, not ownership of a name: someone can enter another person's name. Accounts, authentication, and claims of tamper-proof player identity are outside this design.

## 7. Presentation and accessibility

The play view is a legible factory cutaway. The drone, shutter frames, bolts, hazard marks, powerups, and small thruster effects are drawn procedurally. The marketing catalog may use an optimized static cover image under `public/art/`, as the other games do. The service opening is visibly broad; the charged opening has a lightning glyph and a distinct narrow frame, so its meaning never depends on color alone. On pickup shutters, distinct shield and score symbols sit inside their respective openings; the symbols remain legible without color.

The HUD shows current score, personal best, clean-clear gate count, held shield and score-charge icons, and, in live play, a compact list of rival names and scores. Pickup, shield use, and score-charge use have brief distinct visual cues. In live play, surviving rivals appear at their authoritative course positions as translucent, slot-colored drone silhouettes with name tags, drawn behind the opaque local drone. During spectating, the followed drone becomes opaque and carries a VIEW label; the other surviving drones remain translucent. Their bodies can visually overlap but have no collision effect. Dead rivals fade from the course; spectators are not drawn as drones. Keep names readable when silhouettes cluster by shortening course tags to their slot symbols, with full names in the score list.

A compact rolling map sits at the top right of the game frame, with HUD space reserved so it does not cover the drone or shutter openings. It shows the full playable shaft height and a horizontal window with one shutter behind and the next three ahead of the viewed drone. Simplified bars show both openings and pickup symbols on pickup shutters. A solid, labeled marker identifies the local drone while alive or the followed drone while spectating; outlined, slot-marked markers identify the others; crashed players use a brief X marker before leaving the window. Overlapping markers are grouped with visible slot symbols. The map follows the local drone while alive, follows the selected surviving drone during live spectating, and freezes at the end of a run or round. Solo play shows the same map with only the local marker. The endless course has no full-run overview. The map stays in the top-right HUD area on mobile at a smaller size, with symbols legible without color.

Crash and result states are text as well as animation. Use the site's raw `:root` variables for canvas colors, offer a mute control, and keep decorative background motion subdued under reduced-motion settings. Touch input must not scroll the page while interacting with the play surface. The game remains operable with keyboard alone.

The game route is `/play/ventline`, with `ventline` as its catalog slug. The catalog entry, game detail copy, play index, leaderboard page, and deployment documentation are updated when the feature is implemented. Marketing copy keeps the site's terse, in-fiction tone and avoids em dashes.

## 8. Failure behavior

- A lost connection ends the current run. The server banks verified solo progress once; a disconnected live player remains in the round result but cannot win.
- A match server restart loses active in-memory runs, as with the existing games. Previously banked high scores remain on disk.
- A missing or damaged board file gives an empty board and does not prevent a match from starting.
- Duplicate flap, retry, or completion messages cannot award extra points or bank a run twice.
- A pickup is granted at most once per clean shutter clear. A shielded passage cannot grant a pickup or score. Repeated contacts with the protected shutter cannot consume another shield.
- A malformed or stale rival entry is ignored by presentation while valid local snapshots continue; it cannot change collision or scoring. If a rival leaves, its silhouette and map marker disappear.
- A spectator or player outside an active run cannot flap a drone into existence.

## 9. Verification and launch criteria

Automated rule tests cover flap cooldown and gravity, body-to-shutter contact, ceiling and floor contact, one score per clean clear, charged-opening detection, round winner and ties, and deterministic output for an injected seed. Powerup tests cover the fixed pickup schedule and route grant, effect caps, scoring before a new grant, one-use score charge, shielded shutter passage with zero score or pickup, score-charge retention through that passage, repeated protected contact, and fatal ceiling/floor contact despite a shield. Generator tests sample many fixed seeds and verify that each service opening remains reachable from both preceding openings under legal flap timing without requiring a powerup. Board tests cover maximum score retention, score-first Ventline ranking, solo versus live wins, malformed input, and one bank per run. Protocol tests cover join/retry states, late spectators, disconnects, stable player positions and slots in snapshots, the map's shutter window, spectator target selection, and payload limits.

Manual playtests cover desktop keyboard, click, and mobile touch; two browsers in one live round; simultaneous solo and live banking; readable service/charged choices and pickup symbols in both themes; shield and score-charge HUD feedback; and play feel with simulated latency on the target network. Check silhouette overlap, name and slot readability, map-to-course accuracy, marker overlap, spectator following, and top-right map placement in both themes and narrow mobile layouts. Measure typical run length and tune physics and gate spacing until ordinary attempts fall near the 30 to 90 second target. Build and bundle checks must still keep three.js out of the main chunk; Ventline itself needs no three.js.

## 10. Out of scope for the first release

No accounts, offline score submission, player attacks, body collisions, bots, moving shutters, additional powerup types, seasonal or daily boards, or purchased upgrades. These can be considered after the core score choice and networked input feel are proven in play.
