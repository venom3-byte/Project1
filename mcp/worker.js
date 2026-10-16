/**
 * Read-only MCP server for the public Claude Game Editor copy.
 *
 * Transport: MCP Streamable HTTP (stateless JSON-RPC POST).
 * Security model: exposes only public GitHub repository metadata/source and
 * recent workflow status. No writes, shell execution, token handling, or
 * arbitrary URL fetching are exposed.
 */
const OWNER = "venom3-byte";
const REPO = "Project1";
const BRANCH = "main";
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "cache-control": "no-store"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8", ...extra }
  });
}
function rpc(id, result) { return { jsonrpc: "2.0", id: id ?? null, result }; }
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
async function gh(path) {
  const r = await fetch(API + path, {
    headers: { "accept": "application/vnd.github+json", "user-agent": "Claude-Game-Editor-MCP/1.0", "x-github-api-version": "2022-11-28" }
  });
  if (!r.ok) throw new Error("GitHub API returned " + r.status);
  return r.json();
}
const tools = [
  {
    name: "get_project_status",
    description: "Read the GitHub repository metadata and latest CI/runtime build status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "list_project_files",
    description: "List paths in the public source branch or the generated runtime-site branch. Does not read file contents.",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", enum: ["main", "runtime-site"], default: "main" },
        prefix: { type: "string", description: "Optional path prefix, such as src/editor/" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
      },
      additionalProperties: false
    }
  },
  {
    name: "read_project_file",
    description: "Read a text file from the public main source branch. Paths are constrained to this repository; maximum response is 24 KB.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, maxLength: 240 },
        start_line: { type: "integer", minimum: 1, maximum: 10000 },
        end_line: { type: "integer", minimum: 1, maximum: 10000 }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "get_latest_build",
    description: "Inspect the most recent GitHub Actions run for the runtime build workflow.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "search_project_paths",
    description: "Search source/runtime file paths by case-insensitive substring.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 100 },
        branch: { type: "string", enum: ["main", "runtime-site"], default: "main" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
];

async function callTool(name, args = {}) {
  if (name === "get_project_status") {
    const [repo, runs] = await Promise.all([
      gh("/repos/" + OWNER + "/" + REPO),
      gh("/repos/" + OWNER + "/" + REPO + "/actions/runs?per_page=10")
    ]);
    const latest = (runs.workflow_runs || []).find(r => r.path === ".github/workflows/build-runtime.yml") || null;
    return {
      repository: repo.full_name,
      default_branch: repo.default_branch,
      private: repo.private,
      source_url: repo.html_url,
      runtime_url: "https://claude-game-editor-copy.forgemail-agent.workers.dev/",
      latest_runtime_build: latest ? {
        status: latest.status, conclusion: latest.conclusion, created_at: latest.created_at,
        updated_at: latest.updated_at, url: latest.html_url, commit: latest.head_sha
      } : null
    };
  }
  if (name === "get_latest_build") {
    const runs = await gh("/repos/" + OWNER + "/" + REPO + "/actions/runs?per_page=20");
    const latest = (runs.workflow_runs || []).find(r => r.path === ".github/workflows/build-runtime.yml");
    if (!latest) return { found: false, message: "No runtime build workflow run found yet." };
    return {
      found: true, status: latest.status, conclusion: latest.conclusion,
      created_at: latest.created_at, updated_at: latest.updated_at,
      url: latest.html_url, commit: latest.head_sha
    };
  }
  if (name === "list_project_files" || name === "search_project_paths") {
    const branch = args.branch === "runtime-site" ? "runtime-site" : "main";
    const tree = await gh("/repos/" + OWNER + "/" + REPO + "/git/trees/" + branch + "?recursive=1");
    const query = name === "search_project_paths" ? String(args.query || "").toLowerCase() : "";
    const prefix = String(args.prefix || "");
    const limit = Math.max(1, Math.min(Number(args.limit) || (name === "search_project_paths" ? 20 : 50), name === "search_project_paths" ? 50 : 100));
    let paths = (tree.tree || []).filter(x => x.type === "blob").map(x => x.path);
    if (name === "list_project_files" && prefix) paths = paths.filter(p => p.startsWith(prefix));
    if (name === "search_project_paths") paths = paths.filter(p => p.toLowerCase().includes(query));
    return { branch, count_returned: Math.min(paths.length, limit), total_matches: paths.length, truncated: !!tree.truncated, paths: paths.slice(0, limit) };
  }
  if (name === "read_project_file") {
    const path = String(args.path || "").replace(/^\/+/, "");
    if (!path || path.split("/").some(p => p === "." || p === "..") || path.includes("\\") || path.length > 240) {
      throw new Error("Invalid repository-relative path.");
    }
    const response = await fetch(RAW + path, { headers: { "user-agent": "Claude-Game-Editor-MCP/1.0" } });
    if (!response.ok) throw new Error("File not found or not publicly readable (HTTP " + response.status + ").");
    const text = await response.text();
    if (text.length > 24000) throw new Error("File exceeds the 24 KB MCP response limit; request a smaller line range.");
    let lines = text.split("\n");
    if (args.start_line || args.end_line) {
      const start = Math.max(1, Number(args.start_line) || 1);
      const end = Math.max(start, Math.min(lines.length, Number(args.end_line) || start + 250));
      lines = lines.slice(start - 1, end).map((line, i) => String(start + i) + ": " + line);
    }
    return { path, branch: BRANCH, lines_returned: lines.length, content: lines.join("\n") };
  }
  throw new Error("Unknown tool: " + name);
}

async function handleMcp(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method === "GET") {
    return json({ name: "claude-game-editor-mcp", version: "1.0.0", transport: "MCP Streamable HTTP", methods: ["POST"], tools: tools.length });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed. Send MCP JSON-RPC POST." }, 405);
  let body;
  try { body = await request.json(); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") return json(rpcError(body.id, -32600, "Invalid Request"), 400);
  if (body.method === "notifications/initialized" || body.method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: cors });
  }
  if (body.method === "initialize") {
    return json(rpc(body.id, {
      protocolVersion: body.params?.protocolVersion || "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "claude-game-editor-mcp", version: "1.0.0" },
      instructions: "Read-only MCP tools for the public Claude Game Editor copy in venom3-byte/Project1. No repository writes or shell execution are exposed."
    }), 200, { "mcp-protocol-version": body.params?.protocolVersion || "2025-03-26" });
  }
  if (body.method === "ping") return json(rpc(body.id, {}));
  if (body.method === "tools/list") return json(rpc(body.id, { tools }));
  if (body.method === "tools/call") {
    const name = body.params?.name;
    const args = body.params?.arguments || {};
    try {
      const result = await callTool(name, args);
      return json(rpc(body.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false }));
    } catch (e) {
      return json(rpc(body.id, { content: [{ type: "text", text: String(e?.message || e) }], isError: true }));
    }
  }
  if (body.method === "resources/list") return json(rpc(body.id, { resources: [] }));
  return json(rpcError(body.id, -32601, "Method not found: " + body.method), 200);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return handleMcp(request);
    // The normal website is served from the compiled runtime-site branch.
    let path = decodeURIComponent(url.pathname || "/");
    if (path === "/" || path.endsWith("/")) path += "index.html";
    if (path.split("/").some(part => part === "..")) return new Response("Bad path", { status: 400 });
    const source = RAW.replace("/main/", "/runtime-site/") + path;
    let upstream = await fetch(source, { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!upstream.ok && !/\.[^/]+$/.test(path)) {
      upstream = await fetch(RAW.replace("/main/", "/runtime-site/") + "index.html");
      path = "/index.html";
    }
    if (!upstream.ok) return new Response("The app build is not published yet. Check the GitHub Actions build.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    const types = {
      ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
      ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm",
      ".txt": "text/plain; charset=utf-8", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json"
    };
    const ext = path.match(/\.[^./]+$/)?.[0]?.toLowerCase() || "";
    const headers = new Headers(upstream.headers);
    headers.delete("content-security-policy");
    headers.delete("content-security-policy-report-only");
    headers.delete("x-frame-options");
    headers.delete("content-disposition");
    headers.set("content-type", types[ext] || "application/octet-stream");
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
    headers.set("cache-control", ext === ".html" ? "no-store" : "public, max-age=300");
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
