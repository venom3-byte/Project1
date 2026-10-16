import * as THREE from 'three'
import { GameRuntime } from '../shared/gameRuntime'
import { addWorldLights, applyProps, buildNode } from '../shared/sceneBuilder'
import type { PlayStatus, SceneObject } from '../editor/types'

interface GameData {
  name: string
  objects: SceneObject[]
}

function readGame(): GameData | null {
  const el = document.getElementById('game-data')
  if (!el || !el.textContent) return null
  try {
    return JSON.parse(el.textContent) as GameData
  } catch {
    return null
  }
}

const CSS = `
html,body{margin:0;height:100%;overflow:hidden;background:#1b2130;touch-action:none;
  -webkit-user-select:none;user-select:none;font-family:system-ui,sans-serif;color:#fff}
canvas{display:block;width:100vw;height:100vh}
#hud{position:fixed;top:env(safe-area-inset-top,0);left:0;right:0;display:flex;flex-direction:column;
  align-items:center;gap:6px;padding:10px;pointer-events:none;font-size:14px}
#hud div{background:rgba(20,26,40,.75);padding:6px 12px;border-radius:8px}
#stick{position:fixed;left:24px;bottom:calc(24px + env(safe-area-inset-bottom,0));width:130px;height:130px;
  border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.25)}
#knob{position:absolute;left:35px;top:35px;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.4)}
#jump{position:fixed;right:28px;bottom:calc(40px + env(safe-area-inset-bottom,0));width:92px;height:92px;
  border-radius:50%;background:rgba(66,133,244,.55);border:2px solid rgba(255,255,255,.4);
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px}
#win{position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;
  gap:14px;background:rgba(10,14,24,.6);font-size:24px;font-weight:700}
#win button{font-size:16px;padding:10px 22px;border:0;border-radius:10px;background:#4285f4;color:#fff}
`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, id?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (id) e.id = id
  return e
}

function start() {
  const data = readGame()
  const style = el('style')
  style.textContent = CSS
  document.head.appendChild(style)

  if (!data) {
    document.body.textContent = 'Game data is missing.'
    return
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  document.body.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#1b2130')
  scene.fog = new THREE.Fog('#1b2130', 60, 140)
  addWorldLights(scene)

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  camera.position.set(0, 8, 14)

  const items = data.objects.map((o) => {
    const node = buildNode(o)
    applyProps(o, node)
    scene.add(node)
    return { id: o.id, node, obj: o }
  })

  // heads-up display
  const hud = el('div', 'hud')
  const scoreBox = el('div')
  const msgBox = el('div')
  hud.append(scoreBox, msgBox)
  document.body.appendChild(hud)

  const win = el('div', 'win')
  const winText = el('div')
  const again = el('button')
  again.textContent = 'Play again'
  again.onclick = () => location.reload()
  win.append(winText, again)
  document.body.appendChild(win)

  const onStatus = (s: PlayStatus) => {
    scoreBox.textContent = `${data.name}  ·  Score ${s.score}/${s.total}`
    msgBox.textContent = s.message
    msgBox.style.display = s.message ? 'block' : 'none'
    if (s.state === 'won') {
      winText.textContent = s.message
      win.style.display = 'flex'
    }
  }

  const game = new GameRuntime(items, camera, onStatus)

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    game.keys.add(e.code)
  })
  window.addEventListener('keyup', (e) => game.keys.delete(e.code))

  // touch controls (joystick + jump)
  const stick = el('div', 'stick')
  const knob = el('div', 'knob')
  stick.appendChild(knob)
  const jump = el('div', 'jump')
  jump.textContent = 'JUMP'
  document.body.append(stick, jump)

  let stickId: number | null = null
  const moveStick = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let dx = (e.clientX - cx) / (r.width / 2)
    let dy = (e.clientY - cy) / (r.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    game.touch.x = dx
    game.touch.z = dy
    knob.style.transform = `translate(${dx * 35}px, ${dy * 35}px)`
  }
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId
    stick.setPointerCapture(e.pointerId)
    moveStick(e)
  })
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) moveStick(e)
  })
  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return
    stickId = null
    game.touch.x = 0
    game.touch.z = 0
    knob.style.transform = 'translate(0,0)'
  }
  stick.addEventListener('pointerup', endStick)
  stick.addEventListener('pointercancel', endStick)
  jump.addEventListener('pointerdown', () => {
    game.touch.jump = true
  })
  const endJump = () => {
    game.touch.jump = false
  }
  jump.addEventListener('pointerup', endJump)
  jump.addEventListener('pointercancel', endJump)
  jump.addEventListener('pointerleave', endJump)

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  const clock = new THREE.Clock()
  const loop = () => {
    requestAnimationFrame(loop)
    game.update(clock.getDelta())
    renderer.render(scene, camera)
  }
  loop()
}

start()
