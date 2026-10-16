# Claude Game Editor MCP

A remote MCP Streamable HTTP endpoint for the public editor copy at
`https://github.com/venom3-byte/Project1`. It includes read-only repository tools and authenticated scene-control tools.

## Endpoints

- MCP: `https://claude-game-editor-copy.forgemail-agent.workers.dev/mcp`
- Live scene snapshot for the editor: `https://claude-game-editor-copy.forgemail-agent.workers.dev/agent/project` (read-only GET)

## Tools

- `get_project_status` — repository metadata and latest runtime build status.
- `get_latest_build` — latest GitHub Actions run for the runtime build.
- `list_project_files` — list source or generated runtime paths.
- `search_project_paths` — find files by path substring.
- `read_project_file` — read a public source file or a bounded line range.
- `get_editor_state` — inspect the live shared scene, object transforms, selection and editor mode.
- `control_editor` — add primitive objects; update position, rotation, scale, color, collision and behavior; duplicate/delete an object; rename or clear a scene; reset the starter scene; set transform mode, grid snapping and play state.

Writes are limited to validated scene actions; this is not arbitrary shell execution or arbitrary source-code evaluation. Imported binary assets are not uploaded through `control_editor`.

## Connect a compatible MCP client

For a client that supports remote MCP over HTTP and custom request headers, configure the MCP endpoint and provide an Authorization header using the Agent API key provisioned for this Worker:

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

Replace `YOUR_AGENT_API_KEY` with the key provisioned for your deployment; do not commit it to the repository. Exact UI/configuration depends on the MCP client. The endpoint uses stateless JSON-RPC POST requests and supports `initialize`, `tools/list`, `tools/call`, and `ping`.

## Live editor sync

The editor polls `/agent/project` approximately once per second. When `control_editor` changes the shared scene, any open editor tab picks up the new scene, selects the target object where applicable, and saves it to that tab's local browser storage. The shared scene is stored in a Cloudflare KV namespace bound to this Worker.

## Security and scope

- `control_editor` requires `Authorization: Bearer AGENT_API_KEY`; repository-reading tools are read-only.
- The public scene snapshot endpoint is GET-only. Public requests cannot directly write KV project state.
- Repository files are limited to this public repository and parent-directory traversal is rejected.
- Per-file MCP output is limited to 24 KB.
- This is a dedicated project MCP, not a full GitHub-account MCP.
