# Forge Studio 3.6 — Technical Research & QA Charter
Reviewed: 2026-09-29

## Purpose

This document turns external editor/pipeline research into measurable Forge acceptance gates. Forge is treated as a game-asset/editor tool, so a feature is considered proven only when its behavior, visual layout, and asset round-trip have evidence.

## Editor information architecture

Professional references consistently separate the editor into a persistent hierarchy/content region, central viewport, and context-sensitive inspector/details region.

- PlayCanvas: toolbar, hierarchy, viewport, inspector, assets. The hierarchy is searchable and supports re-parenting while preserving world transforms in the normal case. https://developer.playcanvas.com/user-manual/editor/interface/ https://developer.playcanvas.com/user-manual/editor/interface/hierarchy/
- Unreal Engine 5.8: main toolbar, viewport toolbar, level viewport, outliner, details panel, content drawer, bottom diagnostics. https://dev.epicgames.com/documentation/unreal-engine/unreal-editor-interface
- Unreal Static Mesh Editor: viewport plus bounds, collision, UV visualization, LOD and mesh statistics. https://dev.epicgames.com/documentation/unreal-engine/static-mesh-editor-ui-in-unreal-engine

Forge QA therefore checks:
1. hierarchy + asset browser remain available;
2. viewport is the dominant workspace;
3. inspector is context sensitive;
4. mobile collapses panels without horizontal overflow;
5. touch controls stay reachable without scattered full-screen buttons.

## 3D asset pipeline contract

glTF 2.0 is used as the canonical runtime interchange format. Forge keeps a strict distinction between source-preserving exports and derived/cooked exports.

- glTF 2.0 specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- Khronos glTF Validator checks JSON schema, GLB v2 correctness, internal references, binary buffers and other conformance issues. https://github.khronos.org/glTF-Validator/ https://github.com/KhronosGroup/glTF-Validator
- PlayCanvas import pipeline supports model hierarchies and converts embedded materials/textures into editor assets. https://developer.playcanvas.com/user-manual/editor/assets/import-pipeline/import-hierarchy/
- Unity model import treats scale, geometry, UVs and normals as explicit import concerns. https://docs.unity3d.com/ru/2018.4/Manual/FBXImporter-Model.html

Forge acceptance gates:
- GLB magic/version/declared length;
- source-byte SHA-256 and exact source round-trip;
- vertices/triangles/UV/material/animation statistics;
- derived GLB validation;
- re-import of the derived GLB;
- spatial bounds before/after;
- provenance manifest.

## 2D game-asset pipeline

Aseprite's documented workflow provides the reference for sprite-sheet structure: horizontal/vertical/matrix sheets, padding, frame ranges, tags, slices and JSON metadata.

- Sprite sheets: https://www.aseprite.org/docs/sprite-sheet/
- Animation tags: https://www.aseprite.org/docs/tags/
- Slices and pivot metadata: https://aseprite.org/docs/slices/
- CLI export controls including trim and padding: https://www.aseprite.org/docs/cli/

Forge acceptance gates for 2D assets:
- preserve the original imported bytes;
- decode and report dimensions;
- generate a clearly labeled derived viewport PNG;
- retain provenance metadata;
- later sprite-sheet work must expose frame rectangles, padding and pivot rather than flattening them into an opaque image.

## Visual and mobile UX research

Adobe Express explicitly places layers in a dedicated panel and offers review/restore after background removal; Canva documents a simple upload → edit → download workflow. These references reinforce fast asset selection, reversible transformations and explicit export outcomes.

- Adobe Express layers: https://helpx.adobe.com/express/web/arrange-layers-and-pages/layers.html
- Adobe Express background removal: https://helpx.adobe.com/express/web/image-creation-and-editing/edit-images/remove-background.html
- Canva background remover: https://www.canva.com/features/background-remover/

The Forge visual suite therefore records full-page desktop/mobile evidence and checks overflow, panel dimensions, compact controls, and rendered-pixel health.

## Books used as pipeline references

- Nova Villanueva, Beginning 3D Game Assets Development Pipeline: the production loop runs through base mesh, cleanup, UVs, high-poly, texturing, rigging, animation and engine integration. https://www.oreilly.com/library/view/beginning-3d-game/9781484271964/
- Jason Gregory, Game Engine Architecture, 3rd edition: explicitly covers tools and the asset pipeline as a core engine subsystem. https://www.gameenginebook.com/toc.html
- Real-Time Rendering, 4th edition bibliography: broad reference set for production rendering and real-time graphics. https://www.realtimerendering.com/refs.html
- Game Development with Blender and Godot: game-ready low-poly assets, materials, animation and engine integration. https://www.packtpub.com/en-us/product/game-development-with-blender-and-godot-9781837635122

## Real-asset benchmark set

The CI suite now uses external developer/reference assets rather than only synthetic fixtures:

- Khronos Fox.glb: animated rig with Survey, Walk and Run cycles. https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Fox/README.md
- Khronos ToyCar.glb: real textured 3D game-asset style sample. https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb
- Wikimedia Example.png: real PNG decoding/export reference. https://upload.wikimedia.org/wikipedia/commons/7/70/Example.png

These are used only as automated test inputs; the repository does not claim ownership of external assets.

## Evidence standard

A pass requires measured evidence. Code presence alone is not sufficient.

- Functional: Playwright assertions and no page/console errors.
- Visual: screenshot plus pixel/layout checks.
- Asset: exact source bytes where preservation is required, plus derived export validation and re-import.
- Interaction: screen-space picking, gizmo modes, snapping, undo/redo.
- Performance: bounded startup time and CI completion.
- Regression: the evidence artifacts are uploaded from every CI run.

## Current 3.6 acceptance suite

The new `tests/professional.qa.spec.mjs` covers:
- deterministic startup and visual health;
- desktop panel geometry and overflow;
- mobile viewport/touch controls;
- screen-space object picking;
- gizmo/snap/undo/redo;
- real PNG source round-trip and derived preview;
- real animated Fox GLB import/export/re-import;
- real textured ToyCar GLB export/re-import;
- provenance manifest completeness.

Target: no silent asset corruption, no hidden layout overflow, and no regression accepted without evidence.
