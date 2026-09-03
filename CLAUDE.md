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

1. A **static marketing SPA** for a fictional game studio. `src/data/games.js` and `src/data/servers.js` are the CMS — all copy lives there. It fetches exactly one thing: `/board/*.json`, the standing leaderboard, which is four plain files written by the match servers and served straight off disk.
2. A **playable multiplayer game** at `/play`, the only part that touches a network.

## Game architecture

Three layers with a deliberate, enforced split:

| File | Owns | Must never contain |
|---|---|---|
| `server/game.js` | Every rule and all match state | Sockets, Node APIs, *any* import |
| `server/server.js` | Connection lifecycle, message parsing, broadcast | Any game decision |
| `server/board.js` | Leaderboard merging and ranking | Node APIs, imports, I/O, a clock |
| `server/board-store.js` | Reading and writing the four board files | Any ranking decision |
| `src/pages/Play.jsx` | Rendering and input | Simulation, prediction, rule checks |

`game.js` has zero imports on purpose — that purity is why all ~60 tests live against it and why `server.js` and `Play.jsx` have none. Put new logic there, not in the socket wrapper.

**The server is authoritative for everything**: move legality, elimination, who won. The client sends `{t:'join'|'move'|'use'}` and renders the `{t:'state'}` snapshot it receives at 10 Hz. There is no client-side prediction or interpolation, so that entire class of desync bug does not exist. Keep it that way.

**Full state every tick, never diffs.** `snapshot()` returns `state.tiles` **by live reference**, not a copy. That is only safe because `server.js` calls `JSON.stringify(snapshot(match))` synchronously in the same turn as `tick()`. Never retain a snapshot across an await, a timer, or a later tick, and never stash them for diffing.

## The leaderboard

Four files, one per match server, each with **exactly one writer**. That is the
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
  victory screen, not the board.

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

## Design rules inherited from the site

These are non-negotiable and predate the game:

- **No image files.** All artwork is generated CSS or inline SVG (`BlockArt.jsx`).
- **Status is never communicated by colour alone** (WCAG 1.4.1). Warning tiles carry a glyph, holes differ structurally from solid tiles, players carry their initial.
- **Player colour tokens (`--player-1..8`) are separate from status tokens** so a piece can never wear a tile's colour. Never reuse `--warn` for a player.
- **Only existing `@theme` tokens** from `src/index.css`. No new tokens without reason, no `tailwind.config.js` (Tailwind v4 is CSS-first).
- **In-fiction copy.** The studio is fictional; the site never says so. Nothing may read as a demo, mock, test, or placeholder.

## Deployment

Single node, two tiers: nginx serves `dist/` and proxies four WebSocket paths to four Node processes on loopback, all four from one systemd template unit (`rivalblocks@<instance>`). nginx also serves `/board/` straight from `BOARD_DIR`. Full sequence in `deploy/DEPLOY.md`.

**No proxy path but `/ws` itself may begin with `/ws`.** nginx and vite both match by prefix, so `/ws-fracture` is silently swallowed by the Blockout rule and connects the player to the wrong game.

Traffic is plain `ws://` on port 80 with no TLS. **This is deliberate** — the game protocol is meant to be readable in Wireshark on the lab network. `ws` leaves `perMessageDeflate` off by default, which is what keeps frames as uncompressed JSON; do not enable it. Add TLS before this is exposed beyond a trusted segment.

## Docs

`docs/superpowers/specs/` holds design docs, `docs/superpowers/plans/` the implementation plan. The plan carries a "Post-implementation corrections" note at the top — its code blocks show pre-fix versions and should not be replayed verbatim.
