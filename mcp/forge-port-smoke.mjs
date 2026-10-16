#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import chromiumModule from "@sparticuz/chromium";
import { chromium } from "playwright-core";

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
  }, { timeout: 60000 });
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
  for (const [name, present] of Object.entries(initial.modules)) {
    if (!present) throw new Error("Expected Forge module did not load: " + name);
  }

  await page.screenshot({ path: path.join(ARTIFACTS, "forge-port-desktop.png"), fullPage: true });
  const entityCountBefore = await frame.evaluate(() => window.Forge.entities.size);
  await forgeFrameLocator.locator('[data-add="sphere"]').first().click();
  await frame.waitForFunction(previous => window.Forge.entities.size === previous + 1, entityCountBefore, { timeout: 10000 });
  const entityCountAfterAdd = await frame.evaluate(() => window.Forge.entities.size);

  const playButton = forgeFrameLocator.locator("#play");
  await playButton.click();
  await frame.waitForFunction(() => window.Forge.running === true, { timeout: 5000 });
  const playState = await frame.evaluate(() => ({ running: window.Forge.running, label: document.querySelector("#play")?.textContent?.trim() || "" }));
  await playButton.click();
  await frame.waitForFunction(() => window.Forge.running === false, { timeout: 5000 });
  const stoppedState = await frame.evaluate(() => ({ running: window.Forge.running, label: document.querySelector("#play")?.textContent?.trim() || "" }));

  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  const mobile = await frame.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    canvas: (() => { const e=document.querySelector("#viewport"),r=e?.getBoundingClientRect(); return r?{width:Math.round(r.width),height:Math.round(r.height),visible:r.width>0&&r.height>0}:null; })(),
    mobileControls: [...document.querySelectorAll("#mobileScene,#mobileInspector")].map(e=>({id:e.id,visible:e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0}))
  }));
  await page.screenshot({ path: path.join(ARTIFACTS, "forge-port-mobile.png"), fullPage: true });

  report = {
    ok: true,
    url: URL_TO_TEST,
    httpStatus: response.status(),
    initial,
    actionChecks: { entityCountBefore, entityCountAfterAdd, playState, stoppedState },
    mobile,
    pageErrors,
    consoleErrors,
    failedRequests,
    screenshots: ["forge-port-desktop.png", "forge-port-mobile.png"]
  };
  if (entityCountAfterAdd !== entityCountBefore + 1) throw new Error("Creating a sphere did not update scene state.");
  if (playState.running !== true || stoppedState.running !== false) throw new Error("Play/Stop did not change the real engine state.");
  if (mobile.viewport.scrollWidth > mobile.viewport.clientWidth + 2) throw new Error("Forge overflows horizontally at 390px: " + JSON.stringify(mobile.viewport));
  if (!mobile.canvas?.visible || mobile.canvas.width < 300 || mobile.canvas.height < 200) throw new Error("Mobile viewport canvas is unusable: " + JSON.stringify(mobile.canvas));
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
