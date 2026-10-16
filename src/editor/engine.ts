import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { GameSim } from '../runtime/sim'
import { DEG, addWorldLights, applyProps, buildNode, disposeNode, keyOf } from '../shared/sceneBuilder'
import type { PlayStatus, SceneObject, TransformMode, Vec3 } from './types'

export interface EngineCallbacks {
  onSelect: (id: string | null) => void
  onTransform: (id: string, position: Vec3, rotation: Vec3, scale: Vec3) => void
  onDragStart: () => void
  onPlayStatus: (status: PlayStatus) => void
}

interface Entry {
  obj: SceneObject
  node: THREE.Object3D
  key: string
}

export class Engine {
  private container: HTMLElement
  private cb: EngineCallbacks
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private orbit: OrbitControls
  private transform: TransformControls
  private grid: THREE.GridHelper
  private selBox: THREE.BoxHelper
  private entries = new Map<string, Entry>()
  private raycaster = new THREE.Raycaster()
  private clock = new THREE.Clock()
  private raf = 0
  private ro: ResizeObserver
  private downX = 0
  private downY = 0
  private downOnGizmo = false
  private lastSelected: string | null = null

  private playing = false
  private sim: GameSim | null = null
  private savedCam: { p: THREE.Vector3; t: THREE.Vector3 } | null = null

  constructor(container: HTMLElement, cb: EngineCallbacks) {
    this.container = container
    this.cb = cb

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    addWorldLights(this.scene)

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
    this.camera.position.set(9, 8, 12)

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enableDamping = true
    this.orbit.target.set(0, 1, 0)

    this.transform = new TransformControls(this.camera, this.renderer.domElement)
    this.transform.addEventListener('dragging-changed', (e) => {
      const dragging = Boolean((e as unknown as { value: boolean }).value)
      this.orbit.enabled = !dragging
      if (dragging) this.cb.onDragStart()
    })
    this.transform.addEventListener('objectChange', () => {
      const node = this.transform.object
      if (!node) return
      const id = node.userData.id as string | undefined
      if (!id) return
      this.cb.onTransform(
        id,
        [node.position.x, node.position.y, node.position.z],
        [node.rotation.x / DEG, node.rotation.y / DEG, node.rotation.z / DEG],
        [node.scale.x, node.scale.y, node.scale.z],
      )
    })
    this.scene.add(this.transform.getHelper())

    this.grid = new THREE.GridHelper(80, 80, '#4a5673', '#2c3550')
    this.scene.add(this.grid)

    this.selBox = new THREE.BoxHelper(new THREE.Object3D(), '#ffd23f')
    this.selBox.visible = false
    this.scene.add(this.selBox)

    const dom = this.renderer.domElement
    dom.addEventListener('pointerdown', this.onPointerDown)
    dom.addEventListener('pointerup', this.onPointerUp)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.loop()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.stopPlay()
    const dom = this.renderer.domElement
    dom.removeEventListener('pointerdown', this.onPointerDown)
    dom.removeEventListener('pointerup', this.onPointerUp)
    this.transform.dispose()
    this.orbit.dispose()
    this.entries.forEach((e) => disposeNode(e.node))
    this.renderer.dispose()
    if (dom.parentElement === this.container) this.container.removeChild(dom)
  }

  private resize() {
    const w = Math.max(this.container.clientWidth, 1)
    const h = Math.max(this.container.clientHeight, 1)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    if (this.playing) {
      this.sim?.update(dt)
    } else {
      this.orbit.update()
      if (this.selBox.visible) this.selBox.update()
    }
    this.renderer.render(this.scene, this.camera)
  }

  private removeEntry(id: string) {
    const e = this.entries.get(id)
    if (!e) return
    if (this.transform.object === e.node) this.transform.detach()
    this.scene.remove(e.node)
    disposeNode(e.node)
    this.entries.delete(id)
  }

  sync(objects: SceneObject[], selectedId: string | null) {
    this.lastSelected = selectedId
    if (this.playing) return
    const seen = new Set<string>()
    for (const o of objects) {
      seen.add(o.id)
      const key = keyOf(o)
      let e = this.entries.get(o.id)
      if (e && e.key !== key) {
        this.removeEntry(o.id)
        e = undefined
      }
      if (!e) {
        e = { obj: o, node: buildNode(o), key }
        this.entries.set(o.id, e)
        this.scene.add(e.node)
      }
      e.obj = o
      applyProps(o, e.node)
    }
    for (const id of Array.from(this.entries.keys())) {
      if (!seen.has(id)) this.removeEntry(id)
    }
    this.reattach()
  }

  private reattach() {
    const entry = this.lastSelected ? this.entries.get(this.lastSelected) : undefined
    if (entry) {
      if (this.transform.object !== entry.node) this.transform.attach(entry.node)
      this.selBox.setFromObject(entry.node)
      this.selBox.visible = true
    } else {
      this.transform.detach()
      this.selBox.visible = false
    }
  }

  setMode(mode: TransformMode) {
    this.transform.setMode(mode)
  }

  setSnap(on: boolean) {
    this.transform.setTranslationSnap(on ? 0.5 : null)
    this.transform.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null)
    this.transform.setScaleSnap(on ? 0.25 : null)
  }

  focusSelected() {
    const entry = this.lastSelected ? this.entries.get(this.lastSelected) : undefined
    if (!entry) return
    const box = new THREE.Box3().setFromObject(entry.node)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length() || 2
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize()
    this.orbit.target.copy(center)
    this.camera.position.copy(center).addScaledVector(dir, Math.max(size * 2, 4))
  }

  private onPointerDown = (e: PointerEvent) => {
    this.downX = e.clientX
    this.downY = e.clientY
    this.downOnGizmo = this.transform.axis !== null
  }

  private onPointerUp = (e: PointerEvent) => {
    if (this.playing || this.downOnGizmo || e.button !== 0) return
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 4) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const nodes = Array.from(this.entries.values()).map((en) => en.node)
    const hits = this.raycaster.intersectObjects(nodes, true)
    let id: string | null = null
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object
      while (o && !o.userData.id) o = o.parent
      if (o) {
        id = o.userData.id as string
        break
      }
    }
    this.cb.onSelect(id)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    this.sim?.keys.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.sim?.keys.delete(e.code)
  }

  startPlay() {
    if (this.playing) return
    this.playing = true
    this.transform.detach()
    this.transform.getHelper().visible = false
    this.selBox.visible = false
    this.grid.visible = false
    this.orbit.enabled = false
    this.savedCam = { p: this.camera.position.clone(), t: this.orbit.target.clone() }

    const items = Array.from(this.entries, ([id, e]) => ({ id, node: e.node, obj: e.obj }))
    this.sim = new GameSim(items, this.camera, (s) => this.cb.onPlayStatus(s))
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.sim.start()
  }

  stopPlay() {
    if (!this.playing) return
    this.playing = false
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.sim?.stop()
    this.sim = null
    if (this.savedCam) {
      this.camera.position.copy(this.savedCam.p)
      this.orbit.target.copy(this.savedCam.t)
    }
    this.orbit.enabled = true
    this.grid.visible = true
    this.transform.getHelper().visible = true
    this.reattach()
    this.cb.onPlayStatus({ state: 'idle', score: 0, total: 0, message: '' })
  }

  restartPlay() {
    this.sim?.restart()
  }
}