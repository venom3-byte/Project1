import { useSyncExternalStore } from 'react'
import { makeObject, starterScene, uid } from './starter'
import type { AssetFormat, PlayStatus, SceneObject, Shape, TransformMode } from './types'

export interface EditorState {
  objects: SceneObject[]
  selectedId: string | null
  mode: TransformMode
  snap: boolean
  playing: boolean
  play: PlayStatus
  canUndo: boolean
  canRedo: boolean
  projectName: string
}

const STORAGE_KEY = 'game-editor:project:v1'
const IDLE: PlayStatus = { state: 'idle', score: 0, total: 0, message: '' }

let state: EditorState = {
  objects: starterScene(),
  selectedId: null,
  mode: 'translate',
  snap: false,
  playing: false,
  play: IDLE,
  canUndo: false,
  canRedo: false,
  projectName: 'Untitled Project',
}

let past: SceneObject[][] = []
let future: SceneObject[][] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function getState(): EditorState {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useEditor(): EditorState {
  return useSyncExternalStore(subscribe, getState, getState)
}

function setState(patch: Partial<EditorState>) {
  state = { ...state, ...patch }
  emit()
}

/* ---------- history ---------- */

export function pushHistory() {
  past.push(state.objects)
  if (past.length > 100) past.shift()
  future = []
  setState({ canUndo: true, canRedo: false })
}

function keepSelection(objects: SceneObject[]): string | null {
  return objects.some((o) => o.id === state.selectedId) ? state.selectedId : null
}

export function undo() {
  const prev = past.pop()
  if (!prev) return
  future.push(state.objects)
  setState({
    objects: prev,
    selectedId: keepSelection(prev),
    canUndo: past.length > 0,
    canRedo: true,
  })
}

export function redo() {
  const next = future.pop()
  if (!next) return
  past.push(state.objects)
  setState({
    objects: next,
    selectedId: keepSelection(next),
    canUndo: true,
    canRedo: future.length > 0,
  })
}

/* ---------- editing ---------- */

export function select(id: string | null) {
  if (state.selectedId !== id) setState({ selectedId: id })
}

export function setMode(mode: TransformMode) {
  setState({ mode })
}

export function toggleSnap() {
  setState({ snap: !state.snap })
}

export function setProjectName(projectName: string) {
  setState({ projectName })
}

export function updateObject(id: string, patch: Partial<SceneObject>, history = false) {
  if (history) pushHistory()
  setState({
    objects: state.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  })
}

export function addShape(shape: Shape) {
  pushHistory()
  const n = state.objects.length
  const obj = makeObject(shape, {
    position: [((n % 5) - 2) * 2, shape === 'light' ? 6 : 0.5, -Math.floor(n / 5) * 2],
  })
  setState({ objects: [...state.objects, obj], selectedId: obj.id })
}

export function addModel(name: string, modelData: string, modelFormat: AssetFormat = 'glb', assetFiles?: Record<string, string>) {
  pushHistory()
  const obj = makeObject('model', {
    name,
    modelData,
    modelFormat,
    assetFiles,
    position: [0, 0.5, 0],
  })
  setState({ objects: [...state.objects, obj], selectedId: obj.id })
}

export function addImage(name: string, imageData: string) {
  pushHistory()
  const obj = makeObject('image', {
    name,
    modelData: imageData,
    modelFormat: 'image',
    position: [0, 0.5, 0],
    scale: [3, 3, 3],
  })
  setState({ objects: [...state.objects, obj], selectedId: obj.id })
}

export function removeSelected() {
  const id = state.selectedId
  if (!id) return
  pushHistory()
  setState({
    objects: state.objects.filter((o) => o.id !== id),
    selectedId: null,
  })
}

export function duplicateSelected() {
  const src = state.objects.find((o) => o.id === state.selectedId)
  if (!src) return
  pushHistory()
  const copy: SceneObject = {
    ...src,
    id: uid(),
    name: `${src.name} copy`,
    position: [src.position[0] + 1, src.position[1], src.position[2] + 1],
  }
  setState({ objects: [...state.objects, copy], selectedId: copy.id })
}

export function newProject() {
  pushHistory()
  setState({ objects: starterScene(), selectedId: null, projectName: 'Untitled Project' })
}

export function clearScene() {
  pushHistory()
  setState({ objects: [], selectedId: null })
}

/* ---------- play ---------- */

export function setPlaying(playing: boolean) {
  setState({ playing, play: playing ? state.play : IDLE })
}

export function setPlayStatus(play: PlayStatus) {
  setState({ play })
}

/* ---------- persistence ---------- */

export function exportJson(): string {
  return JSON.stringify(
    { format: 'game-editor', version: 2, name: state.projectName, objects: state.objects },
    null,
    2,
  )
}

function isSceneObject(v: unknown): v is SceneObject {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.shape === 'string' &&
    Array.isArray(o.position) &&
    Array.isArray(o.rotation) &&
    Array.isArray(o.scale)
  )
}

export function importJson(text: string): boolean {
  try {
    const data = JSON.parse(text) as { name?: unknown; objects?: unknown; selectedId?: unknown }
    if (!Array.isArray(data.objects) || !data.objects.every(isSceneObject)) return false
    pushHistory()
    setState({
      objects: data.objects,
      selectedId: null,
      projectName: typeof data.name === 'string' ? data.name : 'Imported Project',
    })
    return true
  } catch {
    return false
  }
}

export function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, exportJson())
  } catch {
    /* storage full or unavailable */
  }
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as { name?: unknown; objects?: unknown }
    if (!Array.isArray(data.objects) || !data.objects.every(isSceneObject)) return
    past = []
    future = []
    setState({
      objects: data.objects,
      selectedId: null,
      canUndo: false,
      canRedo: false,
      projectName: typeof data.name === 'string' ? data.name : 'Untitled Project',
    })
  } catch {
    /* ignore corrupt storage */
  }
}