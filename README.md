# Forge Studio

Forge is a browser-first game and interactive-application development environment.

## What Forge is becoming

Forge is no longer just an asset editor. The target is a complete development environment where a developer or an AI agent can inspect a project, import real assets, compose scenes, author gameplay, simulate physics, run visual QA, fix problems and export a runnable product.

## Current engine foundation

- Rendering/runtime: PlayCanvas 2.22.6 with WebGPU + WebGL2 paths.
- Physics: Rapier 0.21.0 WebAssembly backend.
- Scene model: entity/component data independent from editor UI.
- Editor: viewport, hierarchy, inspector, primitives, cameras and lighting.
- Assets: real GLB and raster import.
- Simulation: rigid bodies, colliders, animation keyframes and executable entity scripts.
- QA: runtime diagnostics and browser smoke tests on desktop and mobile.
- Projects: Forge JSON scene serialization.
- Local bridge: Node server + WebSocket foundation for live agent/browser control.

## Current workflow

1. Launch npm run dev.
2. Open Forge Studio in a browser.
3. Create or import real assets.
4. Compose the scene in the viewport.
5. Add physics and animation.
6. Attach gameplay scripts.
7. Run Play/Simulation.
8. Run Visual QA.
9. Save the Forge project or export the current build package.

## Quality policy

A feature is not considered complete only because a button exists. New engine systems are expected to have a real runtime path, a project data representation, browser test coverage, diagnostics and mobile behavior.

## Architecture

See FORGE_ARCHITECTURE.md.

The architecture is intentionally adapter-based so the editor can evolve without locking every subsystem to one implementation. Rendering, physics, asset processing, audio, networking and AI services can be replaced or extended behind stable Forge data contracts.

## Research direction

The development baseline is continuously compared with current work in Unity, Unreal Engine, Blender, PlayCanvas, Babylon.js, WebGPU, glTF/USD and modern physics runtimes. The purpose is not to copy one engine, but to combine strong ideas into an agent-friendly workflow with fast iteration and built-in visual verification.

## Near-term engine layers

- Asset database, import processors, texture/mesh optimization, LOD and collision generation.
- Prefabs, nested scenes and reusable gameplay modules.
- Material/shader graph and advanced render pipeline.
- Animation import, retargeting, IK, blend trees and ragdolls.
- Navigation, behavior trees, gameplay graphs and input actions.
- Spatial audio and mixer graph.
- Multiplayer replication and network diagnostics.
- AI scene understanding, code generation, tool execution and repair loops.
- Deterministic builds, profiling, regression testing and performance budgets.
- Desktop/mobile packaging and native helpers where browser capabilities require them.
