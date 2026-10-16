const OPS = {
  diagnostics: [],
  entities: [],
  vision: [],
  inspect: ["id", "name"],
  select: ["id", "name"],
  create: ["kind", "name", "x", "y", "z"],
  transform: ["id", "x", "y", "z", "rx", "ry", "rz", "sx", "sy", "sz"],
  "move-screen": ["id", "x", "y", "depth", "planeY"],
  physics: ["id", "mode", "shape"],
  duplicate: ["id"],
  delete: ["id"],
  focus: [],
  frame: [],
  play: [],
  stop: [],
  key: [],
  pcg: ["kind", "seed", "count", "area"],
  project: [],
  save: [],
  "asset-registry": [],
  qa: [],
  "qa-baseline": ["name"],
  "qa-diff": ["name"],
  screenshot: [],
  runtime: [],
  "nav-bake": [],
  "nav-path": ["start", "goal"],
  "save-slot": ["slot", "data"],
  "load-slot": ["slot"],
  "prefab-spawn": ["name", "x", "y", "z"],
  "template-third-person": [],
  "template-racing": [],
  "template-showcase": [],
  "gameplay-status": [],
  "animation-state": ["id", "state"],
  "animation-graph-create": ["id", "name"],
  "animation-graph-param": ["graphId", "key", "value"],
  "rig-profile": ["id", "name"],
  "rig-validate": ["rigId"],
  "terrain-generate": ["name", "options"],
  "shader-apply": ["preset"],
  "replay-status": [],
};

const STRING_RULES = {
  id: 128, name: 120, kind: 40, mode: 24, shape: 24, preset: 60,
  state: 80, graphId: 128, key: 80, rigId: 128, slot: 80,
};
const COORDS = new Set(["x", "y", "z", "rx", "ry", "rz", "sx", "sy", "sz", "depth", "planeY"]);

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function boundedJson(value, maxBytes = 12000) {
  const visit = (node, depth = 0) => {
    if (depth > 6) throw new Error("Nested command data exceeds the allowed depth.");
    if (node === null || typeof node === "boolean" || typeof node === "string") return;
    if (typeof node === "number") {
      if (!Number.isFinite(node)) throw new Error("Command data contains a non-finite number.");
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 1000) throw new Error("Command array is too large.");
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (!plainObject(node)) throw new Error("Command data must be plain JSON data.");
    const entries = Object.entries(node);
    if (entries.length > 100) throw new Error("Command object contains too many fields.");
    for (const [key, item] of entries) {
      if (!key || key.length > 100 || ["__proto__", "prototype", "constructor"].includes(key)) {
        throw new Error("Command data contains an unsafe property name.");
      }
      visit(item, depth + 1);
    }
  };
  visit(value);
  if (JSON.stringify(value).length > maxBytes) throw new Error("Command data exceeds the size limit.");
}

function requireString(value, field, max = STRING_RULES[field] || 120) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(field + " must be a non-empty string of at most " + max + " characters.");
  }
  return value.trim();
}

function requireNumber(value, field, {min = -100000, max = 100000, integer = false} = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(field + " is outside its permitted numeric range.");
  }
  return value;
}

function validatePoint(value, field) {
  if (Array.isArray(value)) {
    if (value.length < 2 || value.length > 3) throw new Error(field + " must contain two or three coordinates.");
    return value.map((n, i) => requireNumber(n, field + "[" + i + "]"));
  }
  if (plainObject(value)) {
    const keys = Object.keys(value);
    if (keys.some(k => !["x", "y", "z"].includes(k)) || !("x" in value) || !("y" in value)) {
      throw new Error(field + " must contain only x, y and optional z.");
    }
    return Object.fromEntries(keys.map(k => [k, requireNumber(value[k], field + "." + k)]));
  }
  throw new Error(field + " must be a coordinate array or object.");
}

export function normalizeForgeCommand(input) {
  if (!plainObject(input)) throw new Error("Forge command must be a JSON object.");
  const op = requireString(input.op, "op", 48);
  if (!Object.prototype.hasOwnProperty.call(OPS, op)) throw new Error("Unsupported Forge command: " + op);
  const allowed = new Set(["op", ...OPS[op]]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error("Unsupported field for " + op + ": " + key);
  }
  const result = { op };
  for (const key of OPS[op]) {
    if (!(key in input) || input[key] === undefined) continue;
    const value = input[key];
    if (key === "options" || key === "data") {
      boundedJson(value, key === "data" ? 50000 : 12000);
      result[key] = value;
    } else if (key === "start" || key === "goal") {
      result[key] = validatePoint(value, key);
    } else if (COORDS.has(key)) {
      const n = requireNumber(value, key, {min: -100000, max: 100000});
      if (key.startsWith("s") && n <= 0) throw new Error(key + " must be greater than zero.");
      result[key] = n;
    } else if (key === "seed") {
      result[key] = requireNumber(value, key, {min: -2147483647, max: 2147483647, integer: true});
    } else if (key === "count") {
      result[key] = requireNumber(value, key, {min: 1, max: 500, integer: true});
    } else if (key === "area") {
      result[key] = requireNumber(value, key, {min: 1, max: 10000});
    } else if (key === "value") {
      if (typeof value === "string") result[key] = requireString(value, key, 500);
      else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
      else if (typeof value === "boolean") result[key] = value;
      else throw new Error("value must be a string, finite number, or boolean.");
    } else if (key === "mode") {
      if (!["none", "dynamic", "fixed", "kinematic"].includes(value)) throw new Error("mode is not supported.");
      result[key] = value;
    } else if (key === "shape") {
      if (!["box", "ball", "capsule"].includes(value)) throw new Error("physics shape is not supported.");
      result[key] = value;
    } else if (key === "kind" && op === "create") {
      if (!["box", "sphere", "cylinder", "capsule", "plane", "light", "camera", "cone", "torus"].includes(value)) {
        throw new Error("Create kind is not supported.");
      }
      result[key] = value;
    } else if (key === "kind" && op === "pcg") {
      if (!["trees", "rocks", "buildings", "vegetation"].includes(value)) throw new Error("PCG kind is not supported.");
      result[key] = value;
    } else if (key === "preset") {
      const presets = ["dissolve", "toon", "unlit", "glass", "metal", "outline", "hologram", "water"];
      result[key] = requireString(value, key, 60);
      if (!presets.includes(result[key])) throw new Error("Shader preset is not supported.");
    } else {
      result[key] = requireString(value, key);
    }
  }
  if (["inspect", "select", "physics", "duplicate", "delete", "transform", "animation-state"].includes(op) && !result.id && !result.name) {
    throw new Error(op + " requires a stable id or name.");
  }
  if (op === "create" && !result.kind) result.kind = "box";
  if (op === "transform" && !["x","y","z","rx","ry","rz","sx","sy","sz"].some(key => key in result)) {
    throw new Error("transform requires at least one transform field.");
  }
  if (op === "physics" && !result.mode) throw new Error("physics requires mode.");
  if (op === "nav-path" && (!result.start || !result.goal)) throw new Error("nav-path requires both start and goal.");
  if (op === "animation-graph-param" && !("value" in result)) throw new Error("animation-graph-param requires value.");
  if (op === "terrain-generate") boundedJson(result.options || {}, 12000);
  boundedJson(result, 55000);
  return result;
}

export const forgeCommandOperations = Object.keys(OPS);
