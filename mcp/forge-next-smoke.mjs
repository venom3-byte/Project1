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
  if(initial.workspaces.length!==8)throw new Error("Expected eight task workspaces including Image Model.");

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
  const moveTool=await page.evaluate(()=>({mode:window.ForgeGizmo.state.mode,active:document.querySelector('[data-tool="translate"]').classList.contains("is-active"),size:window.ForgeGizmo.state.gizmos.translate.size}));
  if(moveTool.mode!=="translate"||!moveTool.active||Math.abs(moveTool.size-.55)>.001)throw new Error("Move tool state or viewport gizmo scale failed: "+JSON.stringify(moveTool));

  // Materials and timeline are separate workspaces. Preview state never toggles timeline playback.
  await page.locator('[data-workspace="materials"]').click();
  await page.locator("#materialColor").fill("#aa7744");
  await page.locator("#materialColor").press("Tab");
  await page.waitForFunction(()=>Math.abs(window.Forge.selected().components.material.color[0]-(170/255))<0.015,null,{timeout:5000});
  const material=await page.evaluate(()=>window.Forge.selected().components.material);
  if(!material||Math.abs(material.color[1]-(119/255))>0.02)throw new Error("Material editor did not write to the real engine material: "+JSON.stringify(material));
  await page.locator('[data-workspace="animation"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.forgeWorkspace==="animation"&&!document.querySelector("#timelinePanel").hidden,null,{timeout:5000});
  await page.locator("#keyInterpolation").selectOption("ease");
  await page.locator("#currentFrame").fill("0");await page.locator("#currentFrame").press("Tab");
  await page.locator('[data-command="keyframe"]').click();
  const firstKey=await page.evaluate(()=>({keys:window.Forge.keyframes.get(window.Forge.selectedId)?.length||0,mode:window.Forge.keyframes.get(window.Forge.selectedId)?.[0]?.interpolation}));
  if(firstKey.keys!==1||firstKey.mode!=="ease")throw new Error("Animation workspace did not record a key with selected interpolation: "+JSON.stringify(firstKey));
  await page.locator("#currentFrame").fill("24");await page.locator("#currentFrame").press("Tab");
  await page.locator("#positionX").fill("4.5");await page.locator("#positionX").press("Tab");
  await page.locator('[data-command="keyframe"]').click();
  const twoKeys=await page.evaluate(()=>({keys:window.Forge.keyframes.get(window.Forge.selectedId)?.length||0,markers:document.querySelectorAll(".timeline-key-marker").length}));
  if(twoKeys.keys!==2||twoKeys.markers!==6)throw new Error("Two animation keys were not rendered across the three transform lanes: "+JSON.stringify(twoKeys));
  await page.locator("#currentFrame").fill("12");await page.locator("#currentFrame").press("Tab");
  await page.waitForFunction(()=>Math.abs(window.Forge.selected().entity.getLocalPosition().x-3.5)<0.05,null,{timeout:5000});
  const interpolated=await page.evaluate(()=>({frame:Number(document.querySelector("#currentFrame").value),x:window.Forge.selected().entity.getLocalPosition().x,keys:window.Forge.keyframes.get(window.Forge.selectedId).length}));
  if(interpolated.frame!==12||Math.abs(interpolated.x-3.5)>0.05)throw new Error("Timeline scrubbing or Ease interpolation failed: "+JSON.stringify(interpolated));

  // Graph Editor must plot a selected transform channel and make its key value draggable.
  await page.locator('[data-timeline-view="graph"]').click();
  await page.waitForFunction(()=>!document.querySelector("#graphEditorPane").hidden&&document.querySelector("#timelineDopeSheet").hidden,null,{timeout:5000});
  const graphInitial=await page.evaluate(()=>({visible:!document.querySelector("#graphEditorPane").hidden,canvas:[document.querySelector("#graphEditorCanvas").width,document.querySelector("#graphEditorCanvas").height],label:document.querySelector("#graphChannelSummary").textContent,metrics:!!document.querySelector("#graphEditorCanvas").__graphMetrics,keys:window.Forge.keyframes.get(window.Forge.selectedId)?.length||0,channel:document.querySelector("#graphChannel").value}));
  if(!graphInitial.visible||graphInitial.canvas[0]<120||graphInitial.canvas[1]<80||graphInitial.label!=="Location X"||!graphInitial.metrics||graphInitial.keys!==2||graphInitial.channel!=="p0")throw new Error("Graph Editor curve did not initialize: "+JSON.stringify(graphInitial));
  const graphPoint=await page.evaluate(()=>{const c=document.querySelector("#graphEditorCanvas"),m=c.__graphMetrics,k=window.Forge.keyframes.get(window.Forge.selectedId).find(x=>Math.round(x.time*24)===24);return{x:m.xFor(k.time),y:m.yFor(k.p[0]),value:k.p[0]}});
  await page.mouse.move((await page.locator("#graphEditorCanvas").boundingBox()).x+graphPoint.x,(await page.locator("#graphEditorCanvas").boundingBox()).y+graphPoint.y);
  await page.mouse.down();
  const gb=await page.locator("#graphEditorCanvas").boundingBox();
  await page.mouse.move(gb.x+graphPoint.x,gb.y+graphPoint.y+18,{steps:5});await page.mouse.up();
  const graphEdited=await page.evaluate(()=>({value:window.Forge.keyframes.get(window.Forge.selectedId).find(x=>Math.round(x.time*24)===24).p[0],timelineView:document.querySelector('[data-timeline-view="graph"]').getAttribute("aria-selected"),objectX:window.Forge.selected().entity.getLocalPosition().x}));
  if(!(graphEdited.value<graphPoint.value-0.1)||graphEdited.timelineView!=="true")throw new Error("Graph Editor drag did not edit the Location X key: "+JSON.stringify({graphPoint,graphEdited}));
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-graph-editor.png"),fullPage:true});
  await page.locator('[data-timeline-view="dopesheet"]').click();
  await page.waitForFunction(()=>!document.querySelector("#timelineDopeSheet").hidden&&document.querySelector("#graphEditorPane").hidden,null,{timeout:5000});

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

  // Verify playback wraps at the end frame when Loop is enabled, and stops when disabled.
  const loopDefault=await page.evaluate(()=>window.Forge.timelineLoop);
  if(loopDefault!==true)throw new Error("Animation timeline should loop by default.");
  await page.evaluate(()=>{window.Forge.timelineStart=0;window.Forge.timelineEnd=10;window.Forge.timelineLoop=true;window.Forge.timelineTime=9.99;window.Forge.timelinePlaying=true});
  await page.waitForFunction(()=>window.Forge.timelinePlaying&&window.Forge.timelineTime<0.2,null,{timeout:5000});
  await page.locator("#timelineLoop").click();
  await page.waitForFunction(()=>window.Forge.timelineLoop===false,null,{timeout:5000});
  await page.evaluate(()=>{window.Forge.timelineTime=9.99;window.Forge.timelinePlaying=true});
  await page.waitForFunction(()=>window.Forge.timelinePlaying===false&&window.Forge.timelineTime>=9.99,null,{timeout:5000});
  await page.locator("#timelineLoop").click();
  await page.waitForFunction(()=>window.Forge.timelineLoop===true,null,{timeout:5000});
  await page.locator("#currentFrame").fill("36");await page.locator("#currentFrame").press("Tab");
  await page.locator('[data-command="toggle-auto-key"]').click();
  await page.locator("#currentFrame").fill("36");await page.locator("#currentFrame").press("Tab");
  await page.locator("#positionY").fill("3.25");await page.locator("#positionY").press("Tab");
  const autoKeyResult=await page.evaluate(()=>({enabled:document.querySelector("#autoKeyButton").getAttribute("aria-pressed"),keys:window.Forge.keyframes.get(window.Forge.selectedId)?.length||0,has36:window.Forge.keyframes.get(window.Forge.selectedId)?.some(k=>Math.round(k.time*24)===36)}));
  if(autoKeyResult.enabled!=="true"||!autoKeyResult.has36)throw new Error("Auto-key did not record the edited transform: "+JSON.stringify(autoKeyResult));
  await page.locator('[data-command="toggle-auto-key"]').click();

  // A project download is an observable action, not a simulated success toast.
  const downloadPromise=page.waitForEvent("download",{timeout:10000});
  await page.locator('[data-command="save"]').click();
  const download=await downloadPromise;
  if(!/\.forge\.json$/.test(download.suggestedFilename()))throw new Error("Save did not produce a Forge project file: "+download.suggestedFilename());
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-desktop.png"),fullPage:true});

  // Calibrate a front reference, save its traced contour, and build an editable 3D slab.
  await page.locator('[data-workspace="references"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.forgeWorkspace==="references"&&!document.querySelector('[data-inspector-panel="references"]').hidden,null,{timeout:5000});
  await page.locator("#referenceAxis").selectOption("front");await page.locator("#referenceWidth").fill("3.2");
  const frontPng=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=2;c.height=2;const x=c.getContext("2d");x.fillStyle="#f0f0f0";x.fillRect(0,0,2,2);return c.toDataURL("image/png").split(",")[1]}),"base64");
  await page.locator("#referenceInput").setInputFiles({name:"qa-front-reference.png",mimeType:"image/png",buffer:frontPng});
  await page.waitForFunction(()=>[...window.Forge.entities.values()].some(r=>r.components?.reference?.name==="qa-front-reference.png"),null,{timeout:10000});
  const frontCalibration=await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-front-reference.png"),rot=r.entity.getLocalEulerAngles(),scale=r.entity.getLocalScale();return{axis:r.components.reference.axis,width:r.components.reference.width,scale:[scale.x,scale.y,scale.z],rotation:[rot.x,rot.y,rot.z],panelCount:Number(document.querySelector("#referenceCount").textContent)}});
  if(frontCalibration.axis!=="front"||Math.abs(frontCalibration.width-3.2)>0.001||Math.abs(frontCalibration.scale[0]-3.2)>0.001||Math.abs(frontCalibration.rotation[0]-90)>0.01||frontCalibration.panelCount!==1)throw new Error("Front reference calibration failed: "+JSON.stringify(frontCalibration));

  // The same UI can recalibrate an image plane to side view, then restore front for the front outline.
  await page.locator("#referenceAxis").selectOption("side");await page.locator("#referenceWidth").fill("4.5");await page.locator('[data-command="apply-reference-setup"]').click();
  const sideAlignment=await page.evaluate(()=>{const r=window.Forge.selected(),rot=r.entity.getLocalEulerAngles(),scale=r.entity.getLocalScale();return{axis:r.components.reference.axis,width:r.components.reference.width,rotY:rot.y,scaleX:scale.x}});
  if(sideAlignment.axis!=="side"||Math.abs(sideAlignment.width-4.5)>0.001||Math.abs(sideAlignment.rotY-90)>0.01||Math.abs(sideAlignment.scaleX-4.5)>0.001)throw new Error("Side reference alignment failed: "+JSON.stringify(sideAlignment));
  await page.locator('[data-command="toggle-reference-visibility"]').click();if(await page.evaluate(()=>window.Forge.selected().entity.enabled)!==false)throw new Error("Reference hide action failed.");
  await page.locator('[data-command="toggle-reference-visibility"]').click();if(await page.evaluate(()=>window.Forge.selected().entity.enabled)!==true)throw new Error("Reference show action failed.");
  await page.locator("#referenceAxis").selectOption("front");await page.locator("#referenceWidth").fill("3.2");await page.locator('[data-command="apply-reference-setup"]').click();

  await page.locator("#traceSilhouette").click();
  await page.waitForFunction(()=>document.querySelector("#traceDialog").open,null,{timeout:5000});
  const traceRect=await page.locator("#traceCanvas").boundingBox();
  if(!traceRect||traceRect.width<100||traceRect.height<100)throw new Error("Silhouette trace canvas is too small: "+JSON.stringify(traceRect));
  for(const [u,v] of [[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8]])await page.mouse.click(traceRect.x+traceRect.width*u,traceRect.y+traceRect.height*v);
  if(!(await page.locator("#tracePointCount").textContent())?.includes("4 points"))throw new Error("Trace editor did not register four points.");
  await page.locator("#traceSaveOutline").click();
  const savedFront=await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-front-reference.png");return{axis:r.components.reference.axis,count:r.components.reference.outline?.length||0}});
  if(savedFront.axis!=="front"||savedFront.count!==4)throw new Error("Front contour was not saved to the reference component: "+JSON.stringify(savedFront));
  await page.locator("#traceDepth").fill("0.5");await page.locator("#traceBuild").click();
  await page.waitForFunction(()=>window.Forge.selected()?.components?.geometry?.kind==="extruded-silhouette",null,{timeout:5000});
  const builtSlab=await page.evaluate(()=>{const r=window.Forge.selected(),g=r.components.geometry,instances=r.entity.render?.meshInstances||[],saved=window.Forge.serialize().entities.find(e=>e.components?.geometry?.kind==="extruded-silhouette");return{kind:r.kind,axis:g.axis,depth:g.depth,points:g.contour.length,rendered:instances.length,indices:instances[0]?.mesh?.primitive?.[0]?.count||0,saved:!!saved,savedPoints:saved?.components?.geometry?.contour?.length||0}});
  if(builtSlab.kind!=="mesh"||builtSlab.axis!=="front"||Math.abs(builtSlab.depth-0.5)>0.001||builtSlab.points!==4||builtSlab.rendered!==1||builtSlab.indices<36||!builtSlab.saved||builtSlab.savedPoints!==4)throw new Error("Silhouette slab generation/persistence failed: "+JSON.stringify(builtSlab));
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-silhouette-mesh.png"),fullPage:true});

  // Import a dimensionally aligned side reference and save its separate outline.
  await page.locator('[data-workspace="references"]').click();
  await page.locator("#referenceAxis").selectOption("side");await page.locator("#referenceWidth").fill("4.5");
  const sidePng=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=45;c.height=32;const x=c.getContext("2d");x.fillStyle="#dedede";x.fillRect(0,0,c.width,c.height);return c.toDataURL("image/png").split(",")[1]}),"base64");
  await page.locator("#referenceInput").setInputFiles({name:"qa-side-reference.png",mimeType:"image/png",buffer:sidePng});
  await page.waitForFunction(()=>[...window.Forge.entities.values()].some(r=>r.components?.reference?.name==="qa-side-reference.png"),null,{timeout:10000});
  const side=await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-side-reference.png");return{axis:r.components.reference.axis,width:r.components.reference.width,height:r.components.reference.height}});
  if(side.axis!=="side"||Math.abs(side.width-4.5)>0.001||Math.abs(side.height-3.2)>0.01)throw new Error("Side reference dimensions are inconsistent: "+JSON.stringify(side));
  await page.locator("#traceSilhouette").click();await page.waitForFunction(()=>document.querySelector("#traceDialog").open,null,{timeout:5000});
  const sideRect=await page.locator("#traceCanvas").boundingBox();
  for(const [u,v] of [[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8]])await page.mouse.click(sideRect.x+sideRect.width*u,sideRect.y+sideRect.height*v);
  await page.locator("#traceSaveOutline").click();
  const savedSide=await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-side-reference.png");return{axis:r.components.reference.axis,count:r.components.reference.outline?.length||0}});
  if(savedSide.axis!=="side"||savedSide.count!==4)throw new Error("Side contour was not saved: "+JSON.stringify(savedSide));
  await page.locator("#traceClose").click();await page.waitForFunction(()=>!document.querySelector("#traceDialog").open,null,{timeout:5000});

  // Calibrate a top reference to the same X width as front and Z depth as side.
  await page.locator("#referenceAxis").selectOption("top");await page.locator("#referenceWidth").fill("3.2");
  const topPng=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=32;c.height=45;const x=c.getContext("2d");x.fillStyle="#d1d1d1";x.fillRect(0,0,c.width,c.height);return c.toDataURL("image/png").split(",")[1]}),"base64");
  await page.locator("#referenceInput").setInputFiles({name:"qa-top-reference.png",mimeType:"image/png",buffer:topPng});
  await page.waitForFunction(()=>[...window.Forge.entities.values()].some(r=>r.components?.reference?.name==="qa-top-reference.png"),null,{timeout:10000});
  const topDimensions=await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-top-reference.png");return{axis:r.components.reference.axis,width:r.components.reference.width,height:r.components.reference.height}});
  if(topDimensions.axis!=="top"||Math.abs(topDimensions.width-3.2)>0.001||Math.abs(topDimensions.height-4.5)>0.01)throw new Error("Top reference dimensions are inconsistent: "+JSON.stringify(topDimensions));
  await page.locator("#traceSilhouette").click();await page.waitForFunction(()=>document.querySelector("#traceDialog").open,null,{timeout:5000});
  const topRect=await page.locator("#traceCanvas").boundingBox();
  for(const [u,v] of [[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8]])await page.mouse.click(topRect.x+topRect.width*u,topRect.y+topRect.height*v);
  await page.locator("#traceSaveOutline").click();
  const savedTop=await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-top-reference.png");return{axis:r.components.reference.axis,count:r.components.reference.outline?.length||0}});
  if(savedTop.axis!=="top"||savedTop.count!==4)throw new Error("Top contour was not saved: "+JSON.stringify(savedTop));
  await page.locator("#traceClose").click();await page.waitForFunction(()=>!document.querySelector("#traceDialog").open,null,{timeout:5000});

  await page.locator("#hullResolution").selectOption("20");await page.locator("#buildSilhouetteHull").click();
  await page.waitForFunction(()=>window.Forge.selected()?.components?.geometry?.kind==="silhouette-visual-hull",null,{timeout:10000});
  const hull=await page.evaluate(()=>{const r=window.Forge.selected(),g=r.components.geometry,d=r.components.diagnostics||{},instances=r.entity.render?.meshInstances||[],saved=window.Forge.serialize().entities.find(e=>e.components?.geometry?.kind==="silhouette-visual-hull");return{kind:r.kind,geoKind:g.kind,width:g.width,height:g.height,depth:g.depth,resolution:g.resolution,frontPoints:g.frontContour?.length||0,sidePoints:g.sideContour?.length||0,topPoints:g.topContour?.length||0,viewCount:d.viewCount||0,voxels:d.occupiedVoxels||0,rendered:instances.length,indices:instances[0]?.mesh?.primitive?.[0]?.count||0,saved:!!saved,savedFront:saved?.components?.geometry?.frontContour?.length||0,savedSide:saved?.components?.geometry?.sideContour?.length||0,savedTop:saved?.components?.geometry?.topContour?.length||0}});
  if(hull.kind!=="mesh"||hull.geoKind!=="silhouette-visual-hull"||Math.abs(hull.width-3.2)>0.01||Math.abs(hull.height-3.2)>0.05||Math.abs(hull.depth-4.5)>0.01||hull.resolution!==20||hull.frontPoints!==4||hull.sidePoints!==4||hull.topPoints!==4||hull.viewCount!==3||hull.voxels<=0||hull.rendered!==1||hull.indices<36||!hull.saved||hull.savedFront!==4||hull.savedSide!==4||hull.savedTop!==4)throw new Error("Three-view visual hull build/persistence failed: "+JSON.stringify(hull));
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-three-view-hull.png"),fullPage:true});

  // Reload the serialized scene and verify the reference images, contours, and 3D hull survive.
  const sceneBeforeReload=await page.evaluate(()=>window.Forge.serialize());
  const assetPersistence=await page.evaluate(async scene=>{
    const beforeRefs=scene.entities.filter(e=>e.components?.reference);
    const embedded=beforeRefs.length===3&&beforeRefs.every(e=>typeof e.components.reference.imageDataUrl==="string"&&e.components.reference.imageDataUrl.startsWith("data:image/"));
    await window.Forge.load(scene);
    const refs=[...window.Forge.entities.values()].filter(r=>r.components?.reference);
    const front=refs.find(r=>r.components.reference.name==="qa-front-reference.png");
    const side=refs.find(r=>r.components.reference.name==="qa-side-reference.png");
    const top=refs.find(r=>r.components.reference.name==="qa-top-reference.png");
    const hull=[...window.Forge.entities.values()].find(r=>r.components?.geometry?.kind==="silhouette-visual-hull");
    const imageRestored=r=>!!r&&!!window.Forge.assets.get(r.components.asset.name)?.file&&!!r.entity.render?.meshInstances?.[0]?.material?.diffuseMap;
    return{embedded,referenceCount:refs.length,frontOutline:front?.components.reference.outline?.length||0,sideOutline:side?.components.reference.outline?.length||0,topOutline:top?.components.reference.outline?.length||0,frontTextureRestored:imageRestored(front),sideTextureRestored:imageRestored(side),topTextureRestored:imageRestored(top),hullRestored:!!hull&&!!hull.entity.render?.meshInstances?.length,hullResolution:hull?.components.geometry.resolution||0,hullTopPoints:hull?.components.geometry.topContour?.length||0};
  },sceneBeforeReload);
  if(!assetPersistence.embedded||assetPersistence.referenceCount!==3||assetPersistence.frontOutline!==4||assetPersistence.sideOutline!==4||assetPersistence.topOutline!==4||!assetPersistence.frontTextureRestored||!assetPersistence.sideTextureRestored||!assetPersistence.topTextureRestored||!assetPersistence.hullRestored||assetPersistence.hullResolution!==20||assetPersistence.hullTopPoints!==4)throw new Error("Reference/contour/three-view hull project round-trip failed: "+JSON.stringify(assetPersistence));
  await page.locator('[data-workspace="references"]').click();
  await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-side-reference.png");window.Forge.select(r.id)});
  await page.locator("#traceSilhouette").click();
  await page.waitForFunction(()=>document.querySelector("#traceDialog").open&&document.querySelector("#tracePointCount").textContent.includes("4 points"),null,{timeout:10000});
  const editRect=await page.locator("#traceCanvas").boundingBox();
  await page.mouse.move(editRect.x+editRect.width*0.8,editRect.y+editRect.height*0.2);
  await page.mouse.down();await page.mouse.move(editRect.x+editRect.width*0.75,editRect.y+editRect.height*0.27,{steps:5});await page.mouse.up();
  await page.locator("#traceSaveOutline").click();
  const editedOutline=await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-side-reference.png");return r.components.reference.outline?.[1]||null});
  if(!editedOutline||Math.abs(editedOutline[0]-0.75)>0.04||Math.abs(editedOutline[1]-0.27)>0.04)throw new Error("Dragging a saved contour point failed: "+JSON.stringify(editedOutline));
  await page.locator("#traceClose").click();
  await page.waitForFunction(()=>!document.querySelector("#traceDialog").open,null,{timeout:5000});

  // Isolate the rotational-modeling test from earlier reference volumes so the bottle can be visually inspected.
  await page.evaluate(()=>{window.Forge.resetScene(true);window.ForgeRefreshUI?.()});
  await page.waitForFunction(()=>window.Forge.entities.size===3,null,{timeout:5000});

  // Follow the video technique: trace a bottle's radial cross-section, then Spin 360 degrees.
  await page.locator('[data-workspace="references"]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-inspector-panel="references"]').hidden,null,{timeout:5000});
  await page.locator("#referenceAxis").selectOption("front");await page.locator("#referenceWidth").fill("0.08");
  const bottlePng=Buffer.from(await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=100;c.height=240;const x=c.getContext("2d");
    x.fillStyle="#ececec";x.fillRect(0,0,c.width,c.height);
    x.strokeStyle="#8d9aa4";x.lineWidth=2;x.fillStyle="#c8d5dc";x.beginPath();
    x.moveTo(50,220);x.lineTo(82,220);x.lineTo(82,173);x.lineTo(78,139);x.lineTo(66,111);x.lineTo(64,60);x.lineTo(64,36);
    x.lineTo(56,36);x.lineTo(56,60);x.lineTo(59,112);x.lineTo(71,143);x.lineTo(74,176);x.lineTo(74,190);x.lineTo(50,190);x.closePath();x.fill();x.stroke();
    return c.toDataURL("image/png").split(",")[1]
  }),"base64");
  await page.locator("#referenceInput").setInputFiles({name:"qa-bottle-reference.png",mimeType:"image/png",buffer:bottlePng});
  await page.waitForFunction(()=>[...window.Forge.entities.values()].some(r=>r.components?.reference?.name==="qa-bottle-reference.png"),null,{timeout:10000});
  await page.locator("#latheDiameter").fill("0.08");await page.locator("#latheHeight").fill("0.25");await page.locator("#latheSegments").selectOption("32");
  await page.locator("#traceLatheProfile").click();
  await page.waitForFunction(()=>document.querySelector("#traceDialog").open&&document.querySelector("#traceModeLabel").textContent.includes("REVOLVE 360"),null,{timeout:5000});
  const bottleTraceRect=await page.locator("#traceCanvas").boundingBox();
  const bottleProfile=[[.82,.92],[.82,.72],[.78,.58],[.66,.45],[.64,.25],[.64,.14],[.56,.14],[.56,.27],[.60,.46],[.73,.65],[.73,.78],[.56,.92],[.70,.92]];
  for(const [u,v] of bottleProfile)await page.mouse.click(bottleTraceRect.x+bottleTraceRect.width*u,bottleTraceRect.y+bottleTraceRect.height*v);
  const profileCount=await page.locator("#tracePointCount").textContent();
  if(!profileCount?.includes("13 points"))throw new Error("Lathe profile tracer did not record all 13 points: "+profileCount);
  await page.locator("#traceSaveOutline").click();
  const savedProfile=await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-bottle-reference.png");return{profile:r.components.reference.latheProfile?.length||0,outline:r.components.reference.outline?.length||0}});
  if(savedProfile.profile!==13||savedProfile.outline!==0)throw new Error("Spin profile was not stored separately from a closed silhouette: "+JSON.stringify(savedProfile));
  await page.locator("#traceBuildLathe").click();
  await page.waitForFunction(()=>window.Forge.selected()?.components?.geometry?.kind==="lathe-profile",null,{timeout:10000});
  const latheMesh=await page.evaluate(()=>{const r=window.Forge.selected(),g=r.components.geometry,d=r.components.diagnostics||{},instances=r.entity.render?.meshInstances||[],saved=window.Forge.serialize().entities.find(e=>e.components?.geometry?.kind==="lathe-profile");return{kind:r.kind,name:r.name,geoKind:g.kind,axis:g.axis,segments:g.segments,smoothing:g.smoothing,diameter:g.diameter,height:g.height,profile:g.profile?.length||0,smoothedProfile:d.smoothedProfilePoints||0,revolve:g.revolveDegrees,vertices:d.vertices||0,triangles:d.triangles||0,rendered:instances.length,indexCount:instances[0]?.mesh?.primitive?.[0]?.count||0,saved:!!saved,savedPoints:saved?.components?.geometry?.profile?.length||0,savedSmoothing:saved?.components?.geometry?.smoothing||0}});
  if(latheMesh.kind!=="mesh"||latheMesh.geoKind!=="lathe-profile"||latheMesh.axis!=="Y"||latheMesh.segments!==32||latheMesh.smoothing!==1||Math.abs(latheMesh.diameter-.08)>.001||Math.abs(latheMesh.height-.25)>.001||latheMesh.profile!==13||latheMesh.smoothedProfile!==25||latheMesh.revolve!==360||latheMesh.vertices!==latheMesh.smoothedProfile*latheMesh.segments||latheMesh.triangles<600||latheMesh.rendered!==1||latheMesh.indexCount<1800||!latheMesh.saved||latheMesh.savedPoints!==13||latheMesh.savedSmoothing!==1)throw new Error("Spin 360 lathe mesh creation with profile subdivision failed: "+JSON.stringify(latheMesh));
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-spin-lathe-bottle.png"),fullPage:true});
  const latheScene=await page.evaluate(()=>window.Forge.serialize());
  const latheReload=await page.evaluate(async data=>{
    await window.Forge.load(data);
    const r=[...window.Forge.entities.values()].find(item=>item.components?.geometry?.kind==="lathe-profile");
    const instance=r?.entity.render?.meshInstances?.[0];
    const ref=[...window.Forge.entities.values()].find(item=>item.components?.reference?.name==="qa-bottle-reference.png");
    return{found:!!r,segments:r?.components.geometry.segments||0,profile:r?.components.geometry.profile?.length||0,mesh:!!instance,indexCount:instance?.mesh?.primitive?.[0]?.count||0,savedReferenceProfile:ref?.components.reference.latheProfile?.length||0,imageEmbedded:typeof ref?.components.reference.imageDataUrl==="string"&&ref.components.reference.imageDataUrl.startsWith("data:image/")};
  },latheScene);
  if(!latheReload.found||latheReload.segments!==32||latheReload.profile!==13||!latheReload.mesh||latheReload.indexCount<1800||latheReload.savedReferenceProfile!==13||!latheReload.imageEmbedded)throw new Error("Lathe profile or mesh did not survive project reload: "+JSON.stringify(latheReload));
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-spin-lathe-roundtrip.png"),fullPage:true});

  // Automatic reconstruction: segment a centered bottle silhouette and build a hollow rotational mesh.
  await page.locator('[data-workspace="references"]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-inspector-panel="references"]').hidden,null,{timeout:5000});
  await page.locator("#referenceAxis").selectOption("front");await page.locator("#referenceWidth").fill("0.08");
  const autoBottlePng=Buffer.from(await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=160;c.height=240;const x=c.getContext("2d");
    x.fillStyle="#f7f7f7";x.fillRect(0,0,c.width,c.height);x.fillStyle="#262626";x.beginPath();
    x.moveTo(62,220);x.lineTo(98,220);x.lineTo(98,162);x.quadraticCurveTo(124,152,119,129);x.lineTo(102,93);x.lineTo(102,54);x.lineTo(93,54);x.lineTo(93,27);x.lineTo(67,27);x.lineTo(67,54);x.lineTo(58,54);x.lineTo(58,93);x.lineTo(41,129);x.quadraticCurveTo(36,152,62,162);x.closePath();x.fill();
    return c.toDataURL("image/png").split(",")[1]
  }),"base64");
  await page.locator("#referenceInput").setInputFiles({name:"qa-auto-bottle.png",mimeType:"image/png",buffer:autoBottlePng});
  await page.waitForFunction(()=>[...window.Forge.entities.values()].some(r=>r.components?.reference?.name==="qa-auto-bottle.png"),null,{timeout:10000});
  await page.locator("#latheDiameter").fill("0.08");await page.locator("#latheHeight").fill("0.25");await page.locator("#latheSegments").selectOption("48");await page.locator("#latheSmoothing").selectOption("2");
  await page.locator("#latheWallThickness").fill("0.002");await page.locator("#latheBaseThickness").fill("0.003");
  await page.locator("#autoSpinImage").click();
  await page.waitForFunction(()=>window.Forge.selected()?.components?.geometry?.kind==="lathe-profile"&&window.Forge.selected()?.components?.geometry?.sourceReference?.method==="auto rotational profile",null,{timeout:15000});
  const autoSpin=await page.evaluate(()=>{const r=window.Forge.selected(),g=r.components.geometry,d=r.components.diagnostics||{},src=g.sourceReference||{},ref=[...window.Forge.entities.values()].find(x=>x.components?.reference?.name==="qa-auto-bottle.png");return{kind:g.kind,profile:g.profile?.length||0,diameter:g.diameter,height:g.height,segments:g.segments,smoothing:g.smoothing,smoothedProfile:d.smoothedProfilePoints||0,vertices:d.vertices||0,triangles:d.triangles||0,wall:src.wallThickness,base:src.baseThickness,symmetry:src.symmetryScore,source:src.method,savedProfile:ref?.components.reference.latheProfile?.length||0,rendered:r.entity.render?.meshInstances?.length||0}});
  if(autoSpin.kind!=="lathe-profile"||autoSpin.profile<24||Math.abs(autoSpin.diameter-.08)>.001||Math.abs(autoSpin.height-.25)>.001||autoSpin.segments!==48||autoSpin.smoothing!==2||autoSpin.smoothedProfile<=autoSpin.profile||autoSpin.vertices!==autoSpin.smoothedProfile*autoSpin.segments||autoSpin.triangles<1200||Math.abs(autoSpin.wall-.002)>.0001||Math.abs(autoSpin.base-.003)>.0001||autoSpin.symmetry<.58||autoSpin.source!=="auto rotational profile"||autoSpin.savedProfile!==autoSpin.profile||autoSpin.rendered!==1)throw new Error("One-click automatic Spin reconstruction failed: "+JSON.stringify(autoSpin));
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-auto-spin-bottle.png"),fullPage:true});

  // Automatic outer-contour extraction must preserve a concave outline before extrusion.
  await page.locator('[data-workspace="references"]').click();await page.locator("#referenceAxis").selectOption("front");await page.locator("#referenceWidth").fill("2.4");
  const irregularPng=Buffer.from(await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=180;c.height=140;const x=c.getContext("2d");x.fillStyle="#fafafa";x.fillRect(0,0,c.width,c.height);x.fillStyle="#272727";x.beginPath();
    const p=[[20,50],[48,24],[76,40],[102,19],[125,48],[112,70],[138,95],[99,109],[80,91],[46,111],[55,78]];
    p.forEach((q,i)=>i?x.lineTo(q[0],q[1]):x.moveTo(q[0],q[1]));x.closePath();x.fill();return c.toDataURL("image/png").split(",")[1]
  }),"base64");
  await page.locator("#referenceInput").setInputFiles({name:"qa-irregular-auto.png",mimeType:"image/png",buffer:irregularPng});
  await page.waitForFunction(()=>[...window.Forge.entities.values()].some(r=>r.components?.reference?.name==="qa-irregular-auto.png"),null,{timeout:10000});
  await page.locator("#silhouetteDepth").fill("0.4");await page.locator("#autoSilhouetteModel").click();
  await page.waitForFunction(()=>window.Forge.selected()?.components?.geometry?.kind==="extruded-silhouette"&&window.Forge.selected()?.components?.geometry?.sourceReference?.method==="automatic outer contour",null,{timeout:15000});
  const autoSilhouette=await page.evaluate(()=>{const r=window.Forge.selected(),g=r.components.geometry,ref=[...window.Forge.entities.values()].find(x=>x.components?.reference?.name==="qa-irregular-auto.png");return{kind:g.kind,points:g.contour?.length||0,axis:g.axis,width:g.width,height:g.height,depth:g.depth,source:g.sourceReference?.method,rendered:r.entity.render?.meshInstances?.length||0,savedOutline:ref?.components.reference.outline?.length||0,foregroundRatio:ref?.components.reference.autoSegmentation?.foregroundRatio||0}});
  if(autoSilhouette.kind!=="extruded-silhouette"||autoSilhouette.points<10||autoSilhouette.axis!=="front"||Math.abs(autoSilhouette.width-2.4)>.001||Math.abs(autoSilhouette.depth-.4)>.001||autoSilhouette.source!=="automatic outer contour"||autoSilhouette.rendered!==1||autoSilhouette.savedOutline!==autoSilhouette.points||autoSilhouette.foregroundRatio<.01||autoSilhouette.foregroundRatio>.92)throw new Error("One-click automatic silhouette extraction failed: "+JSON.stringify(autoSilhouette));
  await page.screenshot({path:path.join(ARTIFACTS,"forge-next-auto-silhouette.png"),fullPage:true});

  // The trace editor should also detect an outline without leaving manual editing mode.
  await page.locator('[data-workspace="references"]').click();await page.evaluate(()=>{const r=[...window.Forge.entities.values()].find(o=>o.components?.reference?.name==="qa-irregular-auto.png");window.Forge.select(r.id)});
  await page.locator("#traceSilhouette").click();await page.waitForFunction(()=>document.querySelector("#traceDialog").open,null,{timeout:5000});
  await page.locator("#traceAutoDetect").click();await page.waitForFunction(()=>document.querySelector("#tracePointCount").textContent.includes("points")&&Number.parseInt(document.querySelector("#tracePointCount").textContent,10)>=10,null,{timeout:10000});
  const editorAuto=await page.evaluate(()=>({points:Number.parseInt(document.querySelector("#tracePointCount").textContent,10),mode:document.querySelector("#traceModeLabel").textContent,closed:document.querySelector("#tracePointCount").textContent.includes("closed")}));
  if(editorAuto.points<10||!editorAuto.mode.includes("EXTRUDE"))throw new Error("Trace editor auto-detection did not return a usable outline: "+JSON.stringify(editorAuto));
  await page.locator("#traceClose").click();await page.waitForFunction(()=>!document.querySelector("#traceDialog").open,null,{timeout:5000});

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
    await page.locator('[data-mobile-panel="references"]').click();
    await page.waitForFunction(()=>document.querySelector("#rightDock").classList.contains("is-open")&&!document.querySelector('[data-inspector-panel="references"]').hidden,null,{timeout:5000});
    await page.locator("#drawerScrim").click({position:{x:viewport.width-3,y:viewport.height/2}});
    await page.waitForFunction(()=>!document.querySelector("#rightDock").classList.contains("is-open"),null,{timeout:5000});
    await page.locator('[data-mobile-panel="timeline"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.forgeWorkspace==="animation"&&!document.querySelector("#timelinePanel").hidden,null,{timeout:5000});
    const timelineVisible=await page.evaluate(()=>{const e=document.querySelector("#timelinePanel"),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom<=innerHeight-document.querySelector(".mobile-panel-bar").getBoundingClientRect().height+2});
    if(!timelineVisible)throw new Error("Mobile Animation workspace does not leave the timeline accessible at "+viewport.width+"px.");
    await page.locator('[data-timeline-view="graph"]').click();
    await page.waitForFunction(()=>!document.querySelector("#graphEditorPane").hidden&&document.querySelector("#timelineDopeSheet").hidden,null,{timeout:5000});
    const graphMobile=await page.evaluate(()=>{const c=document.querySelector("#graphEditorCanvas"),r=c.getBoundingClientRect();return{visible:r.width>220&&r.height>60,bounds:{width:Math.round(r.width),height:Math.round(r.height)},channel:document.querySelector("#graphChannelSummary").textContent,rootOverflow:document.documentElement.scrollWidth-innerWidth,metrics:!!c.__graphMetrics}});
    if(!graphMobile.visible||graphMobile.rootOverflow>1||!graphMobile.metrics)throw new Error("Graph Editor is not usable on mobile at "+viewport.width+"px: "+JSON.stringify(graphMobile));
    await page.locator("#graphChannel").selectOption("r1");
    await page.waitForFunction(()=>document.querySelector("#graphChannelSummary").textContent==="Rotation Y",null,{timeout:5000});
    await page.locator('[data-timeline-view="dopesheet"]').click();
    await page.waitForFunction(()=>!document.querySelector("#timelineDopeSheet").hidden&&document.querySelector("#graphEditorPane").hidden,null,{timeout:5000});
    mobileReports.push({...base,timelineVisible,graphMobile});
    await page.screenshot({path:path.join(ARTIFACTS,"forge-next-mobile-"+viewport.width+".png"),fullPage:true});
  }
  await page.evaluate(()=>{window.Forge.timelinePlaying=false;window.Forge.running=false});
  report={ok:true,url:URL_TO_TEST,httpStatus:response.status(),initial,created,transformed,front,moveTool,material,animation:{interpolated,graphEditor:{initial:graphInitial,edited:graphEdited}},timelineOnly,previewOnly,saveDownload:download.suggestedFilename(),dockResize:{leftBefore,leftAfter,persisted},mobileReports,pageErrors,consoleErrors,failedRequests};
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
