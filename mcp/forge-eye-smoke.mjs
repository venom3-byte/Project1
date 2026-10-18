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

  // Regression coverage for transform drag fallback, PBR/glass, light/camera
  // inspector edits, and persistence of component settings.
  const editorSystems = await page.evaluate(() => {
    const engine=window.Forge,gizmo=window.ForgeGizmo,originalNative=gizmo.state.nativeReady,originalMode=gizmo.state.mode;
    const object=engine.primitive("box","QA transform and PBR");object.entity.setLocalPosition(0,1,0);engine.select(object.id);
    gizmo.state.nativeReady=false;
    const before=engine._transformState(object);
    gizmo.setMode("translate");
    const translation=gizmo.beginPointerGesture({pointerId:701,clientX:100,clientY:100});
    if(!translation)throw new Error("Transform fallback could not begin");
    gizmo.movePointerGesture({pointerId:701,clientX:132,clientY:119,shiftKey:false,altKey:false},translation);gizmo.endPointerGesture(translation);
    const afterTranslate=engine._transformState(object);
    gizmo.setMode("rotate");
    const rotation=gizmo.beginPointerGesture({pointerId:702,clientX:100,clientY:100});
    gizmo.movePointerGesture({pointerId:702,clientX:124,clientY:111,shiftKey:false,altKey:false},rotation);gizmo.endPointerGesture(rotation);
    const afterRotate=engine._transformState(object);
    gizmo.setMode("scale");
    const scaling=gizmo.beginPointerGesture({pointerId:703,clientX:100,clientY:100});
    gizmo.movePointerGesture({pointerId:703,clientX:120,clientY:100,shiftKey:false,altKey:false},scaling);gizmo.endPointerGesture(scaling);
    const afterScale=engine._transformState(object);
    gizmo.state.nativeReady=originalNative;gizmo.setMode(originalMode);if(originalNative)gizmo.sync();
    engine.select(object.id);window.dispatchEvent(new Event("forge-selection"));
    return {translateChanged:JSON.stringify(before.p)!==JSON.stringify(afterTranslate.p),
      rotateChanged:JSON.stringify(afterTranslate.r)!==JSON.stringify(afterRotate.r),
      scaleChanged:JSON.stringify(afterRotate.s)!==JSON.stringify(afterScale.s)};
  });
  if(!editorSystems.translateChanged||!editorSystems.rotateChanged||!editorSystems.scaleChanged){
    throw new Error("Transform fallback did not change position, rotation, and scale: "+JSON.stringify(editorSystems));
  }

  await page.locator("#materialPreset").selectOption("glass");
  await page.locator("#materialOpacity").evaluate(el=>{el.value="0.31";el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));});
  const pbr = await page.evaluate(() => {
    const r=window.Forge.selected(),material=r?.entity.render?.meshInstances?.[0]?.material,meta=r?.components.material;
    return {name:r?.name,preset:meta?.preset,opacity:meta?.opacity,metalness:meta?.metalness,roughness:meta?.roughness,
      useLighting:material?.useLighting,useMetalness:material?.useMetalness,blendType:material?.blendType,
      expectedBlendType:window.ForgePC.BLEND_NORMAL,depthWrite:material?.depthWrite};
  });
  if(pbr.preset!=="glass"||Math.abs(pbr.opacity-.31)>.001||pbr.useLighting!==true||pbr.useMetalness!==true||
      pbr.blendType!==pbr.expectedBlendType||pbr.depthWrite!==false){
    throw new Error("PBR/glass material inspector regression failed: "+JSON.stringify(pbr));
  }

  const lightRecord = await page.evaluate(() => {
    const light=window.Forge.createLight("QA Spot Light");window.__qaLightId=light.id;
    window.Forge.select(light.id);window.dispatchEvent(new Event("forge-selection"));
    return {id:light.id,name:light.name,kind:light.kind};
  });
  await page.locator("#lightType").selectOption("spot");
  await page.locator("#lightIntensity").evaluate(el=>{el.value="3.5";el.dispatchEvent(new Event("change",{bubbles:true}));});
  await page.locator("#lightRange").evaluate(el=>{el.value="18";el.dispatchEvent(new Event("change",{bubbles:true}));});
  const lightState = await page.evaluate(() => {
    const r=window.Forge.entities.get(window.__qaLightId),light=r?.entity.light;
    return {kind:r?.kind,type:light?.type,intensity:light?.intensity,range:light?.range,metadata:r?.components.light};
  });
  if(lightState.kind!=="light"||lightState.type!=="spot"||Math.abs(lightState.intensity-3.5)>.001||Math.abs(lightState.range-18)>.001){
    throw new Error("Live light inspector controls failed: "+JSON.stringify(lightState));
  }

  const cameraRecord = await page.evaluate(() => {
    const camera=window.Forge.createCamera("QA Orthographic Camera",{x:5,y:3,z:6});window.__qaCameraId=camera.id;
    window.Forge.select(camera.id);window.dispatchEvent(new Event("forge-selection"));
    return {id:camera.id,name:camera.name};
  });
  await page.locator("#cameraFov").evaluate(el=>{el.value="42";el.dispatchEvent(new Event("change",{bubbles:true}));});
  await page.locator("#cameraProjection").selectOption("orthographic");
  await page.locator("#cameraActive").check();
  const cameraState = await page.evaluate(() => {
    const r=window.Forge.entities.get(window.__qaCameraId),camera=r?.entity.camera;
    return {kind:r?.kind,fov:camera?.fov,projection:camera?.projection,
      expectedOrthographic:window.ForgePC.PROJECTION_ORTHOGRAPHIC,active:r?.components.camera?.active,
      editorCamera:window.Forge.camera()?.name};
  });
  if(cameraState.kind!=="camera"||Math.abs(cameraState.fov-42)>.01||cameraState.projection!==cameraState.expectedOrthographic||
      cameraState.active!==true||cameraState.editorCamera!=="QA Orthographic Camera"){
    throw new Error("Camera inspector controls failed: "+JSON.stringify(cameraState));
  }

  const savedComponents=await page.evaluate(()=>window.Forge.serialize());
  const componentRoundTrip=await page.evaluate(async data=>{
    await window.Forge.load(data);
    const entities=[...window.Forge.entities.values()];
    const o=entities.find(r=>r.name==="QA transform and PBR"),light=entities.find(r=>r.name==="QA Spot Light"),camera=entities.find(r=>r.name==="QA Orthographic Camera");
    return {objectRestored:!!o&&!!o.entity.render?.meshInstances?.length,material:o?.components.material,
      renderMaterial:o?.entity.render?.meshInstances?.[0]?.material&&{opacity:o.entity.render.meshInstances[0].material.opacity,
        useLighting:o.entity.render.meshInstances[0].material.useLighting,useMetalness:o.entity.render.meshInstances[0].material.useMetalness},
      light:light&&{type:light.entity.light?.type,intensity:light.entity.light?.intensity,range:light.entity.light?.range,metadata:light.components.light},
      camera:camera&&{fov:camera.entity.camera?.fov,projection:camera.entity.camera?.projection,active:camera.components.camera?.active},
      activeCamera:window.Forge.camera()?.name};
  },savedComponents);
  if(!componentRoundTrip.objectRestored||Math.abs(componentRoundTrip.renderMaterial?.opacity-.31)>.001||
      componentRoundTrip.renderMaterial?.useLighting!==true||componentRoundTrip.renderMaterial?.useMetalness!==true||
      componentRoundTrip.light?.type!=="spot"||Math.abs(componentRoundTrip.light?.intensity-3.5)>.001||
      Math.abs(componentRoundTrip.light?.range-18)>.001||Math.abs(componentRoundTrip.camera?.fov-42)>.01||
      componentRoundTrip.camera?.projection!==cameraState.expectedOrthographic||componentRoundTrip.camera?.active!==true||
      componentRoundTrip.activeCamera!=="QA Orthographic Camera"){
    throw new Error("Material/light/camera project round-trip failed: "+JSON.stringify(componentRoundTrip));
  }

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
    // The mobile references drawer intentionally blocks the editor behind its
    // scrim; dismiss it with the same outside-tap a user would perform.
    const scrim = page.locator("#drawerScrim");
    if (await scrim.isVisible()) {
      await scrim.click({ position: { x: 20, y: 300 } });
      await page.waitForFunction(() => document.querySelector("#drawerScrim").hidden, null, { timeout: 5000 });
    }
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
