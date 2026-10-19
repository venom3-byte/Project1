# Asset provenance and licenses

## Tank hull and barrel sprites

- Original asset pack: Kenney, **Top-down Tanks Redux**
- Official asset page: https://kenney.nl/assets/topdown-tanks-redux
- Secondary source page documenting the same pack and its CC0 grant: https://opengameart.org/content/top-down-tanks-redux
- License: Creative Commons Zero 1.0 Universal (CC0); the author dedicates the pack to the public domain to the extent permitted by law. Attribution is not required, but is included here for provenance.
- Pack mirror/reference files consulted: https://github.com/StenBone/KennyTopDownTanksReduxTankGame/tree/main/Assets/kenney_topdowntanksredux/PNG/Retina
- Embedded source filenames: tankBody_green.png, tankGreen_barrel1.png, tankBody_red.png, tankRed_barrel1.png, tankBody_blue.png, tankBlue_barrel1.png, tankBody_dark.png, tankDark_barrel1.png.

## Explosion animation frames

The short impact animation uses `explosion2.png`, `explosion3.png`, and `explosion4.png` from the same Kenney Top-down Tanks Redux pack and license. They are embedded in the HTML and selected by elapsed effect time; artillery shells are rendered along an arcing trajectory before triggering impact particles and smoke.

The selected PNG sprites are embedded as base64 data in index.html to avoid runtime image downloads and preserve the offline-first single-page structure. The sprites are used as generic top-down vehicle visuals and are not representations extracted from WARNO.

## Game code, map, and remaining visuals

The game logic, map layout, procedural terrain, UI, combat presentation, and other drawing in this folder are original implementation work for IRON VEIL. The project uses public WARNO modding/reference documentation only as high-level inspiration for broad RTS mechanics; it does not bundle WARNO executables, source code, NDF game data, models, textures, audio, or animation files.

Review the pack's current license and terms before redistributing modified asset files outside this project.
