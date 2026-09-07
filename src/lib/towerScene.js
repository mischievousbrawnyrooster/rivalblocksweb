// The Blockout Royale 3D scene. No React, no rules, no sockets: it is handed a
// view and it paints it.
//
// No image files anywhere in this project, and that survives three.js intact —
// BoxGeometry, flat materials and two lights. Nothing here loads anything.

import * as THREE from 'three'

const SOLID = '.'
const WARN = '!'

// Straight from the @theme tokens in src/index.css. Read once here rather than
// hardcoded twice.
const token = (name, fallback) => {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const FLOOR_GAP = 3.4 // world units between floors
const TILE = 1
const WARN_DROP = 0.18 // how far a flagged tile sinks

export function makeScene(canvas, { size, floors }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(token('--color-bg', '#16161a'))

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400)
  const target = new THREE.Vector3(size / 2, -FLOOR_GAP * (floors - 1) / 2, size / 2)
  let yaw = Math.PI / 4
  let pitch = 0.9
  let dist = size * 2.4

  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 0.9)
  key.position.set(1, 2, 1)
  scene.add(key)

  const count = size * size * floors

  // One InstancedMesh for every tile in the stack. 845 draw calls would be
  // absurd; one is not.
  const tileGeo = new THREE.BoxGeometry(TILE * 0.94, 0.35, TILE * 0.94)
  const tileMat = new THREE.MeshLambertMaterial({ transparent: true })
  const tiles = new THREE.InstancedMesh(tileGeo, tileMat, count)
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
  scene.add(tiles)

  // A flagged tile grows a post as well as changing colour. Colour alone is not
  // a status signal anywhere in this project (WCAG 1.4.1), and in three
  // dimensions a shape change is the cheapest thing there is.
  const postGeo = new THREE.BoxGeometry(0.16, 0.9, 0.16)
  const postMat = new THREE.MeshLambertMaterial({ color: token('--color-warn', '#e8a33d') })
  const posts = new THREE.InstancedMesh(postGeo, postMat, count)
  posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(posts)

  const pickGeo = new THREE.OctahedronGeometry(0.28)
  const pickMat = new THREE.MeshLambertMaterial({ color: token('--color-flare', '#ff6b1a') })
  const picks = new THREE.InstancedMesh(pickGeo, pickMat, 64)
  picks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(picks)

  const bodyGeo = new THREE.BoxGeometry(0.62, 0.9, 0.62)
  const bodies = new Map() // playerId -> Mesh

  const m4 = new THREE.Matrix4()
  const col = new THREE.Color()
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  // Resolved once here, not per frame: these only change on a theme flip,
  // and update() runs sixty times a second.
  const solidCol = new THREE.Color(token('--color-tile', '#3a3a42'))
  const warnCol = new THREE.Color(token('--color-warn', '#e8a33d'))

  const playerColor = (n) => token(`--color-player-${n}`, '#ff6b1a')

  // The scene is built once, but the site's theme toggle can flip underneath
  // it. Re-reading on the attribute change costs nothing per frame and is
  // correct, which reading once is not — every other surface on this site
  // re-themes for free because it is driven by CSS custom properties, and a
  // canvas that ignores the toggle is the one thing on the page that visibly
  // does not.
  const retheme = () => {
    scene.background.set(token('--color-bg', '#16161a'))
    solidCol.set(token('--color-tile', '#3a3a42'))
    warnCol.set(token('--color-warn', '#e8a33d'))
    postMat.color.set(token('--color-warn', '#e8a33d'))
    pickMat.color.set(token('--color-flare', '#ff6b1a'))
    for (const [id, mesh] of bodies) {
      mesh.material.color.set(playerColor(((id - 1) % 8) + 1))
    }
  }
  const themeWatch = new MutationObserver(retheme)
  themeWatch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  const worldY = (z, fall = 0) => -(z + fall) * FLOOR_GAP

  return {
    resize(w, h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    },

    orbit(dx, dy) {
      yaw -= dx * 0.005
      pitch = Math.max(0.25, Math.min(1.4, pitch - dy * 0.005))
    },

    /**
     * Paints one frame.
     *
     * `viewZ` is the floor the local player is on. Their floor is opaque, the
     * one below is ghosted so a drop is something you can aim, and the rest are
     * faint. Without that a five-deep stack is an unreadable pile of boxes.
     */
    update(view, { viewZ = 0 } = {}) {
      let posted = 0
      for (let i = 0; i < count; i++) {
        const ch = view.tiles[i]
        const z = Math.floor(i / (size * size))
        if ((ch !== SOLID && ch !== WARN) || z > view.bottom) {
          tiles.setMatrixAt(i, hidden)
          continue
        }
        const x = i % size
        const y = Math.floor(i / size) % size
        const sunk = ch === WARN ? -WARN_DROP : 0
        m4.makeTranslation(x + 0.5, worldY(z) + sunk, y + 0.5)
        tiles.setMatrixAt(i, m4)

        col.copy(ch === WARN ? warnCol : solidCol)
        // Depth cue: floors below yours darken with distance.
        const away = Math.abs(z - viewZ)
        col.multiplyScalar(away === 0 ? 1 : Math.max(0.28, 1 - away * 0.26))
        tiles.setColorAt(i, col)

        if (ch === WARN && posted < count) {
          m4.makeTranslation(x + 0.5, worldY(z) + 0.5, y + 0.5)
          posts.setMatrixAt(posted++, m4)
        }
      }
      for (let i = posted; i < count; i++) posts.setMatrixAt(i, hidden)
      tiles.instanceMatrix.needsUpdate = true
      tiles.instanceColor.needsUpdate = true
      posts.instanceMatrix.needsUpdate = true
      posts.count = count
      tiles.count = count

      let n = 0
      for (const key of Object.keys(view.powerups ?? {})) {
        if (n >= picks.count) break
        const i = Number(key)
        const z = Math.floor(i / (size * size))
        m4.makeTranslation((i % size) + 0.5, worldY(z) + 0.5, (Math.floor(i / size) % size) + 0.5)
        picks.setMatrixAt(n++, m4)
      }
      for (let i = n; i < 64; i++) picks.setMatrixAt(i, hidden)
      picks.instanceMatrix.needsUpdate = true

      const seen = new Set()
      for (const p of view.players) {
        if (!p.playing || !p.alive) continue
        seen.add(p.id)
        let mesh = bodies.get(p.id)
        if (!mesh) {
          mesh = new THREE.Mesh(
            bodyGeo,
            new THREE.MeshLambertMaterial({ color: playerColor(((p.id - 1) % 8) + 1) }),
          )
          bodies.set(p.id, mesh)
          scene.add(mesh)
        }
        mesh.position.set(p.x, worldY(p.z, p.fall) + 0.62, p.y)
        mesh.visible = true
        // A wind-up is a shape change, not a tint.
        mesh.scale.setScalar(p.stomping ? 1.25 : 1)
      }
      for (const [id, mesh] of bodies) if (!seen.has(id)) mesh.visible = false

      camera.position.set(
        target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        target.y + Math.sin(pitch) * dist,
        target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
      )
      camera.lookAt(target)
      renderer.render(scene, camera)
    },

    dispose() {
      themeWatch.disconnect()
      renderer.dispose()
      tileGeo.dispose()
      postGeo.dispose()
      pickGeo.dispose()
      bodyGeo.dispose()
      tiles.dispose()
      posts.dispose()
      picks.dispose()
      tileMat.dispose()
      postMat.dispose()
      pickMat.dispose()
      for (const mesh of bodies.values()) mesh.material.dispose()
    },
  }
}
