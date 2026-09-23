import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { dynamicLayer } from './cutlineScene.js'

// What WebGLRenderer does before drawing an object: skip it if culling is on and
// its bounding volume is outside the camera's view.
function drawn(mesh, camera) {
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )
  return !mesh.frustumCulled || frustum.intersectsObject(mesh)
}

test('a layer whose instances move is still drawn wherever they go', () => {
  // An InstancedMesh works out its bounding sphere once, the first time it is
  // culled, and never again. Pickups, hazards and skids move and come and go, so
  // that sphere went stale and every pickup vanished whenever it was off screen:
  // they flickered as the car turned, and disappeared facing some directions.
  const layer = dynamicLayer(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial(), 8)
  const o = new THREE.Object3D()
  const put = (x, z) => {
    o.position.set(x, 0.5, z)
    o.updateMatrix()
    layer.setMatrixAt(0, o.matrix)
    layer.count = 1
  }
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400)

  put(10, 10)
  camera.position.set(10, 3, 4)
  camera.lookAt(10, 0.5, 10)
  assert.ok(drawn(layer, camera), 'drawn where it started')

  put(60, 60)
  camera.position.set(60, 3, 54)
  camera.lookAt(60, 0.5, 60)
  assert.ok(drawn(layer, camera), 'drawn after moving across the circuit')
  assert.equal(layer.count, 1)
})

test('a new layer starts empty', () => {
  const layer = dynamicLayer(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4)
  assert.equal(layer.count, 0)
})
