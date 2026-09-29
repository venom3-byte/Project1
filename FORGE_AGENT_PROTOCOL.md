# Forge Agent Protocol v2

Forge exposes a structured control plane over WebSocket /live and HTTP POST /api/forge/command.

## Message

{
  "type": "forge-command",
  "id": "request-id",
  "command": {
    "op": "create",
    "kind": "box",
    "name": "Crate",
    "x": 2,
    "y": 1,
    "z": 0
  }
}

Responses use a matching forge-result message with ok and result fields.

## Stable command surface

- diagnostics
- entities
- select by id/name
- create primitive/camera/light
- transform
- physics
- duplicate/delete
- focus/frame
- play/stop/key
- pcg generation
- world streaming
- graph-run
- project/save
- asset-registry
- qa
- screenshot
- build

The protocol addresses engine state, not screen coordinates. Screen-coordinate actions remain available through Live Vision for tasks that genuinely depend on the rendered interface.

## Production principle

The agent should normally inspect, form a structured change plan, execute small deterministic operations, inspect again, run QA, capture visual proof, and save/build only after the gates pass.

This makes the agent an engine operator rather than a mouse macro.

## Future commands

- prefab operations
- material graphs
- animation and retargeting
- navigation and behavior trees
- audio graph
- VFX graph
- multiplayer simulation
- profiling captures
- platform builds
- asset cooking
- regression repair

Backward compatibility is preferred when extending the protocol.
