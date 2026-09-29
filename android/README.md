# Forge Android Runtime

This module packages a Forge game as a real Android application.

## Architecture

Forge's game runtime is bundled into a single browser runtime with local PlayCanvas and Rapier dependencies. The Android shell uses Android WebView plus `WebViewAssetLoader` so the game loads from app assets through an HTTPS-like origin instead of `file://`.

The exporter reads a `forge-project.json` and optional real asset directory, produces `app/src/main/assets/forge/game.js`, `project.forge.json`, and a launcher HTML file, then Gradle produces an installable debug APK.

## Local build

From repository root:

```bash
npm install
node scripts/export-android.mjs android/demo-project.forge.json
gradle -p android assembleDebug
```

The installable APK is:

`android/app/build/outputs/apk/debug/app-debug.apk`

For a store/release build, configure a release signing key in Gradle/CI and build `bundleRelease`.

## Runtime guarantees

- offline local game runtime after packaging
- WebGL/WebGPU-capable WebView backend as provided by the device
- hardware-accelerated WebView
- landscape fullscreen
- DOM storage/local save support
- optional online game networking through INTERNET permission
- native haptic bridge through `window.ForgeAndroid.vibrate(ms)`
- automatic recovery if the WebView render process is killed

Android recommends WebViewAssetLoader for packaged web content and discourages file:// loading for this use case.
