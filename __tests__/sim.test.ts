import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyProps } from '../src/runtime/scene'
import { GameSim, type SimItem } from '../src/runtime/sim'
import { makeObject, starterScene } from '../src/editor/starter'
import type { PlayStatus, SceneObject } from '../src/editor/types'

function nodeFor(obj: SceneObject): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  applyProps({ ...obj, shape: 'box' }, mesh)
  return mesh
}

function setup(objects: SceneObject[]) {
  const items: SimItem[] = objects.map((obj) => ({ id: obj.id, node: nodeFor(obj), obj }))
  const camera = new THREE.PerspectiveCamera()
  let last: PlayStatus = { state: 'idle', score: 0, total: 0, message: '' }
  const sim = new GameSim(items, camera, (s) => {
    last = s
  })
  const run = (seconds: number, fps = 60) => {
    const steps = Math.round(seconds * fps)
    for (let i = 0; i < steps; i += 1) sim.update(1 / fps)
  }
  return { items, sim, run, status: () => last }
}

const ground = () =>
  makeObject('box', { name: 'Ground', position: [0, -0.5, 0], scale: [40, 1, 40], solid: true })
const player = (x = 0, y = 0.5, z = 0) =>
  makeObject('box', { name: 'Player', position: [x, y, z], behavior: 'player', speed: 6 })

describe('GameSim', () => {
  it('lets the player fall and land on solid ground', () => {
    const g = ground()
    const p = player(0, 5, 0)
    const { items, sim, run } = setup([g, p])
    sim.start()
    run(2)
    const node = items[1].node
    expect(node.position.y).toBeGreaterThan(0.45)
    expect(node.position.y).toBeLessThan(0.55)
  })

  it('moves with the keyboard and stays on the ground', () => {
    const { items, sim, run } = setup([ground(), player()])
    sim.start()
    run(0.5)
    sim.keys.add('KeyD')
    run(1)
    const node = items[1].node
    expect(node.position.x).toBeGreaterThan(4)
    expect(node.position.y).toBeGreaterThan(0.45)
  })

  it('moves with the virtual joystick', () => {
    const { items, sim, run } = setup([ground(), player()])
    sim.start()
    run(0.5)
    sim.setMove(0, -1)
    run(1)
    expect(items[1].node.position.z).toBeLessThan(-4)
  })

  it('jumps only from the ground', () => {
    const { items, sim, run } = setup([ground(), player()])
    sim.start()
    run(0.5)
    sim.setJump(true)
    run(0.3)
    const node = items[1].node
    expect(node.position.y).toBeGreaterThan(1.2)
    sim.setJump(false)
    run(2)
    expect(node.position.y).toBeLessThan(0.6)
  })

  it('is blocked by solid walls', () => {
    const wall = makeObject('box', { position: [3, 1, 0], scale: [1, 4, 10], solid: true })
    const { items, sim, run } = setup([ground(), wall, player()])
    sim.start()
    run(0.5)
    sim.keys.add('KeyD')
    run(2)
    expect(items[2].node.position.x).toBeLessThan(2.1)
  })

  it('collects items and wins at the goal', () => {
    const gem = makeObject('box', { position: [2, 0.5, 0], scale: [0.5, 0.5, 0.5], behavior: 'collectible' })
    const goal = makeObject('box', { position: [5, 0.5, 0], behavior: 'goal' })
    const { items, sim, run, status } = setup([ground(), gem, goal, player()])
    sim.start()
    run(0.3)
    sim.keys.add('KeyD')
    run(1.5)
    expect(status().score).toBe(1)
    expect(items[1].node.visible).toBe(false)
    run(1.5)
    expect(status().state).toBe('won')
  })

  it('sends the player back to the start after touching a hazard', () => {
    const spikes = makeObject('box', { position: [3, 0.5, 0], behavior: 'hazard' })
    const { items, sim, run } = setup([ground(), spikes, player(0, 0.5, 0)])
    sim.start()
    run(0.3)
    sim.keys.add('KeyD')
    run(1.2)
    sim.keys.clear()
    run(0.1)
    expect(items[2].node.position.x).toBeLessThan(2.2)
  })

  it('respawns when falling out of the world', () => {
    const { items, sim, run } = setup([player(0, 2, 0)])
    sim.start()
    run(4)
    expect(items[0].node.position.y).toBeGreaterThan(-31)
    expect(items[0].node.position.y).toBeLessThan(3)
  })

  it('restores the scene when stopped', () => {
    const gem = makeObject('box', { position: [2, 0.5, 0], behavior: 'collectible' })
    const { items, sim, run } = setup([ground(), gem, player()])
    sim.start()
    run(0.3)
    sim.keys.add('KeyD')
    run(1.5)
    sim.stop()
    expect(items[2].node.position.x).toBeCloseTo(0)
    expect(items[1].node.visible).toBe(true)
  })

  it('plays the bundled starter scene without errors', () => {
    const { sim, run } = setup(starterScene())
    sim.start()
    sim.keys.add('KeyW')
    run(3)
    sim.keys.add('Space')
    run(3)
    expect(sim.isRunning).toBe(true)
  })
})
