import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const html = readFileSync("public/forge/ai-studio.html", "utf8");
const chat = readFileSync("server/api/forge-eye/chat.post.mjs", "utf8");
const status = readFileSync("server/api/forge-eye/status.get.mjs", "utf8");
const gemini = readFileSync("server/api/forge-eye/gemini.post.mjs", "utf8");
const required = [
  ["Arabic right-to-left UI", /<html lang="ar" dir="rtl">/],
  ["actual Three.js module", /importmap/],
  ["transform controls", /TransformControls/],
  ["mobile reduced rendering", /powerPreference:"low-power"/],
  ["pause while hidden", /visibilitychange/],
  ["local project save", /forge-eye-scene-v1/],
  ["server-side provider key", /process\.env\.DEEPSEEK_API_KEY/],
  ["Gemini server-side key", /process\.env\.GEMINI_API_KEY/],
  ["Gemini official model endpoint", /generateContent/],
  ["provider selector", /providerSelect/],
  ["truthful unconfigured status", /AI_NOT_CONFIGURED/]
];
const combinedSource = [html, chat, status, gemini].join("\n");
for (const [label, pattern] of required) {
  if (!pattern.test(combinedSource)) {
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
console.log("Forge Eye static checks passed: required features found and inline module parses.");
