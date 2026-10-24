# SubArab Live (Android)

Free-first Android subtitle translator prototype. This project is isolated under `subarab-live/` and does not change the existing Game Editor app.

## Current implementation scope
- Android WebView browser with URL bar and basic navigation.
- Detects HTML5 video text tracks and active subtitle cues when the site exposes them to the page.
- Sends cue text to a configurable LibreTranslate-compatible endpoint and shows Arabic translation in the page and optional Android overlay.
- Overlay requires the user to explicitly grant Android's `SYSTEM_ALERT_WINDOW` permission.
- No audio capture, no screen scraping, no paid API key by default.

## Important compatibility limits
This is not universal across all streaming sites. Cross-origin iframe players, DRM-protected players, canvas-rendered subtitles, native app players, and sites that block WebView may prevent subtitle discovery. Some public translation servers may be unavailable, rate-limit requests, or have their own privacy/availability terms. Do not send private content to an endpoint you do not trust.

## Build
Open this folder as an Android/Gradle project in Android Studio, or let the included GitHub Actions workflow build a debug APK. No APK has been claimed as built until the workflow succeeds.

## Configure translation
The first prototype uses the LibreTranslate-compatible endpoint shown in Settings. Users can change it to a trusted public instance or a self-hosted endpoint. Public endpoints are best-effort and are not guaranteed.
