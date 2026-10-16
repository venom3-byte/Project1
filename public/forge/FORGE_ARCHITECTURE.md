# Forge Studio — AAA Engine Direction

Forge is being designed as an agent-native game/application development environment, not merely an asset editor.

## Evidence-driven subsystem model

Current research shows that modern AAA authoring is a combination of renderer, asset management, world streaming, procedural generation, materials, animation/rigging, VFX, audio, data-oriented gameplay, profiling and automated testing. Unreal Engine 5.8 exposes these through Nanite, Lumen, Virtual Shadow Maps, PCG, World Partition, Control Rig, Niagara, MetaSounds, MassEntity, Asset Manager, Movie Render Graph and Automation. Forge uses those workflows as reference points, while choosing a browser-first implementation. Epic documents each subsystem separately because the quality of a production engine comes from the integration of those tools, not a single rendering feature. 

PlayCanvas is the current runtime foundation because its engine provides WebGL2/WebGPU, compute shaders, PBR, post effects, WebXR and a lightweight browser runtime; its Editor also provides hierarchical scenes, inspector-driven editing, asset management and code editing. 

## Current Forge kernel

### Production layers now included
- Fixed-step physics with Rapier EventQueue and collision event bus.
- Terrain mesh generation with heightfield collision.
- Gameplay framework: GameMode, GameState, PlayerState.
- Gameplay data: hierarchical Tags, Attributes, Effects, Abilities, Inventory, Quests, Data Registry.
- Behavior Trees with blackboards and deterministic traces.
- Character, AI, vehicle and projectile combat templates.
- 2D orthographic/sprite/flipbook and platformer workflow.
- PBR Material Lab plus custom Shader Lab.
- Procedural VFX service and spatial audio buses.
- Multiplayer room relay and input/state channel.
- Deterministic Replay record/playback.
- In-engine visual QA baseline/diff.
- Recursive prefabs and unified project graph.


- PlayCanvas 2.22.6 runtime with WebGPU/WebGL2.
- Rapier 0.21 physics backend.
- Entity/component scene model.
- Hierarchy, inspector, transforms, cameras, lights and primitives.
- Real GLB/raster/audio asset storage.
- Project JSON serialization.
- Keyframe timeline and entity scripts.
- Runtime services: input mapping, navigation grid, save slots, audio graph and prefabs.
- Agent control plane over WebSocket and HTTP.
- Live Vision UI integrated into the same Studio.
- Visual QA and Playwright desktop/mobile smoke tests.

## Asset production pipeline

Forge Asset Lab now provides:
- raster audit;
- transparent-bound analysis;
- AI background removal with ISNet;
- trim and atlas preparation;
- GLB JSON/mesh/material/texture/animation audit;
- skin/joint audit;
- PBR Material Lab;
- GLB Cook pipeline using glTF-Transform;
- lossless prune/dedup/resample;
- LOD generation via Meshopt simplification;
- collision strategy metadata;
- runtime build packaging.

The target is to evolve this into an import processor graph with deterministic source-to-runtime builds, cacheable artifacts, platform profiles, texture budgets, mesh budgets and automatic regression checks.

## World production

Forge World Builder provides deterministic PCG scattering plus world-cell metadata. The next layers are:
- spline and volume based procedural graphs;
- biome rules;
- hierarchical/runtime generation;
- cell streaming and HLOD;
- terrain/mesh terrain;
- vegetation;
- water;
- weather;
- large-world coordinates.

## Gameplay production

Forge Graph is the beginning of a visual gameplay graph. Runtime services already include:
- input actions;
- save slots;
- A* navigation grid;
- audio playback and spatial panning;
- prefab registry.

The target gameplay stack is:
- state/behavior graphs;
- state machines;
- navigation and behavior trees;
- ability system;
- inventory/quests/dialogue;
- character controller;
- vehicles;
- crowds/data-oriented entities;
- gameplay replication.

## Animation

Reference workflows include Unreal Control Rig and IK Retargeting. Forge's current data model already accepts animation tracks and GLB animation metadata. The next layers are:
- skeleton/retarget assets;
- IK chains;
- animation state machines;
- blend trees;
- procedural pose layers;
- ragdoll and secondary motion;
- motion matching;
- animation baking and compression.

## Rendering

The long-term rendering stack is:
- PBR materials;
- material/shader graph;
- clustered and dynamic lighting;
- high-resolution shadows;
- post effects;
- fog/atmospherics;
- GPU particles;
- decals;
- terrain/foliage;
- Gaussian splats;
- virtualized/streamed geometry strategies;
- WebGPU compute.

Forge does not claim to reproduce proprietary UE technology such as Nanite or Lumen in the browser. Instead, it adopts the workflow goals: high object counts, perceptual detail management, dynamic lighting, deterministic streaming and scalable quality profiles.

## VFX and audio

Niagara and MetaSounds are reference workflows for authoring procedural effects and DSP graphs. Forge's next implementation layers are:
- node-based VFX emitters;
- GPU particle simulation;
- procedural audio graph;
- buses/mixers;
- spatial audio and occlusion;
- adaptive music;
- cinematic render graphs.

## Scale and profiling

World Partition, Asset Manager, MassEntity and Unreal Insights demonstrate that AAA development also needs data-oriented runtime state, controlled asset loading, streaming, profiling and automated QA.

Forge therefore treats:
- entity composition;
- asset references;
- streaming cells;
- performance budgets;
- automation results;
- visual regression captures

as project data, not disposable editor state.

## Agent-native architecture

The Forge Agent Protocol is engine-state based. Agents can inspect and mutate the scene through stable identifiers rather than relying on screen clicks. Live Vision remains available when the rendered interface itself must be interpreted.

Preferred agent loop:
1. inspect;
2. plan;
3. execute deterministic operations;
4. re-inspect;
5. run runtime/visual QA;
6. collect proof;
7. save/build.

This architecture is specifically intended to let an AI operate Forge with the same precision as a human technical artist/programmer, while retaining deterministic project data and test gates.

## Final production target

Forge is explicitly optimized for an agent-operated workflow:
- stable engine-state commands instead of UI-only macros;
- deterministic project data;
- real asset cooking;
- gameplay/runtime templates;
- visual proof after changes;
- replayable regression scenarios;
- desktop/mobile QA;
- Web build packaging from the same project graph.

The remaining research roadmap is intentionally focused on deep production systems rather than superficial UI breadth: skeletal animation/retargeting, advanced shader graph and post-processing, terrain/foliage streaming/HLOD, GPU VFX, cinematic sequencing, native packaging, and deeper networking/prediction.

## Quality gates

A production subsystem is not complete merely because the UI exists. It should have:
- a deterministic project representation;
- a real runtime path;
- a real asset test where applicable;
- browser automation coverage;
- visual QA;
- mobile coverage;
- diagnostics;
- a fallback for unsupported WebGPU features;
- explicit performance budgets.

## Research baseline

The current design is informed by Unreal Engine 5.8 documentation and official release material, PlayCanvas Engine/Editor documentation and current glTF Transform/Meshopt package capabilities. These sources should be re-checked before each major subsystem implementation because all of these projects are actively changing.

## Current integrated benchmark

Forge now includes an integrated AAA Showcase benchmark that combines a player character, five AI enemies, physics cover, projectile combat, VFX, runtime HUD, gameplay Tags/Attributes/Inventory/Ability data, a quest, and GameSession state. This benchmark is used as an end-to-end target so new engine work is validated as a game system rather than as isolated editor widgets.

## Current verification gates

- Node syntax gate over all Forge runtime modules.
- Playwright desktop and mobile browser proof suite.
- Real animated Fox GLB import and animation playback check.
- Real GLB Cook/LOD pipeline check.
- Terrain/heightfield collision check.
- Collision EventQueue check.
- Gameplay/session/data-driven tests.
- Multiplayer WebSocket room connection check.
- Replay and prefab subtree tests.
- In-engine visual regression baseline/diff.
