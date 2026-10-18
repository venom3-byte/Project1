# Warfront RTS — Production Plan

## Product definition

A browser-first real-time strategy game inspired by the broad tactical readability of US Conflict, with an original setting, original interface, and a deeper air-operations loop. The first target is modern mobile Chrome and desktop browsers. The game must remain playable by touch and must not depend on a native engine install.

## Art direction and asset governance

- Choose a consistent modern military visual family: muted olive/earth ground forces, desaturated aircraft greys, dark asphalt, pale concrete, restrained emissive runway lights, readable team colours, and restrained tactical UI.
- Prefer self-contained GLB/glTF assets. Every imported model must have a recorded source URL, licence, dimensions, scale, and known animation clips/pivots.
- Asset candidates for the first vertical slice:
  - Tanks, Military Vehicles and Field Camp: https://3dassets.dev/packs/armoured-column-and-field-camp
  - Aircraft Fleet and Airfield: https://3dassets.dev/packs/aircraft-fleet-and-airfield
  - Three.js GLTF loading reference: https://threejs.org/manual/pages/loading-3d-models.html
- The above two 3DAssets.dev packs state CC0 1.0 terms on their published pages. Recheck terms and the precise licence for every additional asset before shipping. Do not mix assets solely because they are free; match palette, scale, pivots, materials and triangle budgets.
- Keep high-resolution hero assets separate from low-cost distant units. Use LODs, instancing for repeated props, texture limits, compressed downloads where supported, and asynchronous loading on mobile.

## Core game loop

1. Recon: inspect map, targets, anti-air coverage, runway status and unit roster.
2. Select: tap/click an individual unit or select a group.
3. Command: move, attack, defend, launch airstrike, or return to base.
4. Execute: units follow orders, animate their mechanisms, acquire targets and resolve attacks.
5. Assess: targets show health and damage state; mission state updates; events are written to an operations log.
6. Sustain: aircraft return, land, rearm and become available again; ground units require supply and repair.
7. Complete/replay: victory conditions, score, mission result and a deterministic restart.

## Milestone plan

### M0 — Playable vertical slice
- Full-screen Three.js scene, tactical oblique camera, zoom/pan and responsive HUD.
- Terrain, road/runway markings, hangar, tower, target buildings and unit selection.
- Load at least one external GLB asset through GLTFLoader; show a graceful status/fallback if a source is unavailable.
- Basic ground movement and a demonstrable airstrike state machine ending with return/landing.
- A mission log, health indicators, and reset/replay.
- Acceptance: page starts without a fatal runtime error, touch selection works, an aircraft can execute the entire sortie, and no success is reported without an observable state transition.

### M1 — Asset pipeline and vehicle animation
- Make canonical Blender collections: ROOT, HULL, TURRET_PIVOT, BARREL_PIVOT, LEFT_TRACK, RIGHT_TRACK, wheel pivots, aircraft control surfaces and landing-gear pivots.
- Standardise forward axis, origin, metre scale, naming, material slots and export presets.
- Tank animation: separate hull suspension, left/right track loops, wheel rotation, turret traverse, barrel elevation, muzzle flash and recoil.
- Aircraft animation: taxi wheel roll, gear and doors, flaps, ailerons, elevator, rudder, banking, pitch, engine exhaust and landing/taxi transitions.
- Where an asset has no animation clips, rig or add mechanism-specific animation in Blender or drive named pivots procedurally at runtime. Do not pretend a static mesh contains a rig.

### M2 — Air operations
- Aircraft roster, squadron capacity, maintenance, runway occupancy and rearm time.
- State graph: parked → taxi-out → line-up → takeoff → climb → ingress → attack-run → weapon-release → egress → return → approach → landing → taxi-in → rearm → ready.
- Route planning uses waypoints, altitude constraints, turn radius and bank. Avoid abrupt changes in position or orientation.
- Weapon simulation resolves a target point, release window, fall time, impact point and damage. The HUD shows expected accuracy, target health and anti-air threat. The model is a gameplay approximation, not a real-world targeting solution.
- Abort/recovery states: target destroyed, runway blocked, aircraft damaged, insufficient payload, or no safe landing slot.

### M3 — Ground warfare
- Tanks, IFVs/APCs, trucks, artillery, radar, SAM, infantry and static defence.
- Orders: move, attack-move, focus-fire, hold position, defend, retreat and repair.
- Collision, terrain slope, pathfinding, line of sight, range, cover, weapon cooldown, armour facings, suppression and morale.
- Damage states alter materials/parts and unit capability instead of only subtracting hit points.

### M4 — Strategy and campaign
- Resource economy, base construction, production queues, logistics, repair and research.
- Enemy behaviour: scouting, defending high-value targets, intercepting aircraft, reinforcing threatened sectors and rebuilding after a strike.
- Mission objectives, optional tasks, difficulty settings, campaign persistence and replayable seeds.

### M5 — Quality, performance and release
- Automated smoke tests plus repeatable scenarios: select/move, select/attack, launch/strike/return, runway obstruction, target destruction and restart.
- Capture screenshots and record console/network errors at every milestone.
- Mobile budgets: adaptive render scale, limited shadow casters, throttled effects, no giant starter-scene GLB on initial load, and low-memory fallbacks.
- Measure cold-load bytes, time-to-first-interaction, steady FPS, memory, asset failures and touch usability on real hardware.
- Verify public deployment URL separately from local/source correctness.

## Frame-by-frame reference method

For each accessible source video:
1. Record the URL, source date, aircraft/vehicle type and the timestamp range.
2. Sample key frames at state changes (not only arbitrary equal intervals): idle, acceleration, turn initiation, turn apex, weapon release, impact, recovery, approach, touchdown and braking.
3. Track reference landmarks relative to the horizon/runway/ground; note heading, pitch, roll, gear, flap/rotor/track motion, speed cues, dust and camera movement.
4. Convert observations into named states, curves and tolerances; compare prototype recordings side-by-side.
5. Do not claim a frame-by-frame review of a private Snaptube download unless that actual video file or an accessible link has been provided and inspected.

## Technical architecture

- Renderer: Three.js / WebGL2 with GLTFLoader and AnimationMixer.
- Input: unified pointer/touch/keyboard command layer; camera gestures must not trigger unit selection.
- World: separate terrain, facilities, units, effects, selection overlays and debug layers.
- Simulation: fixed-step command/state updates; visual interpolation in the render loop.
- Data: unit definitions, weapon definitions, aircraft state machine, target health, mission events and deterministic reset state kept separate from rendering.
- Test hooks: debug toggle, status panel, mission event log, reproducible seed and one-click reset.

## M0 acceptance checklist

- [ ] Page loads and reports its asset state.
- [ ] Camera pans and zooms on desktop and touch.
- [ ] Friendly units and enemy targets can be selected.
- [ ] Move/attack orders produce visible movement or weapon effects.
- [ ] Launching an airstrike changes state in the operations log.
- [ ] Aircraft leaves its parking position, attacks a selected target, returns to its base, and transitions through landing/taxi/rearm states.
- [ ] Target damage and mission completion are visible.
- [ ] Restart restores initial health, unit position and readiness.
- [ ] No claim of Blender output is made unless a Blender scene was actually generated and checked.
