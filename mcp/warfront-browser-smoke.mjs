#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import chromiumModule from "@sparticuz/chromium";
import { chromium } from "playwright-core";

const Chromium = chromiumModule.default || chromiumModule;
const BASE_URL = process.env.WARFRONT_URL || "http://127.0.0.1:4174/index.html";
const OUT = process.env.WARFRONT_ARTIFACTS || "/tmp/warfront-browser-qa";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: await Chromium.executablePath(),
  args: Chromium.args,
  timeout: 60000
});
const report = { url: BASE_URL, runs: [], failures: [], startedAt: new Date().toISOString() };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  for (const profile of [
    { name: "desktop", viewport: { width: 1440, height: 900 }, map: "desert-basin" },
    { name: "mobile", viewport: { width: 390, height: 844 }, map: "river-crossing" }
  ]) {
    await page.setViewportSize(profile.viewport);
    const pageErrors = [];
    const consoleErrors = [];
    const failedRequests = [];
    page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "request failed" }));
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!response || response.status() !== 200) throw new Error(profile.name + ": game page did not return HTTP 200.");
    await page.locator("#mapSelector").waitFor({ state: "attached", timeout: 20000 });
    await page.locator("#stage canvas").waitFor({ state: "attached", timeout: 30000 });
    await page.waitForFunction(() => typeof window.__WARFRONT_DIAGNOSTICS__ === "function" && window.__WARFRONT_DIAGNOSTICS__().bundleLoaded === true, null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const d = window.__WARFRONT_DIAGNOSTICS__?.();
      return !!d && d.aircraft?.length === 4 && d.aircraft.filter(a => a.flightClass === "fixed-wing").length === 2 && d.aircraft.filter(a => a.flightClass === "rotary-wing").length === 2;
    }, null, { timeout: 30000 });
    const optionValues = await page.locator("#mapSelector option").evaluateAll(options => options.map(option => option.value));
    if (optionValues.length !== 4) throw new Error(profile.name + ": expected four selectable theatres, found " + optionValues.length);
    await page.selectOption("#mapSelector", profile.map);
    await page.waitForFunction(expected => window.__WARFRONT_DIAGNOSTICS__?.().activeBlenderMap === ({"pine-valley":"MAP_PINE_VALLEY_ROOT","desert-basin":"MAP_RED_BASIN_ROOT","river-crossing":"MAP_RIVER_CROSSING_ROOT","alpine-pass":"MAP_ALPINE_PASS_ROOT"}[expected]), profile.map, { timeout: 15000 });
    await sleep(350);
    const metrics = await page.evaluate(() => {
      const canvas = document.querySelector("#stage canvas");
      const selector = document.querySelector("#mapSelector");
      const stage = document.querySelector("#stage");
      return {
        title: document.title, map: selector?.value || null, mapLabel: selector?.selectedOptions?.[0]?.textContent?.trim() || null,
        options: selector?.options?.length || 0,
        canvas: canvas ? { width: canvas.width, height: canvas.height, rectWidth: Math.round(canvas.getBoundingClientRect().width), rectHeight: Math.round(canvas.getBoundingClientRect().height) } : null,
        stage: stage ? { width: Math.round(stage.getBoundingClientRect().width), height: Math.round(stage.getBoundingClientRect().height) } : null,
        hasWebGL: !!canvas?.getContext("webgl2") || !!canvas?.getContext("webgl"),
        diagnostics: window.__WARFRONT_DIAGNOSTICS__?.() || null
      };
    });
    await page.screenshot({ path: path.join(OUT, "warfront-" + profile.name + ".png"), fullPage: true });
    if (!metrics.canvas || metrics.canvas.rectWidth < 50 || metrics.canvas.rectHeight < 50) throw new Error(profile.name + ": 3D canvas is missing or has no visible dimensions.");
    if (!metrics.hasWebGL) throw new Error(profile.name + ": Chromium could not initialize a WebGL context.");
    if (metrics.map !== profile.map) throw new Error(profile.name + ": selected theatre was not applied.");
    if (!metrics.diagnostics?.bundleLoaded || !metrics.diagnostics?.activeBlenderMap) throw new Error(profile.name + ": Blender bundle or active map root was not loaded.");
    if (metrics.diagnostics.fallbackGroundVisible !== false) throw new Error(profile.name + ": fallback terrain is still visible over the Blender map.");
    if (!metrics.diagnostics.roots?.includes("UNIT_F16C_BLOCK50_ROOT") || !metrics.diagnostics.roots?.includes("UNIT_HEAVY_STRIKE_ROOT")) throw new Error(profile.name + ": F-16/heavy strike Blender roots missing.");
    if (!metrics.diagnostics.roots?.includes("UNIT_ATTACK_HELICOPTER_ROOT") || !metrics.diagnostics.roots?.includes("UNIT_TRANSPORT_HELICOPTER_ROOT")) throw new Error(profile.name + ": rotary-wing model roots missing.");
    if (metrics.diagnostics.tankModels?.length !== 5 || metrics.diagnostics.tankModels.some(t => !t.imported)) throw new Error(profile.name + ": tank/armour model replacement was incomplete.");
    if ((metrics.diagnostics.infantryModels || 0) < 10) throw new Error(profile.name + ": too few Blender infantry models were bound.");
    if (metrics.diagnostics.aircraft?.filter(a => !!a.root).length !== 4) throw new Error(profile.name + ": not every aircraft was bound to its own Blender root.");
    if (metrics.diagnostics.serviceVehicles?.length !== 2 || !metrics.diagnostics.serviceVehicles.some(v => v.root === "UNIT_CARGO_ROOT") || !metrics.diagnostics.serviceVehicles.some(v => v.root === "UNIT_FUEL_ROOT")) throw new Error(profile.name + ": Blender ammunition/fuel service vehicles were not created.");
    if (failedRequests.some(r => /combined-arms-r19\.glb/.test(r.url))) throw new Error(profile.name + ": Blender GLB asset request failed.");
    if (pageErrors.length) throw new Error(profile.name + ": browser JavaScript errors: " + pageErrors.join("\n"));
    const serviceStart = await page.evaluate(() => window.__WARFRONT_TEST__?.startF16Rearm() || null);
    if (!serviceStart || !serviceStart.started) throw new Error(profile.name + ": local F-16 rearm scenario could not dispatch its ground convoy: " + JSON.stringify(serviceStart));
    await page.waitForFunction(() => {
      const d = window.__WARFRONT_DIAGNOSTICS__?.();
      const f16 = d?.aircraft?.find(a => a.key === "f16c-block50");
      return !!f16 && f16.state === "ready" && f16.storesRemaining > 0 && d.serviceVehicles?.length === 2 && d.serviceVehicles.every(v => v.state === "idle" && v.job === null);
    }, null, { timeout: 35000 });
    const postService = await page.evaluate(() => window.__WARFRONT_DIAGNOSTICS__?.() || null);
    if (consoleErrors.length) throw new Error(profile.name + ": browser console errors: " + consoleErrors.join("\n"));
    report.runs.push({ ...profile, ...metrics, serviceStart, postService, pageErrors, consoleErrors, failedRequests });
  }
} catch (error) {
  report.failures.push(String(error?.stack || error));
  await fs.writeFile(path.join(OUT, "warfront-report.json"), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
}
report.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(OUT, "warfront-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
