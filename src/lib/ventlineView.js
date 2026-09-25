export const projectWorld = (worldX, worldY, cameraX, scale) => ({
  x: (worldX - cameraX) * scale,
  y: worldY * scale,
})

export function projectMap(snapshot, width, height) {
  const viewed = snapshot.players.find(player => player.id === snapshot.viewedId)
  const viewedX = viewed?.x ?? 0
  const behind = snapshot.gates.filter(gate => gate.x < viewedX)
  const ahead = snapshot.gates.filter(gate => gate.x >= viewedX)
  const selected = behind.length ? [...behind.slice(-1), ...ahead.slice(0, 3)] : ahead.slice(0, 4)
  const origin = Math.min(viewedX - 360, selected[0]?.x ?? viewedX - 360)
  const end = Math.max(viewedX + 1080, (selected.at(-1)?.x ?? viewedX) + (selected.at(-1)?.w ?? 0))
  const scaleX = width / (end - origin)
  const scaleY = height / 600
  const gates = selected.map(gate => ({
      ...gate,
      x: (gate.x - origin) * scaleX,
      w: gate.w * scaleX,
      service: { lo: gate.service.lo * scaleY, hi: gate.service.hi * scaleY },
      charged: { lo: gate.charged.lo * scaleY, hi: gate.charged.hi * scaleY },
    }))
  const players = snapshot.players.filter(player => !player.spectating &&
    Number.isFinite(player.x) && Number.isFinite(player.y)).map(player => ({
      id: player.id,
      slot: player.slot,
      x: (player.x - origin) * scaleX,
      y: player.y * scaleY,
      solid: player.id === snapshot.viewedId,
      alive: player.alive,
      label: String(player.slot + 1),
      labelX: (player.x - origin) * scaleX + (player.slot % 2 ? 9 : -9),
      labelY: player.y * scaleY + 3 + Math.floor(player.slot / 2) * 9,
    }))
  return { gates, players }
}
