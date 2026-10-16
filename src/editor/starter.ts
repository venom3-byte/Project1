import type { SceneObject, Shape } from './types'

let counter = 0

export const CAR_CONCEPT_URL =
  'https://assets.macaly-user-data.dev/krejgsf8oalserz1lhd45fy0/r06pdypbhojqest3cylj93hy/wVK1ftf-ULse2N7EQTYgz/car-concept-qaTX70WS.glb'

const LABELS: Record<Shape, string> = {
  box: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  torus: 'Torus',
  plane: 'Plane',
  light: 'Light',
  model: '3D Model',
  image: '2D Image',
}

export function uid(): string {
  counter += 1
  return `o${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 5)}`
}

export function makeObject(shape: Shape, patch: Partial<SceneObject> = {}): SceneObject {
  return {
    id: uid(),
    name: LABELS[shape],
    shape,
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: shape === 'light' ? '#fff2c6' : '#8a9bb0',
    solid: false,
    behavior: 'none',
    speed: 2,
    intensity: 300,
    ...patch,
  }
}

function platform(name: string, x: number, y: number, z: number, w = 4, d = 4): SceneObject {
  return makeObject('box', {
    name,
    position: [x, y, z],
    scale: [w, 0.5, d],
    color: '#c9a86a',
    solid: true,
  })
}

function gem(x: number, y: number, z: number, n: number): SceneObject {
  return makeObject('box', {
    name: `Gem ${n}`,
    position: [x, y, z],
    rotation: [0, 45, 0],
    scale: [0.5, 0.5, 0.5],
    color: '#ffd23f',
    behavior: 'collectible',
    speed: 2,
  })
}

export function starterScene(): SceneObject[] {
  return [
    makeObject('box', {
      name: 'Ground',
      position: [0, -0.5, 0],
      scale: [40, 1, 40],
      color: '#3f6b4f',
      solid: true,
    }),
    makeObject('box', {
      name: 'Player',
      position: [0, 0.5, 6],
      color: '#4f8cff',
      behavior: 'player',
      speed: 6,
    }),
    platform('Platform 1', 4, 1, -2),
    platform('Platform 2', -5, 2, -6),
    platform('Platform 3', 0, 3, -11),
    platform('Platform 4', 7, 4, -13),
    gem(4, 2.2, -2, 1),
    gem(-5, 3.2, -6, 2),
    gem(0, 4.2, -11, 3),
    makeObject('cone', {
      name: 'Spikes',
      position: [-3, 0.5, 2],
      color: '#e5484d',
      behavior: 'hazard',
    }),
    makeObject('box', {
      name: 'Enemy',
      position: [0, 0.5, -4],
      color: '#e5484d',
      behavior: 'patrol',
      speed: 2,
    }),
    makeObject('torus', {
      name: 'Goal',
      position: [7, 5.4, -13],
      rotation: [90, 0, 0],
      scale: [1.2, 1.2, 1.2],
      color: '#42d392',
      behavior: 'goal',
    }),
    makeObject('light', {
      name: 'Sun lamp',
      position: [0, 10, 0],
      intensity: 500,
    }),
  ]
}