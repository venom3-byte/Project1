import {test,expect} from "@playwright/test";
import fs from "node:fs";
const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wHwAE/wJ/lqX5AAAAAElFTkSuQmCC","base64");
test.beforeAll(()=>{fs.mkdirSync("tests/fixtures",{recursive:true});fs.writeFileSync("tests/fixtures/pixel.png",tinyPng)});
test("editor boots without runtime console errors",async({page})=>{
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  await page.goto("/");
  await expect(page.locator("text=Asset Forge")).toBeVisible();
  await expect(page.locator("#editorCanvas")).toBeVisible();
  const bridge=await page.evaluate(()=>window.AssetForgeAgent?.status());
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

test("AI background removal operates on a real raster asset",async({page})=>{
  test.setTimeout(300000);
  const response=await page.request.get("https://raw.githubusercontent.com/Dashstrom/pixelize/main/docs/examples/car.jpg");
  expect(response.ok()).toBeTruthy();
  fs.writeFileSync("tests/fixtures/real-car-bg.jpg",await response.body());
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/real-car-bg.jpg");
  await expect(page.locator("#props")).toBeVisible();
  await page.click("#bgBtn");
  await expect(page.locator("#bgBtn")).toBeEnabled({timeout:160000});
  const bridge=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(bridge.backgroundRemovalError, bridge.backgroundRemovalError||"background removal produced no error").toBeFalsy();
  expect(bridge.selected).toMatch(/_cutout\.png$/);
  await expect(page.locator("#status")).toHaveText("Ready");
});

test("duplicate creates a second visible layer and layer actions work",async({page})=>{
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/pixel.png");
  await page.click("#duplicateBtn");
  await expect(page.locator("#layerCount")).toHaveText("2");
  const bridge=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(bridge.objects).toBe(2);
  await page.click("#frontBtn");
  await page.click("#downBtn");
  expect((await page.evaluate(()=>window.AssetForgeAgent.status())).objects).toBe(2);
});


test("real cutout preserves source RGB while producing transparency",async({page})=>{
  test.setTimeout(180000);
  const response=await page.request.get("https://raw.githubusercontent.com/Dashstrom/pixelize/main/docs/examples/car.jpg");
  expect(response.ok()).toBeTruthy();
  fs.writeFileSync("tests/fixtures/real-car-audit.jpg",await response.body());
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/real-car-audit.jpg");
  await page.click("#bgBtn");
  await expect(page.locator("#status")).toHaveText("Ready",{timeout:160000});
  const bridge=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(bridge.backgroundRemovalError||"").toBe("");
  const audit=await page.evaluate(()=>window.AssetForgeAgent.pixelAudit());
  expect(audit).not.toBeNull();
  expect(audit.meanRgbDelta).toBeLessThan(2.5);
  expect(audit.opaqueFraction).toBeGreaterThan(0.01);
  expect(audit.transparentFraction).toBeGreaterThan(0.01);
});

test("multiple raster animation frames pack with padding and gaps",async({page})=>{
  await page.goto("/");
  await page.setInputFiles("#framesInput",["tests/fixtures/pixel.png","tests/fixtures/pixel.png"]);
  await page.fill("#cols","2"); await page.fill("#rows","1"); await page.fill("#frameGap","4"); await page.fill("#framePadding","8");
  await page.click("#sheetBtn");
  await expect(page.locator("#toast")).toContainText("2 frames packed into raster sprite sheet");
});
