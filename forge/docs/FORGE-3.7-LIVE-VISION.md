# Forge Studio 3.7 — Live Vision & Real Input Research

Reviewed: 2026-09-30

## Decision

Forge Vision now uses two complementary transport modes.

1. Direct MediaStream mode for the browser running Forge. The browser captures the selected display surface as a continuous MediaStream, so the operator sees live motion instead of requesting screenshots.
2. Pro Chromium CDP mode for deterministic development and QA. Chromium exposes a continuous Page screencast stream through Chrome DevTools Protocol, while the same CDP session exposes mouse, keyboard and touch input primitives.

References:
- MDN Screen Capture API: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API
- MDN getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- Chrome DevTools Protocol Page: https://chromedevtools.github.io/devtools-protocol/tot/Page/
- Chrome DevTools Protocol Input: https://chromedevtools.github.io/devtools-protocol/tot/Input/
- Playwright CDP session: https://playwright.dev/docs/api/class-cdpsession
- Playwright mouse: https://playwright.dev/docs/api/class-mouse
- Playwright keyboard: https://playwright.dev/docs/api/class-keyboard

## Why this changes the previous design

The old bridge sampled the local display on every animation frame and sent JPEG data over WebSocket. That was a screenshot-like transport and had only a minimal pointer-up action.

The new bridge separates:
- vision transport: live MediaStream or CDP screencast;
- input transport: mouse move/down/up, drag, wheel, key down/up/press, text insertion and touch start/move/end;
- structured Forge control: deterministic engine commands remain available for state-level operations;
- verification: the acceptance test consumes multiple live screencast frames and then drives the real page through the CDP Input domain.

## Coordinate contract

The source stream is mapped from its reported source dimensions to the browser CSS viewport dimensions. The controller stores viewport width and height, device pixel ratio, target URL/id, frame count and observed FPS.

Actions accept screenWidth and screenHeight when a vision model reports coordinates in a resized frame. The controller converts those coordinates before dispatching input.

## Supported real input

The Pro CDP bridge supports:
- mouse move;
- mouse down/up;
- single and double click;
- multi-step drag;
- wheel scroll;
- key down/up and press;
- text insertion;
- touch start/move/end with CDP touch emulation;
- page navigation for controlled research/video sessions.

Browser-native input is separate from ForgeAgent: vision may drive the rendered UI first, while structured commands remain the deterministic route for engine state changes.

## Acceptance standard

The Live Vision test must prove all of the following in one real Chromium session:
- a continuous screencast produces multiple frames without requesting screenshots;
- a received frame has real encoded image data;
- a CDP click changes the Forge scene;
- a CDP key press changes the gizmo mode;
- CDP text insertion reaches an input;
- a mouse drag changes a real range control;
- CDP touch input is observed as touch pointer input;
- the live status reports chromium-cdp-screencast and chromium-cdp-input.

A UI panel existing without these checks is not considered a successful vision implementation.

## Security boundary

CDP access is intentionally explicit and local-development oriented. Browser-control services should remain bound to trusted development environments because remote debugging grants broad browser control.

## Next pipeline gates

After the Live Vision gate is green, the next Forge work should use the same vision loop to verify:
- 2D raster import, crop, trim, sprite-sheet preparation and export;
- 3D GLB/glTF import, hierarchy, materials, textures, animation, skins and source provenance;
- audio ingestion and runtime playback/metadata;
- VFX and shader asset ingestion;
- derived export, re-import and validation;
- Android and Windows/PC packaging paths;
- application-style UI construction and visual regression.

Vision is an additional observation and control layer; it does not replace deterministic QA.
