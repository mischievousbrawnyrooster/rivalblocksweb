# Blockout Royale — Browser Trial — Design

**Date:** 2026-08-06
**Status:** Approved, ready for implementation planning
**Builds on:** `2026-08-06-rivalblocks-site-design.md`

## Purpose

Add a playable multiplayer game to the RivalBlocks site at `/play`: a browser
version of **Blockout Royale**, the studio's round-based party brawler.

Two to four players on separate machines share one live match over the lab
network. This is the first thing on the site that touches a network at all —
the marketing site is entirely static and fetches nothing.

The game presents in-fiction, as a real browser trial of a real title. Nothing
on the page describes it as a demo, a test, or an exercise.

### Why this title

Blockout Royale is already specified in `src/data/games.js` as "thirty-two
players on a shrinking platform grid; blocks fall away under your feet on a
timer you can hear coming." A grid of tiles that disappear is a game that a
browser can render with `<div>`s and a server can simulate in a hundred lines.
The other two titles would need aiming and projectiles, or terrain and
persistence.

The player count drops from thirty-two to four. Nothing else about the fiction
changes.

## Success criteria

1. Two browsers on different machines join one match and see each other move.
2. A player standing on a tile that falls away is eliminated; the last player
   standing is declared the winner; a new round then starts.
3. `npm test` passes, including the new server tests.
4. `npm run build` still produces a working static `dist/`.
5. Wireshark on the lab network shows the game's JSON messages in cleartext
   without any decryption step.
6. The page is keyboard-navigable, works on a phone, and respects the site's
   existing light/dark themes and reduced-motion rule.

## Network posture

Traffic is plain `ws://` over port 80, unencrypted. This is deliberate and
matches the site's existing deployment, which DEPLOY.md already documents as
plain HTTP on a trusted internal network.

Anyone running Wireshark on that network sees player names, every move, and
the full board state as readable JSON. There is nothing secret in the protocol
— no credentials, no tokens, no personal data — so cleartext costs nothing
here. Adding TLS is the first thing to do if this is ever exposed beyond the
lab.

## Stack

One new dependency:

| Package | Why |
|---|---|
| `ws` | WebSocket server. Zero transitive dependencies, pure JavaScript. |

`ws` is a runtime dependency of the game server only. Nothing under `src/`
imports it, so Vite never bundles it and `dist/` is unaffected.

The alternative considered was server-sent events plus `fetch` POSTs, which
needs no dependency at all. Rejected: it costs an HTTP request per keypress,
two connections per client, and an `proxy_buffering off` line in nginx that
breaks the game in production but not in development if forgotten. One
zero-dependency package is the cheaper trade.

WebRTC was rejected outright — its data channels are DTLS-encrypted, which
would defeat criterion 5.

## Architecture

```
server/
  game.js         pure rules — no network, no Node APIs, no imports
  server.js       ws wiring — connections, input, broadcast, lifecycle
  game.test.js    node --test
src/
  pages/Play.jsx  the whole client — socket, keyboard, grid render
```

Modified: `src/App.jsx` (route), `src/components/Nav.jsx` (link),
`src/pages/GameDetail.jsx` (CTA on `blockout-royale` only),
`vite.config.js` (dev proxy), `package.json` (dep + test script),
`deploy/nginx.conf`, `deploy/DEPLOY.md`.

### Unit boundaries

- **`server/game.js`** — owns all rules and all state for one match. Exports a
  small set of pure-ish functions over a plain state object: create a match,
  add and remove a player, apply a move, advance one tick. Knows nothing about
  sockets, JSON, or Node. This is the only file with tests, and it is split
  from `server.js` for exactly that reason.
- **`server/server.js`** — owns the socket. Accepts connections, parses and
  validates incoming messages, calls into `game.js`, broadcasts state on a
  timer. Contains no rules.
- **`src/pages/Play.jsx`** — owns the connection and the rendering. Holds
  server state in one `useState`, sends key presses, renders the grid. Split
  it only if it passes roughly 250 lines.

Server is authoritative for everything. The client simulates nothing, predicts
nothing, and interpolates nothing — that entire class of desync bug does not
exist here.

## Rules

A 9×9 grid of tiles. Each tile is `solid`, `warning`, or `gone`.

**Movement.** Arrow keys or WASD move one tile per press. The server rejects a
move that leaves the grid, enters a `gone` tile, or enters a tile another
player occupies, and enforces a minimum interval between accepted moves so a
modified client cannot teleport. Rejected moves are silently ignored — the
player simply does not move.

Because you cannot walk into a hole, elimination has exactly one cause: the
tile beneath you falls away.

**Collapse.** On a repeating interval the server marks a few `solid` tiles as
`warning`. After a fixed delay each `warning` tile becomes `gone`, and any
player standing on it is eliminated.

**Tuning.** Grid size, tick rate, move interval, collapse interval, tiles per
collapse, and warning delay are named constants at the top of `game.js`. The
collapse rate decides whether a round feels tense or tedious, and no amount of
reasoning settles it — it gets tuned by playing the game.

### Match lifecycle

| Phase | Meaning | Leaves when |
|---|---|---|
| `waiting` | Fewer than two players joined | A second player joins |
| `countdown` | Brief pause before the round | Countdown elapses |
| `playing` | Tiles collapsing, players moving | One or zero players remain |
| `over` | Winner shown | Short delay elapses, then a fresh round |

Minimum two players, maximum four. A fifth connection joins as a spectator: it
receives the same state broadcasts and renders the same board, but has no
piece and cannot move. This costs no extra code — a spectator is a connection
that was never added to the player list — and is a better outcome than
refusing the connection. When a round ends, spectators are promoted into the
next round in arrival order, up to the cap.

## Protocol

JSON text frames over `ws://<host>/ws`.

Client to server:

```json
{"t":"join","name":"jiaqi"}
{"t":"move","dir":"up"}
```

Server to client:

```json
{"t":"welcome","id":2,"size":9}
{"t":"state","phase":"playing","tiles":[...],"players":[...],"winner":null}
```

`tiles` is a flat array of tile states, row-major. `players` carries id, name,
position, and alive flag for each.

The server broadcasts complete state every tick rather than diffs. At 81 tiles
and at most four players this is a small object, and full snapshots mean a
client never needs to have seen earlier messages to render correctly. It also
means anyone following the stream reads the whole game rather than a sequence
of deltas.

`// ponytail: full-state broadcast every tick; delta-encode only if the grid
ever exceeds ~400 tiles`

## Client

The board is a CSS Grid of `<div>`s, one per tile, styled with the existing
Industrial Blueprint theme tokens. No canvas, and no image files — consistent
with the site's existing rule that all artwork is generated CSS and SVG.

The page asks for a name, connects, and then renders whatever the server sends.

**Accessibility**, held to the same standard as the rest of the site:

- Warning tiles carry a visible glyph, not only a colour change. Status is
  never communicated by colour alone.
- An `aria-live="polite"` region announces phase changes, eliminations, and
  the winner, so the match is followable without watching the grid.
- Four labelled `<button>` arrows sit below the board. They make the game
  playable on a phone, which the site's mobile-first rule requires, and give
  keyboard and screen-reader users a real control surface alongside the raw
  key handler.
- Arrow keys are prevented from scrolling the page while the board has focus.
- Under `prefers-reduced-motion: reduce`, tile transitions are dropped.

## Error handling

- Socket closes → the page shows a disconnected state with a Reconnect button.
  No automatic retry loop. `// ponytail: manual reconnect; add backoff retry
  if the link proves flaky`
- Malformed JSON or an unknown message type is ignored, not thrown on. One bad
  client must not take the match down.
- Names are trimmed and capped at 16 characters. React escapes them on render,
  so length is the only thing worth enforcing.
- A player who disconnects mid-round is removed from the board. If that leaves
  one player, they win. If it leaves fewer than two connected, the phase
  returns to `waiting`.
- The client renders a legible state for every phase, including `waiting` with
  one player and spectating a full match.

## Testing

`server/game.test.js`, run by Node's built-in runner alongside the existing
library tests:

```
node --test src/lib/lib.test.js server/game.test.js
```

Covers: a move off the grid, into a `gone` tile, and onto an occupied tile are
all rejected; the move interval is enforced; a player on a tile that collapses
is eliminated; the match ends with a winner when one player remains; joining
is capped at four players and the fifth becomes a spectator.

No framework, no fixtures, no component tests. `server.js` and `Play.jsx` are
verified by playing the game — which is also the only way to tune the collapse
rate.

## Deployment

The VM gains Node and one long-running process. nginx keeps serving the site
exactly as it does today.

- **nginx** — a `location /ws` block proxying to `127.0.0.1:8081` with the
  `Upgrade` and `Connection` headers a WebSocket needs. nginx matches the
  longest prefix rather than the first, so `/ws` beats `/` wherever it sits in
  the file; it goes next to the other specific locations for readability.
- **The server** — binds `127.0.0.1:8081`, so only nginx reaches it directly.
  Players connect to port 80 and nginx proxies. Runs under a systemd unit so
  it survives a reboot and a closed terminal.
- **Getting it onto the VM** — `server/` and `node_modules/ws` copy across the
  existing VMware shared folder, the same way `dist/` already does. `ws` is
  pure JavaScript with no native build step and no transitive dependencies, so
  a folder copy is a complete install. The VM therefore needs `nodejs` and not
  `npm`, and needs no internet access.
- **The client's URL** is derived from `location.host`, so the same build works
  on any VM address without configuration.
- **Development** — `vite.config.js` proxies `/ws` to `localhost:8081` with
  WebSocket support, so `npm run dev` behaves the same as production.

DEPLOY.md gains a section covering all of the above.

## Out of scope

Not built, and not scaffolded for: accounts or authentication, persistence,
leaderboards or stats, chat, reconnecting into a round in progress,
concurrent matches or room codes, spectator camera controls, and TLS.

No abstraction over the transport, because there is one transport. No room
registry, because there is one room. No state management library, because one
`useState` holds the server's snapshot.
