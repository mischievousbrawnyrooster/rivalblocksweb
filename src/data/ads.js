// In-universe advertisements for sidebar banners and in-game popup powerups.

export const ads = [
  {
    id: 'bare-metal',
    sponsor: 'RivalBlocks Infrastructure',
    badge: 'Hardware',
    title: '128-Tick Bare Metal',
    tagline: 'We own the racks. Zero rented netcode.',
    blurb: 'Dedicated servers across 12 worldwide regions with guaranteed 128-tick simulations.',
    cta: 'View live status',
    href: '/servers',
    image: '/art/ads/bare-metal.jpg',
  },
  {
    id: 'combat-pass',
    sponsor: 'RivalBlocks Operations',
    badge: 'Season 4',
    title: 'Combat Pass',
    tagline: '60 tiers of tactical armor and visor dyes.',
    blurb: 'Earn high-impact operator customization kits, kinetic kill tags, and celebration emotes.',
    cta: 'Inspect pass',
    href: '/games/fracture-line',
    image: '/art/ads/combat-pass.jpg',
  },
  {
    id: 'overcharge',
    sponsor: 'Overcharge Battery Co.',
    badge: 'Munitions',
    title: 'Plasma Power Cells',
    tagline: 'Pierce standing cover infinitely.',
    blurb: 'Military-grade tactical power cartridges delivering continuous high-voltage discharge.',
    cta: 'Equip munition',
    href: '/games/fracture-line',
    image: '/art/ads/overcharge.jpg',
  },
  {
    id: 'bulwark',
    sponsor: 'Bulwark Heavy Industries',
    badge: 'Defense',
    title: 'Deployable Kinetic Barriers',
    tagline: 'Stand on ground you made.',
    blurb: 'Self-anchoring titanium barrier slabs with emergency hexagonal forcefield projection.',
    cta: 'Deploy slab',
    href: '/games/fracture-line',
    image: '/art/ads/bulwark.jpg',
  },
  {
    id: 'nitro-boots',
    sponsor: 'Nitro-Stomp Propulsion',
    badge: 'Mobility',
    title: 'Thruster Combat Boots',
    tagline: 'Jump higher, fall slower, stomp harder.',
    blurb: 'Twin hydraulic rocket nozzles engineered for high-altitude multi-floor drop clearance.',
    cta: 'Upgrade kit',
    href: '/games/blockout-royale-3d',
    image: '/art/ads/nitro-boots.jpg',
  },
  {
    id: 'blastworks-promo',
    sponsor: 'Foundry Demolition League',
    badge: 'Tournament',
    title: 'Blastworks Live Shift',
    tagline: 'Everything here is load-bearing.',
    blurb: '8-player free-for-all demolition plant. Chain reactions, rolling charges, and falling steel.',
    cta: 'Enter plant',
    href: '/play/blastworks',
    image: '/art/blastworks.jpg',
  },
  {
    id: 'blockout-3d-promo',
    sponsor: 'Deep Orbit Survival League',
    badge: 'Stacked Arena',
    title: 'Blockout Royale 3D',
    tagline: 'There is always further down.',
    blurb: 'Five-floor vertical stack suspended above the climbing void. Jump, stomp, and survive.',
    cta: 'Drop into stack',
    href: '/play/blockout-royale-3d',
    image: '/art/blockout-royale-3d.jpg',
  },
]

let globalIndex = 0

/** Returns the next ad in rotation, cycling sequentially across page views. */
export function getNextAd() {
  const ad = ads[globalIndex % ads.length]
  globalIndex = (globalIndex + 1) % ads.length
  return ad
}

