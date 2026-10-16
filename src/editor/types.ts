export type Vec3 = [number, number, number]

export type AssetFormat =
  | 'glb'
  | 'gltf'
  | 'fbx'
  | 'obj'
  | 'stl'
  | 'ply'
  | 'dae'
  | '3ds'
  | 'usdz'
  | 'image'

export type Shape =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'plane'
  | 'light'
  | 'model'
  | 'image'

export type Behavior =
  | 'none'
  | 'player'
  | 'rotate'
  | 'bob'
  | 'collectible'
  | 'hazard'
  | 'goal'
  | 'patrol'

export interface SceneObject {
  id: string
  name: string
  shape: Shape
  position: Vec3
  /** degrees */
  rotation: Vec3
  scale: Vec3
  color: string
  /** blocks the player in play mode */
  solid: boolean
  behavior: Behavior
  speed: number
  /** light intensity (lights only) */
  intensity: number
  /** Imported asset URL or data URL. Kept for compatibility with older projects. */
  modelData?: string
  /** Actual asset format so the importer/runtime can select the correct loader. */
  modelFormat?: AssetFormat
  /** Optional companion files for GLTF/OBJ/FBX/etc. Indexed by original file name. */
  assetFiles?: Record<string, string>
}

export type TransformMode = 'translate' | 'rotate' | 'scale'

export type PlayState = 'idle' | 'playing' | 'won'

export interface PlayStatus {
  state: PlayState
  score: number
  total: number
  message: string
}

export const SHAPES: { value: Shape; label: string }[] = [
  { value: 'box', label: 'Cube' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'cone', label: 'Cone' },
  { value: 'torus', label: 'Torus' },
  { value: 'plane', label: 'Plane' },
  { value: 'light', label: 'Light' },
  { value: 'model', label: '3D Model' },
  { value: 'image', label: '2D Image' },
]

export const BEHAVIORS: { value: Behavior; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'Static object.' },
  { value: 'player', label: 'Player', hint: 'WASD / arrows to move, Space to jump. Speed = move speed.' },
  { value: 'rotate', label: 'Rotate', hint: 'Spins around Y. Speed = radians per second.' },
  { value: 'bob', label: 'Bob', hint: 'Floats up and down. Speed = frequency.' },
  { value: 'collectible', label: 'Collectible', hint: 'Disappears on touch and adds to the score.' },
  { value: 'hazard', label: 'Hazard', hint: 'Sends the player back to the start on touch.' },
  { value: 'goal', label: 'Goal', hint: 'Touch it to win.' },
  { value: 'patrol', label: 'Enemy patrol', hint: 'Moves left and right and hurts on touch. Speed = pace.' },
]