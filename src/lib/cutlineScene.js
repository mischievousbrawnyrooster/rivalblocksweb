// The three.js scene for Cutline. It draws what the server sent and nothing else:
// no rule, no simulation, no prediction. Every piece of maths worth testing, the
// axis mapping, car orientation and the camera, lives in raceCamera.js.
//
// Nothing here loads a file. Models are three.js primitives and the ground is a
// canvas drawn in code, so the first frame never waits on the network.
import * as THREE from 'three'
import { GRID, CAR_LENGTH, CAR_WIDTH, MAX_PLAYERS } from '../../server/cutline.js'
import { toWorld, yawFor, wheelYawFor, WALL_HEIGHT, CAR_ROOF } from './raceCamera.js'
import { carLift, RAMP_HEIGHT, RAMP_LENGTH } from './carLift.js'

const MAX_PICKUPS = 64
const MAX_HAZARDS = 32 // the server caps at 16; this is headroom, not a rule
const MAX_SKIDS = 500 // the cap the 2D renderer used

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

  const body = new THREE.Mesh(shared.body, paint)
  body.position.y = 0.2
  const cabin = new THREE.Mesh(shared.cabin, shared.glass)
  cabin.position.set(-CAR_LENGTH * 0.05, CAR_ROOF - 0.1, 0)
  group.add(body, cabin)

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
    group.add(head, tail)
  }

  // The shadow stays on the ground while the car rises, so it is a sibling of
  // the car rather than a child that would be lifted with it.
  const shadow = new THREE.Mesh(shared.shadow, shared.shadowMat)
  shadow.rotation.x = -Math.PI / 2

  return { group, shadow, paint, brake, front, color: null }
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
  const pickups = new THREE.InstancedMesh(pickupGeo, pickupMat, MAX_PICKUPS)
  pickups.count = 0
  scene.add(pickups)

  const slickGeo = new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2)
  const slickMat = new THREE.MeshBasicMaterial({ color: 0x09090c, transparent: true, opacity: 0.8 })
  const slicks = new THREE.InstancedMesh(slickGeo, slickMat, MAX_HAZARDS)
  slicks.count = 0
  const peelGeo = new THREE.TorusGeometry(0.22, 0.07, 6, 12, Math.PI).rotateX(-Math.PI / 2)
  const peelMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 })
  const peels = new THREE.InstancedMesh(peelGeo, peelMat, MAX_HAZARDS)
  peels.count = 0
  // An unknown hazard kind draws as this rather than as nothing, so a kind added
  // to the server shows up wrong instead of invisible.
  const unknownGeo = new THREE.OctahedronGeometry(0.35)
  const unknownMat = new THREE.MeshBasicMaterial({ color: 0xff00ff })
  const unknowns = new THREE.InstancedMesh(unknownGeo, unknownMat, MAX_HAZARDS)
  unknowns.count = 0
  scene.add(slicks, peels, unknowns)

  // InstancedMesh has no per-instance opacity, so skids are one fixed shade and
  // simply expire. The page drops them after 3.5s, as the 2D renderer did.
  const skidGeo = new THREE.PlaneGeometry(0.16, 0.16).rotateX(-Math.PI / 2)
  const skidMat = new THREE.MeshBasicMaterial({ color: 0x0c0c10, transparent: true, opacity: 0.45 })
  const skids = new THREE.InstancedMesh(skidGeo, skidMat, MAX_SKIDS)
  skids.count = 0
  scene.add(skids)

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
  let trackRamps = []

  // A ramp's structure is its slope; the lip in the warning colour marks where
  // it launches, so the ramp never relies on colour to be seen.
  const wedgeGeo = wedgeGeometry()
  const wedgeMat = new THREE.MeshLambertMaterial({ color: 0x2b2118 })
  const lipGeo = new THREE.BoxGeometry(0.08, 0.05, 1).translate(RAMP_LENGTH / 2 - 0.04, RAMP_HEIGHT + 0.025, 0)
  const lipMat = new THREE.MeshLambertMaterial({ color: token('--warn', '#eab308') })

  function disposeTrack() {
    for (const mesh of [ground, walls, wedges, lips]) if (mesh) scene.remove(mesh)
    groundTex?.dispose()
    groundGeo?.dispose()
    groundMat?.dispose()
    walls?.dispose()
    wedges?.dispose()
    lips?.dispose()
    groundTex = groundGeo = groundMat = ground = walls = wedges = lips = null
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
    setTrack(groundCanvas, wallBoxes, ramps = []) {
      disposeTrack()
      // update() leaves `scratch` holding a pickup's spin; clear it, or every
      // wall on a restarted circuit is built turned by that angle.
      scratch.rotation.set(0, 0, 0)
      scratch.scale.set(1, 1, 1)

      groundTex = new THREE.CanvasTexture(groundCanvas)
      groundTex.colorSpace = THREE.SRGBColorSpace
      groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      groundGeo = new THREE.PlaneGeometry(GRID, GRID)
      groundMat = new THREE.MeshLambertMaterial({ map: groundTex })
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
      wedges = new THREE.InstancedMesh(wedgeGeo, wedgeMat, Math.max(1, ramps.length))
      lips = new THREE.InstancedMesh(lipGeo, lipMat, Math.max(1, ramps.length))
      ramps.forEach((r, i) => {
        scratch.position.set(...toWorld(r.x, r.y, 0))
        scratch.rotation.set(0, yawFor(r.heading), 0)
        scratch.scale.set(1, 1, r.width)
        scratch.updateMatrix()
        wedges.setMatrixAt(i, scratch.matrix)
        lips.setMatrixAt(i, scratch.matrix)
      })
      scratch.rotation.set(0, 0, 0)
      scratch.scale.set(1, 1, 1)
      wedges.count = lips.count = ramps.length
      wedges.instanceMatrix.needsUpdate = true
      lips.instanceMatrix.needsUpdate = true
      scene.add(wedges, lips)
    },

    /** Move every object to where the snapshot says, apply the camera, draw. */
    update(frame) {
      const now = frame?.now ?? 0
      const cars = frame?.cars ?? []
      const palette = frame?.palette ?? []

      for (let i = 0; i < pool.length; i++) {
        const c = pool[i]
        const car = cars[i]
        const show = Boolean(car) && car.id !== frame?.hideId
        c.group.visible = show
        c.shadow.visible = show
        if (!show) continue

        // Cached by colour, not by slot, so a theme switch repaints the car.
        const color = palette[car.slot % palette.length] ?? '#ffffff'
        if (c.color !== color) {
          c.paint.color.set(color)
          c.color = color
        }
        c.paint.opacity = car.alive ? 1 : 0.35

        const lift = carLift(car, trackRamps)
        c.group.position.set(...toWorld(car.x, car.y, lift))
        c.group.rotation.y = yawFor(car.heading)
        for (const w of c.front) w.rotation.y = wheelYawFor(car.steer ?? 0)
        c.brake.color.set(car.brake ? 0xff3030 : 0x3a0b0b)
        c.shadow.position.set(...toWorld(car.x, car.y, 0.01))
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
      let u = 0
      for (const h of frame?.hazards ?? []) {
        if (h.kind === 'slick') {
          if (s < MAX_HAZARDS) place(slicks, s++, h.x, h.y, 0.02)
        } else if (h.kind === 'banana') {
          if (b < MAX_HAZARDS) place(peels, b++, h.x, h.y, 0.08)
        } else if (u < MAX_HAZARDS) {
          place(unknowns, u++, h.x, h.y, 0.4, now / 400)
        }
      }
      slicks.count = s
      peels.count = b
      unknowns.count = u
      slicks.instanceMatrix.needsUpdate = true
      peels.instanceMatrix.needsUpdate = true
      unknowns.instanceMatrix.needsUpdate = true

      const sk = frame?.skids ?? []
      skids.count = Math.min(sk.length, MAX_SKIDS)
      for (let i = 0; i < skids.count; i++) place(skids, i, sk[i].x, sk[i].y, 0.005)
      skids.instanceMatrix.needsUpdate = true

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
      for (const c of pool) {
        c.paint.dispose()
        c.brake.dispose()
      }
      for (const g of [shared.body, shared.cabin, shared.wheel, shared.lamp, shared.shadow]) g.dispose()
      for (const m of [shared.glass, shared.tyre, shared.headlight, shared.shadowMat]) m.dispose()
      for (const mesh of [pickups, slicks, peels, unknowns, skids]) mesh.dispose()
      for (const g of [pickupGeo, slickGeo, peelGeo, unknownGeo, skidGeo]) g.dispose()
      for (const m of [pickupMat, slickMat, peelMat, unknownMat, skidMat]) m.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
