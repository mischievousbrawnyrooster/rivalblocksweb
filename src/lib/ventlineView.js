export const projectWorld = (worldX, worldY, cameraX, scale) => ({
  x: (worldX - cameraX) * scale,
  y: worldY * scale,
})
