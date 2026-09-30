import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
function arg(name, fallback) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; }
const projectFile = path.resolve(root, arg("--project", "packaging/sample-project.forge.json"));
const out = path.resolve(root, arg("--out", "dist/forge-web"));
const runtimeFiles = [
  "forge-engine.js","forge-runtime.js","forge-project.js","forge-gameplay.js","forge-render.js",
  "forge-ui-system.js","forge-vfx.js","forge-2d.js","forge-ai.js","forge-gameplay-data.js",
  "forge-network.js","forge-replay.js","forge-session.js","forge-shader.js","forge-terrain.js",
  "forge-qa.js","forge-animation.js"
];
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "assets"), { recursive: true });
await fs.copyFile(projectFile, path.join(out, "project.forge.json"));
for (const file of runtimeFiles) await fs.copyFile(path.join(root, file), path.join(out, file));
const assetDirArg = arg("--assets", "");
if (assetDirArg) { try { await fs.cp(path.resolve(root, assetDirArg), path.join(out, "assets"), { recursive: true }); } catch {} }
const runtimeHtml = [
  "<!doctype html><html><head><meta charset=\"utf-8\">",
  "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">",
  "<meta name=\"theme-color\" content=\"#06101d\"><title>Forge Game Runtime</title>",
  "<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{width:100%;height:100%;display:block}#boot{position:fixed;inset:0;display:grid;place-items:center;background:#06101d;color:#bcd0e5;font:14px system-ui;z-index:20}</style></head><body>",
  "<div id=\"boot\">Forge Runtime loading...</div><canvas id=\"c\"></canvas><script type=\"module\">",
  "const boot=document.getElementById(\"boot\"),canvas=document.getElementById(\"c\");",
  "try{const{ForgeEngine}=await import(\"./forge-engine.js\");const engine=new ForgeEngine(canvas,m=>console.log(\"[Forge]\",m));await engine.init();window.Forge=engine;",
  "await import(\"./forge-runtime.js\");await import(\"./forge-gameplay.js\");await import(\"./forge-render.js\");await import(\"./forge-ui-system.js\");",
  "await import(\"./forge-vfx.js\");await import(\"./forge-2d.js\");await import(\"./forge-ai.js\");await import(\"./forge-gameplay-data.js\");",
  "await import(\"./forge-network.js\");await import(\"./forge-replay.js\");await import(\"./forge-session.js\");await import(\"./forge-shader.js\");",
  "await import(\"./forge-terrain.js\");await import(\"./forge-qa.js\");await import(\"./forge-animation.js\");await import(\"./forge-project.js\");",
  "const project=await fetch(\"./project.forge.json\",{cache:\"no-store\"}).then(r=>{if(!r.ok)throw new Error(\"Project file missing\");return r.json()});",
  "project.runtime=project.runtime||{};project.runtime.assetRoot=\"./\";await window.ForgeProject.load(project);engine.running=true;boot.remove();",
  "}catch(error){boot.textContent=\"Forge Runtime error: \"+(error?.message||String(error));console.error(error)}",
  "</script></body></html>"
].join("");
await fs.writeFile(path.join(out, "index.html"), runtimeHtml);
await fs.writeFile(path.join(out, "manifest.webmanifest"), JSON.stringify({name:"Forge Game Runtime",short_name:"ForgeGame",start_url:"./",display:"fullscreen",background_color:"#06101d",theme_color:"#06101d"}, null, 2));
await fs.writeFile(path.join(out, "sw.js"), "self.addEventListener(\"install\",e=>e.waitUntil(caches.open(\"forge-runtime-v1\").then(c=>c.addAll([\"./\",\"./index.html\",\"./project.forge.json\",\"./manifest.webmanifest\"]).then(()=>self.skipWaiting()))));self.addEventListener(\"activate\",e=>e.waitUntil(self.clients.claim()));self.addEventListener(\"fetch\",e=>e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request))));");
await fs.writeFile(path.join(out, "build-info.json"), JSON.stringify({product:"Forge Game Runtime",schema:1,generatedAt:new Date().toISOString(),project:path.basename(projectFile),runtimeFiles:runtimeFiles.length,assetRoot:"./"}, null, 2));
console.log(JSON.stringify({ok:true,out,project:projectFile,runtimeFiles:runtimeFiles.length}, null, 2));