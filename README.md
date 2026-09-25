# Asset Forge Studio

Raster-first browser asset editor and game-asset pipeline.

Current build: raster import, drag/drop, canvas resize, selection, transform properties, opacity, text, shape primitives, duplicate, undo/redo, raster filters, browser AI background removal, local Asset Vault using IndexedDB, project JSON save/open, PNG export and raster sprite-sheet export.

No SVG artwork is used or generated.

Research basis: Canva editing APIs, Photopea scripting/API, Fabric.js, PixiJS, browser OffscreenCanvas/Web Workers, WebGPU, and current browser background-removal implementations.

Commercial note: the current AI background-removal dependency is @imgly/background-removal and its package is AGPL-licensed. Replace it with a commercially compatible model/library before commercial distribution unless the distribution model complies with that license.
