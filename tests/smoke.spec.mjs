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
  await expect(page.locator("#toast")).toContainText("2 frame(s) extracted and ready to pack");
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
