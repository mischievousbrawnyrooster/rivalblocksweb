// The three.js scene for Cutline. It draws what the server sent and nothing else:
// no rule, no simulation, no prediction. Every piece of maths worth testing, the
// axis mapping, car orientation and the camera, lives in raceCamera.js.
//
// Nothing here loads a file. Models are three.js primitives and the ground is a
// canvas drawn in code, so the first frame never waits on the network.
import * as THREE from 'three'
import { GRID, CAR_LENGTH, CAR_WIDTH, MAX_PLAYERS } from '../../server/cutline.js'
import { toWorld, yawFor, wheelYawFor, WALL_HEIGHT, CAR_ROOF } from './raceCamera.js'
import { carLift, RAMP_HEIGHT, RAMP_LENGTH, PIT_DEPTH } from './carLift.js'
import { makePose, stepPose } from './carPose.js'

const MAX_PICKUPS = 64
const MAX_HAZARDS = 32 // the server caps at 16; this is headroom, not a rule
const MAX_SKIDS = 500 // the cap the 2D renderer used
export const MAX_SMOKE = 256
export const SMOKE_MS = 600 // how long a drift's tyre smoke hangs before it is gone

/**
 * An instanced layer whose instances move or come and go: pickups, hazards,
 * skids. It is never frustum culled. An InstancedMesh works out its bounding
 * sphere once, the first time it is culled, and never again, so a layer that
 * moves is judged by where its instances used to be; every pickup vanished
 * whenever that stale sphere was off screen, and flickered as the car turned.
 * Walls and ramps are placed once per circuit before their first draw, so they
 * keep culling.
 */
export function dynamicLayer(geometry, material, max) {
  const mesh = new THREE.InstancedMesh(geometry, material, max)
  mesh.count = 0
  mesh.frustumCulled = false
  return mesh
}

/**
 * A ramp, built facing +x like a car: a box one tile wide whose top edge at -x
 * is pulled down to the ground, so it rises from nothing to RAMP_HEIGHT at +x.
 * Each ramp scales it across to its own width.
 */
function wedgeGeometry() {
  const g = new THREE.BoxGeometry(RAMP_LENGTH, RAMP_HEIGHT, 1)
  g.translate(0, RAMP_HEIGHT / 2, 0)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    if (pos.getX(i) < 0 && pos.getY(i) > 0) pos.setY(i, 0)
  }
  // Every box face has its own vertices, so the slope keeps a flat normal.
  g.computeVertexNormals()
  return g
}

function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * One car, built facing +x so yawFor(heading) turns it onto its heading. Its
 * size is CAR_LENGTH by CAR_WIDTH, the same numbers the hitbox derives from, so
 * the car you see and the car you hit stay the same car.
 */
function buildCar(shared) {
  const paint = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true })
  const brake = new THREE.MeshBasicMaterial({ color: 0x3a0b0b })
  const group = new THREE.Group()

  // The body, cabin and lamps lean, pitch and bounce as one; the wheels stay
  // on the road. carPose.js decides how far.
  const chassis = new THREE.Group()
  group.add(chassis)
  const body = new THREE.Mesh(shared.body, paint)
  body.position.y = 0.2
  const cabin = new THREE.Mesh(shared.cabin, shared.glass)
  cabin.position.set(-CAR_LENGTH * 0.05, CAR_ROOF - 0.1, 0)
  chassis.add(body, cabin)

  const front = []
  for (const [fx, fz] of [
    [0.31, -0.46],
    [0.31, 0.46],
    [-0.31, -0.46],
    [-0.31, 0.46],
  ]) {
    const wheel = new THREE.Mesh(shared.wheel, shared.tyre)
    const pivot = new THREE.Group()
    pivot.position.set(CAR_LENGTH * fx, 0.14, CAR_WIDTH * fz)
    pivot.add(wheel)
    group.add(pivot)
    if (fx > 0) front.push(pivot)
  }

  for (const fz of [-0.3, 0.3]) {
    const head = new THREE.Mesh(shared.lamp, shared.headlight)
    head.position.set(CAR_LENGTH / 2, 0.22, CAR_WIDTH * fz)
    const tail = new THREE.Mesh(shared.lamp, brake)
    tail.position.set(-CAR_LENGTH / 2, 0.22, CAR_WIDTH * fz)
    chassis.add(head, tail)
  }

  // The shadow stays on the ground while the car rises, so it is a sibling of
  // the car rather than a child that would be lifted with it.
  const shadow = new THREE.Mesh(shared.shadow, shared.shadowMat)
  shadow.rotation.x = -Math.PI / 2

  // A shield is a bubble round the car, so it reads by shape, not by colour.
  const bubble = new THREE.Mesh(shared.bubble, shared.bubbleMat)
  bubble.position.y = CAR_ROOF / 2
  bubble.visible = false
  group.add(bubble)

  return { group, chassis, shadow, paint, brake, front, bubble, color: null }
}

export function makeCutlineScene(canvas) {
  // Throws where WebGL is unavailable. The page catches it and says so.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(token('--bg', '#0b0b0d'))
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400)

  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const sun = new THREE.DirectionalLight(0xffffff, 0.85)
  sun.position.set(30, 60, 20)
  scene.add(sun)

  const wallGeo = new THREE.BoxGeometry(1, WALL_HEIGHT, 1)
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x2a2a31 })
  const scratch = new THREE.Object3D()
  const probe = new THREE.Vector3()

  const shared = {
    body: new THREE.BoxGeometry(CAR_LENGTH, 0.22, CAR_WIDTH),
    cabin: new THREE.BoxGeometry(CAR_LENGTH * 0.45, 0.2, CAR_WIDTH * 0.8),
    wheel: new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12).rotateX(Math.PI / 2),
    lamp: new THREE.BoxGeometry(0.05, 0.08, 0.12),
    shadow: new THREE.CircleGeometry(CAR_LENGTH * 0.55, 20),
    glass: new THREE.MeshLambertMaterial({ color: 0x14141a }),
    tyre: new THREE.MeshLambertMaterial({ color: 0x111114 }),
    headlight: new THREE.MeshBasicMaterial({ color: 0xfff5d6 }),
    shadowMat: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
    bubble: new THREE.SphereGeometry(CAR_LENGTH * 0.72, 20, 14),
    bubbleMat: new THREE.MeshBasicMaterial({ color: 0x3ad1c4, transparent: true, opacity: 0.22, depthWrite: false }),
  }
  const pool = Array.from({ length: MAX_PLAYERS }, () => {
    const c = buildCar(shared)
    c.group.visible = false
    c.shadow.visible = false
    scene.add(c.group, c.shadow)
    return c
  })

  const pickupGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55)
  const pickupMat = new THREE.MeshLambertMaterial({ color: 0x3ad1c4 })
  const pickups = dynamicLayer(pickupGeo, pickupMat, MAX_PICKUPS)
  scene.add(pickups)

  const slickGeo = new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2)
  const slickMat = new THREE.MeshBasicMaterial({ color: 0x09090c, transparent: true, opacity: 0.8 })
  const slicks = dynamicLayer(slickGeo, slickMat, MAX_HAZARDS)
  const peelGeo = new THREE.TorusGeometry(0.22, 0.07, 6, 12, Math.PI).rotateX(-Math.PI / 2)
  const peelMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 })
  const peels = dynamicLayer(peelGeo, peelMat, MAX_HAZARDS)
  // A puck is a glowing disc; a decoy is an item box stood on its corner, the
  // same size and colour family as the real thing but a different silhouette,
  // so a sharp eye can tell it apart.
  const puckGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.12, 18)
  const puckMat = new THREE.MeshBasicMaterial({ color: 0xf97316 })
  const pucks = dynamicLayer(puckGeo, puckMat, MAX_HAZARDS)
  const decoyGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5).rotateX(Math.PI / 4).rotateZ(Math.atan(Math.SQRT1_2))
  const decoyMat = new THREE.MeshLambertMaterial({ color: 0x2a9d93 })
  const decoys = dynamicLayer(decoyGeo, decoyMat, MAX_HAZARDS)
  scene.add(pucks, decoys)
  // An unknown hazard kind draws as this rather than as nothing, so a kind added
  // to the server shows up wrong instead of invisible.
  const unknownGeo = new THREE.OctahedronGeometry(0.35)
  const unknownMat = new THREE.MeshBasicMaterial({ color: 0xff00ff })
  const unknowns = dynamicLayer(unknownGeo, unknownMat, MAX_HAZARDS)
  scene.add(slicks, peels, unknowns)

  // InstancedMesh has no per-instance opacity, so skids are one fixed shade and
  // simply expire. The page drops them after 3.5s, as the 2D renderer did.
  const skidGeo = new THREE.PlaneGeometry(0.16, 0.16).rotateX(-Math.PI / 2)
  const skidMat = new THREE.MeshBasicMaterial({ color: 0x0c0c10, transparent: true, opacity: 0.45 })
  const skids = dynamicLayer(skidGeo, skidMat, MAX_SKIDS)
  scene.add(skids)

  // Tyre smoke from a drift: puffs that rise and swell as they age. One shade,
  // like skids, since an InstancedMesh has no per-instance opacity.
  const smokeGeo = new THREE.IcosahedronGeometry(0.22, 0)
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0xbfbfc4, transparent: true, opacity: 0.3, depthWrite: false })
  const smoke = dynamicLayer(smokeGeo, smokeMat, MAX_SMOKE)
  scene.add(smoke)

  // Per car id, not per pool slot: the pool is indexed by join order, which a
  // car leaving reshuffles.
  const poses = new Map()
  let lastNow = 0

  function place(mesh, i, x, y, h, yaw = 0) {
    scratch.position.set(...toWorld(x, y, h))
    scratch.rotation.set(0, yaw, 0)
    scratch.updateMatrix()
    mesh.setMatrixAt(i, scratch.matrix)
  }

  let groundTex = null
  let groundGeo = null
  let groundMat = null
  let ground = null
  let walls = null
  let wedges = null
  let lips = null
  let padWedges = null
  let padArrows = null
  let pitFloors = null
  let pitWalls = null
  let trackRamps = []

  // A ramp's structure is its slope; the lip in the warning colour marks where
  // it launches, so the ramp never relies on colour to be seen.
  const wedgeGeo = wedgeGeometry()
  const wedgeMat = new THREE.MeshLambertMaterial({ color: 0x2b2118 })
  const lipGeo = new THREE.BoxGeometry(0.08, 0.05, 1).translate(RAMP_LENGTH / 2 - 0.04, RAMP_HEIGHT + 0.025, 0)
  const lipMat = new THREE.MeshLambertMaterial({ color: token('--warn', '#eab308') })
  // A pit: a dark floor down PIT_DEPTH and walls round its outer edges, seen
  // through the hole cut in the ground.
  const pitFloorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const pitWallGeo = new THREE.PlaneGeometry(1, PIT_DEPTH)
  const pitMat = new THREE.MeshLambertMaterial({ color: 0x0b0b0e, side: THREE.DoubleSide })
  const padMat = new THREE.MeshLambertMaterial({ color: 0x1f8f86 })
  // A flat chevron pointing along +x, lying level over the pad.
  const arrowShape = new THREE.Shape()
  arrowShape.moveTo(0.45, 0)
  arrowShape.lineTo(-0.25, 0.4)
  arrowShape.lineTo(-0.05, 0)
  arrowShape.lineTo(-0.25, -0.4)
  arrowShape.closePath()
  const arrowGeo = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2)
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })

  function disposeTrack() {
    for (const mesh of [ground, walls, wedges, lips, padWedges, padArrows, pitFloors, pitWalls]) if (mesh) scene.remove(mesh)
    groundTex?.dispose()
    groundGeo?.dispose()
    groundMat?.dispose()
    walls?.dispose()
    wedges?.dispose()
    lips?.dispose()
    pitFloors?.dispose()
    pitWalls?.dispose()
    padWedges?.dispose()
    padArrows?.dispose()
    groundTex = groundGeo = groundMat = ground = walls = wedges = lips = padWedges = padArrows = pitFloors = pitWalls = null
    trackRamps = []
  }

  return {
    /** The largest texture this GPU takes, so the page can pick a ground resolution. */
    maxTextureSize: renderer.capabilities.maxTextureSize,

    /**
     * Build a circuit. A new circuit arrives on every restart, so the old one is
     * disposed first: a texture and a mesh per race that are never freed is GPU
     * memory that grows until the tab dies.
     */
    setTrack(groundCanvas, wallBoxes, ramps = [], pit = { floors: [], edges: [] }) {
      disposeTrack()
      // update() leaves `scratch` holding a pickup's spin; clear it, or every
      // wall on a restarted circuit is built turned by that angle.
      scratch.rotation.set(0, 0, 0)
      scratch.scale.set(1, 1, 1)

      groundTex = new THREE.CanvasTexture(groundCanvas)
      groundTex.colorSpace = THREE.SRGBColorSpace
      groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      groundGeo = new THREE.PlaneGeometry(GRID, GRID)
      // Hole tiles are clear in the ground canvas; alphaTest cuts them out of the
      // plane so the pit below shows through.
      groundMat = new THREE.MeshLambertMaterial({ map: groundTex, alphaTest: 0.5 })
      ground = new THREE.Mesh(groundGeo, groundMat)
      ground.rotation.x = -Math.PI / 2
      // Tile x spans [x - 0.5, x + 0.5], matching the physics.
      ground.position.set(GRID / 2 - 0.5, 0, GRID / 2 - 0.5)
      scene.add(ground)

      walls = new THREE.InstancedMesh(wallGeo, wallMat, Math.max(1, wallBoxes.length))
      wallBoxes.forEach((b, i) => {
        scratch.position.set(...toWorld(b.x, b.y, WALL_HEIGHT / 2))
        scratch.updateMatrix()
        walls.setMatrixAt(i, scratch.matrix)
      })
      walls.count = wallBoxes.length
      walls.instanceMatrix.needsUpdate = true
      scene.add(walls)

      trackRamps = ramps
      // A plain ramp and a wall-jump pad share a wedge but not a look: a pad is
      // teal with a chevron floating over it, pointing where it throws you, so
      // it is told apart by shape as well as colour.
      const plain = ramps.filter((r) => !r.pad)
      const pads = ramps.filter((r) => r.pad)
      const layer = (geo, mat, list, lift = 0, scaleAcross = true) => {
        const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
        list.forEach((r, i) => {
          scratch.position.set(...toWorld(r.x, r.y, lift))
          scratch.rotation.set(0, yawFor(r.heading), 0)
          scratch.scale.set(1, 1, scaleAcross ? r.width : 1)
          scratch.updateMatrix()
          mesh.setMatrixAt(i, scratch.matrix)
        })
        mesh.count = list.length
        mesh.instanceMatrix.needsUpdate = true
        return mesh
      }
      wedges = layer(wedgeGeo, wedgeMat, plain)
      lips = layer(lipGeo, lipMat, plain)
      padWedges = layer(wedgeGeo, padMat, pads)
      padArrows = layer(arrowGeo, arrowMat, pads, RAMP_HEIGHT + 0.45, false)
      scratch.rotation.set(0, 0, 0)
      scratch.scale.set(1, 1, 1)
      scene.add(wedges, lips, padWedges, padArrows)

      // The pits under holes: a floor per hole tile, a wall per outer edge.
      pitFloors = new THREE.InstancedMesh(pitFloorGeo, pitMat, Math.max(1, pit.floors.length))
      pit.floors.forEach((f, i) => {
        scratch.position.set(...toWorld(f.x, f.y, -PIT_DEPTH))
        scratch.rotation.set(0, 0, 0)
        scratch.updateMatrix()
        pitFloors.setMatrixAt(i, scratch.matrix)
      })
      pitFloors.count = pit.floors.length
      pitWalls = new THREE.InstancedMesh(pitWallGeo, pitMat, Math.max(1, pit.edges.length))
      pit.edges.forEach((e, i) => {
        scratch.position.set(...toWorld(e.x + e.dx / 2, e.y + e.dy / 2, -PIT_DEPTH / 2))
        // The wall plane is built facing +z; turn it to face along its edge.
        scratch.rotation.set(0, e.dx !== 0 ? Math.PI / 2 : 0, 0)
        scratch.updateMatrix()
        pitWalls.setMatrixAt(i, scratch.matrix)
      })
      scratch.rotation.set(0, 0, 0)
      pitWalls.count = pit.edges.length
      pitFloors.instanceMatrix.needsUpdate = true
      pitWalls.instanceMatrix.needsUpdate = true
      scene.add(pitFloors, pitWalls)
    },

    /** Move every object to where the snapshot says, apply the camera, draw. */
    update(frame) {
      const now = frame?.now ?? 0
      const cars = frame?.cars ?? []
      const palette = frame?.palette ?? []
      const dt = lastNow ? (now - lastNow) / 1000 : 0
      lastNow = now

      for (let i = 0; i < pool.length; i++) {
        const c = pool[i]
        const car = cars[i]
        const show = Boolean(car) && car.id !== frame?.hideId
        c.group.visible = show
        c.shadow.visible = show && !car.falling
        if (!show) continue

        // Cached by colour, not by slot, so a theme switch repaints the car.
        const color = palette[car.slot % palette.length] ?? '#ffffff'
        if (c.color !== color) {
          c.paint.color.set(color)
          c.color = color
        }
        // Out, or a ghost: see-through. The label says which.
        c.paint.opacity = !car.alive ? 0.35 : car.ghost ? 0.3 : 1
        c.bubble.visible = Boolean(car.shield)

        const lift = carLift(car, trackRamps)
        c.group.position.set(...toWorld(car.x, car.y, lift))
        c.group.rotation.y = yawFor(car.heading)
        let pose = poses.get(car.id)
        if (!pose) poses.set(car.id, (pose = makePose()))
        stepPose(pose, car, dt)
        // The car's right is +z, so leaning left (positive roll) turns about x
        // the negative way; nose up is positive about z.
        c.chassis.rotation.set(-pose.roll, 0, pose.pitch)
        c.chassis.position.y = pose.bounce
        for (const w of c.front) w.rotation.y = wheelYawFor(car.steer ?? 0)
        c.brake.color.set(car.brake ? 0xff3030 : 0x3a0b0b)
        c.shadow.position.set(...toWorld(car.x, car.y, 0.01))
      }

      if (poses.size > cars.length) {
        const here = new Set(cars.map((car) => car.id))
        for (const id of poses.keys()) if (!here.has(id)) poses.delete(id)
      }

      const ps = frame?.pickups ?? []
      pickups.count = Math.min(ps.length, MAX_PICKUPS)
      for (let i = 0; i < pickups.count; i++) {
        const p = ps[i]
        place(pickups, i, p.x, p.y, 0.55 + Math.sin(now / 300 + p.x) * 0.12, now / 700 + p.y)
      }
      pickups.instanceMatrix.needsUpdate = true

      let s = 0
      let b = 0
      let pk = 0
      let dc = 0
      let u = 0
      for (const h of frame?.hazards ?? []) {
        if (h.kind === 'slick') {
          if (s < MAX_HAZARDS) place(slicks, s++, h.x, h.y, 0.02)
        } else if (h.kind === 'banana') {
          if (b < MAX_HAZARDS) place(peels, b++, h.x, h.y, 0.08)
        } else if (h.kind === 'puck') {
          if (pk < MAX_HAZARDS) place(pucks, pk++, h.x, h.y, 0.18, now / 60)
        } else if (h.kind === 'decoy') {
          if (dc < MAX_HAZARDS) place(decoys, dc++, h.x, h.y, 0.55 + Math.sin(now / 300 + h.x) * 0.12, now / 900)
        } else if (u < MAX_HAZARDS) {
          place(unknowns, u++, h.x, h.y, 0.4, now / 400)
        }
      }
      for (const [mesh, count] of [[slicks, s], [peels, b], [pucks, pk], [decoys, dc], [unknowns, u]]) {
        mesh.count = count
        mesh.instanceMatrix.needsUpdate = true
      }

      const sk = frame?.skids ?? []
      skids.count = Math.min(sk.length, MAX_SKIDS)
      for (let i = 0; i < skids.count; i++) place(skids, i, sk[i].x, sk[i].y, 0.005)
      skids.instanceMatrix.needsUpdate = true

      const sm = frame?.smoke ?? []
      smoke.count = Math.min(sm.length, MAX_SMOKE)
      for (let i = 0; i < smoke.count; i++) {
        const age = Math.min(1, (now - sm[i].at) / SMOKE_MS)
        scratch.position.set(...toWorld(sm[i].x, sm[i].y, 0.15 + age * 0.6))
        scratch.rotation.set(0, age * 2, 0)
        scratch.scale.setScalar(0.6 + age * 1.6)
        scratch.updateMatrix()
        smoke.setMatrixAt(i, scratch.matrix)
      }
      scratch.scale.set(1, 1, 1)
      smoke.instanceMatrix.needsUpdate = true

      const pose = frame?.pose
      if (pose) {
        camera.position.set(...pose.position)
        // up before lookAt: lookAt reads it.
        camera.up.set(...pose.up)
        camera.lookAt(...pose.target)
        if (camera.fov !== pose.fov) {
          camera.fov = pose.fov
          camera.updateProjectionMatrix()
        }
      }
      renderer.render(scene, camera)
    },

    /**
     * Where a game point lands on the canvas, as fractions of its width and
     * height, so the overlay can place labels at any size or pixel ratio.
     * `visible` is false behind the camera or beyond the far plane.
     */
    project(x, y, h = 0) {
      probe.set(...toWorld(x, y, h)).project(camera)
      return {
        fx: (probe.x + 1) / 2,
        fy: (1 - probe.y) / 2,
        visible: probe.z > -1 && probe.z < 1,
      }
    },

    resize(w, h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    },

    /** GPU objects alive right now, for spotting a leak across restarts. */
    stats() {
      return { ...renderer.info.memory }
    },

    /**
     * Release everything. forceContextLoss matters: renderer.dispose() alone does
     * not free the WebGL context, browsers cap live contexts at around 16, and
     * navigating to Cutline and away repeatedly would eventually have the browser
     * silently kill the oldest one.
     */
    dispose() {
      disposeTrack()
      wallGeo.dispose()
      wallMat.dispose()
      wedgeGeo.dispose()
      wedgeMat.dispose()
      lipGeo.dispose()
      lipMat.dispose()
      pitFloorGeo.dispose()
      pitWallGeo.dispose()
      pitMat.dispose()
      padMat.dispose()
      arrowGeo.dispose()
      arrowMat.dispose()
      for (const c of pool) {
        c.paint.dispose()
        c.brake.dispose()
      }
      for (const g of [shared.body, shared.cabin, shared.wheel, shared.lamp, shared.shadow, shared.bubble]) g.dispose()
      for (const m of [shared.glass, shared.tyre, shared.headlight, shared.shadowMat, shared.bubbleMat]) m.dispose()
      for (const mesh of [pickups, slicks, peels, pucks, decoys, unknowns, skids, smoke]) mesh.dispose()
      for (const g of [pickupGeo, slickGeo, peelGeo, puckGeo, decoyGeo, unknownGeo, skidGeo, smokeGeo]) g.dispose()
      for (const m of [pickupMat, slickMat, peelMat, puckMat, decoyMat, unknownMat, skidMat, smokeMat]) m.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
