#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import chromiumModule from "@sparticuz/chromium";
import { chromium } from "playwright-core";

const Chromium = chromiumModule.default || chromiumModule;
const URL_TO_TEST = process.env.FORGE_NEXT_URL || "http://127.0.0.1:4173/forge/forge-next/index.html";
const ARTIFACTS = process.env.FORGE_NEXT_ARTIFACTS || path.resolve("artifacts/forge-next");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
if (!["127.0.0.1","localhost"].includes(new URL(URL_TO_TEST).hostname)) {
  throw new Error("Forge Next smoke tests only accept a local preview URL.");
}
await fs.mkdir(ARTIFACTS,{recursive:true});
const browser = await chromium.launch({headless:true,executablePath:await Chromium.executablePath(),args:Chromium.args,timeout:60000});
const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const pageErrors=[],consoleErrors=[],failedRequests=[];
page.on("pageerror",error=>pageErrors.push(String(error?.stack||error)));
page.on("console",message=>{if(message.type()==="error")consoleErrors.push(message.text().slice(0,600))});
page.on("requestfailed",request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText||"request failed"}));
let report;
try {
  const response=await page.goto(URL_TO_TEST,{waitUntil:"domcontentloaded",timeout:60000});
  if(!response||response.status()!==200)throw new Error("Forge Next returned HTTP "+(response?.status()??"no response"));
  await page.waitForFunction(()=>window.ForgeReady===true||window.ForgeBootState==="ready",null,{timeout:60000});
  await page.waitForFunction(()=>!!window.Forge?.app&&!!window.ForgeViewport?.status?.(),null,{timeout:15000});
  await sleep(400);

  const initial=await page.evaluate(()=>({
    title:document.title,ready:window.ForgeReady===true,bootState:window.ForgeBootState||null,
    entityCount:window.Forge?.entities?.size??null,selected:window.Forge?.selected?.()?.name||null,
    viewport:(()=>{const e=document.querySelector("#viewport"),r=e?.getBoundingClientRect();return{width:Math.round(r?.width||0),height:Math.round(r?.height||0),visible:!!r&&r.width>300&&r.height>250}})(),
    workspaces:[...document.querySelectorAll("[data-workspace]")].map(e=>({name:e.dataset.workspace,visible:e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0})),
    duplicateIds:[...document.querySelectorAll("[id]")].map(e=>e.id).filter((id,i,all)=>all.indexOf(id)!==i).filter((id,i,all)=>all.indexOf(id)===i),
    unexpectedLegacyControls:document.querySelectorAll(".forge-prod, .mobile-dpad, .mobile-joystick").length,
    rootOverflow:document.documentElement.scrollWidth-innerWidth,
    modules:{viewport:!!window.ForgeViewport,spatial:!!window.ForgeSpatial,gizmo:!!window.ForgeGizmo,project:!!window.ForgeProject}
  }));
  if(!initial.ready||initial.bootState!=="ready")throw new Error("Forge Next boot contract failed: "+JSON.stringify(initial));
  if(!initial.viewport.visible)throw new Error("The main 3D viewport is too small or invisible: "+JSON.stringify(initial.viewport));
  if(initial.entityCount<4)throw new Error("Expected camera/light/ground plus a starter object.");
  if(!initial.selected)throw new Error("Starter object was not selected.");
  if(initial.duplicateIds.length)throw new Error("Duplicate HTML IDs: "+JSON.stringify(initial.duplicateIds));
  if(initial.unexpectedLegacyControls!==0)throw new Error("Legacy floating/play controls leaked into the new editor.");
  if(initial.rootOverflow>1)throw new Error("Desktop page has horizontal overflow: "+initial.rootOverflow);
  for(const [name,present] of Object.entries(initial.modules))if(!present)throw new Error("Missing vNext engine integration: "+name);
  if(initial.workspaces.length!==7)throw new Error("Expected seven functional workspace destinations.");

  // Create/select a real engine object and verify the tree follows engine state.
  const beforeCreate=await page.evaluate(()=>window.Forge.entities.size);
  await page.locator('[data-create="sphere"]').click();
  await page.waitForFunction(n=>window.Forge.entities.size===n+1,beforeCreate,{timeout:8000});
  const created=await page.evaluate(()=>({selected:window.Forge.selected()?.name,id:window.Forge.selectedId,rows:document.querySelectorAll("#hierarchy .tree-row").length}));
  if(!created.selected||created.rows!==beforeCreate+1)throw new Error("Scene create/hierarchy synchronization failed: "+JSON.stringify(created));

  // Transform, history and selection are driven by engine commands, not DOM-only state.
  await page.locator("#positionX").fill("2.5");
  await page.locator("#positionX").press("Tab");
  await page.waitForFunction(()=>Math.abs(window.Forge.selected().entity.getLocalPosition().x-2.5)<0.001,null,{timeout:5000});
  const transformed=await page.evaluate(()=>({x:window.Forge.selected().entity.getLocalPosition().x,history:window.Forge.history.length}));
  if(Math.abs(transformed.x-2.5)>0.001||transformed.history<1)throw new Error("Inspector transform did not reach engine state: "+JSON.stringify(transformed));
  await page.locator('[data-workspace="layout"]').click();
  await page.keyboard.press("Control+Z");
  await page.waitForFunction(()=>Math.abs(window.Forge.selected().entity.getLocalPosition().x-2.5)>0.001,null,{timeout:5000});
  await page.keyboard.press("Control+Shift+Z");
  await page.waitForFunction(()=>Math.abs(window.Forge.selected().entity.getLocalPosition().x-2.5)<0.001,null,{timeout:5000});

  // Confirm viewport tools alter real engine state and maintain a stable view controller.
  await page.locator('[data-view="front"]').click();
  await page.waitForFunction(()=>window.Forge.viewMode==="front",null,{timeout:5000});
  const front=await page.evaluate(()=>({mode:window.Forge.viewMode,projection:window.ForgeViewport.status().camera.projection}));
  if(front.mode!=="front"||front.projection!=="orthographic")throw new Error("Front view did not enter orthographic projection: "+JSON.stringify(front));
  await page.locator('[data-view="perspective"]').click();
  await page.waitForFunction(()=>window.Forge.viewMode==="perspective",null,{timeout:5000});
  await page.locator('[data-tool="translate"]').click();
  const moveTool=await page.evaluate(()=>({mode:window.ForgeGizmo.state.mode,active:document.querySelector('[data-tool="translate"]').classList.contains("is-active")}));
  if(moveTool.mode!=="translate"||!moveTool.active)throw new Error("Move tool state failed: "+JSON.stringify(moveTool));

  // Materials and timeline are separate workspaces. Preview state never toggles timeline playback.
  await page.locator('[data-workspace="materials"]').click();
  await page.locator("#materialColor").fill("#aa7744");
  await page.locator("#materialColor").press("Tab");
  await page.waitForFunction(()=>Math.abs(window.Forge.selected().components.material.color[0]-(170/255))<0.015,null,{timeout:5000});
  const material=await page.evaluate(()=>window.Forge.selected().components.material);
  if(!material||Math.abs(material.color[1]-(119/255))>0.02)throw new Error("Material editor did not write to the real engine material: "+JSON.stringify(material));
  await page.locator('[data-workspace="animation"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.forgeWorkspace==="animation"&&!document.querySelector("#timelinePanel").hidden,null,{timeout:5000});
  await page.locator('[data-command="keyframe"]').click();
  const keyCount=await page.evaluate(()=>window.Forge.keyframes.get(window.Forge.selectedId)?.length||0);
  if(keyCount!==1)throw new Error("Animation workspace did not record a keyframe.");
  await page.locator('[data-command="timeline-play"]').click();
  await page.waitForFunction(()=>window.Forge.timelinePlaying===true,null,{timeout:5000});
  const timelineOnly=await page.evaluate(()=>({timeline:window.Forge.timelinePlaying,preview:window.Forge.running,pressed:document.querySelector("#timelinePlay").getAttribute("aria-pressed")}));
  if(!timelineOnly.timeline||timelineOnly.preview||timelineOnly.pressed!=="true")throw new Error("Timeline and Preview controls are coupled: "+JSON.stringify(timelineOnly));
  await page.locator('[data-command="timeline-play"]').click();
  await page.waitForFunction(()=>window.Forge.timelinePlaying===false,null,{timeout:5000});
  await page.locator("#previewScene").click();
  await page.waitForFunction(()=>window.Forge.running===true,null,{timeout:5000});
  const previewOnly=await page.evaluate(()=>({preview:window.Forge.running,timeline:window.Forge.timelinePlaying,pressed:document.querySelector("#previewScene").getAttribute("aria-pressed")}));
  if(!previewOnly.preview||previewOnly.timeline||previewOnly.pressed!=="true")throw new Error("Preview did not remain independent from timeline: "+JSON.stringify(previewOnly));
  await page.locator("#previewScene").click();
  await page.waitForFunction(()=>window.Forge.running===false,null,{timeout:5000});

  // A project download is an observable action, not a simulated success toast.
  const downloadPromise=page.waitForEvent("download",{timeout:10000});
  await page.locator('[data-command="save"]').click();
  const download=await downloadPromise;
  if(!/\.forge\.json$/.test(download.suggestedFilename()))throw new Error("Save did not produce a Forge project file: "+download.suggestedFilename());
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-desktop.png"),fullPage:true});

  // Resizing docks must persist layout dimensions without pushing the main page horizontally.
  const leftBefore=await page.evaluate(()=>parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-dock-width"),10));
  const splitter=page.locator('[data-splitter="left"]');
  const sr=await splitter.boundingBox();
  await page.mouse.move(sr.x+sr.width/2,sr.y+sr.height/2);
  await page.mouse.down();
  await page.mouse.move(sr.x+sr.width/2+22,sr.y+sr.height/2,{steps:6});
  await page.mouse.up();
  await sleep(100);
  const leftAfter=await page.evaluate(()=>parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-dock-width"),10));
  if(leftBefore===leftAfter)throw new Error("Left dock splitter did not change layout width.");
  const persisted=await page.evaluate(()=>!!localStorage.getItem("forge.next.preferences.v1"));
  if(!persisted)throw new Error("Editor layout preferences were not persisted.");
  await page.locator('.workspace-bar [data-command="reset-layout"]').click();

  // Responsive pass: no horizontal page scroll, all core view tools stay inside the screen,
  // and the Scene / Assets / Inspector / Animation drawers remain reachable.
  const mobileReports=[];
  for(const viewport of [{width:390,height:844},{width:360,height:800}]){
    await page.setViewportSize(viewport);await sleep(220);
    const base=await page.evaluate(()=>({
      width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      canvas:(()=>{const e=document.querySelector("#viewport"),r=e.getBoundingClientRect();return{width:Math.round(r.width),height:Math.round(r.height),visible:r.width>300&&r.height>250}})(),
      bottomBar:(()=>{const e=document.querySelector(".mobile-panel-bar"),r=e.getBoundingClientRect();return{visible:getComputedStyle(e).display!=="none"&&r.width>0&&r.bottom<=innerHeight+1,height:r.height}})(),
      workspaceBar:(()=>{const e=document.querySelector(".workspace-bar"),r=e.getBoundingClientRect();return{visible:r.width>0&&r.height>0,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}})(),
      previewVisible:(()=>{const e=document.querySelector("#previewScene"),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth+1})()
    }));
    if(base.scrollWidth>viewport.width+1)throw new Error("Mobile root overflows horizontally at "+viewport.width+"px: "+JSON.stringify(base));
    if(!base.canvas.visible||!base.bottomBar.visible||!base.previewVisible)throw new Error("Mobile viewport or primary controls are unusable at "+viewport.width+"px: "+JSON.stringify(base));
    await page.locator('[data-mobile-panel="scene"]').click();
    await page.waitForFunction(()=>document.querySelector("#leftDock").classList.contains("is-open"),null,{timeout:5000});
    await page.locator("#drawerScrim").click({position:{x:viewport.width-3,y:viewport.height/2}});
    await page.waitForFunction(()=>!document.querySelector("#leftDock").classList.contains("is-open"),null,{timeout:5000});
    await page.locator('[data-mobile-panel="properties"]').click();
    await page.waitForFunction(()=>document.querySelector("#rightDock").classList.contains("is-open"),null,{timeout:5000});
    await page.locator("#drawerScrim").click({position:{x:3,y:viewport.height/2}});
    await page.waitForFunction(()=>!document.querySelector("#rightDock").classList.contains("is-open"),null,{timeout:5000});
    await page.locator('[data-mobile-panel="timeline"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.forgeWorkspace==="animation"&&!document.querySelector("#timelinePanel").hidden,null,{timeout:5000});
    const timelineVisible=await page.evaluate(()=>{const e=document.querySelector("#timelinePanel"),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom<=innerHeight-document.querySelector(".mobile-panel-bar").getBoundingClientRect().height+2});
    if(!timelineVisible)throw new Error("Mobile Animation workspace does not leave the timeline accessible at "+viewport.width+"px.");
    mobileReports.push({...base,timelineVisible});
    await page.screenshot({path:path.join(ARTIFACTS,"forge-next-mobile-"+viewport.width+".png"),fullPage:true});
  }
  await page.evaluate(()=>{window.Forge.timelinePlaying=false;window.Forge.running=false});
  report={ok:true,url:URL_TO_TEST,httpStatus:response.status(),initial,created,transformed,front,moveTool,material,timelineOnly,previewOnly,saveDownload:download.suggestedFilename(),dockResize:{leftBefore,leftAfter,persisted},mobileReports,pageErrors,consoleErrors,failedRequests};
  if(pageErrors.length)throw new Error("Uncaught browser errors: "+pageErrors.join("\n"));
  if(consoleErrors.length)throw new Error("Browser console errors: "+consoleErrors.join("\n"));
} catch(error) {
  report={ok:false,url:URL_TO_TEST,error:String(error?.stack||error),pageErrors,consoleErrors,failedRequests};
  try{await page.screenshot({path:path.join(ARTIFACTS,"forge-next-failure.png"),fullPage:true})}catch{}
  process.exitCode=1;
} finally {
  await fs.writeFile(path.join(ARTIFACTS,"forge-next-report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
}
