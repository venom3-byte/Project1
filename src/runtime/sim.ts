import * as THREE from 'three'
import type { PlayStatus, Rule, SceneObject } from '../editor/types'

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
  /** vertical velocity (physics bodies) */
  vy: number
  /** player overlapped this object last frame (touch rules fire on entering) */
  touching: boolean
  /** ids of rules already fired (for "once" rules) */
  fired: Set<string>
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
      vy: 0,
      touching: false,
      fired: new Set<string>(),
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
    for (const r of this.rt) if (r.item.obj.rules?.length) this.runRules(r, 'start')
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

  private runRules(r: Runtime, on: Rule['on']) {
    for (const rule of r.item.obj.rules ?? []) {
      if (rule.on !== on) continue
      if (rule.once && r.fired.has(rule.id)) continue
      r.fired.add(rule.id)
      this.doAction(rule)
    }
  }

  private doAction(rule: Rule) {
    const target = rule.target ? this.rt.find((x) => x.item.id === rule.target) : undefined
    const state: PlayStatus['state'] = this.won ? 'won' : 'playing'
    switch (rule.action) {
      case 'message':
        this.emit(state, rule.text || '')
        break
      case 'score':
        this.score += 1
        this.emit(state, rule.text || `Score ${this.score}`)
        break
      case 'hide':
      case 'show': {
        if (!target) break
        const on = rule.action === 'show'
        target.active = on
        target.item.node.visible = on
        break
      }
      case 'teleport':
        if (target && this.player) {
          const t = target.item.node.position
          this.player.item.node.position.set(t.x, t.y + 1.5, t.z)
          this.vy = 0
        }
        break
      case 'launch':
        this.vy = JUMP_SPEED * 1.8
        this.onGround = false
        break
      case 'respawn':
        this.respawn(rule.text || 'Back to the start')
        break
      case 'win':
        if (!this.won) {
          this.won = true
          this.emit('won', rule.text || 'You win!')
        }
        break
      default:
    }
  }

  private bodyBoxes(): THREE.Box3[] {
    return this.rt
      .filter((r) => r.active && r.item.obj.behavior === 'physics')
      .map((r) => this.boxOf(r.item.node, 0, 0.02))
  }

  /** Gravity, landing, small bounce and stacking for 'physics' bodies. */
  private stepBodies(dt: number, statics: THREE.Box3[]) {
    const bodies = this.rt.filter((r) => r.active && r.item.obj.behavior === 'physics')
    for (const r of bodies) {
      const n = r.item.node
      const floor = statics.concat(
        bodies.filter((o) => o !== r).map((o) => this.boxOf(o.item.node, 0, 0.02)),
      )
      r.vy -= GRAVITY * dt
      n.position.y += r.vy * dt
      let b = this.boxOf(n, 0, 0.02)
      for (const s of floor) {
        if (!b.intersectsBox(s)) continue
        if (r.vy <= 0) {
          n.position.y += s.max.y - b.min.y
          r.vy = r.vy < -6 ? -r.vy * 0.3 : 0
        } else {
          n.position.y -= b.max.y - s.min.y
          r.vy = 0
        }
        b = this.boxOf(n, 0, 0.02)
      }
      if (n.position.y < KILL_Y) {
        n.position.copy(r.base)
        r.vy = 0
      }
    }
  }

  /** The player shoves overlapping physics bodies along the axis it just moved on. */
  private pushBodies(player: THREE.Object3D, axis: 'x' | 'z', delta: number, statics: THREE.Box3[]) {
    if (delta === 0) return
    const pb = this.boxOf(player, 0.05)
    for (const r of this.rt) {
      if (!r.active || r.item.obj.behavior !== 'physics') continue
      if (!pb.intersectsBox(this.boxOf(r.item.node))) continue
      const n = r.item.node
      n.position[axis] += delta * 0.9
      const nb = this.boxOf(n, 0.05)
      if (statics.some((s) => nb.intersectsBox(s))) n.position[axis] -= delta * 0.9
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

    const statics: THREE.Box3[] = []
    for (const r of this.rt) {
      if (
        r !== player &&
        r.active &&
        r.item.obj.solid &&
        r.item.obj.shape !== 'light' &&
        r.item.obj.behavior !== 'physics'
      ) {
        statics.push(this.boxOf(r.item.node))
      }
    }
    this.stepBodies(dt, statics)

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
    this.pushBodies(node, 'x', dx, statics)
    this.resolveHorizontal(node, statics.concat(this.bodyBoxes()), 'x', dx)
    node.position.z += dz
    this.pushBodies(node, 'z', dz, statics)
    this.resolveHorizontal(node, statics.concat(this.bodyBoxes()), 'z', dz)

    if (wantJump && this.onGround) {
      this.vy = JUMP_SPEED
      this.onGround = false
    }
    this.vy -= GRAVITY * dt
    node.position.y += this.vy * dt
    this.onGround = false
    let pb = this.boxOf(node, 0, 0.01)
    for (const s of statics.concat(this.bodyBoxes())) {
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
      if (b !== 'collectible' && b !== 'hazard' && b !== 'goal' && b !== 'patrol' && b !== 'jumppad' && b !== 'checkpoint') {
        continue
      }
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
      } else if (b === 'jumppad') {
        this.vy = JUMP_SPEED * 1.8
        this.onGround = false
      } else if (b === 'checkpoint') {
        const cp = r.item.node.position
        if (this.spawn.x !== cp.x || this.spawn.z !== cp.z) {
          this.spawn.set(cp.x, cp.y + 1.5, cp.z)
          this.emit('playing', 'Checkpoint saved')
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

    // visual-script rules: touch triggers fire when the player enters the object
    for (const r of this.rt) {
      if (r === player || !r.active || !r.item.obj.rules?.length) continue
      const hit = touch.intersectsBox(this.boxOf(r.item.node))
      if (hit && !r.touching) this.runRules(r, 'touch')
      r.touching = hit
    }

    // follow camera
    const p = node.position
    const desired = new THREE.Vector3(p.x, p.y + 6, p.z + 10)
    this.camera.position.lerp(desired, 1 - Math.pow(0.002, dt))
    this.camera.lookAt(p.x, p.y + 0.5, p.z)
  }
}
