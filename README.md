# Asset Forge Studio

Professional raster-first game-asset editor and preparation pipeline.

## Core workflow

- Raster PNG/JPEG/WebP/AVIF import, drag/drop, and remote URL import.
- Real crop and transparent-pixel trimming.
- Non-destructive image adjustments: brightness, contrast, saturation, blur.
- Real layer stack with visibility, selection, duplicate, delete, and Z-order controls.
- Layer naming plus game-asset pivot metadata.
- High-quality browser background removal with the MIT ISNet General INT8 ONNX model through Transformers.js.
- Background removal preserves the original RGB pixels and applies the AI result as an alpha matte.
- Manual mask refinement with erase/restore brush, brush size, and softness.
- Local persistent Asset Vault using IndexedDB.
- GitHub Asset Vault sync using the GitHub Contents API and a fine-grained token held in memory only.
- Sprite-sheet extraction into individual frames.
- Multi-frame sprite packing with rows, columns, cell size, gap, padding, and FPS.
- Automatic sprite manifest JSON export with frame geometry and timing.
- Individual game-asset manifest JSON export containing dimensions and pivot metadata.
- Project JSON save/open.
- Professional mobile workflow: bottom action dock, scrollable bottom sheets, one-finger selection, two-finger pan/zoom, and pinch zoom.
- Desktop workflow with side inspectors, canvas zoom, fit, keyboard shortcuts, and responsive panels.
- No SVG artwork or programmatic SVG asset generation.

## AI cutout engine

The production path uses `xrds/isnet-general-onnx-int8`. The model card identifies it as MIT-licensed, Transformers.js-compatible, WebGPU-capable, and a 42 MB weight-only INT8 QDQ model. The model card documents that only convolution weights are quantized while activations remain fp32, with output quality intended to match the fp32 base model. citeturn517553search1turn517553search11

The editor selects WebGPU when available and falls back to WASM, while preserving the original raster RGB and replacing only the alpha channel with the segmentation mask. The manual mask editor can refine the result afterwards.

The mobile interaction model was cross-checked against browser editor workflows and current tutorial material: compact persistent actions, layer-oriented editing, and a separate mobile tool surface are used instead of squeezing a desktop sidebar onto a phone. Photopea's mobile tutorial demonstrates adjustment editing on a mobile browser, while Canva's video editor tutorial shows a layer/overlay-oriented editing workflow; the asset pipeline also follows the usual sprite-sheet/texture-atlas workflow used in game development. citeturn183734youtube29turn981227search22turn183734youtube28

## Mobile interaction model

The mobile UI uses a bottom action dock and scrollable bottom sheets rather than a scaled desktop sidebar. The editor reserves one-finger touch for normal selection/manipulation and uses two fingers for pan/zoom. This follows standard mobile interaction expectations for tap, drag, swipe, and pinch/zoom, while keeping important actions available through buttons rather than custom gestures alone. citeturn690505search0turn579687search4

## QA

The repository contains Playwright browser tests covering boot/runtime errors, real raster import, crop, trim, filters, undo/redo, export, mobile scrolling, duplicate/layer stack behavior, real car photo processing, AI cutout execution, original-RGB preservation audit, real sprite extraction/packing, manifest generation, and the final raster QA preview.

The AI tests use a real raster car image downloaded during the test run. The repository CI runs the browser suite before deployment.

## Commercial note

The current segmentation model is MIT-licensed. Keep third-party license notices with distributed software and re-check dependency/model licenses before each release.