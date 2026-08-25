// ponytail: static mock, swap for a fetch when a real status API exists.

export const regions = [
  { id: 'na-east', label: 'NA East', city: 'Ashburn', status: 'operational', players: 41280, tickRate: 128, uptime: 99.99 },
  { id: 'na-west', label: 'NA West', city: 'Portland', status: 'operational', players: 28640, tickRate: 128, uptime: 99.98 },
  { id: 'na-central', label: 'NA Central', city: 'Dallas', status: 'operational', players: 19105, tickRate: 128, uptime: 99.97 },
  { id: 'eu-west', label: 'EU West', city: 'Dublin', status: 'operational', players: 37420, tickRate: 128, uptime: 99.99 },
  { id: 'eu-central', label: 'EU Central', city: 'Frankfurt', status: 'operational', players: 44970, tickRate: 128, uptime: 99.96 },
  {
    id: 'eu-north',
    label: 'EU North',
    city: 'Stockholm',
    status: 'degraded',
    players: 8830,
    tickRate: 64,
    uptime: 98.71,
    note: 'Upstream transit fault. Matches running at 64 tick while we reroute. No queue impact.',
  },
  { id: 'apac-se', label: 'APAC Southeast', city: 'Singapore', status: 'operational', players: 33510, tickRate: 128, uptime: 99.95 },
  { id: 'apac-ne', label: 'APAC Northeast', city: 'Tokyo', status: 'operational', players: 26890, tickRate: 128, uptime: 99.98 },
  {
    id: 'apac-s',
    label: 'APAC South',
    city: 'Mumbai',
    status: 'maintenance',
    players: 0,
    tickRate: 0,
    uptime: 99.42,
    note: 'Scheduled hardware refresh, 02:00–06:00 IST. Queues routed to Singapore.',
  },
  { id: 'oce', label: 'Oceania', city: 'Sydney', status: 'operational', players: 11240, tickRate: 128, uptime: 99.94 },
  { id: 'sa-east', label: 'South America East', city: 'São Paulo', status: 'operational', players: 15760, tickRate: 128, uptime: 99.91 },
  { id: 'af-south', label: 'Africa South', city: 'Cape Town', status: 'operational', players: 4390, tickRate: 128, uptime: 99.89 },
]

export const statusLabels = {
  operational: 'Operational',
  degraded: 'Degraded',
  maintenance: 'Maintenance',
}

export const fleetStats = {
  regions: regions.length,
  players: regions.reduce((sum, r) => sum + r.players, 0),
  tickRate: 128,
  uptime: 99.98,
}
