#!/usr/bin/env node
/**
 * Visual-agent fallback runner for the public Forge / Claude Game Editor copy.
 * Each invocation opens Chromium, performs a bounded UI action or check,
 * captures a screenshot, persists browser storage, and closes cleanly.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chromiumModule from "@sparticuz/chromium";
import { chromium } from "playwright-core";

const Chromium = chromiumModule.default || chromiumModule;
const EDITOR_URL = process.env.FORGE_EDITOR_URL || "https://claude-game-editor-copy.forgemail-agent.workers.dev/";
const EDITOR_ORIGIN = new URL(EDITOR_URL).origin;
const PUBLIC_EDITOR_ORIGIN = "https://claude-game-editor-copy.forgemail-agent.workers.dev";
const ALLOWED_LOCAL_TEST_ORIGIN = "http://127.0.0.1:4173";
const localTestEnabled = process.env.FORGE_LOCAL_TEST === "1";
if (EDITOR_ORIGIN !== PUBLIC_EDITOR_ORIGIN &&
    !(localTestEnabled && EDITOR_ORIGIN === ALLOWED_LOCAL_TEST_ORIGIN)) {
  throw new Error("FORGE_EDITOR_URL must use the configured public editor origin; loopback is allowed only for isolated CI when FORGE_LOCAL_TEST=1.");
}
const profilePath = process.env.FORGE_VISUAL_PROFILE || path.join(os.homedir(), ".cache", "forge-visual-agent", "storage-state.json");
const artifactDir = process.env.FORGE_VISUAL_ARTIFACTS || path.join(os.homedir(), ".cache", "forge-visual-agent", "artifacts");
const viewport = { width: 1440, height: 900 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
function safeName(s) { return String(s || "step").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 60) || "step"; }

async function main() {
  const command = process.argv[2] || "inspect";
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const allowed = new Set(["open", "inspect", "screenshot", "click", "type", "key", "scroll", "drag", "sequence", "checks"]);
  if (!allowed.has(command)) throw new Error("Unsupported command. Use: " + [...allowed].join(", "));
  await ensureDir(path.dirname(profilePath));
  await ensureDir(artifactDir);

  let storageState;
  try { storageState = JSON.parse(await fs.readFile(profilePath, "utf8")); } catch { storageState = undefined; }
  const browser = await chromium.launch({
    headless: true,
    executablePath: await Chromium.executablePath(),
    args: Chromium.args,
    timeout: 60000
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, storageState, ignoreHTTPSErrors: false });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", e => pageErrors.push(String(e?.message || e)));
  page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500)); });

  let responseStatus = null;
  let action = null;
  try {
    const response = await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    responseStatus = response?.status() ?? null;
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30000 });
    await sleep(1000);

    if (command === "click") {
      const ways = Number(!!args.selector) + Number(!!args.text) + Number(Number.isFinite(args.x) && Number.isFinite(args.y));
      if (ways !== 1) throw new Error("Provide exactly one of selector, text, or x/y coordinates.");
      if (args.selector) {
        if (typeof args.selector !== "string" || args.selector.length > 180) throw new Error("Selector must be at most 180 characters.");
        const target = page.locator(args.selector).first();
        await target.waitFor({ state: "visible", timeout: 10000 });
        await target.click({ timeout: 10000 });
        action = { type: "click", selector: args.selector };
      } else if (args.text) {
        if (typeof args.text !== "string" || args.text.length > 120) throw new Error("Text target must be at most 120 characters.");
        const target = page.getByRole("button", { name: args.text, exact: true }).first();
        await target.waitFor({ state: "visible", timeout: 10000 });
        await target.click({ timeout: 10000 });
        action = { type: "click", text: args.text };
      } else {
        const x = Number(args.x), y = Number(args.y);
        if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) throw new Error("Coordinates are outside the current viewport.");
        await page.mouse.click(x, y);
        action = { type: "click", x, y };
      }
    } else if (command === "type") {
      if (typeof args.selector !== "string" || args.selector.length > 180) throw new Error("A valid field selector is required.");
      if (typeof args.text !== "string" || args.text.length > 4000) throw new Error("Text is limited to 4000 characters.");
      const target = page.locator(args.selector).first();
      await target.waitFor({ state: "visible", timeout: 10000 });
      const tag = await target.evaluate(e => ({ tag: e.tagName, editable: e.isContentEditable || e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement }));
      if (!tag.editable) throw new Error("The selector does not target an editable field.");
      await target.fill(args.text, { timeout: 10000 });
      action = { type: "type", selector: args.selector, characters: args.text.length };
    } else if (command === "key") {
      const allowedKeys = new Set(["Enter", "Escape", "Tab", "Delete", "Backspace", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "F", "W", "E", "R", "Control+Z", "Control+Y", "Control+D"]);
      if (!allowedKeys.has(args.key)) throw new Error("Unsupported keyboard input.");
      await page.keyboard.press(args.key);
      action = { type: "key", key: args.key };
    } else if (command === "scroll") {
      const dir = args.direction;
      if (!["up", "down", "left", "right"].includes(dir)) throw new Error("direction must be up/down/left/right.");
      const amount = Math.max(60, Math.min(1200, Number(args.amount) || 480));
      await page.mouse.move(viewport.width * 0.72, viewport.height * 0.72);
      await page.mouse.wheel(dir === "left" ? -amount : dir === "right" ? amount : 0, dir === "up" ? -amount : dir === "down" ? amount : 0);
      action = { type: "scroll", direction: dir, amount };
    } else if (command === "drag") {
      const coords = [args.startX, args.startY, args.endX, args.endY].map(Number);
      if (coords.some(value => !Number.isFinite(value))) {
        throw new Error("drag requires finite startX, startY, endX and endY coordinates.");
      }
      const [startX, startY, endX, endY] = coords;
      const button = args.button || "left";
      if (!["left", "right"].includes(button)) throw new Error("drag button must be left or right.");
      if (coords.some(value => value < 0) || startX > viewport.width || endX > viewport.width || startY > viewport.height || endY > viewport.height) {
        throw new Error("Drag coordinates are outside the current viewport.");
      }
      if (Math.hypot(endX - startX, endY - startY) < 8) throw new Error("Drag distance must be at least 8 pixels.");
      const segments = Math.max(4, Math.min(16, Math.ceil(Math.hypot(endX - startX, endY - startY) / 40)));
      await page.mouse.move(startX, startY);
      await page.mouse.down({ button });
      for (let i = 1; i <= segments; i += 1) {
        await page.mouse.move(
          startX + (endX - startX) * i / segments,
          startY + (endY - startY) * i / segments,
        );
      }
      await page.mouse.up({ button });
      await sleep(400);
      action = { type: "drag", button, from: [startX, startY], to: [endX, endY], segments };
    } else if (command === "sequence") {
      if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 20) {
        throw new Error("sequence requires 1–20 bounded steps.");
      }
      const results = [];
      for (const step of args.steps) {
        if (!step || typeof step !== "object") throw new Error("Each sequence step must be an object.");
        if (step.type === "click") {
          const ways = Number(!!step.selector) + Number(!!step.text) + Number(Number.isFinite(step.x) && Number.isFinite(step.y));
          if (ways !== 1) throw new Error("Each click step needs exactly one target: selector, text, or x/y.");
          if (step.selector) {
            if (typeof step.selector !== "string" || step.selector.length > 180) throw new Error("Selector too long.");
            const target = page.locator(step.selector).first();
            await target.waitFor({state:"visible",timeout:10000});
            await target.click({timeout:10000});
          } else if (step.text) {
            const target = page.getByRole("button",{name:step.text,exact:true}).first();
            await target.waitFor({state:"visible",timeout:10000});
            await target.click({timeout:10000});
          } else {
            const x=Number(step.x), y=Number(step.y);
            if(x<0||y<0||x>viewport.width||y>viewport.height) throw new Error("Coordinates out of viewport.");
            await page.mouse.click(x,y);
          }
          results.push({type:"click",target:step.selector||step.text||[step.x,step.y]});
        } else if (step.type === "type") {
          if(typeof step.selector!=="string"||step.selector.length>180||typeof step.text!=="string"||step.text.length>4000) throw new Error("Invalid type step.");
          const target=page.locator(step.selector).first();
          await target.waitFor({state:"visible",timeout:10000});
          await target.fill(step.text,{timeout:10000});
          results.push({type:"type",selector:step.selector,characters:step.text.length});
        } else if (step.type === "key") {
          const allowedKeys=new Set(["Enter","Escape","Tab","Delete","Backspace","Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","F","W","E","R","Control+Z","Control+Y","Control+D"]);
          if(!allowedKeys.has(step.key)) throw new Error("Unsupported key in sequence.");
          await page.keyboard.press(step.key);
          results.push({type:"key",key:step.key});
        } else if (step.type === "scroll") {
          if(!["up","down","left","right"].includes(step.direction)) throw new Error("Invalid scroll direction.");
          const amount=Math.max(60,Math.min(1200,Number(step.amount)||480));
          await page.mouse.move(viewport.width*0.72,viewport.height*0.72);
          await page.mouse.wheel(step.direction==="left"?-amount:step.direction==="right"?amount:0,step.direction==="up"?-amount:step.direction==="down"?amount:0);
          results.push({type:"scroll",direction:step.direction,amount});
        } else if (step.type === "drag") {
          const coords = [step.startX, step.startY, step.endX, step.endY].map(Number);
          if (coords.some(value => !Number.isFinite(value))) {
            throw new Error("drag steps require finite startX, startY, endX and endY coordinates.");
          }
          const [startX, startY, endX, endY] = coords;
          const button = step.button || "left";
          if (!["left", "right"].includes(button)) throw new Error("drag step button must be left or right.");
          if (coords.some(value => value < 0) || startX > viewport.width || endX > viewport.width || startY > viewport.height || endY > viewport.height) {
            throw new Error("Drag step coordinates are outside the viewport.");
          }
          if (Math.hypot(endX - startX, endY - startY) < 8) throw new Error("Drag step distance must be at least 8 pixels.");
          const segments = Math.max(4, Math.min(16, Math.ceil(Math.hypot(endX - startX, endY - startY) / 40)));
          await page.mouse.move(startX, startY);
          await page.mouse.down({ button });
          for (let i = 1; i <= segments; i += 1) {
            await page.mouse.move(
              startX + (endX - startX) * i / segments,
              startY + (endY - startY) * i / segments,
            );
          }
          await page.mouse.up({ button });
          results.push({ type: "drag", button, from: [startX, startY], to: [endX, endY], segments });
        } else {
          throw new Error("Unsupported sequence step. Use click, type, key, scroll or drag.");
        }
        await sleep(120);
      }
      action = { type:"sequence", steps:results };
    } else if (command === "checks") {
      const canvasCount = await page.locator("canvas").count();
      const play = page.getByRole("button", { name: "Play", exact: true }).first();
      const playInitially = await play.isVisible().catch(() => false);
      if (!playInitially) throw new Error("Play button is not visible.");
      await play.click();
      const stop = page.getByRole("button", { name: "Stop", exact: true }).first();
      await stop.waitFor({ state: "visible", timeout: 5000 });
      const stopAppeared = await stop.isVisible();
      await stop.click();
      const playReturned = await page.getByRole("button", { name: "Play", exact: true }).first().isVisible({ timeout: 5000 }).catch(() => false);
      action = { type: "checks", canvasCount, playInitially, stopAppeared, playReturned, passed: canvasCount === 1 && playInitially && stopAppeared && playReturned };
    }

    // Allow the editor's debounced local save to settle before persisting storage state.
    await sleep(850);
    const observation = await page.evaluate(() => {
      const clean = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, 180);
      const visible = e => { const r=e.getBoundingClientRect(),s=getComputedStyle(e); return r.width>0 && r.height>0 && s.display!=="none" && s.visibility!=="hidden"; };
      const rect = e => { const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}; };
      const project = (() => { try { return JSON.parse(localStorage.getItem("game-editor:project:v1") || "null"); } catch { return null; } })();
      return {
        title: document.title, url: location.href, bodyText: clean(document.body.innerText).slice(0, 7000),
        buttons: [...document.querySelectorAll("button,[role=button]")].filter(visible).slice(0,100).map(e=>({text:clean(e.innerText||e.getAttribute("aria-label")||e.title),disabled:!!e.disabled,rect:rect(e)})),
        fields: [...document.querySelectorAll("input,textarea,select,[contenteditable=true]")].filter(visible).slice(0,60).map(e=>({tag:e.tagName,type:e.type||null,value:clean(e.value||e.innerText),placeholder:e.placeholder||"",aria:e.getAttribute("aria-label")||"",rect:rect(e)})),
        canvases: [...document.querySelectorAll("canvas")].map(e=>({width:e.width,height:e.height,rect:rect(e)})),
        project: project ? {name:project.name,objectCount:project.objects?.length||0,selectedId:project.selectedId||null,objects:(project.objects||[]).slice(0,80).map(o=>({id:o.id,name:o.name,shape:o.shape,position:o.position,rotation:o.rotation,scale:o.scale,color:o.color,behavior:o.behavior}))} : null
      };
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = path.join(artifactDir, stamp + "-" + safeName(command) + ".jpg");
    await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 72, fullPage: false });
    await context.storageState({ path: profilePath });
    const report = {
      ok: responseStatus === 200 && pageErrors.length === 0 && !(command === "checks" && !action?.passed),
      command, responseStatus, action, observation,
      verification: { pageErrors, consoleErrors: consoleErrors.slice(0, 15) },
      screenshotPath, profilePersisted: true
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
  } finally {
    try { await context.storageState({ path: profilePath }); } catch {}
    await context.close();
    await browser.close();
  }
}
main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  process.exit(1);
});
