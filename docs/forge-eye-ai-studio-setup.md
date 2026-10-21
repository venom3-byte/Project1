# Forge Eye AI Studio

The standalone workspace is served at \`/forge/ai-studio.html\`; a link is added to the existing Forge toolbar.

## Configure DeepSeek
Set \`DEEPSEEK_API_KEY\` in the server deployment's environment/secret settings. Optionally set \`DEEPSEEK_MODEL\`; the default is \`deepseek-chat\`. Never put API keys in HTML, browser JS, client-side environment variables, or Git commits. Redeploy/restart after adding secrets.

- \`GET /api/forge-eye/status\` reports whether the server has a DeepSeek key.
- \`POST /api/forge-eye/chat\` sends bounded conversation history to DeepSeek from the server.
- Without a key, chat returns HTTP 503 with \`AI_NOT_CONFIGURED\`, not a fake model reply.

## 3D viewport
Uses Three.js official modules via jsDelivr. Provides live geometry, selection, orbit/pan/zoom, transform gizmo, material presets, hierarchy, local save and JSON import/export. CDN access is required. Rendering is limited to about 30 fps, uses low power mode, reduces pixel ratio on phones, and pauses while the tab is hidden.

## Higgsfield honesty
The UI reports Higgsfield as not connected until an authenticated, documented integration is implemented and verified. A website URL is not proof of editor control.

## Verification notes
This commit adds application source and server routes; it does not configure deployment secrets, publish a runtime, or prove a live provider connection. Verify after deployment: the status endpoint returns JSON, an unconfigured chat request returns HTTP 503, and a configured DeepSeek key returns a genuine non-empty response. Then test add/select/transform/material/save/load on desktop and mobile.
