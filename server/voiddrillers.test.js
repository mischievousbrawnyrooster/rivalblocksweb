import test from 'node:test'
import assert from 'node:assert/strict'
import {
  make,
  join,
  leave,
  setInput,
  tick,
  snapshot,
  generateShaft,
  pickGrief,
  encodeMap,
  decodeMap,
  WIDTH,
  DEPTH,
  BLOCK_AIR,
  BLOCK_DIRT,
  BLOCK_STONE,
  BLOCK_BEDROCK,
  BLOCK_GAS,
  BLOCK_GEODE,
  BLOCK_VAULT,
  BLOCK_SABOTAGE,
  BLOCK_OBSIDIAN,
  CHAR_TO_BLOCK,
  TICK_MS,
  GRACE_MS,
  VAULT_Y,
  SPAWN_Y,
  INITIAL_VOID_Y,
  DIRT_HP,
  STONE_HP,
  GAS_HP,
  GEODE_HP,
  SABOTAGE_HP,
  OBSIDIAN_HP,
  DRILL_PULSE_INTERVAL,
  SUPER_DRILL_PULSE_INTERVAL,
  HEAT_DISSIPATE_RATE,
  GAS_HAZARD_RADIUS,
  GAS_HAZARD_TTL_MS,
  BOT_FILL_TO,
  BOT_REACT_MS,
  canRun,
  wantBots,
  ensureBots,
  MIN_PLAYERS
} from './voiddrillers.js'

// A match already past its lobby, so a lone test driller is not left waiting for a rival.
const playing = (options) => Object.assign(make(options), { phase: 'playing' })

test('shaft generation initializes correct dimensions and boundary bedrock', () => {
  const { grid, hp } = generateShaft(42)
  assert.equal(grid.length, WIDTH * DEPTH)
  assert.equal(hp.length, WIDTH * DEPTH)

  // Boundary columns (x = 0 and x = WIDTH - 1) must be bedrock
  for (let y = 0; y < DEPTH; y++) {
    assert.equal(grid[y * WIDTH + 0], BLOCK_BEDROCK, `left boundary bedrock at y=${y}`)
    assert.equal(grid[y * WIDTH + (WIDTH - 1)], BLOCK_BEDROCK, `right boundary bedrock at y=${y}`)
  }

  // Bottom barrier must be bedrock
  for (let x = 0; x < WIDTH; x++) {
    assert.equal(grid[(DEPTH - 1) * WIDTH + x], BLOCK_BEDROCK, `bottom bedrock at x=${x}`)
  }

  // Vault zone at y >= VAULT_Y contains vault platform
  for (let x = 1; x < WIDTH - 1; x++) {
    assert.equal(grid[VAULT_Y * WIDTH + x], BLOCK_VAULT, `vault tile at x=${x}`)
  }
})

test('run-length encoding serializes and compresses the shaft map', () => {
  const { grid } = generateShaft(101)
  const encoded = encodeMap(grid)
  assert.equal(typeof encoded, 'string')
  assert.equal(encoded.length > 0, true)
  assert.equal(encoded.length < grid.length, true, 'compressed string is smaller than raw array')

  // Decode round-trip
  const decoded = decodeMap(encoded)
  assert.equal(decoded.length, grid.length)
  for (let i = 0; i < grid.length; i++) {
    assert.equal(decoded[i], grid[i], `tile mismatch at ${i}`)
  }
})

test('decodeMap resists prototype pollution keys', () => {
  const decoded = decodeMap('1__proto__1constructor1toString')
  assert.equal(decoded.length > 0, true)
  for (const b of decoded) {
    assert.equal(typeof b, 'number')
    assert.equal(b, BLOCK_AIR)
  }
  assert.equal(Object.hasOwn(CHAR_TO_BLOCK, 'constructor'), false)
  assert.equal(Object.hasOwn(CHAR_TO_BLOCK, '__proto__'), false)
})

test('player joins at launch gantry and respects gravity and solid collisions', () => {
  const m = playing({ seed: 123 })
  const p = join(m, { id: 'p1', name: 'DrillerOne' })
  assert.ok(p)
  assert.equal(p.alive, true)
  assert.equal(p.y, SPAWN_Y)

  // Advance simulation by 5 ticks with no inputs
  const initialY = p.y
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)

  // Player stands solid on gantry block
  assert.equal(p.y, initialY, 'player stands on solid gantry')

  // Remove block under player and verify falling
  const belowIdx = Math.floor(p.y + 1) * WIDTH + Math.floor(p.x)
  p.grid[belowIdx] = BLOCK_AIR
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)
  assert.equal(p.y > initialY, true, 'player accelerates downward under gravity')
})

test('player flush against solid right wall does not wall-cling and falls under gravity', () => {
  const m = playing({ seed: 501 })
  const p = join(m, { id: 'p1', name: 'WallHugger' })
  p.x = 5.1 // flush against right wall at column 6 (5.1 + player width + epsilon = 6.0)
  p.y = 10.0
  p.vy = 0

  // Column 6 has solid blocks from y = 10 to 15
  for (let y = 10; y <= 15; y++) {
    p.grid[y * WIDTH + 6] = BLOCK_STONE
    p.hp[y * WIDTH + 6] = STONE_HP
  }
  // Column 5 below player is empty air
  for (let y = 10; y <= 15; y++) {
    p.grid[y * WIDTH + 5] = BLOCK_AIR
    p.hp[y * WIDTH + 5] = 0
  }

  // Tick simulation with no horizontal input
  setInput(m, 'p1', { dx: 0, thrust: false, drill: false, aim: 0 })
  for (let i = 0; i < 5; i++) tick(m, TICK_MS)

  assert.equal(p.y > 10.0, true, 'driller fell downward rather than clinging to right wall')
  assert.equal(p.grounded, false, 'driller is in free-fall')
})

test('drilling damages blocks, builds heat, and triggers overheat lockout', () => {
  const m = playing({ seed: 777 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0

  // Place a stone block directly below player (durability STONE_HP)
  const targetIdx = 11 * WIDTH + 5
  p.grid[targetIdx] = BLOCK_STONE
  p.hp[targetIdx] = STONE_HP

  // Aim downwards (PI / 2) and drill
  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })

  // Tick for 250ms (two drill pulses)
  for (let i = 0; i < 8; i++) tick(m, TICK_MS)

  assert.equal(p.hp[targetIdx] < STONE_HP, true, 'stone block sustained damage')
  assert.equal(p.heat > 0, true, 'drill heat accumulated')

  // Continue drilling until overheated
  while (!p.overheated) {
    tick(m, TICK_MS)
  }
  assert.equal(p.overheated, true, 'overheat breaker tripped at 100% heat')

  // While overheated, drill does not damage
  const hpBefore = p.hp[targetIdx]
  tick(m, TICK_MS)
  assert.equal(p.hp[targetIdx], hpBefore, 'overheated drill produces zero damage')
})

test('destroying gas pocket generates expanding hazard', () => {
  const m = playing({ seed: 888 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0
  const gasIdx = 11 * WIDTH + 5
  p.grid[gasIdx] = BLOCK_GAS
  p.hp[gasIdx] = GAS_HP

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })
  // Drill the gas block
  for (let i = 0; i < 15; i++) tick(m, TICK_MS)

  assert.equal(p.grid[gasIdx], BLOCK_AIR, 'gas block popped into air')
  assert.equal(p.hazards.length > 0, true, 'expanding gas hazard created')
})

test('gas detonation knocks player back, surges heat, scorches fuel, and blows out adjacent dirt', () => {
  const m = playing({ seed: 889 })
  const p = join(m, { id: 'p1', name: 'Blaster' })
  p.x = 5.0
  p.y = 10.0
  p.heat = 0.0
  p.fuel = 1.0

  const gasIdx = 11 * WIDTH + 5
  p.grid[gasIdx] = BLOCK_GAS
  p.hp[gasIdx] = GAS_HP

  // Place adjacent dirt block
  const adjacentDirtIdx = 11 * WIDTH + 6
  p.grid[adjacentDirtIdx] = BLOCK_DIRT
  p.hp[adjacentDirtIdx] = DIRT_HP

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })
  // Drill until detonation
  for (let i = 0; i < 15; i++) tick(m, TICK_MS)

  // Blast assertions
  assert.equal(p.grid[gasIdx], BLOCK_AIR, 'gas block detonated')
  assert.equal(p.grid[adjacentDirtIdx], BLOCK_AIR, 'adjacent dirt blown out by explosive shockwave')
  assert.equal(p.heat > 0, true, 'gas blast surged player heat')
  assert.equal(p.fuel < 1.0, true, 'gas blast scorched player jetpack fuel')
  assert.equal(p.vy !== 0 || p.vx !== 0 || !p.grounded, true, 'gas blast imparted knockback impulse')
})

test('standing in gas hazard cloud induces heat and trips overheat', () => {
  const m = playing({ seed: 890 })
  const p = join(m, { id: 'p1', name: 'GasStander' })
  p.x = 5.0
  p.y = 10.0
  p.heat = 0.0

  // Spawn an active hazard right on the player
  p.hazards.push({
    x: 5.5,
    y: 10.5,
    r: GAS_HAZARD_RADIUS,
    ttl: GAS_HAZARD_TTL_MS
  })

  // Do not drill, just stand inside the toxic aerosol cloud
  setInput(m, 'p1', { dx: 0, thrust: false, drill: false, aim: 0 })
  for (let i = 0; i < 60; i++) tick(m, TICK_MS) // ~1 second

  assert.equal(p.heat > 0, true, 'standing in hazard cloud induced heat')

  // Continue standing until overheat breaker trips
  for (let i = 0; i < 150; i++) tick(m, TICK_MS)
  assert.equal(p.overheated, true, 'lingering in gas cloud tripped overheat lockout')
})

test('collecting geode clears heat and activates super drill', () => {
  const m = playing({ seed: 999 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 5.0
  p.y = 10.0
  p.heat = 0.8
  const geodeIdx = 11 * WIDTH + 5
  p.grid[geodeIdx] = BLOCK_GEODE
  p.hp[geodeIdx] = GEODE_HP

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })
  for (let i = 0; i < 20; i++) tick(m, TICK_MS)

  assert.equal(p.grid[geodeIdx], BLOCK_AIR)
  assert.equal(p.heat, 0, 'drill heat flushed')
  assert.equal(p.superDrillTimer > 0, true, 'super drill active')
})

// --- Per-player shafts ----------------------------------------------------

test('drillers start at a random column on the gantry, not in join order', () => {
  const m = playing({ seed: 70 })
  const first = join(m, { id: 'a', name: 'Ada' }, () => 0.99)
  const second = join(m, { id: 'b', name: 'Grace' }, () => 0)

  assert.equal(first.x, WIDTH - 2, 'the first to join can land hard against the far wall')
  assert.equal(second.x, 1, 'and the second hard against the near one')
  assert.equal(first.y, SPAWN_Y, 'always on the gantry')
})

// Same terrain for everyone, so a race is fair; each digs a copy of their own,
// which the next test holds apart.
test('every driller races the same layout, bots included', () => {
  const m = playing({ seed: 7 })
  const a = join(m, { id: 'a', name: 'Ada' })
  const b = join(m, { id: 'b', name: 'Grace' })
  const bot = join(m, { name: 'Bore', bot: true })

  assert.deepEqual(b.grid, a.grid, 'two drillers face the same terrain')
  assert.deepEqual(bot.grid, a.grid, 'and so does a bot')
})

test('drilling a block in one shaft leaves the same block in a rival shaft standing', () => {
  const m = playing({ seed: 8 })
  const idle = join(m, { id: 'idle', name: 'Ada' })
  const driller = join(m, { id: 'driller', name: 'Grace' })
  const idx = 11 * WIDTH + 5
  for (const p of [idle, driller]) {
    p.x = 5.0
    p.y = 10.0
    p.grid[idx] = BLOCK_DIRT
    p.hp[idx] = DIRT_HP
  }

  setInput(m, 'driller', { drill: true, aim: Math.PI / 2 })
  for (let i = 0; i < 10; i++) tick(m, TICK_MS)

  assert.equal(driller.grid[idx], BLOCK_AIR, 'the driller broke through their own block')
  assert.equal(idle.grid[idx], BLOCK_DIRT, 'the rival block is untouched')
})

test('a gas blast shakes only the driller whose shaft it is in', () => {
  const m = playing({ seed: 9 })
  const bystander = join(m, { id: 'bystander', name: 'Ada' })
  const blaster = join(m, { id: 'blaster', name: 'Grace' })
  const idx = 11 * WIDTH + 5
  for (const p of [bystander, blaster]) {
    p.x = 5.0
    p.y = 10.0
  }
  blaster.grid[idx] = BLOCK_GAS
  blaster.hp[idx] = GAS_HP
  bystander.grid[idx] = BLOCK_STONE
  bystander.hp[idx] = STONE_HP

  setInput(m, 'blaster', { drill: true, aim: Math.PI / 2 })
  for (let i = 0; i < 10; i++) tick(m, TICK_MS)

  assert.equal(blaster.hazards.length > 0, true, 'the cloud hangs in the blaster shaft')
  assert.equal(bystander.hazards.length, 0, 'no cloud in the bystander shaft')
  assert.equal(bystander.heat, 0, 'the bystander took no heat surge')
  assert.equal(bystander.fuel, 1, 'the bystander kept their fuel')
})

// --- Sabotage crystals ----------------------------------------------------

test('sabotage crystals are seeded through the deep strata only', () => {
  const { grid, hp } = generateShaft(42)
  let crystals = 0
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== BLOCK_SABOTAGE) continue
    crystals++
    const y = Math.floor(i / WIDTH)
    assert.equal(y >= 11 && y < VAULT_Y, true, `crystal at y=${y} sits in the deep strata`)
    assert.equal(hp[i], SABOTAGE_HP)
  }
  assert.equal(crystals > 0, true, 'the shaft holds sabotage crystals')
})

test('sabotage crystals are scattered as lone tiles that never touch', () => {
  for (const seed of [1, 7, 42, 99, 12345, 999999]) {
    const { grid } = generateShaft(seed)
    const quarters = new Set()
    for (let y = 11; y < VAULT_Y; y++) {
      for (let x = 1; x < WIDTH - 1; x++) {
        if (grid[y * WIDTH + x] !== BLOCK_SABOTAGE) continue
        quarters.add(Math.floor(((y - 11) * 4) / (VAULT_Y - 11)))
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            assert.notEqual(
              grid[(y + dy) * WIDTH + x + dx],
              BLOCK_SABOTAGE,
              `seed ${seed}: crystals touch at x=${x} y=${y}`,
            )
          }
        }
      }
    }
    assert.equal(quarters.size, 4, `seed ${seed}: crystals reach every quarter of the deep strata`)
  }
})

test('chill is the rare grief, with fog and tremor splitting the rest', () => {
  const counts = { fog: 0, tremor: 0, chill: 0 }
  const rolls = 1000
  for (let i = 0; i < rolls; i++) counts[pickGrief(() => i / rolls)]++

  assert.equal(counts.chill > 0, true, 'chill still happens')
  assert.equal(counts.chill <= rolls * 0.05, true, `chill landed ${counts.chill} times in ${rolls}`)
  assert.equal(Math.abs(counts.fog - counts.tremor) <= 1, true, `fog ${counts.fog}, tremor ${counts.tremor}`)
})

// A driller standing over a crystal, drilling down into it.
function overCrystal(m, id, name) {
  const p = join(m, { id, name })
  p.x = 5.0
  p.y = 10.0
  p.heat = 0.8
  const idx = 11 * WIDTH + 5
  p.grid[idx] = BLOCK_SABOTAGE
  p.hp[idx] = SABOTAGE_HP
  setInput(m, id, { drill: true, aim: Math.PI / 2 })
  return { p, idx }
}

test('breaking a sabotage crystal griefs a living rival and vents the driller heat', () => {
  const m = playing({ seed: 10 })
  const { p: driller, idx } = overCrystal(m, 'd', 'Ada')
  // Joined ahead of the rival, so a pick that forgot to skip the dead lands here.
  const crushed = join(m, { id: 'c', name: 'Linus' })
  crushed.alive = false
  const rival = join(m, { id: 'r', name: 'Grace' })

  // rng pinned to 0: the first living rival, and the first grief listed, fog.
  for (let i = 0; i < 30 && driller.grid[idx] !== BLOCK_AIR; i++) tick(m, TICK_MS, () => 0)

  assert.equal(driller.grid[idx], BLOCK_AIR, 'the crystal shattered')
  assert.equal(driller.heat, 0, 'the driller vented their heat')
  assert.equal(driller.superDrillTimer, 0, 'a crystal is not a geode')
  assert.equal(rival.grief?.type, 'fog')
  assert.equal(rival.grief.by, 'Ada')
  assert.equal(rival.grief.ttl > 0, true)
  assert.equal(rival.alive, true, 'grief is never lethal')
  assert.equal(crushed.grief, null, 'a crushed driller is never a target')
  assert.equal(driller.grief, null, 'nobody sabotages themselves')
})

test('a sabotage crystal with nobody to sabotage only vents heat', () => {
  const m = playing({ seed: 11 })
  const { p: driller, idx } = overCrystal(m, 'd', 'Ada')

  for (let i = 0; i < 30 && driller.grid[idx] !== BLOCK_AIR; i++) tick(m, TICK_MS, () => 0)

  assert.equal(driller.grid[idx], BLOCK_AIR, 'the crystal shattered')
  assert.equal(driller.heat, 0, 'the driller vented their heat')
  assert.equal(driller.superDrillTimer, 0, 'a crystal is not a geode')
  assert.equal(driller.grief, null, 'nobody sabotages themselves')
})

test('grief wears off once its time runs out', () => {
  const m = playing({ seed: 12 })
  const p = join(m, { id: 'p1', name: 'Ada' })
  p.grief = { type: 'tremor', ttl: TICK_MS * 2 + 1, by: 'Grace' }

  tick(m, TICK_MS)
  tick(m, TICK_MS)
  assert.equal(p.grief?.ttl, 1, 'still shaking with a millisecond to go')

  tick(m, TICK_MS)
  assert.equal(p.grief, null, 'the tremor has passed')
})

test('drill chill halves the pulse rate of a normal drill', () => {
  const m = playing({ seed: 13 })
  const idx = 11 * WIDTH + 5
  const park = (id) => {
    const p = join(m, { id, name: id })
    p.x = 5.0
    p.y = 10.0
    p.grid[idx] = BLOCK_STONE
    p.hp[idx] = 200 // more than a second of drilling can take
    setInput(m, id, { drill: true, aim: Math.PI / 2 })
    return p
  }
  const plain = park('plain')
  const chilled = park('chilled')
  chilled.grief = { type: 'chill', ttl: 5000, by: 'Grace' }

  const ticks = 60
  for (let i = 0; i < ticks; i++) tick(m, TICK_MS)

  const ms = ticks * TICK_MS
  assert.equal(200 - plain.hp[idx], Math.floor(ms / DRILL_PULSE_INTERVAL))
  assert.equal(200 - chilled.hp[idx], Math.floor(ms / (DRILL_PULSE_INTERVAL * 2)))
})

test('drill chill halves the pulse rate of a super drill too', () => {
  const m = playing({ seed: 14 })
  const row = 10
  const park = (id) => {
    const p = join(m, { id, name: id })
    p.x = 5.0
    p.y = row
    p.superDrillTimer = 5000
    p.grid[(row + 1) * WIDTH + 5] = BLOCK_BEDROCK // something to stand on
    for (const col of [6, 7]) {
      p.grid[row * WIDTH + col] = BLOCK_STONE
      p.hp[row * WIDTH + col] = STONE_HP
    }
    setInput(m, id, { drill: true, aim: 0 }) // straight right, through 6 then 7
    return p
  }
  const fast = park('fast')
  const chilled = park('chilled')
  chilled.grief = { type: 'chill', ttl: 5000, by: 'Grace' }

  // Long enough for two super pulses, short of two chilled ones.
  const ticks = Math.ceil((SUPER_DRILL_PULSE_INTERVAL * 2) / TICK_MS)
  for (let i = 0; i < ticks; i++) tick(m, TICK_MS)

  assert.equal(fast.grid[row * WIDTH + 7], BLOCK_AIR, 'a super drill is through both blocks')
  assert.equal(chilled.grid[row * WIDTH + 6], BLOCK_AIR, 'a chilled super drill still one-shots stone')
  assert.equal(chilled.grid[row * WIDTH + 7], BLOCK_STONE, 'but at half the pace')
})

test('a snapshot carries only the viewer deltas and hazards, and every driller grief', () => {
  const m = playing({ seed: 15 })
  const a = join(m, { id: 'a', name: 'Ada' })
  const b = join(m, { id: 'b', name: 'Grace' })
  a.deltas.push({ i: 5, t: BLOCK_AIR })
  a.hazards.push({ x: 5.5, y: 10.5, r: GAS_HAZARD_RADIUS, ttl: GAS_HAZARD_TTL_MS })
  b.grief = { type: 'fog', ttl: 1000, by: 'Ada' }

  const forA = snapshot(m, 'a')
  assert.deepEqual(forA.deltas, [{ i: 5, t: BLOCK_AIR }])
  assert.equal(forA.hazards.length, 1)

  const forB = snapshot(m, 'b')
  assert.deepEqual(forB.deltas, [])
  assert.deepEqual(forB.hazards, [])

  const forSpectator = snapshot(m)
  assert.deepEqual(forSpectator.deltas, [])
  assert.deepEqual(forSpectator.hazards, [])

  assert.deepEqual(forA.players.find((p) => p.id === 'b').grief, { type: 'fog', ttl: 1000, by: 'Ada' })
  assert.equal(forA.players.find((p) => p.id === 'a').grief, null)
})

test('seq advances once per tick however many viewers are sent a frame', () => {
  const m = playing({ seed: 16 })
  join(m, { id: 'a', name: 'Ada' })
  join(m, { id: 'b', name: 'Grace' })

  const before = snapshot(m, 'a').seq
  assert.equal(snapshot(m, 'b').seq, before)
  assert.equal(snapshot(m).seq, before)

  tick(m, TICK_MS)
  assert.equal(snapshot(m, 'a').seq, before + 1)
})

test('bots drill through sabotage crystals rather than stalling on them', () => {
  const m = playing({ seed: 404 })
  m.botsOnly = true
  m.botFill = 1
  const bot = join(m, { name: 'Bore', bot: true })
  bot.x = 5.0
  bot.y = 1.0 // feet on row 2
  bot.grid[2 * WIDTH + 5] = BLOCK_SABOTAGE
  bot.hp[2 * WIDTH + 5] = SABOTAGE_HP

  tick(m, BOT_REACT_MS)

  assert.equal(bot.input.drill, true, 'bot drills the crystal underfoot')
  assert.equal(bot.input.aim, Math.PI / 2, 'bot aims down at it')
})

// --- Obsidian ---------------------------------------------------------------

// Milliseconds a driller standing over one block takes to drill through it, or
// Infinity if three seconds of drilling never do.
function msToBreak(type, hp, superDrill) {
  const m = playing({ seed: 80 })
  const p = join(m, { id: 'p1', name: 'Ada' })
  p.x = 5.0
  p.y = 10.0
  const idx = 11 * WIDTH + 5
  p.grid[idx] = type
  p.hp[idx] = hp
  setInput(m, 'p1', { drill: true, aim: Math.PI / 2 })
  for (let t = TICK_MS; t <= 3000; t += TICK_MS) {
    if (superDrill) p.superDrillTimer = 5000
    tick(m, TICK_MS)
    if (p.grid[idx] === BLOCK_AIR) return t
  }
  return Infinity
}

test('obsidian stops a drill without the super drill dead', () => {
  assert.equal(msToBreak(BLOCK_OBSIDIAN, OBSIDIAN_HP, false), Infinity)
})

test('the super drill cuts obsidian, only a little slower than stone takes by hand', () => {
  const obsidian = msToBreak(BLOCK_OBSIDIAN, OBSIDIAN_HP, true)
  const stoneByHand = msToBreak(BLOCK_STONE, STONE_HP, false)
  assert.equal(obsidian > stoneByHand, true, `obsidian ${obsidian} ms, stone by hand ${stoneByHand} ms`)
  assert.equal(obsidian < stoneByHand * 1.5, true, 'and only a little')
})

test('obsidian is rare: lone tiles that never touch, a little thicker deeper down', () => {
  const top = { dirt: 0, stone: 0, obsidian: 0 }
  const deep = { dirt: 0, stone: 0, obsidian: 0 }
  let obsidian = 0
  let tiles = 0
  for (const seed of [1, 7, 42, 99, 12345, 999999]) {
    const { grid } = generateShaft(seed)
    for (let y = 11; y < VAULT_Y; y++) {
      const depth = (y - 11) / (VAULT_Y - 11)
      const band = depth < 0.25 ? top : depth >= 0.75 ? deep : null
      for (let x = 1; x < WIDTH - 1; x++) {
        const block = grid[y * WIDTH + x]
        tiles++
        if (block === BLOCK_OBSIDIAN) {
          obsidian++
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              assert.notEqual(
                grid[(y + dy) * WIDTH + x + dx],
                BLOCK_OBSIDIAN,
                `seed ${seed}: obsidian touches obsidian at x=${x} y=${y}`,
              )
            }
          }
        }
        if (!band) continue
        if (block === BLOCK_DIRT) band.dirt++
        else if (block === BLOCK_STONE) band.stone++
        else if (block === BLOCK_OBSIDIAN) band.obsidian++
      }
    }
  }
  const share = obsidian / tiles
  assert.equal(share > 0 && share < 0.03, true, `obsidian is ${(share * 100).toFixed(1)}% of the deep strata`)
  assert.equal(deep.obsidian > top.obsidian, true, 'there is more obsidian deep down than near the top')
  assert.equal(deep.stone > deep.dirt, true, 'and deep down, stone still outnumbers dirt')
})

test('a driller without the super drill always has a way down past obsidian and bedrock', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { grid } = generateShaft(seed)
    const queue = []
    const seen = new Set()
    for (let x = 1; x < WIDTH - 1; x++) {
      queue.push(WIDTH + x) // row 1: the open air of the launch gantry
      seen.add(WIDTH + x)
    }
    let reached = false
    for (let head = 0; head < queue.length && !reached; head++) {
      const i = queue[head]
      if (Math.floor(i / WIDTH) === VAULT_Y - 1) reached = true
      for (const j of [i + WIDTH, i - 1, i + 1, i - WIDTH]) {
        const x = j % WIDTH
        if (j < 0 || x < 1 || x > WIDTH - 2 || seen.has(j)) continue
        seen.add(j)
        if (grid[j] === BLOCK_BEDROCK || grid[j] === BLOCK_OBSIDIAN || grid[j] === BLOCK_VAULT) continue
        queue.push(j)
      }
    }
    assert.equal(reached, true, `seed ${seed}: the vault is sealed off to anyone without the super drill`)
  }
})

// --- Void, vault, and terrain ---------------------------------------------

test('crush void advances after grace period and crushes drillers', () => {
  const m = playing({ seed: 555 })
  const p = join(m, { id: 'p1', name: 'SlowDriller' })
  p.x = 5.0
  p.y = SPAWN_Y

  assert.equal(m.voidY, INITIAL_VOID_Y)

  // Advance past grace period
  for (let t = 0; t < GRACE_MS + 1000; t += TICK_MS) tick(m, TICK_MS)

  assert.equal(m.voidY > INITIAL_VOID_Y, true, 'void is descending')

  // Advance until void passes player position
  while (m.voidY < p.y) {
    tick(m, TICK_MS)
  }
  tick(m, TICK_MS)

  assert.equal(p.alive, false, 'player eliminated by crush void')
  assert.equal(m.phase, 'over', 'match over when all drillers crushed')
})

test('crush void accelerates with depth', () => {
  const m = playing({ seed: 505 })
  m.elapsed = GRACE_MS + 1000
  m.voidY = 100.0 // deep in the shaft
  const voidYBefore = m.voidY
  tick(m, 1000)
  const deltaDeep = m.voidY - voidYBefore

  const m2 = playing({ seed: 506 })
  m2.elapsed = GRACE_MS + 1000
  m2.voidY = 10.0 // shallow in the shaft
  const voidY2Before = m2.voidY
  tick(m2, 1000)
  const deltaShallow = m2.voidY - voidY2Before

  assert.equal(deltaDeep > deltaShallow, true, 'void moves faster at deeper depth')
})

test('first driller to touch extraction vault wins', () => {
  const m = playing({ seed: 333 })
  const p1 = join(m, { id: 'p1', name: 'Speedy' })
  join(m, { id: 'p2', name: 'Second' })

  // Teleport p1 onto the extraction vault
  p1.y = VAULT_Y + 0.5
  tick(m, TICK_MS)

  assert.equal(m.phase, 'over')
  assert.equal(m.winner, 'p1', 'p1 reached vault and won match')
})

test('driller landing on top of extraction vault platform wins', () => {
  const m = playing({ seed: 334 })
  const p1 = join(m, { id: 'p1', name: 'Speedy' })
  // Clear the block at row 249 right above the vault platform
  p1.grid[249 * WIDTH + 5] = BLOCK_AIR
  p1.x = 5.0
  p1.y = VAULT_Y - 1.2
  p1.grounded = false
  for (let i = 0; i < 120 && m.phase === 'playing'; i++) tick(m, TICK_MS)

  assert.equal(m.phase, 'over', 'landing on vault triggers match over')
  assert.equal(m.winner, 'p1', 'touchdown on vault platform awards victory')
})

test('the clear time stops the moment someone reaches the vault', () => {
  const m = playing({ seed: 335 })
  const winner = join(m, { id: 'w', name: 'Ada' })
  join(m, { id: 'r', name: 'Grace' })
  winner.y = VAULT_Y - 0.5

  tick(m, TICK_MS)
  assert.equal(m.phase, 'over')
  const clear = m.elapsed

  for (let i = 0; i < 60; i++) tick(m, TICK_MS) // a second of the results screen
  assert.equal(m.elapsed, clear, 'the clock stopped with the winner')
  assert.equal(snapshot(m).elapsed, clear, 'and that is the time every page is shown')
})

test('procedural bedrock obstacle shelves generate throughout shaft with bypass openings', () => {
  const { grid } = generateShaft(42)
  let shelfCount = 0
  for (let y = 12; y < VAULT_Y - 5; y++) {
    let internalBedrock = 0
    for (let x = 1; x < WIDTH - 1; x++) {
      if (grid[y * WIDTH + x] === BLOCK_BEDROCK) {
        internalBedrock++
      }
    }
    if (internalBedrock >= 4) {
      shelfCount++
      // Ensure at least 4 contiguous open (non-bedrock) columns in this shelf row
      let maxContiguousOpen = 0
      let curOpen = 0
      for (let x = 1; x < WIDTH - 1; x++) {
        if (grid[y * WIDTH + x] !== BLOCK_BEDROCK) {
          curOpen++
          if (curOpen > maxContiguousOpen) maxContiguousOpen = curOpen
        } else {
          curOpen = 0
        }
      }
      assert.equal(maxContiguousOpen >= 4, true, `shelf at y=${y} must have at least 4 contiguous passable columns`)
    }
  }
  assert.equal(shelfCount >= 10, true, 'shaft should contain at least 10 obstacle shelves across depth')
})

test('standalone bedrock blocks generate by themselves in the strata', () => {
  const { grid, hp } = generateShaft(77)
  let standaloneCount = 0

  for (let y = 12; y < VAULT_Y - 4; y++) {
    for (let x = 2; x < WIDTH - 2; x++) {
      const idx = y * WIDTH + x
      if (grid[idx] === BLOCK_BEDROCK) {
        const left = grid[y * WIDTH + (x - 1)]
        const right = grid[y * WIDTH + (x + 1)]
        const above = grid[(y - 1) * WIDTH + x]
        const below = grid[(y + 1) * WIDTH + x]
        // If isolated from horizontal and vertical bedrock neighbors
        if (left !== BLOCK_BEDROCK && right !== BLOCK_BEDROCK && above !== BLOCK_BEDROCK && below !== BLOCK_BEDROCK) {
          standaloneCount++
          assert.equal(hp[idx], 255, 'standalone bedrock has maximum hardness')
        }
      }
    }
  }

  assert.equal(standaloneCount >= 3, true, 'shaft should contain solitary bedrock blocks generating by themselves')
})

test('procedural bedrock formations vary in patterns and span multiple rows', () => {
  const { grid } = generateShaft(123)
  let multiRowClusterFound = false
  let freestandingMonolithFound = false

  for (let y = 14; y < VAULT_Y - 8; y++) {
    // Check if 3 consecutive rows all contain internal bedrock
    let threeConsecutive = true
    for (let dy = 0; dy < 3; dy++) {
      let rowBedrock = 0
      for (let x = 1; x < WIDTH - 1; x++) {
        if (grid[(y + dy) * WIDTH + x] === BLOCK_BEDROCK) rowBedrock++
      }
      if (rowBedrock < 2) {
        threeConsecutive = false
        break
      }
    }
    if (threeConsecutive) {
      multiRowClusterFound = true
    }

    // Check for freestanding monolith (bedrock in middle with open left and right flanks)
    let leftFlankOpen = true
    let rightFlankOpen = true
    let centerHasBedrock = false

    for (let x = 1; x <= 3; x++) {
      if (grid[y * WIDTH + x] === BLOCK_BEDROCK) leftFlankOpen = false
    }
    for (let x = WIDTH - 4; x < WIDTH - 1; x++) {
      if (grid[y * WIDTH + x] === BLOCK_BEDROCK) rightFlankOpen = false
    }
    for (let x = 6; x <= 13; x++) {
      if (grid[y * WIDTH + x] === BLOCK_BEDROCK) centerHasBedrock = true
    }

    if (leftFlankOpen && rightFlankOpen && centerHasBedrock) {
      freestandingMonolithFound = true
    }
  }

  assert.equal(multiRowClusterFound, true, 'bedrock obstacles should span multi-row 2D formations')
  assert.equal(freestandingMonolithFound, true, 'bedrock obstacles should include freestanding mid-shaft monoliths')
})

test('every row maintains at least 4 contiguous open columns across diverse seeds', () => {
  const seeds = [1, 7, 42, 99, 12345, 999999]
  for (const seed of seeds) {
    const { grid } = generateShaft(seed)
    for (let y = 11; y < VAULT_Y - 1; y++) {
      let maxContiguousOpen = 0
      let curOpen = 0
      for (let x = 1; x < WIDTH - 1; x++) {
        if (grid[y * WIDTH + x] !== BLOCK_BEDROCK) {
          curOpen++
          if (curOpen > maxContiguousOpen) maxContiguousOpen = curOpen
        } else {
          curOpen = 0
        }
      }
      assert.equal(maxContiguousOpen >= 4, true, `seed ${seed} row y=${y} must maintain at least 4 open columns`)
    }
  }
})

test('internal bedrock obstacle shelves cannot be drilled', () => {
  const m = playing({ seed: 42 })
  const p = join(m, { id: 'p1', name: 'Driller' })
  let targetY = -1
  let targetX = -1
  for (let y = 14; y < 50; y++) {
    for (let x = 2; x < WIDTH - 2; x++) {
      if (p.grid[y * WIDTH + x] === BLOCK_BEDROCK) {
        targetY = y
        targetX = x
        break
      }
    }
    if (targetY !== -1) break
  }
  assert.ok(targetY > 0, 'found internal bedrock obstacle')

  p.x = targetX
  p.y = targetY - 1.0
  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI / 2 })
  for (let i = 0; i < 20; i++) tick(m, TICK_MS)

  const idx = targetY * WIDTH + targetX
  assert.equal(p.grid[idx], BLOCK_BEDROCK, 'bedrock shelf block was not destroyed')
})

test('bedrock cannot be damaged by drilling', () => {
  const m = playing({ seed: 111 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  p.x = 1.0
  p.y = 10.0
  // Left border is bedrock (col 0)
  const bedrockIdx = 10 * WIDTH + 0
  assert.equal(p.grid[bedrockIdx], BLOCK_BEDROCK)
  const initialHp = p.hp[bedrockIdx]

  setInput(m, 'p1', { dx: 0, thrust: false, drill: true, aim: Math.PI }) // aim left
  for (let i = 0; i < 8; i++) tick(m, TICK_MS)

  assert.equal(p.grid[bedrockIdx], BLOCK_BEDROCK, 'bedrock still intact')
  assert.equal(p.hp[bedrockIdx], initialHp, 'bedrock hp undamaged')
})

test('jetpack consumes fuel and accelerates upward, recharges on ground', () => {
  const m = playing({ seed: 222 })
  const p = join(m, { id: 'p1', name: 'Flyer' })
  p.x = 5.0
  p.y = 50.0 // mid-shaft
  p.vy = 0
  // Clear surrounding area to ensure free flight
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      p.grid[(50 + dy) * WIDTH + (5 + dx)] = BLOCK_AIR
    }
  }

  // Fire jetpack
  setInput(m, 'p1', { dx: 0, thrust: true, drill: false, aim: 0 })
  for (let i = 0; i < 10; i++) tick(m, TICK_MS)

  assert.equal(p.fuel < 1.0, true, 'fuel consumed during thrust')
  assert.equal(p.vy < 0, true, 'driller accelerated upward')

  // Stop jetpack and place solid block below to recharge
  setInput(m, 'p1', { dx: 0, thrust: false, drill: false, aim: 0 })
  p.x = 5.0
  p.y = 10.0
  p.fuel = 0.2
  p.grid[11 * WIDTH + 5] = BLOCK_STONE
  p.hp[11 * WIDTH + 5] = STONE_HP

  // Fall onto the stone block
  for (let i = 0; i < 10; i++) tick(m, TICK_MS)
  assert.equal(p.y, 10.0, 'landed on solid stone')
  const fuelBefore = p.fuel
  for (let i = 0; i < 10; i++) tick(m, TICK_MS)
  assert.equal(p.fuel > fuelBefore, true, 'fuel recharged on solid ground')
})

test('horizontal movement stops at bedrock border', () => {
  const m = playing({ seed: 444 })
  const p = join(m, { id: 'p1', name: 'Walker' })
  p.x = 2.0
  p.y = SPAWN_Y

  // Walk left toward bedrock wall at col 0
  setInput(m, 'p1', { dx: -1, thrust: false, drill: false, aim: 0 })
  for (let i = 0; i < 30; i++) tick(m, TICK_MS)

  // Column 0 is bedrock, so driller x cannot penetrate into column 0
  assert.equal(p.x >= 0.9, true, 'cannot walk into left border bedrock')
})

// --- Players, bots, and snapshots -----------------------------------------

test('last surviving driller among multiple players wins match', () => {
  const m = playing({ seed: 666 })
  const p1 = join(m, { id: 'p1', name: 'Survivor' })
  const p2 = join(m, { id: 'p2', name: 'Doomed' })

  p1.x = 5.0
  p1.y = 20.0
  p2.x = 8.0
  p2.y = 5.0

  // Void eliminates p2 while p1 is safe ahead
  m.voidY = 10.0
  tick(m, TICK_MS)

  assert.equal(p2.alive, false, 'p2 crushed')
  assert.equal(p1.alive, true, 'p1 still alive')
  assert.equal(m.phase, 'over', 'match ends when 1 driller survives')
  assert.equal(m.winner, 'p1', 'p1 declared winner')
})

test('leaving player triggers survival win for remaining driller', () => {
  const m = playing({ seed: 502 })
  join(m, { id: 'p1', name: 'Stayer' })
  join(m, { id: 'p2', name: 'Leaver' })
  assert.equal(m.phase, 'playing')

  // p2 leaves match
  leave(m, 'p2')

  assert.equal(m.players.size, 1)
  assert.equal(m.phase, 'over', 'match ends when only one player remains')
  assert.equal(m.winner, 'p1', 'remaining player wins by survival')
  assert.equal(m.winReason, 'survival')
})

test('setInput rejects NaN and non-finite inputs without corrupting state', () => {
  const m = playing({ seed: 504 })
  const p = join(m, { id: 'p1', name: 'Tester' })
  const initialDx = p.input.dx
  const initialAim = p.input.aim

  setInput(m, 'p1', { dx: NaN, aim: Infinity })
  assert.equal(p.input.dx, initialDx)
  assert.equal(p.input.aim, initialAim)

  setInput(m, 'p1', { dx: -Infinity, aim: NaN })
  assert.equal(p.input.dx, initialDx)
  assert.equal(p.input.aim, initialAim)
})

test('drilling heat dissipates when idle', () => {
  const m = playing({ seed: 778 })
  const p = join(m, { id: 'p1', name: 'Cooler' })
  p.heat = 0.5
  setInput(m, 'p1', { dx: 0, thrust: false, drill: false, aim: 0 })

  tick(m, 1000) // 1 second idle
  assert.equal(p.heat < 0.5, true, 'heat cooled down')
  assert.equal(Math.abs(p.heat - (0.5 - HEAT_DISSIPATE_RATE)) < 0.05, true, 'heat cooled at HEAT_DISSIPATE_RATE')
})

test('snapshot contains clean public state without leaking private match state', () => {
  const m = playing({ seed: 889 })
  join(m, { id: 'p1', name: 'SnapTester' })
  const snap = snapshot(m, 'p1')

  assert.equal(snap.t, 'snap')
  assert.equal(typeof snap.seq, 'number')
  assert.equal(typeof snap.voidY, 'number')
  assert.equal(Array.isArray(snap.players), true)
  assert.equal(Array.isArray(snap.deltas), true)
  assert.equal(Array.isArray(snap.hazards), true)
  assert.equal(Array.isArray(snap.board), true)
  assert.equal(snap.players.length, 1)
  assert.equal(snap.players[0].name, 'SnapTester')
  assert.equal('grid' in snap.players[0], false, 'a shaft never rides in a snapshot')
})

test('leave removes driller from match', () => {
  const m = playing({ seed: 991 })
  join(m, { id: 'p1', name: 'Player1' })
  join(m, { id: 'p2', name: 'Player2' })
  assert.equal(m.players.size, 2)

  leave(m, 'p1')
  assert.equal(m.players.has('p1'), false)
  assert.equal(m.players.size, 1)
})

test('canRun requires humans unless botsOnly is enabled', () => {
  const m = playing({ seed: 101 })
  assert.equal(canRun(m), false, 'empty match cannot run')

  join(m, { name: 'Bot1', bot: true })
  assert.equal(canRun(m), false, 'bot-only match cannot run without botsOnly')

  m.botsOnly = true
  assert.equal(canRun(m), true, 'bot-only match can run when botsOnly is true')

  m.botsOnly = false
  join(m, { name: 'Human' })
  assert.equal(canRun(m), true, 'match with human can run')
})

test('ensureBots tops up arena to botFill and assigns bot names', () => {
  const m = playing({ seed: 202 })
  m.botFill = BOT_FILL_TO
  wantBots(m)
  assert.equal(m.botsWanted, true)

  join(m, { name: 'SoloPilot' })
  ensureBots(m)

  assert.equal(m.players.size, BOT_FILL_TO)
  const bots = [...m.players.values()].filter((p) => p.bot)
  assert.equal(bots.length, BOT_FILL_TO - 1)

  for (const b of bots) {
    assert.equal(b.bot, true)
    assert.equal(typeof b.name, 'string')
  }
})

test('arriving human players displace bots down to botFill', () => {
  const m = playing({ seed: 303 })
  m.botFill = BOT_FILL_TO
  wantBots(m)
  join(m, { name: 'PlayerA' })
  ensureBots(m)
  assert.equal(m.players.size, BOT_FILL_TO)

  // Second human arrives
  join(m, { name: 'PlayerB' })
  ensureBots(m)
  assert.equal(m.players.size, BOT_FILL_TO)
  assert.equal([...m.players.values()].filter((p) => !p.bot).length, 2)
  assert.equal([...m.players.values()].filter((p) => p.bot).length, BOT_FILL_TO - 2)

  // When human leaves, bots stand down if no humans remain
  for (const p of [...m.players.values()]) {
    if (!p.bot) leave(m, p.id)
  }
  ensureBots(m)
  assert.equal(m.players.size, 0, 'bots stood down after humans left')
})

test('driveBots guides bot driller downwards with drill activation and heat pacing', () => {
  const m = playing({ seed: 404 })
  m.botsOnly = true
  m.botFill = 1
  const bot = join(m, { name: 'DiggerBot', bot: true })
  bot.x = 5.0
  bot.y = 2.0 // standing on platform
  const underY = Math.floor(bot.y + 1.0) + 1
  bot.grid[underY * WIDTH + 5] = BLOCK_DIRT
  bot.hp[underY * WIDTH + 5] = DIRT_HP

  tick(m, BOT_REACT_MS)

  assert.equal(bot.input.aim, Math.PI / 2, 'bot aims downward')
  assert.equal(bot.input.drill, true, 'bot drills destructible terrain')
})

test('bot touching extraction vault platform wins match', () => {
  const m = playing({ seed: 505 })
  m.botsOnly = true
  m.botFill = 1
  const bot = join(m, { name: 'VaultBot', bot: true })
  bot.x = 5.0
  bot.y = VAULT_Y - 1.0

  tick(m, TICK_MS)

  assert.equal(m.phase, 'over')
  assert.equal(m.winner, bot.id)
  assert.equal(m.winReason, 'vault')
})

test('snapshot exposes bot tags and admin properties', () => {
  const m = playing({ seed: 606 })
  m.botFill = BOT_FILL_TO
  m.botsOnly = true
  join(m, { name: 'Robo', bot: true })

  const snap = snapshot(m)
  assert.equal(snap.botFill, BOT_FILL_TO)
  assert.equal(snap.botsOnly, true)
  assert.equal(snap.arena, 'strata-shaft')
  assert.equal(snap.players[0].bot, true)
  assert.equal(snap.players[0].hp, 100)
  assert.equal(snap.players[0].kills, 0)
  assert.equal(snap.players[0].deaths, 0)
})

test('match does not end when all bots die while human player is still alive', () => {
  const m = playing({ seed: 888 })
  m.botFill = BOT_FILL_TO
  wantBots(m)
  const human = join(m, { name: 'HumanSurvivor' })
  ensureBots(m)

  assert.equal(m.players.size, BOT_FILL_TO)
  const bots = [...m.players.values()].filter((p) => p.bot)
  assert.equal(bots.length, BOT_FILL_TO - 1)

  // Kill all the bots
  for (const b of bots) {
    b.alive = false
  }

  tick(m, TICK_MS)

  // Match must NOT be over, human is still alive and digging
  assert.equal(human.alive, true)
  assert.equal(m.phase, 'playing', 'match remains active while human survives')
  assert.equal(m.winner, null)

  // Human reaches the extraction vault
  human.y = VAULT_Y - 0.5
  tick(m, TICK_MS)

  assert.equal(m.phase, 'over', 'human reaching vault claims victory')
  assert.equal(m.winner, human.id)
  assert.equal(m.winReason, 'vault')
})

test('bot paths around bedrock obstacle to find open downward column', () => {
  const m = playing({ seed: 404 })
  m.botsOnly = true
  m.botFill = 1
  const bot = join(m, { name: 'PathfinderBot', bot: true })
  bot.x = 5.0
  bot.y = 1.0 // standing on row 2
  const groundRow = 2

  // Place bedrock directly beneath bot at row 2 col 5
  bot.grid[groundRow * WIDTH + 5] = BLOCK_BEDROCK
  bot.hp[groundRow * WIDTH + 5] = 255

  // Col 4 is also bedrock
  bot.grid[groundRow * WIDTH + 4] = BLOCK_BEDROCK
  bot.hp[groundRow * WIDTH + 4] = 255

  // Col 6 has dirt (open downward path)
  bot.grid[groundRow * WIDTH + 6] = BLOCK_DIRT
  bot.hp[groundRow * WIDTH + 6] = DIRT_HP

  tick(m, BOT_REACT_MS)

  // Bot must detect obstacle and steer towards col 6 (dx > 0)
  assert.equal(bot.input.dx > 0, true, 'bot steers towards open downward column')
})

test('bot excavates dirt and descends through strata', () => {
  const m = playing({ seed: 909 })
  m.botsOnly = true
  m.botFill = 1
  const bot = join(m, { name: 'DeepDigger', bot: true })
  bot.x = 5.0
  bot.y = 1.0
  const initialY = bot.y

  // Put dirt underfoot at row 2 and row 3
  bot.grid[2 * WIDTH + 5] = BLOCK_DIRT
  bot.hp[2 * WIDTH + 5] = DIRT_HP
  bot.grid[3 * WIDTH + 5] = BLOCK_DIRT
  bot.hp[3 * WIDTH + 5] = DIRT_HP

  // Advance simulation for 500ms
  for (let t = 0; t < 500; t += TICK_MS) {
    tick(m, TICK_MS)
  }

  assert.equal(bot.grid[2 * WIDTH + 5], BLOCK_AIR, 'row 2 dirt was excavated')
  assert.equal(bot.y > initialY, true, 'bot descended downwards')
})

// --- Lobby ------------------------------------------------------------------

test('a lone driller waits in the lobby: the void holds and nobody moves', () => {
  const m = make({ seed: 20 })
  const p = join(m, { id: 'p1', name: 'Ada' })
  p.grid[2 * WIDTH + Math.floor(p.x)] = BLOCK_AIR // nothing under their feet

  for (let t = 0; t < GRACE_MS + 1000; t += TICK_MS) tick(m, TICK_MS)

  assert.equal(m.phase, 'waiting')
  assert.equal(m.voidY, INITIAL_VOID_Y, 'the void has not moved')
  assert.equal(m.elapsed, 0, 'the clock has not started')
  assert.equal(p.y, SPAWN_Y, 'the driller is held on the gantry')
})

test('enough drillers arriving starts the match, without bots nobody asked for', () => {
  const m = make({ seed: 21, botFill: BOT_FILL_TO })
  for (let i = 0; i < MIN_PLAYERS; i++) join(m, { name: `Driller ${i}` })

  tick(m, TICK_MS)

  assert.equal(m.phase, 'playing')
  assert.equal([...m.players.values()].some((p) => p.bot), false)
})

test('a lone driller who asks for bots starts at once, against them', () => {
  const m = make({ seed: 22, botFill: BOT_FILL_TO })
  join(m, { id: 'p1', name: 'Ada' })

  tick(m, TICK_MS)
  assert.equal(m.phase, 'waiting', 'still waiting until they ask')

  wantBots(m)
  tick(m, TICK_MS)
  assert.equal(m.phase, 'playing')
  assert.equal(m.players.size, BOT_FILL_TO, 'bots filled the match')
})

test('a bots-only match skips the lobby', () => {
  const m = make({ seed: 23, botFill: BOT_FILL_TO })
  m.botsOnly = true

  tick(m, TICK_MS)

  assert.equal(m.phase, 'playing')
})

// --- Bots racing the void -----------------------------------------------------

// Lays rows of a driller's shaft from strings, top row first, one character per
// column: '#' bedrock, '.' air, 'd' dirt, 's' stone, 'g' gas, 'c' geode, 'o' obsidian.
const PAINT = {
  '#': [BLOCK_BEDROCK, 255],
  '.': [BLOCK_AIR, 0],
  d: [BLOCK_DIRT, DIRT_HP],
  s: [BLOCK_STONE, STONE_HP],
  g: [BLOCK_GAS, GAS_HP],
  c: [BLOCK_GEODE, GEODE_HP],
  o: [BLOCK_OBSIDIAN, OBSIDIAN_HP],
}
function paint(p, top, rows) {
  rows.forEach((row, dy) => {
    assert.equal(row.length, WIDTH, `painted row ${top + dy} must be ${WIDTH} wide`)
    for (let x = 0; x < WIDTH; x++) {
      const [block, hp] = PAINT[row[x]]
      p.grid[(top + dy) * WIDTH + x] = block
      p.hp[(top + dy) * WIDTH + x] = hp
    }
  })
}

// The only bot in a bots-only match, standing at (x, y).
function soloBot(seed, x, y) {
  const m = playing({ seed, botFill: 1 })
  m.botsOnly = true
  const bot = join(m, { name: 'Bore', bot: true })
  bot.x = x
  bot.y = y
  return { m, bot }
}

const run = (m, ms) => {
  for (let t = 0; t < ms; t += TICK_MS) tick(m, TICK_MS, () => 0.5)
}

// The three traps below are the ones headless bot matches kept dying in.

test('a bot resting on the lip of a hole shuffles over it and drops in', () => {
  const { m, bot } = soloBot(40, 5.8, 20) // body on the bedrock at col 5, centre over the hole
  paint(bot, 20, [
    '#..................#',
    '######.#############',
    '######.#############',
    '######.#############',
    '#dddddddddddddddddd#',
  ])
  run(m, 2000)
  assert.equal(bot.y >= 23, true, `the bot dropped down the hole (y=${bot.y.toFixed(2)})`)
})

test('a bot in a pocket under a bedrock shelf digs out the side that actually leads down', () => {
  const { m, bot } = soloBot(41, 8.0, 16)
  paint(bot, 14, [
    '#dddddddddddddddddd#',
    '#ddddd...dddddddddd#',
    '########.dddddddddd#', // the shelf seals off the dirt under its left end
    '#ddd#########dddddd#',
    '#ddd#########dddddd#',
    '#dddddddddddddddddd#',
  ])
  run(m, 3000)
  assert.equal(bot.y >= 18, true, `the bot got below the shelf (y=${bot.y.toFixed(2)})`)
})

test('a bot whose only way down is through gas blasts through it rather than wait to be crushed', () => {
  const { m, bot } = soloBot(42, 4.0, 25)
  paint(bot, 24, [
    '####################',
    '####..g.############',
    '#######.############',
    '#######.############',
    '#dddddddddddddddddd#',
  ])
  run(m, 4000)
  assert.equal(bot.y >= 27, true, `the bot got past the gas (y=${bot.y.toFixed(2)})`)
})

test('a bot out of fuel blasts through gas rather than plan a climb round it', () => {
  const { m, bot } = soloBot(43, 4.0, 27)
  paint(bot, 25, [
    '####################',
    '####.....###########', // a way over the gas, for anyone with fuel to climb
    '####.gg.############',
    '#######d############',
    '#######d############',
    '#dddddddddddddddddd#',
  ])
  bot.fuel = 0
  run(m, 3000)
  assert.equal(bot.y >= 29, true, `the bot got past the gas (y=${bot.y.toFixed(2)})`)
})

test('a bot crosses a gap it would fall into on its jetpack instead of dropping in again and again', () => {
  const { m, bot } = soloBot(44, 1.0, 20)
  paint(bot, 19, [
    '####################',
    '#......#############',
    '###..#d#############', // a pit two columns wide: too wide to walk across
    '###..#d#############',
    '######d#############',
    '######d#############',
    '#dddddddddddddddddd#',
  ])
  run(m, 4000)
  assert.equal(bot.y >= 23, true, `the bot got across and down (y=${bot.y.toFixed(2)})`)
})

// Blocks a driller on the super drill descends in one second through solid stone,
// steered by the bot AI, or by a person simply holding the drill straight down.
function superDescent(asBot) {
  const m = playing({ seed: 60, botFill: 1 })
  m.botsOnly = true
  const p = join(m, { name: 'Bore', bot: asBot })
  paint(p, 9, ['#..................#', ...Array(40).fill('#ssssssssssssssssss#')])
  p.x = 5.0
  p.y = 9
  for (let t = 0; t < 1000; t += TICK_MS) {
    p.superDrillTimer = 5000
    if (!asBot) Object.assign(p.input, { drill: true, aim: Math.PI / 2, dx: 0, thrust: false })
    tick(m, TICK_MS, () => 0.5)
  }
  return p.y - 9
}

test('a bot on the super drill digs down as fast as a player holding the drill', () => {
  const bot = superDescent(true)
  const held = superDescent(false)
  assert.equal(bot >= held * 0.9, true, `bot fell ${bot.toFixed(1)} blocks, held button ${held.toFixed(1)}`)
})

test('a bot goes for a geode in reach before digging down', () => {
  const { m, bot } = soloBot(50, 5.0, 20)
  paint(bot, 20, [
    '#.........c........#', // a geode five columns along its own row
    '#dddddddddddddddddd#',
    '#dddddddddddddddddd#',
  ])
  run(m, 2500)
  assert.equal(bot.superDrillTimer > 0, true, 'the bot broke the geode and has the super drill')
})

test('with the super drill running a bot digs straight down instead of chasing another geode', () => {
  const { m, bot } = soloBot(51, 5.0, 20)
  paint(bot, 20, [
    '#.........c........#',
    '#dddddddddddddddddd#',
    '#dddddddddddddddddd#',
  ])
  bot.superDrillTimer = 5000
  tick(m, BOT_REACT_MS)
  assert.equal(bot.input.aim, Math.PI / 2, 'aiming straight down')
  assert.equal(bot.input.drill, true, 'and drilling')
})

test('a bot without the super drill steers round obsidian instead of grinding at it', () => {
  const { m, bot } = soloBot(53, 5.0, 20)
  paint(bot, 20, [
    '#..................#',
    '#oooooooodooooooooo#', // one dirt gap, at col 9
    '#dddddddddddddddddd#',
  ])
  run(m, 2000)
  assert.equal(bot.y >= 21, true, `the bot dug down through the gap (y=${bot.y.toFixed(2)})`)
})

test('a hot bot keeps drilling rather than waiting for its drill to cool', () => {
  const { m, bot } = soloBot(30, 5.0, 20)
  paint(bot, 20, ['#..................#', '#dddddddddddddddddd#'])
  bot.heat = 0.9
  tick(m, BOT_REACT_MS)
  assert.equal(bot.input.drill, true)
})

test('a falling bot never brakes on its jetpack', () => {
  const { m, bot } = soloBot(31, 5.0, 20.2)
  paint(bot, 20, ['#..................#', '#..................#', '#..................#', '#dddddddddddddddddd#'])
  bot.vy = 11
  bot.grounded = false
  tick(m, BOT_REACT_MS)
  assert.equal(bot.input.thrust, false)
})

test('a bot in a gas cloud keeps digging down instead of stepping aside to wait', () => {
  const { m, bot } = soloBot(32, 4.0, 20)
  paint(bot, 19, [
    '####################',
    '####.###############', // walled in: nowhere to step aside to
    '#dddddddddddddddddd#',
    '#dddddddddddddddddd#',
  ])
  bot.hazards.push({ x: 4.5, y: 20.5, r: GAS_HAZARD_RADIUS, ttl: GAS_HAZARD_TTL_MS })
  run(m, 1500)
  assert.equal(bot.y >= 21, true, `the bot dug down out of the cloud (y=${bot.y.toFixed(2)})`)
})
