/**
 * Holds the last few snapshots and reads a body's position from between two of
 * them.
 *
 * This is interpolation, not prediction, and the difference is the whole reason
 * it is allowed here. It renders the recent past — a point between two frames
 * the server actually sent — so no client ever holds a state the server did not
 * author. Predicting your own input ahead of the server is what creates desync,
 * and nothing here does that.
 *
 * Only positions are blended. Tiles, phase, the board and everything else come
 * from the newer frame untouched: a half-collapsed tile is not a thing, and a
 * blended leaderboard would be nonsense.
 */
export function makeBuffer(delayMs) {
  const frames = []

  return {
    size: () => frames.length,

    push(snap, at) {
      frames.push({ snap, at })
      // At TICK_MS = 33, four frames is three intervals - about 99ms of
      // history - against a 100ms render delay. That is not a margin, it is a
      // coincidence: one late or jittered frame pushes sample() into its
      // oldest-frame clamp and produces exactly the stepping this buffer
      // exists to remove. Eight frames is ~231ms, comfortably bracketing the
      // delay, for about 8KB of snapshots. Anything older than that is
      // already behind the render clock and will never be read.
      while (frames.length > 8) frames.shift()
    },

    sample(now) {
      if (frames.length < 2) return null
      const t = now - delayMs

      let older = frames[0]
      let newer = frames[1]
      for (let i = 1; i < frames.length; i++) {
        if (frames[i].at <= t) {
          older = frames[i]
          newer = frames[Math.min(i + 1, frames.length - 1)]
        }
      }
      if (newer === older) newer = frames[frames.length - 1]

      const span = newer.at - older.at
      const alpha = span > 0 ? Math.max(0, Math.min(1, (t - older.at) / span)) : 1

      const was = new Map((older.snap.players ?? []).map((p) => [p.id, p]))
      return {
        ...newer.snap,
        players: (newer.snap.players ?? []).map((p) => {
          const a = was.get(p.id)
          // Somebody who was not there a frame ago is drawn where they are.
          // Changing floors is taken whole rather than blended: a body halfway
          // through a slab is worse than a body that arrives a frame early.
          if (!a || a.z !== p.z) return p
          return {
            ...p,
            x: a.x + (p.x - a.x) * alpha,
            y: a.y + (p.y - a.y) * alpha,
            fall: a.fall + (p.fall - a.fall) * alpha,
          }
        }),
      }
    },
  }
}
