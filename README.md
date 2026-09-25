# Asset Forge Studio

Professional raster-first game-asset editor and preparation pipeline.

## Core workflow

- Raster PNG/JPEG/WebP/AVIF import, drag/drop, and remote URL import.
- Real crop and transparent-pixel trimming.
- Non-destructive image adjustments: brightness, contrast, saturation, blur.
- Real layer stack with visibility, selection, duplicate, delete, and Z-order controls.
- Layer naming plus game-asset pivot metadata.
- High-quality browser background removal with BiRefNet Lite 512 through Transformers.js.
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

The production path uses studioludens/birefnet-lite-512, an MIT-licensed browser-ready BiRefNet Lite ONNX model. Its model card documents a 512×512 browser export, an FP16 model around 94 MB, and WebGPU/WASM execution through Transformers.js. The model card also documents pixel-level validation of the browser export against its reference implementation. citeturn690505search1turn995272search6

The editor probes the browser GPU. It uses WebGPU+FP16 when the adapter exposes the required shader-f16 feature, otherwise it falls back to WebGPU+FP32 or WASM+FP32 rather than failing on a GPU that lacks FP16. This follows the documented WebGPU capability split in Transformers.js. citeturn690505search3

The AI result is converted into an alpha matte and applied to the original raster pixels, avoiding a color-reconstruction step. The manual mask editor can refine the result afterwards.

## Mobile interaction model

The mobile UI uses a bottom action dock and scrollable bottom sheets rather than a scaled desktop sidebar. The editor reserves one-finger touch for normal selection/manipulation and uses two fingers for pan/zoom. This follows standard mobile interaction expectations for tap, drag, swipe, and pinch/zoom, while keeping important actions available through buttons rather than custom gestures alone. citeturn690505search0turn579687search4

## QA

The repository contains Playwright browser tests covering boot/runtime errors, real raster import, crop, trim, filters, undo/redo, export, mobile scrolling, duplicate/layer stack behavior, real car photo processing, AI cutout execution, original-RGB preservation audit, real sprite extraction/packing, manifest generation, and the final raster QA preview.

The AI tests use a real raster car image downloaded during the test run. The repository CI runs the browser suite before deployment.

## Commercial note

The current segmentation model is MIT-licensed. Keep third-party license notices with distributed software and re-check dependency/model licenses before each release.