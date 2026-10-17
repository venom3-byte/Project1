const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let rustExports = null;
let rustReady = null;

function outputToJson(packed) {
  const value = BigInt(packed);
  const pointer = Number((value >> 32n) & 0xffff_ffffn);
  const length = Number(value & 0xffff_ffffn);
  if (!pointer || !length) throw new Error("Forge Eye Rust core returned an empty payload.");
  const json = textDecoder.decode(new Uint8Array(rustExports.memory.buffer, pointer, length));
  rustExports.forge_eye_free_output(pointer, length);
  const result = JSON.parse(json);
  if (!result.ok) throw new Error(result.error || "Rust core rejected the request.");
  return result;
}

function callJson(exportName, value) {
  if (!rustExports) throw new Error("Forge Eye Rust WebAssembly core is not initialized.");
  const bytes = textEncoder.encode(JSON.stringify(value));
  const pointer = rustExports.forge_eye_alloc(bytes.length);
  if (!pointer) throw new Error("Could not allocate memory for the Rust geometry request.");
  new Uint8Array(rustExports.memory.buffer, pointer, bytes.length).set(bytes);
  let packed;
  try {
    packed = rustExports[exportName](pointer, bytes.length);
  } finally {
    rustExports.forge_eye_dealloc(pointer, bytes.length);
  }
  return outputToJson(packed);
}

/**
 * Load the pure Rust/WASM kernel. It has no browser imports: the bridge owns the
 * small JSON ABI so the same geometry code can be tested natively and used on web.
 */
export async function initForgeEyeCore(url = "./forge_eye_core.wasm.gz") {
  if (rustReady) return rustReady;
  rustReady = (async () => {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error("Rust WASM returned HTTP " + response.status + ": " + url);
    let result;
    if (url.endsWith(".gz")) {
      if (typeof DecompressionStream !== "function") throw new Error("This browser lacks DecompressionStream required for the compact Rust WASM artifact.");
      const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
      result = await WebAssembly.instantiate(await new Response(stream).arrayBuffer(), {});
    } else {
      try {
        result = await WebAssembly.instantiateStreaming(response.clone(), {});
      } catch {
        result = await WebAssembly.instantiate(await response.arrayBuffer(), {});
      }
    }
    rustExports = result.instance?.exports || result.exports;
    for (const name of ["memory", "forge_eye_alloc", "forge_eye_dealloc", "forge_eye_free_output", "forge_eye_lathe_json", "forge_eye_animation_json"]) {
      if (!(name in rustExports)) throw new Error("Rust WASM is missing exported symbol: " + name);
    }
    return {
      version: () => Number(rustExports.forge_eye_version()).toString(16),
      latheMesh: (profile, options = {}) => callJson("forge_eye_lathe_json", {
        profile,
        options: { radial_segments: 64, profile_subdivisions: 1, cap_ends: true, axis: "y", ...options }
      }).mesh,
      evaluateAnimation: (track, frame) => callJson("forge_eye_animation_json", { track, frame }).transform,
      rawExports: () => rustExports,
    };
  })();
  try { return await rustReady; }
  catch (error) { rustReady = null; throw error; }
}
