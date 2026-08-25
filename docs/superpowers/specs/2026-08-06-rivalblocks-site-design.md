# RivalBlocks Marketing Site — Design

**Date:** 2026-08-06
**Status:** Approved, ready for implementation planning

## Purpose

A marketing website for RivalBlocks, a game studio that develops multiplayer
block-based games and operates its own live-service game servers. The site
advertises the studio's three titles and uses the self-hosted server
infrastructure as its central differentiator.

The studio is fictional. The site never says so — it presents as a real studio
site throughout. No placeholder or lorem text ships.

**Audience:** competitive multiplayer players, teens to late twenties, who care
about ranked play, latency, tick rate, and server uptime.

**Voice:** confident and technical-adjacent. Server capability is a selling
point stated plainly, not a footnote.

## Success criteria

1. `npm run build` produces a `dist/` that works when served as static files.
2. All six routes render with real copy and no placeholder text.
3. `node --test src/lib/lib.test.js` passes.
4. Keyboard-only navigation reaches every interactive control, in visible focus.
5. No image files in the repository — all artwork is generated CSS/SVG.
6. Light and dark themes both render correctly, with no flash on first paint.

## Stack

Vite + React + React Router, Tailwind CSS v4. Static SPA output, no backend.

Complete dependency list — nothing beyond this without a stated reason:

| Package | Why |
|---|---|
| `react`, `react-dom` | UI |
| `react-router-dom` | 6 routes incl. one dynamic |
| `tailwindcss`, `@tailwindcss/vite` | styling |
| `vite` | build |

Tailwind v4 is CSS-first: theme tokens live in `src/index.css` under `@theme`.
There is no `tailwind.config.js`.

No state management library — no shared mutable state exists. No component
library — prebuilt kits make marketing sites look templated. No test framework
— Node's built-in runner covers the two pure functions worth testing.

### Environment note

Node 24.19.0 / npm 11.17.0 are installed at `C:\Program Files\nodejs` but are
not on the PATH of an already-running shell. Prepend
`C:\Program Files\nodejs` to `PATH` per command, or restart the shell.

## Content

### Games

Three titles. `Fracture Line` is the flagship and carries the homepage hero and
the deepest detail page; the other two provide catalog depth.

| Field | Fracture Line | Deepshaft | Blockout Royale |
|---|---|---|---|
| slug | `fracture-line` | `deepshaft` | `blockout-royale` |
| genre | 5v5 competitive block-destruction shooter | Co-op survival sandbox, 1–8 players | Round-based party brawler, 32 players |
| hook | Every wall is destructible and rebuildable mid-fight; you win on ground you carved yourself | A persistent voxel world that keeps simulating while you are offline | Four-minute rounds where the floor falls away beneath you |
| server angle | Ranked ladder, seasons, 128-tick regional servers | Always-on persistent worlds — the strongest proof of self-hosting | Instant matchmaking; the low-commitment funnel into the other two |
| status | Live — Season 4 | Live | Open Beta |
| platforms | PC, PS5, Xbox Series X\|S | PC, PS5, Xbox Series X\|S, Switch 2 | PC, iOS, Android |
| art variant | `arena` | `cavern` | `platforms` |

Each game additionally carries: a one-line tagline, three to four feature
blocks (title + short body), and four generated screenshots for the gallery.

### Server regions

Twelve regions in `src/data/servers.js`, each with `id`, `label`, `city`,
`status`, `players`, `tickRate`, `uptime`.

Ashburn, Portland, Dallas, Dublin, Frankfurt, Stockholm, Singapore, Tokyo,
Mumbai, Sydney, São Paulo, Cape Town.

Status values are `operational`, `degraded`, `maintenance`. At least one region
is `degraded` and one is `maintenance` so filtering has visible effect. Degraded
and maintenance regions carry a short incident note.

## Architecture

```
index.html · vite.config.js · package.json
src/
  main.jsx              mount + BrowserRouter
  App.jsx               route table
  index.css             @import tailwind + @theme tokens
  data/games.js         3 titles, all copy
  data/servers.js       12 regions
  lib/servers.js        filterSortRegions()   pure
  lib/validate.js       isValidEmail()        pure
  lib/lib.test.js       node --test
  components/
    Layout.jsx  Nav.jsx  Footer.jsx  ThemeToggle.jsx
    BlockArt.jsx  GameCard.jsx  StatusTable.jsx
    NewsletterForm.jsx  Lightbox.jsx
  pages/
    Home.jsx  Games.jsx  GameDetail.jsx
    Servers.jsx  About.jsx  NotFound.jsx
```

### Routes

| Path | Page |
|---|---|
| `/` | Home |
| `/games` | Games index |
| `/games/:slug` | GameDetail |
| `/servers` | Server status |
| `/about` | Studio |
| `*` | NotFound |

`GameDetail` resolves `:slug` against `data/games.js`. An unknown slug renders
NotFound rather than throwing.

### Unit boundaries

Each unit below has one purpose, a stated interface, and no hidden dependency
on any other.

- **`lib/servers.js`** — `filterSortRegions(regions, {status, sortBy})` returns
  a new filtered and sorted array. Pure, no React, no imports from `data/`.
  `sortBy` accepts `label`, `players`, `tickRate`, `uptime`.
- **`lib/validate.js`** — `isValidEmail(string)` returns boolean. Pure.
- **`lib/useTitle.js`** — `useTitle(string)` sets `document.title` for a route.
  An SPA does not update the title on navigation by itself, which costs both
  SEO and screen-reader page identity. Every page calls it.
- **`BlockArt.jsx`** — `<BlockArt seed variant className />` renders inline SVG
  isometric cube stacks from a small seeded PRNG. Deterministic: the same
  `seed` always produces the same scene. Variants: `arena`, `cavern`,
  `platforms`. This is the only source of artwork on the site; there are no
  image files.
- **`StatusTable.jsx`** — owns the filter and sort UI state, calls
  `filterSortRegions`, renders a real `<table>`. Receives regions as a prop.
- **`NewsletterForm.jsx`** — owns its own field and error state, calls
  `isValidEmail`, renders a fake success state. Submits nowhere.
- **`Lightbox.jsx`** — `<Lightbox items index onClose onNavigate />`. Presentation
  and focus management only; the parent owns which item is open.
- **`Layout.jsx`** — nav, skip link, `<main>`, footer, `<Outlet />`. Every page
  renders inside it.

### Data flow

Static imports only. Pages import from `data/`, pass data down as props to
components. Nothing fetches. Nothing writes anywhere except `ThemeToggle`,
which writes to `localStorage`.

## Design direction — Industrial Blueprint

Warm charcoal with a faint blueprint grid, safety-orange accent, structural
rules, hard corners, heavy uppercase display type. Chosen over a neon-esports
treatment because it makes the server-infrastructure story visual rather than
decorative, and reads as engineering instead of as a generic shooter site.

Server statistics are treated as design elements — tick rate, region count and
uptime appear in the homepage hero, not only on `/servers`.

### Theme tokens

Defined once in `src/index.css` under `@theme`.

| Token | Dark (default) | Light |
|---|---|---|
| `--color-ink` | `#16161a` background | text |
| `--color-steel` | `#2b2b31` rules, surfaces | `#ddd8cb` |
| `--color-bone` | `#ecebe6` text | background |
| `--color-flare` | `#ff6b1a` accent | `#ff6b1a` |
| `--color-live` | `#4ade80` operational | `#15803d` |

Amber and red for `degraded` and `maintenance` derive from the same scale.

The toggle sets `data-theme` on `<html>` and persists to `localStorage`. A
small inline script in `index.html` applies the stored or system value before
first paint, so the theme does not flash.

## Interactive features

All client-side. Nothing reaches a network.

1. **Newsletter signup** — real `<form>` with `<label>`, validation on submit
   via `isValidEmail`, errors in an `aria-live="polite"` region, fake success
   state. Does not send.
2. **Theme toggle** — described above.
3. **Server status filter/sort** — filter by status, sort by the four sortable
   columns.
4. **Screenshot gallery + lightbox** — grid of generated `BlockArt` scenes on
   each game detail page, opening into a lightbox.

## Accessibility and UX

Non-negotiable; these are not simplified away.

- Status is never communicated by colour alone. Every status dot is paired with
  a text label (WCAG 1.4.1).
- `#ff6b1a` on `#16161a` and `#16161a` on `#ff6b1a` both meet WCAG AA. Any new
  pairing is checked before use.
- One `<h1>` per page. Semantic `<nav>`, `<main>`, `<footer>`. A skip-to-content
  link is the first focusable element.
- Visible focus indicators on all interactive elements; the default outline is
  never removed without a stronger replacement.
- Lightbox traps focus, closes on Esc, supports arrow-key navigation, sets
  `role="dialog"` and `aria-modal="true"`, and returns focus to the thumbnail
  that opened it.
- `prefers-reduced-motion: reduce` disables transitions and animation.
- Mobile-first. Navigation collapses to a disclosure button below `md`, and the
  button reports state via `aria-expanded`.
- The server status table is a real `<table>` with `<th scope="col">`, wrapped
  in a horizontally scrollable container so the page body never scrolls
  sideways.

## Error handling

The site has no network and no user data, so the failure surface is small.

- Unknown `:slug` → NotFound page, not a crash.
- Invalid email → inline message in the live region; the form does not clear
  the field.
- Empty filter result → an explicit "no regions match" row, not a blank table.

## Testing

One file, `src/lib/lib.test.js`, run by Node's built-in test runner:

```
node --test src/lib/lib.test.js
```

Covers:

- `filterSortRegions` — filtering by each status, sorting by each key,
  empty result, and that the input array is not mutated.
- `isValidEmail` — accepts a normal address, rejects empty string, missing `@`,
  missing domain, and leading/trailing whitespace.

No test framework, no fixtures, no component tests. Presentational components
are verified by looking at them.

## Deliberate simplifications

Each is marked in code with a `ponytail:` comment naming the ceiling.

- Server data is a static array — `// ponytail: static mock, swap for a fetch
  when a real status API exists`.
- Newsletter submits nowhere — `// ponytail: no backend, POST to a real list
  endpoint when one exists`.
- Repeated marketing copy lives inline in page components rather than in a
  content layer. Extract only if a second locale is ever needed.

## Out of scope

Not built, and not scaffolded for: backend or database, real authentication,
a store or checkout, a blog or news feed, a CMS, internationalisation,
analytics, and a cookie banner (nothing is tracked, so none is required).
