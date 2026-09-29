# Forge Studio 2.0

Forge is now being treated as an engine + editor + QA environment rather than only an asset editor.

## Current foundation
- PlayCanvas 2.22.6 runtime with WebGPU/WebGL2 path.
- Rapier 0.21.0 WebAssembly physics backend.
- Entity/component scene model.
- 3D viewport, hierarchy and numeric inspector.
- Box/sphere/cylinder/capsule/plane primitives.
- Camera and directional light creation.
- Real GLB/GLTF and raster import.
- Physics bodies and colliders.
- Keyframe timeline and executable entity scripts.
- Project serialization to Forge JSON.
- Visual smoke diagnostics.
- Mobile-responsive studio layout.
- Local server/WebSocket bridge foundation.

## Engineering direction
The long-term target is a unified environment for games and interactive applications: 2D, 3D, UI, physics, animation, audio, networking, AI-assisted authoring, asset processing, profiling, testing and packaging.

The project deliberately uses replaceable adapters for rendering, physics and asset services. That is important because no single web package should become Forge's permanent architectural ceiling.

## Next engine layers
1. asset database + import processors + automatic LOD/collision/material setup;
2. reusable prefabs and nested scene composition;
3. shader/material graph and advanced rendering/post-processing;
4. animation import/retargeting/IK/blend trees/ragdolls;
5. gameplay graph, input actions, navigation and behavior trees;
6. spatial audio and mixer graph;
7. network simulation/replication/debugger;
8. AI agent with visual feedback loop and safe tool execution;
9. deterministic build/test pipeline, visual regression, performance budgets;
10. desktop/mobile packaging and native helper processes where browser APIs are insufficient.

Every subsystem is expected to ship with a real asset/runtime test, mobile coverage, diagnostics and a visual QA proof.
