const SLOT_DEFS = {
  front: { label: "Front", view: "front", rotation: [90, 0, 0], position: [0, 0, -0.12] },
  side:  { label: "Side", view: "right", rotation: [0, 90, 90], position: [-0.12, 0, 0] },
  top:   { label: "Top", view: "top", rotation: [0, 0, 0], position: [0, -0.12, 0] }
};
const DB_NAME = "forge-reference-images-v1";
const DB_STORE = "images";
const SETTINGS_KEY = "forge.referenceStudio.settings.v1";
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const DEFAULTS = { width: 10, opacity: 0.48, offset: 0, visible: true };

let engine = null;
let helperRoot = null;
let installed = false;
let activeView = "perspective";
let isRunning = false;
let databasePromise = null;
let persistentStorage = false;
const images = new Map();
const settings = {};

function safeSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    for (const slot of Object.keys(SLOT_DEFS)) {
      const old = value[slot] || {};
      settings[slot] = {
        width: clamp(old.width ?? DEFAULTS.width, 0.25, 200),
        opacity: clamp(old.opacity ?? DEFAULTS.opacity, 0.05, 1),
        offset: clamp(old.offset ?? DEFAULTS.offset, -100, 100),
        visible: old.visible !== false
      };
    }
  } catch {
    for (const slot of Object.keys(SLOT_DEFS)) settings[slot] = { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    notify("Reference settings could not be saved in this browser.", true);
  }
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => {
      persistentStorage = true;
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("Could not open reference storage"));
    request.onblocked = () => reject(new Error("Reference storage is blocked by another tab"));
  });
  return databasePromise;
}

async function readStored(slot) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(slot);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read stored reference"));
  });
}

async function writeStored(slot, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).put(value, slot);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error("Could not save reference image"));
    transaction.onabort = () => reject(transaction.error || new Error("Reference image save was cancelled"));
  });
}

async function deleteStored(slot) {
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).delete(slot);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // The image may still be removed from the current session when storage is unavailable.
  }
}

function notify(message, isError = false) {
  const node = document.getElementById("referenceNotice");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", Boolean(isError));
  node.classList.add("visible");
}

function getOrCreateRoot() {
  if (helperRoot && !helperRoot.destroyed) return helperRoot;
  helperRoot = new window.ForgePlayCanvas.Entity("Forge Reference Guides");
  helperRoot.enabled = true;
  engine.app.root.addChild(helperRoot);
  return helperRoot;
}

function disposeImageResources(record, destroyEntity = false) {
  if (!record) return;
  if (record.previewUrl) URL.revokeObjectURL(record.previewUrl);
  if (record.material && typeof record.material.destroy === "function") record.material.destroy();
  if (record.texture && typeof record.texture.destroy === "function") record.texture.destroy();
  if (destroyEntity && record.entity && !record.entity.destroyed) record.entity.destroy();
}

function createGuideEntity(slot) {
  const pc = window.ForgePlayCanvas;
  const def = SLOT_DEFS[slot];
  const entity = new pc.Entity("Reference - " + def.label);
  entity.addComponent("render", { type: "plane" });
  entity.render.layers = [pc.LAYERID_WORLD];
  entity.render.castShadows = false;
  entity.render.receiveShadows = false;
  entity.render.frustumCulling = false;
  getOrCreateRoot().addChild(entity);
  return entity;
}

function createReferenceMaterial(canvas, opacity) {
  const pc = window.ForgePlayCanvas;
  const texture = new pc.Texture(engine.app.graphicsDevice, {
    width: canvas.width,
    height: canvas.height,
    format: pc.PIXELFORMAT_R8_G8_B8_A8,
    mipmaps: true
  });
  texture.setSource(canvas);
  texture.minFilter = pc.FILTER_LINEAR;
  texture.magFilter = pc.FILTER_LINEAR;
  texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;

  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(1, 1, 1);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveIntensity = 1;
  material.diffuseMap = texture;
  material.emissiveMap = texture;
  material.useLighting = false;
  material.useMetalness = false;
  material.opacity = opacity;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.depthTest = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return { texture, material };
}

async function applyImage(slot, blob, name, options = {}) {
  if (!engine || !engine.app || !blob) throw new Error("The Forge renderer is not ready.");
  if (blob.size > MAX_FILE_BYTES) throw new Error("Choose an image smaller than 30 MB.");
  if (!/^image\//i.test(blob.type || "")) throw new Error("Choose a PNG, JPEG, WebP, AVIF or SVG image.");

  const bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > MAX_PIXELS) {
    bitmap.close?.();
    throw new Error("This image is too large to use safely as a reference (over 64 megapixels).");
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    bitmap.close?.();
    throw new Error("The browser could not prepare this reference image.");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const old = images.get(slot);
  const cfg = settings[slot] || (settings[slot] = { ...DEFAULTS });
  const resources = createReferenceMaterial(canvas, cfg.opacity);
  const entity = old?.entity || createGuideEntity(slot);
  entity.name = "Reference - " + SLOT_DEFS[slot].label;
  entity.render.material = resources.material;
  entity.enabled = cfg.visible;
  const previewUrl = URL.createObjectURL(blob);
  const record = {
    blob,
    name: String(name || SLOT_DEFS[slot].label),
    widthPx: canvas.width,
    heightPx: canvas.height,
    aspect: canvas.width / Math.max(1, canvas.height),
    canvas,
    texture: resources.texture,
    material: resources.material,
    entity,
    previewUrl
  };
  images.set(slot, record);
  if (old) disposeImageResources(old, false);
  updateCard(slot);
  applyTransform(slot);
  syncVisibility();

  if (options.persist !== false) {
    try {
      await writeStored(slot, { blob, name: record.name, widthPx: record.widthPx, heightPx: record.heightPx });
      notify(SLOT_DEFS[slot].label + " reference loaded and saved in this browser.");
    } catch {
      persistentStorage = false;
      notify(SLOT_DEFS[slot].label + " reference loaded for this session; browser storage is unavailable.");
    }
  } else {
    notify(SLOT_DEFS[slot].label + " reference restored.");
  }
  return record;
}

function applyTransform(slot) {
  const record = images.get(slot);
  if (!record || !record.entity) return;
  const pc = window.ForgePlayCanvas;
  const def = SLOT_DEFS[slot];
  const cfg = settings[slot];
  const width = clamp(cfg.width, 0.25, 200);
  const height = width / Math.max(0.0001, record.aspect);
  const offset = clamp(cfg.offset, -100, 100);

  record.entity.setLocalEulerAngles(def.rotation[0], def.rotation[1], def.rotation[2]);
  record.entity.setLocalScale(width, 1, height);
  if (slot === "front") record.entity.setLocalPosition(0, offset, -0.12);
  else if (slot === "side") record.entity.setLocalPosition(-0.12, offset, 0);
  else record.entity.setLocalPosition(0, -0.12, offset);

  record.material.opacity = clamp(cfg.opacity, 0.05, 1);
  record.material.update();
  record.entity.render.enabled = true;
  syncVisibility();
}

function updateCard(slot) {
  const card = document.querySelector('[data-reference-slot="' + slot + '"]');
  if (!card) return;
  const record = images.get(slot);
  const preview = card.querySelector("[data-ref-preview]");
  const empty = card.querySelector("[data-ref-empty]");
  const info = card.querySelector("[data-ref-info]");
  const show = card.querySelector("[data-ref-show]");
  if (preview) {
    if (record) {
      preview.src = record.previewUrl;
      preview.alt = SLOT_DEFS[slot].label + " reference: " + record.name;
      preview.hidden = false;
    } else {
      preview.removeAttribute("src");
      preview.alt = "";
      preview.hidden = true;
    }
  }
  if (empty) empty.hidden = Boolean(record);
  if (info) {
    info.textContent = record
      ? record.name + " · " + record.widthPx + " × " + record.heightPx + " px · aspect " + record.aspect.toFixed(3)
      : "No image loaded";
  }
  if (show) {
    show.disabled = !record;
    show.textContent = settings[slot].visible ? "Hide" : "Show";
    show.classList.toggle("active", settings[slot].visible);
  }
  const width = card.querySelector("[data-ref-width]");
  const opacity = card.querySelector("[data-ref-opacity]");
  const offset = card.querySelector("[data-ref-offset]");
  if (width && document.activeElement !== width) width.value = String(settings[slot].width);
  if (opacity && document.activeElement !== opacity) opacity.value = String(settings[slot].opacity);
  if (offset && document.activeElement !== offset) offset.value = String(settings[slot].offset);
  card.classList.toggle("has-image", Boolean(record));
}

function syncVisibility() {
  if (helperRoot) helperRoot.enabled = !isRunning;
  for (const [slot, record] of images) {
    if (!record.entity) continue;
    const viewMatches =
      activeView === "perspective" ||
      (activeView === "front" && slot === "front") ||
      (activeView === "right" && slot === "side") ||
      (activeView === "top" && slot === "top");
    record.entity.enabled = !isRunning && settings[slot].visible && viewMatches;
  }
}

function setActiveView(mode) {
  activeView = mode || engine?.viewMode || "perspective";
  syncVisibility();
  return activeView;
}

function setRunning(value) {
  isRunning = Boolean(value);
  syncVisibility();
  return !isRunning;
}

async function restoreSavedImages() {
  for (const slot of Object.keys(SLOT_DEFS)) {
    try {
      const stored = await readStored(slot);
      if (stored?.blob) await applyImage(slot, stored.blob, stored.name, { persist: false });
    } catch {
      persistentStorage = false;
    }
  }
  for (const slot of Object.keys(SLOT_DEFS)) updateCard(slot);
}

function bindControls() {
  const dialog = document.getElementById("referenceDialog");
  const launchButton = document.getElementById("referenceStudio");
  launchButton?.addEventListener("click", () => {
    if (dialog && !dialog.open) dialog.showModal();
    launchButton.classList.toggle("active", Boolean(dialog?.open));
    for (const slot of Object.keys(SLOT_DEFS)) updateCard(slot);
  });

  for (const slot of Object.keys(SLOT_DEFS)) {
    const card = document.querySelector('[data-reference-slot="' + slot + '"]');
    if (!card) continue;

    card.querySelector("[data-ref-pick]")?.addEventListener("click", () => {
      card.querySelector("[data-ref-file]")?.click();
    });
    card.querySelector("[data-ref-file]")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        await applyImage(slot, file, file.name);
      } catch (error) {
        notify((SLOT_DEFS[slot].label || "Reference") + ": " + (error?.message || String(error)), true);
      }
    });

    for (const control of [
      ["[data-ref-width]", "width", 0.25, 200],
      ["[data-ref-opacity]", "opacity", 0.05, 1],
      ["[data-ref-offset]", "offset", -100, 100]
    ]) {
      const node = card.querySelector(control[0]);
      if (!node) continue;
      const change = () => {
        settings[slot][control[1]] = clamp(node.value, control[2], control[3]);
        applyTransform(slot);
        updateCard(slot);
        saveSettings();
      };
      node.addEventListener("input", change);
      node.addEventListener("change", change);
    }

    card.querySelector("[data-ref-show]")?.addEventListener("click", () => {
      if (!images.has(slot)) return;
      settings[slot].visible = !settings[slot].visible;
      saveSettings();
      updateCard(slot);
      syncVisibility();
    });
    card.querySelector("[data-ref-align]")?.addEventListener("click", () => {
      const viewButton = document.querySelector('[data-view="' + SLOT_DEFS[slot].view + '"]');
      if (viewButton) viewButton.click();
      else {
        engine?.setView?.(SLOT_DEFS[slot].view);
        setActiveView(SLOT_DEFS[slot].view);
      }
      if (dialog?.open) dialog.close();
    });
    card.querySelector("[data-ref-remove]")?.addEventListener("click", async () => {
      const record = images.get(slot);
      if (record) disposeImageResources(record, true);
      images.delete(slot);
      settings[slot] = { ...DEFAULTS };
      saveSettings();
      await deleteStored(slot);
      updateCard(slot);
      syncVisibility();
      notify(SLOT_DEFS[slot].label + " reference removed.");
    });
  }

  document.getElementById("referenceClearAll")?.addEventListener("click", async () => {
    for (const slot of Object.keys(SLOT_DEFS)) {
      const record = images.get(slot);
      if (record) disposeImageResources(record, true);
      images.delete(slot);
      settings[slot] = { ...DEFAULTS };
      await deleteStored(slot);
      updateCard(slot);
    }
    saveSettings();
    syncVisibility();
    notify("All reference images removed.");
  });

  dialog?.addEventListener("close", () => {
    document.getElementById("referenceStudio")?.classList.remove("active");
  });
  dialog?.addEventListener("close", () => {
    if (document.getElementById("referenceNotice")) {
      document.getElementById("referenceNotice").classList.remove("visible");
    }
  });
}

function diagnostics() {
  const dialog = document.getElementById("referenceDialog");
  const button = document.getElementById("referenceStudio");
  return {
    ok: Boolean(installed && engine?.app?.graphicsDevice && helperRoot && dialog && button),
    installed,
    rendererReady: Boolean(engine?.app?.graphicsDevice),
    helperRoot: Boolean(helperRoot),
    dialog: Boolean(dialog),
    launchButton: Boolean(button),
    slotCount: Object.keys(SLOT_DEFS).length,
    loadedImages: images.size,
    loadedSlots: [...images.keys()],
    persistentStorage,
    activeView,
    hiddenDuringPlay: isRunning,
    exportSafe: true
  };
}

function install(forgeEngine) {
  if (installed) return api;
  if (!forgeEngine?.app || !window.ForgePlayCanvas) return api;
  engine = forgeEngine;
  safeSettings();
  getOrCreateRoot();
  bindControls();
  installed = true;
  window.addEventListener("forge-reference-view", (event) => setActiveView(event.detail));
  restoreSavedImages().catch(() => {
    persistentStorage = false;
  });
  syncVisibility();
  return api;
}

const api = { install, open: () => document.getElementById("referenceDialog")?.showModal(), setActiveView, setRunning, diagnostics };
window.ForgeReferenceStudio = api;
if (window.Forge?.app && window.ForgePlayCanvas) install(window.Forge);
