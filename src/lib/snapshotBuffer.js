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
 * One player may optionally be exempted from the replay delay via liveId. When
 * the camera is attached to a local body, holding it back makes the whole world
 * feel like it lags behind the mouse. Drawing that player at the newest position
 * the server has already sent eliminates this lag. It is still not prediction:
 * nothing simulates ahead of the server, the client merely declines to hold a
 * received position back by three frames.
 *
 * Only positions and heading are blended. Tiles, phase, the board and everything else come
 * from the newer frame untouched: a half-collapsed tile is not a thing, and a
 * blended leaderboard would be nonsense.
 *
 * `key` names the array of bodies inside a snapshot, because the two games that
 * use this buffer do not agree on the noun: Blockout 3D sends `players` and
 * Cutline sends `cars`. It is a parameter rather than a rename because each
 * game's snapshot should speak its own domain, and because a buffer that
 * silently found nothing under the wrong key returned an empty array rather
 * than an error. That is exactly how Cutline shipped rendering no cars at all.
 */
export function makeBuffer(delayMs, key = 'players') {
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

    sample(now, liveId = null) {
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

      const newest = frames[frames.length - 1]
      const livePlayer = liveId != null ? newest?.snap?.[key]?.find((p) => p.id === liveId) : null

      const was = new Map((older.snap[key] ?? []).map((p) => [p.id, p]))
      let liveIncluded = false
      const players = (newer.snap[key] ?? []).map((p) => {
        // The player this client is following is drawn where the server last
        // put them (the newest frame in the buffer), not three frames back.
        // With the camera attached to that body, holding it back is felt as
        // the whole world lagging the mouse. Still not prediction: this is a
        // position the server has already sent, just not delayed.
        if (p.id === liveId && livePlayer) {
          liveIncluded = true
          return livePlayer
        }
        const a = was.get(p.id)
        // Somebody who was not there a frame ago is drawn where they are.
        // Changing floors is taken whole rather than blended: a body halfway
        // through a slab is worse than a body that arrives a frame early.
        // Returned by reference, not copied — safe only because every
        // caller of sample() reads this player read-only.
        if (!a || a.z !== p.z) return p
        const blended = {
          ...p,
          x: a.x + (p.x - a.x) * alpha,
          y: a.y + (p.y - a.y) * alpha,
        }
        // Not every game has a third axis. Cutline's cars are flat and carry no
        // fall, and blending an absent field would write NaN into a snapshot
        // that nothing reads but everything passes along.
        if (Number.isFinite(a.fall) && Number.isFinite(p.fall)) {
          blended.fall = a.fall + (p.fall - a.fall) * alpha
        }
        // Cutline's cars face a heading. Taken from the newer frame alone it
        // stepped at the rhythm frames arrived, so a car behind a chase camera
        // twitched through corners. Blended the short way round, so a turn
        // through +/-PI does not spin the long way.
        if (Number.isFinite(a.heading) && Number.isFinite(p.heading)) {
          const d = Math.atan2(Math.sin(p.heading - a.heading), Math.cos(p.heading - a.heading))
          blended.heading = a.heading + d * alpha
        }
        return blended
      })
      if (livePlayer && !liveIncluded) {
        players.push(livePlayer)
      }

      return {
        ...newer.snap,
        [key]: players,
      }
    },
  }
}
