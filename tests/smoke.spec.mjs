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
  await expect(page.locator("#toast")).toContainText("2 frame(s) packed into raster sheet");
});
test("missing sprite selection is rejected cleanly",async({page})=>{
  await page.goto("/");
  await page.click("#framesBtn");
  await expect(page.locator("#toast")).toContainText("Select a sprite sheet image first");
  await page.click("#sheetBtn");
  await expect(page.locator("#toast")).toContainText("Extract frames first");
});
test("mobile drawers open and close without layout errors",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await page.click("#toolsToggle");
  await expect(page.locator("#toolPanel")).toHaveClass(/open/);
  await page.click("#toolsToggle");
  await expect(page.locator("#toolPanel")).not.toHaveClass(/open/);
  await page.click("#propsToggle");
  await expect(page.locator("#propsPanel")).toHaveClass(/open/);
  await page.click("#propsToggle");
  await expect(page.locator("#propsPanel")).not.toHaveClass(/open/);
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
  test.setTimeout(180000);
  const response=await page.request.get("https://raw.githubusercontent.com/Dashstrom/pixelize/main/docs/examples/car.jpg");
  expect(response.ok()).toBeTruthy();
  fs.writeFileSync("tests/fixtures/real-car-bg.jpg",await response.body());
  await page.goto("/");
  await page.setInputFiles("#fileInput","tests/fixtures/real-car-bg.jpg");
  await expect(page.locator("#props")).toBeVisible();
  await page.click("#bgBtn");
  await expect(page.locator("#bgBtn")).toBeEnabled({timeout:160000});
  const bridge=await page.evaluate(()=>window.AssetForgeAgent.status());
  expect(bridge.selected).toMatch(/_cutout\.png$/);
  await expect(page.locator("#status")).toHaveText("Ready");
});
