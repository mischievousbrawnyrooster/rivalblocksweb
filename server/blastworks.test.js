import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMatch,
  addPlayer,
  removePlayer,
  wantBots,
  detonateAll,
  setInput,
  drop,
  handle,
  startMatch,
  startRound,
  tick,
  snapshot,
  W,
  H,
  TICK_MS,
  RADIUS,
  EMPTY,
  SOFT,
  HARD,
  ARENAS,
  SPAWNS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  BOMB_FUSE_MS,
  BLAST_MS,
  RANGE_START,
  RANGE_MAX,
  SQUARE_RANGE_MAX,
  BOMBS_START,
  BOMBS_MAX,
  CHAIN_STAGGER_MS,
  ROUND_TARGET,
  MODES,
  KILL_TARGET,
  RESPAWN_MS,
  COUNTDOWN_MS,
  OVER_MS,
  SPEED_TIERS,
  PICKUP_KINDS,
  THROW_TILES,
  SOFT_DENSITY,
  REGROW_EVERY_MS,
  BOT_REACT_MS,
  SUDDEN_DEATH_MS,
  SQUEEZE_EVERY_MS,
  SQUEEZE_ORDER,
} from './blastworks.js'

const cell = (x, y) => y * W + x

/** The bomb in a player's hands, if any. */
const heldBy = (m, p) => m.bombs.find((b) => b.carriedBy === p.id)

/** The bomb lying on a tile, ignoring any that is airborne or in hand. */
const bombAt = (m, x, y) =>
  m.bombs.find((b) => !b.air && !b.carriedBy && Math.floor(b.x) === x && Math.floor(b.y) === y)

/**
 * A match in progress with `n` people and no bots, on a fixed arena. Pickups
 * and regrowth are frozen off so neither wanders into a test about something
 * else; tests that want them turn them back on.
 */
function playing(n = 2) {
  const m = createMatch(() => 0, 'foundry')
  const players = []
  for (let i = 0; i < n; i++) players.push(addPlayer(m, `p${i}`))
  m.botFill = 0
  startRound(m, () => 0, 'foundry')
  m.nextPickupAt = Infinity
  m.nextRegrowAt = Infinity
  return { m, players }
}

/** Takes a player out of the round without involving a blast. */
function sitOut(p) {
  p.alive = false
  p.inRound = false
}

/**
 * Stands a player in the far corner, alive and doing nothing. One life means a
 * round ends the moment one player is left, so a test that wants a quiet board
 * still needs somebody else upright or the tick stops on the spot.
 */
function park(m, p) {
  p.x = W - 2.5
  p.y = H - 2.5
  p.alive = true
  p.inRound = true
  p.input = { dx: 0, dy: 0, bomb: false }
  for (let y = H - 4; y < H - 1; y++) {
    for (let x = W - 4; x < W - 1; x++) if (m.tiles[cell(x, y)] === SOFT) m.tiles[cell(x, y)] = EMPTY
  }
}

/** Empties every tile except the outer ring, so a test controls the board. */
function clearField(m) {
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) m.tiles[cell(x, y)] = EMPTY
  }
}

/** Stands a player dead centre on a tile. */
function stand(p, x, y) {
  p.x = x + 0.5
  p.y = y + 0.5
}

// --- arena ---------------------------------------------------------------

test('the grid is odd on both axes, or the pillar lattice has no outer ring', () => {
  assert.equal(W % 2, 1)
  assert.equal(H % 2, 1)
})

test('a new match is already walled in and ready to look at', () => {
  const m = createMatch(() => 0.5, 'foundry')
  assert.equal(m.phase, 'waiting')
  assert.equal(m.tiles.length, W * H)
  assert.ok(m.tiles.some((t) => t === SOFT), 'nothing to blast through')
  assert.ok(m.tiles.some((t) => t === HARD), 'no lattice')
  assert.deepEqual(m.players, [])
})

test('the outer ring and the even lattice are hard, and never breakable', () => {
  const m = createMatch(() => 0.5, 'foundry')
  for (let x = 0; x < W; x++) {
    assert.equal(m.tiles[cell(x, 0)], HARD)
    assert.equal(m.tiles[cell(x, H - 1)], HARD)
  }
  for (let y = 0; y < H; y++) {
    assert.equal(m.tiles[cell(0, y)], HARD)
    assert.equal(m.tiles[cell(W - 1, y)], HARD)
  }
  for (let y = 2; y < H - 1; y += 2) {
    for (let x = 2; x < W - 1; x += 2) {
      assert.equal(m.tiles[cell(x, y)], HARD, `lattice post missing at ${x},${y}`)
    }
  }
})

test('every arena leaves each spawn a pocket to open in', () => {
  for (const arena of ARENAS) {
    for (let seed = 1; seed <= 8; seed++) {
      let n = seed
      const rng = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648)
      const m = createMatch(rng, arena)
      for (const [sx, sy] of SPAWNS) {
        assert.equal(m.tiles[cell(sx, sy)], EMPTY, `${arena}/${seed}: spawn ${sx},${sy} is filled`)
        const out = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].filter(([dx, dy]) => m.tiles[cell(sx + dx, sy + dy)] === EMPTY)
        assert.ok(out.length >= 1, `${arena}/${seed}: spawn ${sx},${sy} has no way out`)
      }
    }
  }
})

test('a bomb laid on any spawn always leaves somewhere to run', () => {
  // A pocket you cannot bomb your way out of is a pocket you are stuck in, and
  // it deadlocks a bot outright. Checked on every layout and seed, because the
  // fill is random and this is the property that has to survive it.
  const arms = (m, sx, sy) => {
    const hit = new Set([cell(sx, sy)])
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let n = 1; n <= RANGE_START; n++) {
        const x = sx + dx * n
        const y = sy + dy * n
        if (x < 0 || y < 0 || x >= W || y >= H) break
        if (m.tiles[cell(x, y)] === HARD) break
        hit.add(cell(x, y))
        if (m.tiles[cell(x, y)] === SOFT) break
      }
    }
    return hit
  }

  for (const arena of ARENAS) {
    for (let seed = 1; seed <= 10; seed++) {
      let n = seed
      const rng = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648)
      const m = createMatch(rng, arena)
      for (const [sx, sy] of SPAWNS) {
        const blast = arms(m, sx, sy)
        // Walk out from the spawn and look for a reachable tile off the cross.
        const start = cell(sx, sy)
        const seen = new Set([start])
        const queue = [start]
        let refuge = false
        for (let head = 0; head < queue.length && !refuge; head++) {
          const i = queue[head]
          if (i !== start && !blast.has(i)) {
            refuge = true
            break
          }
          const x = i % W
          const y = Math.floor(i / W)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const j = cell(x + dx, y + dy)
            if (seen.has(j) || m.tiles[j] !== EMPTY) continue
            seen.add(j)
            queue.push(j)
          }
        }
        assert.ok(refuge, `${arena}/${seed}: spawn ${sx},${sy} has no way out of its own blast`)
      }
    }
  }
})

test('no arena ever seals off a pocket nobody can reach', () => {
  // Pickups spawn on open ground. A tile walled in by permanent posts is a
  // powerup sitting there for the whole match with no way to collect it, which
  // is what `magazine` used to do twenty-four times a map.
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const arena of ARENAS) {
    for (let seed = 1; seed <= 15; seed++) {
      let n = seed
      const rng = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648)
      const m = createMatch(rng, arena)

      // Soft stock is not a barrier — it can be blasted — so reachability runs
      // through everything except permanent wall.
      const seen = new Uint8Array(W * H)
      const start = cell(SPAWNS[0][0], SPAWNS[0][1])
      const queue = [start]
      seen[start] = 1
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head]
        const x = i % W
        const y = Math.floor(i / W)
        for (const [dx, dy] of DIRS) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const j = cell(nx, ny)
          if (seen[j] || m.tiles[j] === HARD) continue
          seen[j] = 1
          queue.push(j)
        }
      }

      for (let i = 0; i < m.tiles.length; i++) {
        if (m.tiles[i] === HARD) continue
        assert.ok(seen[i], `${arena}/${seed}: tile ${i % W},${Math.floor(i / W)} is walled in`)
      }
      // And every spawn is in the same world as every other one.
      for (const [sx, sy] of SPAWNS) {
        assert.ok(seen[cell(sx, sy)], `${arena}/${seed}: spawn ${sx},${sy} is cut off`)
      }
    }
  }
})

test('a pickup can only ever land somewhere reachable', () => {
  // The rule above, exercised through the thing that actually depends on it.
  const m = createMatch(() => 0.5, 'magazine')
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  wantBots(m)
  let seed = 0.3
  const rng = () => (seed = (seed * 7919) % 1)
  for (let i = 0; i < 900; i++) {
    m.nextPickupAt = m.now
    tick(m, TICK_MS, rng)
  }
  assert.ok(Object.keys(m.pickups).length > 0, 'nothing spawned to check')
  for (const key of Object.keys(m.pickups)) {
    assert.notEqual(m.tiles[Number(key)], HARD, 'a pickup landed inside a wall')
  }
})

test('spawns are symmetric, so no corner is the good corner', () => {
  const spots = new Set(SPAWNS.map(([x, y]) => `${x},${y}`))
  for (const [x, y] of SPAWNS) {
    assert.ok(spots.has(`${W - 1 - x},${H - 1 - y}`), `${x},${y} has no mirrored partner`)
  }
})

test('the map starts dense, because digging out is the opening move', () => {
  const m = createMatch(() => 0.5, 'foundry')
  let soft = 0
  let breakable = 0
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (m.tiles[cell(x, y)] === HARD) continue
      breakable++
      if (m.tiles[cell(x, y)] === SOFT) soft++
    }
  }
  assert.ok(soft / breakable > 0.5, `only ${Math.round((soft / breakable) * 100)}% of the map is filled`)
  assert.ok(SOFT_DENSITY > 0.5)
})

// --- blast shape ---------------------------------------------------------

test('a blast is a cross, and never touches a diagonal', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  park(m, players[1])

  assert.equal(drop(m, p.id), true)
  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)

  const lit = new Set(Object.keys(m.fires).map(Number))
  assert.ok(lit.has(cell(5, 5)), 'the bomb tile did not light')
  for (let n = 1; n <= RANGE_START; n++) {
    assert.ok(lit.has(cell(5 + n, 5)), `east arm short at ${n}`)
    assert.ok(lit.has(cell(5 - n, 5)), `west arm short at ${n}`)
    assert.ok(lit.has(cell(5, 5 + n)), `south arm short at ${n}`)
    assert.ok(lit.has(cell(5, 5 - n)), `north arm short at ${n}`)
  }
  assert.ok(!lit.has(cell(6, 6)), 'the blast reached a diagonal')
  assert.ok(!lit.has(cell(4, 4)), 'the blast reached a diagonal')
  assert.ok(!lit.has(cell(5 + RANGE_START + 1, 5)), 'the arm ran past its range')
})

test('an arm stops dead at a hard post', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  // Immediately east, so the whole east arm is smothered whatever the range.
  m.tiles[cell(6, 5)] = HARD

  drop(m, p.id)
  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)

  const lit = new Set(Object.keys(m.fires).map(Number))
  assert.ok(lit.has(cell(5, 5)), 'the bomb tile did not light')
  for (let n = 1; n <= RANGE_START; n++) {
    assert.ok(!lit.has(cell(5 + n, 5)), `fire got past the post at ${n}`)
  }
  assert.equal(m.tiles[cell(6, 5)], HARD, 'a hard post was destroyed')
  // The other arms are untouched by any of this.
  assert.ok(lit.has(cell(4, 5)), 'the west arm was smothered too')
})

test('an arm takes one soft block and stops there', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  // Two in a row at the far end of the arm: the first goes, the second stops it.
  const near = 5 + RANGE_START
  m.tiles[cell(near, 5)] = SOFT
  m.tiles[cell(near + 1, 5)] = SOFT

  drop(m, p.id)
  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)

  assert.equal(m.tiles[cell(near, 5)], EMPTY, 'the first soft block survived')
  assert.equal(m.tiles[cell(near + 1, 5)], SOFT, 'the blast ate two soft blocks in one arm')
})

test('an unbuffed bomb reaches exactly one tile, and a buffed one reaches further', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  park(m, players[1])
  stand(p, 8, 8)

  assert.equal(RANGE_START, 1, 'a starting cross is meant to fit inside a three by three')

  // Lay it, then walk well clear — standing on your own bomb is fatal, and a
  // dead player cannot lay the second one this test needs.
  const blow = (range) => {
    stand(p, 8, 8)
    p.range = range
    assert.equal(drop(m, p.id), true, 'the bomb was refused')
    stand(p, 18, 14)
    m.fires = {}
    m.now += BOMB_FUSE_MS
    tick(m, TICK_MS, () => 1)
    return new Set(Object.keys(m.fires).map(Number))
  }

  let lit = blow(RANGE_START)
  assert.ok(lit.has(cell(9, 8)) && lit.has(cell(7, 8)), 'the cross did not reach one tile')
  assert.ok(!lit.has(cell(10, 8)), 'an unbuffed bomb reached two tiles')
  assert.ok(!lit.has(cell(6, 8)), 'an unbuffed bomb reached two tiles')

  // One range pickup buys exactly one more tile down every arm.
  m.now += BLAST_MS
  lit = blow(RANGE_START + 1)
  assert.ok(lit.has(cell(10, 8)), 'the upgrade bought no extra reach')
  assert.ok(!lit.has(cell(11, 8)), 'the upgrade bought more than one tile')
})

// --- chains --------------------------------------------------------------

test('a blast sets off any bomb it reaches, a beat later', () => {
  const { m, players } = playing()
  clearField(m)
  const [a, b] = players
  stand(a, 5, 5)
  drop(m, a.id)
  // Laid later, so its own fuse still has time to run when the first goes off,
  // and just inside the first one's reach so the chain has something to catch.
  m.now += 600
  stand(b, 5 + RANGE_START, 5)
  drop(m, b.id)
  assert.equal(m.bombs.length, 2)

  // Both walk clear, as anyone would. Standing in it would end the round and
  // stop the tick before the chain had a chance to run.
  stand(a, W - 4, H - 4)
  stand(b, W - 3, H - 4)

  const second = m.bombs[1]
  m.now += BOMB_FUSE_MS - 600
  tick(m, TICK_MS, () => 1)

  // The first went off; the second is now on a short fuse rather than its own.
  assert.equal(m.bombs.length, 1)
  assert.ok(second.at - m.now <= CHAIN_STAGGER_MS, 'the chained bomb kept its original fuse')

  m.now += CHAIN_STAGGER_MS
  tick(m, TICK_MS, () => 1)
  assert.equal(m.bombs.length, 0, 'the chain never reached the second bomb')
})

test('a chained kill goes to whoever laid the bomb that did it', () => {
  const { m, players } = playing(3)
  clearField(m)
  const [a, b, victim] = players
  stand(a, 5, 5)
  drop(m, a.id)
  m.now += 600
  stand(b, 5 + RANGE_START, 5)
  drop(m, b.id)
  // Both laid; now b walks well clear of a's arms, so the only death in this
  // test is the one the chain causes.
  stand(b, 5 + RANGE_START, 12)
  // The victim stands in the second bomb's reach and nowhere near the first's.
  stand(victim, 5 + RANGE_START * 2, 5)

  m.now += BOMB_FUSE_MS - 600
  tick(m, TICK_MS, () => 1)
  assert.equal(b.alive, true, 'b was caught by the first blast; the setup is wrong')
  m.now += CHAIN_STAGGER_MS
  tick(m, TICK_MS, () => 1)

  assert.equal(victim.alive, false, 'the chain never reached them')
  assert.equal(b.kills, 1, 'the bomb that landed the kill was not credited')
  assert.equal(a.kills, 0, 'the kill was credited to the wrong bomb')
})

// --- fire and death ------------------------------------------------------

test('standing in fire is fatal outright, with no chip damage', () => {
  const { m, players } = playing()
  clearField(m)
  const [a, victim] = players
  stand(a, 5, 5)
  stand(victim, 5 + RANGE_START, 5)
  drop(m, a.id)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  assert.equal(victim.alive, false)
  assert.equal(victim.deaths, 1)
  assert.equal(a.kills, 1)
})

test('fire lingers, so walking into it late is just as fatal', () => {
  const { m, players } = playing()
  clearField(m)
  const [a, victim] = players
  stand(a, 5, 5)
  stand(victim, 12, 12) // well clear
  drop(m, a.id)
  stand(a, W - 4, H - 4) // and so does whoever laid it
  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  assert.equal(victim.alive, true)

  // Wander into the still-burning tile a moment later.
  stand(victim, 5 + RANGE_START, 5)
  tick(m, TICK_MS, () => 1)
  assert.equal(victim.alive, false, 'the fire had already gone out')
  assert.ok(BLAST_MS > TICK_MS)
})

test('blowing yourself up costs a death and earns nothing', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  park(m, players[1])
  stand(p, 5, 5)
  drop(m, p.id)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  assert.equal(p.alive, false)
  assert.equal(p.kills, 0, 'a suicide was scored as a kill')
  assert.equal(p.deaths, 1)
})

test('the dead stay down until the round is over', () => {
  const { m, players } = playing(3)
  clearField(m)
  const [p] = players
  p.alive = false

  // Two others still standing, so the round runs on without them.
  for (let i = 0; i < 60; i++) tick(m, TICK_MS, () => 1)
  assert.equal(m.phase, 'playing')
  assert.equal(p.alive, false, 'a one-life game let somebody back in')
})

test('a new round hands everyone a fresh board and a starting kit', () => {
  const { m, players } = playing()
  const p = players[0]
  p.bombs = BOMBS_MAX
  p.range = RANGE_MAX
  p.tier = SPEED_TIERS
  p.kick = true
  p.glove = true

  startRound(m, () => 0.5, 'foundry')
  assert.equal(p.alive, true)
  assert.equal(p.bombs, BOMBS_START, 'kept the bomb count into a new round')
  assert.equal(p.range, RANGE_START, 'kept the range into a new round')
  assert.equal(p.tier, 0)
  assert.equal(p.kick, false)
  assert.equal(p.glove, false)
})

// --- bombs as obstacles --------------------------------------------------

test('you can step off your own bomb, and not back onto it', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  park(m, players[1])
  stand(p, 5, 5)
  drop(m, p.id)

  // Walk east off the bomb.
  setInput(m, p.id, { dx: 1, dy: 0 })
  for (let i = 0; i < 12; i++) tick(m, TICK_MS, () => 1)
  assert.ok(p.x > 6, `never got clear of the bomb, at ${p.x}`)

  // Now try to walk back onto it.
  setInput(m, p.id, { dx: -1, dy: 0 })
  for (let i = 0; i < 20; i++) tick(m, TICK_MS, () => 1)
  assert.ok(p.x > 5.5 + RADIUS, `walked back onto the bomb, at ${p.x}`)
})

test('a bomb is limited by how many you may have live at once', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  assert.equal(drop(m, p.id), true)
  stand(p, 7, 5)
  assert.equal(drop(m, p.id), false, 'laid a second bomb on a one-bomb kit')

  p.bombs = 2
  assert.equal(drop(m, p.id), true)
  assert.equal(m.bombs.length, 2)
})

test('two bombs never share a tile', () => {
  const { m, players } = playing()
  clearField(m)
  const [a, b] = players
  stand(a, 5, 5)
  stand(b, 5, 5)
  assert.equal(drop(m, a.id), true)
  assert.equal(drop(m, b.id), false)
})

// --- upgrades ------------------------------------------------------------

test('walking over a pickup takes it, and it stacks', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  m.pickups[cell(6, 5)] = 'range'
  m.pickups[cell(7, 5)] = 'range'

  setInput(m, p.id, { dx: 1, dy: 0 })
  for (let i = 0; i < 25; i++) tick(m, TICK_MS, () => 1)
  assert.equal(p.range, RANGE_START + 2, `range is ${p.range}`)
  assert.equal(Object.keys(m.pickups).length, 0)
})

test('every kit upgrade does something, and every one is capped', () => {
  const { m, players } = playing()
  const p = players[0]
  for (const kind of PICKUP_KINDS) {
    for (let i = 0; i < 20; i++) {
      m.pickups[cell(5, 5)] = kind
      stand(p, 5, 5)
      tick(m, TICK_MS, () => 1)
    }
  }
  assert.equal(p.bombs, BOMBS_MAX)
  assert.equal(p.range, RANGE_MAX)
  assert.equal(p.tier, SPEED_TIERS)
  assert.equal(p.kick, true)
  assert.equal(p.glove, true)
})

test('a blasted soft block can leave a pickup behind', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  park(m, players[1])
  stand(p, 5, 5)
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    m.tiles[cell(5 + dx, 5 + dy)] = SOFT
  }
  drop(m, p.id)
  m.now += BOMB_FUSE_MS
  // rng of 0 always drops, and always picks the first kind.
  tick(m, TICK_MS, () => 0)
  assert.ok(Object.keys(m.pickups).length > 0, 'four soft blocks went and left nothing')
})

// --- kick and throw ------------------------------------------------------

test('without the kick, a bomb is just a wall', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  drop(m, p.id)
  const bomb = m.bombs[0]
  stand(p, 4, 5)

  setInput(m, p.id, { dx: 1, dy: 0 })
  for (let i = 0; i < 15; i++) tick(m, TICK_MS, () => 1)
  assert.equal(bomb.x, 5.5, 'a bomb moved without the kick')
})

test('the kick shoves a bomb down the lane until something stops it', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  park(m, players[1])
  p.kick = true
  stand(p, 5, 5)
  drop(m, p.id)
  const bomb = m.bombs[0]
  stand(p, 4, 5)
  m.tiles[cell(10, 5)] = HARD

  setInput(m, p.id, { dx: 1, dy: 0 })
  for (let i = 0; i < 40; i++) tick(m, TICK_MS, () => 1)
  assert.ok(bomb.x > 6, `the bomb never moved, at ${bomb.x}`)
  assert.ok(bomb.x < 10, `the bomb went through the wall, at ${bomb.x}`)
  assert.equal(bomb.slide, null, 'the bomb is still sliding')
  // It comes to rest on a tile centre, or it would sit off the lattice.
  assert.equal(bomb.x % 1, 0.5)
})

test('the glove lifts your own bomb and throws it over the wall', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  p.glove = true
  stand(p, 5, 5)
  p.face = 0
  drop(m, p.id)
  assert.equal(handle(m, p.id), true, 'could not lift it')
  assert.ok(heldBy(m, p), 'nothing in their hands')
  // Still a live bomb — off the floor, but the fuse never stopped.
  assert.equal(m.bombs.length, 1)
  assert.equal(m.bombs[0].carriedBy, p.id)
  assert.equal(bombAt(m, 5, 5), undefined, 'a carried bomb is still blocking the floor')

  // A wall in the way it will fly straight over.
  m.tiles[cell(6, 5)] = HARD
  assert.equal(handle(m, p.id), true, 'could not throw it')
  assert.equal(heldBy(m, p), undefined, 'still holding something')
  assert.equal(m.bombs.length, 1)

  for (let i = 0; i < 20; i++) tick(m, TICK_MS, () => 1)
  const bomb = m.bombs[0]
  assert.equal(bomb.air, null, 'the bomb never landed')
  assert.ok(bomb.x > 6, `landed short of the wall, at ${bomb.x}`)
  assert.ok(bomb.x <= 5 + THROW_TILES + 0.5)
  assert.equal(m.tiles[cell(6, 5)], HARD, 'the throw destroyed the wall it passed')
})

test('the glove reaches the bomb in front of you, not just the one underfoot', () => {
  const { m, players } = playing()
  clearField(m)
  const [p, other] = players
  p.glove = true
  stand(p, 5, 5)
  p.face = 0

  // Lay one and walk clear of it, exactly as a player would.
  drop(m, p.id)
  stand(p, 4, 5)
  p.face = 0
  assert.equal(m.bombs.length, 1)

  assert.equal(handle(m, p.id), true, 'could not reach the bomb one tile ahead')
  assert.ok(heldBy(m, p), 'nothing in their hands')
  assert.equal(m.bombs[0].carriedBy, p.id)
  assert.equal(other.alive, true)
})

test('a glove catches a rival charge, and it becomes yours', () => {
  const { m, players } = playing()
  clearField(m)
  const [p, other] = players
  p.glove = true
  stand(other, 6, 5)
  drop(m, other.id)
  const theirs = m.bombs[0]
  assert.equal(theirs.owner, other.id)

  stand(p, 5, 5)
  p.face = 0
  assert.equal(handle(m, p.id), true, 'could not lift a rival bomb')

  // Throw it, and it is the thrower who owns what it does.
  assert.equal(handle(m, p.id), true)
  assert.equal(m.bombs[0].owner, p.id, 'the throw was still credited to whoever laid it')
})

test('a throw carries THROW_TILES tiles', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  park(m, players[1])
  p.glove = true
  stand(p, 5, 5)
  p.face = 0
  drop(m, p.id)
  handle(m, p.id)
  assert.equal(handle(m, p.id), true)

  for (let i = 0; i < 20; i++) tick(m, TICK_MS, () => 1)
  const bomb = m.bombs[0]
  assert.equal(bomb.air, null, 'the bomb never landed')
  assert.equal(Math.floor(bomb.x), 5 + THROW_TILES, `landed at ${bomb.x}, not ${5 + THROW_TILES}`)
  assert.equal(Math.floor(bomb.y), 5, 'the throw drifted off its lane')
})

test('a bomb in your hands keeps ticking, and goes off in them', () => {
  const { m, players } = playing()
  clearField(m)
  const [p] = players
  park(m, players[1])
  p.glove = true
  stand(p, 5, 5)
  p.face = 0
  drop(m, p.id)
  const fuse = m.bombs[0].at

  assert.equal(handle(m, p.id), true)
  assert.equal(m.bombs[0].at, fuse, 'picking it up reset the fuse')

  // Carry it around: it follows, and the clock keeps running.
  setInput(m, p.id, { dx: 0, dy: 1 })
  for (let i = 0; i < 8; i++) tick(m, TICK_MS, () => 1)
  assert.equal(m.bombs.length, 1)
  assert.ok(Math.abs(m.bombs[0].y - p.y) < 0.01, 'the bomb did not travel with its carrier')

  // And when the fuse runs out, it goes off where they are standing.
  m.now = fuse
  tick(m, TICK_MS, () => 1)
  assert.equal(m.bombs.length, 0, 'a held bomb refused to go off')
  assert.equal(p.alive, false, 'it went off in their hands and they walked away')
  assert.equal(heldBy(m, p), undefined, 'still holding something')
})

test('a carrier who goes down drops the bomb, still live', () => {
  const { m, players } = playing(3)
  clearField(m)
  const [p, other] = players
  park(m, players[2])
  p.glove = true
  stand(p, 5, 5)
  p.face = 0
  drop(m, p.id)
  handle(m, p.id)
  assert.equal(m.bombs[0].carriedBy, p.id)

  // Somebody else's blast takes them while they are holding it.
  stand(other, 5 + RANGE_START, 5)
  drop(m, other.id)
  stand(other, W - 4, H - 4)
  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)

  assert.equal(p.alive, false)
  const dropped = m.bombs.find((b) => !b.air)
  if (dropped) {
    assert.equal(dropped.carriedBy, null, 'the bomb stayed in a dead hand')
    assert.equal(dropped.x % 1, 0.5, 'the dropped bomb is off the lattice')
  }
})

test('without the glove there is nothing to lift', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  p.face = 0
  drop(m, p.id)
  assert.equal(handle(m, p.id), false, 'lifted a bomb with bare hands')
  // Nor the one ahead of them.
  stand(p, 4, 5)
  assert.equal(handle(m, p.id), false)
  assert.equal(heldBy(m, p), undefined, 'still holding something')
})

// --- regrowth ------------------------------------------------------------

test('the map grows back, and never on top of anything in play', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  drop(m, p.id)
  m.pickups[cell(9, 9)] = 'range'
  m.nextRegrowAt = m.now

  for (let i = 0; i < 200; i++) {
    m.nextRegrowAt = m.now
    tick(m, TICK_MS, () => 0.5)
  }

  let soft = 0
  for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === SOFT) soft++
  assert.ok(soft > 0, 'nothing grew back at all')
  assert.equal(m.tiles[cell(9, 9)], EMPTY, 'a block grew over a pickup')
  for (const b of m.bombs) {
    assert.equal(m.tiles[cell(Math.floor(b.x), Math.floor(b.y))], EMPTY, 'a block grew over a bomb')
  }
  assert.ok(REGROW_EVERY_MS > 0)
})

test('a block never grows where a player is standing', () => {
  const { m, players } = playing()
  clearField(m)
  const p = players[0]
  stand(p, 5, 5)
  for (let i = 0; i < 300; i++) {
    m.nextRegrowAt = m.now
    tick(m, TICK_MS, () => 0.5)
    assert.equal(m.tiles[cell(5, 5)], EMPTY, 'a player was buried where they stood')
  }
})

// --- match flow ----------------------------------------------------------

test('the match counts down once MIN_PLAYERS are in', () => {
  const m = createMatch(() => 0.5, 'foundry')
  m.botFill = 0
  for (let i = 0; i < MIN_PLAYERS - 1; i++) addPlayer(m, `p${i}`)
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'waiting')

  addPlayer(m, 'last')
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'countdown', 'a round started with no warning')

  m.now += COUNTDOWN_MS
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'playing')
  assert.ok(m.players.every((p) => p.alive && p.inRound))
})

test('a round ends the moment one is left standing', () => {
  const { m, players } = playing(3)
  clearField(m)
  const [a, b, c] = players

  sitOut(b)
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'playing', 'the round ended with two still up')

  sitOut(c)
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, a.name)
  assert.equal(a.wins, 1)
  assert.equal(m.final, false, 'one round is not the match')
})

test('a round nobody survives goes to nobody, and the match rolls on', () => {
  const { m, players } = playing()
  clearField(m)
  for (const p of players) sitOut(p)
  tick(m, TICK_MS, () => 0.5)

  assert.equal(m.phase, 'over')
  assert.equal(m.winner, null)
  assert.ok(players.every((p) => p.wins === 0), 'a mutual kill was scored as a win')

  m.now += OVER_MS
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'countdown')
})

test('the match goes to the first to ROUND_TARGET rounds, then resets', () => {
  const { m, players } = playing()
  const [a, b] = players
  a.wins = ROUND_TARGET - 1

  clearField(m)
  sitOut(b)
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'over')
  assert.equal(a.wins, ROUND_TARGET)
  assert.equal(m.final, true, 'taking the last round did not finish the match')
  assert.equal(m.winnerId, a.id)

  // The next match starts from nothing.
  m.now += OVER_MS
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'countdown')
  assert.ok(players.every((p) => p.wins === 0), 'the running total survived the match')

  m.now += COUNTDOWN_MS
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'playing')
})

test('somebody arriving mid-round watches that one out', () => {
  const { m, players } = playing()
  clearField(m)
  const late = addPlayer(m, 'late')
  tick(m, TICK_MS, () => 0.5)
  assert.equal(late.inRound, false, 'a latecomer was dropped into a running round')
  assert.equal(m.phase, 'playing')

  // And they are in the next one.
  sitOut(players[1])
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'over')
  m.now += OVER_MS
  tick(m, TICK_MS, () => 0.5)
  m.now += COUNTDOWN_MS
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'playing')
  assert.equal(late.inRound, true, 'a latecomer never got into a round')
  assert.equal(late.alive, true)
})

test('capacity is the spawn list, and an overflow join is refused', () => {
  const m = createMatch(() => 0.5, 'foundry')
  m.botFill = 0
  for (let i = 0; i < MAX_PLAYERS; i++) assert.ok(addPlayer(m, `p${i}`))
  assert.equal(addPlayer(m, 'one too many'), null)
})

test('bots fill the arena and stand down as people arrive', () => {
  const m = createMatch(() => 0.5, 'foundry')
  addPlayer(m, 'solo')
  wantBots(m)
  tick(m, TICK_MS, () => 0.5)
  tick(m, TICK_MS, () => 0.5)
  const bots = m.players.filter((p) => p.bot).length
  assert.ok(bots > 0, 'a lone player got no opposition')
  assert.equal(m.players.length, m.botFill)

  addPlayer(m, 'second')
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.players.filter((p) => p.bot).length, bots - 1)
  assert.equal(m.players.length, m.botFill)
})

// --- input hardening -----------------------------------------------------

test('a junk input frame cannot drive a player to NaN', () => {
  const { m, players } = playing()
  const p = players[0]
  for (const msg of [
    { dx: NaN, dy: NaN },
    { dx: '9', dy: {} },
    { dx: Infinity, dy: -Infinity },
    { dx: 1e9, dy: 1e9 },
    null,
  ]) {
    setInput(m, p.id, msg)
    for (let i = 0; i < 5; i++) tick(m, TICK_MS, () => 1)
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `position went bad on ${JSON.stringify(msg)}`)
  }
})

test('input speed is clamped, so a scripted client cannot outrun anyone', () => {
  const walk = (dx) => {
    const { m, players } = playing()
    clearField(m)
    const p = players[0]
    stand(p, 5, 5)
    setInput(m, p.id, { dx, dy: 0 })
    for (let i = 0; i < 10; i++) tick(m, TICK_MS, () => 1)
    return p.x
  }
  assert.ok(Math.abs(walk(50) - walk(1)) < 1e-9)
})

test('a player can never walk through a wall', () => {
  const { m, players } = playing()
  const p = players[0]
  stand(p, 1, 1)
  setInput(m, p.id, { dx: -1, dy: -1 })
  for (let i = 0; i < 60; i++) tick(m, TICK_MS, () => 1)
  assert.ok(p.x > 1 && p.y > 1, `left the arena at ${p.x},${p.y}`)
})

// --- the wire ------------------------------------------------------------

test('the snapshot is JSON-safe, rounded, and carries the board', () => {
  const { m, players } = playing()
  players[0].x = 5.123456
  const s = JSON.parse(JSON.stringify(snapshot(m)))
  assert.equal(s.t, 'state')
  assert.equal(s.w, W)
  assert.equal(s.h, H)
  assert.equal(s.tiles.length, W * H)
  assert.equal(s.players[0].x, 5.12)
  assert.ok(Array.isArray(s.fires))
  assert.ok(Array.isArray(s.bombs))
  assert.ok(ARENAS.includes(s.arena))
})

test('a quiet tick announces nothing', () => {
  const { m } = playing()
  for (let i = 0; i < 5; i++) tick(m, TICK_MS, () => 1)
  assert.deepEqual(snapshot(m).events, [])
})

test('leaving frees the slot and leaves the match standing', () => {
  const { m, players } = playing(3)
  removePlayer(m, players[0].id)
  assert.equal(m.players.length, 2)
  tick(m, TICK_MS, () => 1)
  assert.equal(m.phase, 'playing')
})


// --- game modes -----------------------------------------------------------

/** A deathmatch already under way, with `n` people and no bots. */
function brawling(n = 2) {
  const m = createMatch(() => 0, 'foundry', 'deathmatch')
  const players = []
  for (let i = 0; i < n; i++) players.push(addPlayer(m, `p${i}`))
  m.botFill = 0
  startRound(m, () => 0, 'foundry')
  m.nextPickupAt = Infinity
  m.nextRegrowAt = Infinity
  return { m, players }
}

test('a match knows which way it is being played, and says so', () => {
  for (const mode of MODES) {
    const m = createMatch(() => 0.5, 'foundry', mode)
    assert.equal(m.mode, mode)
    assert.equal(snapshot(m).mode, mode)
  }
  // An unknown mode falls back rather than producing a match with no rules.
  assert.equal(createMatch(() => 0.5, 'foundry', 'nonsense').mode, MODES[0])
})

test('deathmatch puts the dead back on the board', () => {
  const { m, players } = brawling()
  clearField(m)
  const p = players[0]
  p.alive = false
  p.respawnAt = m.now + RESPAWN_MS
  p.bombs = BOMBS_MAX
  p.range = RANGE_MAX

  tick(m, TICK_MS, () => 1)
  assert.equal(p.alive, false, 'came back before the timer')

  m.now += RESPAWN_MS
  tick(m, TICK_MS, () => 1)
  assert.equal(p.alive, true, 'a deathmatch left somebody down for good')
  assert.equal(p.bombs, BOMBS_START, 'kept their kit through a death')
  assert.equal(p.range, RANGE_START)
  assert.equal(m.phase, 'playing', 'a death ended the round in a deathmatch')
})

test('a deathmatch runs to a score, not to a last survivor', () => {
  const { m, players } = brawling()
  clearField(m)
  const [a, b] = players

  // One player alone on the board does not end anything.
  b.alive = false
  b.respawnAt = m.now + 1e6
  tick(m, TICK_MS, () => 1)
  assert.equal(m.phase, 'playing', 'a deathmatch ended on a last survivor')

  a.kills = KILL_TARGET
  tick(m, TICK_MS, () => 1)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, a.name)
  assert.equal(m.final, true, 'a deathmatch win is always the match')
  assert.equal(snapshot(m).target, KILL_TARGET)
})

test('last man standing still ends on the last survivor', () => {
  const { m, players } = playing(3)
  clearField(m)
  assert.equal(m.mode, 'lastman')
  sitOut(players[1])
  sitOut(players[2])
  tick(m, TICK_MS, () => 1)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, players[0].name)
  assert.equal(snapshot(m).target, ROUND_TARGET)
})


test('nothing runs in an empty room, and an operator can lift that', () => {
  const m = createMatch(() => 0.5, 'foundry')

  // Nobody here: no bots are seated and no round counts down.
  for (let i = 0; i < 5; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.players.length, 0, 'bots took the field with nobody watching')
  assert.equal(m.phase, 'waiting')

  // Somebody arrives, and the lobby is held for them to decide.
  const person = addPlayer(m, 'someone')
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.players.length, 1, 'bots arrived without being asked for')
  assert.equal(m.phase, 'waiting')

  wantBots(m)
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.ok(m.players.filter((p) => p.bot).length > 0, 'asking for bots got none')
  assert.equal(m.phase, 'countdown')

  removePlayer(m, person.id)
  tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'waiting', 'the bots carried on to an empty room')
  assert.equal(m.players.length, 0)

  m.botsOnly = true
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.players.length, m.botFill, 'the operator override seated nobody')
  assert.equal(snapshot(m).botsOnly, true)
})

test('the board only grows back in deathmatch', () => {
  // Last man standing: a round has to converge, so nothing refills.
  const { m } = playing()
  assert.equal(m.mode, 'lastman')
  assert.equal(m.nextRegrowAt, Infinity, 'a last-man round schedules regrowth')

  const before = m.tiles.filter((t) => t === SOFT).length
  for (let i = 0; i < 400; i++) tick(m, TICK_MS, () => 0.5)
  assert.ok(
    m.tiles.filter((t) => t === SOFT).length <= before,
    'stock came back in a last-man round',
  )

  // Deathmatch runs on, so the plant refills behind you. Built fresh rather
  // than through the helper, which freezes regrowth off for test isolation.
  const d = createMatch(() => 0, 'foundry', 'deathmatch')
  addPlayer(d, 'a')
  addPlayer(d, 'b')
  startRound(d, () => 0, 'foundry')
  assert.ok(Number.isFinite(d.nextRegrowAt), 'a deathmatch never schedules regrowth')

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) if (d.tiles[cell(x, y)] === SOFT) d.tiles[cell(x, y)] = EMPTY
  }
  for (let i = 0; i < 400; i++) tick(d, TICK_MS, () => 0.5)
  assert.ok(d.tiles.some((t) => t === SOFT), 'a deathmatch board never refilled')
})


test('a lone player holds the lobby until they choose', () => {
  const m = createMatch(() => 0.5, 'foundry')
  addPlayer(m, 'first')
  for (let i = 0; i < 6; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'waiting', 'a lone player was dropped straight into a match')
  assert.equal(m.players.length, 1)
  assert.equal(snapshot(m).botsWanted, false)

  // Waiting it out works: a second person starts a match with no bots in it.
  addPlayer(m, 'second')
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.equal(m.phase, 'countdown')
  assert.equal(m.players.filter((p) => p.bot).length, 0, 'bots joined an uninvited match')
})

test('asking for bots is remembered, and reported', () => {
  const m = createMatch(() => 0.5, 'foundry')
  addPlayer(m, 'first')
  assert.equal(wantBots(m), true)
  assert.equal(snapshot(m).botsWanted, true)
  for (let i = 0; i < 3; i++) tick(m, TICK_MS, () => 0.5)
  assert.ok(m.players.filter((p) => p.bot).length > 0)
})


// --- the wider kit --------------------------------------------------------

test('a remote charge waits for the word, and then goes on it', () => {
  const { m, players } = playing()
  clearField(m)
  const [p] = players
  park(m, players[1])
  p.remote = true
  stand(p, 5, 5)
  drop(m, p.id)
  assert.equal(m.bombs.length, 1)
  assert.equal(Number.isFinite(m.bombs[0].at), false, 'a remote charge was given a fuse')
  assert.equal(snapshot(m).bombs[0].in, -1, 'the wire should say it is not counting')

  // Well past any ordinary fuse, and it is still sitting there.
  m.now += BOMB_FUSE_MS * 4
  tick(m, TICK_MS, () => 1)
  assert.equal(m.bombs.length, 1, 'a remote charge went off on its own')

  stand(p, W - 4, H - 4)
  assert.equal(detonateAll(m, p.id), true)
  tick(m, TICK_MS, () => 1)
  assert.equal(m.bombs.length, 0, 'the word was given and nothing happened')
})

test('detonating touches only your own remote charges', () => {
  const { m, players } = playing()
  clearField(m)
  const [p, other] = players
  p.remote = true
  stand(p, 5, 5)
  drop(m, p.id)
  stand(other, 15, 9)
  drop(m, other.id) // ordinary fuse, not yours
  stand(p, W - 4, H - 4)
  stand(other, W - 3, H - 4)

  detonateAll(m, p.id)
  tick(m, TICK_MS, () => 1)
  assert.equal(m.bombs.length, 1, 'somebody else’s charge went off too')
  assert.equal(m.bombs[0].owner, other.id)
})

test('a dead hand releases its remote charges onto a fuse', () => {
  const { m, players } = playing(3)
  clearField(m)
  const [p] = players
  park(m, players[1])
  park(m, players[2])
  p.remote = true
  stand(p, 5, 5)
  drop(m, p.id)
  assert.equal(Number.isFinite(m.bombs[0].at), false)

  // Killed by somebody else's fire while the charge is still on the board.
  // They have to be alive going in, or nothing is doing any killing.
  m.fires[cell(9, 9)] = { until: m.now + BLAST_MS, by: players[1].id }
  stand(p, 9, 9)
  tick(m, TICK_MS, () => 1)
  assert.equal(p.alive, false, 'the fire did not take them')

  const left = m.bombs.find((b) => b.owner === p.id)
  assert.ok(left, 'the charge vanished with its owner')
  assert.equal(left.remote, false, 'a dead player kept the trigger')
  assert.ok(Number.isFinite(left.at), 'the charge is still waiting for a word nobody can give')
})

test('a vest eats one blast and is spent', () => {
  const { m, players } = playing(3)
  clearField(m)
  const [p, other] = players
  park(m, players[2])
  p.vest = true
  stand(p, 5 + RANGE_START, 5)
  stand(other, 5, 5)
  drop(m, other.id)
  stand(other, W - 4, H - 4)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  assert.equal(p.alive, true, 'the vest did not absorb the blast')
  assert.equal(p.vest, false, 'the vest was not spent')
  assert.ok(m.events.some((e) => e.k === 'save' && e.of === p.id), 'the save was never announced')

  // The same lingering fire must not immediately finish them either.
  for (let i = 0; i < 6; i++) tick(m, TICK_MS, () => 1)
  assert.equal(p.alive, true, 'the same fire ate the vest and then the player')
})

test('a square charge takes the three by three at range 1', () => {
  const { m, players } = playing()
  clearField(m)
  const [p] = players
  park(m, players[1])
  p.square = true
  stand(p, 8, 8)
  p.range = 1
  drop(m, p.id)
  stand(p, W - 4, H - 4)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  const lit = new Set(Object.keys(m.fires).map(Number))
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    assert.ok(lit.has(cell(8 + dx, 8 + dy)), `the corner ${dx},${dy} was left alone`)
  }
  assert.ok(!lit.has(cell(10, 8)), 'a square charge at range 1 reached distance 2')
  assert.equal(lit.size, 9, `a three by three is nine tiles, not ${lit.size}`)
})

test('a square charge scales its radius with blast arms range', () => {
  const { m, players } = playing()
  clearField(m)
  const [p] = players
  park(m, players[1])
  p.square = true
  stand(p, 8, 8)
  p.range = 2
  drop(m, p.id)
  stand(p, W - 4, H - 4)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  const lit = new Set(Object.keys(m.fires).map(Number))
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      assert.ok(lit.has(cell(8 + dx, 8 + dy)), `tile at ${8 + dx},${8 + dy} was not lit`)
    }
  }
  assert.ok(!lit.has(cell(8 + 3, 8)), 'a square charge at range 2 reached distance 3')
  assert.equal(lit.size, 25, `a five by five is 25 tiles, not ${lit.size}`)
})

test('a square charge caps its blast radius at SQUARE_RANGE_MAX', () => {
  const { m, players } = playing()
  clearField(m)
  const [p] = players
  park(m, players[1])
  p.square = true
  stand(p, 8, 8)
  p.range = RANGE_MAX
  drop(m, p.id)
  stand(p, W - 4, H - 4)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  const lit = new Set(Object.keys(m.fires).map(Number))
  for (let dy = -SQUARE_RANGE_MAX; dy <= SQUARE_RANGE_MAX; dy++) {
    for (let dx = -SQUARE_RANGE_MAX; dx <= SQUARE_RANGE_MAX; dx++) {
      assert.ok(lit.has(cell(8 + dx, 8 + dy)), `tile at ${8 + dx},${8 + dy} was not lit`)
    }
  }
  assert.ok(!lit.has(cell(8 + SQUARE_RANGE_MAX + 1, 8)), 'square reached past SQUARE_RANGE_MAX')
  const expectedSize = (2 * SQUARE_RANGE_MAX + 1) ** 2
  assert.equal(lit.size, expectedSize, `capped square should be ${expectedSize} tiles, got ${lit.size}`)
})

test('a drill charge runs its arms through stock', () => {
  const { m, players } = playing()
  clearField(m)
  const [p] = players
  park(m, players[1])
  p.drill = true
  p.range = 4
  stand(p, 5, 8)
  for (const x of [6, 7]) m.tiles[cell(x, 8)] = SOFT
  drop(m, p.id)
  stand(p, W - 4, H - 4)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  assert.equal(m.tiles[cell(6, 8)], EMPTY, 'the first block survived')
  assert.equal(m.tiles[cell(7, 8)], EMPTY, 'the arm stopped at the first block')
  const lit = new Set(Object.keys(m.fires).map(Number))
  assert.ok(lit.has(cell(9, 8)), 'the arm did not run its full reach')
})

test('a hard post still stops a drill', () => {
  const { m, players } = playing()
  clearField(m)
  const [p] = players
  park(m, players[1])
  p.drill = true
  p.range = 4
  stand(p, 5, 8)
  m.tiles[cell(7, 8)] = HARD
  drop(m, p.id)
  stand(p, W - 4, H - 4)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 1)
  const lit = new Set(Object.keys(m.fires).map(Number))
  assert.ok(!lit.has(cell(8, 8)), 'a drill went through a hard post')
  assert.equal(m.tiles[cell(7, 8)], HARD)
})

test('every kit pickup is reachable and does something', () => {
  const { m, players } = playing()
  const p = players[0]
  for (const kind of PICKUP_KINDS) {
    m.pickups[cell(5, 5)] = kind
    stand(p, 5, 5)
    tick(m, TICK_MS, () => 1)
  }
  assert.equal(p.remote, true)
  assert.equal(p.vest, true)
  assert.equal(p.square, true)
  assert.equal(p.drill, true)
})

test('a charge that goes off in your hands leaves your hands empty', () => {
  const { m, players } = playing()
  clearField(m)
  const [p, other] = players
  park(m, other)
  p.glove = true
  p.vest = true // so they walk out of their own blast and we can see the aftermath
  stand(p, 5, 5)
  drop(m, p.id)
  assert.equal(handle(m, p.id), true, 'could not lift it')

  // The fuse never stopped, so it goes off where they are standing.
  for (let t = 0; t <= BOMB_FUSE_MS + BLAST_MS + TICK_MS; t += TICK_MS) tick(m, TICK_MS, () => 1)
  assert.equal(p.alive, true, 'the vest did not absorb their own charge')
  assert.equal(heldBy(m, p), undefined, 'still holding a charge that no longer exists')
  assert.equal(snapshot(m).players.find((q) => q.id === p.id).carrying, false)
  assert.equal(drop(m, p.id), true, 'could never lay another bomb')
})

test('a thrown charge does not wall in whoever it lands on', () => {
  const { m, players } = playing()
  clearField(m)
  const [p, other] = players
  p.glove = true
  stand(p, 5, 5)
  p.face = 0
  stand(other, 5 + THROW_TILES, 5)
  drop(m, p.id)
  assert.equal(handle(m, p.id), true, 'could not lift it')
  assert.equal(handle(m, p.id), true, 'could not throw it')

  for (let i = 0; i < 20; i++) tick(m, TICK_MS, () => 1)
  assert.equal(m.bombs[0].air, null, 'the throw never landed')
  assert.equal(Math.floor(m.bombs[0].x), 5 + THROW_TILES, 'it did not land on them')

  const before = other.x
  setInput(m, other.id, { dx: 1, dy: 0 })
  for (let i = 0; i < 10; i++) tick(m, TICK_MS, () => 1)
  assert.ok(other.x > before + 0.2, `walled into the charge that landed on them at ${other.x}`)
})

test('a remote charge left behind by somebody who quit goes back on a fuse', () => {
  const { m, players } = playing(3)
  clearField(m)
  const [p, other, third] = players
  park(m, other)
  stand(third, 5, 12)
  p.remote = true
  stand(p, 5, 5)
  drop(m, p.id)
  assert.equal(Number.isFinite(m.bombs[0].at), false, 'a remote charge was given a fuse')

  removePlayer(m, p.id)
  assert.equal(m.bombs.length, 1, 'their charge left with them')
  assert.equal(m.bombs[0].remote, false, 'a charge nobody can trigger kept its trigger')

  for (let t = 0; t <= BOMB_FUSE_MS + TICK_MS; t += TICK_MS) tick(m, TICK_MS, () => 1)
  assert.equal(m.bombs.length, 0, 'the abandoned charge is still sitting on the board')
})

test('a bot pulls the trigger on the remote charges it lays', () => {
  const m = createMatch(Math.random, 'foundry', 'deathmatch')
  m.botsOnly = true
  m.botFill = 4
  startMatch(m, Math.random, 'foundry')

  // How long each charge sat armed. A charge waiting to be triggered is the
  // one thing on this board with no clock of its own, so if a bot forgets it,
  // nothing else will ever clear it.
  const laidAt = new Map()
  let laid = 0
  let worst = 0
  for (let t = 0; t < 30000; t += TICK_MS) {
    // Bots lose the kit when they die, and the trigger is what is on trial.
    for (const p of m.players) p.remote = true
    tick(m, TICK_MS)
    for (const b of m.bombs) {
      if (Number.isFinite(b.at)) continue
      if (!laidAt.has(b.id)) {
        laidAt.set(b.id, m.now)
        laid += 1
      }
      worst = Math.max(worst, m.now - laidAt.get(b.id))
    }
  }

  assert.ok(
    worst <= BOMB_FUSE_MS + BOT_REACT_MS * 4,
    `a charge sat armed for ${(worst / 1000).toFixed(1)}s with nobody willing to trigger it`,
  )
  // Charges laid, not kills scored. A bot that forgets its charge is out of
  // bombs for the rest of its life, so a healthy run cycles them constantly:
  // measured over sixty runs, the worst was twelve and the median twenty-five,
  // against a hard ceiling of one per bot if the trigger were never pulled.
  // Kills were the obvious thing to count and the wrong one — ten per cent of
  // runs have nobody die inside thirty seconds, which is a flaky test, not a
  // broken game.
  assert.ok(laid >= 8, `only ${laid} charges laid: the bots were not cycling bombs`)
})

test('a match with nobody to play against does not hand out a round', () => {
  const m = createMatch(() => 0, 'foundry', 'lastman')
  const solo = addPlayer(m, 'solo')
  wantBots(m)

  // What the operator console does. Bots are seated by the tick, not by this
  // call, so at this instant there is exactly one participant.
  startMatch(m, () => 0, 'foundry')
  assert.notEqual(m.phase, 'playing', 'a round started with one player in it')

  tick(m, TICK_MS, () => 0)
  assert.equal(solo.wins, 0, 'a round was awarded before anybody had played')
  assert.equal(m.winner, null)

  // And once the bots are in, it gets going by itself.
  assert.ok(m.players.length >= MIN_PLAYERS, 'the bots never arrived')
  assert.equal(m.phase, 'countdown')
  m.now += COUNTDOWN_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(m.phase, 'playing')
  assert.equal(solo.wins, 0)
})

test('a match restarted with a full arena still starts at once', () => {
  const { m, players } = playing(3)
  for (const p of players) p.wins = 2
  startMatch(m, () => 0, 'foundry')
  assert.equal(m.phase, 'playing', 'a restart with enough players had to wait')
  assert.ok(
    players.every((p) => p.wins === 0),
    'the running total survived a restart',
  )
})

// --- the closing wall ----------------------------------------------------

/** Runs the clock to the moment the wall starts, then n tiles further. */
function squeezeBy(m, n) {
  m.now += SUDDEN_DEATH_MS
  tick(m, TICK_MS, () => 1)
  for (let i = 0; i < n; i++) {
    m.now += SQUEEZE_EVERY_MS
    tick(m, TICK_MS, () => 1)
  }
}

test('the spiral covers every inner tile exactly once, outside first', () => {
  const inner = (W - 2) * (H - 2)
  assert.equal(SQUEEZE_ORDER.length, inner)
  assert.equal(new Set(SQUEEZE_ORDER).size, inner, 'the wall would take a tile twice')

  // It starts on the outer ring and finishes somewhere in the middle.
  const [fx, fy] = [SQUEEZE_ORDER[0] % W, Math.floor(SQUEEZE_ORDER[0] / W)]
  const last = SQUEEZE_ORDER[SQUEEZE_ORDER.length - 1]
  const [lx, ly] = [last % W, Math.floor(last / W)]
  assert.ok(fx === 1 || fy === 1, `the wall started at ${fx},${fy} rather than the edge`)
  assert.ok(lx > 2 && lx < W - 3 && ly > 1 && ly < H - 2, `the wall finished at ${lx},${ly}`)
})

test('a deathmatch is never squeezed, because it refills instead', () => {
  const m = createMatch(() => 0, 'foundry', 'deathmatch')
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  m.botFill = 0
  startRound(m, () => 0, 'foundry')
  assert.equal(m.squeezeAt, Infinity)

  const before = m.tiles.filter((t) => t === HARD).length
  squeezeBy(m, 20)
  assert.equal(m.tiles.filter((t) => t === HARD).length, before, 'a deathmatch closed in')
})

test('the wall waits, then closes from the outside in', () => {
  const { m, players } = playing(2)
  park(m, players[1])
  assert.equal(m.squeezeAt, m.now + SUDDEN_DEATH_MS)

  const before = m.tiles.filter((t) => t === HARD).length
  // A tick short of the deadline: the tick itself advances the clock, so
  // landing exactly on it is the wall arriving on time, not early.
  m.now += SUDDEN_DEATH_MS - TICK_MS * 2
  tick(m, TICK_MS, () => 1)
  assert.equal(m.tiles.filter((t) => t === HARD).length, before, 'the wall started early')

  squeezeBy(m, 30)
  const after = m.tiles.filter((t) => t === HARD).length
  assert.ok(after > before, 'the wall never closed at all')

  // Everything it has taken is at the head of the spiral, so what it eats is
  // the outside edge rather than somewhere in the middle.
  assert.ok(m.squeezeStep > 0, 'the wall never advanced along the spiral')
  for (const i of SQUEEZE_ORDER.slice(0, m.squeezeStep)) {
    assert.equal(m.tiles[i], HARD, 'the wall skipped a tile it had passed')
  }

  // And nothing beyond where it has reached has turned solid on its own: the
  // only HARD tiles further along are the lattice posts, which never move.
  const posts = SQUEEZE_ORDER.slice(m.squeezeStep).filter((i) => {
    const x = i % W
    const y = Math.floor(i / W)
    return x % 2 === 0 && y % 2 === 0
  }).length
  const solidAhead = SQUEEZE_ORDER.slice(m.squeezeStep).filter((i) => m.tiles[i] === HARD).length
  assert.equal(solidAhead, posts, 'something ahead of the wall turned solid')
})

test('the wall crushes whoever is under it, and nobody is credited', () => {
  const { m, players } = playing(2)
  const [victim, other] = players
  park(m, other)

  // Stand them exactly where the wall starts.
  const first = SQUEEZE_ORDER[0]
  victim.x = (first % W) + 0.5
  victim.y = Math.floor(first / W) + 0.5
  m.tiles[first] = EMPTY

  squeezeBy(m, 0)
  assert.equal(victim.alive, false, 'the wall closed over them and left them standing')
  assert.equal(victim.deaths, 1)
  assert.equal(other.kills, 0, 'somebody was credited with a kill the wall made')
  const credited = m.events.filter((e) => e.k === 'kill').map((e) => e.by)
  assert.deepEqual(credited, [null], 'a crush was credited to a player')
})

test('a round always ends once the wall has closed', () => {
  const { m, players } = playing(2)
  // Nobody moves and nobody bombs: the stalemate this exists to break.
  for (const p of players) setInput(m, p.id, { dx: 0, dy: 0 })
  m.nextPickupAt = Infinity

  const ceiling = SUDDEN_DEATH_MS + SQUEEZE_ORDER.length * SQUEEZE_EVERY_MS + 5000
  let t = 0
  for (; t < ceiling && m.phase === 'playing'; t += TICK_MS) tick(m, TICK_MS, () => 1)
  assert.notEqual(m.phase, 'playing', `the round was still running after ${(t / 1000).toFixed(0)}s`)
})
