import { useEffect, useState } from 'react'
import { Loader2, Smartphone, X, Globe } from 'lucide-react'
import {
  exportAndroidZip,
  exportWebZip,
  preflight,
  slug,
  suggestAppId,
  triggerDownload,
  validateAppId,
  type Orientation,
} from './exporter'
import { useEditor } from './store'

type Target = 'android' | 'web'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const s = useEditor()
  const [target, setTarget] = useState<Target>('android')
  const [appName, setAppName] = useState(s.projectName)
  const [appId, setAppId] = useState(() => suggestAppId(s.projectName))
  const [orientation, setOrientation] = useState<Orientation>('landscape')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const warnings = preflight(s.objects)
  const idError = target === 'android' ? validateAppId(appId) : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async () => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const name = appName.trim() || 'Game'
      if (target === 'android') {
        const blob = await exportAndroidZip(s.objects, { appName: name, appId, orientation })
        triggerDownload(blob, `${slug(name)}-android-project.zip`)
        setDone('Downloaded. Open README.md inside the zip for the 5 steps to get your APK.')
      } else {
        const blob = await exportWebZip(name, s.objects)
        triggerDownload(blob, `${slug(name)}-web.zip`)
        setDone('Downloaded. Upload the folder to any static host to publish the game.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 p-3">
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Export game</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-accent" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTarget('android')}
            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
              target === 'android' ? 'border-ring bg-accent' : 'border-border hover:bg-accent'
            }`}
          >
            <Smartphone className="size-4" /> Android APK
          </button>
          <button
            type="button"
            onClick={() => setTarget('web')}
            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
              target === 'web' ? 'border-ring bg-accent' : 'border-border hover:bg-accent'
            }`}
          >
            <Globe className="size-4" /> Web game
          </button>
        </div>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Game name</span>
            <input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
            />
          </label>

          {target === 'android' ? (
            <>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Android app id (unique, permanent)</span>
                <input
                  value={appId}
                  onChange={(e) => setAppId(e.target.value.trim())}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
                />
                {idError ? <span className="text-[11px] text-destructive">{idError}</span> : null}
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Screen orientation</span>
                <select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as Orientation)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
                >
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                  <option value="auto">Follow the device</option>
                </select>
              </label>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                You get a ready Android project. Upload it to GitHub and the included workflow builds a real
                installable APK in the cloud (Capacitor 8, JDK 21, Android SDK 36). No Android Studio needed.
              </p>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A standalone folder with index.html and the game runtime. Works on any static host.
            </p>
          )}

          {warnings.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-border bg-background p-2 text-[11px] text-muted-foreground">
              {warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {done ? <p className="text-xs text-muted-foreground">{done}</p> : null}

          <button
            type="button"
            disabled={busy || Boolean(idError)}
            onClick={run}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 text-sm font-semibold text-sidebar-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? 'Preparing…' : target === 'android' ? 'Download Android project' : 'Download web game'}
          </button>
        </div>
      </div>
    </div>
  )
}
