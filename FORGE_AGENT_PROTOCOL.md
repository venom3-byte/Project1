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
