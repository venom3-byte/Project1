#!/usr/bin/env node
import assert from "node:assert/strict";
import chromiumModule from "@sparticuz/chromium";
import { chromium } from "playwright-core";

const Chromium = chromiumModule.default || chromiumModule;
const BASE_URL = process.env.FORGE_EYE_URL || "http://127.0.0.1:4173/forge/ai-studio.html";
const url = new URL(BASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  throw new Error("This smoke test only accepts a local preview URL.");
}

const browser = await chromium.launch({
  headless: true,
  executablePath: await Chromium.executablePath(),
  args: Chromium.args,
  timeout: 60000
});
const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));
page.on("console", message => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
});

try {
  const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  assert.equal(response?.status(), 200, "AI Studio page should return HTTP 200");
  await page.locator("#viewport").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => {
    const count = document.querySelector("#objectCount")?.textContent || "";
    return /2/.test(count) && !document.querySelector("#viewportError")?.classList.contains("show");
  }, null, { timeout: 30000 });

  const initial = await page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    direction: document.documentElement.dir,
    canvas: (() => {
      const el = document.querySelector("#viewport");
      const rect = el.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), bufferWidth: el.width, bufferHeight: el.height };
    })(),
    count: document.querySelector("#objectCount")?.textContent,
    modelStatus: document.querySelector("#aiState")?.textContent
  }));
  assert.equal(initial.lang, "ar", "page language should be Arabic");
  assert.equal(initial.direction, "rtl", "page should be RTL");
  assert.ok(initial.canvas.width >= 300 && initial.canvas.height >= 200, "desktop 3D canvas should have a usable size");

  await page.locator('[data-add="cylinder"]').click();
  await page.waitForFunction(() => /3/.test(document.querySelector("#objectCount")?.textContent || ""), null, { timeout: 5000 });
  await page.locator('[data-material="glass"]').click();
  assert.equal(await page.locator("#materialSelect").inputValue(), "glass", "glass preset should update the selected object's material");
  await page.locator("#rotateMode").click();
  assert.ok((await page.locator("#rotateMode").getAttribute("class") || "").includes("primary"), "rotate mode should be selectable");
  await page.locator("#saveScene").click();
  const scene = await page.evaluate(() => JSON.parse(localStorage.getItem("forge-eye-scene-v1") || "null"));
  assert.equal(scene?.format, "forge-eye-scene-v1", "scene should be saved in the expected project format");
  assert.equal(scene?.objects?.length, 3, "scene save should include all three objects");
  assert.equal(scene.objects.find(o => o.id === scene.objects.at(-1).id)?.material, "glass", "saved scene should preserve material selection");

  const statusResponse = await page.request.get(new URL("/api/forge-eye/status", url).toString(), { timeout: 15000 });
  assert.equal(statusResponse.status(), 200, "server provider-status endpoint should be routable");
  const status = await statusResponse.json();
  assert.equal(status?.providers?.higgsfield?.configured, false, "Higgsfield must remain explicitly disconnected until authenticated integration exists");

  // The CI preview deliberately starts without API secrets. This verifies the real
  // endpoint fails closed instead of returning a fake assistant response.
  const apiResponse = await page.request.post(new URL("/api/forge-eye/chat", url).toString(), {
    data: { messages: [{ role: "user", content: "اختبار إعداد الاتصال" }] },
    timeout: 15000
  });
  assert.equal(apiResponse.status(), 503, "unconfigured DeepSeek endpoint should return HTTP 503");
  const apiBody = await apiResponse.json();
  assert.equal(apiBody.code, "AI_NOT_CONFIGURED", "unconfigured endpoint should expose the expected setup-required state");

  await page.locator("#providerSelect").selectOption("deepseek");
  await page.locator("#chatInput").fill("اختبار واجهة المحادثة");
  await page.locator("#sendBtn").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".message.notice")].some(el => el.textContent?.includes("لم يُضبط مفتاح DeepSeek")), null, { timeout: 10000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("#objectCount")?.textContent || "").includes("3"), null, { timeout: 20000 });
  assert.ok((await page.locator("#messages").innerText()).includes("اختبار واجهة المحادثة"), "chat history should persist locally across reloads");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileBefore = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    canvas: (() => {
      const el = document.querySelector("#viewport");
      const rect = el.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), bufferWidth: el.width, bufferHeight: el.height };
    })(),
    tabsVisible: ["chatTab", "sceneTab"].every(id => {
      const r = document.getElementById(id)?.getBoundingClientRect();
      return !!r && r.width > 0 && r.height > 0;
    }),
    fpsBadge: document.querySelector(".view-badges")?.textContent || ""
  }));
  assert.ok(mobileBefore.tabsVisible, "mobile chat and scene tabs should be visible");
  assert.ok(mobileBefore.scrollWidth <= mobileBefore.width + 2, "mobile layout should not overflow horizontally");
  assert.ok(mobileBefore.canvas.width >= 300 && mobileBefore.canvas.height >= 200, "mobile viewport should remain usable");
  assert.ok(/30 FPS/.test(mobileBefore.fpsBadge), "mobile interface should communicate its target frame rate");
  assert.ok(mobileBefore.canvas.bufferWidth <= mobileBefore.canvas.width + 2, "mobile canvas pixel ratio should be capped at 1");

  await page.locator("#chatTab").click();
  assert.equal(await page.evaluate(() => document.body.dataset.mobileView), "chat", "chat tab should open the conversation on mobile");
  assert.equal(await page.locator(".scene-panel").evaluate(el => getComputedStyle(el).display), "none", "3D viewport should be hidden while the mobile chat tab is active");
  await page.locator("#sceneTab").click();
  assert.equal(await page.evaluate(() => document.body.dataset.mobileView), "scene", "scene tab should return to 3D editor");
  assert.equal(await page.locator(".chat-panel").evaluate(el => getComputedStyle(el).display), "none", "chat panel should be hidden while the mobile scene tab is active");

  assert.deepEqual(pageErrors, [], "page should have no uncaught JavaScript errors");
  assert.deepEqual(consoleErrors, [], "page should have no browser console errors");

  console.log(JSON.stringify({
    ok: true,
    url: BASE_URL,
    initial,
    mobile: mobileBefore,
    checks: [
      "Arabic RTL layout",
      "Three.js canvas started and scene objects loaded",
      "Add primitive",
      "Apply glass material",
      "Select transform mode",
      "Save scene locally",
      "Server status endpoint",
      "DeepSeek returns explicit setup-required response without a key",
      "Chat message persistence",
      "Mobile tabs, viewport size, and pixel-ratio cap",
      "No uncaught page or console errors"
    ]
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    url: BASE_URL,
    error: String(error?.stack || error),
    pageErrors,
    consoleErrors
  }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
