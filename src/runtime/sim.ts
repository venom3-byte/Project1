import * as THREE from 'three'
import type { PlayStatus, SceneObject } from '../editor/types'

export interface SimItem {
  id: string
  node: THREE.Object3D
  obj: SceneObject
}

interface Runtime {
  item: SimItem
  base: THREE.Vector3
  active: boolean
  savedPos: THREE.Vector3
  savedRot: THREE.Euler
  savedScale: THREE.Vector3
  savedVisible: boolean
}

const GRAVITY = 25
const JUMP_SPEED = 9
const KILL_Y = -30

/**
 * Game logic shared by the editor's Play mode and the exported player
 * (web and Android). It only needs three.js math types, so it can run
 * and be tested without a renderer.
 */
export class GameSim {
  /** keyboard state (KeyboardEvent.code values) */
  readonly keys = new Set<string>()

  private moveX = 0
  private moveZ = 0
  private jumpHeld = false

  private rt: Runtime[] = []
  private player: Runtime | null = null
  private spawn = new THREE.Vector3()
  private vy = 0
  private onGround = false
  private time = 0
  private score = 0
  private total = 0
  private won = false
  private running = false

  constructor(
    private items: SimItem[],
    private camera: THREE.Camera,
    private onStatus: (s: PlayStatus) => void,
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  /** virtual stick, each axis in [-1, 1] (x: right, z: backward) */
  setMove(x: number, z: number) {
    this.moveX = x
    this.moveZ = z
  }

  setJump(held: boolean) {
    this.jumpHeld = held
  }

  start() {
    this.rt = this.items.map((item) => ({
      item,
      base: item.node.position.clone(),
      active: true,
      savedPos: item.node.position.clone(),
      savedRot: item.node.rotation.clone(),
      savedScale: item.node.scale.clone(),
      savedVisible: item.node.visible,
    }))
    this.player = this.rt.find((r) => r.item.obj.behavior === 'player') ?? null
    if (this.player) this.spawn.copy(this.player.item.node.position)
    this.vy = 0
    this.onGround = false
    this.time = 0
    this.score = 0
    this.won = false
    this.running = true
    this.total = this.rt.filter((r) => r.item.obj.behavior === 'collectible').length
    this.keys.clear()
    this.moveX = 0
    this.moveZ = 0
    this.jumpHeld = false
    this.emit(
      'playing',
      this.player
        ? 'Move: WASD / arrows / stick. Jump: Space / button'
        : 'No Player object: give one object the Player behavior to control it',
    )
  }

  stop() {
    if (!this.running) return
    this.running = false
    for (const r of this.rt) {
      const n = r.item.node
      n.position.copy(r.savedPos)
      n.rotation.copy(r.savedRot)
      n.scale.copy(r.savedScale)
      n.visible = r.savedVisible
    }
    this.rt = []
    this.player = null
    this.keys.clear()
  }

  restart() {
    this.stop()
    this.start()
  }

  private emit(state: PlayStatus['state'], message: string) {
    this.onStatus({ state, score: this.score, total: this.total, message })
  }

  /**
   * World-space bounds. shrinkY trims the bottom (so standing on the ground is not a
   * sideways hit); shrinkXZ trims the sides (so sliding along a wall is not a vertical hit).
   */
  private boxOf(node: THREE.Object3D, shrinkY = 0, shrinkXZ = 0): THREE.Box3 {
    node.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(node)
    b.min.y += shrinkY
    b.min.x += shrinkXZ
    b.max.x -= shrinkXZ
    b.min.z += shrinkXZ
    b.max.z -= shrinkXZ
    return b
  }

  private respawn(message: string) {
    if (!this.player) return
    this.player.item.node.position.copy(this.spawn)
    this.vy = 0
    this.emit('playing', message)
  }

  private resolveHorizontal(node: THREE.Object3D, solids: THREE.Box3[], axis: 'x' | 'z', delta: number) {
    if (delta === 0) return
    let pb = this.boxOf(node, 0.05)
    for (const s of solids) {
      if (!pb.intersectsBox(s)) continue
      if (delta > 0) node.position[axis] -= pb.max[axis] - s.min[axis]
      else node.position[axis] += s.max[axis] - pb.min[axis]
      pb = this.boxOf(node, 0.05)
    }
  }

  update(rawDt: number) {
    if (!this.running) return
    const dt = Math.min(Math.max(rawDt, 0), 0.05)
    this.time += dt
    const t = this.time
    const player = this.player

    // animated behaviors
    for (const r of this.rt) {
      if (!r.active) continue
      const speed = r.item.obj.speed
      const node = r.item.node
      switch (r.item.obj.behavior) {
        case 'rotate':
          node.rotation.y += speed * dt
          break
        case 'bob':
          node.position.y = r.base.y + Math.sin(t * speed) * 0.5
          break
        case 'collectible':
          node.rotation.y += 2 * dt
          node.position.y = r.base.y + Math.sin(t * 2.5) * 0.15
          break
        case 'patrol':
          node.position.x = r.base.x + Math.sin(t * speed * 0.6) * 4
          break
        default:
      }
    }

    if (!player) return
    const node = player.item.node

    const solids: THREE.Box3[] = []
    for (const r of this.rt) {
      if (r !== player && r.active && r.item.obj.solid && r.item.obj.shape !== 'light') {
        solids.push(this.boxOf(r.item.node))
      }
    }

    let dx = 0
    let dz = 0
    let wantJump = false
    if (!this.won) {
      const k = this.keys
      if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1
      if (k.has('KeyD') || k.has('ArrowRight')) dx += 1
      if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1
      if (k.has('KeyS') || k.has('ArrowDown')) dz += 1
      dx += this.moveX
      dz += this.moveZ
      wantJump = k.has('Space') || this.jumpHeld
    }
    const len = Math.hypot(dx, dz)
    if (len > 1) {
      dx /= len
      dz /= len
    }
    const step = player.item.obj.speed * dt
    dx *= step
    dz *= step

    node.position.x += dx
    this.resolveHorizontal(node, solids, 'x', dx)
    node.position.z += dz
    this.resolveHorizontal(node, solids, 'z', dz)

    if (wantJump && this.onGround) {
      this.vy = JUMP_SPEED
      this.onGround = false
    }
    this.vy -= GRAVITY * dt
    node.position.y += this.vy * dt
    this.onGround = false
    let pb = this.boxOf(node, 0, 0.01)
    for (const s of solids) {
      if (!pb.intersectsBox(s)) continue
      if (this.vy <= 0) {
        node.position.y += s.max.y - pb.min.y
        this.onGround = true
      } else {
        node.position.y -= pb.max.y - s.min.y
      }
      this.vy = 0
      pb = this.boxOf(node, 0, 0.01)
    }

    if (node.position.y < KILL_Y) this.respawn('You fell! Back to the start')

    // interactions
    const touch = this.boxOf(node)
    const hasGoal = this.rt.some((x) => x.item.obj.behavior === 'goal')
    for (const r of this.rt) {
      if (r === player || !r.active) continue
      const b = r.item.obj.behavior
      if (b !== 'collectible' && b !== 'hazard' && b !== 'goal' && b !== 'patrol') continue
      if (!touch.intersectsBox(this.boxOf(r.item.node))) continue
      if (b === 'collectible') {
        r.active = false
        r.item.node.visible = false
        this.score += 1
        if (this.score >= this.total && !hasGoal) {
          this.won = true
          this.emit('won', 'You collected everything!')
        } else {
          this.emit('playing', `Collected ${this.score}/${this.total}`)
        }
      } else if (b === 'goal') {
        if (!this.won) {
          this.won = true
          this.emit('won', 'You reached the goal!')
        }
      } else if (!this.won) {
        this.respawn('Ouch! Back to the start')
      }
    }

    // follow camera
    const p = node.position
    const desired = new THREE.Vector3(p.x, p.y + 6, p.z + 10)
    this.camera.position.lerp(desired, 1 - Math.pow(0.002, dt))
    this.camera.lookAt(p.x, p.y + 0.5, p.z)
  }
}
