# Warfront RTS — M0 vertical slice

This directory is an independent browser game prototype inside Project1. It does not replace or edit the Forge editor route.

## Run

The page is served as static files from \`public/warfront/\`. On a deployed build that preserves the repository's public directory, open \`/warfront/index.html\`. A public URL is only considered verified after a deployment is available and the page is opened in a browser.

## Controls

- Tap/click a vehicle to select it.
- \`MOVE\`: choose a destination on the terrain.
- \`ATTACK\`: choose an enemy unit or objective.
- \`AIRSTRIKE\`: choose a live hostile target. A ready aircraft taxis, takes off, follows a route, releases a weapon, returns, lands and rearms.
- \`RETURN\`: order the selected aircraft back to base.
- Drag to pan the camera; wheel or two-finger pinch to zoom.
- Keyboard shortcuts: \`M\`, \`A\`, \`F\`, \`R\`, \`Esc\`.
- \`RESTART\`: resets the mission scenario.

## Asset and validation notes

The scene includes detailed local procedural fallbacks so the simulation can run even if a remote GLB host blocks CORS or an external asset changes. The code attempts to load open GLB assets asynchronously; the remote asset load is not a guarantee that every source will be reachable in every host environment. Imported geometry is not proof of a Blender-authored animation rig: tank mechanisms and the air sortie loop include procedural runtime animation. The initial slice has not yet been validated by a human frame-by-frame video comparison or a real-device performance run.

Read \`../../docs/warfront-rts-production-plan.md\` for the staged roadmap, asset-governance rules, reference-video method and acceptance checklist.

## Licence

This prototype code is part of the user's Project1 repository. Models are loaded from public third-party URLs at runtime; recheck each third-party source's asset-specific licence and availability before shipping an app bundle or mirroring model files. A static page should never silently represent a remotely loaded asset as a locally bundled file.
