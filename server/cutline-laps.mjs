// Offline lap timing. Never imported by the game: it runs 4 bots on every
// circuit with a fixed rng and prints each circuit's median lap, so a handling
// or bot change is judged by measurement rather than by feel alone.
//
// Run: export PATH="/c/Program Files/nodejs:$PATH" && node server/cutline-laps.mjs
import { CIRCUITS, BOT_NAMES, make, join, startRace, tick, TICK_MS } from './cutline.js'

const RUN_MS = 90000
const BOTS = 4
const all = []

for (let i = 0; i < CIRCUITS.length; i++) {
  const match = make({ circuitIndex: i })
  for (let b = 0; b < BOTS; b++) join(match, { name: BOT_NAMES[b], bot: true }, () => 0.5)
  startRace(match)

  const laps = []
  const seen = new Map()
  for (let t = 0; t < RUN_MS && match.phase === 'racing'; t += TICK_MS) {
    tick(match, TICK_MS, () => 0.5)
    for (const car of match.cars.values()) {
      const at = seen.get(car.id) ?? { lap: 0, since: 0 }
      if (car.lap > at.lap) {
        // The roll off the grid is not a lap.
        if (at.lap > 0) laps.push(match.elapsed - at.since)
        seen.set(car.id, { lap: car.lap, since: match.elapsed })
      } else {
        seen.set(car.id, at)
      }
    }
  }

  laps.sort((a, b) => a - b)
  all.push(...laps)
  const s = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(2) : '  -  ')
  console.log(`${CIRCUITS[i].name.padEnd(13)} laps ${String(laps.length).padStart(2)}  median ${s(laps[Math.floor(laps.length / 2)])}s  range ${s(laps[0])}-${s(laps.at(-1))}s`)
}

all.sort((a, b) => a - b)
console.log(`ALL median ${(all[Math.floor(all.length / 2)] / 1000).toFixed(2)}s over ${all.length} laps`)
