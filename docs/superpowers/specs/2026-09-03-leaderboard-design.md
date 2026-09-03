# Cross-Game Leaderboard — Design

**Date:** 2026-09-03
**Status:** Approved, implementing
**Builds on:** `2026-08-06-blockout-royale-browser-trial-design.md`

## Purpose

One standing table of who has taken the most matches across all three games —
Blockout Royale, Fracture Line and Blastworks — that survives every process
restart and the site going down entirely.

It is written only when a match ends, read everywhere a game is presented, and
stored as plain files that a person can open in a text editor.

## What counts

**A match ending.** Not a round, not a disconnection.

| Game | A match ends when |
|---|---|
| Fracture Line | somebody reaches the kill target |
| Blastworks (last man) | somebody takes `ROUND_TARGET` rounds |
| Blastworks (deathmatch) | somebody reaches `KILL_TARGET` kills |
| Blockout Royale | somebody takes `ROUND_TARGET` rounds — **new**, see below |

Blockout Royale has no match today: it runs rounds forever. It gains
`ROUND_TARGET` and a `final` flag, mirroring Blastworks exactly, so all three
games agree on what "the game ended" means. The round winner keeps the victory
panel it already has; the match winner gets the same panel with different copy.

Every human who was in the match at the end contributes: `+1 match`, their
kills, their deaths, and `+1 win` for the winner. Bots contribute nothing and
never appear. A match against bots still counts for the person in it — refusing
those would leave the board empty in a lab, which is where this runs.

## Identity

**The name typed at the join screen, and nothing else.** No account, no key, no
PIN. Two people who both type `nic` are one row.

This is a deliberate limit, not an oversight. The board is a lab fixture on a
network where the game protocol is already deliberately readable in Wireshark;
a name is exactly as trustworthy as everything else on that wire. Anything
stronger belongs with TLS, in the same change.

## Storage

Four files, one per match server, each with exactly one writer:

```
board-blockout.json
board-fracture.json
board-blastworks-lastman.json
board-blastworks-deathmatch.json
```

One writer per file is the whole concurrency design. There is no lock, no
queue and no coordination, because no two processes ever write the same path.

```json
{
  "game": "blastworks",
  "mode": "lastman",
  "updated": 1756713600000,
  "players": [
    { "name": "nic", "wins": 3, "kills": 41, "deaths": 22, "matches": 7, "last": 1756713600000 }
  ]
}
```

`players` is an **array**, never an object keyed by name. Names arrive from a
join screen, and a board keyed by name would accept `__proto__` and
`constructor` as keys — the same prototype-pollution hole the direction lookup
in `game.js` is already written to avoid. An array cannot have it.

Capped at 200 names, lowest-ranked dropped first, so a public lab cannot grow
the file without bound.

### Durability

- **Write**: to a temp file in the same directory, then `rename`. A rename
  within one filesystem is atomic, so a crash mid-write can leave the old file
  or the new one, never half of either.
- **Read**: any failure at all — missing file, bad JSON, wrong shape — returns
  an empty board. A corrupt leaderboard must never stop a match server from
  starting or from running a match. Losing a board is a nuisance; losing the
  game server is an outage.
- Writes are synchronous. A match ends every few minutes and the file is a few
  kilobytes; a millisecond inside one tick, that rarely, is cheaper than the
  interleaving an async write would introduce.

## Code layout

Two new server files, following the split the repo already enforces.

| File | Owns | Must never contain |
|---|---|---|
| `server/board.js` | Merging and ranking | Node APIs, imports, any I/O |
| `server/board-store.js` | Reading and writing the files | Any ranking decision |
| `*-server.js` (existing) | Noticing a match ended | Any ranking decision |

`server/board.js` is pure in the same sense `game.js` is, and for the same
reason: it is where the tests live.

**The browser imports `server/board.js` as well.** The merge and sort rules
have one implementation, so the table a player sees on a game page can never
disagree with the one the server wrote. The file is plain ESM with no Node
APIs, so vite bundles it like any other module, and the deployed copy of
`server/` still travels as a self-contained unit — which the existing
`server/package.json` footgun makes worth protecting.

### Recording the result

The wrapper watches for the edge into a finished match and records once:

```js
if (over && final && !recorded) { record(); recorded = true }
if (!over) recorded = false
```

Wrapper-local. It adds no field to match state, and it cannot double-count a
match that sits in its `over` phase for several seconds.

## Getting it to a page

Two routes, both plain text on the wire.

**In a match**: each server keeps its own top five in `state.board` and the
existing snapshot carries it. No fetch, no second connection, updates the
instant a match ends, and it appears in a packet capture alongside everything
else. The rules module treats it as an opaque list — it makes no decision
about it, so this costs `game.js` and its siblings no purity.

**On a page**: `GET /board/<file>.json`.

- nginx serves the data directory with `alias` and `Cache-Control: no-cache`.
- vite dev-serves the same directory through a small `configureServer`
  middleware, so `npm run dev` behaves like the deployed site.
- A 404 is a normal empty board: a server that has never finished a match has
  no file yet. It is not an error and must not render as one.

The directory is `BOARD_DIR`, defaulting to `./data` beside the repo and set to
`/var/lib/rivalblocks/board` by the systemd units. The match servers run as
`www-data`, which is also the user nginx reads as.

## What the player sees

`src/components/Leaderboard.jsx`, one component with two shapes: the top five
by default, the full table when asked for it.

| Where | Shape | Source |
|---|---|---|
| Below the board, in all three games | Top 5 | the WS snapshot |
| Each game's page (`/games/:slug`) | Top 5 | fetched |
| The `/play` chooser | Top 5, combined | fetched |
| `/leaderboard` (new route) | Full table, per-game columns | fetched |

Rank is a number and the viewer's own row carries a glyph and `aria-current` —
never colour alone, per the site's standing WCAG 1.4.1 rule. The empty state
reads as a board nobody has reached yet, not as a placeholder: nothing on this
site describes itself as a demo.

## Testing

`server/board.test.js`, against the pure module:

- merging is additive, and a name the board has never seen appears
- the same match cannot be counted twice
- ranking orders by wins, then kills, then fewest deaths, then name
- bots are never recorded
- the 200-name cap drops the lowest-ranked, never the newest
- a player named `__proto__` or `constructor` corrupts nothing

Against the store:

- save then load round-trips
- a truncated or garbage file loads as an empty board rather than throwing
- a failed write leaves the previous file intact

Constants, never literals, as everywhere else in this repo's tests.

## Out of scope

- Any authentication. See Identity.
- Per-match history or replays. The board holds totals.
- Resetting or editing the board from `/admin`. The files are the interface;
  deleting one resets that game.
