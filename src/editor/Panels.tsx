import { useEffect, useState } from 'react'
import { Box, CircleDot, Circle, Copy, Database, Image as ImageIcon, Lightbulb, Package, Square, Trash2, Triangle } from 'lucide-react'
import {
  duplicateSelected,
  pushHistory,
  removeSelected,
  select,
  updateObject,
  useEditor,
} from './store'
import { BEHAVIORS, type Behavior, type SceneObject, type Shape, type Vec3 } from './types'

const ICONS: Record<Shape, typeof Box> = {
  box: Box,
  sphere: Circle,
  cylinder: Database,
  cone: Triangle,
  torus: CircleDot,
  plane: Square,
  light: Lightbulb,
  model: Package,
  image: ImageIcon,
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

function NumField({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (v: number) => void
  label?: string
}) {
  const [text, setText] = useState(fmt(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(fmt(value))
  }, [value, focused])

  return (
    <label className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1">
      {label ? <span className="text-[10px] font-medium uppercase text-muted-foreground">{label}</span> : null}
      <input
        inputMode="decimal"
        value={text}
        onFocus={() => {
          setFocused(true)
          pushHistory()
        }}
        onBlur={() => {
          setFocused(false)
          setText(fmt(value))
        }}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
        className="w-full min-w-0 bg-transparent text-xs outline-none"
      />
    </label>
  )
}

function VecRow({
  title,
  value,
  onChange,
}: {
  title: string
  value: Vec3
  onChange: (v: Vec3) => void
}) {
  const axes = ['X', 'Y', 'Z']
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <div className="flex gap-1">
        {axes.map((a, i) => (
          <NumField
            key={a}
            label={a}
            value={value[i]}
            onChange={(v) => {
              const next: Vec3 = [value[0], value[1], value[2]]
              next[i] = v
              onChange(next)
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function Hierarchy() {
  const s = useEditor()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Scene ({s.objects.length})
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {s.objects.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">The scene is empty. Use the Add buttons in the toolbar.</p>
        ) : null}
        {s.objects.map((o) => {
          const Icon = ICONS[o.shape] ?? Box
          const active = o.id === s.selectedId
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => select(o.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'hover:bg-accent'
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{o.name}</span>
              {o.behavior !== 'none' ? (
                <span className="ml-auto shrink-0 rounded bg-background/40 px-1 text-[10px] opacity-80">
                  {o.behavior}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Inspector() {
  const s = useEditor()
  const obj: SceneObject | undefined = s.objects.find((o) => o.id === s.selectedId)

  if (!obj) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Inspector
        </div>
        <div className="space-y-2 p-3 text-xs text-muted-foreground">
          <p>Select an object in the viewport or the scene list to edit it.</p>
          <p>Give one object the Player behavior, then press Play to test your game.</p>
        </div>
      </div>
    )
  }

  const set = (patch: Partial<SceneObject>) => updateObject(obj.id, patch)
  const hint = BEHAVIORS.find((b) => b.value === obj.behavior)?.hint

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inspector</span>
        <div className="flex gap-1">
          <button
            type="button"
            title="Duplicate (Ctrl+D)"
            onClick={duplicateSelected}
            className="rounded-md p-1.5 hover:bg-accent"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            title="Delete (Del)"
            onClick={removeSelected}
            className="rounded-md p-1.5 text-destructive-foreground hover:bg-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <input
          value={obj.name}
          onFocus={pushHistory}
          onChange={(e) => set({ name: e.target.value })}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
        />

        <VecRow title="Position" value={obj.position} onChange={(v) => set({ position: v })} />
        <VecRow title="Rotation (deg)" value={obj.rotation} onChange={(v) => set({ rotation: v })} />
        {obj.shape !== 'light' ? (
          <VecRow title="Scale" value={obj.scale} onChange={(v) => set({ scale: v })} />
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Color</span>
          <input
            type="color"
            value={obj.color}
            onPointerDown={pushHistory}
            onChange={(e) => set({ color: e.target.value })}
            className="h-7 w-14 cursor-pointer rounded border border-input bg-transparent"
          />
        </div>

        {obj.shape === 'light' ? (
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">Intensity</div>
            <NumField value={obj.intensity} onChange={(v) => set({ intensity: Math.max(0, v) })} />
          </div>
        ) : (
          <>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[11px] font-medium text-muted-foreground">Solid (blocks the player)</span>
              <input
                type="checkbox"
                checked={obj.solid}
                onChange={(e) => updateObject(obj.id, { solid: e.target.checked }, true)}
                className="size-4 accent-current"
              />
            </label>

            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Behavior</div>
              <select
                value={obj.behavior}
                onChange={(e) => updateObject(obj.id, { behavior: e.target.value as Behavior }, true)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
              >
                {BEHAVIORS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
              {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
            </div>

            {obj.behavior !== 'none' && obj.behavior !== 'goal' && obj.behavior !== 'hazard' ? (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">Speed</div>
                <NumField value={obj.speed} onChange={(v) => set({ speed: v })} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
