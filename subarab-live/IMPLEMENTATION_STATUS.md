# Implementation status

Current status: initial source scaffold committed; no successful Android build or device test has been confirmed yet.

## Included
- Android WebView browser and navigation controls.
- JavaScript bridge that inspects HTML5 video text tracks exposed in the current page.
- Arabic subtitle translation through a LibreTranslate-compatible HTTPS endpoint.
- In-page translated subtitle display.
- Optional draggable Android overlay, after the user grants the system overlay permission.
- User-editable translation endpoint.
- GitHub Actions debug APK build workflow at the repository root.

## Known limitations
- Does not read cross-origin iframe internals, protected/DRM streams, canvas subtitles, or native apps.
- Subtitle text is sent to the selected translation endpoint.
- Public translation endpoints can fail, throttle requests, or change policy.
- No APK build or device test is claimed until a workflow run and test evidence exist.
