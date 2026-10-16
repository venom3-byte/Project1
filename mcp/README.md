# Claude Game Editor MCP

A remote MCP Streamable HTTP endpoint for the public Forge / Claude Game Editor copy at
`https://github.com/venom3-byte/Project1`. It combines scene-state tools with visual browser operation and UI-level verification.

## Endpoints

- MCP: `https://claude-game-editor-copy.forgemail-agent.workers.dev/mcp`
- Live scene snapshot: `https://claude-game-editor-copy.forgemail-agent.workers.dev/agent/project` (read-only GET)

## Scene tools

- `get_editor_state` — inspect scene objects, transforms, selection and editor mode.
- `control_editor` — add primitive objects; update position, rotation, scale, color, collision and behavior; duplicate/delete objects; rename or clear a scene; reset the starter scene; set transform mode, grid snapping and play state.

Writes are validated scene operations, not arbitrary source evaluation. Imported binary assets are not uploaded through `control_editor`.

## Visual browser tools

These tools launch or reuse a remote Chromium session through Cloudflare Browser Run and return real page observations or screenshots:

- `visual_open_editor` — open the deployed editor.
- `visual_screenshot` — capture an image from the current browser viewport.
- `visual_inspect` — read visible text, buttons, inputs, canvas dimensions and bounding boxes, alongside a screenshot.
- `visual_click`, `visual_type`, `visual_press_key`, `visual_scroll` — perform bounded UI interactions.
- `visual_run_checks` — drive Play/Stop through the UI and verify the transition.

All `control_editor` and `visual_*` tools require `Authorization: Bearer AGENT_API_KEY`. Visual actions are restricted to the configured editor origin; arbitrary URLs and arbitrary JavaScript are not accepted. Browser Run can temporarily return HTTP 429 when the remote browser session pool is throttled. In that case use the isolated Playwright fallback below until the remote pool is available again.

## Playwright fallback runner

`mcp/visual-agent-runner.mjs` performs actual headless Chromium UI actions, inspects the rendered DOM and canvas, captures a screenshot after each step, persists browser localStorage state, and checks runtime errors. Its navigation is pinned to this editor origin.

Install its isolated dependencies:

```sh
npm install --prefix mcp
```

Run a visual verification loop:

```sh
node mcp/visual-agent-runner.mjs checks
node mcp/visual-agent-runner.mjs inspect
node mcp/visual-agent-runner.mjs click '{"selector":"button[title=\"Add Sphere\"]}'
node mcp/visual-agent-runner.mjs sequence '{"steps":[{"type":"click","text":"Sphere"},{"type":"key","key":"Delete"}]}'
node mcp/visual-agent-runner.mjs type '{"selector":"input[aria-label=\"Project name\"]","text":"Visual QA Scene"}'
```

The output JSON includes the page observation, object state, runtime errors and screenshot path. Browser storage and screenshots live under `~/.cache/forge-visual-agent/` by default. The runner is a local/cloud-shell fallback, not an endpoint hosted inside the Worker.

## Connect a compatible MCP client

For a client that supports remote MCP over HTTP and custom request headers, configure the endpoint and supply the Agent API key already provisioned for this Worker:

```json
{
  "mcpServers": {
    "claude-game-editor": {
      "url": "https://claude-game-editor-copy.forgemail-agent.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_AGENT_API_KEY"
      }
    }
  }
}
```

Replace `YOUR_AGENT_API_KEY` with your provisioned key; do not commit it to the repository. Exact UI/configuration depends on the MCP client. The endpoint supports stateless JSON-RPC POST requests with `initialize`, `tools/list`, `tools/call`, and `ping`.

## Live scene sync

The editor checks `/agent/project` approximately once per second. Each tab remembers its last applied remote revision: an unchanged remote revision does not overwrite later local UI edits, while a newer agent revision is imported. The shared scene is stored in a Cloudflare KV namespace bound to this Worker.

## Security and scope

- `control_editor` and visual browser actions require the Agent API key; repository-reading tools are read-only.
- The public scene snapshot endpoint is GET-only. Public requests cannot directly write shared project state.
- The Worker only navigates its browser to the configured editor URL.
- File paths are repository-relative, parent-directory traversal is rejected, and single-file MCP output is limited to 24 KB.
- This is a dedicated project MCP, not a full GitHub-account MCP.
