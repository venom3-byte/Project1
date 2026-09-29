# Forge Stabilization Notes

This branch currently gates desktop proof on boot regression, syntax validation, deterministic smoke coverage, and a dedicated mobile editor smoke.

Recent stabilization areas:
- Rapier collision-event registration and entity-handle mapping.
- GLB animation attachment during direct asset import.
- Rapier vehicle axis property API.
- Rapier heightfield column-major terrain data.
- ESM dependency wiring for gameplay session tags.
- Mobile play controls separated from editor UI.
- Production toolbar moved away from timeline and viewport QA controls.

The Android pipeline exports a bundled local runtime and verifies its generated package before Gradle builds.

Current QA target: zero desktop smoke failures plus a real Pixel 7-class mobile smoke pass before the branch is considered stable.
