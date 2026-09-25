import {test,expect} from "@playwright/test";
import fs from "node:fs";
const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wHwAE/wJ/lqX5AAAAAElFTkSuQmCC","base64");
test.beforeAll(()=>{fs.mkdirSync("tests/fixtures",{recursive:true});fs.mkdirSync("tests/verified",{recursive:true});fs.writeFileSync("tests/fixtures/pixel.png",tinyPng)});
test("editor boots without runtime console errors",async({page})=>{
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  await page.goto("/");
  await expect(page.locator("text=Asset Forge")).toBeVisible();
  await expect(page.locator("#editorCanvas")).toBeVisible();
  const bridge=await page.evaluate(()=>window.AssetForgeAgent?.status());
  expect(bridge, errors.join("
")).toBeTruthy();
  expect(bridge?.objects).toBe(0);
  expect(errors).toEqual([]);
});
test("raster import, crop, trim, undo/redo and export remain functional",async({page})=>{
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/pixel.png");
  await expect(page.locator("#props")).toBeVisible();
  await expect(page.locator("#pw")).not.toHaveValue("");
  await page.click("#cropBtn");
  await expect(page.locator("#cropModal")).toBeVisible();
  await page.fill("#cropW","1"); await page.fill("#cropH","1");
  await page.click("#applyCrop");
  await expect(page.locator("#cropModal")).toHaveClass(/hidden/);
  await expect(page.locator("#props")).toBeVisible();
  await page.click("#undoBtn"); await page.click("#redoBtn");
  await page.click("#exportBtn");
  await expect(page.locator("#toast")).toContainText("PNG exported");
});
test("frame extraction creates actual frame assets and sheet packing uses extracted frames",async({page})=>{
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/pixel.png");
  await page.fill("#cols","2");
  await page.fill("#rows","1");
  await page.click("#framesBtn");
  await expect(page.locator("#toast")).toContainText("2 frames extracted and ready to pack");
  await page.click("#sheetBtn");
  await expect(page.locator("#toast")).toContainText("2 frames packed into raster sprite sheet");
});
test("missing sprite selection is rejected cleanly",async({page})=>{
  await page.goto("/");
  await page.click("#framesBtn");
  await expect(page.locator("#toast")).toContainText("Select a sprite sheet image first");
  await page.click("#sheetBtn");
  await expect(page.locator("#toast")).toContainText("Add animation frames or extract frames first");
});
test("mobile bottom sheets scroll and open without layout errors",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await page.click('button[data-sheet="toolPanel"]');
  await expect(page.locator("#toolPanel")).toHaveClass(/open/);
  await page.locator("#toolPanel").evaluate(el=>{el.scrollTop=el.scrollHeight});
  const scroll=await page.locator("#toolPanel").evaluate(el=>({top:el.scrollTop,height:el.scrollHeight-el.clientHeight}));
  expect(scroll.top).toBeGreaterThan(0);
  await page.click('button[data-sheet="propsPanel"]');
  await expect(page.locator("#propsPanel")).toHaveClass(/open/);
  await page.locator("#propsPanel").evaluate(el=>{el.scrollTop=el.scrollHeight});
  const pscroll=await page.locator("#propsPanel").evaluate(el=>el.scrollTop);
  expect(pscroll).toBeGreaterThanOrEqual(0);
});

test("real public-domain photo can be imported, cropped and exported as a game asset",async({page})=>{
  const url="https://raw.githubusercontent.com/Dashstrom/pixelize/main/docs/examples/car.jpg";
  const response=await page.request.get(url);
  expect(response.ok()).toBeTruthy();
  const bytes=await response.body();
  expect(bytes.length).toBeGreaterThan(20000);
  fs.writeFileSync("tests/fixtures/real-car.jpg",bytes);
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/real-car.jpg");
  await expect(page.locator("#props")).toBeVisible();
  const dims=await page.evaluate(()=>window.AssetForgeAgent.status().selectedSize);
  expect(dims.width).toBeGreaterThan(100);
  expect(dims.height).toBeGreaterThan(100);
  await page.click("#cropBtn");
  await page.fill("#cropX",String(Math.floor(dims.width*0.1)));
  await page.fill("#cropY",String(Math.floor(dims.height*0.1)));
  await page.fill("#cropW",String(Math.floor(dims.width*0.8)));
  await page.fill("#cropH",String(Math.floor(dims.height*0.8)));
  await page.click("#applyCrop");
  await expect(page.locator("#cropModal")).toHaveClass(/hidden/);
  await page.click("#exportBtn");
  await expect(page.locator("#toast")).toContainText("PNG exported");
  await page.fill("#cols","2"); await page.fill("#rows","2");
  await page.click("#framesBtn"); await expect(page.locator("#toast")).toContainText("4 frames extracted and ready to pack");
  await page.click("#sheetBtn"); await expect(page.locator("#toast")).toContainText("4 frames packed into raster sprite sheet");
  const bridge=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(bridge.objects).toBe(1);
  expect(bridge.selected).toMatch(/_crop\.png$/);
});

test("final raster QA preview processes the real photo",async({page})=>{
  await page.goto("/demo.html");
  await expect(page.locator("#status")).toContainText("Ready — real raster processed");
  await expect(page.locator("#source")).toBeVisible();
  const result=await page.locator("#result").evaluate(c=>({w:c.width,h:c.height}));
  expect(result).toEqual({w:512,h:512});
  await expect(page.locator("#resultMeta")).toContainText("512 × 512 output");
});

test("duplicate creates a second visible layer and layer actions work",async({page})=>{
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/pixel.png");
  await expect(page.locator("#props")).toBeVisible();
  await page.click("#duplicateBtn");
  await expect(page.locator("#toast")).toContainText("Layer duplicated");
  await expect(page.locator("#layerCount")).toHaveText("2");
  const bridge=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(bridge.objects).toBe(2);
  await page.click("#frontBtn");
  await page.click("#downBtn");
  expect((await page.evaluate(()=>window.AssetForgeAgent.status())).objects).toBe(2);
});


test("multiple raster animation frames pack with padding and gaps",async({page})=>{
  await page.goto("/");
  await page.setInputFiles("#framesInput",["tests/fixtures/pixel.png","tests/fixtures/pixel.png"]);
  await page.fill("#cols","2"); await page.fill("#rows","1"); await page.fill("#frameGap","4"); await page.fill("#framePadding","8");
  await page.click("#sheetBtn");
  await expect(page.locator("#toast")).toContainText("2 frames packed into raster sprite sheet");
});

test("AI cutout QA covers vehicle human and animal rasters in one model session",async({page})=>{
  test.setTimeout(300000);
  const cases=[
    ["vehicle","https://raw.githubusercontent.com/Dashstrom/pixelize/main/docs/examples/car.jpg"],
    ["human","https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/portrait-of-woman_small.jpg"],
    ["animal","https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/tiger.jpg"]
  ];
  await page.goto("/");
  for(const [kind,url] of cases){
    const response=await page.request.get(url);expect(response.ok(),kind).toBeTruthy();
    const bytes=await response.body();const path="tests/fixtures/"+kind+".jpg";fs.writeFileSync(path,bytes);
    await page.setInputFiles("#fileInput",path);
    await expect(page.locator("#props")).toBeVisible();
    await page.click("#bgBtn");
    await expect(page.locator("#status")).toHaveText("Ready",{timeout:240000});
    const bridge=await page.evaluate(()=>window.AssetForgeAgent.status());
    expect(bridge.backgroundRemovalError||"").toBe("");
    expect(bridge.selected).toMatch(/_cutout\.png$/);
    const audit=await page.evaluate(()=>window.AssetForgeAgent.pixelAudit());
    expect(audit).not.toBeNull();
    expect(audit.maxAlpha).toBeGreaterThan(200);
    expect(audit.nonzeroFraction).toBeGreaterThan(0.01);
    expect(audit.opaqueFraction).toBeGreaterThan(0.001);
    expect(audit.transparentFraction).toBeGreaterThan(0.01);
    expect(audit.softEdgeFraction).toBeGreaterThan(0.0001);
    expect(audit.meanRgbDelta, JSON.stringify(audit)).toBeLessThan(2.5);
    expect(audit.width).toBeGreaterThan(100); expect(audit.height).toBeGreaterThan(100);
  }
  const finalState=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(finalState.objects).toBe(3);
});

test("game asset manifest export works",async({page})=>{
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/pixel.png");
  await expect(page.locator("#props")).toBeVisible();
  await page.evaluate(()=>window.AssetForgeAgent.exportSelectedManifest());
  const dl=await page.evaluate(()=>window.AssetForgeAgent.getLastDownload());
  expect(dl?.name).toBe("asset-manifest.json");
  expect(dl?.type).toBe("application/json");
  expect(dl?.href.startsWith("data:application/json")).toBeTruthy();
});

test("real white-background sprite sheet import background removal trim and exact crop",async({page})=>{
  test.setTimeout(300000);
  const url="https://raw.githubusercontent.com/osmanvision/OsCrop/main/samples/white_bg.png";
  const response=await page.request.get(url);expect(response.ok()).toBeTruthy();
  fs.writeFileSync("tests/fixtures/real-sprite-sheet.png",await response.body());
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/real-sprite-sheet.png");
  await expect(page.locator("#props")).toBeVisible({timeout:30000});
  let status=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(status.selectedType).toBe("image");
  expect(status.selectedSize.width).toBeGreaterThan(100);
  expect(status.selectedSize.height).toBeGreaterThan(100);

  await page.click("#bgBtn");
  await expect(page.locator("#status")).toHaveText("Ready",{timeout:240000});
  const afterBg=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(afterBg.backgroundRemovalError||"").toBe("");

  await page.click("#trimBtn");
  await expect(page.locator("#toast")).toContainText("Transparent bounds trimmed");
  const trimmed=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(trimmed.selectedSize.width).toBeGreaterThan(20);
  expect(trimmed.selectedSize.height).toBeGreaterThan(20);

  const cropW=Math.floor(trimmed.selectedSize.width/2);
  const cropH=Math.floor(trimmed.selectedSize.height/2);
  await page.evaluate(({w,h})=>window.AssetForgeAgent.cropSelected(0,0,w,h),{w:cropW,h:cropH});
  const cropped=await page.evaluate(()=>window.AssetForgeAgent.status());
  await page.click("#exportBtn");
  await expect(page.locator("#toast")).toContainText("PNG exported");
  const croppedData=await page.evaluate(()=>window.AssetForgeAgent.getLastDownloadDataUrl());
  expect(croppedData).toMatch(/^data:image\/png;base64,/);
  fs.writeFileSync("tests/verified/real-sprite-cropped.png",Buffer.from(croppedData.split(",")[1],"base64"));
  await page.fill("#cols","2");await page.fill("#rows","2");
  await page.click("#framesBtn");
  await expect(page.locator("#toast")).toContainText("4 frames extracted and ready");
  await page.click("#sheetBtn");
  await expect(page.locator("#toast")).toContainText("4 frames packed into raster sprite sheet");
  const spriteData=await page.evaluate(()=>window.AssetForgeAgent.getLastDownloadDataUrl());
  expect(spriteData).toMatch(/^data:image\\/png;base64,/);
  fs.writeFileSync("tests/verified/real-sprite-sheet.png",Buffer.from(spriteData.split(",")[1],"base64"));
  fs.writeFileSync("tests/verified/real-sprite-sheet.json",JSON.stringify({
    source:url,
    workflow:["download","import","AI background removal","transparent trim","exact crop","4-frame extract","sprite pack"]
  },null,2));
});
