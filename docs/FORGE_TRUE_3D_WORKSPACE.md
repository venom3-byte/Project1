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


## Interface redesign — 2026-10-16

The desktop and mobile screenshots exposed a second usability problem even after the camera and world grid worked: a floating 15-button production ribbon covered the viewport, the top bar relied on abbreviated letter buttons, and transform controls were separated from view controls.

The follow-up revision changes the interaction hierarchy:
- Project/file actions stay in the application bar; Build and Play stay visible at the far right.
- Select, Move, Rotate and Scale are named viewport tools with Q/W/E/R shortcuts.
- Perspective/Front/Side/Top, Focus, Frame All, Snap, World/Local, Grid and QA share one structured viewport toolbar.
- The production ribbon is replaced by a grouped Toolbox dialog (Assets & Materials; Animation & Effects; World & Gameplay; Diagnostics); the viewport is no longer covered by floating tools.
- Creation buttons are labeled and larger in two columns; inspector labels and controls have stronger spacing and hierarchy.
- Chromium QA checks unique DOM IDs, opens/closes the Toolbox, confirms that the floating ribbon is gone, and preserves camera orbit/pan/zoom and mobile viewport checks.

Reference hierarchy: Unreal's official editor documentation separates the Viewport Toolbar, Level Viewport, Outliner and Details panel; Blender separates 3D viewport tools and navigation gizmos. Forge applies the same hierarchy while keeping browser/mobile constraints.
