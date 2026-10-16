# Forge true 3D workspace — change record

Branch: `agent/forge-true-3d-workspace`

## What changed

- Replaced the flat CSS grid overlay with a ground plane and real 3D grid geometry rendered by PlayCanvas.
- Added major 5 m and minor 1 m subdivisions and colored X/Y/Z world axes; these helpers are not inserted into the editable scene hierarchy or project serialization.
- Added editor camera navigation: middle-mouse orbit, right-mouse pan, wheel zoom, Alt+left orbit, Shift+right orbit, single-touch orbit, and two-touch pan/pinch zoom.
- Selection now occurs on click/tap release rather than every pointer-down, so camera drags are not treated as selection clicks.
- Routed the Grid button to the actual world-grid helper.
- Corrected repeated `importAssets` and `focus` element IDs so the right control handlers are reachable.
- Expanded the Chromium QA flow to check the 3D helpers and prove orbit, pan, and zoom change camera state.

## Scope and limitation

This makes the Forge browser viewport a real navigable 3D workspace with editor-style scene navigation. It does not claim full feature parity with Blender or Unreal Engine 5; those are much larger native/editor rendering and asset-production stacks.
