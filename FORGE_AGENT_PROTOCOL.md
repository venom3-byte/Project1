# Forge Agent Protocol v2

Forge exposes a structured control plane over WebSocket /live and HTTP POST /api/forge/command.

## Design rule

Agents should control engine state through stable identifiers and structured operations first. Live Vision is for rendered-interface understanding and screen-level actions only.

## Core commands

- diagnostics
- entities
- select
- create / transform / physics
- duplicate / delete / focus / frame
- play / stop / key
- pcg / stream / terrain-generate
- graph-run
- project / save / save-slot / load-slot
- prefab-save / prefab-spawn
- asset-registry
- qa / qa-baseline / qa-diff / screenshot
- template-third-person / template-racing / template-showcase
- gameplay-status
- tag-add / attribute / inventory-grant
- ability-define / ability-use
- quest-define / quest-progress
- animation-state
- shader-apply
- net-connect / net-status / net-bind / net-publish
- replay-record / replay-stop / replay-play / replay-stop-play / replay-status
- runtime
- build

## Agent loop

1. Inspect the current project and runtime diagnostics.
2. Make a structured plan.
3. Execute deterministic operations in small batches.
4. Re-inspect scene/entity state.
5. Run physics/gameplay/asset QA.
6. Run in-engine visual QA and capture a baseline/diff when appropriate.
7. Save the complete Forge project graph.
8. Build only after the relevant gates pass.

## Vision bridge

The Live Vision bridge may send natural-language tasks to the structured control plane. The control plane should convert such requests into deterministic engine operations rather than relying on coordinate macros.

## Safety and determinism

Agent commands should be idempotent where practical, preserve entity IDs, avoid deleting unrelated project state, and report errors explicitly. Build outputs are generated from the same project graph used by the editor.

## Future expansion

The protocol is reserved for deep systems such as skeletal retargeting, material graph authoring, VFX graphs, navigation meshes, HLOD/streaming, audio graphs, authoritative multiplayer/prediction, native packaging, profiling captures and automated regression repair.
## Vision-First Commands

- vision-map: returns the current rendered entities projected into screen space with IDs, bounds, depth, world position and component metadata.
- vision-capture: captures the current viewport as PNG and can annotate projected entity boxes.
- vision-report: combines visual QA metrics with the screen-space scene map and flags blank/mostly-black/low-contrast states.
- vision-pick / vision-select / vision-focus: deterministic screen-coordinate grounding from rendered pixels to real Forge entities.
- vision-overlay: toggles live projected entity labels/boxes for visual debugging.
- vision-latest: exposes the latest external live-vision frame received by Forge Agent.
- vision-config: configure the provider-neutral external vision analyzer endpoint.
- vision-analyze: send the current real rendered PNG plus Forge scene-map/QA context to the configured analyzer.
- vision-result: return the last external vision response/error.
- The server proxy uses FORGE_VISION_ENDPOINT and optional FORGE_VISION_TOKEN so browser/game code never receives the secret token.

These commands use PlayCanvas worldToScreen and screenToWorld mappings so the agent can reason in the same screen coordinates used by the renderer and UI.
- batch: execute up to 32 deterministic commands and return a fresh visual report.
- vision-loop: execute up to 24 commands with a visual report after every step and stop automatically on blank/black/overcrowded visual states.
- pose-db-create / pose-db-add / pose-query / motion-match / pose-status: Motion Matching-style pose database and nearest-pose selection.
