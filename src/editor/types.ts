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
  | 'physics'
  | 'jumppad'
  | 'checkpoint'

export type RuleTrigger = 'touch' | 'start'

export type RuleAction = 'message' | 'score' | 'hide' | 'show' | 'teleport' | 'win' | 'respawn' | 'launch'

/** One visual-script rule: "when <trigger> on this object, do <action>". */
export interface Rule {
  id: string
  on: RuleTrigger
  action: RuleAction
  /** id of another object (hide / show / teleport) */
  target?: string
  text?: string
  /** fire only the first time */
  once: boolean
}

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
  /** Material tuning for primitive shapes. Defaults: roughness 0.6, metalness 0.05, opacity 1, no glow. */
  roughness?: number
  metalness?: number
  opacity?: number
  emissive?: string
  emissiveIntensity?: number
  /** Visual-script rules (events and actions). */
  rules?: Rule[]
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
  { value: 'physics', label: 'Physics body', hint: 'Falls with gravity, bounces a little, can be pushed by the player and stacked.' },
  { value: 'jumppad', label: 'Jump pad', hint: 'Launches the player high into the air on touch.' },
  { value: 'checkpoint', label: 'Checkpoint', hint: 'Touch it to set the new respawn point.' },
]

export const RULE_TRIGGERS: { value: RuleTrigger; label: string }[] = [
  { value: 'touch', label: 'When the player touches this' },
  { value: 'start', label: 'When the game starts' },
]

export const RULE_ACTIONS: { value: RuleAction; label: string; target: boolean; text: boolean }[] = [
  { value: 'message', label: 'Show a message', target: false, text: true },
  { value: 'score', label: 'Add 1 to the score', target: false, text: true },
  { value: 'hide', label: 'Hide / remove an object', target: true, text: false },
  { value: 'show', label: 'Show an object', target: true, text: false },
  { value: 'teleport', label: 'Teleport the player to an object', target: true, text: false },
  { value: 'launch', label: 'Launch the player upward', target: false, text: false },
  { value: 'respawn', label: 'Send the player back to the start', target: false, text: true },
  { value: 'win', label: 'Win the game', target: false, text: true },
]