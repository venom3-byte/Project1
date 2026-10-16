# F-16C Block 50 — Forge reference-build v0.2

## Purpose and state

This is a new mesh built from parametric surfaces and polygon panels, not a downloaded aircraft model. It is intended as a first importable Forge asset whose exterior silhouette follows multi-view reference proportions. The OBJ groups retain logical names for the fuselage, wings, stabilators, fin, canopy, cockpit components, inlet, nozzle, landing gear, and stores.

## Dimension anchors

- Overall target length: **14.8 m** (mesh bounds are approximately 14.75 m, within reference rounding).
- Wingtip-to-wingtip span: **9.8 m**.
- Overall height target: **4.8 m**; the vertical fin is scaled to bring the mesh bounds into agreement with this published general dimension.
- The primary fuselage loft spans roughly x = -7.34 to +7.20 m; the tip of the pitot probe marks the 14.8 m forward extent when measured to the nozzle end.
- Coordinate convention: X = nose-to-tail, Y = vertical, Z = port/starboard.

The public USAF F-16 fact sheet gives 14.8 m length and 9.8 m wingspan. The geometry is dimension-anchored but is not official CAD and is not claimed to be a manufacturing-grade or flight-certification model.

## What is modeled in this pass

- Multi-station elliptical fuselage with tapered radome and dorsal fairing.
- Swept cropped-delta main wings with separate upper/lower skins and visible control-surface panels.
- Twin horizontal stabilators and single swept vertical tail.
- Large-mouth intake and a layered F110-style exhaust/nozzle approximation for the Block 50 configuration.
- Bubble canopy with transparent material, cockpit tub, seat/headrest, HUD glass, central/side instrument consoles, multiple displays, individual switches and control stick.
- Nose and main landing gear, tyres/hubs, doors, centerline tank, underwing pylons/stores, antennae, sensors, panel breaks and nav lamps.

## References used to establish proportions and layout

1. USAF fact sheet, F-16 dimensions and general configuration: https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104505/f-16-fighting-falcon/
2. Multi-view F-16C Block 50/52 blueprint scan (used as a proportion reference; labels identify it as Block 52): https://drawingdatabase.com/lockheed-martin-f-16c-block-50/
3. F-16C Block 50/52 cockpit arrangement schematic: https://learning.falcon-lounge.com/course/view.php?id=3
4. Block 50 exterior photo reference: https://files.digitalcombatsimulator.com/upload/userfiles/1a5/5mboamc0yuym617oaf2ihb1g3o499rbd/Screen_240227_205652.jpg

## Known limitations / next visual-QA loop

- This is a hand-built polygonal interpretation informed by orthographic drawings and cockpit references, not a pixel-perfect traced retopology. Photographs and line drawings have not yet been overlaid in a calibrated multi-view fitting pass.
- Fine rivets, maintenance stencils, accurate Block 50/GE F110 panel topology, exact wheel-bay internals and an aircraft-specific avionics label map still need photographic matching.
- Cockpit layout is arrangement-inspired and should be compared in front/top/side orthographic views against additional cockpit photographs before calling it a replica.
- OBJ has no UV texture maps; color and gloss come from the accompanying MTL. Transparency depends on OBJ/MTL loader and browser render settings.

## Import

Forge uses `shape: model`, `modelFormat: obj`, `modelData: <OBJ URL>`, and the companion filename mapped to the MTL URL in `assetFiles`. After updating the shared Agent Gateway project, open the editor and orbit around the aircraft to inspect the silhouette and the cockpit opening.
