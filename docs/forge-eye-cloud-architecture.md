# Forge Eye — Cloud-First Build Plan

## Non-negotiable constraint
The Android phone is a thin client only. Do not require Termux, local model downloads, local builds, or background compute on the phone. Keep inference, project builds, asset processing, and agent orchestration on remote infrastructure whenever available. The browser still uses some CPU/GPU to render the UI and WebGL viewport, so use adaptive quality and pause rendering when hidden.

## Product goal
A mobile-first Arabic/RTL workspace that combines:
1. An AI conversation workspace specialized in 3D modeling and game development.
2. A real interactive Three.js editor, not a rendered screenshot or fake viewport.
3. A cloud agent layer that can inspect state, plan actions, execute supported tools, and report evidence.
4. A provider integration layer for DeepSeek-compatible chat APIs and Higgsfield, with truthful connection status.

## Delivery phases

### Phase 1 — usable browser workspace
- Responsive Arabic/RTL chat UI, conversation list, new conversation, streaming/loading/error states.
- Server-side provider requests only; API keys must never be placed in browser code or committed to Git.
- Clearly labelled demo mode until a valid provider key is configured and a real request succeeds.
- Real Three.js scene with orbit/pan/zoom, selection, transform controls, hierarchy, grid and axes.
- Add/remove primitive objects, material presets (metal, plastic, transparent glass), undo/redo, and save/load a scene.
- Mobile-friendly rendering defaults; pause or reduce rendering when the tab is hidden.

### Phase 2 — reliable agent execution
- Tool registry with explicit capability and connection checks.
- Execution log: planned action, actual tool call, result, and evidence.
- Never report success unless the operation returns success and the resulting scene/state can be inspected.
- Provider-independent interface so DeepSeek or another compatible service can be configured without exposing secrets.

### Phase 3 — Higgsfield integration
- Implement only the documented/available Higgsfield interface.
- Show disconnected/configuration-required until an actual authenticated health check passes.
- Separate image/video generation capabilities from 3D project/scene control; do not imply that one proves the other.
- Keep credentials in server-side secret storage.

### Phase 4 — quality and release
- Automated build and tests in cloud CI.
- Test chat empty/error/loading states and editor add/select/move/material/save/load flows.
- Check mobile layout and reduced rendering mode.
- Publish only after the preview/build is available and basic checks pass.

## Cost and safety rules
- Prefer free tiers and static hosting for the client, but do not claim unlimited free compute or model inference.
- Do not activate paid resources or billing without explicit approval.
- Keep the existing `main` branch untouched; develop in `forge-eye-cloud-first`.
- Never commit API keys, access tokens, private project assets, or generated secrets.
- Report what is implemented, what was tested, and what remains blocked; no placeholder claims.

## Acceptance criteria for Phase 1
- A phone can open the workspace without installing developer tools.
- The scene is genuinely interactive: users can add, select, and transform an object.
- Materials visibly change the rendered object, including glass transparency.
- No API key is returned to the browser.
- Missing credentials produce an honest setup message, not simulated AI output.
- The app remains usable on a phone with reduced viewport quality.


## Implemented on this branch — 2026-10-21

The active Forge static editor at `public/forge/index.html` loads `public/forge/forge-engine.js`. A mobile resource-safety change was committed to `forge-eye-cloud-first`:

- Mobile/touch devices request the browser's low-power graphics preference and disable antialiasing.
- The engine caps mobile device pixel ratio at 1 and desktop at 1.5.
- Dynamic directional-light shadows are disabled on mobile.
- Rendering and the editor's custom update work are paused while the document is hidden; rendering is re-enabled when the user returns.
- A GitHub Actions workflow installs the locked dependencies, builds the full web app, runs the existing unit tests, parses the Forge engine JavaScript, and checks that the mobile safeguards remain present.

Verification history: the earlier mobile-safeguard checks passed, and the full production/browser checks have now completed successfully on commit `1fa4c73b11ed00c62b470a6b09d1a3fdbb333379`.

## Verified end-to-end checks — 2026-10-21

- GitHub Actions `Forge Eye cloud-first checks`: success. Dependency install, all **41 unit tests** (5 test files), and production build passed.
- GitHub Actions `Forge Eye cloud-first safety checks`: success. It built the app, started the actual production Nitro server, and ran Chromium desktop/mobile checks against both the Forge editor and AI Studio.
- Main Forge editor: desktop/mobile browser smoke passed, including the narrow-screen toolbar regression check.
- AI Studio: Chromium verified Arabic RTL, a live Three.js scene, adding a primitive, switching to the glass material, selecting transform mode, saving/loading scene JSON in browser storage, successful status route, persisted chat, mobile tabs with no horizontal overflow, capped mobile canvas pixel ratio, and no uncaught JavaScript/console errors.
- The API behavior is intentionally honest: with no provider secret configured in CI, the status endpoint reports setup required and DeepSeek chat returns `503 AI_NOT_CONFIGURED`; no fake answer is generated.
- Higgsfield remains `not-connected`. No authenticated Higgsfield operation has been demonstrated, so the app does not claim external control.
- The GitHub branch is verified, but **a publicly hosted, user-ready web deployment is not yet verified**. Real AI replies require `DEEPSEEK_API_KEY` or `GEMINI_API_KEY` to be added as a server secret by the eventual hosting provider. Do not put API keys in the browser or GitHub files.
- CI uses cloud runners; no build, model weights, or AI inference was run on the user's phone. Browser rendering still uses some phone resources. A real-device temperature/FPS test has not been performed.

