import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Car,
  Circle,
  CircleDot,
  Database,
  Download,
  FilePlus2,
  Focus,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Magnet,
  Move3d,
  Package,
  Play,
  Redo2,
  Rocket,
  Rotate3d,
  Scale3d,
  SlidersHorizontal,
  Square,
  Triangle,
  Undo2,
  Upload,
} from 'lucide-react'
import type { Engine } from './engine'
import { ExportDialog } from './ExportDialog'
import { Hierarchy, Inspector } from './Panels'
import {
  addImage,
  addModel,
  addShape,
  duplicateSelected,
  exportJson,
  getState,
  importJson,
  loadFromStorage,
  newProject,
  pushHistory,
  redo,
  removeSelected,
  saveToStorage,
  select,
  setMode,
  setPlayStatus,
  setPlaying,
  setProjectName,
  toggleSnap,
  undo,
  updateObject,
  useEditor,
} from './store'
import type { AssetFormat, Shape, TransformMode } from './types'
import { CAR_CONCEPT_URL } from './starter'

const ADD_BUTTONS: { shape: Shape; label: string; icon: typeof Box }[] = [
  { shape: 'box', label: 'Cube', icon: Box },
  { shape: 'sphere', label: 'Sphere', icon: Circle },
  { shape: 'cylinder', label: 'Cylinder', icon: Database },
  { shape: 'cone', label: 'Cone', icon: Triangle },
  { shape: 'torus', label: 'Torus', icon: CircleDot },
  { shape: 'plane', label: 'Plane', icon: Square },
  { shape: 'light', label: 'Light', icon: Lightbulb },
]

const MODES: { mode: TransformMode; label: string; icon: typeof Box; key: string }[] = [
  { mode: 'translate', label: 'Move', icon: Move3d, key: 'W' },
  { mode: 'rotate', label: 'Rotate', icon: Rotate3d, key: 'E' },
  { mode: 'scale', label: 'Scale', icon: Scale3d, key: 'R' },
]

function Btn({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: ReactNode
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs disabled:opacity-40 ${
        active ? 'bg-accent text-accent-foreground ring-1 ring-ring' : 'hover:bg-accent'
      }`}
    >
      {children}
    </button>
  )
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function EditorView() {
  const s = useEditor()
  const hostRef = useRef<HTMLDivElement>(null)
  const glbRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const jsonRef = useRef<HTMLInputElement>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<'none' | 'hierarchy' | 'inspector'>('none')
  const [toast, setToast] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  // load saved project once on the client
  useEffect(() => {
    loadFromStorage()
  }, [])

  // autosave
  useEffect(() => {
    const t = setTimeout(saveToStorage, 600)
    return () => clearTimeout(t)
  }, [s.objects, s.projectName])

  // create the 3D engine (client only)
  useEffect(() => {
    let eng: Engine | null = null
    let cancelled = false
    import('./engine')
      .then(({ Engine: E }) => {
        if (cancelled || !hostRef.current) return
        try {
          eng = new E(hostRef.current, {
            onSelect: (id) => select(id),
            onTransform: (id, position, rotation, scale) =>
              updateObject(id, { position, rotation, scale }),
            onDragStart: () => pushHistory(),
            onPlayStatus: (status) => setPlayStatus(status),
          })
          setEngine(eng)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'WebGL is not available in this browser.')
        }
      })
      .catch(() => setError('Could not load the 3D engine.'))
    return () => {
      cancelled = true
      eng?.dispose()
      setEngine(null)
    }
  }, [])

  useEffect(() => {
    engine?.sync(s.objects, s.selectedId)
  }, [engine, s.objects, s.selectedId])

  useEffect(() => {
    engine?.setMode(s.mode)
  }, [engine, s.mode])

  useEffect(() => {
    engine?.setSnap(s.snap)
  }, [engine, s.snap])

  useEffect(() => {
    if (!engine) return
    if (s.playing) engine.startPlay()
    else engine.stopPlay()
  }, [engine, s.playing])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
      if (e.key === 'Escape' && getState().playing) {
        setPlaying(false)
        return
      }
      if (typing || getState().playing) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        removeSelected()
      } else if (!mod && e.key.toLowerCase() === 'w') setMode('translate')
      else if (!mod && e.key.toLowerCase() === 'e') setMode('rotate')
      else if (!mod && e.key.toLowerCase() === 'r') setMode('scale')
      else if (!mod && e.key.toLowerCase() === 'f') engine?.focusSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const readDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('Could not read the selected file.'))
      }
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected file.'))
      reader.readAsDataURL(file)
    })

  const formatOf = (name: string): AssetFormat | null => {
    const ext = name.split('.').pop()?.toLowerCase()
    if (!ext) return null
    if (['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae', '3ds', 'usdz'].includes(ext)) {
      return ext as AssetFormat
    }
    return null
  }

  const onPickModel = async (files: FileList | null) => {
    const selected = Array.from(files ?? [])
    const main = selected.find((file) => formatOf(file.name)) ?? selected[0]
    if (!main) return
    const format = formatOf(main.name)
    if (!format) {
      setToast('Unsupported 3D asset format')
      return
    }
    try {
      setToast(`Importing ${main.name}…`)
      const data = await readDataUrl(main)
      const companion = Object.fromEntries(
        (await Promise.all(
          selected
            .filter((file) => file !== main)
            .map(async (file) => [file.name, await readDataUrl(file)] as const),
        )),
      )
      addModel(
        main.name.replace(/\.[^.]+$/, ''),
        data,
        format,
        Object.keys(companion).length ? companion : undefined,
      )
      setToast(`Imported ${main.name} with ${selected.length - 1} companion file(s)`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not import the asset')
    }
  }

  const onPickImage = async (file: File | undefined) => {
    if (!file) return
    try {
      setToast(`Importing ${file.name}…`)
      addImage(file.name.replace(/\.[^.]+$/, ''), await readDataUrl(file))
      setToast(`Imported 2D image: ${file.name}`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not import the image')
    }
  }

  const onPickJson = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const ok = typeof reader.result === 'string' && importJson(reader.result)
      setToast(ok ? 'Project loaded' : 'That file is not a valid project')
    }
    reader.readAsText(file)
  }

  const playing = s.playing

  return (
    <div className="dark relative flex h-screen w-screen flex-col overflow-hidden bg-background text-sm text-foreground">
      {/* toolbar */}
      <header className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5">
        <input
          value={s.projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
          className="w-36 shrink-0 rounded-md bg-transparent px-2 py-1 text-sm font-semibold outline-none focus:bg-background"
        />
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />

        <Btn title="Undo (Ctrl+Z)" onClick={undo} disabled={!s.canUndo || playing}>
          <Undo2 className="size-4" />
        </Btn>
        <Btn title="Redo (Ctrl+Y)" onClick={redo} disabled={!s.canRedo || playing}>
          <Redo2 className="size-4" />
        </Btn>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />

        {MODES.map((m) => (
          <Btn
            key={m.mode}
            title={`${m.label} (${m.key})`}
            active={s.mode === m.mode}
            disabled={playing}
            onClick={() => setMode(m.mode)}
          >
            <m.icon className="size-4" />
          </Btn>
        ))}
        <Btn title="Snap to grid" active={s.snap} disabled={playing} onClick={toggleSnap}>
          <Magnet className="size-4" />
        </Btn>
        <Btn title="Focus selected (F)" disabled={playing || !s.selectedId} onClick={() => engine?.focusSelected()}>
          <Focus className="size-4" />
        </Btn>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />

        {ADD_BUTTONS.map((a) => (
          <Btn key={a.shape} title={`Add ${a.label}`} disabled={playing} onClick={() => addShape(a.shape)}>
            <a.icon className="size-4" />
          </Btn>
        ))}
        <Btn title="Import 3D model or asset bundle" disabled={playing} onClick={() => glbRef.current?.click()}>
          <Package className="size-4" />
          <span className="hidden lg:inline">3D</span>
        </Btn>
        <Btn title="Import 2D image / sprite" disabled={playing} onClick={() => imageRef.current?.click()}>
          <ImageIcon className="size-4" />
          <span className="hidden xl:inline">2D</span>
        </Btn>
        <Btn title="Insert high-quality Car Concept test asset" disabled={playing} onClick={() => addModel('Car Concept', CAR_CONCEPT_URL, 'glb')}>
          <Car className="size-4" />
          <span className="hidden xl:inline">Car</span>
        </Btn>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />

        <Btn title="New project (starter scene)" disabled={playing} onClick={newProject}>
          <FilePlus2 className="size-4" />
        </Btn>
        <Btn title="Save project file" onClick={() => download(`${s.projectName || 'project'}.json`, exportJson())}>
          <Download className="size-4" />
        </Btn>
        <Btn title="Load project file" disabled={playing} onClick={() => jsonRef.current?.click()}>
          <Upload className="size-4" />
        </Btn>

        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          <Btn title="Export game (Android APK / web)" disabled={playing} onClick={() => setExportOpen(true)}>
            <Rocket className="size-4" />
            <span>Export</span>
          </Btn>
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
              playing
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-sidebar-primary text-sidebar-primary-foreground'
            }`}
          >
            {playing ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
            {playing ? 'Stop' : 'Play'}
          </button>
        </div>
      </header>

      <input
        ref={glbRef}
        type="file"
        multiple
        accept=".glb,.gltf,.fbx,.obj,.stl,.ply,.dae,.3ds,.usdz"
        className="hidden"
        onChange={(e) => {
          void onPickModel(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/bmp,.png,.jpg,.jpeg,.webp,.svg,.bmp"
        className="hidden"
        onChange={(e) => {
          void onPickImage(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={jsonRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          onPickJson(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* hierarchy */}
        <aside
          className={`${
            panel === 'hierarchy' ? 'absolute inset-y-0 left-0 z-20 flex' : 'hidden'
          } w-60 shrink-0 flex-col border-r border-border bg-card md:static md:flex`}
        >
          <Hierarchy />
        </aside>

        {/* viewport */}
        <main className="relative min-w-0 flex-1 bg-background">
          <div ref={hostRef} className="absolute inset-0" />

          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {error}
            </div>
          ) : null}

          {!playing ? (
            <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-card/80 px-2 py-1 text-[11px] text-muted-foreground">
              Drag to orbit · right-drag to pan · scroll to zoom · click to select
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-2">
              <div className="rounded-md bg-card/85 px-3 py-1.5 text-xs font-semibold">
                Score {s.play.score}/{s.play.total}
              </div>
              {s.play.message ? (
                <div className="rounded-md bg-card/85 px-3 py-1.5 text-xs text-muted-foreground">{s.play.message}</div>
              ) : null}
              {s.play.state === 'won' ? (
                <button
                  type="button"
                  onClick={() => engine?.restartPlay()}
                  className="pointer-events-auto rounded-md bg-sidebar-primary px-4 py-2 text-xs font-semibold text-sidebar-primary-foreground"
                >
                  Play again
                </button>
              ) : null}
            </div>
          )}

          {toast ? (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-card px-3 py-1.5 text-xs shadow-lg ring-1 ring-border">
              {toast}
            </div>
          ) : null}
        </main>

        {/* inspector */}
        <aside
          className={`${
            panel === 'inspector' ? 'absolute inset-y-0 right-0 z-20 flex' : 'hidden'
          } w-64 shrink-0 flex-col border-l border-border bg-card md:static md:flex`}
        >
          <Inspector />
        </aside>
      </div>

      {/* mobile panel switcher */}
      <nav className="flex shrink-0 border-t border-border bg-card md:hidden">
        <button
          type="button"
          onClick={() => setPanel(panel === 'hierarchy' ? 'none' : 'hierarchy')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs ${panel === 'hierarchy' ? 'bg-accent' : ''}`}
        >
          <Layers className="size-4" /> Scene
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === 'inspector' ? 'none' : 'inspector')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs ${panel === 'inspector' ? 'bg-accent' : ''}`}
        >
          <SlidersHorizontal className="size-4" /> Inspector
        </button>
      </nav>

      {exportOpen ? <ExportDialog onClose={() => setExportOpen(false)} /> : null}
    </div>
  )
}
