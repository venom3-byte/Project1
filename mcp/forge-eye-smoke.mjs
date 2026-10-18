#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import chromiumModule from "@sparticuz/chromium";
import { chromium } from "playwright-core";

const Chromium = chromiumModule.default || chromiumModule;
const URL_TO_TEST = process.env.FORGE_EYE_URL || "http://127.0.0.1:4173/forge-eye/index.html";
const ARTIFACTS = process.env.FORGE_EYE_ARTIFACTS || path.resolve("artifacts/forge-eye");
if (!["127.0.0.1", "localhost", "forge-studio.forgemail-agent.workers.dev"].includes(new URL(URL_TO_TEST).hostname)) {
  throw new Error("Forge Eye smoke test is restricted to local preview and the known public Forge Worker.");
}
await fs.mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: await Chromium.executablePath(),
  args: Chromium.args,
  timeout: 60000,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const pageErrors = [], consoleErrors = [], failedRequests = [];
page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 600)); });
page.on("requestfailed", request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "request failed" }));
let report;
try {
  const response = await page.goto(URL_TO_TEST, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!response || response.status() !== 200) throw new Error("Forge Eye HTML returned HTTP " + (response?.status() ?? "no response"));
  await page.waitForFunction(() => window.ForgeReady === true && window.ForgeBootState === "ready", null, { timeout: 60000 });
  await page.waitForFunction(() => !!window.ForgeEyeRust?.latheMesh && !!window.Forge?.entities, null, { timeout: 30000 });

  const initial = await page.evaluate(() => ({
    title: document.title,
    brand: document.querySelector(".brand-wordmark b")?.textContent,
    ready: window.ForgeReady === true,
    rustStatus: document.querySelector("#rustCoreStatus")?.textContent,
    rustReady: !!window.ForgeEyeRust?.latheMesh,
    wasmVersion: window.ForgeEyeRust?.version?.(),
    entities: window.Forge.entities.size,
    selected: window.Forge.selected()?.name,
    viewport: (() => { const r = document.querySelector("#viewport")?.getBoundingClientRect(); return { width: Math.round(r?.width || 0), height: Math.round(r?.height || 0) }; })(),
    workspaces: [...document.querySelectorAll("[data-workspace]")].map(x => x.dataset.workspace),
    duplicateIds: [...document.querySelectorAll("[id]")].map(x => x.id).filter((x, i, a) => a.indexOf(x) !== i),
    rootOverflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!initial.ready || !initial.rustReady || !/ready/i.test(initial.rustStatus || "")) throw new Error("Rust/WASM boot did not finish: " + JSON.stringify(initial));
  if (initial.entities < 4 || initial.viewport.width < 300 || initial.viewport.height < 250) throw new Error("3D workspace boot contract failed: " + JSON.stringify(initial));
  if (initial.duplicateIds.length || initial.rootOverflow !== 0) throw new Error("DOM invariant failed: " + JSON.stringify(initial));

  const rustLathe = await page.evaluate(() => {
    const profile = [
      { radius: 0, height: 0 }, { radius: .35, height: 0 },
      { radius: .45, height: .3 }, { radius: .18, height: .72 },
      { radius: .12, height: .9 }, { radius: 0, height: .92 },
    ];
    const mesh = window.ForgeEyeRust.latheMesh(profile, { radial_segments: 32, profile_subdivisions: 1, cap_ends: true, axis: "y" });
    const finite = mesh.positions.every(p => p.every(Number.isFinite)) && mesh.normals.every(n => n.every(Number.isFinite));
    const validIndices = mesh.indices.every(i => Number.isInteger(i) && i >= 0 && i < mesh.positions.length);
    return { vertices: mesh.positions.length, normals: mesh.normals.length, indices: mesh.indices.length, finite, validIndices, triangles: mesh.indices.length / 3 };
  });
  if (rustLathe.vertices < 50 || rustLathe.normals !== rustLathe.vertices || rustLathe.indices < 150 || !rustLathe.finite || !rustLathe.validIndices || !Number.isInteger(rustLathe.triangles)) {
    throw new Error("Rust/WASM geometry contract failed: " + JSON.stringify(rustLathe));
  }

  const evaluated = await page.evaluate(() => window.ForgeEyeRust.evaluateAnimation({ keys: [
    { frame: 0, transform: { location: [0, 0, 0], rotation_euler_deg: [0, 0, 0], scale: [1, 1, 1] }, interpolation: "linear" },
    { frame: 24, transform: { location: [3, 0, 0], rotation_euler_deg: [0, 0, 0], scale: [1, 1, 1] }, interpolation: "linear" },
  ] }, 12));
  if (Math.abs(evaluated.location[0] - 1.5) > .001) throw new Error("Rust/WASM animation evaluation failed: " + JSON.stringify(evaluated));

  // Exercise the in-editor one-click action, then the editable profile workflow.
  await page.locator('[data-workspace="references"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-inspector-panel="references"]').hidden, null, { timeout: 5000 });
  await page.locator("#createBottleQuick").click();
  await page.waitForFunction(() => window.Forge.selected()?.components?.geometry?.kind === "rust-lathe", null, { timeout: 10000 });
  const bottle = await page.evaluate(() => {
    const r = window.Forge.selected(), geometry = r.components.geometry, proc = r.components.procedural;
    const instance = r.entity.render?.meshInstances?.[0], mesh = instance?.mesh;
    return { name: r.name, kind: geometry?.kind, vertices: geometry?.vertexCount, triangles: geometry?.triangleCount,
      radialSegments: geometry?.radialSegments, authoredIn: proc?.authoredIn,
      rendered: !!instance, indexCount: mesh?.primitive?.[0]?.count || 0 };
  });
  if (bottle.kind !== "rust-lathe" || bottle.authoredIn !== "Rust/WebAssembly" || bottle.vertices < 100 || bottle.triangles < 100 || !bottle.rendered || bottle.indexCount < 300) {
    throw new Error("One-click Rust bottle was not built as a real rendered mesh: " + JSON.stringify(bottle));
  }
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-rust-bottle.png"), fullPage: true });

  await page.locator('[data-workspace="references"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-inspector-panel="references"]').hidden, null, { timeout: 5000 });
  await page.locator("#openLatheEditor").click();
  await page.waitForFunction(() => document.querySelector("#latheDialog").open, null, { timeout: 5000 });
  await page.locator("#lathePreset").selectOption("vase");
  await page.locator("#latheSegments").selectOption("48");
  await page.locator("#latheSmoothing").selectOption("2");
  await page.locator("#latheCreateMesh").click();
  await page.waitForFunction(() => window.Forge.selected()?.components?.geometry?.kind === "rust-lathe" && window.Forge.selected().components.procedural.options.radial_segments === 48, null, { timeout: 10000 });
  const editedLathe = await page.evaluate(() => {
    const r = window.Forge.selected();
    return { presetName: r.name, segmentCount: r.components.procedural.options.radial_segments,
      smoothing: r.components.procedural.options.profile_subdivisions,
      sourcePoints: r.components.procedural.profile.length,
      vertices: r.components.geometry.vertexCount,
      indices: r.entity.render?.meshInstances?.[0]?.mesh?.primitive?.[0]?.count || 0 };
  });
  if (editedLathe.segmentCount !== 48 || editedLathe.smoothing !== 2 || editedLathe.sourcePoints < 3 || editedLathe.vertices < 100 || editedLathe.indices < 300) {
    throw new Error("Editable Rust lathe workflow failed: " + JSON.stringify(editedLathe));
  }
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-profile-to-mesh.png"), fullPage: true });

  const rustVisualHull = await page.evaluate(() => {
    const square = (a, b) => [[a,a],[b,a],[b,b],[a,b]];
    const result = window.ForgeEyeRust.visualHullMesh(square(.1,.9), square(.1,.9), square(.25,.75), {
      width: 3, height: 2, depth: 4, resolution: 16
    });
    const mesh = result.mesh;
    return { viewCount: result.view_count, resolution: result.resolution, occupiedVoxels: result.occupied_voxels,
      vertices: mesh.positions.length, normals: mesh.normals.length, indices: mesh.indices.length,
      finite: mesh.positions.every(p => p.every(Number.isFinite)) && mesh.normals.every(n => n.every(Number.isFinite)),
      validIndices: mesh.indices.every(i => Number.isInteger(i) && i >= 0 && i < mesh.positions.length) };
  });
  if (rustVisualHull.viewCount !== 3 || rustVisualHull.resolution !== 16 || rustVisualHull.occupiedVoxels < 1 ||
      rustVisualHull.vertices < 100 || rustVisualHull.normals !== rustVisualHull.vertices || rustVisualHull.indices < 300 ||
      !rustVisualHull.finite || !rustVisualHull.validIndices) {
    throw new Error("Rust/WASM visual-hull ABI failed: " + JSON.stringify(rustVisualHull));
  }

  // Exercise the actual Image Model action with dimension-matched front, side and top reference metadata.
  await page.locator('[data-workspace="references"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-inspector-panel="references"]').hidden, null, { timeout: 5000 });
  await page.evaluate(() => {
    const square = (a, b) => [[a,a],[b,a],[b,b],[a,b]];
    const referenceSpecs = [
      {axis:"front",name:"QA front view",width:3,height:2,aspect:1.5,outline:square(.1,.9)},
      {axis:"side",name:"QA side view",width:4,height:2,aspect:2,outline:square(.1,.9)},
      {axis:"top",name:"QA top view",width:3,height:4,aspect:.75,outline:square(.2,.8)}
    ];
    for (const spec of referenceSpecs) {
      const record = window.Forge.primitive("plane", spec.name);
      record.components.asset = {type:"image",name:spec.name+".png",width:900,height:Math.round(900/spec.aspect)};
      record.components.reference = {...spec,opacity:.4,visible:true,locked:false};
    }
    window.dispatchEvent(new Event("forge-assets-changed"));
  });
  await page.locator("#hullResolution").selectOption("16");
  await page.locator("#buildSilhouetteHull").click();
  await page.waitForFunction(() => window.Forge.selected()?.components?.geometry?.kind === "rust-visual-hull", null, { timeout: 15000 });
  const builtHull = await page.evaluate(() => {
    const r=window.Forge.selected(),g=r.components.geometry,p=r.components.procedural,mesh=r.entity.render?.meshInstances?.[0]?.mesh;
    return {name:r.name,kind:g.kind,authoredIn:p?.authoredIn,generator:p?.generator,viewCount:g.viewCount,occupiedVoxels:g.occupiedVoxels,
      resolution:g.resolution,triangles:g.triangleCount,frontPoints:g.frontContour?.length||0,sidePoints:g.sideContour?.length||0,topPoints:g.topContour?.length||0,
      rendered:!!mesh,indexCount:mesh?.primitive?.[0]?.count||0};
  });
  if (builtHull.kind!=="rust-visual-hull" || builtHull.authoredIn!=="Rust/WebAssembly" ||
      builtHull.generator!=="forge-eye-core-visual-hull" || builtHull.viewCount!==3 || builtHull.occupiedVoxels<1 ||
      builtHull.resolution!==16 || builtHull.frontPoints!==4 || builtHull.sidePoints!==4 || builtHull.topPoints!==4 ||
      !builtHull.rendered || builtHull.triangles<100 || builtHull.indexCount<300) {
    throw new Error("Three-view Rust visual-hull action failed: " + JSON.stringify(builtHull));
  }
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-rust-visual-hull.png"), fullPage: true });

  const savedHullScene = await page.evaluate(() => window.Forge.serialize());
  const hullRoundTrip = await page.evaluate(async scene => {
    await window.Forge.load(scene);
    const hull=[...window.Forge.entities.values()].find(r=>r.components?.geometry?.kind==="rust-visual-hull");
    const lathe=[...window.Forge.entities.values()].find(r=>r.components?.geometry?.kind==="rust-lathe");
    const refs=[...window.Forge.entities.values()].filter(r=>r.components?.reference?.outline?.length>=3);
    return {hullRestored:!!hull&&!!hull.entity.render?.meshInstances?.[0]?.mesh,
      hullKind:hull?.components.geometry.kind,views:hull?.components.geometry.viewCount,
      frontPoints:hull?.components.geometry.frontContour?.length||0,sidePoints:hull?.components.geometry.sideContour?.length||0,
      topPoints:hull?.components.geometry.topContour?.length||0,latheRestored:!!lathe&&!!lathe.entity.render?.meshInstances?.[0]?.mesh,
      refCount:refs.length,refAxes:refs.map(r=>r.components.reference.axis).sort()};
  }, savedHullScene);
  if (!hullRoundTrip.hullRestored || hullRoundTrip.hullKind!=="rust-visual-hull" || hullRoundTrip.views!==3 ||
      hullRoundTrip.frontPoints!==4 || hullRoundTrip.sidePoints!==4 || hullRoundTrip.topPoints!==4 ||
      !hullRoundTrip.latheRestored || hullRoundTrip.refCount!==3 ||
      JSON.stringify(hullRoundTrip.refAxes)!==JSON.stringify(["front","side","top"])) {
    throw new Error("Rust geometry scene round-trip failed: " + JSON.stringify(hullRoundTrip));
  }

  // High-resolution import regression: the embedded reference must be byte-identical
  // to the uploaded PNG, even when its 4096x2048 dimensions exceed preview-size defaults.
  await page.locator('[data-workspace="references"]').click();
  const sourceDataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4096;
    canvas.height = 2048;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#101820";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let x = 0; x < canvas.width; x += 64) {
      ctx.fillStyle = x % 128 === 0 ? "#f0d264" : "#21c4b8";
      ctx.fillRect(x, 0, 2, canvas.height);
    }
    for (let y = 0; y < canvas.height; y += 64) {
      ctx.fillStyle = y % 128 === 0 ? "#dceaf3" : "#52758a";
      ctx.fillRect(0, y, canvas.width, 2);
    }
    return canvas.toDataURL("image/png");
  });
  const sourcePng = Buffer.from(sourceDataUrl.split(",")[1], "base64");
  await page.locator("#referenceInput").setInputFiles({
    name: "qa-original-4k.png", mimeType: "image/png", buffer: sourcePng
  });
  await page.waitForFunction(() => [...window.Forge.entities.values()].some(
    r => r.name === "qa-original-4k.png" && r.components?.reference?.imageDataUrl
  ), null, { timeout: 20000 });
  const imageImportRaw = await page.evaluate(() => {
    const r = [...window.Forge.entities.values()].find(
      item => item.name === "qa-original-4k.png" && item.components?.reference?.imageDataUrl
    );
    return {
      width: r?.components?.asset?.width,
      height: r?.components?.asset?.height,
      sourceBytes: r?.components?.asset?.sourceBytes,
      renderWidth: r?.components?.asset?.renderWidth,
      renderHeight: r?.components?.asset?.renderHeight,
      embeddedDataUrl: r?.components?.reference?.imageDataUrl
    };
  });
  const imageImport = {
    width: imageImportRaw.width, height: imageImportRaw.height,
    sourceBytes: imageImportRaw.sourceBytes,
    renderWidth: imageImportRaw.renderWidth, renderHeight: imageImportRaw.renderHeight,
    exactSourcePreserved: imageImportRaw.embeddedDataUrl === sourceDataUrl
  };
  if (imageImport.width !== 4096 || imageImport.height !== 2048 ||
      imageImport.sourceBytes !== sourcePng.length ||
      imageImport.renderWidth < 1 || imageImport.renderHeight < 1 ||
      !imageImport.exactSourcePreserved) {
    throw new Error("Original-resolution reference import regression failed: " + JSON.stringify(imageImport));
  }

  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-command="save"]').click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().endsWith(".forge.json")) throw new Error("Project save returned unexpected file: " + download.suggestedFilename());

  const mobileReports = [];
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    await page.locator('[data-workspace="animation"]').click();
    await page.locator('[data-timeline-view="graph"]').click();
    await page.waitForFunction(() => !document.querySelector("#graphEditorPane").hidden && !!document.querySelector("#graphEditorCanvas").__graphMetrics, null, { timeout: 5000 });
    const graph = await page.evaluate(() => {
      const canvas = document.querySelector("#graphEditorCanvas"), rect = canvas.getBoundingClientRect();
      return { visible: !document.querySelector("#graphEditorPane").hidden, width: Math.round(rect.width), height: Math.round(rect.height),
        metrics: !!canvas.__graphMetrics, rootOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    if (!graph.visible || graph.width < 250 || graph.height < 65 || !graph.metrics || graph.rootOverflow !== 0) throw new Error("Mobile Graph Editor failed at " + width + "px: " + JSON.stringify(graph));
    await page.locator('[data-mobile-panel="references"]').click();
    await page.waitForFunction(() => document.querySelector("#rightDock").classList.contains("is-open") && !document.querySelector('[data-inspector-panel="references"]').hidden, null, { timeout: 5000 });
    mobileReports.push({ width, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth), graph });
    await page.screenshot({ path: path.join(ARTIFACTS, "forge-eye-mobile-" + width + ".png"), fullPage: true });
  }

  report = { ok: true, url: URL_TO_TEST, httpStatus: response.status(), initial, rustLathe, evaluated, bottle, editedLathe, rustVisualHull, builtHull, hullRoundTrip, imageImport, projectDownload: download.suggestedFilename(), mobileReports, pageErrors, consoleErrors, failedRequests };
  await fs.writeFile(path.join(ARTIFACTS, "forge-eye-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (pageErrors.length || consoleErrors.length || failedRequests.length) throw new Error("Unexpected browser errors: " + JSON.stringify({ pageErrors, consoleErrors, failedRequests }));
} catch (error) {
  report = { ok: false, url: URL_TO_TEST, error: String(error?.stack || error), pageErrors, consoleErrors, failedRequests };
  await fs.writeFile(path.join(ARTIFACTS, "forge-eye-report.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
