import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const html = readFileSync("public/forge/ai-studio.html", "utf8");
const api = readFileSync("src/lib/forge-eye-api.ts", "utf8");
const statusRoute = readFileSync("src/routes/api/forge-eye/status.ts", "utf8");
const chatRoute = readFileSync("src/routes/api/forge-eye/chat.ts", "utf8");
const geminiRoute = readFileSync("src/routes/api/forge-eye/gemini.ts", "utf8");
const combined = [html, api, statusRoute, chatRoute, geminiRoute].join("\n");

const required = [
  ["Arabic right-to-left UI", /<html lang="ar" dir="rtl">/],
  ["actual Three.js module", /importmap/],
  ["transform controls", /TransformControls/],
  ["mobile low-power graphics", /powerPreference:"low-power"/],
  ["pause drawing while hidden", /visibilitychange/],
  ["local scene saving", /forge-eye-scene-v1/],
  ["real material factory invocation", /const makeMaterial=materialDefs\[mat\]\|\|materialDefs\.plastic;const o=new THREE\.Mesh\(geometryFor\(kind\),makeMaterial\(\)\)/],
  ["DeepSeek is the default provider", /<option value="deepseek" selected>DeepSeek<\/option>/],
  ["server-side DeepSeek key", /process\.env\.DEEPSEEK_API_KEY/],
  ["server-side Gemini key", /process\.env\.GEMINI_API_KEY/],
  ["official Gemini generateContent API", /generateContent/],
  ["TanStack status route", /createFileRoute\("\/api\/forge-eye\/status"\)/],
  ["TanStack DeepSeek chat route", /createFileRoute\("\/api\/forge-eye\/chat"\)/],
  ["TanStack Gemini chat route", /createFileRoute\("\/api\/forge-eye\/gemini"\)/],
  ["payload-size limit", /BODY_TOO_LARGE/],
  ["truthful not-configured response", /AI_NOT_CONFIGURED/],
  ["Higgsfield disconnected until verified", /not-connected/]
];

for (const [label, pattern] of required) {
  if (!pattern.test(combined)) {
    throw new Error("Forge Eye check failed: " + label);
  }
}

const blocks = [...html.matchAll(/<script\s+type="module"\s*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) throw new Error("No executable JavaScript module found in the AI Studio HTML.");
const dir = mkdtempSync(join(tmpdir(), "forge-eye-check-"));
try {
  const file = join(dir, "ai-studio.mjs");
  writeFileSync(file, blocks[blocks.length - 1][1], "utf8");
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("AI Studio JavaScript syntax error:\n" + (result.stderr || result.stdout || "unknown node syntax error"));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Forge Eye static checks passed: provider routes, server-side credentials, mobile safeguards, material creation, and inline JavaScript syntax.");
