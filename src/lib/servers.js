const SORTERS = {
  label: (a, b) => a.label.localeCompare(b.label),
  players: (a, b) => b.players - a.players,
  tickRate: (a, b) => b.tickRate - a.tickRate,
  uptime: (a, b) => b.uptime - a.uptime,
}

/**
 * Filter regions by status and sort them. Returns a new array; the input is
 * never mutated.
 *
 * @param {Array} regions
 * @param {{status?: string, sortBy?: 'label'|'players'|'tickRate'|'uptime'}} opts
 *        status 'all' (or omitted) keeps everything. An unknown sortBy falls
 *        back to label order rather than throwing.
 */
export function filterSortRegions(regions, { status = 'all', sortBy = 'label' } = {}) {
  const kept =
    status === 'all' ? [...regions] : regions.filter((r) => r.status === status)
  return kept.sort(SORTERS[sortBy] ?? SORTERS.label)
}
