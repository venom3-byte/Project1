# Forge Eye AI Studio

The standalone workspace is served at `/forge/ai-studio.html`; a link is added to the existing Forge toolbar.

## Configure Gemini 3.8 Flash (preferred)
Set `GEMINI_API_KEY` in the server deployment's environment/secret settings. The model is `gemini-3.8-flash`; the server calls Google's official `generateContent` REST endpoint. Never put API keys in HTML, browser JS, client-side environment variables, or Git commits. Redeploy/restart after adding secrets.

- `GET /api/forge-eye/status` reports whether Gemini and DeepSeek keys are configured; it never returns the secrets.
- `POST /api/forge-eye/gemini` sends bounded conversation history to Gemini from the server.
- The AI Studio provider selector switches between Gemini 3.8 Flash and DeepSeek. Gemini is selected by default.
- Without a Gemini key, that endpoint returns HTTP 503 with `AI_NOT_CONFIGURED`; it does not fake a model reply.
- Google API quota/rate-limit responses are reported as a provider error. Check current API quota and pricing before use; do not assume unlimited free usage.

## Configure DeepSeek (optional alternative)
Set `DEEPSEEK_API_KEY` in server secrets. Optionally set `DEEPSEEK_MODEL`; the default is `deepseek-chat`. `POST /api/forge-eye/chat` sends bounded conversation history to DeepSeek from the server.

## 3D viewport
Uses Three.js official modules via jsDelivr. Provides live geometry, selection, orbit/pan/zoom, transform gizmo, material presets, hierarchy, local save and JSON import/export. CDN access is required. Rendering is limited to about 30 fps, uses low power mode, reduces pixel ratio on phones, and pauses while the tab is hidden. Rendering the 3D viewport still uses some phone GPU/CPU; model inference runs on the provider's servers.

## Higgsfield honesty
The UI reports Higgsfield as not connected until an authenticated, documented integration is implemented and verified. A website URL is not proof of editor control.

## Verification notes
Source checks and CI can validate syntax and UI wiring, but do not prove a live Gemini connection. This change does not configure deployment secrets or publish a runtime. After deployment, add `GEMINI_API_KEY` in the hosting provider's secret settings, then verify that status reports Gemini configured and a real chat message returns a non-empty provider response. Never share the key in chat or commit it to the repository.
