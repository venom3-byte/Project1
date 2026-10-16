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
    workspaceNavigation: (()=>{const e=document.querySelector(".workspace-strip"),r=e?.getBoundingClientRect();return {count:document.querySelectorAll("[data-workspace-target]").length,visible:!!e&&!!r&&r.height>=28&&getComputedStyle(e).display!=="none",active:document.querySelector("[data-workspace-target][aria-selected='true']")?.dataset.workspaceTarget||null}})(),
    previewControl: (()=>{const e=document.querySelector("#play"),r=e?.getBoundingClientRect();return {visible:!!e&&!!r&&r.width>0&&r.height>0,label:e?.querySelector("[data-run-label]")?.textContent||"",ariaLabel:e?.getAttribute("aria-label")||"",pressed:e?.getAttribute("aria-pressed")||null}})(),
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
      qa: !!window.ForgeQAPro,
      referenceStudio: !!window.ForgeReferenceStudio?.status?.().ok
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
  if(initial.workspaceNavigation.count!==5||!initial.workspaceNavigation.visible||initial.workspaceNavigation.active!=="layout"){
    throw new Error("Forge workflow navigation did not initialize correctly: "+JSON.stringify(initial.workspaceNavigation));
  }
  if(!initial.previewControl.visible||initial.previewControl.label!=="Preview"||initial.previewControl.pressed!=="false"){
    throw new Error("Scene Preview control should be available as a restrained Preview action: "+JSON.stringify(initial.previewControl));
  }
  const disclosureSelectors=[".assets-section",".asset-tools-section",".spatial-section",".vision-section",".console-section"];
  const disclosureDefaults=await frame.evaluate(selectors=>selectors.map(selector=>({selector,open:document.querySelector(selector)?.open??false})),disclosureSelectors);
  await forgeFrameLocator.locator('[data-workspace-target="animation"]').click();
  await frame.waitForFunction(()=>document.documentElement.dataset.editorWorkspace==="animation"&&document.querySelector(".timeline-shell")?.open,null,{timeout:5000});
  const animationWorkspace=await frame.evaluate(()=>({active:document.querySelector("[data-workspace-target][aria-selected='true']")?.dataset.workspaceTarget,timelineOpen:document.querySelector(".timeline-shell")?.open===true,context:document.querySelector("#workspaceContext")?.innerText||""}));
  await forgeFrameLocator.locator('[data-workspace-target="assets"]').click();
  await frame.waitForFunction(()=>document.documentElement.dataset.editorWorkspace==="assets"&&document.querySelector(".assets-section")?.open===true,null,{timeout:5000});
  const assetsWorkspace=await frame.evaluate(()=>({active:document.querySelector("[data-workspace-target][aria-selected='true']")?.dataset.workspaceTarget,assetsOpen:document.querySelector(".assets-section")?.open===true}));
  await forgeFrameLocator.locator('[data-workspace-target="review"]').click();
  await frame.waitForFunction(()=>document.documentElement.dataset.editorWorkspace==="review"&&document.querySelector(".asset-tools-section")?.open===true,null,{timeout:5000});
  const reviewWorkspace=await frame.evaluate(()=>({active:document.querySelector("[data-workspace-target][aria-selected='true']")?.dataset.workspaceTarget,assetToolsOpen:document.querySelector(".asset-tools-section")?.open===true,visionOpen:document.querySelector(".vision-section")?.open===true,spatialOpen:document.querySelector(".spatial-section")?.open===true}));
  await forgeFrameLocator.locator('[data-workspace-target="layout"]').click();
  await frame.waitForFunction(()=>document.documentElement.dataset.editorWorkspace==="layout"&&document.querySelector("[data-workspace-target='layout']")?.getAttribute("aria-selected")==="true",null,{timeout:5000});
  const layoutRestored=await frame.evaluate(()=>({active:document.querySelector("[data-workspace-target][aria-selected='true']")?.dataset.workspaceTarget,timelineOpen:document.querySelector(".timeline-shell")?.open===true}));
  await frame.evaluate(({selectors,defaults})=>{
    for(const item of defaults){const e=document.querySelector(item.selector);if(e&&e.tagName==="DETAILS")e.open=item.open}
    document.querySelector(".left-panel")?.scrollTo(0,0);document.querySelector(".right-panel")?.scrollTo(0,0);
  },{selectors:disclosureSelectors,defaults:disclosureDefaults});
  if(animationWorkspace.active!=="animation"||!animationWorkspace.timelineOpen||!animationWorkspace.context.includes("ANIMATION")){
    throw new Error("Animation workspace did not expose the timeline: "+JSON.stringify(animationWorkspace));
  }
  if(assetsWorkspace.active!=="assets"||!assetsWorkspace.assetsOpen)throw new Error("Assets workspace did not expand the asset browser: "+JSON.stringify(assetsWorkspace));
  if(reviewWorkspace.active!=="review"||!reviewWorkspace.assetToolsOpen||!reviewWorkspace.visionOpen||!reviewWorkspace.spatialOpen){
    throw new Error("Review workspace did not expose QA and asset metrics: "+JSON.stringify(reviewWorkspace));
  }
  if(layoutRestored.active!=="layout"||layoutRestored.timelineOpen)throw new Error("Returning to Layout did not restore the previous timeline state: "+JSON.stringify(layoutRestored));

  await forgeFrameLocator.locator("#productionTools").click();
  await forgeFrameLocator.locator(".forge-modal").waitFor({state:"visible",timeout:5000});
  const toolboxCheck = await frame.evaluate(() => {
    const dialog=document.querySelector(".forge-modal");
    const content=(dialog?.innerText||"").toLowerCase();
    return {visible:Boolean(dialog?.open),cardCount:dialog?.querySelectorAll(".toolbox-card").length||0,
      groups:["assets & materials","animation & effects","world & gameplay","diagnostics"].filter(title=>content.includes(title)),
      containsAssetLab:content.includes("asset lab"),containsVisualQA:content.includes("visual qa"),containsReferenceStudio:content.includes("reference studio")};
  });
  if(!toolboxCheck.visible||toolboxCheck.cardCount<10||toolboxCheck.groups.length!==4||!toolboxCheck.containsAssetLab||!toolboxCheck.containsVisualQA||!toolboxCheck.containsReferenceStudio) {
    throw new Error("Production Toolbox grouping is incomplete: "+JSON.stringify(toolboxCheck));
  }
  await forgeFrameLocator.locator(".forge-modal [data-x]").click();
  await forgeFrameLocator.locator(".forge-modal").waitFor({state:"detached",timeout:5000});
  const toolboxClosed = await frame.evaluate(() => !document.querySelector(".forge-modal[open]"));
  if(!toolboxClosed) throw new Error("Production Toolbox did not close cleanly.");

  // Real image-reference regression: calibrate width, switch orthographic views,
  // prove the image plane is isolated from scene entity count, then remove it.
  await forgeFrameLocator.locator("#productionTools").click();
  await forgeFrameLocator.locator('[data-production-tool="references"]').click();
  const referenceDialog = forgeFrameLocator.locator(".forge-reference-modal");
  await referenceDialog.waitFor({state:"visible",timeout:5000});
  await referenceDialog.locator('[data-ref-slot="front"]').click();
  await referenceDialog.locator("#refFile").setInputFiles({
    // Tiny valid PNG fixture: exercise the same browser-decoded raster path users upload.
    name:"qa-blueprint.png",mimeType:"image/png",
    buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAKAAAABQCAIAAAARP+ljAAAA/klEQVR42u3dsQnCQBSA4RdxDAvBCRxEFJzAygGcIzPY2giKg7iChROIYOsCVnnGcN739Slyf14I5EKax/MV1ZjvzhFxbZf1nPIoEBiBERiBERiBEVhgBEZgBEZgBEZggREYgREYgREYgYloOm+bva9Xlu9nJseTCeaD8VBX1iBK3PievFOaYA9ZCIzACIzACIzAAiMwAiMwApPSzLaHbkdebvuIWEw3FrFXyXU2wf8+wckdHd4H9y25zibYQxYCIzACIzACI7DACIzACIzApPg+uAzeJvHtCS6RH2MhMAIjMAIjMAILjMAIjMAIjMAIjMACIzACIzACIzACV+oNY/sxIIl6NZ8AAAAASUVORK5CYII=","base64")
  });
  await frame.waitForFunction(() => window.ForgeReferenceStudio?.status?.().referenceCount === 1, null, {timeout:10000});
  await referenceDialog.locator("#refWidth").fill("25");
  await referenceDialog.locator("#refWidth").press("Tab");
  await frame.waitForFunction(() => {
    const s=window.ForgeReferenceStudio?.status?.();
    return s?.slots?.[0]?.worldWidth===25 && s.slots[0].renderable && s.slots[0].visible;
  },null,{timeout:10000});
  const referenceBeforeViewSwitch = await frame.evaluate(() => ({
    entityCount:window.Forge.entities.size,
    guide:window.ForgeReferenceStudio.status().slots.find(x=>x.slot==="front")||null,
    selectedId:window.Forge.selectedId
  }));
  if (!referenceBeforeViewSwitch.guide || referenceBeforeViewSwitch.guide.worldWidth!==25 ||
      !referenceBeforeViewSwitch.guide.renderable || !referenceBeforeViewSwitch.guide.visible) {
    throw new Error("Reference plane did not load or obey calibration: "+JSON.stringify(referenceBeforeViewSwitch));
  }
  // Close the modal before testing the Play toolbar; dialogs correctly block clicks behind them.
  await referenceDialog.locator('[data-ref-close]').click();
  await referenceDialog.waitFor({state:"detached",timeout:5000});
  await forgeFrameLocator.locator("#play").click();
  await frame.waitForFunction(() => window.Forge.running===true &&
    window.ForgeReferenceStudio.status().slots.find(x=>x.slot==="front")?.visible===false,null,{timeout:5000});
  await forgeFrameLocator.locator("#play").click();
  await frame.waitForFunction(() => window.Forge.running===false &&
    window.ForgeReferenceStudio.status().slots.find(x=>x.slot==="front")?.visible===true,null,{timeout:5000});
  await forgeFrameLocator.locator("#productionTools").click();
  await forgeFrameLocator.locator('[data-production-tool="references"]').click();
  await referenceDialog.waitFor({state:"visible",timeout:5000});
  await referenceDialog.locator('[data-ref-slot="top"]').click();
  await frame.waitForFunction(() => window.ForgeReferenceStudio.status().view==="top" &&
    window.ForgeReferenceStudio.status().slots.find(x=>x.slot==="front")?.visible===false,null,{timeout:5000});
  await referenceDialog.locator('[data-ref-slot="front"]').click();
  await frame.waitForFunction(() => window.ForgeReferenceStudio.status().view==="front" &&
    window.ForgeReferenceStudio.status().slots.find(x=>x.slot==="front")?.visible===true,null,{timeout:5000});
  await referenceDialog.locator("#refMatchView").uncheck();
  await referenceDialog.locator('[data-ref-slot="side"]').click();
  await frame.waitForFunction(() => window.ForgeReferenceStudio.status().slots.find(x=>x.slot==="front")?.visible===true,null,{timeout:5000});
  // Select the populated slot again: Remove acts on the active reference slot.
  await referenceDialog.locator('[data-ref-slot="front"]').click();
  await frame.waitForFunction(() => window.ForgeReferenceStudio.status().view==="front" &&
    window.ForgeReferenceStudio.status().slots.find(x=>x.slot==="front")?.visible===true,null,{timeout:5000});
  await referenceDialog.locator("#refRemove").click();
  await frame.waitForFunction(() => window.ForgeReferenceStudio.status().referenceCount===0,null,{timeout:5000});
  const referenceCleanup = await frame.evaluate(() => ({
    referenceCount:window.ForgeReferenceStudio.status().referenceCount,
    entityCount:window.Forge.entities.size
  }));
  if(referenceCleanup.entityCount!==referenceBeforeViewSwitch.entityCount || referenceCleanup.referenceCount!==0) {
    throw new Error("Reference guide contaminated the game scene or failed cleanup: "+JSON.stringify({referenceBeforeViewSwitch,referenceCleanup}));
  }
  await referenceDialog.locator('[data-ref-close]').click();

  await forgeFrameLocator.locator('[data-gizmo="select"]').click();
  await frame.waitForFunction(() => window.ForgeGizmo?.state?.mode === "select", null, {timeout:5000});
  const selectModeActive = await frame.evaluate(() => ({
    mode:window.ForgeGizmo?.state?.mode,
    active:document.querySelector('[data-gizmo="select"]')?.classList.contains("active")
  }));
  await forgeFrameLocator.locator('[data-gizmo="translate"]').click();
  await frame.waitForFunction(() => window.ForgeGizmo?.state?.mode === "translate", null, {timeout:5000});
  const moveModeActive = await frame.evaluate(() => ({
    mode:window.ForgeGizmo?.state?.mode,
    active:document.querySelector('[data-gizmo="translate"]')?.classList.contains("active")
  }));
  if(selectModeActive.mode!=="select"||!selectModeActive.active||moveModeActive.mode!=="translate"||!moveModeActive.active) {
    throw new Error("Selection/Move tool state did not follow the active viewport control: "+JSON.stringify({selectModeActive,moveModeActive}));
  }

  const entityCountBefore = await frame.evaluate(() => window.Forge.entities.size);
  await forgeFrameLocator.locator('[data-add="sphere"]').first().click();
  await frame.waitForFunction(previous => window.Forge.entities.size === previous + 1, entityCountBefore, { timeout: 10000 });
  const entityCountAfterAdd = await frame.evaluate(() => window.Forge.entities.size);
  const uiSphereId = await frame.evaluate(() => window.Forge.selectedId);
  const transformLayout = await frame.evaluate(() => ({
    rows:[...document.querySelectorAll(".right-panel .vector-grid")].slice(0,3).map(row=>({
      columnCount:getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length,
      columns:getComputedStyle(row).gridTemplateColumns,
      inputs:[...row.querySelectorAll("input")].map(input=>{
        const r=input.getBoundingClientRect(),panel=document.querySelector(".right-panel").getBoundingClientRect();
        return {id:input.id,width:Math.round(r.width),visible:r.width>0&&r.height>0,left:Math.round(r.left),right:Math.round(r.right),insidePanel:r.left>=panel.left&&r.right<=panel.right+1};
      })
    }))
  }));
  if(transformLayout.rows.length!==3||transformLayout.rows.some(row=>row.columnCount!==3||row.inputs.length!==3||row.inputs.some(input=>!input.visible||input.width<45||!input.insidePanel))) {
    throw new Error("Inspector must show all 9 transform fields in 3 aligned columns without clipping: "+JSON.stringify(transformLayout));
  }
  const axisContract=await frame.evaluate(()=>window.ForgeViewport.status());
  if(!axisContract.axes?.y||axisContract.axisYColor!=="#35d982") throw new Error("The vertical world axis must use the green emissive axis material: "+JSON.stringify(axisContract));

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
  // The Timeline is contextually hidden until the Animation workspace is selected.
  await forgeFrameLocator.locator('[data-workspace-target="animation"]').click();
  await frame.waitForFunction(() => document.documentElement.dataset.editorWorkspace==="animation"&&document.querySelector(".timeline-shell")?.open===true,null,{timeout:5000});
  const timelineButton = forgeFrameLocator.locator("#timelinePlay");
  await timelineButton.click();
  await frame.waitForFunction(() => window.Forge.timelinePlaying === true, null, {timeout:5000});
  const timelineStarted = await frame.evaluate(() => ({timelinePlaying:window.Forge.timelinePlaying,running:window.Forge.running,pressed:document.querySelector("#timelinePlay")?.getAttribute("aria-pressed")}));
  await timelineButton.click();
  await frame.waitForFunction(() => window.Forge.timelinePlaying === false, null, {timeout:5000});
  const timelineStopped = await frame.evaluate(() => ({timelinePlaying:window.Forge.timelinePlaying,running:window.Forge.running,pressed:document.querySelector("#timelinePlay")?.getAttribute("aria-pressed")}));
  if(timelineStarted.timelinePlaying!==true||timelineStarted.running!==false||timelineStarted.pressed!=="true"||timelineStopped.timelinePlaying!==false||timelineStopped.running!==false||timelineStopped.pressed!=="false"){
    throw new Error("Animation timeline transport must be independent from scene preview: "+JSON.stringify({timelineStarted,timelineStopped}));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  await forgeFrameLocator.locator("#mobileAnimation").click();
  await frame.waitForFunction(()=>document.documentElement.dataset.editorWorkspace==="animation"&&document.querySelector(".timeline-shell")?.open===true,null,{timeout:5000});
  const mobileTimelineCheck=await frame.evaluate(()=>({buttonVisible:(()=>{const e=document.querySelector("#mobileAnimation"),r=e?.getBoundingClientRect();return !!e&&!!r&&r.width>0&&r.height>0})(),timelineVisible:getComputedStyle(document.querySelector(".timeline-shell")).display!=="none",timelineOpen:document.querySelector(".timeline-shell")?.open===true}));
  await forgeFrameLocator.locator("#mobileScene").click();
  await frame.waitForFunction(()=>document.documentElement.dataset.editorWorkspace==="layout",null,{timeout:5000});
  await forgeFrameLocator.locator("#viewport").click({position:{x:40,y:80},force:true});
  await sleep(120);
  if(!mobileTimelineCheck.buttonVisible||!mobileTimelineCheck.timelineVisible||!mobileTimelineCheck.timelineOpen){
    throw new Error("Mobile Animation control did not expose the timeline: "+JSON.stringify(mobileTimelineCheck));
  }
  const frameBox = await page.locator('iframe[title="Forge Studio 3.7"]').boundingBox();
  const canvasRect = await frame.evaluate(() => {
    const r=document.querySelector("#viewport").getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  });
  // Reference QA leaves the editor in an orthographic view. Restore perspective
  // before measuring wheel zoom against camera distance; ortho zoom changes orthoHeight.
  await forgeFrameLocator.locator('[data-view="perspective"]').click();
  await frame.waitForFunction(() => window.Forge.viewMode === "perspective", null, { timeout: 5000 });
  const projectionBeforeNavigation = await frame.evaluate(() => window.ForgeViewport.status().camera.projection);
  if (projectionBeforeNavigation !== "perspective") {
    throw new Error("Camera navigation test must start in perspective projection: " + projectionBeforeNavigation);
  }
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
    mobileControls: [...document.querySelectorAll("#mobileScene,#mobileAnimation,#mobileInspector")].map(e=>({id:e.id,visible:e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0})),
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
    transformLayout,
    axisContract,
    toolboxCheck,
    toolboxClosed,
    selectModeActive,
    moveModeActive,
    viewportNavigation,
    agentControl,
    mobile,
    pageErrors,
    consoleErrors,
    failedRequests,
    screenshots: ["forge-port-desktop.png", "forge-port-mobile.png"],
    referenceStudio: {loaded:true, calibration:referenceBeforeViewSwitch.guide.worldWidth, orthographicVisibility:true, hiddenDuringPlay:true, sceneEntityIsolation:referenceCleanup.entityCount===referenceBeforeViewSwitch.entityCount, cleanup:referenceCleanup.referenceCount===0}
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
