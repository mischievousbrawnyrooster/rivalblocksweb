# RivalBlocks Web: Codex project context

## What this project is

RivalBlocks is a fictional multiplayer game studio site and a playable browser game collection in one React 19 / Vite 8 build. The marketing pages take their copy and catalog data from `src/data/`. Seven playable titles use eight separate Node.js WebSocket processes because Blastworks has two modes. The standing leaderboard is stored as eight JSON files, one writer per match process.

The project also serves a network lab. Game traffic is deliberately plain, uncompressed WebSocket JSON so it can be inspected in Wireshark on the trusted lab network. Preserve that behavior unless the deployment goal changes.

## Where to read next

- `CLAUDE.md` contains the detailed architecture, game-specific invariants, and reasons behind them. Read the relevant section before changing a game.
- `docs/superpowers/specs/` contains design decisions; `docs/superpowers/plans/` contains implementation history. Plans may show code from before later fixes, so check the current source and tests before reusing a snippet.
- `deploy/DEPLOY.md` covers nginx, the match services, and the leaderboard directory. `docs/Scenario 1.md` describes the network capture and lab topology; it includes sensitive captured data, so do not reproduce credentials in new documentation.
- `.agents/skills/` contains the project skill set. `.superpowers/` is ignored historical brainstorming and development session state, including review logs and a recovery backup. `.claude/settings.local.json` contains Claude tool permissions, not application configuration.
- `GEMINI.md` is a shorter orientation file, but some details are stale. For example, Blockout 3D currently has eight floors and the marketing site now uses cover images. Prefer current code and tests for values and behavior.

## Windows development commands

Node is installed at `C:\Program Files\nodejs` and may be absent from a fresh PowerShell `PATH`. Use `npm.cmd` to avoid PowerShell's script execution policy:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd run check:bundle  # run after build; keeps three.js out of the main chunk
```

`npm.cmd run dev` starts Vite on port 5173. Each play route also needs its own long-running match server. Restart that server after changing a file under `server/`; Vite reloads the frontend, but match servers do not reload themselves.

| Play route or mode | Command | Loopback port | WebSocket path |
| --- | --- | ---: | --- |
| Blockout Royale | `npm.cmd run game` | 8081 | `/ws` |
| Fracture Line | `npm.cmd run fracture` | 8082 | `/fracture-ws` |
| Blastworks, last man standing | `npm.cmd run blast` | 8083 | `/blast-ws` |
| Blastworks, deathmatch | `npm.cmd run blast:dm` | 8084 | `/blast-dm-ws` |
| Blockout Royale 3D | `npm.cmd run blockout3d` | 8085 | `/blockout3d-ws` |
| Void Drillers | `npm.cmd run drillers` | 8086 | `/voiddrillers-ws` |
| Cipher Run | `npm.cmd run cipher` | 8087 | `/cipherrun-ws` |
| Cutline | `npm.cmd run cutline` | 8088 | `/cutline-ws` |

Use `node --test --test-name-pattern="pattern" server/game.test.js` for a focused test. Use `node server/cutline-select.mjs` only when intentionally regenerating the measured Cutline circuit selection.

## Code boundaries

- `server/game.js`, `server/fracture.js`, `server/blastworks.js`, `server/blockout3d.js`, `server/voiddrillers.js`, `server/cipherrun.js`, and `server/cutline.js` own game rules and match state. Keep Node APIs, sockets, timers, and I/O out of these modules. Some import other pure local helpers.
- The corresponding `*-server.js` files (and `server/server.js` for Blockout Royale) own connection lifecycle, input parsing, and broadcasts. Keep game decisions in the rules modules.
- `server/board.js` owns pure leaderboard merge and ranking logic shared with the browser. `server/board-store.js` owns disk I/O. One match process writes each board file; a damaged board must not stop a match server.
- `src/pages/` owns rendering, input, and HUD. Clients send intent and render server-authored state. **Do not add client-side simulation or prediction.** Interpolation between two received snapshots is allowed; Cutline also smooths its camera using received poses.
- `src/lib/cutlineScene.js` owns Cutline's three.js scene. `raceCamera.js`, `wallBlocks.js`, and `carLift.js` hold pure, tested geometry and camera calculations. Blockout 3D's corresponding renderer is `towerScene.js`; its input mapping is in `followCamera.js`.
- `src/App.jsx` lazy-loads the two three.js routes. After a production build, `npm.cmd run check:bundle` must keep three.js out of the marketing site's main chunk.

## Invariants to preserve

- The server decides movement, hits, scoring, elimination, and winners. A client's snapshot may hold live state references, so serialize it synchronously in the same turn as the tick; do not retain it across an `await` or later tick.
- WebSocket paths in Vite, nginx, clients, and the Wireshark dissector in `deploy/rivalblocks.lua` move together. No path except `/ws` may start with `/ws`, because proxy prefix matching would route it to Blockout Royale. Keep each game's `Sec-WebSocket-Protocol` name aligned with the dissector.
- Preserve the 4096-byte WebSocket payload limit and uncompressed JSON frames. The deployed lab uses `ws://` on port 80 intentionally; do not silently switch protocol or compression.
- Keep `server/package.json` with the deployed `server/` directory. Its `"type": "module"` is required when that directory is copied without the root package file.
- Use `Object.hasOwn` for untrusted direction keys and arrays for player-name leaderboard entries. Bound names before character processing. Do not key an object by a user-supplied name.
- Keep game tests deterministic through injected random functions and references to exported constants. For game-specific constraints, read the matching section of `CLAUDE.md` and the current tests.
- Cutline steering is a car-relative rate, so camera changes never rotate input. Its game y axis maps to three.js `+z`; bumper camera position is locked. Blockout 3D does rotate movement by camera yaw in `followCamera.worldDir`.

## Visual and content rules

- Marketing covers in `public/art/` are image files; live game canvas and WebGL graphics are procedural. A renderer should not wait for an external image to draw its first frame.
- Status needs a shape, glyph, label, or other non-color cue. Player colors and hazard colors have separate tokens.
- Tailwind v4 theme values live in `src/index.css`; do not add `tailwind.config.js`. Canvas and WebGL code read raw `:root` variables such as `--bg` and `--player-1`, not the `--color-*` aliases.
- Treat the studio and games as real in site copy. Keep marketing copy terse and avoid em dashes there.

## Deployment shape

nginx serves `dist/`, proxies the eight WebSocket paths to loopback match servers, and serves `/board/` directly from `BOARD_DIR`. The board files are runtime data under `data/` in development and `/var/lib/rivalblocks/board` on the VM. `deploy/DEPLOY.md` is the deployment runbook.
