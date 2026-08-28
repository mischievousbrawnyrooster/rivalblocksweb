// All marketing copy for the three titles. This file is the CMS.

export const games = [
  {
    slug: 'fracture-line',
    playPath: '/play/fracture-line',
    playBlurb:
      'The arena from above. Shoot a firing line through cover, seal it behind ' +
      'you with a charge of your own, and take what the floor gives you. Up to ' +
      'eight operators, first to twelve eliminations. Drop in alone and the ' +
      'arena fills itself.',
    title: 'Fracture Line',
    tagline: 'Win on ground you made.',
    genre: 'Free-for-all block-destruction shooter, up to 8',
    status: 'Live — Season 4',
    statusTone: 'live',
    flagship: true,
    platforms: ['PC', 'PS5', 'Xbox Series X|S'],
    art: { variant: 'arena', seed: 1701 },
    blurb:
      'Every wall in Fracture Line comes apart under fire, and every operator ' +
      'carries the charges to put one back. Blow a firing line through cover, ' +
      'then seal it behind you. The map you win on is one you carved yourself.',
    features: [
      {
        title: 'Cover comes apart',
        body:
          'Every slab in the arena takes damage and falls. Chew through the wall ' +
          'between you and a held angle rather than walking around it, and watch ' +
          'the concrete go from cracked to holed to gone.',
      },
      {
        title: 'Build to hold',
        body:
          'Every operator carries block charges. Wall a doorway, cut a lane in ' +
          'half, or throw a bulwark up around yourself under fire. Ground taken ' +
          'is ground you have to keep standing.',
      },
      {
        title: 'The arena repairs itself',
        body:
          'Breaches in the map close over. A wall you knock down buys you a lane ' +
          'for a while, not for the rest of the match, so an arena never wears ' +
          'flat. What you build yourself is yours to maintain — that never heals.',
      },
      {
        title: 'A kit you find, not one you pick',
        body:
          'No loadouts. Overcharged rounds, shotguns, blades, line charges, ' +
          'medkits and cover generators sit on the floor, one slot each, and the ' +
          'fight over the slot is as often the fight that decides the round.',
      },
      {
        title: 'Four arenas, no filler',
        body:
          'Kiln, Substation, Drydock and Scrapyard. Every one is rotationally ' +
          'symmetric, so no half of the map is the good half and no spawn is the ' +
          'short straw.',
      },
      {
        title: '128-tick, everywhere',
        body:
          'Not just in one showcase region. Every Fracture Line server in all ' +
          'twelve regions runs at 128 tick, because we own the hardware and set ' +
          'the configuration ourselves.',
      },
    ],
    serverNote:
      'Ranked integrity depends on the server, not the client. We run ours.',
    shots: [
      { seed: 21, caption: 'Firing line opened through standing cover — Kiln' },
      { seed: 34, caption: 'Bulwark thrown up under contact — Substation' },
      { seed: 47, caption: 'Line charge levelling a lane — Drydock' },
      { seed: 58, caption: 'Cover knitting itself back together — Scrapyard' },
    ],
  },
  {
    slug: 'deepshaft',
    title: 'Deepshaft',
    tagline: 'The world keeps digging without you.',
    genre: 'Co-op survival sandbox, 1–8 players',
    status: 'Live',
    statusTone: 'live',
    flagship: false,
    platforms: ['PC', 'PS5', 'Xbox Series X|S', 'Switch 2'],
    art: { variant: 'cavern', seed: 907 },
    blurb:
      'A persistent voxel world that keeps simulating while you are offline. ' +
      'Water still floods, ore still processes, and whatever you left running ' +
      'is still running when you come back.',
    features: [
      {
        title: 'Persistent, always',
        body:
          'Your world is a process on our hardware, not a save file on your ' +
          'machine. Log off mid-build and the pumps keep pumping. Come back a ' +
          'week later to a full smelter or a flooded shaft.',
      },
      {
        title: 'Eight players, one world',
        body:
          'No instancing and no sharding. Everyone digs the same rock, and the ' +
          'tunnel you cut is there for everyone else, permanently.',
      },
      {
        title: 'Depth is the difficulty curve',
        body:
          'Pressure, heat and dark scale with depth rather than with a slider. ' +
          'How far down you go is how hard the game is.',
      },
    ],
    serverNote:
      'Persistent worlds are only a promise if someone keeps the machine on. ' +
      'That machine is ours.',
    shots: [
      { seed: 11, caption: 'Lit main shaft at depth 400' },
      { seed: 25, caption: 'Flooded side gallery, pumps active' },
      { seed: 39, caption: 'Ore processing line running unattended' },
      { seed: 63, caption: 'Cavern breach into open void' },
    ],
  },
  {
    slug: 'blockout-royale',
    playPath: '/play/blockout-royale',
    playBlurb:
      'The full shrinking-grid brawl, scaled down to eight players. Tiles flash ' +
      'before they drop. Stand on one when it goes and you are out.',
    title: 'Blockout Royale',
    tagline: 'Four minutes. Thirty-two players. No floor.',
    genre: 'Round-based party brawler, 32 players',
    status: 'Open Beta',
    statusTone: 'beta',
    flagship: false,
    platforms: ['PC', 'iOS', 'Android'],
    art: { variant: 'platforms', seed: 512 },
    blurb:
      'Thirty-two players on a shrinking platform grid. Blocks fall away under ' +
      'your feet on a timer you can hear coming. Rounds last four minutes, and ' +
      'you queue again before you have stopped laughing.',
    features: [
      {
        title: 'Four-minute rounds',
        body:
          'Long enough to matter, short enough that losing costs you nothing. ' +
          'Queue, play, requeue.',
      },
      {
        title: 'Cross-play, phone to desktop',
        body:
          'One matchmaking pool across PC and mobile. Touch controls are built ' +
          'for the game rather than bolted onto it.',
      },
      {
        title: 'Matchmaking under ten seconds',
        body:
          'Capacity is pre-warmed in every region, so a match is waiting rather ' +
          'than being spun up when you press play.',
      },
    ],
    serverNote:
      'Instant queues need spare capacity sitting idle. Ours does.',
    shots: [
      { seed: 8, caption: 'Opening grid, all tiles intact' },
      { seed: 16, caption: 'Mid-round collapse, outer ring gone' },
      { seed: 44, caption: 'Final eight on the centre island' },
      { seed: 71, caption: 'Last tile standing' },
    ],
  },
]

export const getGame = (slug) => games.find((g) => g.slug === slug)
