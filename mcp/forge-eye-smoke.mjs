#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import Chromium from "@sparticuz/chromium";
import { chromium } from "playwright-core";

const URL_TO_TEST = process.env.FORGE_EYE_URL || "http://127.0.0.1:4174/forge-eye/index.html";
const ARTIFACTS = process.env.FORGE_EYE_ARTIFACTS || path.resolve("artifacts/forge-eye");
const allowedHosts = new Set(["127.0.0.1", "localhost", "forge-studio.forgemail-agent.workers.dev"]);
if (!allowedHosts.has(new URL(URL_TO_TEST).hostname)) {
  throw new Error("Forge Eye smoke tests only accept localhost or the isolated public Forge Eye preview.");
}
await fs.mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: await Chromium.executablePath(),
  args: Chromium.args,
  timeout: 60000
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const report = { ok: false, url: URL_TO_TEST, checks: [], pageErrors, consoleErrors, failedRequests };
page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));
page.on("console", message => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 600));
});
page.on("requestfailed", request => {
  failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "request failed" });
});
const record = (name, details = {}) => {
  report.checks.push({ name, ...details });
  console.log("[Forge Eye QA]", name, JSON.stringify(details));
};
const setInput = async (selector, value) => {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};
const sceneSnapshot = () => page.evaluate(() => ({
  selectedId: window.ForgeEyeState?.scene?.selected_id ?? null,
  objects: Object.values(window.ForgeEyeState?.scene?.objects || {}).map(object => ({
    id: object.id, name: object.name, kind: object.kind?.type,
    primitive: object.kind?.primitive || null, mesh: !!object.mesh,
    vertices: object.mesh?.diagnostics?.vertex_count || 0,
    triangles: object.mesh?.diagnostics?.triangle_count || 0,
    method: object.mesh?.diagnostics?.method || null,
    viewCount: object.mesh?.diagnostics?.view_count || 0,
    occupiedVoxels: object.mesh?.diagnostics?.occupied_voxels || 0
  })),
  references: Object.fromEntries(Object.entries(window.ForgeEyeState?.references || {}).map(([axis, ref]) => [
    axis, ref ? { id: ref.id, name: ref.name, width: ref.width, height: ref.height, outlinePoints: ref.outline?.length || 0 } : null
  ])),
  timeline: window.ForgeEyeState?.scene?.timeline || null
}));
async function createReference(axis, width, pixelWidth, pixelHeight, filename) {
  await page.locator("#referenceView").selectOption(axis);
  await page.locator("#referenceWidth").fill(String(width));
  const encoded = await page.evaluate(({ w, h }) => {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext("2d");
    context.fillStyle = "#d9dfe3"; context.fillRect(0, 0, w, h);
    context.fillStyle = "#384c5b"; context.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
    context.fillStyle = "#91bad0"; context.fillRect(w * 0.36, h * 0.34, w * 0.28, h * 0.32);
    return canvas.toDataURL("image/png").split(",")[1];
  }, { w: pixelWidth, h: pixelHeight });
  await page.locator("#referenceInput").setInputFiles({
    name: filename, mimeType: "image/png", buffer: Buffer.from(encoded, "base64")
  });
  await page.waitForFunction(a => !!window.ForgeEyeState?.references?.[a], axis, { timeout: 10000 });
  const reference = await page.evaluate(a => {
    const ref = window.ForgeEyeState.references[a];
    return { axis: ref.axis, width: ref.width, height: ref.height, hasDataUrl: ref.dataUrl.startsWith("data:image/") };
  }, axis);
  assert.equal(reference.axis, axis);
  assert.ok(reference.height > 0);
  assert.equal(reference.hasDataUrl, true);
  record("reference imported and calibrated", { axis, ...reference });
}
async function traceActiveReference(axis) {
  await page.locator("#referenceView").selectOption(axis);
  await page.locator("#traceReference").click();
  await page.waitForFunction(() => document.querySelector("#traceDialog")?.open === true, null, { timeout: 5000 });
  const rect = await page.locator("#traceCanvas").boundingBox();
  assert.ok(rect && rect.width > 100 && rect.height > 100, "Reference contour canvas must be usable on this viewport.");
  for (const [u, v] of [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]) {
    await page.mouse.click(rect.x + rect.width * u, rect.y + rect.height * v);
  }
  await page.locator("#saveTraceOutline").click();
  await page.waitForFunction(a => (window.ForgeEyeState.references[a]?.outline?.length || 0) === 4, axis, { timeout: 5000 });
  const count = await page.evaluate(a => window.ForgeEyeState.references[a].outline.length, axis);
  assert.equal(count, 4);
  await page.locator("#closeTrace").click();
  await page.waitForFunction(() => document.querySelector("#traceDialog")?.open === false, null, { timeout: 5000 });
  record("contour traced and validated by Rust", { axis, points: count });
}
try {
  const response = await page.goto(URL_TO_TEST, { waitUntil: "domcontentloaded", timeout: 60000 });
  assert.ok(response && response.status() === 200, "Forge Eye must return HTTP 200.");
  await page.waitForFunction(() => window.ForgeEyeReady === true, null, { timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.forgeEye === "ready", null, { timeout: 10000 });
  const boot = await page.evaluate(() => ({
    title: document.title,
    status: document.querySelector("#statusText")?.textContent || "",
    rustVersion: document.querySelector("#rustBadge")?.textContent || "",
    canvas: (() => {
      const box = document.querySelector("#viewport")?.getBoundingClientRect();
      return { width: Math.round(box?.width || 0), height: Math.round(box?.height || 0) };
    })(),
    workspaces: [...document.querySelectorAll("[data-workspace]")].map(button => button.dataset.workspace),
    rootOverflow: document.documentElement.scrollWidth - innerWidth
  }));
  assert.match(boot.rustVersion, /Forge Eye Rust Core/);
  assert.ok(boot.canvas.width > 400 && boot.canvas.height > 300, "3D viewport must be visible.");
  assert.deepEqual(boot.workspaces, ["scene", "spin", "image", "animation", "assets"]);
  assert.equal(boot.rootOverflow, 0);
  record("Rust/WASM boot", boot);
  const initial = await sceneSnapshot();
  assert.equal(initial.objects.length, 1);
  assert.equal(initial.objects[0].primitive, "cube");
  const initialObjectCount = initial.objects.length;

  // Rust-owned scene commands: create, transform, material and command history.
  await page.locator('[data-create-primitive="sphere"]').click();
  await page.waitForFunction(() => Object.values(window.ForgeEyeState.scene.objects).some(o => o.kind?.primitive === "sphere"), null, { timeout: 10000 });
  let scene = await sceneSnapshot();
  const sphereId = scene.selectedId;
  assert.equal(scene.objects.length, initialObjectCount + 1);
  await page.locator("#px").fill("2.25");
  await page.locator("#py").fill("1.5");
  await page.locator("#applyTransform").click();
  await page.waitForFunction(id => {
    const t = window.ForgeEyeState.scene.objects[String(id)]?.transform?.position;
    return t && Math.abs(t[0] - 2.25) < 0.001 && Math.abs(t[1] - 1.5) < 0.001;
  }, sphereId, { timeout: 10000 });
  await page.locator("#undoBtn").click();
  await page.waitForFunction(id => {
    const t = window.ForgeEyeState.scene.objects[String(id)]?.transform?.position;
    return t && Math.abs(t[0]) < 0.001 && Math.abs(t[1]) < 0.001;
  }, sphereId, { timeout: 10000 });
  await page.locator("#redoBtn").click();
  await page.waitForFunction(id => Math.abs(window.ForgeEyeState.scene.objects[String(id)].transform.position[0] - 2.25) < 0.001, sphereId, { timeout: 10000 });
  await setInput("#materialColor", "#2f8aff");
  await setInput("#metalness", "0.85");
  await setInput("#roughness", "0.22");
  await page.locator("#applyMaterial").click();
  const material = await page.evaluate(id => window.ForgeEyeState.scene.objects[String(id)].material, sphereId);
  assert.ok(Math.abs(material.metalness - 0.85) < 0.02);
  assert.ok(Math.abs(material.roughness - 0.22) < 0.02);
  assert.ok(material.base_color[2] > 0.8);
  record("Rust scene commands, transform history and material", { sphereId, transform: await page.evaluate(id => window.ForgeEyeState.scene.objects[String(id)].transform, sphereId), material });

  // Actual Rust geometry, based on the bottle-profile workflow demonstrated in Blender.
  await page.locator('[data-workspace="spin"]').click();
  await page.locator("#spinSegments").fill("32");
  await setInput("#spinSubdivision", "2");
  await page.locator("#buildSpin").click();
  await page.waitForFunction(() => Object.values(window.ForgeEyeState.scene.objects).some(o => o.mesh?.diagnostics?.triangle_count > 100), null, { timeout: 20000 });
  scene = await sceneSnapshot();
  const spinMesh = scene.objects.find(o => o.method?.includes("spin / lathe"));
  assert.ok(spinMesh, "Spin profile must create a Rust-generated 3D mesh.");
  assert.ok(spinMesh.vertices > 1000 && spinMesh.triangles > 100);
  record("one-click spin / lathe mesh", spinMesh);
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-spin.png"), fullPage: true });

  // Image references: front, side and top, calibrated dimensions, contours, and a 3-view Rust visual hull.
  await page.locator('[data-workspace="image"]').click();
  await createReference("front", 3, 96, 64, "qa-front.png");
  await traceActiveReference("front");
  await createReference("side", 3, 96, 64, "qa-side.png");
  await traceActiveReference("side");
  await createReference("top", 3, 64, 64, "qa-top.png");
  await traceActiveReference("top");
  await page.locator("#hullWidth").fill("3");
  await page.locator("#hullHeight").fill("2");
  await page.locator("#hullDepth").fill("3");
  await page.locator("#hullResolution").selectOption("12");
  await page.locator("#buildVisualHull").click();
  await page.waitForFunction(() => Object.values(window.ForgeEyeState.scene.objects).some(o => o.mesh?.diagnostics?.method === "three-view voxel visual hull"), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("#hullResult")?.dataset.state === "success", null, { timeout: 10000 });
  scene = await sceneSnapshot();
  const hull = scene.objects.find(o => o.method === "three-view voxel visual hull");
  assert.ok(hull && hull.vertices > 0 && hull.triangles > 0 && hull.occupiedVoxels > 0);
  assert.equal(hull.viewCount, 3);
  assert.match(await page.locator("#hullResult").textContent(), /vertices.*triangles/i);
  record("3-view silhouette → visual hull", hull);
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-three-view-hull.png"), fullPage: true });

  // Dope Sheet and Graph Editor must reflect Rust keyframes, and graph point dragging must change a channel value.
  await page.locator('[data-workspace="animation"]').click();
  await page.locator("#currentFrame").fill("0");
  await page.locator("#currentFrame").press("Tab");
  await page.locator("#insertKey").click();
  const animatedId = await page.evaluate(() => window.ForgeEyeState.scene.selected_id);
  await page.locator("#currentFrame").fill("24");
  await page.locator("#currentFrame").press("Tab");
  await page.locator("#px").fill("4");
  await page.locator("#applyTransform").click();
  await page.locator("#insertKey").click();
  const keyCount = await page.evaluate(id => window.ForgeEyeState.scene.objects[String(id)].keyframes.length, animatedId);
  assert.ok(keyCount >= 2, "Rust animation model must keep both keyframes.");
  await page.locator('[data-animation-view="graph"]').click();
  await page.waitForFunction(() => !document.querySelector("#graphPane").hidden && !!document.querySelector("#graphCanvas").__metrics, null, { timeout: 10000 });
  const beforeDrag = await page.evaluate(id => {
    const obj = window.ForgeEyeState.scene.objects[String(id)];
    const key = obj.keyframes.find(k => k.frame === 24);
    const canvas = document.querySelector("#graphCanvas"), metrics = canvas.__metrics;
    return { value: key?.transform.position[0], x: metrics.x(24), y: metrics.y(key?.transform.position[0]) };
  }, animatedId);
  assert.ok(Number.isFinite(beforeDrag.value));
  const graphRect = await page.locator("#graphCanvas").boundingBox();
  await page.mouse.move(graphRect.x + beforeDrag.x, graphRect.y + beforeDrag.y);
  await page.mouse.down();
  await page.mouse.move(graphRect.x + beforeDrag.x, graphRect.y + beforeDrag.y + 12, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(({ id, previous }) => {
    const key = window.ForgeEyeState.scene.objects[String(id)].keyframes.find(k => k.frame === 24);
    return key && Math.abs(key.transform.position[0] - previous) > 0.01;
  }, { id: animatedId, previous: beforeDrag.value }, { timeout: 10000 });
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-graph-editor.png"), fullPage: true });
  record("Graph Editor edits Rust keyframe values", { animatedId, before: beforeDrag });
  await page.locator('[data-animation-view="dope"]').click();
  await page.waitForFunction(() => !document.querySelector("#dopePane").hidden && document.querySelector("#graphPane").hidden, null, { timeout: 5000 });

  // The saved package must include the Rust scene, generated meshes and reference data; it must reload cleanly.
  const downloadWait = page.waitForEvent("download");
  await page.locator("#saveProjectBtn").click();
  const download = await downloadWait;
  assert.match(download.suggestedFilename(), /\.forge-eye\.json$/);
  const projectPath = path.join(ARTIFACTS, download.suggestedFilename());
  await download.saveAs(projectPath);
  const packageData = JSON.parse(await fs.readFile(projectPath, "utf8"));
  assert.equal(packageData.format, "forge-eye-project");
  assert.ok(Object.values(packageData.scene.objects).some(o => o.mesh?.diagnostics?.triangle_count > 100));
  assert.ok(Object.values(packageData.references).every(ref => !ref || ref.outline?.length === 4));
  await page.locator("#projectInput").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: await fs.readFile(projectPath) });
  await page.waitForFunction(() => Object.values(window.ForgeEyeState.scene.objects).some(o => o.mesh?.diagnostics?.method === "three-view voxel visual hull"), null, { timeout: 20000 });
  await page.waitForFunction(() => window.ForgeEyeState.references.front?.outline?.length === 4 && window.ForgeEyeState.references.side?.outline?.length === 4 && window.ForgeEyeState.references.top?.outline?.length === 4, null, { timeout: 20000 });
  record("project save / reload round trip", { filename: download.suggestedFilename(), savedReferences: Object.values(packageData.references).filter(Boolean).length, savedMeshes: Object.values(packageData.scene.objects).filter(o => o.mesh).length });

  // Desktop and phone widths: no page-wide horizontal overflow; graph editor remains reachable.
  const mobileReports = [];
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(200);
    const mobile = await page.evaluate(() => ({
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      viewport: (() => { const r = document.querySelector("#viewport").getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height) }; })(),
      animationWorkspace: !!document.querySelector('[data-workspace="animation"]'),
      rootState: document.documentElement.dataset.forgeEye
    }));
    assert.ok(mobile.scrollWidth <= mobile.width, "Forge Eye page must not overflow horizontally on a phone: " + JSON.stringify(mobile));
    assert.ok(mobile.viewport.width > 200 && mobile.viewport.height > 160);
    await page.locator('[data-workspace="animation"]').click();
    await page.locator('[data-animation-view="graph"]').click();
    const graphMobile = await page.evaluate(() => {
      const canvas = document.querySelector("#graphCanvas"), r = canvas.getBoundingClientRect();
      return { visible: !document.querySelector("#graphPane").hidden, width: Math.round(r.width), height: Math.round(r.height), metrics: !!canvas.__metrics };
    });
    assert.ok(graphMobile.visible && graphMobile.width > 200 && graphMobile.height > 80 && graphMobile.metrics);
    mobileReports.push({ ...mobile, graphMobile });
    await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-mobile-" + width + ".png"), fullPage: true });
  }
  record("phone responsive checks", { mobileReports });
  assert.equal(pageErrors.length, 0, "Browser page errors: " + pageErrors.join("\n"));
  assert.equal(consoleErrors.length, 0, "Browser console errors: " + consoleErrors.join("\n"));
  assert.equal(failedRequests.length, 0, "Failed network requests: " + JSON.stringify(failedRequests));
  report.ok = true;
  report.mobileReports = mobileReports;
  report.finalScene = await sceneSnapshot();
} catch (error) {
  report.error = String(error?.stack || error);
  console.error("[Forge Eye QA FAILED]", report.error);
  try { await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-failure.png"), fullPage: true }); } catch {}
  process.exitCode = 1;
} finally {
  report.pageErrors = pageErrors;
  report.consoleErrors = consoleErrors;
  report.failedRequests = failedRequests;
  await fs.writeFile(path.join(ARTIFACTS, "forge-eye-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
