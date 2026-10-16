import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js'
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js'
import type { AssetFormat, SceneObject } from '../editor/types'

export const DEG = Math.PI / 180

function normalizeName(value: string): string {
  try {
    return decodeURIComponent(value).split('?')[0].replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? value.toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

/**
 * Data-URL bundle support fixes the common ".gltf + .bin + textures" problem:
 * the imported root file and its companion files are all mapped through one LoadingManager.
 */
function makeManager(o: SceneObject): THREE.LoadingManager {
  const manager = new THREE.LoadingManager()
  const files = new Map<string, string>()
  for (const [name, data] of Object.entries(o.assetFiles ?? {})) files.set(normalizeName(name), data)
  if (o.modelData && o.modelData.startsWith('data:')) files.set(normalizeName(o.name), o.modelData)
  manager.setURLModifier((url) => files.get(normalizeName(url)) ?? url)
  return manager
}

function markVisuals(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material) continue
      material.needsUpdate = true
    }
  })
}

function fallbackModel(id: string, color = '#e5484d') {
  const g = new THREE.Group()
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, wireframe: true }),
  )
  g.add(mesh)
  tagNode(g, id)
  return g
}

export function keyOf(o: SceneObject): string {
  const files = Object.entries(o.assetFiles ?? {})
    .map(([name, value]) => `${name}:${value.length}`)
    .sort()
    .join('|')
  return `${o.shape}:${o.modelFormat ?? ''}:${o.modelData ? o.modelData.length : 0}:${files.length}`
}

export function tagNode(root: THREE.Object3D, id: string) {
  root.traverse((c) => {
    c.userData.id = id
  })
}

export function disposeNode(root: THREE.Object3D) {
  root.traverse((c) => {
    const mesh = c as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
    }
  })
}

function buildImageNode(o: SceneObject): THREE.Object3D {
  const group = new THREE.Group()
  const texture = new THREE.TextureLoader().load(
    o.modelData || '',
    (map) => {
      map.colorSpace = THREE.SRGBColorSpace
      const width = map.image?.width || 1
      const height = map.image?.height || 1
      const aspect = width / Math.max(height, 1)
      const plane = new THREE.PlaneGeometry(aspect, 1)
      const material = new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
        roughness: 0.85,
      })
      const mesh = new THREE.Mesh(plane, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.clear()
      group.add(mesh)
      tagNode(group, o.id)
    },
    undefined,
    () => {
      group.add(fallbackModel(o.id, '#e5484d'))
    },
  )
  void texture
  tagNode(group, o.id)
  return group
}

function loadThreeD(o: SceneObject, group: THREE.Group) {
  const manager = makeManager(o)
  const format = o.modelFormat ?? 'glb'
  const source = o.modelData || ''
  const done = (root: THREE.Object3D) => {
    markVisuals(root)
    group.clear()
    group.add(root)
    tagNode(group, o.id)
  }
  const fail = () => {
    group.clear()
    group.add(fallbackModel(o.id))
  }

  switch (format) {
    case 'fbx':
      new FBXLoader(manager).load(source, done, undefined, fail)
      return
    case 'obj': {
      const mtlName = Object.keys(o.assetFiles ?? {}).find((name) => /\\.mtl$/i.test(name))
      if (mtlName) {
        const mtl = new MTLLoader(manager)
        mtl.load(o.assetFiles?.[mtlName] ?? mtlName, (materials) => {
          materials.preload()
          new OBJLoader(manager).setMaterials(materials).load(source, done, undefined, fail)
        }, undefined, fail)
      } else {
        new OBJLoader(manager).load(source, done, undefined, fail)
      }
      return
    }
    case 'stl':
      new STLLoader(manager).load(source, (geometry) => {
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color), roughness: 0.55, metalness: 0.15 }),
        )
        done(mesh)
      }, undefined, fail)
      return
    case 'ply':
      new PLYLoader(manager).load(source, (geometry) => {
        geometry.computeVertexNormals()
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color), roughness: 0.62, metalness: 0.05 }),
        )
        done(mesh)
      }, undefined, fail)
      return
    case 'dae':
      new ColladaLoader(manager).load(source, (result) => {
        if (result) done(result.scene)
        else fail()
      }, undefined, fail)
      return
    case '3ds':
      new TDSLoader(manager).load(source, done, undefined, fail)
      return
    case 'usdz':
      new USDLoader(manager).load(source, done, undefined, fail)
      return
    case 'gltf':
    case 'glb':
    default:
      new GLTFLoader(manager).load(
        source,
        (gltf) => done(gltf.scene),
        undefined,
        fail,
      )
  }
}

export function buildNode(o: SceneObject): THREE.Object3D {
  const color = new THREE.Color(o.color)
  let node: THREE.Object3D

  if (o.shape === 'light') {
    const g = new THREE.Group()
    g.add(new THREE.PointLight(color, o.intensity, 60))
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 8), new THREE.MeshBasicMaterial({ color })))
    node = g
  } else if (o.shape === 'model') {
    const g = new THREE.Group()
    if (o.modelData) loadThreeD(o, g)
    else g.add(fallbackModel(o.id))
    node = g
  } else if (o.shape === 'image') {
    node = buildImageNode(o)
  } else {
    let geo: THREE.BufferGeometry
    switch (o.shape) {
      case 'sphere':
        geo = new THREE.SphereGeometry(0.5, 32, 16)
        break
      case 'cylinder':
        geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
        break
      case 'cone':
        geo = new THREE.ConeGeometry(0.5, 1, 32)
        break
      case 'torus':
        geo = new THREE.TorusGeometry(0.4, 0.12, 16, 48)
        break
      case 'plane':
        geo = new THREE.PlaneGeometry(1, 1)
        geo.rotateX(-Math.PI / 2)
        break
      default:
        geo = new THREE.BoxGeometry(1, 1, 1)
    }
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    node = mesh
  }
  tagNode(node, o.id)
  return node
}

export function applyProps(obj: SceneObject, node: THREE.Object3D) {
  node.position.set(obj.position[0], obj.position[1], obj.position[2])
  node.rotation.set(obj.rotation[0] * DEG, obj.rotation[1] * DEG, obj.rotation[2] * DEG)
  node.scale.set(obj.scale[0], obj.scale[1], obj.scale[2])
  if (obj.shape === 'light') {
    const light = node.children[0] as THREE.PointLight
    const marker = node.children[1] as THREE.Mesh
    light.color.set(obj.color)
    light.intensity = obj.intensity
    ;(marker.material as THREE.MeshBasicMaterial).color.set(obj.color)
  } else if (obj.shape !== 'model' && obj.shape !== 'image') {
    ;((node as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(obj.color)
  }
}

/** Standard lighting used by both the editor viewport and exported games. */
export function addWorldLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#dbe7ff', '#3a3f4f', 1.1))
  const sun = new THREE.DirectionalLight('#ffffff', 2.2)
  sun.position.set(14, 24, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -30
  sun.shadow.camera.right = 30
  sun.shadow.camera.top = 30
  sun.shadow.camera.bottom = -30
  sun.shadow.camera.far = 80
  scene.add(sun)
}