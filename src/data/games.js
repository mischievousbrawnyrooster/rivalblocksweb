// All marketing copy for the four titles. This file is the CMS.

export const games = [
  {
    slug: 'fracture-line',
    playPath: '/play/fracture-line',
    playBlurb:
      'The arena from above. Shoot a firing line through cover, seal it behind ' +
      'you, and take what the floor gives you. Eight operators, first to twelve. ' +
      'Drop in alone and the arena fills itself.',
    title: 'Fracture Line',
    tagline: 'Win on ground you made.',
    genre: 'Free-for-all block-destruction shooter, up to 8',
    status: 'Live, Season 4',
    statusTone: 'live',
    flagship: true,
    platforms: ['PC', 'PS5', 'Xbox Series X|S'],
    art: { variant: 'arena', seed: 1701 },
    blurb:
      'Every wall comes apart under fire, and every operator carries the charges ' +
      'to put one back. The map you win on is one you carved yourself.',
    features: [
      {
        title: 'Cover comes apart',
        body:
          'Every slab takes damage and falls. Chew through the wall between you ' +
          'and a held angle instead of walking around it.',
      },
      {
        title: 'Build to hold',
        body:
          'Wall a doorway, cut a lane in half, throw a bulwark up under fire. ' +
          'Ground you take is ground you have to keep standing.',
      },
      {
        title: 'The arena repairs itself',
        body:
          'Breaches close over. A wall you knock down buys you a lane for a ' +
          'while, not for the match. What you build yourself never heals.',
      },
      {
        title: 'A kit you find, not one you pick',
        body:
          'No loadouts. Overcharged rounds, shotguns, blades, line charges, ' +
          'medkits and cover generators sit on the floor, one slot each. The ' +
          'fight over the slot often decides the round.',
      },
      {
        title: 'Four arenas, no filler',
        body:
          'Kiln, Substation, Drydock, Scrapyard. All four are rotationally ' +
          'symmetric, so no half of the map is the good half.',
      },
      {
        title: '128-tick, everywhere',
        body:
          'Not just one showcase region. All twelve run at 128 tick, because we ' +
          'own the hardware and set the configuration ourselves.',
      },
    ],
    serverNote:
      'Ranked integrity depends on the server, not the client. We run ours.',
    shots: [
      { seed: 21, caption: 'Kiln: a firing line opened through standing cover' },
      { seed: 34, caption: 'Substation: a bulwark thrown up under contact' },
      { seed: 47, caption: 'Drydock: a line charge levelling a lane' },
      { seed: 58, caption: 'Scrapyard: cover knitting itself back together' },
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
    status: 'Live, Season 2',
    statusTone: 'live',
    flagship: false,
    platforms: ['PC', 'PS5', 'Xbox Series X|S', 'Switch 2'],
    art: { variant: 'platforms', seed: 733 },
    blurb:
      'A working plant packed wall to wall with material. Charges throw a cross ' +
      'down four galleries at once and set off anything already ticking. The ' +
      'plant refills what you clear, so you never fight back through the same map.',
    features: [
      {
        title: 'Hard steel, soft stock',
        body:
          'The lattice holding the roof up never moves. Everything packed ' +
          'between it does. Telling them apart at a run is most of the game.',
      },
      {
        title: 'Chains',
        body:
          'A charge that reaches another sets it off, and that one sets off the ' +
          'next. The best kills are laid three galleries away.',
      },
      {
        title: 'The plant refills',
        body:
          'Stock comes back while the shift runs. A gallery you opened is one ' +
          'you have to keep open.',
      },
      {
        title: 'Whatever the rubble gives you',
        body:
          'No loadouts. Longer arms, another charge, better boots, a kick and a ' +
          'lifting glove are all buried in the stock. You lose the lot when you ' +
          'go down, so whoever is ahead has the most to lose.',
      },
      {
        title: 'Four floors',
        body:
          'Foundry, Magazine, Dry House, Scrap Line. All four are rotationally ' +
          'symmetric, so no corner is the good corner.',
      },
    ],
    serverNote:
      'Chains only resolve the same way for everyone if one machine decides ' +
      'them. That machine is ours.',
    shots: [
      { seed: 12, caption: 'Foundry: an opening charge into packed stock' },
      { seed: 29, caption: 'Magazine: a four-charge chain down a gallery' },
      { seed: 47, caption: 'Dry House: a kicked charge running a lane' },
      { seed: 66, caption: 'Scrap Line: stock refilling behind a cleared route' },
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
      'drop out from under whoever is still on them. Rounds end inside a minute.',
    features: [
      {
        title: 'The floor is the clock',
        body:
          'Tiles go in waves, and the board tells you which ones a beat before ' +
          'they do. No timer on screen, because the floor is the timer.',
      },
      {
        title: 'One life, one round',
        body:
          'No respawns. Go down and you watch the rest, which takes seconds. ' +
          'Losing costs you nothing but the argument.',
      },
      {
        title: 'Six boards, never the same twice',
        body:
          'Square, disc, diamond, cross, ring, scatter. The arena is cut out of ' +
          'the grid before the round starts.',
      },
      {
        title: 'Something to spend',
        body:
          'Shields, dashes, bridges, kinetic shoves, reinforced anchors, and hover repulsors. ' +
          'One at a time, and when you use it is the whole decision.',
      },
      {
        title: 'Cross-play, phone to desktop',
        body:
          'One matchmaking pool across PC and mobile. Touch controls are built ' +
          'for the game, not bolted onto it.',
      },
    ],
    serverNote:
      'Instant queues need spare capacity sitting idle. Ours does.',
    shots: [
      { seed: 8, caption: 'Square: the opening board, every tile intact' },
      { seed: 16, caption: 'Ring: a wave flagged, a beat before it drops' },
      { seed: 44, caption: 'Disc: down to the centre island' },
      { seed: 71, caption: 'Scatter: the last tile standing' },
    ],
  },
  {
    slug: 'blockout-royale-3d',
    playPath: '/play/blockout-royale-3d',
    playBlurb:
      'Five floors stacked on a shrinking board. Tiles flash before they ' +
      'drop, and floor by floor the void eats the stack from beneath you. ' +
      'Land on someone from above, stomp one through, or watch the floor ' +
      'take the rest.',
    title: 'Blockout Royale 3D',
    tagline: 'There is always further down.',
    genre: 'Stacked survival brawler, up to 8',
    status: 'Early Access',
    statusTone: 'beta',
    flagship: false,
    platforms: ['PC'],
    art: { variant: 'cavern', seed: 903 },
    blurb:
      'Blockout Royale, stacked five floors deep. Waves still flag a tile a ' +
      'beat before it drops. Now falling through one costs a floor, not the ' +
      'round, and the void is closing in from underneath the whole time.',
    features: [
      {
        title: 'Five floors, one stack',
        body:
          'Walk off the edge of a floor and the drop takes you to the one ' +
          'below it. The round does not end there. It gets harder.',
      },
      {
        title: 'The void climbs',
        body:
          'The bottom floor gives way on a clock of its own, eaten from ' +
          'underneath. Camp on top too long and there is nowhere left to land.',
      },
      {
        title: 'A stomp puts you through',
        body:
          'Wind up and break the tile under your feet. Land on someone from ' +
          'above and they go down with you.',
      },
      {
        title: 'Six boards, five floors deep',
        body:
          'Square, disc, diamond, cross, ring, scatter. Every floor draws its ' +
          'own, so no two drops land the same.',
      },
      {
        title: 'A fuller kit',
        body:
          'Shields, dashes, blinks, swaps, bridges, anchors, foresight and ' +
          'more, one at a time. Height is worth holding, so a few of these ' +
          'exist just to take it back.',
      },
      {
        title: 'Orbit and read the whole stack',
        body:
          'Drag to turn the camera. Every floor below yours stays lit, faint ' +
          'enough to read, dark enough that yours is still the one you watch.',
      },
    ],
    serverNote:
      'One clock runs every floor, every wave, every drop. That clock is ours.',
    shots: [
      { seed: 5, caption: 'Floor one: the stack at full height' },
      { seed: 19, caption: 'A wave flagged, one floor down' },
      { seed: 38, caption: 'A stomp opening a floor from above' },
      { seed: 63, caption: 'Two floors left, and the void still climbing' },
    ],
  },
]

export const getGame = (slug) => games.find((g) => g.slug === slug)
