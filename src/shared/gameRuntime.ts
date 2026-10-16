import * as THREE from 'three'
import type { PlayStatus, SceneObject } from '../editor/types'

export interface RuntimeItem {
  id: string
  node: THREE.Object3D
  obj: SceneObject
}

interface Runtime extends RuntimeItem {
  base: THREE.Vector3
  active: boolean
}

interface Saved {
  p: THREE.Vector3
  r: THREE.Euler
  s: THREE.Vector3
  visible: boolean
}

/**
 * Game logic shared by the editor's Play mode and exported games:
 * behaviors, simple physics, collisions, scoring and a follow camera.
 */
export class GameRuntime {
  /** currently pressed keyboard codes */
  readonly keys = new Set<string>()
  /** analog / touch input: x,z in [-1,1] and a jump flag */
  readonly touch = { x: 0, z: 0, jump: false }

  private rt: Runtime[]
  private saved = new Map<string, Saved>()
  private player: Runtime | null
  private spawn = new THREE.Vector3()
  private vy = 0
  private onGround = false
  private time = 0
  private score = 0
  private total: number
  private won = false

  constructor(
    items: RuntimeItem[],
    private camera: THREE.PerspectiveCamera,
    private onStatus: (s: PlayStatus) => void,
  ) {
    this.rt = items.map((i) => {
      this.saved.set(i.id, {
        p: i.node.position.clone(),
        r: i.node.rotation.clone(),
        s: i.node.scale.clone(),
        visible: i.node.visible,
      })
      return { ...i, base: i.node.position.clone(), active: true }
    })
    this.player = this.rt.find((r) => r.obj.behavior === 'player') ?? null
    if (this.player) this.spawn.copy(this.player.node.position)
    this.total = this.rt.filter((r) => r.obj.behavior === 'collectible').length
    this.emit(
      'playing',
      this.player
        ? 'Move: WASD / arrows or joystick · Jump: Space or button'
        : 'No Player object: give one object the Player behavior to control it',
    )
  }

  get hasPlayer(): boolean {
    return this.player !== null
  }

  /** put every object back where it was before play started */
  restore() {
    this.saved.forEach((s, id) => {
      const r = this.rt.find((x) => x.id === id)
      if (!r) return
      r.node.position.copy(s.p)
      r.node.rotation.copy(s.r)
      r.node.scale.copy(s.s)
      r.node.visible = s.visible
    })
  }

  private emit(state: PlayStatus['state'], message: string) {
    this.onStatus({ state, score: this.score, total: this.total, message })
  }

  private boxOf(node: THREE.Object3D, shrinkY = 0): THREE.Box3 {
    const b = new THREE.Box3().setFromObject(node)
    b.min.y += shrinkY
    return b
  }

  private respawn(message: string) {
    if (!this.player) return
    this.player.node.position.copy(this.spawn)
    this.vy = 0
    this.emit('playing', message)
  }

  update(rawDt: number) {
    const dt = Math.min(rawDt, 0.05)
    this.time += dt
    const t = this.time
    const player = this.player

    for (const r of this.rt) {
      if (!r.active) continue
      const speed = r.obj.speed
      switch (r.obj.behavior) {
        case 'rotate':
          r.node.rotation.y += speed * dt
          break
        case 'bob':
          r.node.position.y = r.base.y + Math.sin(t * speed) * 0.5
          break
        case 'collectible':
          r.node.rotation.y += 2 * dt
          r.node.position.y = r.base.y + Math.sin(t * 2.5) * 0.15
          break
        case 'patrol':
          r.node.position.x = r.base.x + Math.sin(t * speed * 0.6) * 4
          break
        default:
      }
    }

    if (!player) return
    const node = player.node
    const solids: THREE.Box3[] = []
    for (const r of this.rt) {
      if (r !== player && r.active && r.obj.solid && r.obj.shape !== 'light') solids.push(this.boxOf(r.node))
    }

    const k = this.keys
    let dx = this.touch.x
    let dz = this.touch.z
    if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1
    if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1
    if (k.has('KeyS') || k.has('ArrowDown')) dz += 1
    if (this.won) {
      dx = 0
      dz = 0
    }
    const len = Math.hypot(dx, dz)
    if (len > 1) {
      dx /= len
      dz /= len
    }
    const step = player.obj.speed * dt
    dx *= step
    dz *= step

    node.position.x += dx
    this.resolveHorizontal(node, solids, 'x', dx)
    node.position.z += dz
    this.resolveHorizontal(node, solids, 'z', dz)

    if (!this.won && this.onGround && (k.has('Space') || this.touch.jump)) {
      this.vy = 9
      this.onGround = false
    }
    this.vy -= 25 * dt
    node.position.y += this.vy * dt
    this.onGround = false
    let pb = this.boxOf(node)
    for (const s of solids) {
      if (!pb.intersectsBox(s)) continue
      if (this.vy <= 0) {
        node.position.y += s.max.y - pb.min.y
        this.onGround = true
      } else {
        node.position.y -= pb.max.y - s.min.y
      }
      this.vy = 0
      pb = this.boxOf(node)
    }

    if (node.position.y < -30) this.respawn('You fell! Back to the start')

    const touch = this.boxOf(node)
    for (const r of this.rt) {
      if (r === player || !r.active) continue
      const b = r.obj.behavior
      if (b !== 'collectible' && b !== 'hazard' && b !== 'goal' && b !== 'patrol') continue
      if (!touch.intersectsBox(this.boxOf(r.node))) continue
      if (b === 'collectible') {
        r.active = false
        r.node.visible = false
        this.score += 1
        const hasGoal = this.rt.some((x) => x.obj.behavior === 'goal')
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

    const target = node.position
    const desired = new THREE.Vector3(target.x, target.y + 6, target.z + 10)
    this.camera.position.lerp(desired, 1 - Math.pow(0.002, dt))
    this.camera.lookAt(target.x, target.y + 0.5, target.z)
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
}
