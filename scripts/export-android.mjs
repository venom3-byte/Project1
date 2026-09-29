import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root=path.dirname(fileURLToPath(import.meta.url));
const projectRoot=path.resolve(root,"..");
const projectPath=path.resolve(projectRoot,process.argv[2]||process.env.FORGE_PROJECT||"android/demo-project.forge.json");
const sourceAssets=process.argv[3]?path.resolve(projectRoot,process.argv[3]):(process.env.FORGE_ASSETS?path.resolve(projectRoot,process.env.FORGE_ASSETS):null);
const out=path.resolve(projectRoot,"android/app/src/main/assets/forge");
const tempEntry=path.resolve(projectRoot,".forge-android-entry.mjs");
const require=createRequire(import.meta.url);

async function exists(p){try{await fs.access(p);return true}catch{return false}}
async function copyDir(src,dst){if(!(await exists(src)))return;await fs.cp(src,dst,{recursive:true,force:true})}

const project=JSON.parse(await fs.readFile(projectPath,"utf8"));
project.runtime=project.runtime||{};
project.runtime.assetRoot="./";
project.meta=Object.assign(project.meta||{},{androidExport:true,androidTargetSdk:37});
const android=Object.assign({
  applicationId:"com.venom3byte.forgegame",
  appName:project.meta?.name||"Forge Game",
  versionCode:1,
  versionName:"0.1.0",
  minSdk:24,
  targetSdk:37,
  compileSdk:37
},project.meta?.android||{});


await fs.rm(out,{recursive:true,force:true});
await fs.mkdir(out,{recursive:true});

const entry=[
'import { ForgeEngine } from "./forge-engine.js";',
'const canvas=document.createElement("canvas");',
'canvas.id="c";',
'Object.assign(canvas.style,{width:"100%",height:"100%",display:"block",touchAction:"none"});',
'document.body.appendChild(canvas);',
'const engine=new ForgeEngine(canvas,m=>console.log("[Forge]",m));',
'await engine.init();',
'window.Forge=engine;',
'await import("./forge-runtime.js");',
'await import("./forge-ui-system.js");',
'await import("./forge-render.js");',
'await import("./forge-vfx.js");',
'await import("./forge-2d.js");',
'await import("./forge-ai.js");',
'await import("./forge-gameplay-data.js");',
'await import("./forge-network.js");',
'await import("./forge-replay.js");',
'await import("./forge-session.js");',
'await import("./forge-shader.js");',
'await import("./forge-terrain.js");',
'await import("./forge-qa.js");',
'await import("./forge-animation.js");',
'await import("./forge-vision.js");',
'await import("./forge-pose-search.js");',
'await import("./forge-gameplay.js");',
'await import("./forge-project.js");',
'const project=await fetch("./project.forge.json").then(r=>{if(!r.ok)throw new Error("Project file missing");return r.json()});',
'project.runtime=project.runtime||{};',
'project.runtime.assetRoot="./";',
'await window.ForgeProject.load(project);',
'engine.running=true;',
'window.addEventListener("error",e=>console.error(e.error||e.message));',
'window.addEventListener("unhandledrejection",e=>console.error(e.reason||e));'
].join("\n");
await fs.writeFile(tempEntry,entry,"utf8");

const plugin={
  name:"forge-android-local-runtime",
  setup(buildApi){
    buildApi.onResolve({filter:/^https:\/\/cdn\.jsdelivr\.net\/npm\/playcanvas@.*\/build\/playcanvas\.mjs$/},()=>({path:require.resolve("playcanvas/build/playcanvas.mjs")}));
    buildApi.onResolve({filter:/^https:\/\/cdn\.jsdelivr\.net\/npm\/@dimforge\/rapier3d-compat@.*\/\+esm$/},()=>({path:require.resolve("@dimforge/rapier3d-compat")}));
  }
};

try{
  await build({
    entryPoints:[tempEntry],
    bundle:true,
    format:"esm",
    platform:"browser",
    target:["es2022"],
    outfile:path.join(out,"game.js"),
    minify:true,
    sourcemap:false,
    legalComments:"none",
    plugins:[plugin]
  });
  const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="theme-color" content="#000"><title>Forge Game</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;touch-action:none}#boot{position:fixed;inset:0;display:grid;place-items:center;background:#050912;color:#d5e9ff;font:600 14px system-ui;z-index:10}</style></head><body><div id="boot">Forge Game loading…</div><script type="module">import "./game.js";document.getElementById("boot")?.remove();</script></body></html>';
  await fs.writeFile(path.join(out,"index.html"),html,"utf8");
  await fs.writeFile(path.join(out,"project.forge.json"),JSON.stringify(project,null,2),"utf8");
await fs.writeFile(path.resolve(projectRoot,"android/forge-android.properties.json"),JSON.stringify(android,null,2)+"\n","utf8");
  if(sourceAssets) await copyDir(sourceAssets,path.join(out,"assets"));
  console.log(JSON.stringify({ok:true,out,project:projectPath,assets:sourceAssets||null},null,2));
}finally{
  await fs.rm(tempEntry,{force:true});
}
