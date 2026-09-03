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
    slug: 'blastworks',
    playPath: '/play/blastworks',
    playBlurb:
      'Everyone opens sealed into their own corner of the plant. Blast a way ' +
      'out, take what the rubble gives you, and set a charge where somebody ' +
      'else is going to be. Blasts set off other blasts.',
    title: 'Blastworks',
    tagline: 'Everything here is load-bearing.',
    genre: 'Free-for-all demolition brawler, up to 8',
    status: 'Live — Season 2',
    statusTone: 'live',
    flagship: false,
    platforms: ['PC', 'PS5', 'Xbox Series X|S', 'Switch 2'],
    art: { variant: 'platforms', seed: 733 },
    blurb:
      'A working plant packed wall to wall with material. Charges throw a cross ' +
      'down four galleries at once, take one crate out of each, and set off ' +
      'anything else already ticking. The plant refills what you clear, so the ' +
      'map you fought through is never the map you fight back through.',
    features: [
      {
        title: 'Hard steel, soft stock',
        body:
          'The lattice of posts holding the roof up never moves. Everything ' +
          'packed between them does. Learning which is which, at a glance and ' +
          'at a run, is most of the game.',
      },
      {
        title: 'Chains',
        body:
          'A charge that reaches another charge sets it off, and that one sets ' +
          'off the next. The best kills in Blastworks are laid three galleries ' +
          'away from the person they land on.',
      },
      {
        title: 'The plant refills',
        body:
          'Stock comes back on the floor while the shift runs. A gallery you ' +
          'opened is a gallery you have to keep open, so nobody ever finishes ' +
          'a match standing in the empty room they cleared in the first minute.',
      },
      {
        title: 'Whatever the rubble gives you',
        body:
          'No loadouts. Longer arms, another charge, better boots, a kick and a ' +
          'lifting glove are all buried in the stock, and you lose the lot when ' +
          'you go down. Whoever is ahead has the most to lose.',
      },
      {
        title: 'Four floors',
        body:
          'Foundry, Magazine, Dry House and Scrap Line. Every one is ' +
          'rotationally symmetric, so no corner is the good corner.',
      },
    ],
    serverNote:
      'Chains only resolve the same way for everyone if one machine decides ' +
      'them. That machine is ours.',
    shots: [
      { seed: 12, caption: 'Opening charge into packed stock — Foundry' },
      { seed: 29, caption: 'Four-charge chain down a gallery — Magazine' },
      { seed: 47, caption: 'Kicked charge running a lane — Dry House' },
      { seed: 66, caption: 'Stock refilling behind a cleared route — Scrap Line' },
    ],
  },
  {
    slug: 'blockout-royale',
    playPath: '/play/blockout-royale',
    playBlurb:
      'One shrinking grid, up to eight, one life each. Tiles flash before they ' +
      'drop. Stand on one when it goes and the round is over for you.',
    title: 'Blockout Royale',
    tagline: 'Stay up. That is the whole job.',
    genre: 'Round-based survival brawler, up to 8',
    status: 'Open Beta',
    statusTone: 'beta',
    flagship: false,
    platforms: ['PC', 'iOS', 'Android'],
    art: { variant: 'platforms', seed: 512 },
    blurb:
      'A platform grid that is busy disappearing. Tiles flash a warning, then ' +
      'drop out from under whoever is still standing on them. Rounds are over ' +
      'in under a minute, and you are queued again before you have stopped ' +
      'arguing about the last one.',
    features: [
      {
        title: 'The floor is the clock',
        body:
          'Tiles go in waves, and the board tells you which ones a beat before ' +
          'they do. There is no timer on screen because the floor is the timer.',
      },
      {
        title: 'One life, one round',
        body:
          'No respawns. Go down and you watch the rest of it, which takes ' +
          'seconds, and then the next one starts. Losing costs you nothing but ' +
          'the argument.',
      },
      {
        title: 'Six boards, never the same twice',
        body:
          'Square, disc, diamond, cross, ring and scatter. The arena is cut out ' +
          'of the grid before the round starts, so the shape you are surviving ' +
          'on is new every time.',
      },
      {
        title: 'Something to spend',
        body:
          'A shield to survive one drop, a dash to outrun a wave, a sinkhole to ' +
          'flag the tile under somebody else, and a patch to put floor back. ' +
          'One at a time, and when you use it is the whole decision.',
      },
      {
        title: 'Cross-play, phone to desktop',
        body:
          'One matchmaking pool across PC and mobile. Touch controls are built ' +
          'for the game rather than bolted onto it.',
      },
    ],
    serverNote:
      'Instant queues need spare capacity sitting idle. Ours does.',
    shots: [
      { seed: 8, caption: 'Opening board, every tile intact — square' },
      { seed: 16, caption: 'Wave flagged, a beat before it drops — ring' },
      { seed: 44, caption: 'Down to the centre island — disc' },
      { seed: 71, caption: 'Last tile standing — scatter' },
    ],
  },
]

export const getGame = (slug) => games.find((g) => g.slug === slug)
