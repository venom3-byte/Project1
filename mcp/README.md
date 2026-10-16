# Claude Game Editor MCP

A small, public, **read-only** MCP Streamable HTTP endpoint for the GitHub copy at
`https://github.com/venom3-byte/Project1`.

## Endpoint

`https://claude-game-editor-copy.forgemail-agent.workers.dev/mcp`

## Tools

- `get_project_status` — repository metadata and latest runtime build state.
- `get_latest_build` — latest GitHub Actions run for the runtime build.
- `list_project_files` — list source or generated runtime paths.
- `search_project_paths` — find files by path substring.
- `read_project_file` — read a public source file or a bounded line range.

## Connect a compatible MCP client

For a client that supports remote MCP over HTTP, add a server entry using the endpoint above. Example shape (the exact UI/config format depends on the client):

```json
{
  "mcpServers": {
    "claude-game-editor": {
      "url": "https://claude-game-editor-copy.forgemail-agent.workers.dev/mcp"
    }
  }
}
```

Some clients require OAuth or a separate "Add remote MCP server" flow and may not accept this JSON shape. The endpoint uses stateless JSON-RPC POST requests and supports `initialize`, `tools/list`, and `tools/call`.

## Security and scope

- Read-only: there are no tools to write files, push commits, run shell commands, or deploy.
- Reads only public files in this repository and public GitHub Actions metadata.
- File paths are repository-relative; parent-directory traversal is rejected.
- Per-file MCP output is limited to 24 KB.
- This is not a GitHub account MCP and cannot access private repositories.
