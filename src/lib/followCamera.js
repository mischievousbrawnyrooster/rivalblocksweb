// The follow camera's state and maths, kept out of the renderer so they can be
// tested.
//
// This file exists because the input rotation shipped wrong. `KeyW` sent the
// fixed world vector [0, -1] straight to the server while the camera sat at 45
// degrees and its yaw never left the renderer, so W had never once moved the
// player up the screen. The maths that got that wrong is pure, so it belongs
// somewhere a test can reach it.
//
// Pure: no imports, no three.js, no DOM. World coordinates here are three.js's
// — world X is the grid's x, world Z is the grid's y, world Y is height.

export const DIST = 7.5 // how far behind the body the camera sits
export const HEIGHT = 2.2 // and how far above it
export const EYE = 0.9 // what it looks at, above the body's feet
export const PITCH_MIN = 0.15
export const PITCH_MAX = 1.35
export const ORBIT_SPEED = 0.005 // radians per pixel dragged

/** A camera looking at the stack from one corner, a little above. */
export const makeCamera = () => ({ yaw: Math.PI / 4, pitch: 0.6 })

/** Applies a pointer drag, in pixels. Mutates and returns the camera. */
export function orbit(cam, dx, dy) {
  cam.yaw -= dx * ORBIT_SPEED
  cam.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, cam.pitch - dy * ORBIT_SPEED))
  return cam
}

/**
 * The input vector, rotated out of screen space and into the world.
 *
 * The camera at yaw sits at `target + (sin, cos) * DIST` and looks inward, so
 * forward is `(-sin, -cos)` and right is `(cos, -sin)`. An input of [0, -1] is
 * forward and [1, 0] is right.
 *
 * At yaw 0 this returns the input unchanged, which is exactly how the original
 * bug survived a reading: the code looks right until you notice the camera
 * never starts at zero.
 */
export function worldDir(cam, ix, iy) {
  const s = Math.sin(cam.yaw)
  const c = Math.cos(cam.yaw)
  return [c * ix + s * iy, c * iy - s * ix]
}

/**
 * Where the camera goes, given the body it is following.
 *
 * `body.fall` runs 0 to 1 through a drop, so a camera following someone mid-air
 * descends with them rather than snapping when they land. Height is clamped so
 * the camera never ends up under the floor the body is standing on; it may rise
 * above the ceiling, because floors above are drawn transparent and that is a
 * legitimate vantage rather than a glitch.
 */
export function poseFor(cam, body, floorGap) {
  const s = Math.sin(cam.yaw)
  const c = Math.cos(cam.yaw)
  const flat = Math.cos(cam.pitch)
  const feet = -(body.z + (body.fall ?? 0)) * floorGap
  const target = [body.x, feet + EYE, body.y]
  return {
    target,
    position: [
      target[0] + s * flat * DIST,
      Math.max(feet + 0.4, target[1] + Math.sin(cam.pitch) * DIST + HEIGHT),
      target[2] + c * flat * DIST,
    ],
  }
}
