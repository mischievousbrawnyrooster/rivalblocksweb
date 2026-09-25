# Ventline: Game Design

*2026-09-25. Draft for player review before implementation planning.*

## 1. Purpose and pitch

**Ventline** is a short, repeatable, one-button flight game for RivalBlocks. A maintenance drone crosses the block-built ventilation works while shutters keep closing off the route. Each barrier offers a wide service opening and a narrow charged opening. Both keep the drone alive; the charged opening earns an extra point.

The game adds a fast score chase to a site whose current titles are longer matches. A visitor can start alone, retry immediately, and chase an all-time high score, or join a simultaneous race against other players. The controls and scoring are identical in both modes. A typical attempt should end from a collision after roughly 30 to 90 seconds, but neither mode has a time limit. Skilled runs can continue indefinitely.

Working marketing line: *Every gap is a choice.* Genre line: *One-button drone flight, solo or up to eight.* The name and copy are in fiction; game artwork uses an original maintenance drone and factory shutters.

## 2. Decisions made with the player

- Solo runs and live races both exist.
- Live players fly the same course at the same time, without attacks or body collisions.
- Each shutter has a wide safe opening and a narrow bonus opening. Passing either is valid.
- The course layout changes each run, within the same difficulty schedule. Everyone in one live round receives the same layout.
- Solo and live scores feed one persistent all-time high score board, using the site's existing player names without accounts.
- Both modes continue until the drone crashes. A live round ends when every participating drone has crashed.
- The look is an industrial drone in a block-built facility. **Ventline** is the chosen working title.

## 3. Flight and shutters

The game is side-on. The drone advances horizontally at the course's scrolling speed. A press gives it one upward impulse; gravity draws it down between presses. Holding the key does not create repeated thrust. Desktop controls are Space or click; touch input works inside the play area. The browser sends flap intent on the press edge rather than keyboard repeat, and the server ignores flap requests that arrive too close together. A flap sets vertical velocity rather than adding an unlimited impulse, so rapid input cannot make the drone climb without control.

The drone crashes if its body touches a shutter, ceiling, or floor. A crash ends that player's run immediately. There are no lives, mid-run respawns, or damage states. A solo player can begin a new run from the results screen without returning to a lobby.

Each shutter has two visibly separate openings:

| Opening | Shape | Points on clearing the barrier |
| --- | --- | ---: |
| Service | Broad, clearly framed | 1 |
| Charged | Narrow, marked with a lightning glyph and tighter frame | 2 |

The score is awarded once, only after the drone's full body clears a barrier without collision. The second point is awarded only if it passed through the charged opening. Distance and time do not award points, and no client message can award a score. A run's score is its total points when it ends. The live winner is the player with the most points, so a risky route can beat a longer safe run.

Shutter spacing, service-opening width, drone size, and maximum speed are tuned together. The course generator must keep a reachable service opening after either opening of the preceding barrier; a player must never be forced into an impossible next move for taking the charged route. The charged opening remains optional and harder. Difficulty rises with barrier index through a fixed, bounded schedule, then plateaus at a difficult but physically possible setting. The seed changes opening positions, not the difficulty budget at a given barrier index. No moving shutters or extra hazards are needed for the first version.

## 4. Solo and live rounds

**Solo:** the match server creates a private run with a new seed. The player can retry immediately after crashing. A deliberate restart or disconnect ends the current attempt and banks only the score already verified by the server. Solo attempts count as attempts on the title board, but never as live wins.

**Live:** two to eight ready players start after a short shared countdown. The server creates one seeded shutter sequence and independent drone state for each player. All start at the same position and follow the same scroll and difficulty schedule. Late arrivals spectate until the next round. A crashed player can watch the remaining players or leave to start a solo run. A player who disconnects is marked crashed and cannot receive a live win from that round.

The live round ends when every player has crashed or disconnected. Highest score among players who stayed connected wins. Ties are broken by barriers cleared, then distance travelled; exact ties share the win. If everyone disconnects, there is no winner. The server banks each live participant's score and win result once at round end, then returns to the lobby. A round has no clock cap; a player who stops sending input falls and crashes under normal physics.

Solo and live each generate new layouts, but generation obeys the same widths, spacing, speed, and reachability rules. Live racers see precisely the same layout within their round. This makes scores comparable enough for one arcade board while keeping retries varied; it does not claim every randomly positioned course is identical in difficulty.

## 5. Server authority and data flow

The design follows the existing game split:

| Unit | Responsibility |
| --- | --- |
| `server/ventline.js` | Pure state transitions, fixed-step drone physics, deterministic shutter generation, collision, scoring, and round outcome. No Node APIs, sockets, timers, or I/O. |
| `server/ventline-server.js` | WebSocket lifecycle, solo run instances, live lobby, input validation, snapshots, and score banking. One process owns all Ventline runs and its board file. |
| `server/board.js` and `server/board-store.js` | Title-specific high score merge and ranking, then durable JSON storage. |
| `src/pages/Ventline.jsx` | Procedural drawing, HUD, input, and server-state rendering. It decides no physics, score, or collision. |

The match server uses loopback port **8089**, proxied at **`/ventline-ws`** by Vite and nginx. Clients offer WebSocket subprotocol **`ventline.v1`** and send plain JSON frames over the project's existing `ws://` lab setup. The dissector in `deploy/rivalblocks.lua` must recognize the new path and subprotocol. Keep `maxPayload: 4096` and `perMessageDeflate: false`; the path must not start with `/ws`.

The client sends a sanitized name and mode when joining, then flap and ready/retry intent. The server advances at a fixed 16 ms tick, generates a run seed, and sends snapshots containing authoritative drone positions, scores, phase, and a small visible window of shutter descriptors. One process-level board writer handles completed solo runs and live rounds. Banking must be event-based or keyed by run ID: the existing `keeper` phase-edge helper cannot by itself distinguish several concurrent solo runs. A score is never accepted from a client payload.

No client-side simulation or prediction is introduced. The local drone is drawn from the newest received server position; rivals may be interpolated between received snapshots. A press can trigger an immediate thruster flash and sound, but cannot move the locally rendered drone before a server update. Responsiveness at the target lab latency is a playtest gate; tune flap strength, gate widths, and speed if it feels late.

## 6. High score board

Ventline writes **`board-ventline.json`**, with exactly one writer: the Ventline match process. The title board records each human name's best single-run score across solo and live, attempts, and live wins. Bots are not part of the initial design. The board sorts by best score descending, then live wins, then name for stable ties. It shows an integer **Best score** column, not a time value.

The existing cross-title leaderboard continues to rank its combined table by wins. Ventline's live wins contribute there; solo attempts add no wins. Ventline's best score remains filed under Ventline, as other title-specific bests do. Implement this as score-aware ranking for the Ventline title board without changing how existing titles rank. The title board retains the existing cap of 200 names and the established behavior for missing or damaged board files.

Names are the site's current identity model. This verifies the *score*, not ownership of a name: someone can enter another person's name. Accounts, authentication, and claims of tamper-proof player identity are outside this design.

## 7. Presentation and accessibility

The play view is a legible factory cutaway. The drone, shutter frames, bolts, hazard marks, and small thruster effects are drawn procedurally. The marketing catalog may use an optimized static cover image under `public/art/`, as the other games do. The service opening is visibly broad; the charged opening has a lightning glyph and a distinct narrow frame, so its meaning never depends on color alone.

The HUD shows current score, personal best, gate count, and, in live play, a compact list of rival names and scores. The local course stays full size; other drones do not overlap the player's path. Crash and result states are text as well as animation. Use the site's raw `:root` variables for canvas colors, offer a mute control, and keep decorative background motion subdued under reduced-motion settings. Touch input must not scroll the page while interacting with the play surface. The game remains operable with keyboard alone.

The game route is `/play/ventline`, with `ventline` as its catalog slug. The catalog entry, game detail copy, play index, leaderboard page, and deployment documentation are updated when the feature is implemented. Marketing copy keeps the site's terse, in-fiction tone and avoids em dashes.

## 8. Failure behavior

- A lost connection ends the current run. The server banks verified solo progress once; a disconnected live player remains in the round result but cannot win.
- A match server restart loses active in-memory runs, as with the existing games. Previously banked high scores remain on disk.
- A missing or damaged board file gives an empty board and does not prevent a match from starting.
- Duplicate flap, retry, or completion messages cannot award extra points or bank a run twice.
- A spectator or player outside an active run cannot flap a drone into existence.

## 9. Verification and launch criteria

Automated rule tests cover flap cooldown and gravity, body-to-shutter contact, ceiling and floor contact, one score per cleared barrier, charged-opening detection, round winner and ties, and deterministic output for an injected seed. Generator tests sample many fixed seeds and verify that each service opening remains reachable from both preceding openings under legal flap timing. Board tests cover maximum score retention, score-first Ventline ranking, solo versus live wins, malformed input, and one bank per run. Protocol tests cover join/retry states, late spectators, disconnects, and payload limits.

Manual playtests cover desktop keyboard, click, and mobile touch; two browsers in one live round; simultaneous solo and live banking; readable service/charged choices in both themes; and play feel with simulated latency on the target network. Measure typical run length and tune physics and gate spacing until ordinary attempts fall near the 30 to 90 second target. Build and bundle checks must still keep three.js out of the main chunk; Ventline itself needs no three.js.

## 10. Out of scope for the first release

No accounts, offline score submission, player attacks, body collisions, bots, moving shutters, powerups, seasonal or daily boards, or purchased upgrades. These can be considered after the core score choice and networked input feel are proven in play.
