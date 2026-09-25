# Asset Forge Studio

Raster-first game asset editor and asset pipeline.

Implemented in this build:
- Raster PNG/JPEG/WebP/AVIF import and drag/drop.
- Real crop applied to the selected source image.
- Real transparent-pixel trimming.
- AI background removal through the browser.
- Non-destructive visual filters with reset.
- Transform, opacity, duplication, text and shape layers.
- Undo/redo and project JSON save/open.
- Local Asset Vault with persistent IndexedDB storage.
- Raster frame extraction from a selected sprite sheet.
- Raster sprite-sheet export.
- GitHub Contents API vault synchronization using a fine-grained token held in memory only.
- Responsive mobile layout with side drawers.
- No SVG artwork or programmatic SVG drawing.

The editor intentionally keeps artwork raster-based. Fabric.js is used for the interactive canvas model; it is MIT licensed. citeturn961956search1

Background-removal licensing is deliberately not hidden: the current browser provider is included as a functional integration for testing, but its model/package licensing must be cleared before commercial distribution. BRIA's RMBG 1.4 is non-commercial by default, and rembg itself is MIT while model licenses can differ. citeturn811845search1turn827818search0

ONNX Runtime Web supports browser WASM and WebGPU execution paths for local inference, which is the intended direction for a production-cleared segmentation backend. citeturn654473search0turn654473search4
