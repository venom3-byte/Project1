import { createFileRoute } from '@tanstack/react-router'

/**
 * Load the real Forge Eye workbench shell rather than the legacy Forge page.
 * The editor is a live HTML/CSS/PlayCanvas viewport with a Rust/WASM geometry
 * core, not a pre-rendered screenshot.
 */
function ForgeHost() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <iframe
        title="Forge Eye — Rust / WebAssembly 3D Workspace"
        src="forge-eye/index.html"
        className="h-full w-full border-0"
        allow="fullscreen; clipboard-read; clipboard-write"
      />
    </main>
  )
}

export const Route = createFileRoute('/')({ component: ForgeHost })
