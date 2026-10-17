#!/usr/bin/env node
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shippedPath = path.resolve(process.argv[2] || path.join(root, "public/forge-eye/forge_eye_core.wasm.gz"));
const builtPath = path.resolve(process.argv[3] || path.join(root, "target/wasm32-unknown-unknown/release/forge_eye_core.wasm"));
const required = [
  "memory", "forge_eye_alloc", "forge_eye_dealloc", "forge_eye_free_output",
  "forge_eye_version", "forge_eye_lathe_json", "forge_eye_animation_json",
  "forge_eye_visual_hull_json",
];

function assert(value, message) {
  if (!value) throw new Error(message);
}

function testGeometryAbi(exports, label) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const square = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
  const request = {
    front_contour: square,
    side_contour: square,
    top_contour: square.map(([x, y]) => [0.2 + x * 0.6, 0.2 + y * 0.6]),
    options: { width: 3, height: 2, depth: 4, resolution: 16 },
  };
  const bytes = encoder.encode(JSON.stringify(request));
  const pointer = exports.forge_eye_alloc(bytes.length);
  assert(pointer, label + ": input allocation failed");
  new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
  let packed;
  try {
    packed = exports.forge_eye_visual_hull_json(pointer, bytes.length);
  } finally {
    exports.forge_eye_dealloc(pointer, bytes.length);
  }
  assert(typeof packed === "bigint", label + ": visual-hull ABI did not return packed u64");
  const outputPointer = Number((packed >> 32n) & 0xffff_ffffn);
  const outputLength = Number(packed & 0xffff_ffffn);
  assert(outputPointer && outputLength, label + ": empty visual-hull response");
  let response;
  try {
    response = JSON.parse(decoder.decode(new Uint8Array(exports.memory.buffer, outputPointer, outputLength)));
  } finally {
    exports.forge_eye_free_output(outputPointer, outputLength);
  }
  assert(response.ok === true, label + ": visual-hull request rejected: " + (response.error || "unknown error"));
  assert(response.view_count === 3 && response.resolution === 16, label + ": wrong view count or resolution");
  assert(response.occupied_voxels > 0, label + ": no occupied voxels");
  assert(response.mesh?.positions?.length > 100, label + ": mesh vertices missing");
  assert(response.mesh?.normals?.length === response.mesh.positions.length, label + ": normals are incomplete");
  assert(response.mesh?.indices?.length >= 300, label + ": triangles missing");
  assert(response.mesh.positions.every(point => point.every(Number.isFinite)), label + ": non-finite vertices");
  assert(response.mesh.normals.every(normal => normal.every(Number.isFinite)), label + ": non-finite normals");
  assert(response.mesh.indices.every(index => Number.isInteger(index) && index >= 0 && index < response.mesh.positions.length), label + ": invalid triangle index");
  return { viewCount: response.view_count, resolution: response.resolution, voxels: response.occupied_voxels,
    vertices: response.mesh.positions.length, triangles: response.mesh.indices.length / 3 };
}

async function loadAndValidate(bytes, label) {
  const module = await WebAssembly.compile(bytes);
  const names = WebAssembly.Module.exports(module).map(item => item.name).sort();
  for (const name of required) assert(names.includes(name), label + ": missing WASM export " + name);
  const { instance } = await WebAssembly.instantiate(module, {});
  const exports = instance.exports;
  assert(exports.forge_eye_version() === 0x0001_0000, label + ": unexpected ABI version");
  const mesh = testGeometryAbi(exports, label);
  return { exports: names, abiVersion: exports.forge_eye_version().toString(16), mesh };
}

async function main() {
  const shippedBytes = zlib.gunzipSync(fs.readFileSync(shippedPath));
  const shipped = await loadAndValidate(shippedBytes, "packaged WASM");
  let built = null;
  if (fs.existsSync(builtPath)) {
    built = await loadAndValidate(fs.readFileSync(builtPath), "fresh Rust build");
    assert(JSON.stringify(shipped.exports) === JSON.stringify(built.exports),
      "Packaged WASM exports do not match the current Rust build contract.");
    assert(shipped.abiVersion === built.abiVersion, "Packaged WASM ABI version differs from the current Rust build.");
  }
  const report = { ok: true, shippedPath, shippedBytes: shippedBytes.byteLength, shipped, built };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error("[Forge Eye WASM validation failed]", error?.stack || error);
  process.exitCode = 1;
});
