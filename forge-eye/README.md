# Forge Eye — Rust-first web editor

Forge Eye is the next editor architecture, developed alongside the current Forge Next preview. It is not a claim that a complete Unreal Engine 5 / Blender replacement exists yet. The intent is to move reusable, correctness-sensitive editor logic into a deterministic Rust core and expose the same API to browser and native targets.

## Current milestone

- `forge-eye-core`: native Rust geometry library; deterministic validation, ear-clipping triangulation, silhouette extrusion, two-/three-view voxel visual hull, mesh diagnostics.
- `forge-eye-wasm`: `wasm-bindgen` JSON bridge, meant to compile to `wasm32-unknown-unknown` for the web frontend.
- Unit tests cover malformed contours, self-intersections, non-finite inputs, dimensions, voxel reconstruction, triangle generation and JSON serialization.
- The already tested Forge Next UI remains a separate safe preview while the Rust core is built and verified.

## Build locally

Install stable Rust and the WebAssembly target:

```sh
rustup toolchain install stable
rustup target add wasm32-unknown-unknown
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p forge-eye-wasm --target wasm32-unknown-unknown --release
```

The WebAssembly bridge emits JSON mesh buffers. A renderer adapter then validates those buffers and uploads vertices, normals and indices to the editor's GPU mesh. The runtime should feature-detect WebGPU and fall back to WebGL2 where necessary; Rust does not remove browser/device compatibility constraints.

## Target architecture

- Rust: project schema, command/undo system, scene graph contracts, mesh processing, reference calibration, contour validation, reconstruction, animation curves, import/export validation and deterministic tests.
- Web UI: accessible workspace panels, touch/keyboard routing, file selection, canvas/DOM integration and inspector form controls.
- GPU: renderer adapter with capability checks and resource recovery; never assume WebGPU is present on every phone.
- AI tasks: isolated adapters for image/schematic segmentation and optional image-to-3D services. The editor must still work without a remote AI service; inference must report provenance and confidence.
- Desktop: host wrapper can reuse the core and UI, with native file-system/import/export adapters. Do not fork project semantics between web and desktop.

## Reconstruction limits

A single raster drawing does not uniquely define a three-dimensional object. Multiple calibrated orthographic views and known dimensions constrain a visual hull, but hidden concavities, cavities, materials and assembly details remain ambiguous. Forge Eye should call this a **blockout** until geometry QA and user confirmation pass.

## Migrations are gate-based

The new branch does not silently replace `/forge/`. Before replacing the current editor, all legacy workflows must be mapped, migrated and tested; comparison screenshots and project compatibility checks must be attached to the pull request.
