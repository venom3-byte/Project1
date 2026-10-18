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
    const failedRequests = [];
    page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));
    page.on("requestfailed", request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "request failed" }));
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!response || response.status() !== 200) throw new Error(profile.name + ": game page did not return HTTP 200.");
    await page.locator("#mapSelector").waitFor({ state: "attached", timeout: 20000 });
    await page.locator("#stage canvas").waitFor({ state: "attached", timeout: 30000 });
    const optionValues = await page.locator("#mapSelector option").evaluateAll(options => options.map(option => option.value));
    if (optionValues.length !== 4) throw new Error(profile.name + ": expected four selectable theatres, found " + optionValues.length);
    await page.selectOption("#mapSelector", profile.map);
    await sleep(700);
    const metrics = await page.evaluate(() => {
      const canvas = document.querySelector("#stage canvas");
      const selector = document.querySelector("#mapSelector");
      const stage = document.querySelector("#stage");
      return {
        title: document.title, map: selector?.value || null, mapLabel: selector?.selectedOptions?.[0]?.textContent?.trim() || null,
        options: selector?.options?.length || 0,
        canvas: canvas ? { width: canvas.width, height: canvas.height, rectWidth: Math.round(canvas.getBoundingClientRect().width), rectHeight: Math.round(canvas.getBoundingClientRect().height) } : null,
        stage: stage ? { width: Math.round(stage.getBoundingClientRect().width), height: Math.round(stage.getBoundingClientRect().height) } : null,
        hasWebGL: !!canvas?.getContext("webgl2") || !!canvas?.getContext("webgl")
      };
    });
    await page.screenshot({ path: path.join(OUT, "warfront-" + profile.name + ".png"), fullPage: true });
    if (!metrics.canvas || metrics.canvas.rectWidth < 50 || metrics.canvas.rectHeight < 50) throw new Error(profile.name + ": 3D canvas is missing or has no visible dimensions.");
    if (!metrics.hasWebGL) throw new Error(profile.name + ": Chromium could not initialize a WebGL context.");
    if (metrics.map !== profile.map) throw new Error(profile.name + ": selected theatre was not applied.");
    if (pageErrors.length) throw new Error(profile.name + ": browser JavaScript errors: " + pageErrors.join("\n"));
    report.runs.push({ ...profile, ...metrics, pageErrors, failedRequests });
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
