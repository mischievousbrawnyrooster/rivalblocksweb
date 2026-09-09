// The Blockout Royale 3D scene. No React, no rules, no sockets: it is handed a
// view and it paints it.
//
// No image files anywhere in this project, and that survives three.js intact —
// BoxGeometry, flat materials and two lights. Nothing here loads anything.

import * as THREE from 'three'

const SOLID = '.'
const WARN = '!'

// Read the hand-written `:root` custom properties directly, never the
// `--color-*` Tailwind aliases. Tailwind v4's `@theme inline` substitutes
// those into utility classes rather than emitting them as real custom
// properties, so `getComputedStyle` returns '' for a `--color-*` read and
// this falls back silently — see CLAUDE.md. `src/pages/Play.jsx` and
// `Blastworks.jsx` read the same raw names for the same reason.
const token = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export const FLOOR_GAP = 3.4 // world units between floors
const TILE = 1
const WARN_DROP = 0.18 // how far a flagged tile sinks
// The mirror of WARN_DROP, not a separate number picked independently: a
// foreseen tile has to read as the opposite of a warned one on the same
// axis, structurally, not by colour (WCAG 1.4.1) — it is still `solid` in
// `view.tiles`, just marked to be taken by the wave the server already chose.
const SOON_RISE = WARN_DROP
// A third structural signal, alongside the two above: a plated tile grows
// visibly thicker rather than changing colour, so armour reads without
// depending on a hue (WCAG 1.4.1). A tile can be both plated and warned —
// the plate still absorbs the wave that is coming for it, so it keeps BOTH
// signals at once: sunk like any warned tile, but visibly thicker than one
// that is not plated, which is what tells a defended warning apart from an
// undefended one.
const PLATE_SCALE_Y = 1.9

// Billboard glyphs. Same convention as every other game here (`PIECE_ICON` in
// Play.jsx, Blastworks.jsx, Fracture.jsx): one emoji per slot, so a player is
// told apart without colour (WCAG 1.4.1) exactly as every sibling piece's
// initial does. Drawn once into an offscreen canvas per icon, never per frame.
const PIECE_ICON = ['🦊', '🐺', '🐙', '🦈', '🐝', '🐸', '🦅', '🐧']
const ICON_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'

function makeIconTexture(glyph) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.font = `52px ${ICON_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(glyph, 32, 34)
  return new THREE.CanvasTexture(c)
}

export function createAstronaut(slot, slotColor) {
  const group = new THREE.Group()
  const mat = new THREE.MeshLambertMaterial({ color: slotColor })
  const visorMat = new THREE.MeshLambertMaterial({ color: '#7ce8ff' })

  // Suit Body
  const bodyGeo = new THREE.CapsuleGeometry(0.24, 0.36, 8, 16)
  const body = new THREE.Mesh(bodyGeo, mat)
  body.position.y = 0.12
  group.add(body)

  // Visor
  const visorGeo = new THREE.BoxGeometry(0.26, 0.16, 0.12)
  const visor = new THREE.Mesh(visorGeo, visorMat)
  visor.position.set(0, 0.18, 0.2)
  group.add(visor)

  // Oxygen Tank Backpack
  const packGeo = new THREE.BoxGeometry(0.24, 0.32, 0.12)
  const pack = new THREE.Mesh(packGeo, mat)
  pack.position.set(0, 0.12, -0.2)
  group.add(pack)

  // Left & Right Boots
  const bootGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.16, 8)
  const leftBoot = new THREE.Mesh(bootGeo, mat)
  leftBoot.position.set(-0.11, -0.14, 0)
  group.add(leftBoot)

  const rightBoot = new THREE.Mesh(bootGeo, mat)
  rightBoot.position.set(0.11, -0.14, 0)
  group.add(rightBoot)

  group.userData = { body, visor, pack, leftBoot, rightBoot, mat, visorMat, slot }
  return group
}

export function makeScene(canvas, { size, floors }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(token('--bg', '#16161a'))

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400)

  // Where the camera looks when there is nobody to follow: the lobby, a
  // spectator past capacity, or after elimination. Without this the camera
  // ends up at the origin staring into the void.
  const overview = {
    target: [size / 2, (-FLOOR_GAP * (floors - 1)) / 2, size / 2],
    position: [size / 2 + size * 1.7, size * 1.7, size / 2 + size * 1.7],
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 0.9)
  key.position.set(1, 2, 1)
  scene.add(key)

  const count = size * size * floors
  const perFloor = size * size

  // One InstancedMesh per floor rather than one for the whole stack.
  // InstancedMesh has no per-instance opacity — instanceColor is RGB only — so
  // fading the floors above the player needs a material per floor. Five draw
  // calls, not one, and still not the 845 that drawing tiles individually
  // would cost.
  const tileGeo = new THREE.BoxGeometry(TILE * 0.94, 0.35, TILE * 0.94)
  const tileMats = []
  const tiles = []
  for (let z = 0; z < floors; z++) {
    const mat = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: true })
    const mesh = new THREE.InstancedMesh(tileGeo, mat, perFloor)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(perFloor * 3), 3)
    tileMats.push(mat)
    tiles.push(mesh)
    scene.add(mesh)
  }

  // A flagged tile grows a post as well as changing colour. Colour alone is not
  // a status signal anywhere in this project (WCAG 1.4.1), and in three
  // dimensions a shape change is the cheapest thing there is.
  const postGeo = new THREE.BoxGeometry(0.16, 0.9, 0.16)
  const postMat = new THREE.MeshLambertMaterial({ color: token('--warn', '#e8a33d') })
  const posts = new THREE.InstancedMesh(postGeo, postMat, count)
  posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(posts)

  const pickCoreGeo = new THREE.IcosahedronGeometry(0.36, 0)
  const pickRingGeo = new THREE.TorusGeometry(0.52, 0.045, 8, 24)
  const pickMat = new THREE.MeshLambertMaterial({
    color: token('--flare', '#ff6b1a'),
    emissive: token('--flare', '#ff6b1a'),
    emissiveIntensity: 0.25,
  })
  const pickCores = new THREE.InstancedMesh(pickCoreGeo, pickMat, 64)
  const pickRings = new THREE.InstancedMesh(pickRingGeo, pickMat, 64)
  pickCores.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  pickRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(pickCores)
  scene.add(pickRings)

  const bodies = new Map() // playerId -> Group (astronaut)
  const labels = new Map() // playerId -> Sprite, the billboard glyph above it

  // Eight small textures, built once and reused by every player who ever
  // takes that slot — never rebuilt per player and never per frame.
  const iconTex = PIECE_ICON.map(makeIconTexture)
  const iconMat = iconTex.map((map) => new THREE.SpriteMaterial({ map, transparent: true }))

  const m4 = new THREE.Matrix4()
  const scaleM = new THREE.Matrix4()
  const rotM = new THREE.Matrix4()
  const ringTiltM = new THREE.Matrix4().makeRotationX(Math.PI / 4)
  const col = new THREE.Color()
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  // Resolved once here, not per frame: these only change on a theme flip,
  // and update() runs sixty times a second.
  const solidCol = new THREE.Color(token('--tile', '#3a3a42'))
  const warnCol = new THREE.Color(token('--warn', '#e8a33d'))

  // Takes a slot (0-based, the player's index in the current player list —
  // the same convention Play.jsx and Blastworks.jsx key their pieces by, and
  // what keeps this in step with the scoreboard after somebody disconnects).
  const playerColor = (slot) => token(`--player-${(slot % 8) + 1}`, '#ff6b1a')

  // The scene is built once, but the site's theme toggle can flip underneath
  // it. Re-reading on the attribute change costs nothing per frame and is
  // correct, which reading once is not — every other surface on this site
  // re-themes for free because it is driven by CSS custom properties, and a
  // canvas that ignores the toggle is the one thing on the page that visibly
  // does not.
  const retheme = () => {
    scene.background.set(token('--bg', '#16161a'))
    solidCol.set(token('--tile', '#3a3a42'))
    warnCol.set(token('--warn', '#e8a33d'))
    postMat.color.set(token('--warn', '#e8a33d'))
    pickMat.color.set(token('--flare', '#ff6b1a'))
    pickMat.emissive.set(token('--flare', '#ff6b1a'))
    for (const mesh of bodies.values()) {
      mesh.userData.mat.color.set(playerColor(mesh.userData.slot ?? 0))
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

    /**
     * Paints one frame.
     *
     * `viewZ` is the floor the local player is on. Their floor is opaque, the
     * one below is ghosted so a drop is something you can aim, and the rest are
     * faint. Without that a five-deep stack is an unreadable pile of boxes.
     *
     * `view.soon` is only non-empty for a foresight holder (the server hands
     * it out per-viewer). Empty for everyone else, so this costs nothing on
     * the common path.
     */
    update(view, { viewZ = 0, slotOf, pose } = {}) {
      // Built once per frame, not scanned per tile: the loop below runs
      // `count` (845) times a frame, and .includes() in there would be the
      // per-frame allocation this file was already fixed once for.
      const soon = new Set(view.soon ?? [])
      const reinforced = new Set(view.reinforced ?? [])
      let posted = 0
      for (let z = 0; z < floors; z++) {
        const mesh = tiles[z]
        for (let n = 0; n < perFloor; n++) {
          const i = z * perFloor + n // stack index, for the tile string
          const ch = view.tiles[i]
          if ((ch !== SOLID && ch !== WARN) || z > view.bottom) {
            mesh.setMatrixAt(n, hidden)
            continue
          }
          const x = n % size
          const y = Math.floor(n / size)
          const lift = ch === WARN ? -WARN_DROP : soon.has(i) ? SOON_RISE : 0
          m4.makeTranslation(x + 0.5, worldY(z) + lift, y + 0.5)
          // Plated: a visibly thicker slab rather than a colour change (see
          // PLATE_SCALE_Y). Composed after the translation, so the tile scales
          // about its own centre and still lands at (x, z, y).
          if (reinforced.has(i)) m4.multiply(scaleM.makeScale(1, PLATE_SCALE_Y, 1))
          mesh.setMatrixAt(n, m4)

          col.copy(ch === WARN ? warnCol : solidCol)
          // Depth cue: floors below yours darken with distance.
          const away = Math.abs(z - viewZ)
          col.multiplyScalar(away === 0 ? 1 : Math.max(0.28, 1 - away * 0.26))
          mesh.setColorAt(n, col)

          if (ch === WARN && posted < count) {
            m4.makeTranslation(x + 0.5, worldY(z) + 0.5, y + 0.5)
            posts.setMatrixAt(posted++, m4)
          }
        }
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
      }
      for (let i = posted; i < count; i++) posts.setMatrixAt(i, hidden)
      posts.instanceMatrix.needsUpdate = true
      posts.count = count

      for (let z = 0; z < floors; z++) {
        const mat = tileMats[z]
        const above = viewZ - z // positive when this floor is above the player
        if (above > 0) {
          // See-through, so the camera behind the player is not looking at the
          // underside of a slab — and so a body about to drop on them is still
          // visible up there.
          mat.opacity = Math.max(0.06, 0.26 - (above - 1) * 0.08)
          mat.depthWrite = false
          // Furthest above draws first: back to front for a camera that always
          // sits at or above the player.
          tiles[z].renderOrder = 1 + z
        } else {
          mat.opacity = 1
          mat.depthWrite = true
          tiles[z].renderOrder = 0
        }
      }

      const tSec = performance.now() * 0.001
      const bob = Math.sin(tSec * 3.5) * 0.12
      const rotCore = tSec * 1.8
      const rotRing = -tSec * 2.2

      let n = 0
      for (const key of Object.keys(view.powerups ?? {})) {
        if (n >= 64) break
        const i = Number(key)
        const z = Math.floor(i / (size * size))
        const px = (i % size) + 0.5
        const py = worldY(z) + 0.65 + bob
        const pz = (Math.floor(i / size) % size) + 0.5

        // Core translation and rotation
        m4.makeTranslation(px, py, pz)
        rotM.makeRotationY(rotCore)
        m4.multiply(rotM)
        pickCores.setMatrixAt(n, m4)

        // Orbital ring translation and counter-rotation
        m4.makeTranslation(px, py, pz)
        rotM.makeRotationY(rotRing)
        m4.multiply(ringTiltM)
        m4.multiply(rotM)
        pickRings.setMatrixAt(n, m4)
        n++
      }
      for (let i = n; i < 64; i++) {
        pickCores.setMatrixAt(i, hidden)
        pickRings.setMatrixAt(i, hidden)
      }
      pickCores.instanceMatrix.needsUpdate = true
      pickRings.instanceMatrix.needsUpdate = true

      // Slot = index in the current player list, the same convention
      // Play.jsx and Blastworks.jsx key a piece's colour and icon by, and
      // what the scoreboard already uses. The id stays fixed across a
      // disconnect; this is rebuilt every frame precisely so it does not.
      const slots = slotOf ?? new Map(view.players.map((q, i) => [q.id, i % 8]))

      const seen = new Set()
      for (const p of view.players) {
        if (!p.playing || !p.alive) continue
        seen.add(p.id)
        const slot = (slots.get(p.id) ?? 0) % 8
        let mesh = bodies.get(p.id)
        let label = labels.get(p.id)
        if (!mesh) {
          mesh = createAstronaut(slot, playerColor(slot))
          bodies.set(p.id, mesh)
          scene.add(mesh)
          // The billboard glyph. Always faces the camera (THREE.Sprite does
          // this natively), which is what makes it readable from any angle
          // the orbit control can reach.
          label = new THREE.Sprite(iconMat[slot])
          label.scale.set(0.6, 0.6, 1)
          labels.set(p.id, label)
          scene.add(label)
        }
        // A slot only changes when the player list reorders (someone
        // joining or leaving), so this is a rare write, not a per-frame one.
        if (mesh.userData.slot !== slot) {
          mesh.userData.slot = slot
          mesh.userData.mat.color.set(playerColor(slot))
          label.material = iconMat[slot]
        }
        const jumpArc = p.jumping ? 4 * 0.85 * p.jumpProgress * (1 - p.jumpProgress) : 0
        mesh.position.set(p.x, worldY(p.z, p.fall) + 0.52 + jumpArc, p.y)
        mesh.visible = true

        if (mesh.userData.lastX !== undefined) {
          const dx = p.x - mesh.userData.lastX
          const dy = p.y - mesh.userData.lastY
          if (dx * dx + dy * dy > 0.0001) {
            mesh.rotation.y = Math.atan2(dx, dy)
          }
        }
        mesh.userData.lastX = p.x
        mesh.userData.lastY = p.y

        // A wind-up is a shape change, not a tint.
        mesh.scale.setScalar(p.stomping ? 1.25 : 1)
        label.position.set(p.x, worldY(p.z, p.fall) + 1.25 + jumpArc, p.y)
        label.visible = true
      }
      for (const [id, mesh] of bodies) {
        if (seen.has(id)) continue
        mesh.visible = false
        labels.get(id).visible = false
      }

      const shot = pose ?? overview
      camera.position.set(shot.position[0], shot.position[1], shot.position[2])
      camera.lookAt(shot.target[0], shot.target[1], shot.target[2])
      renderer.render(scene, camera)
    },

    dispose() {
      themeWatch.disconnect()
      renderer.dispose()
      tileGeo.dispose()
      postGeo.dispose()
      pickCoreGeo.dispose()
      pickRingGeo.dispose()
      for (const mesh of tiles) mesh.dispose()
      posts.dispose()
      pickCores.dispose()
      pickRings.dispose()
      for (const mat of tileMats) mat.dispose()
      postMat.dispose()
      pickMat.dispose()
      for (const group of bodies.values()) {
        group.userData.body?.geometry?.dispose()
        group.userData.visor?.geometry?.dispose()
        group.userData.pack?.geometry?.dispose()
        group.userData.leftBoot?.geometry?.dispose()
        if (group.userData.rightBoot?.geometry !== group.userData.leftBoot?.geometry) {
          group.userData.rightBoot?.geometry?.dispose()
        }
        group.userData.mat?.dispose()
        group.userData.visorMat?.dispose()
      }
      for (const mat of iconMat) mat.dispose()
      for (const tex of iconTex) tex.dispose()
    },
  }
}
