#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import chromiumModule from "@sparticuz/chromium";
import { chromium } from "playwright-core";
import { normalizeForgeCommand } from "./forge-command-schema.mjs";

const Chromium = chromiumModule.default || chromiumModule;
const URL_TO_TEST = process.env.FORGE_PORT_URL || "http://127.0.0.1:4173/";
const ARTIFACTS = process.env.FORGE_PORT_ARTIFACTS || path.resolve("artifacts/forge-port");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!["127.0.0.1", "localhost"].includes(new URL(URL_TO_TEST).hostname)) {
  throw new Error("The port smoke test only accepts a local preview URL.");
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
page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));
page.on("console", message => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
});
page.on("requestfailed", request => failedRequests.push({
  url: request.url(), error: request.failure()?.errorText || "request failed"
}));

let report;
try {
  const response = await page.goto(URL_TO_TEST, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!response || response.status() !== 200) {
    throw new Error("Host route returned HTTP " + (response?.status() ?? "no response"));
  }
  const hostFrame = page.locator('iframe[title="Forge Studio 3.7"]');
  await hostFrame.waitFor({ state: "visible", timeout: 15000 });
  const forgeFrameLocator = hostFrame.contentFrame();
  await forgeFrameLocator.locator("#viewport").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[title="Forge Studio 3.7"]');
    const state = frame?.contentWindow?.ForgeBootState;
    return state === "ready" || state === "error" || state === "ui-error";
  }, null, { timeout: 60000 });
  await sleep(800);

  const frame = page.frames().find(item => new URL(item.url()).pathname.endsWith("/forge/index.html"));
  if (!frame) throw new Error("Could not access the Forge workbench frame.");
  const initial = await frame.evaluate(() => ({
    bootState: window.ForgeBootState || null,
    ready: window.ForgeReady === true,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
    canvas: (() => {
      const e = document.querySelector("#viewport");
      return e ? { width: e.width, height: e.height, visible: e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 } : null;
    })(),
    diagnostics: window.Forge?.diagnostics?.() || null,
    viewport3d: window.ForgeViewport?.status?.() || null,
    editorOverlayGridCount: document.querySelectorAll(".editor-grid").length,
    criticalDuplicateIds: ["importAssets","productionTools","focus","focusViewport","snapToggle","spaceToggle","grid","qa","build","play"].filter(id => document.querySelectorAll("#" + id).length > 1),
    allDuplicateIds: [...document.querySelectorAll("[id]")].map(e=>e.id).filter((id,i,all)=>all.indexOf(id)!==i).filter((id,i,all)=>all.indexOf(id)===i),
    legacyFloatingDockCount: document.querySelectorAll(".forge-prod").length,
    toolboxLauncher: (()=>{const e=document.querySelector("#productionTools"),r=e?.getBoundingClientRect();return !!e&&!!r&&r.width>0&&r.height>0})(),
    entityCount: window.Forge?.entities?.size ?? null,
    modules: {
      production: !!window.ForgeProduction,
      gameplay: !!window.ForgeGameplay,
      animation: !!window.ForgeAnimation,
      spatial: !!window.ForgeSpatial,
      agent: !!window.ForgeAgent,
      runtime: !!window.ForgeRuntime,
      qa: !!window.ForgeQAPro
    },
    agentServer: {
      configured: typeof window.ForgeServerBridge?.webSocketUrl === "string" && !!window.ForgeServerBridge.webSocketUrl,
      capable: window.ForgeAgent?.serverCapable?.() ?? null
    },
    bootText: document.querySelector("#forgeBootText")?.textContent || null
  }));

  if (initial.bootState !== "ready" || !initial.ready) {
    throw new Error("Forge did not complete boot: " + JSON.stringify(initial));
  }
  if (!initial.canvas?.visible || initial.canvas.width < 320 || initial.canvas.height < 240) {
    throw new Error("Forge viewport canvas is missing, invisible, or too small.");
  }
  if (!initial.diagnostics || initial.entityCount < 1) {
    throw new Error("Forge did not create a valid engine scene: " + JSON.stringify(initial.diagnostics));
  }
  if (!initial.viewport3d?.ok || !initial.viewport3d.groundVisible || !initial.viewport3d.gridTexture || initial.viewport3d.gridMeshes < 2 || initial.viewport3d.gridScaleMeters !== 30 || initial.viewport3d.minorSubdivisionMeters !== 1 || initial.viewport3d.majorSubdivisionMeters !== 5) {
    throw new Error("Forge true 3D workspace did not initialize its visible ground, world grid, axes and navigation: " + JSON.stringify(initial.viewport3d));
  }
  if (initial.editorOverlayGridCount !== 0) throw new Error("A flat CSS grid overlay is still masking the 3D workspace.");
  if (initial.criticalDuplicateIds.length || initial.allDuplicateIds.length) throw new Error("Duplicate editor control IDs remain: " + JSON.stringify({critical:initial.criticalDuplicateIds,all:initial.allDuplicateIds}));
  if (initial.legacyFloatingDockCount !== 0 || !initial.toolboxLauncher) throw new Error("The floating production ribbon remains or the Toolbox launcher is unavailable.");
  for (const [name, present] of Object.entries(initial.modules)) {
    if (!present) throw new Error("Expected Forge module did not load: " + name);
  }
  if (!initial.agentServer?.configured && initial.agentServer?.capable !== false) {
    throw new Error("Static Forge must not infer a live WebSocket endpoint when no server bridge is configured.");
  }

  await forgeFrameLocator.locator("#productionTools").click();
  await forgeFrameLocator.locator(".forge-modal").waitFor({state:"visible",timeout:5000});
  const toolboxCheck = await frame.evaluate(() => {
    const dialog=document.querySelector(".forge-modal");
    const content=dialog?.innerText||"";
    return {visible:Boolean(dialog?.open),cardCount:dialog?.querySelectorAll(".toolbox-card").length||0,
      groups:["Assets & Materials","Animation & Effects","World & Gameplay","Diagnostics"].filter(title=>content.includes(title)),
      containsAssetLab:content.includes("Asset Lab"),containsVisualQA:content.includes("Visual QA")};
  });
  if(!toolboxCheck.visible||toolboxCheck.cardCount<10||toolboxCheck.groups.length!==4||!toolboxCheck.containsAssetLab||!toolboxCheck.containsVisualQA) {
    throw new Error("Production Toolbox grouping is incomplete: "+JSON.stringify(toolboxCheck));
  }
  await forgeFrameLocator.locator(".forge-modal [data-x]").click();
  await sleep(80);
  const toolboxClosed = await frame.evaluate(() => !document.querySelector(".forge-modal"));
  if(!toolboxClosed) throw new Error("Production Toolbox did not close cleanly.");

  const entityCountBefore = await frame.evaluate(() => window.Forge.entities.size);
  await forgeFrameLocator.locator('[data-add="sphere"]').first().click();
  await frame.waitForFunction(previous => window.Forge.entities.size === previous + 1, entityCountBefore, { timeout: 10000 });
  const entityCountAfterAdd = await frame.evaluate(() => window.Forge.entities.size);
  const uiSphereId = await frame.evaluate(() => window.Forge.selectedId);

  // Exercise the same provider-neutral structured command contract used by forge_command.
  const agentPhysicsBefore = await frame.evaluate(() => window.Forge.diagnostics().physics);
  const agentCreateResult = await frame.evaluate(
    command => window.ForgeAgent.execute(command),
    normalizeForgeCommand({ op: "create", kind: "sphere", name: "MCP Probe", x: 0, y: 2, z: 0 }),
  );
  if (!agentCreateResult?.id) throw new Error("ForgeAgent.create did not return a stable entity ID.");
  const agentInspectResult = await frame.evaluate(
    command => window.ForgeAgent.execute(command),
    normalizeForgeCommand({ op: "inspect", id: agentCreateResult.id }),
  );
  if (!agentInspectResult) throw new Error("ForgeAgent.inspect did not return scene inspection data.");
  await frame.evaluate(
    command => window.ForgeAgent.execute(command),
    normalizeForgeCommand({ op: "transform", id: agentCreateResult.id, x: 2, y: 1, z: -1 }),
  );
  const agentTransform = await frame.evaluate(id => {
    const entity = window.Forge.entities.get(id);
    if (!entity) return null;
    const p = entity.entity.getLocalPosition();
    return { x: p.x, y: p.y, z: p.z };
  }, agentCreateResult.id);
  if (!agentTransform || Math.abs(agentTransform.x - 2) > 1e-5 || Math.abs(agentTransform.y - 1) > 1e-5 || Math.abs(agentTransform.z + 1) > 1e-5) {
    throw new Error("ForgeAgent.transform did not update real engine state: " + JSON.stringify(agentTransform));
  }
  await frame.evaluate(
    command => window.ForgeAgent.execute(command),
    normalizeForgeCommand({ op: "physics", id: agentCreateResult.id, mode: "fixed", shape: "ball" }),
  );
  const agentPhysicsAfter = await frame.evaluate(() => window.Forge.diagnostics().physics);
  if (agentPhysicsAfter !== agentPhysicsBefore + 1) throw new Error("ForgeAgent.physics did not add a real physics body.");
  await frame.evaluate(
    command => window.ForgeAgent.execute(command),
    normalizeForgeCommand({ op: "delete", id: agentCreateResult.id }),
  );
  const entityCountAfterAgentDelete = await frame.evaluate(() => window.Forge.entities.size);
  if (entityCountAfterAgentDelete !== entityCountAfterAdd) throw new Error("ForgeAgent.delete did not restore the pre-agent scene count.");
  await frame.evaluate(id => { window.Forge.select(id); window.Forge.focus(); }, uiSphereId);
  const agentControl = {
    create: agentCreateResult,
    inspectReturnedData: !!agentInspectResult,
    transform: agentTransform,
    physicsBefore: agentPhysicsBefore,
    physicsAfter: agentPhysicsAfter,
    deleteRestoredEntityCount: entityCountAfterAgentDelete
  };
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-port-desktop.png"), fullPage: true });

  const playButton = forgeFrameLocator.locator("#play");
  await playButton.click();
  await frame.waitForFunction(() => window.Forge.running === true, null, { timeout: 5000 });
  const playState = await frame.evaluate(() => ({ running: window.Forge.running, label: document.querySelector("#play")?.textContent?.trim() || "" }));
  await playButton.click();
  await frame.waitForFunction(() => window.Forge.running === false, null, { timeout: 5000 });
  const stoppedState = await frame.evaluate(() => ({ running: window.Forge.running, label: document.querySelector("#play")?.textContent?.trim() || "" }));

  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  const frameBox = await page.locator('iframe[title="Forge Studio 3.7"]').boundingBox();
  const canvasRect = await frame.evaluate(() => {
    const r=document.querySelector("#viewport").getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  });
  const cx=(frameBox?.x||0)+canvasRect.x+canvasRect.width*0.52;
  const cy=(frameBox?.y||0)+canvasRect.y+canvasRect.height*0.52;
  const cameraBeforeOrbit = await frame.evaluate(() => window.ForgeViewport.status().camera);
  await page.mouse.move(cx,cy);
  await page.mouse.down({button:"middle"});
  await page.mouse.move(cx+64,cy+27,{steps:6});
  await page.mouse.up({button:"middle"});
  await sleep(120);
  const cameraAfterOrbit = await frame.evaluate(() => window.ForgeViewport.status().camera);
  const cameraBeforeZoom = cameraAfterOrbit.distance;
  await page.mouse.move(cx,cy);
  await page.mouse.wheel(0,-120);
  await sleep(120);
  const cameraAfterZoom = await frame.evaluate(() => window.ForgeViewport.status().camera);
  const targetBeforePan = cameraAfterZoom.target;
  await page.mouse.move(cx,cy);
  await page.mouse.down({button:"right"});
  await page.mouse.move(cx+35,cy+20,{steps:5});
  await page.mouse.up({button:"right"});
  await sleep(120);
  const cameraAfterPan = await frame.evaluate(() => window.ForgeViewport.status().camera);
  const viewportNavigation = {
    orbitChanged: Math.hypot(...cameraAfterOrbit.position.map((v,i)=>v-cameraBeforeOrbit.position[i]))>0.05,
    zoomChanged: Math.abs(cameraAfterZoom.distance-cameraBeforeZoom)>0.05,
    panChanged: Math.hypot(...cameraAfterPan.target.map((v,i)=>v-targetBeforePan[i]))>0.005,
    cameraBeforeOrbit,cameraAfterOrbit,cameraAfterZoom,cameraAfterPan
  };
  if (!viewportNavigation.orbitChanged || !viewportNavigation.zoomChanged || !viewportNavigation.panChanged) {
    throw new Error("3D camera navigation regression: " + JSON.stringify(viewportNavigation));
  }

  const mobile = await frame.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    canvas: (() => { const e=document.querySelector("#viewport"),r=e?.getBoundingClientRect(); return r?{width:Math.round(r.width),height:Math.round(r.height),visible:r.width>0&&r.height>0}:null; })(),
    mobileControls: [...document.querySelectorAll("#mobileScene,#mobileInspector")].map(e=>({id:e.id,visible:e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0})),
    productionDockCount: document.querySelectorAll(".forge-prod").length,
    toolboxButton: (()=>{const e=document.querySelector("#productionTools"),r=e?.getBoundingClientRect();return {visible:!!e&&!!r&&r.width>0&&r.height>0,left:Math.round(r?.left||0),right:Math.round(r?.right||0)}})(),
    mobileNav: (() => { const e=document.querySelector(".mobile-bar"),r=e?.getBoundingClientRect(); return r?{top:Math.round(r.top),bottom:Math.round(r.bottom),height:Math.round(r.height)}:null; })(),
    primaryToolbar: Object.fromEntries(["projectName","importAssets","saveProject","build","play"].map(id=>{const e=document.getElementById(id),r=e?.getBoundingClientRect();return[id,!!e&&!!r&&r.width>0&&r.height>0&&r.left>=-1&&r.right<=innerWidth+1]}))
  }));
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-port-mobile.png"), fullPage: true });

  report = {
    ok: true,
    url: URL_TO_TEST,
    httpStatus: response.status(),
    initial,
    actionChecks: { entityCountBefore, entityCountAfterAdd, playState, stoppedState },
    toolboxCheck,
    toolboxClosed,
    viewportNavigation,
    agentControl,
    mobile,
    pageErrors,
    consoleErrors,
    failedRequests,
    screenshots: ["forge-port-desktop.png", "forge-port-mobile.png"]
  };
  if (entityCountAfterAdd !== entityCountBefore + 1) throw new Error("Creating a sphere did not update scene state.");
  if (playState.running !== true || stoppedState.running !== false) throw new Error("Play/Stop did not change the real engine state.");
  if (!agentControl.inspectReturnedData || agentControl.physicsAfter !== agentControl.physicsBefore + 1 || agentControl.deleteRestoredEntityCount !== entityCountAfterAdd) throw new Error("Provider-neutral ForgeAgent command sequence failed.");
  if (mobile.viewport.scrollWidth > mobile.viewport.clientWidth + 2) throw new Error("Forge overflows horizontally at 390px: " + JSON.stringify(mobile.viewport));
  if (!mobile.canvas?.visible || mobile.canvas.width < 300 || mobile.canvas.height < 200) throw new Error("Mobile viewport canvas is unusable: " + JSON.stringify(mobile.canvas));
  if (mobile.productionDockCount !== 0 || !mobile.toolboxButton?.visible) throw new Error("Mobile must use the Toolbox button instead of a floating production ribbon: " + JSON.stringify(mobile));
  if (!mobile.mobileNav) throw new Error("Mobile Scene/Inspector navigation is missing.");
  for (const id of ["projectName","importAssets","saveProject","build","play"]) {
    if (!mobile.primaryToolbar?.[id]) throw new Error("Primary mobile toolbar control is clipped or hidden: " + id + " " + JSON.stringify(mobile.primaryToolbar));
  }
  if (pageErrors.length) throw new Error("Uncaught page errors: " + pageErrors.join("\n"));
  if (consoleErrors.length) throw new Error("Console errors: " + consoleErrors.join("\n"));
} catch (error) {
  report = {
    ok: false,
    url: URL_TO_TEST,
    error: String(error?.stack || error),
    pageErrors,
    consoleErrors,
    failedRequests
  };
  try { await page.screenshot({ path: path.join(ARTIFACTS, "forge-port-failure.png"), fullPage: true }); } catch {}
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(ARTIFACTS, "forge-port-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
