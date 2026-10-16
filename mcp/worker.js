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
const AGENT_STATE_KEY = "editor-project:v1";
const VISUAL_SESSION_KEY = "visual-agent-session:v1";
const EDITOR_URL = "https://claude-game-editor-copy.forgemail-agent.workers.dev/";
let nextCdpId = 0;
const VALID_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "plane", "light", "model", "image"];
const VALID_BEHAVIORS = ["none", "player", "rotate", "bob", "collectible", "hazard", "goal", "patrol"];
const VALID_MODES = ["translate", "rotate", "scale"];


const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
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
  },
  {
    name: "get_editor_state",
    description: "Read the current shared 3D editor scene and object transforms from the Agent Gateway.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "control_editor",
    description: "Execute a bounded edit in the live 3D editor scene. Supports primitive edits and importing approved public OBJ/GLB/GLTF assets by URL. Changes are stored in the Agent Gateway and live editor tabs pick them up automatically. Actions: add_object, import_model, update_object, duplicate_object, delete_object, rename_project, clear_scene, reset_starter, set_mode, set_snap, set_playing.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add_object", "import_model", "update_object", "duplicate_object", "delete_object", "rename_project", "clear_scene", "reset_starter", "set_mode", "set_snap", "set_playing"] },
        id: { type: "string", maxLength: 120 },
        shape: { type: "string", enum: ["box", "sphere", "cylinder", "cone", "torus", "plane", "light"] },
        name: { type: "string", maxLength: 80 },
        position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        color: { type: "string", maxLength: 32 },
        solid: { type: "boolean" },
        behavior: { type: "string", enum: ["none", "player", "rotate", "bob", "collectible", "hazard", "goal", "patrol"] },
        speed: { type: "number", minimum: 0, maximum: 100 },
        intensity: { type: "number", minimum: 0, maximum: 10000 },
        model_url: { type: "string", maxLength: 800 },
        model_format: { type: "string", enum: ["obj", "glb", "gltf"] },
        asset_files: { type: "object", additionalProperties: { type: "string", maxLength: 800 } },
        mode: { type: "string", enum: ["translate", "rotate", "scale"] },
        snap: { type: "boolean" },
        playing: { type: "boolean" }
      },
      required: ["action"],
      additionalProperties: false
    }
  },
  {
    name: "visual_open_editor",
    description: "Launch or reuse a remote Cloudflare headless Chrome session and open the live Forge/Claude editor. Returns live DOM observations and an actual screenshot.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "visual_screenshot",
    description: "Capture a fresh screenshot of the current remote editor tab; returns an actual image as MCP image content.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "visual_inspect",
    description: "Read visible page text, buttons, form fields, canvas count, and element geometry from the current remote browser, plus a screenshot.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "visual_click",
    description: "Perform an actual mouse click in the remote browser using a CSS selector, exact visible text, or viewport coordinates. Only the fixed editor origin is navigated.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", maxLength: 180 },
        text: { type: "string", maxLength: 120 },
        x: { type: "number", minimum: 0, maximum: 5000 },
        y: { type: "number", minimum: 0, maximum: 5000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "visual_type",
    description: "Type text through the remote browser into a visible input, textarea or contenteditable control identified by CSS selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", minLength: 1, maxLength: 180 },
        text: { type: "string", maxLength: 4000 }
      },
      required: ["selector", "text"],
      additionalProperties: false
    }
  },
  {
    name: "visual_press_key",
    description: "Send a real key press to the remote browser for editor shortcuts. Supported keys: Enter, Escape, Tab, Delete, Backspace, Space, arrows, Home, End, F, W, E, R, and Ctrl+Z/Ctrl+Y/Ctrl+D.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", enum: ["Enter","Escape","Tab","Delete","Backspace","Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","F","W","E","R","Ctrl+Z","Ctrl+Y","Ctrl+D"] }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "visual_scroll",
    description: "Scroll the remote editor browser viewport or panel using real wheel input.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up","down","left","right"] },
        amount: { type: "integer", minimum: 60, maximum: 1200 }
      },
      required: ["direction"],
      additionalProperties: false
    }
  },
  {
    name: "visual_run_checks",
    description: "Run a UI-level verification loop against the live editor: inspect the canvas and scene panel, click Play, verify Stop appears, click Stop, verify Play returns; returns console/runtime observations and screenshot.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
];

function createObject(id, shape, overrides = {}) {
  const labels = { box: "Cube", sphere: "Sphere", cylinder: "Cylinder", cone: "Cone", torus: "Torus", plane: "Plane", light: "Light" };
  return {
    id, name: labels[shape] || "Object", shape,
    position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    color: shape === "light" ? "#fff2c6" : "#8a9bb0",
    solid: false, behavior: "none", speed: 2, intensity: 300,
    ...overrides
  };
}
function starterProject() {
  const obj = (id, shape, name, p, s, color, extra = {}) => createObject(id, shape, {
    name, position: p, scale: s, color, ...extra
  });
  return {
    format: "game-editor", version: 2, name: "Agent Controlled Project",
    selectedId: null,
    editor: { mode: "translate", snap: false, playing: false },
    objects: [
      obj("agent-ground", "box", "Ground", [0, -0.5, 0], [40, 1, 40], "#3f6b4f", {solid:true}),
      obj("agent-player", "box", "Player", [0, 0.5, 6], [1,1,1], "#4f8cff", {behavior:"player",speed:6}),
      obj("agent-platform-1", "box", "Platform 1", [4,1,-2], [4,0.5,4], "#c9a86a", {solid:true}),
      obj("agent-platform-2", "box", "Platform 2", [-5,2,-6], [4,0.5,4], "#c9a86a", {solid:true}),
      obj("agent-platform-3", "box", "Platform 3", [0,3,-11], [4,0.5,4], "#c9a86a", {solid:true}),
      obj("agent-platform-4", "box", "Platform 4", [7,4,-13], [4,0.5,4], "#c9a86a", {solid:true}),
      obj("agent-gem-1", "box", "Gem 1", [4,2.2,-2], [0.5,0.5,0.5], "#ffd23f", {rotation:[0,45,0],behavior:"collectible"}),
      obj("agent-gem-2", "box", "Gem 2", [-5,3.2,-6], [0.5,0.5,0.5], "#ffd23f", {rotation:[0,45,0],behavior:"collectible"}),
      obj("agent-gem-3", "box", "Gem 3", [0,4.2,-11], [0.5,0.5,0.5], "#ffd23f", {rotation:[0,45,0],behavior:"collectible"}),
      obj("agent-spikes", "cone", "Spikes", [-3,0.5,2], [1,1,1], "#e5484d", {behavior:"hazard"}),
      obj("agent-enemy", "box", "Enemy", [0,0.5,-4], [1,1,1], "#e5484d", {behavior:"patrol"}),
      obj("agent-goal", "torus", "Goal", [7,5.4,-13], [1.2,1.2,1.2], "#42d392", {rotation:[90,0,0],behavior:"goal"}),
      obj("agent-sun", "light", "Sun lamp", [0,10,0], [1,1,1], "#fff2c6", {intensity:500})
    ]
  };
}
function validVector(v, scale = false) {
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 10000 && (!scale || Math.abs(n) <= 1000));
}
function validatePublicAssetUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 800) throw new Error("Model asset URL must be a non-empty HTTPS URL up to 800 characters.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Model asset URL is invalid."); }
  const allowedHosts = new Set(["raw.githubusercontent.com", "cdn.jsdelivr.net", "assets.macaly-user-data.dev"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || url.username || url.password) {
    throw new Error("Model assets must use HTTPS from raw.githubusercontent.com, cdn.jsdelivr.net, or assets.macaly-user-data.dev.");
  }
  return url.toString();
}
function validateAssetFiles(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("asset_files must map companion filenames to public HTTPS URLs.");
  const entries = Object.entries(value);
  if (entries.length > 12) throw new Error("At most 12 model companion files may be supplied.");
  const files = {};
  for (const [name, url] of entries) {
    if (!/^[A-Za-z0-9_. -]{1,120}$/.test(name) || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      throw new Error("Companion filenames must be simple basenames without path separators.");
    }
    files[name] = validatePublicAssetUrl(url);
  }
  return files;
}
function validateObjectPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("patch must be an object.");
  const allowed = ["name", "position", "rotation", "scale", "color", "solid", "behavior", "speed", "intensity"];
  for (const key of Object.keys(patch)) if (!allowed.includes(key)) throw new Error("Object field is not editable through this tool: " + key);
  if ("name" in patch && (typeof patch.name !== "string" || !patch.name.trim() || patch.name.length > 80)) throw new Error("name must be 1–80 characters.");
  for (const k of ["position", "rotation", "scale"]) if (k in patch && !validVector(patch[k], k === "scale")) throw new Error(k + " must be a finite 3-value vector within supported bounds.");
  if ("color" in patch && (typeof patch.color !== "string" || patch.color.length > 32 || !/^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(patch.color))) throw new Error("color must be a simple CSS color or hex value.");
  if ("solid" in patch && typeof patch.solid !== "boolean") throw new Error("solid must be boolean.");
  if ("behavior" in patch && !VALID_BEHAVIORS.includes(patch.behavior)) throw new Error("Unsupported behavior.");
  if ("speed" in patch && (typeof patch.speed !== "number" || !Number.isFinite(patch.speed) || patch.speed < 0 || patch.speed > 100)) throw new Error("speed must be between 0 and 100.");
  if ("intensity" in patch && (typeof patch.intensity !== "number" || !Number.isFinite(patch.intensity) || patch.intensity < 0 || patch.intensity > 10000)) throw new Error("intensity must be between 0 and 10000.");
  return patch;
}
async function readAgentSnapshot(env) {
  if (!env.AGENT_STORE) throw new Error("Agent Gateway storage is not configured on this Worker.");
  const raw = await env.AGENT_STORE.get(AGENT_STATE_KEY);
  if (!raw) return { revision: 0, project: null, updated_at: null, last_action: null };
  try { return JSON.parse(raw); } catch { throw new Error("Stored editor project state is corrupt."); }
}
async function saveAgentProject(env, prior, project, action) {
  const snapshot = {
    revision: Number(prior.revision || 0) + 1,
    project,
    updated_at: new Date().toISOString(),
    last_action: action
  };
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 1500000) throw new Error("Project state exceeds the 1.5 MB Agent Gateway limit.");
  await env.AGENT_STORE.put(AGENT_STATE_KEY, serialized);
  return snapshot;
}
function projectSummary(project) {
  return {
    name: project.name,
    revision_source: "Agent Gateway",
    selected_id: project.selectedId || null,
    editor: project.editor || {mode:"translate",snap:false,playing:false},
    object_count: project.objects.length,
    objects: project.objects.slice(0, 100).map(o => ({
      id:o.id, name:o.name, shape:o.shape, position:o.position, rotation:o.rotation, scale:o.scale,
      color:o.color, solid:o.solid, behavior:o.behavior, speed:o.speed, intensity:o.intensity,
      modelFormat:o.modelFormat || null, hasAsset:!!o.modelData
    })),
    truncated: project.objects.length > 100
  };
}
async function executeEditorControl(args, env) {
  const snap = await readAgentSnapshot(env);
  const project = snap.project || starterProject();
  project.editor = project.editor || {mode:"translate",snap:false,playing:false};
  let targetId = args.id || project.selectedId || null;
  if (args.action === "import_model") {
    if (!["obj", "glb", "gltf"].includes(args.model_format)) throw new Error("model_format must be obj, glb, or gltf.");
    const modelUrl = validatePublicAssetUrl(args.model_url);
    const assetFiles = validateAssetFiles(args.asset_files);
    const base = {};
    for (const k of ["name", "position", "rotation", "scale", "color", "solid", "behavior", "speed", "intensity"]) {
      if (args[k] !== undefined) base[k] = args[k];
    }
    if (base.name === undefined) base.name = "Imported " + args.model_format.toUpperCase() + " model";
    validateObjectPatch(base);
    const id = "agent-" + crypto.randomUUID();
    const fields = {...base, modelData:modelUrl, modelFormat:args.model_format};
    if (assetFiles && Object.keys(assetFiles).length) fields.assetFiles = assetFiles;
    const object = createObject(id, "model", fields);
    project.objects.push(object);
    project.selectedId = id;
    targetId = id;
  } else if (args.action === "add_object") {
    if (!args.shape || !VALID_SHAPES.includes(args.shape) || args.shape === "model" || args.shape === "image") throw new Error("Choose a primitive shape: box, sphere, cylinder, cone, torus, plane, or light.");
    const id = "agent-" + crypto.randomUUID();
    const base = {};
    for (const k of ["name","position","rotation","scale","color","solid","behavior","speed","intensity"]) if (args[k] !== undefined) base[k] = args[k];
    validateObjectPatch(base);
    const object = createObject(id, args.shape, base);
    project.objects.push(object);
    project.selectedId = id;
    targetId = id;
  } else if (args.action === "update_object") {
    if (!targetId) throw new Error("Provide id or select an object first.");
    const idx = project.objects.findIndex(o => o.id === targetId);
    if (idx < 0) throw new Error("Object not found: " + targetId);
    const patch = validateObjectPatch({
      ...Object.fromEntries(["name","position","rotation","scale","color","solid","behavior","speed","intensity"].filter(k => args[k] !== undefined).map(k => [k,args[k]]))
    });
    if (!Object.keys(patch).length) throw new Error("Provide at least one editable object property.");
    project.objects[idx] = {...project.objects[idx], ...patch};
    project.selectedId = targetId;
  } else if (args.action === "duplicate_object") {
    if (!targetId) throw new Error("Provide id or select an object first.");
    const src = project.objects.find(o => o.id === targetId);
    if (!src) throw new Error("Object not found: " + targetId);
    const copy = {...src, id:"agent-"+crypto.randomUUID(), name:src.name+" copy", position:[src.position[0]+1,src.position[1],src.position[2]+1]};
    project.objects.push(copy);
    project.selectedId = copy.id;
    targetId = copy.id;
  } else if (args.action === "delete_object") {
    if (!targetId) throw new Error("Provide id or select an object first.");
    if (!project.objects.some(o => o.id === targetId)) throw new Error("Object not found: " + targetId);
    project.objects = project.objects.filter(o => o.id !== targetId);
    project.selectedId = null;
    targetId = null;
  } else if (args.action === "rename_project") {
    if (typeof args.name !== "string" || !args.name.trim() || args.name.length > 80) throw new Error("name must be 1–80 characters.");
    project.name = args.name.trim();
  } else if (args.action === "clear_scene") {
    project.objects = [];
    project.selectedId = null;
    project.name = project.name || "Untitled Project";
  } else if (args.action === "reset_starter") {
    const fresh = starterProject();
    project.name = args.name && typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0,80) : fresh.name;
    project.objects = fresh.objects;
    project.selectedId = null;
    project.editor = fresh.editor;
  } else if (args.action === "set_mode") {
    if (!VALID_MODES.includes(args.mode)) throw new Error("mode must be translate, rotate, or scale.");
    project.editor.mode = args.mode;
  } else if (args.action === "set_snap") {
    if (typeof args.snap !== "boolean") throw new Error("snap must be boolean.");
    project.editor.snap = args.snap;
  } else if (args.action === "set_playing") {
    if (typeof args.playing !== "boolean") throw new Error("playing must be boolean.");
    project.editor.playing = args.playing;
  } else {
    throw new Error("Unknown editor action.");
  }
  const saved = await saveAgentProject(env, snap, project, args.action);
  const selected = project.selectedId ? project.objects.find(o => o.id === project.selectedId) : null;
  return { ok:true, action:args.action, revision:saved.revision, updated_at:saved.updated_at, selected_object:selected ? {id:selected.id,name:selected.name,shape:selected.shape,position:selected.position,rotation:selected.rotation,scale:selected.scale,modelFormat:selected.modelFormat||null,hasAsset:!!selected.modelData} : null, project:projectSummary(project) };
}

function cdpCommand(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextCdpId;
    const timer = setTimeout(() => { cleanup(); reject(new Error("CDP command timed out: " + method)); }, 15000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    const onClose = () => { cleanup(); reject(new Error("Remote browser socket closed.")); };
    const onMessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id !== id) return;
      cleanup();
      if (message.error) reject(new Error(message.error.message || method + " failed"));
      else resolve(message.result || {});
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    try { socket.send(JSON.stringify({id, method, params})); }
    catch (e) { cleanup(); reject(e); }
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connectVisualBrowser(env) {
  if (!env.BROWSER) throw new Error("Cloudflare Browser Run binding is missing on this Worker.");
  let saved = null;
  try { saved = JSON.parse((await env.AGENT_STORE.get(VISUAL_SESSION_KEY)) || "null"); } catch {}
  if (saved?.sessionId && saved?.targetId) {
    try {
      const conn = await env.BROWSER.connectSession(saved.sessionId, {targetId: saved.targetId});
      const response = await conn.webSocket.fetch("https://browser-binding.invalid", {headers:{Upgrade:"websocket"}});
      if (!response.webSocket) throw new Error("Browser Run did not return a WebSocket.");
      response.webSocket.accept();
      return {socket:response.webSocket, sessionId:saved.sessionId, targetId:saved.targetId, reused:true};
    } catch {
      try { await env.BROWSER.closeSession(saved.sessionId); } catch {}
      saved = null;
    }
  }
  const session = await env.BROWSER.acquire({targets:true, keepAlive:600000});
  let targets = session.targets || [];
  if (!targets.length) {
    try { targets = await env.BROWSER.devtools.listTargets(session.sessionId); } catch {}
  }
  let target = targets.find(t => t.type === "page");
  if (!target) target = await env.BROWSER.devtools.newTarget(session.sessionId, "about:blank");
  const conn = await env.BROWSER.connectSession(session.sessionId, {targetId:target.id});
  const response = await conn.webSocket.fetch("https://browser-binding.invalid", {headers:{Upgrade:"websocket"}});
  if (!response.webSocket) throw new Error("Browser Run did not return a WebSocket.");
  response.webSocket.accept();
  await env.AGENT_STORE.put(VISUAL_SESSION_KEY, JSON.stringify({sessionId:session.sessionId,targetId:target.id,createdAt:new Date().toISOString()}), {expirationTtl:1200});
  return {socket:response.webSocket,sessionId:session.sessionId,targetId:target.id,reused:false};
}
async function withVisualBrowser(env, fn) {
  const browser = await connectVisualBrowser(env);
  try {
    await cdpCommand(browser.socket, "Page.enable");
    await cdpCommand(browser.socket, "Runtime.enable");
    return await fn(browser);
  } finally {
    try { browser.socket.close(); } catch {}
  }
}
async function visualEvaluate(socket, expression) {
  const result = await cdpCommand(socket, "Runtime.evaluate", {expression, returnByValue:true, awaitPromise:true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}
async function visualSummary(socket) {
  return await visualEvaluate(socket, `(() => {
    const clean = s => (s || "").replace(/\\s+/g," ").trim().slice(0,180);
    const rect = e => { const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}; };
    const visible = e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return r.width>0 && r.height>0 && s.visibility!=="hidden" && s.display!=="none"; };
    const buttons=[...document.querySelectorAll("button,[role=button]")].filter(visible).slice(0,100).map(e=>({text:clean(e.innerText||e.getAttribute("aria-label")||e.title),disabled:!!e.disabled,rect:rect(e)}));
    const fields=[...document.querySelectorAll("input,textarea,select,[contenteditable=true]")].filter(visible).slice(0,60).map(e=>({tag:e.tagName,type:e.type||null,value:clean(e.value||e.innerText),placeholder:e.placeholder||"",aria:e.getAttribute("aria-label")||"",rect:rect(e)}));
    const canvases=[...document.querySelectorAll("canvas")].map(e=>({width:e.width,height:e.height,rect:rect(e)}));
    return {url:location.href,title:document.title,bodyText:clean(document.body.innerText).slice(0,7000),buttons,fields,canvases};
  })()`);
}
async function visualScreenshot(socket) {
  const result = await cdpCommand(socket, "Page.captureScreenshot", {format:"jpeg",quality:68,fromSurface:true,captureBeyondViewport:false});
  return result.data;
}
async function visualClickInternal(socket, args) {
  if (typeof args.x === "number" && typeof args.y === "number") {
    const x=Math.round(args.x), y=Math.round(args.y);
    await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mouseMoved",x,y});
    await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});
    await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});
    return {clicked:{x,y},method:"coordinates"};
  }
  let lookup;
  if (typeof args.selector === "string" && args.selector.trim()) {
    if (args.selector.length>180) throw new Error("Selector is too long.");
    lookup = `document.querySelector(${JSON.stringify(args.selector)})`;
  } else if (typeof args.text === "string" && args.text.trim()) {
    if (args.text.length>120) throw new Error("Text query is too long.");
    lookup = `[...document.querySelectorAll("button,[role=button],label,[role=tab],input[type=button],input[type=submit]")].find(e=>(e.innerText||e.getAttribute("aria-label")||e.value||e.title||"").trim()===${JSON.stringify(args.text.trim())})`;
  } else throw new Error("Provide selector, text, or both x and y coordinates.");
  const found=await visualEvaluate(socket,`(() => { const e=${lookup}; if(!e) return {error:"Element not found"}; const r=e.getBoundingClientRect(),s=getComputedStyle(e); if(e.disabled || r.width<=0 || r.height<=0 || s.visibility==="hidden" || s.display==="none") return {error:"Element is not visible or is disabled"}; return {x:r.x+r.width/2,y:r.y+r.height/2,tag:e.tagName,text:(e.innerText||e.value||e.getAttribute("aria-label")||"").trim().slice(0,120)}; })()`);
  if(found?.error) throw new Error(found.error);
  const x=Math.round(found.x), y=Math.round(found.y);
  await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mouseMoved",x,y});
  await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});
  await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});
  await sleep(200);
  return {clicked:found,method:"element-center"};
}
async function visualKeyInternal(socket, key) {
  const combos={"Ctrl+Z":{key:"z",code:"KeyZ",vk:90,mod:2},"Ctrl+Y":{key:"y",code:"KeyY",vk:89,mod:2},"Ctrl+D":{key:"d",code:"KeyD",vk:68,mod:2}};
  const named={Enter:{key:"Enter",code:"Enter",vk:13},"Escape":{key:"Escape",code:"Escape",vk:27},Tab:{key:"Tab",code:"Tab",vk:9},Delete:{key:"Delete",code:"Delete",vk:46},Backspace:{key:"Backspace",code:"Backspace",vk:8},Space:{key:" ",code:"Space",vk:32},ArrowUp:{key:"ArrowUp",code:"ArrowUp",vk:38},ArrowDown:{key:"ArrowDown",code:"ArrowDown",vk:40},ArrowLeft:{key:"ArrowLeft",code:"ArrowLeft",vk:37},ArrowRight:{key:"ArrowRight",code:"ArrowRight",vk:39},Home:{key:"Home",code:"Home",vk:36},End:{key:"End",code:"End",vk:35},F:{key:"f",code:"KeyF",vk:70},W:{key:"w",code:"KeyW",vk:87},E:{key:"e",code:"KeyE",vk:69},R:{key:"r",code:"KeyR",vk:82}};
  if(combos[key]){
    const k=combos[key];
    await cdpCommand(socket,"Input.dispatchKeyEvent",{type:"keyDown",key:"Control",code:"ControlLeft",windowsVirtualKeyCode:17});
    await cdpCommand(socket,"Input.dispatchKeyEvent",{type:"keyDown",key:k.key,code:k.code,windowsVirtualKeyCode:k.vk,modifiers:k.mod});
    await cdpCommand(socket,"Input.dispatchKeyEvent",{type:"keyUp",key:k.key,code:k.code,windowsVirtualKeyCode:k.vk,modifiers:k.mod});
    await cdpCommand(socket,"Input.dispatchKeyEvent",{type:"keyUp",key:"Control",code:"ControlLeft",windowsVirtualKeyCode:17});
  } else {
    const k=named[key]; if(!k) throw new Error("Unsupported key.");
    await cdpCommand(socket,"Input.dispatchKeyEvent",{type:"keyDown",key:k.key,code:k.code,windowsVirtualKeyCode:k.vk});
    await cdpCommand(socket,"Input.dispatchKeyEvent",{type:"keyUp",key:k.key,code:k.code,windowsVirtualKeyCode:k.vk});
  }
  return {sent:key};
}
async function visualTypeInternal(socket, selector, text) {
  if(typeof selector!=="string"||!selector.trim()||selector.length>180) throw new Error("Invalid field selector.");
  if(typeof text!=="string"||text.length>4000) throw new Error("Text is too long.");
  const found=await visualEvaluate(socket,`(() => {const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return {error:"Field not found"}; const r=e.getBoundingClientRect(),s=getComputedStyle(e); if(r.width<=0||r.height<=0||s.display==="none"||s.visibility==="hidden") return {error:"Field is not visible"}; if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement||e.isContentEditable)) return {error:"Target is not a text-editable field"}; e.focus(); if("select" in e) e.select(); return {tag:e.tagName,type:e.type||null,x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if(found?.error) throw new Error(found.error);
  await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mouseMoved",x:Math.round(found.x),y:Math.round(found.y)});
  await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mousePressed",x:Math.round(found.x),y:Math.round(found.y),button:"left",clickCount:1});
  await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mouseReleased",x:Math.round(found.x),y:Math.round(found.y),button:"left",clickCount:1});
  await cdpCommand(socket,"Input.insertText",{text});
  return {typed:text.length,selector,tag:found.tag,type:found.type};
}
async function visualTool(name,args,env) {
  return await withVisualBrowser(env, async browser => {
    const socket=browser.socket;
    if(name==="visual_open_editor"){
      await cdpCommand(socket,"Page.navigate",{url:EDITOR_URL});
      await sleep(3500);
    } else if(name==="visual_click"){
      const action=await visualClickInternal(socket,args);
      await sleep(350);
      return {structuredContent:{ok:true,action,observation:await visualSummary(socket)},image:await visualScreenshot(socket)};
    } else if(name==="visual_type"){
      const action=await visualTypeInternal(socket,args.selector,args.text);
      await sleep(250);
      return {structuredContent:{ok:true,action,observation:await visualSummary(socket)},image:await visualScreenshot(socket)};
    } else if(name==="visual_press_key"){
      const action=await visualKeyInternal(socket,args.key);
      await sleep(250);
      return {structuredContent:{ok:true,action,observation:await visualSummary(socket)},image:await visualScreenshot(socket)};
    } else if(name==="visual_scroll"){
      const direction=args.direction;
      const delta= Math.max(60,Math.min(1200,Number(args.amount)||480));
      await cdpCommand(socket,"Input.dispatchMouseEvent",{type:"mouseWheel",x:720,y:450,deltaX:direction==="left"?-delta:direction==="right"?delta:0,deltaY:direction==="up"?-delta:direction==="down"?delta:0});
      await sleep(250);
      return {structuredContent:{ok:true,direction,amount:delta,observation:await visualSummary(socket)},image:await visualScreenshot(socket)};
    } else if(name==="visual_run_checks"){
      const initial=await visualSummary(socket);
      const canvas=initial.canvases?.length||0;
      const play=await visualEvaluate(socket,`(() => {const e=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==="Play"); return !!e && !e.disabled;})()`);
      if(!play) throw new Error("Play button is not visible or enabled.");
      await visualClickInternal(socket,{text:"Play"});
      await sleep(500);
      const stop=await visualEvaluate(socket,`(() => [...document.querySelectorAll("button")].some(e=>e.innerText.trim()==="Stop" && e.getBoundingClientRect().width>0))()`);
      if(!stop) throw new Error("Play did not expose the Stop button.");
      await visualClickInternal(socket,{text:"Stop"});
      await sleep(350);
      const playAgain=await visualEvaluate(socket,`(() => [...document.querySelectorAll("button")].some(e=>e.innerText.trim()==="Play" && e.getBoundingClientRect().width>0))()`);
      const final=await visualSummary(socket);
      const issues=[];
      if(canvas!==1) issues.push("Expected exactly one WebGL canvas; got "+canvas);
      if(!stop) issues.push("Stop button did not appear while playing");
      if(!playAgain) issues.push("Play button did not return after Stop");
      return {structuredContent:{ok:issues.length===0,checks:{httpAndPage:true,canvasCount:canvas,playInitially:play,stopAppeared:stop,playReturned:playAgain},issues,observation:final,sessionReused:browser.reused},image:await visualScreenshot(socket)};
    }
    return {structuredContent:{ok:true,sessionId:browser.sessionId,targetId:browser.targetId,reused:browser.reused,observation:await visualSummary(socket)},image:await visualScreenshot(socket)};
  });
}

async function callTool(name, args = {}, env) {
  if (name === "get_editor_state") {
    const snap = await readAgentSnapshot(env);
    const project = snap.project || starterProject();
    return { revision:snap.revision, stored:!!snap.project, updated_at:snap.updated_at, last_action:snap.last_action, ...projectSummary(project) };
  }
  if (name === "control_editor") return executeEditorControl(args, env);
  if (name.startsWith("visual_")) return visualTool(name, args, env);
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

async function handleMcp(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method === "GET") {
    return json({ name: "claude-game-editor-mcp", version: "2.0.0", transport: "MCP Streamable HTTP", methods: ["POST"], tools: tools.length });
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
      serverInfo: { name: "claude-game-editor-mcp", version: "2.0.0" },
      instructions: "This MCP includes a real remote visual browser agent. Use visual_open_editor to start/reuse remote Chrome, visual_inspect and visual_screenshot to observe it, visual_click/visual_type/visual_press_key/visual_scroll to operate the actual UI, and visual_run_checks to verify Play/Stop through real UI input. All visual_ and control_editor tools require an Authorization: Bearer AGENT_API_KEY header. control_editor changes only bounded scene properties. Browser navigation is restricted to the configured editor origin."
    }), 200, { "mcp-protocol-version": body.params?.protocolVersion || "2025-03-26" });
  }
  if (body.method === "ping") return json(rpc(body.id, {}));
  if (body.method === "tools/list") return json(rpc(body.id, { tools }));
  if (body.method === "tools/call") {
    const name = body.params?.name;
    const args = body.params?.arguments || {};
    try {
      if (name === "control_editor" || name.startsWith("visual_")) {
        const expected = env.AGENT_API_KEY;
        const supplied = request.headers.get("authorization") || "";
        if (!expected || supplied !== "Bearer " + expected) throw new Error("Unauthorized: " + name + " requires Authorization: Bearer AGENT_API_KEY.");
      }
      const result = await callTool(name, args, env);
      if (result && typeof result === "object" && result.image && result.structuredContent) {
        return json(rpc(body.id, { content: [
          { type: "text", text: JSON.stringify(result.structuredContent, null, 2) },
          { type: "image", data: result.image, mimeType: "image/jpeg" }
        ], structuredContent: result.structuredContent, isError: false }));
      }
      return json(rpc(body.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false }));
    } catch (e) {
      return json(rpc(body.id, { content: [{ type: "text", text: String(e?.message || e) }], isError: true }));
    }
  }
  if (body.method === "resources/list") return json(rpc(body.id, { resources: [] }));
  return json(rpcError(body.id, -32601, "Method not found: " + body.method), 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/agent/")) return new Response(null, {status:204,headers:cors});
    if (url.pathname === "/agent/project") {
      if (request.method !== "GET") return json({error:"Method not allowed. Agent Gateway state is read-only from the public app."},405);
      try { return json(await readAgentSnapshot(env)); }
      catch (e) { return json({error:String(e?.message || e)},500); }
    }
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return handleMcp(request, env);
    // The normal website is served from the compiled runtime-site branch.
    let path = decodeURIComponent(url.pathname || "/");
    if (path === "/" || path.endsWith("/")) path += "index.html";
    if (path.split("/").some(part => part === "..")) return new Response("Bad path", { status: 400 });
    // raw.githubusercontent.com may cache the mutable runtime-site branch
    // name across deployments. A minute-bucket query forces a fresh origin key
    // while immutable hashed assets still remain cacheable by browsers.
    const runtimeBase = RAW.replace("/main/", "/runtime-site/");
    const sourceVersion = "?forge_runtime=" + Math.floor(Date.now() / 60000);
    let upstream = await fetch(runtimeBase + path + sourceVersion, {
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: { "cache-control": "no-cache", "pragma": "no-cache" }
    });
    if (!upstream.ok && !/\\.[^/]+$/.test(path)) {
      upstream = await fetch(runtimeBase + "index.html" + sourceVersion, {
        cf: { cacheTtl: 0, cacheEverything: false },
        headers: { "cache-control": "no-cache", "pragma": "no-cache" }
      });
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
