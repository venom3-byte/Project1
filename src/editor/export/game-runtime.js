// Standalone game runtime. Shipped inside exported games (web + Android).
// Plain ES module: it runs in any modern browser / Android WebView.
// Resolved through the importmap in index.html: "three" -> ./vendor/three.module.js
import * as THREE from 'three'
import { GLTFLoader } from './vendor/GLTFLoader.js'

const DEG = Math.PI / 180

function el(tag, css, parent, text) {
  const e = document.createElement(tag)
  e.style.cssText = css
  if (text) e.textContent = text
  if (parent) parent.appendChild(e)
  return e
}

function fail(message) {
  document.body.textContent = message
  document.body.style.cssText = 'color:#fff;padding:24px;font-family:system-ui,sans-serif'
}

async function main() {
  let data
  try {
    const res = await fetch('./scene.json')
    data = await res.json()
  } catch (err) {
    fail('Could not load scene.json')
    return
  }
  start(data)
}

function buildNode(o) {
  const color = new THREE.Color(o.color || '#8a9bb0')
  if (o.shape === 'light') {
    const g = new THREE.Group()
    g.add(new THREE.PointLight(color, o.intensity, 60))
    return g
  }
  if (o.shape === 'model') {
    const g = new THREE.Group()
    if (o.modelData) {
      new GLTFLoader().load(o.modelData, (gltf) => {
        gltf.scene.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true
            c.receiveShadow = true
          }
        })
        g.add(gltf.scene)
      })
    }
    return g
  }
  let geo
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
  return mesh
}

function start(data) {
  const objects = Array.isArray(data.objects) ? data.objects : []
  const host = document.getElementById('game')

  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch (err) {
    fail('WebGL is not supported on this device.')
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.style.display = 'block'
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#1b2130')
  scene.fog = new THREE.Fog('#1b2130', 60, 140)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
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

  function resize() {
    const w = Math.max(window.innerWidth, 1)
    const h = Math.max(window.innerHeight, 1)
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  // ---- build runtime objects ----
  const rt = objects.map((o) => {
    const node = buildNode(o)
    node.position.set(o.position[0], o.position[1], o.position[2])
    node.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG)
    node.scale.set(o.scale[0], o.scale[1], o.scale[2])
    scene.add(node)
    return {
      node,
      obj: o,
      init: { p: node.position.clone(), r: node.rotation.clone(), s: node.scale.clone() },
      active: true,
    }
  })
  const player = rt.find((r) => r.obj.behavior === 'player') || null
  const total = rt.filter((r) => r.obj.behavior === 'collectible').length
  const hasGoal = rt.some((r) => r.obj.behavior === 'goal')

  // ---- HUD ----
  const hud = el(
    'div',
    'position:fixed;top:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;pointer-events:none;color:#fff;font:600 14px system-ui,sans-serif;text-shadow:0 1px 3px #000',
    document.body,
  )
  const scoreEl = el('div', 'background:rgba(20,26,40,.75);padding:6px 12px;border-radius:8px', hud)
  const msgEl = el('div', 'background:rgba(20,26,40,.75);padding:6px 12px;border-radius:8px;font-weight:500;display:none', hud)
  const againBtn = el(
    'button',
    'pointer-events:auto;display:none;background:#3b82f6;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:600 14px system-ui,sans-serif',
    hud,
    'Play again',
  )

  // ---- game state ----
  const spawn = player ? player.node.position.clone() : new THREE.Vector3()
  let vy = 0
  let onGround = false
  let time = 0
  let score = 0
  let won = false

  function setMessage(text) {
    msgEl.textContent = text
    msgEl.style.display = text ? 'block' : 'none'
  }
  function updateScore() {
    scoreEl.textContent = 'Score ' + score + '/' + total
  }
  function snapCamera() {
    if (player) {
      const p = player.node.position
      camera.position.set(p.x, p.y + 6, p.z + 10)
      camera.lookAt(p.x, p.y + 0.5, p.z)
    } else {
      camera.position.set(9, 8, 12)
      camera.lookAt(0, 1, 0)
    }
  }
  function reset() {
    for (const r of rt) {
      r.node.position.copy(r.init.p)
      r.node.rotation.copy(r.init.r)
      r.node.scale.copy(r.init.s)
      r.node.visible = true
      r.active = true
    }
    vy = 0
    onGround = false
    time = 0
    score = 0
    won = false
    againBtn.style.display = 'none'
    updateScore()
    setMessage(player ? '' : 'No Player object in this scene')
    snapCamera()
  }
  function win(text) {
    if (won) return
    won = true
    setMessage(text)
    againBtn.style.display = 'block'
  }
  againBtn.addEventListener('click', reset)

  // ---- input: keyboard + touch ----
  const keys = new Set()
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault()
    keys.add(e.code)
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))

  const touch = { x: 0, z: 0, jump: false }
  const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0
  if (isTouch && player) {
    const base = el(
      'div',
      'position:fixed;left:28px;bottom:28px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.3);touch-action:none',
      document.body,
    )
    const knob = el(
      'div',
      'position:absolute;left:37px;top:37px;width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.55);pointer-events:none',
      base,
    )
    let activeId = null
    const move = (e) => {
      const rect = base.getBoundingClientRect()
      let dx = e.clientX - (rect.left + rect.width / 2)
      let dy = e.clientY - (rect.top + rect.height / 2)
      const len = Math.hypot(dx, dy)
      const max = 50
      if (len > max) {
        dx = (dx / len) * max
        dy = (dy / len) * max
      }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'
      touch.x = dx / max
      touch.z = dy / max
    }
    base.addEventListener('pointerdown', (e) => {
      activeId = e.pointerId
      base.setPointerCapture(e.pointerId)
      move(e)
    })
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === activeId) move(e)
    })
    const end = (e) => {
      if (e.pointerId !== activeId) return
      activeId = null
      touch.x = 0
      touch.z = 0
      knob.style.transform = 'translate(0,0)'
    }
    base.addEventListener('pointerup', end)
    base.addEventListener('pointercancel', end)

    const jump = el(
      'div',
      'position:fixed;right:32px;bottom:44px;width:92px;height:92px;border-radius:50%;background:rgba(59,130,246,.55);border:2px solid rgba(255,255,255,.4);color:#fff;display:flex;align-items:center;justify-content:center;font:700 14px system-ui,sans-serif;touch-action:none',
      document.body,
      'JUMP',
    )
    jump.addEventListener('pointerdown', (e) => {
      touch.jump = true
      jump.setPointerCapture(e.pointerId)
    })
    const jumpEnd = () => {
      touch.jump = false
    }
    jump.addEventListener('pointerup', jumpEnd)
    jump.addEventListener('pointercancel', jumpEnd)
  }

  // ---- physics helpers ----
  function boxOf(node, shrinkY) {
    const b = new THREE.Box3().setFromObject(node)
    b.min.y += shrinkY || 0
    return b
  }

  function resolveHorizontal(node, solids, axis, delta) {
    if (delta === 0) return
    let pb = boxOf(node, 0.05)
    for (const s of solids) {
      if (!pb.intersectsBox(s)) continue
      if (delta > 0) node.position[axis] -= pb.max[axis] - s.min[axis]
      else node.position[axis] += s.max[axis] - pb.min[axis]
      pb = boxOf(node, 0.05)
    }
  }

  function respawn(text) {
    if (!player) return
    player.node.position.copy(spawn)
    vy = 0
    setMessage(text)
  }

  function update(dt) {
    time += dt

    for (const r of rt) {
      if (!r.active) continue
      const speed = r.obj.speed
      switch (r.obj.behavior) {
        case 'rotate':
          r.node.rotation.y += speed * dt
          break
        case 'bob':
          r.node.position.y = r.init.p.y + Math.sin(time * speed) * 0.5
          break
        case 'collectible':
          r.node.rotation.y += 2 * dt
          r.node.position.y = r.init.p.y + Math.sin(time * 2.5) * 0.15
          break
        case 'patrol':
          r.node.position.x = r.init.p.x + Math.sin(time * speed * 0.6) * 4
          break
        default:
      }
    }

    if (!player) return
    const node = player.node
    const solids = []
    for (const r of rt) {
      if (r !== player && r.active && r.obj.solid && r.obj.shape !== 'light') solids.push(boxOf(r.node))
    }

    let dx = 0
    let dz = 0
    let jumpWanted = false
    if (!won) {
      if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1
      if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1
      if (keys.has('KeyW') || keys.has('ArrowUp')) dz -= 1
      if (keys.has('KeyS') || keys.has('ArrowDown')) dz += 1
      const len = Math.hypot(dx, dz)
      if (len > 0) {
        dx /= len
        dz /= len
      }
      if (touch.x !== 0 || touch.z !== 0) {
        const t = Math.min(1, Math.hypot(touch.x, touch.z))
        const tl = Math.hypot(touch.x, touch.z) || 1
        dx = (touch.x / tl) * t
        dz = (touch.z / tl) * t
      }
      jumpWanted = keys.has('Space') || touch.jump
    }
    const step = player.obj.speed * dt
    dx *= step
    dz *= step

    node.position.x += dx
    resolveHorizontal(node, solids, 'x', dx)
    node.position.z += dz
    resolveHorizontal(node, solids, 'z', dz)

    if (jumpWanted && onGround) {
      vy = 9
      onGround = false
    }
    vy -= 25 * dt
    node.position.y += vy * dt
    onGround = false
    let pb = boxOf(node)
    for (const s of solids) {
      if (!pb.intersectsBox(s)) continue
      if (vy <= 0) {
        node.position.y += s.max.y - pb.min.y
        onGround = true
      } else {
        node.position.y -= pb.max.y - s.min.y
      }
      vy = 0
      pb = boxOf(node)
    }

    if (node.position.y < -30) respawn('You fell! Back to the start')

    const touching = boxOf(node)
    for (const r of rt) {
      if (r === player || !r.active) continue
      const b = r.obj.behavior
      if (b !== 'collectible' && b !== 'hazard' && b !== 'goal' && b !== 'patrol') continue
      if (!touching.intersectsBox(boxOf(r.node))) continue
      if (b === 'collectible') {
        r.active = false
        r.node.visible = false
        score += 1
        updateScore()
        if (score >= total && !hasGoal) win('You collected everything!')
        else setMessage('')
      } else if (b === 'goal') {
        win('You reached the goal!')
      } else if (!won) {
        respawn('Ouch! Back to the start')
      }
    }

    const p = node.position
    const desired = new THREE.Vector3(p.x, p.y + 6, p.z + 10)
    camera.position.lerp(desired, 1 - Math.pow(0.002, dt))
    camera.lookAt(p.x, p.y + 0.5, p.z)
  }

  reset()
  let last = performance.now()
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    update(dt)
    renderer.render(scene, camera)
  })
}

main()
