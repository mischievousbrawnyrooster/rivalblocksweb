// Camera poses and world mapping for Cutline's three views. Pure: no three.js,
// no DOM, no import. Everything here is exercised by raceCamera.test.js.
//
// World axes. Game (x, y) on the ground maps to three.js (x, height, y). Game y
// goes to +z and never -z: -z mirrors the world, so a right-hand steer shows as a
// left turn and the minimap disagrees with the view, and nothing errors.
//
// No prediction. The camera eases toward poses built from snapshots the server
// already sent. It trails them; it never runs ahead of them.

export const VIEWS = ['top', 'chase', 'bumper']
export const DEFAULT_VIEW = 'chase'

export const CAR_ROOF = 0.45

// Top-down. The height is DERIVED from how much track the 2D view showed: at
// field of view f a camera at height h sees 2 * h * tan(f / 2) across.
export const VIEW_CELLS = 22
export const TOP_FOV = 35
export const TOP_HEIGHT = VIEW_CELLS / (2 * Math.tan(((TOP_FOV / 2) * Math.PI) / 180))

export const CHASE_DIST = 5.5
export const CHASE_HEIGHT = 3.0
export const CHASE_LOOK_AHEAD = 3.0
export const CHASE_FOV = 65

export const BUMPER_EYE = 0.55
export const BUMPER_FOV = 75
export const BUMPER_SIGHT = 10

// Walls and the chase camera are one setting: see chaseClearance.
export const WALL_HEIGHT = 1.0
export const CHASE_CLEAR_MAX = 1.5

export const HEADING_RATE = 20
export const TOP_POS_RATE = 25
export const CHASE_POS_RATE = 12
export const FOV_RATE = 10
// A frame longer than this is a tab coming back from the background, not a frame.
export const MAX_DT = 0.1

export const MAX_WHEEL_ANGLE = 0.32
// How high a car rises at the top of a jump, in tiles. Render only.
export const AIR_LIFT = 1.2

export const isView = (v) => VIEWS.includes(v)

export function nextView(view) {
  const i = VIEWS.indexOf(view)
  return i < 0 ? DEFAULT_VIEW : VIEWS[(i + 1) % VIEWS.length]
}

/** Game (x, y) at height h, as a three.js position. */
export const toWorld = (x, y, h = 0) => [x, h, y]

/**
 * The three.js yaw for a model built facing +x. three.js rotates about +y as
 * x' = x cos(a) + z sin(a), z' = -x sin(a) + z cos(a), so a heading h needs -h.
 */
export const yawFor = (heading) => -heading

/**
 * Front wheel yaw for a steer of -1, 0 or 1. In the model the car's right is +z,
 * and a wheel yawed by a points along (cos a, 0, -sin a), so right needs a < 0.
 */
export const wheelYawFor = (steer) => (steer ? -steer * MAX_WHEEL_ANGLE : 0)

/** The shortest signed turn from a to b, in [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Frame-rate independent easing: two half steps equal one full step. */
export const ease = (rate, dt) => 1 - Math.exp(-rate * dt)

// Built through toWorld, like every position below, so the camera and the scene
// share one mapping and the handedness tests cover both.
const forwardOf = (h) => toWorld(Math.cos(h), Math.sin(h), 0)
/** d tiles from `from` along the ground direction f, at height h. */
const along = (from, f, d, h) => [from[0] + f[0] * d, h, from[2] + f[2] * d]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/**
 * Where a view wants the camera, for a car at a heading. `nose` is how far ahead
 * of the car's centre the bumper camera sits, passed in by the page as
 * CAR_LENGTH / 2 so this module needs no import.
 */
export function targetPose(view, car, heading, nose) {
  const f = forwardOf(heading)
  const at = toWorld(car.x, car.y, 0)
  if (view === 'top') {
    return { position: along(at, f, 0, TOP_HEIGHT), target: at, fov: TOP_FOV }
  }
  if (view === 'bumper') {
    const eye = along(at, f, nose, BUMPER_EYE)
    return { position: eye, target: along(eye, f, BUMPER_SIGHT, BUMPER_EYE), fov: BUMPER_FOV }
  }
  return {
    position: along(at, f, -CHASE_DIST, CHASE_HEIGHT),
    target: along(at, f, CHASE_LOOK_AHEAD, CAR_ROOF),
    fov: CHASE_FOV,
  }
}

/**
 * The camera's up vector, derived from where it is looking so it is always
 * perpendicular to the view. three.js lookAt breaks when up is parallel to the
 * view, and top-down looks straight down while the other views use world up, so
 * any fixed up vector goes degenerate partway through a switch. This is the true
 * up of a camera pitched down by the view's angle and facing its horizontal
 * direction, which is perpendicular by construction. Looking straight down there
 * is no horizontal direction, so the heading supplies it, and screen-up becomes
 * the car's heading, which is what heading-up top-down means.
 */
export function upFor(position, target, heading) {
  const v = norm(sub(target, position))
  const horizontal = Math.hypot(v[0], v[2])
  const f = forwardOf(heading)
  const hdir = norm([v[0] + f[0] * 1e-3, 0, v[2] + f[2] * 1e-3])
  return norm([hdir[0] * -v[1], horizontal, hdir[2] * -v[1]])
}

export function makeRaceCamera() {
  return { ready: false, heading: 0, position: [0, 0, 0], target: [0, 0, 0], fov: CHASE_FOV }
}

const poseOf = (cam) => ({
  position: cam.position.slice(),
  target: cam.target.slice(),
  up: upFor(cam.position, cam.target, cam.heading),
  fov: cam.fov,
})

/**
 * Advance the camera one frame toward the pose its view wants. Returns the pose
 * to apply, or null if the camera has never had a car to place itself on.
 */
export function stepCamera(cam, view, car, dt, nose) {
  const v = isView(view) ? view : DEFAULT_VIEW

  // Nothing to follow: the lobby, a spectator, or a car not yet in a snapshot.
  // Hold where we are rather than going to the origin or to NaN.
  if (!car || !Number.isFinite(car.x) || !Number.isFinite(car.y)) {
    return cam.ready ? poseOf(cam) : null
  }

  const t = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0
  const heading = Number.isFinite(car.heading) ? car.heading : cam.heading

  if (!cam.ready) {
    // First frame: place the camera exactly, rather than easing in from the origin.
    const p = targetPose(v, car, heading, nose)
    cam.heading = heading
    cam.position = p.position.slice()
    cam.target = p.target.slice()
    cam.fov = p.fov
    cam.ready = true
    return poseOf(cam)
  }

  cam.heading += angleDelta(cam.heading, heading) * ease(HEADING_RATE, t)
  // Kept in [-PI, PI] so a long session of turning one way cannot grow it without bound.
  cam.heading = Math.atan2(Math.sin(cam.heading), Math.cos(cam.heading))

  const p = targetPose(v, car, cam.heading, nose)
  if (v === 'bumper') {
    // Locked. Any lag leaves the camera behind the bumper, inside the car. That
    // holds during a switch too, so switching into bumper is a deliberate cut.
    cam.position = p.position.slice()
    cam.target = p.target.slice()
  } else {
    const k = ease(v === 'top' ? TOP_POS_RATE : CHASE_POS_RATE, t)
    cam.position = lerp3(cam.position, p.position, k)
    cam.target = lerp3(cam.target, p.target, k)
  }
  cam.fov += (p.fov - cam.fov) * ease(FOV_RATE, t)
  return poseOf(cam)
}

/**
 * How far behind the car a wall must be before the chase camera sees over it.
 * The sightline from camera to roof stands at
 * CAR_ROOF + (CHASE_HEIGHT - CAR_ROOF) * (d / CHASE_DIST) at distance d behind
 * the car, so it clears WALL_HEIGHT once d exceeds this. Raise WALL_HEIGHT or
 * lower CHASE_HEIGHT and a player loses sight of their car in a hairpin.
 */
export function chaseClearance() {
  return ((WALL_HEIGHT - CAR_ROOF) / (CHASE_HEIGHT - CAR_ROOF)) * CHASE_DIST
}
