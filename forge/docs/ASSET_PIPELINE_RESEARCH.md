# Forge Asset Pipeline Research & Quality Gates

**Reviewed:** 2026-09-29  
**Scope:** editor UI, 2D/3D import-export, spatial correctness, visual QA, and production asset verification.

## Reference architecture

Forge keeps the same core editor information architecture used by mature DCC/game editors: a persistent hierarchy/asset region, central viewport, inspector/properties region, and timeline/diagnostics. Unreal's Static Mesh Editor explicitly exposes viewport, bounds, collision, UV channels and mesh statistics; PlayCanvas's editor similarly separates toolbar, hierarchy, inspector, assets and viewport.

## Geometry and coordinate contract

- glTF 2.0 is the canonical interchange contract for runtime 3D assets.
- Linear units are meters.
- Coordinate system is right-handed: +Y up and +Z forward.
- Node transforms use TRS and the effective world transform must be applied when deriving world bounds.
- Forge therefore reports source dimensions, world dimensions, center, vertices, triangles, UV channels, materials, animation clips and LOD metadata separately.

## 3D export gates

Forge now distinguishes:
1. **Source export** — byte-preserving export of the original imported GLB.
2. **Scene GLB export** — a derived GLB cooked from the current PlayCanvas entity hierarchy.
3. **Manifest export** — machine-readable provenance and spatial metadata.

A valid GLB must retain the glTF magic/version/declared-length contract. The derived GLB is re-imported into Forge and its geometry is compared against the source scene in the automated acceptance suite.

## 2D export gates

2D source images are exported byte-for-byte from the stored source file. Viewport PNGs are explicitly marked as **derived** rather than source-preserving. Export QA records byte count and SHA-256 when the browser security context exposes Web Crypto.

## Visual QA gates

Automated visual checks cover:
- non-empty rendered pixels and pixel variance;
- viewport dimensions;
- desktop editor horizontal overflow;
- mobile viewport dimensions;
- presence of compact touch controls;
- visible hierarchy/inspector/asset pipeline.

The test suite also captures desktop evidence images for later visual inspection.

## Research references

### Official technical references
- Khronos glTF 2.0 specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- Khronos curated glTF assets: https://github.khronos.org/glTF-Assets/
- PlayCanvas asset import pipeline: https://developer.playcanvas.com/user-manual/editor/assets/import-pipeline/
- PlayCanvas asset export: https://developer.playcanvas.com/user-manual/assets/models/exporting/
- PlayCanvas GLTF exporter API: https://api.playcanvas.com/engine/classes/GltfExporter.html
- Unreal Static Mesh Editor: https://dev.epicgames.com/documentation/unreal-engine/static-mesh-editor-ui-in-unreal-engine
- Unity model import settings: https://docs.unity3d.com/ru/2018.4/Manual/FBXImporter-Model.html
- MDN Canvas toBlob: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- MDN Web Crypto digest: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest

### Books / production pipeline references
- *3D Game Development with Blender 5 and Unity 6* (Packt, 2026): asset exchange, transforms, Asset Browser and automated export.
- *Beginning 3D Game Assets Development Pipeline* (Apress/O'Reilly, 2021): production pipeline, UVs, texturing, rigging and engine integration.
- *Game Development with Blender and Godot* (Packt): low-poly assets, materials, shaders, animation and export.

### Video references used for UI/pipeline comparison
- Unreal Engine 5 interface walkthrough: https://www.youtube.com/watch?v=ueAP8xVWFJI
- Blender game-asset workflow, UV, baking and Unreal export: https://www.youtube.com/watch?v=NamnBJ4KVeU
- Unreal Static Mesh collision editing: https://www.youtube.com/watch?v=H0lrfhYrDAM

## Acceptance philosophy

"Pass" means measured evidence exists for the requested behavior. Source-preserving exports require byte comparison; cooked 3D exports require successful container validation plus re-import; visual UI changes require screenshot/pixel/layout evidence. A feature is not considered proven merely because its code path exists.
