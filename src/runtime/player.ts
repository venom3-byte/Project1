import * as THREE from 'three'
import type { PlayStatus, SceneObject } from '../editor/types'
import { addWorldLights, applyProps, buildNode } from './scene'
import { GameSim, type SimItem } from './sim'

/**
 * Standalone player. It is bundled into one script (public/player/player.js)
 * and used by the web export and the Android (Capacitor) export.
 * The game data is embedded in <script id="game-scene" type="application/json">.
 */

interface GameData {
  name: string
  objects: SceneObject[]
}

function style(node: HTMLElement, css: Partial<CSSStyleDeclaration>) {
  Object.assign(node.style, css)
}

function make(tag: string, css: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const node = document.createElement(tag)
  style(node, css)
  if (text) node.textContent = text
  return node
}

function showError(root: HTMLElement, message: string) {
  root.appendChild(
    make(
      'div',
      {
        position: 'absolute',
        inset: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
        color: '#e6ebf5',
        font: '16px system-ui, sans-serif',
      },
      message,
    ),
  )
}

function readData(): GameData {
  const el = document.getElementById('game-scene')
  if (!el || !el.textContent) throw new Error('Game data is missing.')
  const data = JSON.parse(el.textContent) as Partial<GameData>
  if (!Array.isArray(data.objects)) throw new Error('Game data is invalid.')
  return { name: typeof data.name === 'string' ? data.name : 'Game', objects: data.objects }
}

function addTouchControls(root: HTMLElement, sim: GameSim) {
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  if (!touch) return

  const R = 56
  const base = make('div', {
    position: 'absolute',
    left: '24px',
    bottom: '24px',
    width: `${R * 2}px`,
    height: `${R * 2}px`,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.12)',
    border: '2px solid rgba(255,255,255,0.28)',
    touchAction: 'none',
  })
  const knob = make('div', {
    position: 'absolute',
    left: `${R - 24}px`,
    top: `${R - 24}px`,
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.5)',
    pointerEvents: 'none',
  })
  base.appendChild(knob)
  root.appendChild(base)

  let activeId: number | null = null
  const move = (e: PointerEvent) => {
    const rect = base.getBoundingClientRect()
    let dx = e.clientX - (rect.left + rect.width / 2)
    let dy = e.clientY - (rect.top + rect.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > R) {
      dx = (dx / len) * R
      dy = (dy / len) * R
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`
    sim.setMove(dx / R, dy / R)
  }
  const release = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return
    activeId = null
    knob.style.transform = 'translate(0px, 0px)'
    sim.setMove(0, 0)
  }
  base.addEventListener('pointerdown', (e) => {
    activeId = e.pointerId
    base.setPointerCapture(e.pointerId)
    move(e)
  })
  base.addEventListener('pointermove', (e) => {
    if (e.pointerId === activeId) move(e)
  })
  base.addEventListener('pointerup', release)
  base.addEventListener('pointercancel', release)

  const jump = make(
    'div',
    {
      position: 'absolute',
      right: '28px',
      bottom: '36px',
      width: '88px',
      height: '88px',
      borderRadius: '50%',
      background: 'rgba(79,140,255,0.55)',
      border: '2px solid rgba(255,255,255,0.4)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: '600 15px system-ui, sans-serif',
      touchAction: 'none',
      userSelect: 'none',
    },
    'JUMP',
  )
  jump.addEventListener('pointerdown', (e) => {
    jump.setPointerCapture(e.pointerId)
    sim.setJump(true)
  })
  const jumpOff = () => sim.setJump(false)
  jump.addEventListener('pointerup', jumpOff)
  jump.addEventListener('pointercancel', jumpOff)
  root.appendChild(jump)
}

function main() {
  const root = document.getElementById('game')
  if (!root) return
  style(root, { position: 'fixed', inset: '0', overflow: 'hidden', background: '#1b2130', touchAction: 'none' })

  let data: GameData
  try {
    data = readData()
  } catch (err) {
    showError(root, err instanceof Error ? err.message : 'Could not load the game.')
    return
  }

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch {
    showError(root, 'This device does not support WebGL, so the game cannot start.')
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.style.display = 'block'
  root.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  addWorldLights(scene)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  camera.position.set(0, 8, 14)

  const items: SimItem[] = []
  for (const obj of data.objects) {
    const node = buildNode(obj)
    applyProps(obj, node)
    scene.add(node)
    items.push({ id: obj.id, node, obj })
  }

  // HUD
  const score = make('div', {
    position: 'absolute',
    top: 'max(12px, env(safe-area-inset-top))',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 14px',
    borderRadius: '8px',
    background: 'rgba(20,25,38,0.8)',
    color: '#e6ebf5',
    font: '600 14px system-ui, sans-serif',
    pointerEvents: 'none',
  })
  const message = make('div', {
    position: 'absolute',
    top: 'calc(max(12px, env(safe-area-inset-top)) + 40px)',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '5px 12px',
    borderRadius: '8px',
    background: 'rgba(20,25,38,0.7)',
    color: '#aab4c8',
    font: '13px system-ui, sans-serif',
    pointerEvents: 'none',
    textAlign: 'center',
    maxWidth: '90vw',
  })
  const again = make(
    'button',
    {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '14px 28px',
      borderRadius: '10px',
      border: '0',
      background: '#4f8cff',
      color: '#fff',
      font: '700 18px system-ui, sans-serif',
      display: 'none',
    },
    'Play again',
  )
  root.append(score, message, again)

  const onStatus = (s: PlayStatus) => {
    score.textContent = `Score ${s.score}/${s.total}`
    message.textContent = s.message
    again.style.display = s.state === 'won' ? 'block' : 'none'
  }

  const sim = new GameSim(items, camera, onStatus)
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    sim.keys.add(e.code)
  })
  window.addEventListener('keyup', (e) => sim.keys.delete(e.code))
  again.addEventListener('click', () => sim.restart())
  addTouchControls(root, sim)
  sim.start()

  const resize = () => {
    const w = Math.max(window.innerWidth, 1)
    const h = Math.max(window.innerHeight, 1)
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  window.addEventListener('orientationchange', resize)
  resize()

  const clock = new THREE.Clock()
  const loop = () => {
    requestAnimationFrame(loop)
    sim.update(clock.getDelta())
    renderer.render(scene, camera)
  }
  loop()
}

main()
