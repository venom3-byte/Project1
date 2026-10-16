import { createFileRoute } from '@tanstack/react-router'

/**
 * Keep the public Forge workbench isolated from the host app bundle.
 * This mirrors the Macaly Forge host route and preserves its static ES modules.
 */
function ForgeHost() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <iframe
        title="Forge Studio 3.7"
        src="forge/index.html"
        className="h-full w-full border-0"
        allow="fullscreen; clipboard-read; clipboard-write"
      />
    </main>
  )
}

export const Route = createFileRoute('/')({ component: ForgeHost })
