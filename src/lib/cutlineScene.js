// The three.js scene for Cutline. It draws what the server sent and nothing else:
// no rule, no simulation, no prediction. Every piece of maths worth testing, the
// axis mapping, car orientation and the camera, lives in raceCamera.js.
//
// Nothing here loads a file. Models are three.js primitives and the ground is a
// canvas drawn in code, so the first frame never waits on the network.
import * as THREE from 'three'
import { GRID } from '../../server/cutline.js'
import { toWorld, WALL_HEIGHT } from './raceCamera.js'

function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
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

  let groundTex = null
  let groundGeo = null
  let groundMat = null
  let ground = null
  let walls = null

  function disposeTrack() {
    if (ground) scene.remove(ground)
    if (walls) scene.remove(walls)
    groundTex?.dispose()
    groundGeo?.dispose()
    groundMat?.dispose()
    walls?.dispose()
    groundTex = groundGeo = groundMat = ground = walls = null
  }

  return {
    /** The largest texture this GPU takes, so the page can pick a ground resolution. */
    maxTextureSize: renderer.capabilities.maxTextureSize,

    /**
     * Build a circuit. A new circuit arrives on every restart, so the old one is
     * disposed first: a texture and a mesh per race that are never freed is GPU
     * memory that grows until the tab dies.
     */
    setTrack(groundCanvas, wallBoxes) {
      disposeTrack()

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
    },

    /** Apply a camera pose and draw one frame. */
    update(frame) {
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
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
