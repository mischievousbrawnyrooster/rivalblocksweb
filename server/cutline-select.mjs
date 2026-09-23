// Offline circuit selection. Never imported by the game: it prints a CIRCUITS
// array to paste into cutline.js. Generating 400 circuits and picking the eight
// most unlike each other is what stops the shipped set being eight rolls of the
// same dice.
//
// Run: export PATH="/c/Program Files/nodejs:$PATH" && node server/cutline-select.mjs
import { measureCircuit } from './cutline.js'

const POOL = 400
const KEEP = 8

const NAMES = [
  'Foundry Loop', 'Coolant Bend', 'The Spindle', 'Slag Pit',
  'Draw Bench', 'Cinder Yard', 'Ladle Row', 'Tap Hole',
  'Blast Row', 'Skip Lane', 'Tundish Turn', 'Bloom Yard',
]

const rows = []
for (let seed = 1000; seed < 1000 + POOL; seed++) {
  try {
    rows.push({ seed, m: measureCircuit(seed) })
  } catch {
    // A seed that cannot be carved is simply not a candidate.
  }
}

// Normalise each axis so no one measurement dominates the distance.
const axes = ['lapLength', 'longestStraight', 'tightestCorner', 'directionChanges', 'chicanes', 'shortcuts', 'meanWidth']
const range = {}
for (const a of axes) {
  const vs = rows.map((r) => r.m[a])
  range[a] = { min: Math.min(...vs), max: Math.max(...vs) }
}
const vec = (m) => axes.map((a) => {
  const { min, max } = range[a]
  return max === min ? 0 : (m[a] - min) / (max - min)
})
const dist = (p, q) => Math.hypot(...p.map((v, i) => v - q[i]))

// Greedy farthest-point selection: start from the most extreme circuit, then
// repeatedly take whichever candidate is furthest from everything chosen.
const chosen = [rows.reduce((best, r) => (vec(r.m).reduce((a, b) => a + b, 0) > vec(best.m).reduce((a, b) => a + b, 0) ? r : best), rows[0])]
while (chosen.length < KEEP) {
  let best = null
  for (const r of rows) {
    if (chosen.includes(r)) continue
    const d = Math.min(...chosen.map((c) => dist(vec(r.m), vec(c.m))))
    if (!best || d > best.d) best = { r, d }
  }
  if (!best) break
  chosen.push(best.r)
}

console.log('export const CIRCUITS = [')
chosen.forEach((c, i) => {
  const m = c.m
  console.log(
    `  { name: '${NAMES[i]}', seed: ${c.seed} },` +
      `  // lap ${m.lapLength}, straight ${m.longestStraight}, tightest ${m.tightestCorner}, ` +
      `turns ${m.directionChanges}, chicanes ${m.chicanes}, shortcuts ${m.shortcuts}`,
  )
})
console.log(']')
