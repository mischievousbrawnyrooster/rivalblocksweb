import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMatch,
  addPlayer,
  removePlayer,
  setInput,
  build,
  usePowerup,
  startMatch,
  tick,
  snapshot,
  W,
  H,
  TICK_MS,
  RADIUS,
  SPEED,
  PLAYER_HP,
  WALL_HP,
  BULLET_SPEED,
  FIRE_COOLDOWN_MS,
  BUILD_CHARGES,
  RESPAWN_MS,
  KILL_TARGET,
  OVER_MS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  SPAWNS,
  POWERUP_KINDS,
  SPRINT_MS,
  DASH_DISTANCE,
  DASH_COOLDOWN_MS,
  DASH_MIN_GAIN,
  dash,
  OVERCHARGE_MS,
  PIERCE_LAYERS,
  BUILD_REACH,
  COVER_BLOCKS,
  ARENAS,
  RAPID_MULT,
  RAPID_MS,
  SHOTGUN_PELLETS,
  SHOTGUN_MS,
  SHOTGUN_COOLDOWN_MS,
  SHOTGUN_RANGE_MS,
  BULLET_LIFE_MS,
  REPAIR_EVERY_MS,
  AD_MS,
  DEATHLESS_NAME,
  MEDKIT_HEAL,
  OVERHEAL_MAX,
  MELEE_REACH,
  MELEE_COOLDOWN_MS,
  BOMB_FUSE_MS,
  BOT_FILL_TO,
  BOT_RANGE,
  BOT_PICKUP_RANGE,
  POWERUP_MAX,
  ensureBots,
} from './fracture.js'

const cell = (x, y) => y * W + x

/**
 * A match already in progress with `n` players. rng is fixed so carve() lays
 * the same cover every time, and powerups are frozen off so a pickup can never
 * wander into a test that is not about pickups.
 */
function playing(n = 2) {
  const m = createMatch()
  const players = []
  for (let i = 0; i < n; i++) players.push(addPlayer(m, `p${i}`))
  startMatch(m, () => 0)
  m.nextPowerupAt = Infinity
  return { m, players }
}

/** Drops every wall so a test can control the arena outright. */
function clearWalls(m) {
  m.walls.fill(0)
}

/**
 * A match that fills itself with bots, already deployed. The rng is fixed, so
 * bot aim jitter and strafe direction are the same every run.
 */
function withBots(fill = BOT_FILL_TO, humans = 1) {
  const m = createMatch(() => 0, 'kiln')
  m.botFill = fill
  const people = []
  for (let i = 0; i < humans; i++) people.push(addPlayer(m, `h${i}`))
  tick(m, TICK_MS, () => 0.5)
  m.nextPowerupAt = Infinity
  return { m, people, bots: m.players.filter((q) => q.bot) }
}

test('a new match already has an arena to look at', () => {
  const m = createMatch(() => 0)
  assert.equal(m.phase, 'waiting')
  assert.equal(m.walls.length, W * H)
  // The whole point: the first player to connect gets a map on screen, not
  // 640 empty cells that look like a broken renderer.
  assert.ok(m.walls[0] > 0, 'the border is not up')
  assert.ok(m.walls.some((v) => v === 0), 'there is nowhere to stand')
  assert.deepEqual(m.players, [])
  assert.deepEqual(m.bullets, [])
})

test('a lone player is told to wait, and still has something to look at', () => {
  const m = createMatch(() => 0)
  addPlayer(m, 'solo')
  tick(m, TICK_MS, () => 0)
  const s = snapshot(m)
  assert.equal(s.phase, 'waiting')
  assert.ok(s.walls.some((v) => v > 0), 'a waiting lobby broadcasts a blank arena')
})

test('the match starts once MIN_PLAYERS are connected', () => {
  const m = createMatch()
  for (let i = 0; i < MIN_PLAYERS - 1; i++) addPlayer(m, `p${i}`)
  tick(m, TICK_MS, () => 0)
  assert.equal(m.phase, 'waiting')

  addPlayer(m, 'last')
  tick(m, TICK_MS, () => 0)
  assert.equal(m.phase, 'playing')
  assert.ok(m.players.every((p) => p.alive && p.hp === PLAYER_HP))
})

test('capacity is the spawn list, and an overflow join is refused', () => {
  const m = createMatch()
  for (let i = 0; i < MAX_PLAYERS; i++) assert.ok(addPlayer(m, `p${i}`))
  assert.equal(addPlayer(m, 'one too many'), null)
  assert.equal(m.players.length, MAX_PLAYERS)
})

test('spawns are clear of cover and nobody starts inside a wall', () => {
  const { m, players } = playing(MAX_PLAYERS)
  for (const p of players) {
    assert.equal(m.walls[cell(Math.floor(p.x), Math.floor(p.y))], 0)
  }
  // Distinct spawn points: no two players stacked on one another.
  const spots = new Set(players.map((p) => `${p.x},${p.y}`))
  assert.equal(spots.size, players.length)
})

test('every arena is dense enough to hide in and open enough to move through', () => {
  // Every layout, several seeds each — one lucky map proves nothing.
  for (const arena of ARENAS) {
    for (let seed = 1; seed <= 12; seed++) {
      let n = seed
      const rng = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648)
      const m = createMatch(rng, arena)
      const where = `${arena} seed ${seed}`

      const interior = []
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) interior.push(m.walls[y * W + x])
      }
      // Deliberately thin: repair means cover is no longer a wasting asset, so
      // the arena starts sparse and stays that way instead of starting dense
      // and eroding. The bounds are what makes it an arena and not a corridor
      // maze at one end or an empty room at the other.
      const open = interior.filter((v) => v === 0).length / interior.length
      assert.ok(open > 0.5, `${where}: only ${Math.round(open * 100)}% walkable`)
      assert.ok(open < 0.92, `${where}: barely any cover at ${Math.round(open * 100)}% open`)

      // Whatever the layout does, a spawn is always somewhere you can stand.
      for (const [sx, sy] of SPAWNS) {
        assert.equal(m.walls[sy * W + sx], 0, `${where}: spawn ${sx},${sy} is walled`)
      }
    }
  }
  assert.ok(COVER_BLOCKS > 0)
})

test('every arena is symmetric, so neither half is the good half', () => {
  for (const arena of ARENAS) {
    const m = createMatch(() => 0.5, arena)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        assert.equal(
          m.walls[y * W + x] > 0,
          m.walls[(H - 1 - y) * W + (W - 1 - x)] > 0,
          `${arena}: ${x},${y} has no mirrored partner`,
        )
      }
    }
  }
})

test('the arena in play is named in the snapshot', () => {
  const m = createMatch(() => 0, 'drydock')
  assert.equal(snapshot(m).arena, 'drydock')
  addPlayer(m, 'a')
  addPlayer(m, 'b')
  tick(m, TICK_MS, () => 0)
  assert.ok(ARENAS.includes(snapshot(m).arena))
})

test('the arena is walled in and the border holds', () => {
  const { m, players } = playing()
  const p = players[0]
  p.x = 1.5
  p.y = 1.5
  setInput(m, p.id, { dx: -1, dy: -1, aim: 0 })
  for (let i = 0; i < 40; i++) tick(m, TICK_MS, () => 0)
  assert.ok(p.x > 1 && p.y > 1, `walked into the border at ${p.x},${p.y}`)
})

test('a wall stops movement but you still slide along it', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 5.5
  p.y = 5.5
  m.walls[cell(6, 5)] = WALL_HP

  // Straight into it: blocked short of the wall.
  setInput(m, p.id, { dx: 1, dy: 0, aim: 0 })
  for (let i = 0; i < 20; i++) tick(m, TICK_MS, () => 0)
  assert.ok(p.x < 6 - RADIUS + 0.01, `walked through the wall to ${p.x}`)

  // Diagonally into it: the y axis still moves.
  const before = p.y
  setInput(m, p.id, { dx: 1, dy: 1, aim: 0 })
  for (let i = 0; i < 10; i++) tick(m, TICK_MS, () => 0)
  assert.ok(p.y > before, 'stuck instead of sliding')
})

test('diagonal movement is not faster than cardinal', () => {
  const run = (dx, dy) => {
    const { m, players } = playing()
    clearWalls(m)
    const p = players[0]
    p.x = 16
    p.y = 10
    setInput(m, p.id, { dx, dy, aim: 0 })
    for (let i = 0; i < 10; i++) tick(m, TICK_MS, () => 0)
    return Math.hypot(p.x - 16, p.y - 10)
  }
  assert.ok(Math.abs(run(1, 1) - run(1, 0)) < 0.01)
})

test('bullets chew through a wall, one hit at a time', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 5.5
  p.y = 10.5
  m.walls[cell(8, 10)] = WALL_HP

  for (let hit = WALL_HP; hit > 0; hit--) {
    setInput(m, p.id, { dx: 0, dy: 0, aim: 0, fire: true })
    tick(m, TICK_MS, () => 0)
    setInput(m, p.id, { dx: 0, dy: 0, aim: 0, fire: false })
    for (let i = 0; i < 6; i++) tick(m, TICK_MS, () => 0)
    m.now += FIRE_COOLDOWN_MS
    assert.equal(m.walls[cell(8, 10)], hit - 1)
  }
  assert.equal(m.walls[cell(8, 10)], 0)
})

test('a bullet never passes its own shooter', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 16
  p.y = 10
  setInput(m, p.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  assert.equal(p.hp, PLAYER_HP)
})

test('PLAYER_HP hits kill, and credit the shooter', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  a.x = 5
  a.y = 10
  b.x = 9
  b.y = 10

  for (let shot = 0; shot < PLAYER_HP; shot++) {
    b.x = 9 // hold the target still; respawn moves it after the last hit
    b.y = 10
    setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
    tick(m, TICK_MS, () => 0)
    setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: false })
    for (let i = 0; i < 6; i++) tick(m, TICK_MS, () => 0)
    m.now += FIRE_COOLDOWN_MS
  }

  assert.equal(a.kills, 1)
  assert.equal(b.deaths, 1)
  assert.equal(b.alive, false)
})

test('a hit is announced, with where it landed and how hard', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  a.x = 5
  a.y = 10
  b.x = 9
  b.y = 10

  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: false })

  let hit = null
  for (let i = 0; i < 8 && !hit; i++) {
    tick(m, TICK_MS, () => 0)
    hit = m.events.find((e) => e.k === 'hit')
  }
  assert.ok(hit, 'a landed round said nothing')
  assert.equal(hit.by, a.id)
  assert.equal(hit.of, b.id)
  assert.equal(hit.dmg, 1)
  // The impact point is what lets the victim be shown a direction.
  assert.ok(Number.isFinite(hit.x) && Number.isFinite(hit.y))
  assert.ok(Math.abs(hit.x - b.x) < 1, `impact at ${hit.x} is nowhere near the target`)
})

test('a shield still tells the shooter they connected', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  a.x = 5
  a.y = 10
  b.x = 9
  b.y = 10
  b.held = 'shield'
  usePowerup(m, b.id)

  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: false })

  let hit = null
  for (let i = 0; i < 8 && !hit; i++) {
    tick(m, TICK_MS, () => 0)
    hit = m.events.find((e) => e.k === 'hit')
  }
  assert.ok(hit)
  assert.equal(hit.dmg, 0, 'an absorbed round should report no damage, but still report')
})

test('a kill is announced once, and does not linger into the next tick', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  b.hp = 1
  a.x = 5
  a.y = 10
  b.x = 9
  b.y = 10

  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: false })

  let kills = []
  for (let i = 0; i < 8 && kills.length === 0; i++) {
    tick(m, TICK_MS, () => 0)
    kills = m.events.filter((e) => e.k === 'kill')
  }
  assert.equal(kills.length, 1)
  assert.equal(kills[0].by, a.id)
  assert.equal(kills[0].of, b.id)

  // The next tick must be clean, or the client replays the kill forever.
  tick(m, TICK_MS, () => 0)
  assert.deepEqual(m.events, [])
})

test('a quiet tick announces nothing', () => {
  const { m } = playing()
  for (let i = 0; i < 5; i++) tick(m, TICK_MS, () => 0)
  assert.deepEqual(snapshot(m).events, [])
})

test('the dead come back after RESPAWN_MS', () => {
  const { m, players } = playing()
  const b = players[1]
  b.alive = false
  b.hp = 0
  b.respawnAt = m.now + RESPAWN_MS

  tick(m, TICK_MS, () => 0)
  assert.equal(b.alive, false)
  m.now += RESPAWN_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(b.alive, true)
  assert.equal(b.hp, PLAYER_HP)
})

test('a shield eats one bullet and is spent', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  a.x = 5
  a.y = 10
  b.x = 9
  b.y = 10
  b.held = 'shield'
  usePowerup(m, b.id)
  assert.equal(b.shielded, true)

  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  for (let i = 0; i < 6; i++) tick(m, TICK_MS, () => 0)
  assert.equal(b.hp, PLAYER_HP, 'shield did not absorb the hit')
  assert.equal(b.shielded, false, 'shield was not spent')
})

test('building drops a wall ahead of your aim and costs a charge', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 5.5
  p.y = 10.5
  p.aim = 0

  assert.equal(build(m, p.id), true)
  assert.equal(m.walls[cell(6, 10)], WALL_HP)
  assert.equal(p.charges, BUILD_CHARGES - 1)

  // The same cell is already taken.
  assert.equal(build(m, p.id), false)
  assert.equal(p.charges, BUILD_CHARGES - 1)
})

test('a fresh spawn can fire whichever weapon it picks up, at once', () => {
  for (const kind of ['shotgun', 'rapid', null]) {
    const { m, players } = playing()
    clearWalls(m)
    const p = players[0]
    p.x = 16
    p.y = 10
    if (kind) {
      p.held = kind
      usePowerup(m, p.id)
    }
    setInput(m, p.id, { dx: 0, dy: 0, aim: -Math.PI / 2, fire: true })
    tick(m, TICK_MS, () => 0)
    assert.ok(m.bullets.length > 0, `a fresh ${kind ?? 'pistol'} would not fire`)
  }
})

test('walls have no cooldown — the charge pool is the only limit', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 5.5
  p.y = 10.5

  // Four walls in one instant, no clock advanced between them.
  const aims = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
  for (const aim of aims) {
    p.aim = aim
    assert.equal(build(m, p.id), true, `refused a wall at aim ${aim}`)
  }
  assert.equal(p.charges, 0)
  assert.equal(m.walls.filter((v) => v > 0).length, BUILD_CHARGES)

  // And the fifth is refused for want of a charge, not for want of a wait.
  p.aim = Math.PI / 4
  assert.equal(build(m, p.id), false)
})

test('you cannot build on top of a player', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  a.x = 5.5
  a.y = 10.5
  a.aim = 0
  b.x = 6.5
  b.y = 10.5

  assert.equal(build(m, a.id), false)
  assert.equal(m.walls[cell(6, 10)], 0)
  assert.equal(a.charges, BUILD_CHARGES)
})

test('charges run out and no build is free', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 5.5
  p.y = 10.5
  p.aim = 0
  p.charges = 0
  assert.equal(build(m, p.id), false)
})

test('a bulwark throws up a U, closed side towards the nearest rival', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [p, rival] = players
  p.x = 5.5
  p.y = 10.5
  rival.x = 12.5 // due east, so the U must close to the east
  rival.y = 10.5

  p.held = 'bulwark'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(p.held, null)

  // Closed side: the whole column in front of the player.
  for (const y of [9, 10, 11]) {
    assert.ok(m.walls[cell(6, y)] > 0, `no wall at 6,${y} on the closed side`)
  }
  // Flanks.
  assert.ok(m.walls[cell(5, 9)] > 0, 'north flank is open')
  assert.ok(m.walls[cell(5, 11)] > 0, 'south flank is open')
  // And an open back, or it is a tomb rather than cover.
  assert.equal(m.walls[cell(4, 10)], 0, 'the U was closed behind the player')
})

test('a bulwark turns to face whichever rival is nearest', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [p, rival] = players
  p.x = 10.5
  p.y = 10.5
  rival.x = 10.5
  rival.y = 4.5 // due north

  p.held = 'bulwark'
  usePowerup(m, p.id)
  for (const x of [9, 10, 11]) assert.ok(m.walls[cell(x, 9)] > 0, `no wall at ${x},9`)
  assert.equal(m.walls[cell(10, 11)], 0, 'closed the side away from the threat')
})

test('a bulwark never walls in the player it is protecting', () => {
  // Off-centre on both axes, so the player's box straddles four cells — the
  // case that made hand-built walls trap people.
  for (const [px, py] of [[5.95, 10.5], [5.5, 10.95], [5.95, 10.95], [5.05, 10.05]]) {
    const { m, players } = playing()
    clearWalls(m)
    const [p, rival] = players
    p.x = px
    p.y = py
    rival.x = 14.5
    rival.y = py

    p.held = 'bulwark'
    usePowerup(m, p.id)

    // Still standing somewhere legal, and still able to leave.
    setInput(m, p.id, { dx: -1, dy: 0, aim: Math.PI })
    const before = p.x
    for (let i = 0; i < 6; i++) tick(m, TICK_MS, () => 0)
    assert.ok(p.x < before, `walled in at ${px},${py}`)
  }
})

test('the dash cooldown is reported as time left, so it can be drawn', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 10
  p.y = 10
  setInput(m, p.id, { dx: 1, dy: 0, aim: 0 })

  assert.equal(snapshot(m).players[0].dashIn, 0, 'a fresh spawn should be ready')
  assert.equal(snapshot(m).dashMax, DASH_COOLDOWN_MS)

  assert.equal(dash(m, p.id), true)
  assert.equal(snapshot(m).players[0].dashIn, DASH_COOLDOWN_MS)

  // It counts down, and never past zero.
  m.now += DASH_COOLDOWN_MS / 2
  const half = snapshot(m).players[0].dashIn
  assert.ok(half > 0 && half < DASH_COOLDOWN_MS, `half way through it reads ${half}`)
  m.now += DASH_COOLDOWN_MS
  assert.equal(snapshot(m).players[0].dashIn, 0)
})

test('bots fill an empty arena so one player still gets a match', () => {
  const { m, bots } = withBots()
  assert.equal(m.players.length, BOT_FILL_TO)
  assert.equal(bots.length, BOT_FILL_TO - 1)
  assert.equal(m.phase, 'playing', 'a lone player was left waiting anyway')
  assert.ok(bots.every((b) => b.alive && b.name.length > 0))
})

test('bots stand down one at a time as people take the slots', () => {
  const { m } = withBots()
  // One human is already in; fill the rest of the arena with people.
  for (let humans = 2; humans <= BOT_FILL_TO; humans++) {
    addPlayer(m, `person${humans}`)
    tick(m, TICK_MS, () => 0.5)
    assert.equal(
      m.players.filter((p) => p.bot).length,
      BOT_FILL_TO - humans,
      `with ${humans} people in, the bot count is wrong`,
    )
    assert.equal(m.players.length, BOT_FILL_TO, 'the arena changed size')
  }
  assert.equal(m.players.filter((p) => p.bot).length, 0, 'a bot outstayed its welcome')
})

test('a bot never keeps a person out of a full arena', () => {
  const { m } = withBots(MAX_PLAYERS, 0)
  assert.equal(m.players.length, MAX_PLAYERS)
  assert.ok(m.players.every((p) => p.bot))

  const person = addPlayer(m, 'latecomer')
  assert.ok(person, 'a person was turned away from an arena full of bots')
  assert.equal(person.bot, false)
  assert.equal(m.players.length, MAX_PLAYERS, 'the arena overflowed')
})

test('a bot shoots at a target in range, cover in the way or not', () => {
  const { m, people, bots } = withBots(2, 1)
  clearWalls(m)
  const bot = bots[0]
  const target = people[0]
  const place = () => {
    bot.x = 5.5
    bot.y = 10.5
    target.x = 10.5
    target.y = 10.5
    bot.thinkAt = 0
  }

  place()
  tick(m, TICK_MS, () => 0.5)
  assert.equal(bot.input.fire, true, 'a bot with an open lane held its fire')
  assert.ok(Math.abs(bot.input.aim) < 0.3, `aimed at ${bot.input.aim} instead of due east`)

  // Cover between them changes nothing: the wall is destructible, so shooting
  // it is how the bot makes progress instead of pinning itself against it.
  for (const y of [9, 10, 11]) m.walls[cell(8, y)] = WALL_HP
  place()
  tick(m, TICK_MS, () => 0.5)
  assert.equal(bot.input.fire, true, 'a bot stopped shooting because of cover')
})

test('a bot shoots its way out rather than grinding on a wall', () => {
  const { m, people, bots } = withBots(2, 1)
  clearWalls(m)
  const bot = bots[0]
  const target = people[0]
  bot.x = 5.5
  bot.y = 10.5
  target.x = 12.5
  target.y = 10.5
  // A slab between them, right up against the bot.
  for (const y of [9, 10, 11]) m.walls[cell(7, y)] = WALL_HP
  const before = m.walls[cell(7, 10)]

  for (let i = 0; i < 60; i++) tick(m, TICK_MS, () => 0.5)
  assert.ok(m.walls[cell(7, 10)] < before, 'the bot never fired at what was blocking it')
})

test('a bot with bombs actually lays them, and moves off the line', () => {
  const { m, people, bots } = withBots(2, 1)
  clearWalls(m)
  const bot = bots[0]
  bot.x = 10.5
  bot.y = 10.5
  bot.held = 'bomb'
  usePowerup(m, bot.id)
  people[0].x = 15.5
  people[0].y = 10.5

  let laid = false
  let n = 0
  let seed = 0.31
  const rng = () => (seed = (seed * 7919) % 1)
  while (!laid && n++ < 200) {
    tick(m, TICK_MS, rng)
    if (m.bombs.length > 0) laid = true
  }
  assert.ok(laid, 'a bot carried bombs the whole time and never laid one')
  assert.ok(bot.duckUntil > m.now, 'the bot did not commit to clearing its own blast')
})

test('a bot goes out of its way for a pickup it can reach', () => {
  const { m, people, bots } = withBots(2, 1)
  clearWalls(m)
  const bot = bots[0]
  const target = people[0]
  bot.x = 16.5
  bot.y = 10.5
  bot.held = null
  target.x = 16.5
  target.y = 4.5 // due north, so heading south means it chose the pickup
  const spot = cell(16, 15)
  m.powerups[spot] = 'medkit'
  assert.ok(Math.abs(15.5 - 10.5) < BOT_PICKUP_RANGE)

  bot.thinkAt = 0
  tick(m, TICK_MS, () => 0.5)
  assert.ok(bot.input.dy > 0.5, `bot headed ${bot.input.dy} instead of towards the pickup`)
  // It keeps shooting at the player while it fetches.
  assert.equal(bot.input.fire, true, 'a bot stopped fighting to go shopping')
})

test('a bot picks a pickup up and then spends it', () => {
  const { m, people, bots } = withBots(2, 1)
  clearWalls(m)
  const bot = bots[0]
  people[0].x = 28.5
  people[0].y = 17.5
  bot.x = 16.5
  bot.y = 10.5
  bot.held = null
  m.powerups[cell(16, 13)] = 'sprint'

  let everHeld = false
  for (let i = 0; i < 90; i++) {
    tick(m, TICK_MS, () => 0.5)
    if (bot.held) everHeld = true
    if (bot.sprintUntil > 0) break
  }
  assert.equal(Object.keys(m.powerups).length, 0, 'the pickup is still lying there')
  assert.ok(bot.sprintUntil > 0, `bot never spent it (held at some point: ${everHeld})`)
})

test('a bot leaves a pickup alone when its hand is already full', () => {
  const { m, people, bots } = withBots(2, 1)
  clearWalls(m)
  const bot = bots[0]
  bot.x = 16.5
  bot.y = 10.5
  bot.held = 'shield'
  people[0].x = 16.5
  people[0].y = 4.5
  m.powerups[cell(16, 15)] = 'medkit'

  bot.thinkAt = 0
  tick(m, TICK_MS, () => 0.5)
  // With a clear line at this range it strafes, so the tell is simply that it
  // is not heading south towards the pickup.
  assert.ok(bot.input.dy < 0.5, `a bot with a full hand went shopping (dy ${bot.input.dy})`)
  assert.ok(POWERUP_MAX > 0)
})

test('a bot holds its fire on something out of range', () => {
  const { m, people, bots } = withBots(2, 1)
  clearWalls(m)
  const bot = bots[0]
  const target = people[0]
  bot.x = 3.5
  bot.y = 10.5
  target.x = 3.5 + BOT_RANGE + 3
  target.y = 10.5

  bot.thinkAt = 0
  tick(m, TICK_MS, () => 0.5)
  assert.equal(bot.input.fire, false, 'a bot burned rounds on someone out of range')
})

test('a bot with no shot closes the distance', () => {
  const { m, people, bots } = withBots(2, 1)
  clearWalls(m)
  const bot = bots[0]
  const target = people[0]
  bot.x = 4.5
  bot.y = 10.5
  target.x = 20.5 // beyond BOT_RANGE, so there is no shot to take
  target.y = 10.5
  assert.ok(20.5 - 4.5 > BOT_RANGE)

  bot.thinkAt = 0
  const before = bot.x
  for (let i = 0; i < 15; i++) tick(m, TICK_MS, () => 0.5)
  assert.ok(bot.x > before + 0.5, `bot stayed put at ${bot.x}`)
})

test('a bot plays by every rule a person does', () => {
  const { m, bots } = withBots()
  const bot = bots[0]
  // Same shape, same fields, same validation path — nothing downstream can
  // tell a bot from a person except the flag itself.
  assert.equal(typeof bot.charges, 'number')
  assert.equal(typeof bot.lastFireAt, 'number')
  const s = snapshot(m)
  assert.ok(s.players.every((q) => typeof q.bot === 'boolean'))
  assert.ok(s.players.some((q) => q.bot === true))
  assert.ok(s.players.some((q) => q.bot === false))
})

test('bots are off unless a match asks for them', () => {
  const m = createMatch(() => 0)
  addPlayer(m, 'solo')
  ensureBots(m, () => 0.5)
  assert.equal(m.players.length, 1, 'bots turned up uninvited')
})

test('a breach in the carved arena grows back, weak', () => {
  const { m, players } = playing()
  // A cell the layout says is cover, shot away to nothing.
  const i = m.layout.findIndex((v, n) => v === 1 && m.walls[n] > 0 && n % W > 3 && n % W < W - 4)
  assert.ok(i >= 0, 'the test arena has no interior cover to break')
  m.walls[i] = 0
  // Keep everyone well clear so nothing blocks the regrowth.
  for (const p of players) {
    p.x = 1.5
    p.y = 1.5
  }

  m.now += REPAIR_EVERY_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(m.walls[i], 1, 'the breach did not close')

  // And it knits back up to full over following sweeps rather than instantly.
  m.now += REPAIR_EVERY_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(m.walls[i], 2)
})

test('a damaged player-built wall is never healed by repair', () => {
  const { m, players } = playing()
  clearWalls(m)
  m.layout.fill(0) // nothing here belongs to the arena
  const p = players[0]
  p.x = 5.5
  p.y = 10.5
  p.aim = 0
  assert.equal(build(m, p.id), true)

  const i = cell(6, 10)
  m.walls[i] = 1 // shot down to its last point
  for (const q of players) {
    q.x = 1.5
    q.y = 1.5
  }
  m.now += REPAIR_EVERY_MS * 3
  tick(m, TICK_MS, () => 0)
  assert.equal(m.walls[i], 1, 'repair knitted up a wall the player owns')
})

test('a wall a player built stays gone once it is destroyed', () => {
  const { m, players } = playing()
  clearWalls(m)
  m.layout.fill(0) // nothing here was ever part of the arena
  const p = players[0]
  p.x = 5.5
  p.y = 10.5
  p.aim = 0
  assert.equal(build(m, p.id), true)
  const i = cell(6, 10)
  assert.ok(m.walls[i] > 0)

  m.walls[i] = 0
  for (const q of players) {
    q.x = 1.5
    q.y = 1.5
  }
  m.now += REPAIR_EVERY_MS * 3
  tick(m, TICK_MS, () => 0)
  assert.equal(m.walls[i], 0, 'ground the player carved was handed back by repair')
})

test('repair never grows a wall on top of somebody', () => {
  const { m, players } = playing()
  clearWalls(m)
  m.layout.fill(1) // every cell wants to be a wall
  const p = players[0]
  p.x = 8.5
  p.y = 8.5

  m.now += REPAIR_EVERY_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(m.walls[cell(8, 8)], 0, 'a wall grew inside the player')

  // And they can still move afterwards.
  setInput(m, p.id, { dx: 0, dy: 0, aim: 0 })
  assert.ok(Number.isFinite(p.x))
})

/** A player holding `kind`, already spent, standing at (x, y) facing east. */
function armed(m, p, kind, x, y) {
  p.x = x
  p.y = y
  p.aim = 0
  p.held = kind
  usePowerup(m, p.id)
}

test('a sword swing kills outright, whatever health they were on', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  b.hp = OVERHEAL_MAX // even a fully buffered target
  b.x = 5 + MELEE_REACH - 0.3
  b.y = 10
  armed(m, a, 'sword', 5, 10)

  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)

  assert.equal(b.alive, false, 'the swing did not connect')
  assert.equal(a.kills, 1)
  assert.equal(m.bullets.length, 0, 'a sword should not be firing rounds')
})

test('a sword only reaches what is in front of it, and not through cover', () => {
  const behind = () => {
    const { m, players } = playing()
    clearWalls(m)
    const [a, b] = players
    b.x = 5 - MELEE_REACH + 0.3 // directly behind
    b.y = 10
    armed(m, a, 'sword', 5, 10)
    setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
    tick(m, TICK_MS, () => 0)
    return b.alive
  }
  const tooFar = () => {
    const { m, players } = playing()
    clearWalls(m)
    const [a, b] = players
    b.x = 5 + MELEE_REACH + 1
    b.y = 10
    armed(m, a, 'sword', 5, 10)
    setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
    tick(m, TICK_MS, () => 0)
    return b.alive
  }
  const throughWall = () => {
    const { m, players } = playing()
    clearWalls(m)
    const [a, b] = players
    b.x = 5 + MELEE_REACH - 0.3
    b.y = 10
    m.walls[cell(6, 10)] = WALL_HP
    armed(m, a, 'sword', 5, 10)
    setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
    tick(m, TICK_MS, () => 0)
    return b.alive
  }
  assert.equal(behind(), true, 'the blade came out of the back of the player')
  assert.equal(tooFar(), true, 'the blade reached further than MELEE_REACH')
  assert.equal(throughWall(), true, 'the blade cut straight through a wall')
})

test('a shield is still one save, even against a sword', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  b.x = 5 + MELEE_REACH - 0.3
  b.y = 10
  b.held = 'shield'
  usePowerup(m, b.id)
  armed(m, a, 'sword', 5, 10)

  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  assert.equal(b.alive, true, 'the shield did not save them')
  assert.equal(b.shielded, false, 'the shield was not spent')

  // The second swing lands, once the cooldown is served.
  m.now += MELEE_COOLDOWN_MS
  b.x = 5 + MELEE_REACH - 0.3
  b.y = 10
  tick(m, TICK_MS, () => 0)
  assert.equal(b.alive, false)
})

test('a bomb takes the place of the wall, and costs the same charge', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  armed(m, p, 'bomb', 5.5, 10.5)

  assert.equal(build(m, p.id), true)
  assert.equal(p.charges, BUILD_CHARGES - 1)
  assert.equal(m.walls[cell(6, 10)], 0, 'a wall went up instead of a bomb')
  assert.equal(m.bombs.length, 1)

  const s = snapshot(m)
  assert.equal(s.bombs.length, 1)
  assert.equal(s.bombs[0].axis, 'x', 'facing east should lay a horizontal blast')
  assert.ok(s.bombs[0].in > 0 && s.bombs[0].in <= BOMB_FUSE_MS)
  assert.equal(s.bombFuse, BOMB_FUSE_MS)
})

test('a bomb levels the whole line it is laid on', () => {
  const { m, players } = playing()
  const p = players[0]
  // Wall the entire row, then blow it.
  for (let x = 1; x < W - 1; x++) m.walls[cell(x, 10)] = WALL_HP
  m.walls[cell(6, 10)] = 0 // somewhere to put it
  armed(m, p, 'bomb', 5.5, 10.5)
  assert.equal(build(m, p.id), true)

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 0)

  for (let x = 1; x < W - 1; x++) {
    assert.equal(m.walls[cell(x, 10)], 0, `the wall at ${x},10 survived the blast`)
  }
  assert.equal(m.bombs.length, 0, 'the bomb is still sitting there')
  assert.ok(m.walls[cell(0, 10)] > 0, 'the blast took the border out with it')
})

test('blowing yourself up costs you a death and earns you nothing', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [p, bystander] = players
  bystander.x = 20
  bystander.y = 3.5 // well off the line

  p.x = 5.5
  p.y = 10.5
  p.aim = 0
  p.held = 'bomb'
  usePowerup(m, p.id)
  assert.equal(build(m, p.id), true)

  // Stand in it.
  const killsBefore = p.kills
  const deathsBefore = p.deaths
  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 0)

  assert.equal(p.alive, false, 'stood in the blast and walked away')
  assert.equal(p.kills, killsBefore, 'a suicide was scored as a kill')
  assert.equal(p.deaths, deathsBefore + 1, 'a suicide was not counted as a death')
  assert.equal(bystander.kills, 0, 'the death was credited to a bystander')

  // The feed still reports it, with the same player on both ends.
  const own = m.events.find((e) => e.k === 'kill' && e.of === p.id)
  assert.ok(own, 'the elimination was never announced')
  assert.equal(own.by, p.id)
})

test('a bomb kills what is standing in the line and nothing else', () => {
  const { m, players } = playing(3)
  clearWalls(m)
  const [p, onLine, offLine] = players
  onLine.x = 20
  onLine.y = 10.5
  offLine.x = 20
  offLine.y = 14.5

  armed(m, p, 'bomb', 5.5, 10.5)
  build(m, p.id)
  p.x = 5.5
  p.y = 3.5 // the layer walks clear of their own blast

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 0)

  assert.equal(onLine.alive, false, 'stood in the blast and lived')
  assert.equal(offLine.alive, true, 'killed someone four rows away')
  assert.equal(p.kills, 1, 'the blast was not credited to whoever laid it')
})

test('a bomb laid facing north cuts a column, not a row', () => {
  const { m, players } = playing()
  const p = players[0]
  p.x = 16.5
  p.y = 10.5
  p.aim = -Math.PI / 2
  p.held = 'bomb'
  usePowerup(m, p.id)
  for (let y = 1; y < H - 1; y++) m.walls[cell(16, y)] = WALL_HP
  m.walls[cell(16, 9)] = 0
  assert.equal(build(m, p.id), true)
  assert.equal(m.bombs[0].axis, 'y')

  m.now += BOMB_FUSE_MS
  tick(m, TICK_MS, () => 0)
  for (let y = 1; y < H - 1; y++) {
    assert.equal(m.walls[cell(16, y)], 0, `the wall at 16,${y} survived`)
  }
})

test('stepping off the line before the fuse runs out saves you', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [p, victim] = players
  victim.x = 20
  victim.y = 10.5
  armed(m, p, 'bomb', 5.5, 10.5)
  build(m, p.id)
  p.x = 5.5
  p.y = 3.5

  // Walk clear while it ticks down.
  setInput(m, victim.id, { dx: 0, dy: 1, aim: 0 })
  const ticks = Math.ceil(BOMB_FUSE_MS / TICK_MS) + 1
  for (let i = 0; i < ticks; i++) tick(m, TICK_MS, () => 0)

  assert.equal(m.bombs.length, 0, 'the bomb never went off')
  assert.equal(victim.alive, true, `caught at y ${victim.y} after walking clear`)
})

/** A match where the first player carries the untouchable name. */
function withDeathless() {
  const m = createMatch()
  const nic = addPlayer(m, DEATHLESS_NAME)
  const other = addPlayer(m, 'rival')
  startMatch(m, () => 0)
  m.nextPowerupAt = Infinity
  clearWalls(m)
  return { m, nic, other }
}

test('the untouchable name is matched exactly, and only for people', () => {
  const m = createMatch()
  assert.equal(addPlayer(m, DEATHLESS_NAME).deathless, true)
  assert.equal(addPlayer(m, `  ${DEATHLESS_NAME.toUpperCase()}  `).deathless, true)
  assert.equal(addPlayer(m, `${DEATHLESS_NAME}olas`).deathless, false)
  assert.equal(addPlayer(m, `x${DEATHLESS_NAME}`).deathless, false)
  assert.equal(addPlayer(m, 'rival').deathless, false)

  // Bots never inherit it, whatever they end up called.
  const b = createMatch()
  b.botFill = 3
  tick(b, TICK_MS, () => 0.5)
  assert.ok(b.players.every((q) => q.deathless === false))
})

test('rounds, blades and blasts all fail to put the untouchable down', () => {
  // Rounds.
  {
    const { m, nic, other } = withDeathless()
    other.x = 5
    other.y = 10
    nic.x = 9
    nic.y = 10
    for (let shot = 0; shot < 6; shot++) {
      nic.x = 9
      nic.y = 10
      setInput(m, other.id, { dx: 0, dy: 0, aim: 0, fire: true })
      tick(m, TICK_MS, () => 0)
      setInput(m, other.id, { dx: 0, dy: 0, aim: 0, fire: false })
      for (let i = 0; i < 6; i++) tick(m, TICK_MS, () => 0)
      m.now += FIRE_COOLDOWN_MS
    }
    assert.equal(nic.alive, true, 'gunfire killed the untouchable')
    assert.equal(nic.hp, PLAYER_HP, 'gunfire took health off the untouchable')
    assert.equal(other.kills, 0)
  }

  // A blade.
  {
    const { m, nic, other } = withDeathless()
    nic.x = 5 + MELEE_REACH - 0.3
    nic.y = 10
    other.x = 5
    other.y = 10
    other.aim = 0
    other.held = 'sword'
    usePowerup(m, other.id)
    setInput(m, other.id, { dx: 0, dy: 0, aim: 0, fire: true })
    tick(m, TICK_MS, () => 0)
    assert.equal(nic.alive, true, 'a blade killed the untouchable')
  }

  // A line charge, standing right in it.
  {
    const { m, nic, other } = withDeathless()
    other.x = 5.5
    other.y = 10.5
    other.aim = 0
    other.held = 'bomb'
    usePowerup(m, other.id)
    build(m, other.id)
    nic.x = 20
    nic.y = 10.5
    other.x = 5.5
    other.y = 3.5
    m.now += BOMB_FUSE_MS
    tick(m, TICK_MS, () => 0)
    assert.equal(nic.alive, true, 'a line charge killed the untouchable')
  }
})

test('the untouchable still shows up as hit, so shooting them reads as landing', () => {
  const { m, nic, other } = withDeathless()
  other.x = 5
  other.y = 10
  nic.x = 9
  nic.y = 10
  setInput(m, other.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, other.id, { dx: 0, dy: 0, aim: 0, fire: false })

  let hit = null
  for (let i = 0; i < 8 && !hit; i++) {
    tick(m, TICK_MS, () => 0)
    hit = m.events.find((e) => e.k === 'hit')
  }
  assert.ok(hit, 'the round passed straight through with no feedback')
  assert.equal(hit.dmg, 0)
})

test('the untouchable fires rounds that end anyone in one hit', () => {
  const { m, nic, other } = withDeathless()
  other.hp = OVERHEAL_MAX // fully buffered, and it will not matter
  nic.x = 5
  nic.y = 10
  nic.aim = 0
  other.x = 9
  other.y = 10

  setInput(m, nic.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, nic.id, { dx: 0, dy: 0, aim: 0, fire: false })
  for (let i = 0; i < 8; i++) tick(m, TICK_MS, () => 0)

  assert.equal(other.alive, false, 'one round did not finish it')
  assert.equal(nic.kills, 1)
})

test('the untouchable fires rounds that chase', () => {
  const { m, nic, other } = withDeathless()
  nic.x = 5
  nic.y = 10
  // Fire due east while the target stands well to the north: a straight round
  // could never reach them.
  other.x = 12
  other.y = 4

  setInput(m, nic.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, nic.id, { dx: 0, dy: 0, aim: 0, fire: false })
  assert.equal(m.bullets.length, 1)
  // Homing runs in the same tick the round is fired, so by now it has already
  // begun to bend north towards the target it was not aimed at.
  const turned = m.bullets[0].vy
  assert.ok(turned < -0.5, `fired due east, but the round is tracking ${turned}`)

  for (let i = 0; i < 20 && m.bullets.length; i++) tick(m, TICK_MS, () => 0)
  assert.equal(other.alive, false, 'the round never found its mark')
})

test('a chasing round never turns on the person who fired it', () => {
  const { m, nic, other } = withDeathless()
  nic.x = 16
  nic.y = 10
  other.alive = false // nobody else alive to chase
  other.hp = 0
  other.respawnAt = m.now + 1e6

  setInput(m, nic.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, nic.id, { dx: 0, dy: 0, aim: 0, fire: false })
  for (let i = 0; i < 25; i++) tick(m, TICK_MS, () => 0)

  assert.equal(nic.alive, true, 'the round came home to roost')
  assert.equal(nic.hp, PLAYER_HP)
})

test('an ordinary round is still an ordinary round', () => {
  const { m, nic, other } = withDeathless()
  // The rival fires: no homing, no one-shot.
  nic.x = 12
  nic.y = 4
  other.x = 5
  other.y = 10
  setInput(m, other.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  assert.equal(m.bullets[0].home, false)
  assert.equal(m.bullets[0].lethal, false)
})

test('a medkit heals MEDKIT_HEAL, and keeps going past full', () => {
  const { m, players } = playing()
  const p = players[0]

  p.hp = 1
  p.held = 'medkit'
  assert.equal(usePowerup(m, p.id), true)
  assert.equal(p.hp, 1 + MEDKIT_HEAL)

  // Already full: the rest becomes a buffer rather than being thrown away.
  p.hp = PLAYER_HP
  p.held = 'medkit'
  usePowerup(m, p.id)
  assert.equal(p.hp, PLAYER_HP + MEDKIT_HEAL)
  assert.ok(p.hp > PLAYER_HP, 'overheal was clipped to full')
  assert.equal(snapshot(m).hpMax, PLAYER_HP, 'the client cannot tell what counts as full')
})

test('overheal is capped, so it cannot be stacked into armour', () => {
  const { m, players } = playing()
  const p = players[0]
  for (let i = 0; i < 5; i++) {
    p.held = 'medkit'
    usePowerup(m, p.id)
  }
  assert.equal(p.hp, OVERHEAL_MAX)
})

test('overheal is a buffer you can be shot through, and dying clears it', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  b.hp = PLAYER_HP
  b.held = 'medkit'
  usePowerup(m, b.id)
  assert.equal(b.hp, OVERHEAL_MAX)

  a.x = 5
  a.y = 10
  b.x = 9
  b.y = 10
  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: false })
  for (let i = 0; i < 8; i++) tick(m, TICK_MS, () => 0)
  assert.equal(b.hp, OVERHEAL_MAX - 1, 'a round did not eat into the buffer')

  // And a respawn hands back ordinary health, never the buffer.
  b.alive = false
  b.respawnAt = m.now
  tick(m, TICK_MS, () => 0)
  assert.equal(b.hp, PLAYER_HP)
})

test('a popup ad blinds everyone except the player who fired it', () => {
  const { m, players } = playing(3)
  const [me, other, dead] = players
  dead.alive = false

  me.held = 'popup'
  assert.equal(usePowerup(m, me.id), true)

  const s = snapshot(m)
  const of = (p) => s.players.find((q) => q.id === p.id).adIn
  assert.equal(of(me), 0, 'the ad blinded the player who fired it')
  assert.equal(of(other), AD_MS)
  assert.equal(of(dead), 0, 'wasted on a corpse')
  assert.equal(s.adMax, AD_MS)
})

test('a popup ad always times out on its own', () => {
  const { m, players } = playing()
  players[0].held = 'popup'
  usePowerup(m, players[0].id)
  assert.ok(snapshot(m).players[1].adIn > 0)

  m.now += AD_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(snapshot(m).players[1].adIn, 0)
})

test('a dash blinks you DASH_DISTANCE cells the way you are moving', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 10
  p.y = 10
  setInput(m, p.id, { dx: 1, dy: 0, aim: 0 })

  assert.equal(dash(m, p.id), true)
  assert.ok(Math.abs(p.x - (10 + DASH_DISTANCE)) < 0.1, `landed at ${p.x}`)
  assert.equal(p.y, 10, 'drifted off the line')

  // And it is on a cooldown, not free.
  assert.equal(dash(m, p.id), false)
  m.now += DASH_COOLDOWN_MS
  assert.equal(dash(m, p.id), true)
})

test('a dash stops at a wall instead of going through it', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 10
  p.y = 10
  m.walls[cell(12, 10)] = WALL_HP
  setInput(m, p.id, { dx: 1, dy: 0, aim: 0 })

  dash(m, p.id)
  assert.ok(p.x < 12 - RADIUS + 0.01, `dashed into the wall at ${p.x}`)
  assert.ok(p.x > 10, 'refused to move at all')
})

test('a dash that would only scrape the wall is refused, not half-taken', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  // Just enough room to creep a fraction of a cell, far less than a dash.
  p.x = 11 - RADIUS - DASH_MIN_GAIN / 2
  p.y = 10
  for (const y of [9, 10, 11]) m.walls[cell(11, y)] = WALL_HP
  setInput(m, p.id, { dx: 1, dy: 0, aim: 0 })

  const before = p.x
  assert.equal(dash(m, p.id), false)
  assert.equal(p.x, before, 'a refused dash still nudged the player')

  // The cooldown was never spent, so the dash is still there when it matters.
  setInput(m, p.id, { dx: -1, dy: 0, aim: Math.PI })
  assert.equal(dash(m, p.id), true)
})

test('a dash with nowhere to go costs nothing', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  // Flush against the wall, so there is not even a fraction of a cell to gain.
  p.x = 11 - RADIUS - 0.01
  p.y = 10
  m.walls[cell(11, 10)] = WALL_HP
  m.walls[cell(11, 9)] = WALL_HP
  m.walls[cell(11, 11)] = WALL_HP
  setInput(m, p.id, { dx: 1, dy: 0, aim: 0 })

  const before = p.x
  assert.equal(dash(m, p.id), false, 'a dash into a wall reported success')
  assert.equal(p.x, before)
  // Cooldown was never spent, so a blocked dash is not a wasted one.
  setInput(m, p.id, { dx: -1, dy: 0, aim: Math.PI })
  assert.equal(dash(m, p.id), true)
})

test('standing still, a dash follows your aim', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 10
  p.y = 10
  p.aim = -Math.PI / 2
  setInput(m, p.id, { dx: 0, dy: 0, aim: -Math.PI / 2 })

  assert.equal(dash(m, p.id), true)
  assert.ok(Math.abs(p.y - (10 - DASH_DISTANCE)) < 0.1, `landed at ${p.y}`)
})

test('the winner is named and identified, so only they get told they won', () => {
  const { m, players } = playing()
  players[1].kills = KILL_TARGET
  tick(m, TICK_MS, () => 0)
  const s = snapshot(m)
  assert.equal(s.phase, 'over')
  assert.equal(s.winner, players[1].name)
  assert.equal(s.winnerId, players[1].id)
  assert.notEqual(s.winnerId, players[0].id)

  m.now += OVER_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(snapshot(m).winnerId, null, 'the previous winner leaked into the next match')
})

test('overcharge punches through cover and hits twice as hard', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  a.x = 5
  a.y = 10
  b.x = 12
  b.y = 10
  m.walls[cell(8, 10)] = WALL_HP
  a.held = 'overcharge'
  usePowerup(m, a.id)
  assert.ok(m.now < a.overchargeUntil)

  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: false })
  for (let i = 0; i < 12; i++) tick(m, TICK_MS, () => 0)

  assert.equal(m.walls[cell(8, 10)], WALL_HP - 2, 'pierced shot did not double-damage the wall')
  assert.equal(b.hp, PLAYER_HP - 2, 'pierced shot did not carry on to the player')
})

test('an overcharged round opens a lane through everything in front of it', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  a.x = 5
  a.y = 10
  b.x = 16
  b.y = 10
  // Three separate layers of cover between shooter and target.
  for (const x of [8, 11, 14]) m.walls[cell(x, 10)] = WALL_HP
  a.held = 'overcharge'
  usePowerup(m, a.id)

  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, a.id, { dx: 0, dy: 0, aim: 0, fire: false })
  for (let i = 0; i < 20; i++) tick(m, TICK_MS, () => 0)

  assert.equal(PIERCE_LAYERS, Infinity, 'overcharge is supposed to be uncapped')
  for (const x of [8, 11, 14]) {
    assert.equal(m.walls[cell(x, 10)], WALL_HP - 2, `layer at ${x} was not punched`)
  }
  assert.equal(b.hp, PLAYER_HP - 2, 'the round stopped short of the player')
})

test('a wall can never be built where it would pin someone in place', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  // Standing near a cell boundary, so the player's box straddles two cells.
  p.x = 5.95
  p.y = 5.95
  p.aim = Math.PI / 4
  const target = cell(
    Math.floor(p.x + Math.cos(p.aim) * BUILD_REACH),
    Math.floor(p.y + Math.sin(p.aim) * BUILD_REACH),
  )

  assert.equal(build(m, p.id), false, 'built a wall on top of itself')
  assert.equal(m.walls[target], 0, 'the trapping wall went up anyway')
  assert.equal(p.charges, BUILD_CHARGES, 'a refused build still cost a charge')

  // And the proof it would have mattered: the player can still move.
  setInput(m, p.id, { dx: 1, dy: 1, aim: p.aim })
  const [x0, y0] = [p.x, p.y]
  for (let i = 0; i < 5; i++) tick(m, TICK_MS, () => 0)
  assert.ok(p.x !== x0 || p.y !== y0, 'player is stuck')
})

test('a wall never traps a bystander either', () => {
  const { m, players } = playing()
  clearWalls(m)
  const [a, b] = players
  a.x = 5.5
  a.y = 10.5
  a.aim = 0
  b.x = 6.95 // box straddles cells 6 and 7
  b.y = 10.5

  assert.equal(build(m, a.id), false)
  assert.equal(m.walls[cell(6, 10)], 0)
})

test('rapid fire empties the magazine RAPID_MULT times faster', () => {
  const shotsIn = (kind) => {
    const { m, players } = playing()
    clearWalls(m)
    const p = players[0]
    p.x = 16
    p.y = 10
    if (kind) {
      p.held = kind
      usePowerup(m, p.id)
    }
    setInput(m, p.id, { dx: 0, dy: 0, aim: -Math.PI / 2, fire: true })
    // Distinct ids, not array length: rounds expire mid-window, so a length
    // delta undercounts exactly the case being measured.
    const seen = new Set()
    for (let i = 0; i < 30; i++) {
      tick(m, TICK_MS, () => 0)
      for (const b of m.bullets) seen.add(b.id)
    }
    return seen.size
  }
  const plain = shotsIn(null)
  const rapid = shotsIn('rapid')
  assert.ok(rapid > plain * 2, `rapid fired ${rapid} against a normal ${plain}`)
  assert.ok(RAPID_MULT > 1 && RAPID_MS > 30 * TICK_MS, 'rapid must outlast the sample window')
})

test('the shotgun throws a spread of pellets on one pull', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 16
  p.y = 10
  p.held = 'shotgun'
  usePowerup(m, p.id)

  setInput(m, p.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  assert.equal(m.bullets.length, SHOTGUN_PELLETS)

  // They fan out: the pellets are not all on the same heading.
  const headings = new Set(m.bullets.map((b) => Math.round(Math.atan2(b.vy, b.vx) * 100)))
  assert.equal(headings.size, SHOTGUN_PELLETS, 'pellets left on identical headings')
  // And the spread is centred on where the player was aiming.
  const mean = m.bullets.reduce((sum, b) => sum + Math.atan2(b.vy, b.vx), 0) / SHOTGUN_PELLETS
  assert.ok(Math.abs(mean) < 0.01, `spread is centred on ${mean}, not on the aim`)
})

test('pellets fall short — that short range is the shotgun trade', () => {
  assert.ok(SHOTGUN_RANGE_MS < BULLET_LIFE_MS)
  assert.ok(SHOTGUN_COOLDOWN_MS > FIRE_COOLDOWN_MS, 'the shotgun must be slower to cycle')

  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 16
  p.y = 10
  p.held = 'shotgun'
  usePowerup(m, p.id)
  setInput(m, p.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, p.id, { dx: 0, dy: 0, aim: 0, fire: false })

  const ticks = Math.ceil(SHOTGUN_RANGE_MS / TICK_MS) + 2
  for (let i = 0; i < ticks; i++) tick(m, TICK_MS, () => 0)
  assert.equal(m.bullets.length, 0, 'pellets outlived their range')
  assert.ok(SHOTGUN_MS > 0)
})

test('sprint makes you faster while it lasts', () => {
  const distance = (sprint) => {
    const { m, players } = playing()
    clearWalls(m)
    const p = players[0]
    p.x = 8
    p.y = 10
    if (sprint) {
      p.held = 'sprint'
      usePowerup(m, p.id)
    }
    setInput(m, p.id, { dx: 1, dy: 0, aim: 0 })
    for (let i = 0; i < 10; i++) tick(m, TICK_MS, () => 0)
    return p.x - 8
  }
  assert.ok(distance(true) > distance(false))
  assert.ok(SPRINT_MS > 10 * TICK_MS, 'sprint must outlast the sample window above')
})

test('walking over a pickup takes it, but only with an empty hand', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 5.5
  p.y = 10.5
  m.powerups[cell(6, 10)] = 'sprint'

  setInput(m, p.id, { dx: 1, dy: 0, aim: 0 })
  for (let i = 0; i < 5; i++) tick(m, TICK_MS, () => 0)
  assert.equal(p.held, 'sprint')
  assert.equal(Object.hasOwn(m.powerups, cell(6, 10)), false)

  // Second pickup stays on the floor: one slot only.
  m.powerups[cell(8, 10)] = 'shield'
  for (let i = 0; i < 12; i++) tick(m, TICK_MS, () => 0)
  assert.equal(p.held, 'sprint')
  assert.equal(m.powerups[cell(8, 10)], 'shield')
})

test('pickups only ever land on open ground', () => {
  const { m } = playing()
  m.nextPowerupAt = m.now
  let seed = 0.5
  const rng = () => (seed = (seed * 7919) % 1)
  for (let i = 0; i < 200; i++) {
    m.nextPowerupAt = m.now
    tick(m, TICK_MS, rng)
  }
  for (const [i, kind] of Object.entries(m.powerups)) {
    assert.equal(m.walls[Number(i)], 0, `pickup ${i} spawned inside a wall`)
    assert.ok(POWERUP_KINDS.includes(kind))
  }
})

test('a junk input frame cannot drive a player to NaN', () => {
  const { m, players } = playing()
  const p = players[0]
  const junk = [
    { dx: NaN, dy: NaN, aim: NaN },
    { dx: '9', dy: {}, aim: '__proto__' },
    { dx: Infinity, dy: -Infinity, aim: Infinity },
    { dx: 1e9, dy: 1e9, aim: 0 },
    null,
  ]
  for (const msg of junk) {
    setInput(m, p.id, msg)
    for (let i = 0; i < 5; i++) tick(m, TICK_MS, () => 0)
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `position went bad on ${JSON.stringify(msg)}`)
    assert.ok(Number.isFinite(p.aim))
  }
})

test('input speed is clamped, so a scripted client cannot outrun anyone', () => {
  const walk = (dx) => {
    const { m, players } = playing()
    clearWalls(m)
    const p = players[0]
    p.x = 4
    p.y = 10
    setInput(m, p.id, { dx, dy: 0, aim: 0 })
    for (let i = 0; i < 10; i++) tick(m, TICK_MS, () => 0)
    return p.x - 4
  }
  assert.ok(Math.abs(walk(50) - walk(1)) < 1e-9)
})

test('firing is rate limited', () => {
  const { m, players } = playing()
  clearWalls(m)
  const p = players[0]
  p.x = 16
  p.y = 10
  setInput(m, p.id, { dx: 0, dy: 0, aim: -Math.PI / 2, fire: true })
  // Well inside one cooldown window.
  const ticks = Math.floor(FIRE_COOLDOWN_MS / TICK_MS) - 1
  for (let i = 0; i < ticks; i++) tick(m, TICK_MS, () => 0)
  assert.equal(m.bullets.length, 1)
})

test('a spent bullet stops existing', () => {
  const { m, players } = playing()
  const p = players[0]
  p.x = 16
  p.y = 10
  setInput(m, p.id, { dx: 0, dy: 0, aim: 0, fire: true })
  tick(m, TICK_MS, () => 0)
  setInput(m, p.id, { dx: 0, dy: 0, aim: 0, fire: false })
  // Long enough to cross the arena and hit the far border whatever the cover.
  const ticks = Math.ceil((W / BULLET_SPEED) * (1000 / TICK_MS)) + 4
  for (let i = 0; i < ticks; i++) tick(m, TICK_MS, () => 0)
  assert.equal(m.bullets.length, 0)
})

test('the match ends at KILL_TARGET and then starts over', () => {
  const { m, players } = playing()
  players[0].kills = KILL_TARGET
  tick(m, TICK_MS, () => 0)
  assert.equal(m.phase, 'over')
  assert.equal(m.winner, players[0].name)

  m.now += OVER_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(m.phase, 'playing')
  assert.equal(players[0].kills, 0, 'scores were not reset')
})

test('an empty match falls back to waiting instead of restarting', () => {
  const { m, players } = playing()
  players[0].kills = KILL_TARGET
  tick(m, TICK_MS, () => 0)
  for (const p of [...m.players]) removePlayer(m, p.id)

  m.now += OVER_MS
  tick(m, TICK_MS, () => 0)
  assert.equal(m.phase, 'waiting')
})

test('leaving frees the slot and leaves the match standing', () => {
  const { m, players } = playing()
  removePlayer(m, players[0].id)
  assert.equal(m.players.length, 1)
  tick(m, TICK_MS, () => 0)
  assert.equal(m.phase, 'playing')
  assert.ok(addPlayer(m, 'replacement'))
})

test('the snapshot is JSON-safe and rounded', () => {
  const { m, players } = playing()
  players[0].x = 5.123456
  const s = JSON.parse(JSON.stringify(snapshot(m)))
  assert.equal(s.t, 'state')
  assert.equal(s.w, W)
  assert.equal(s.h, H)
  assert.equal(s.walls.length, W * H)
  assert.equal(s.players[0].x, 5.12)
  assert.ok(s.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
})

test('SPAWNS is symmetric, so no half of the arena is the good half', () => {
  const spots = new Set(SPAWNS.map(([x, y]) => `${x},${y}`))
  for (const [x, y] of SPAWNS) {
    assert.ok(spots.has(`${W - 1 - x},${H - 1 - y}`), `${x},${y} has no mirrored partner`)
  }
})

test('every powerup kind does something and empties your hand', () => {
  for (const kind of POWERUP_KINDS) {
    const { m, players } = playing()
    const p = players[0]
    p.held = kind
    assert.equal(usePowerup(m, p.id), true, `${kind} was refused`)
    assert.equal(p.held, null)
  }
  // And a bare hand is a no-op, not a crash.
  const { m, players } = playing()
  assert.equal(usePowerup(m, players[0].id), false)
})

test('OVERCHARGE_MS and SPEED stay sane against the tick rate', () => {
  // Guards against a tuning edit that makes a constant meaningless.
  assert.ok(OVERCHARGE_MS > TICK_MS)
  assert.ok(SPEED * (TICK_MS / 1000) < 1 - RADIUS, 'a single tick can now skip a whole cell')
})
