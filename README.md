# Forge Studio

Forge is evolving into a browser-first, agent-native game and interactive-application development environment.

## Current Forge production stack

### Engine
- PlayCanvas 2.22.6 with WebGPU/WebGL2.
- Rapier 0.21.0 for rigid-body physics.
- Entity/component scene model.
- 3D viewport, hierarchy, inspector, transforms, cameras, lights and primitives.

### Asset Lab
- Raster asset auditing and preparation.
- Transparent-bound trimming.
- AI background removal with ISNet.
- Sprite-sheet extraction and atlas packing.
- GLB structure, mesh, material, texture, animation, skin and joint auditing.
- PBR Material Lab.
- Server-side GLB Cook pipeline using glTF-Transform 4.5.1 + Meshopt 1.3.0.
- Lossless prune/dedup/resample.
- Automatic LOD package generation.
- Cook manifest with collision and material recommendations.

### World and gameplay
- Deterministic PCG scattering for trees/rocks/buildings.
- World-cell metadata and streaming control.
- Logic Graph foundation.
- Keyframe timeline.
- Entity scripts.
- Input action mapping.
- A* navigation grid.
- Save slots.
- Prefab registry.
- WebAudio spatial playback foundation.

### AI and vision
- Structured Forge Agent Protocol over WebSocket.
- HTTP command bridge at /api/forge/command.
- Live Vision integration for screen-level interaction.
- Engine-state commands are preferred over coordinate clicking.
- Visual QA and browser automation are part of the development loop.

### Build
- Forge project JSON.
- Browser Web build package.
- Local asset bundling into the Web build.
- CI smoke tests on desktop and mobile.

## Engineering rule

A Forge feature is not considered complete merely because it has a UI. It should have a deterministic data representation, a real runtime path, diagnostics, an automated test, and an explicit fallback for unsupported platform features.

## Research baseline

The architecture is continuously compared with modern workflows from Unreal Engine 5.8, PlayCanvas, Blender and the glTF ecosystem. Unreal's recent production workflows emphasize asset management, Nanite/Lumen rendering, PCG, World Partition, animation/rigging, Niagara, MetaSounds, MassEntity and Automation. Forge uses these as reference workflows while implementing a web-first and agent-native architecture.

See:
- FORGE_ARCHITECTURE.md
- FORGE_AGENT_PROTOCOL.md

