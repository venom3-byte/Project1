# Game Editor

A browser-based 3D game editor (three.js) that exports playable games for the web and for Android.

## Structure

- `src/editor/` – the editor UI: viewport, hierarchy, inspector, store (undo/redo, autosave), export dialog.
- `src/runtime/scene.ts` – builds three.js nodes from scene objects (shared by editor and player).
- `src/runtime/sim.ts` – game logic: movement, gravity, collisions, behaviors, win/lose. No renderer needed, unit-tested.
- `src/runtime/player.ts` – the standalone player (touch joystick + jump button on phones).
- `public/player/player.js` – the player bundled into one file. **Rebuild it after changing anything in `src/runtime/`:**

  ```
  npm run build:player
  ```

## Android APK export

The Export dialog downloads an Android project (Capacitor 8). Upload it to a GitHub repository and the included
workflow (`.github/workflows/build-apk.yml`) builds `app-debug.apk` in the cloud:
Node 22, JDK 21, Android SDK 36. The APK is debug-signed (installable for testing and sharing). Publishing to
Google Play requires a release-signed Android App Bundle with your own keystore.

## Tests

```
npx vitest run
```
