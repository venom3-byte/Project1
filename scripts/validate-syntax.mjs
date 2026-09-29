import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=process.cwd();
const files=[
  "forge-engine.js","forge-ui.js","forge-production.js","forge-project.js","forge-agent.js",
  "forge-runtime.js","forge-gameplay.js","forge-render.js","forge-ui-system.js","forge-vfx.js",
  "forge-2d.js","forge-ai.js","forge-gameplay-data.js","forge-network.js","forge-replay.js",
  "forge-session.js","forge-shader.js","forge-terrain.js","forge-qa.js","forge-animation.js","forge-vision.js","forge-pose-search.js","server.mjs","forge-pipeline.mjs","scripts/export-android.mjs","scripts/verify-android-package.mjs"
];
const failed=[];
for(const file of files){
  const p=path.join(root,file);
  if(!fs.existsSync(p)){failed.push({file,error:"missing"});continue}
  const r=spawnSync(process.execPath,["--check",p],{encoding:"utf8"});
  if(r.status!==0)failed.push({file,error:(r.stderr||r.stdout||"syntax check failed").trim()});
}
if(failed.length){console.error(JSON.stringify(failed,null,2));process.exit(1)}
console.log("Forge syntax check passed for "+files.length+" files.");