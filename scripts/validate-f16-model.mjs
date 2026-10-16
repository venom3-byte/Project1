import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const objPath = join(root, "../assets/F16C_Block50.obj");
const mtlPath = join(root, "../assets/F16C_Block50.mtl");
const notesPath = join(root, "../docs/F16C_Block50_MODEL_NOTES.md");

function fail(message) {
  console.error("F-16 model validation FAILED:", message);
  process.exitCode = 1;
}

const [obj, mtl, notes] = await Promise.all([
  readFile(objPath, "utf8"),
  readFile(mtlPath, "utf8"),
  readFile(notesPath, "utf8"),
]);

const lines = obj.split(/\r?\n/);
const vertices = [];
const faces = [];
const objects = [];
const usedMaterials = new Set();
const errors = [];

let activeObject = "";
for (let lineNo = 0; lineNo < lines.length; lineNo++) {
  const line = lines[lineNo].trim();
  if (!line || line.startsWith("#")) continue;
  if (line.startsWith("o ")) {
    activeObject = line.slice(2).trim();
    objects.push(activeObject);
  } else if (line.startsWith("v ")) {
    const values = line.split(/\s+/).slice(1).map(Number);
    if (values.length !== 3 || values.some((n) => !Number.isFinite(n))) {
      errors.push(`line ${lineNo + 1}: malformed vertex`);
    } else {
      vertices.push(values);
    }
  } else if (line.startsWith("usemtl ")) {
    usedMaterials.add(line.slice(7).trim());
  } else if (line.startsWith("f ")) {
    const entries = line.split(/\s+/).slice(1);
    const indices = entries.map((entry) => Number(entry.split("/")[0]));
    if (indices.length < 3 || indices.some((n) => !Number.isInteger(n) || n < 1)) {
      errors.push(`line ${lineNo + 1}: malformed face indices`);
    }
    faces.push({ line: lineNo + 1, indices, object: activeObject });
  }
}

if (lines.length < 1000) errors.push("OBJ must be line-oriented; too few physical lines (possible literal \\n encoding).");
if (vertices.length < 4000) errors.push(`expected at least 4000 vertices; found ${vertices.length}`);
if (faces.length < 3000) errors.push(`expected at least 3000 faces; found ${faces.length}`);
if (objects.length < 140) errors.push(`expected at least 140 logical object groups; found ${objects.length}`);

for (const face of faces) {
  if (face.indices.some((index) => index > vertices.length)) {
    errors.push(`line ${face.line}: face index exceeds vertex count`);
    break;
  }
}

const materialNames = new Set(
  mtl.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("newmtl "))
    .map((line) => line.slice(7).trim()),
);
for (const name of usedMaterials) {
  if (!materialNames.has(name)) errors.push(`OBJ material has no MTL definition: ${name}`);
}
if (!/^mtllib\s+F16C_Block50\.mtl\s*$/m.test(obj)) errors.push("OBJ is missing the expected MTL library reference.");

const requiredGroups = [
  "Fuselage primary loft",
  "Port main wing upper skin",
  "Starboard main wing upper skin",
  "Bubble canopy glazing",
  "Instrument panel base",
  "Intake dark mouth",
  "Nose gear oleo",
  "F110 nozzle petal 0",
];
for (const name of requiredGroups) {
  if (!objects.includes(name)) errors.push(`missing required geometry group: ${name}`);
}

const bounds = vertices.reduce((b, v) => ({
  min: b.min.map((n, i) => Math.min(n, v[i])),
  max: b.max.map((n, i) => Math.max(n, v[i])),
}), {
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
});
const dimensions = bounds.max.map((value, i) => value - bounds.min[i]);
const near = (value, min, max) => value >= min && value <= max;
if (!near(dimensions[0], 14.6, 15.0)) errors.push(`length outside expected reference range: ${dimensions[0].toFixed(4)} m`);
if (!near(dimensions[1], 4.7, 4.9)) errors.push(`height outside expected reference range: ${dimensions[1].toFixed(4)} m`);
if (!near(dimensions[2], 9.7, 9.9)) errors.push(`span outside expected reference range: ${dimensions[2].toFixed(4)} m`);
if (!notes.includes("14.8 m") || !notes.includes("9.8 m") || !notes.includes("4.8 m")) {
  errors.push("model notes must record the reference length, span and height anchors.");
}

if (errors.length) {
  errors.forEach((message) => console.error(" -", message));
  fail(`${errors.length} problem(s) found.`);
} else {
  console.log(JSON.stringify({
    ok: true,
    file: "assets/F16C_Block50.obj",
    vertices: vertices.length,
    faces: faces.length,
    objectGroups: objects.length,
    materials: materialNames.size,
    dimensions_m: dimensions.map((n) => Number(n.toFixed(4))),
    bounds_m: {
      min: bounds.min.map((n) => Number(n.toFixed(4))),
      max: bounds.max.map((n) => Number(n.toFixed(4))),
    },
  }, null, 2));
}
