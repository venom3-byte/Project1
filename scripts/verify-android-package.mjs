import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=fileURLToPath(new URL("..",import.meta.url));
const dir=path.resolve(root,"android/app/src/main/assets/forge");
const required=["index.html","game.js","project.forge.json"];
const missing=[];
for(const file of required){try{await fs.access(path.join(dir,file))}catch{missing.push(file)}}
if(missing.length)throw new Error("Android package missing: "+missing.join(", "));
const stat=await fs.stat(path.join(dir,"game.js"));
if(stat.size<100000)throw new Error("Android game bundle is unexpectedly small: "+stat.size+" bytes");
const project=JSON.parse(await fs.readFile(path.join(dir,"project.forge.json"),"utf8"));
if(project.format!=="forge-project")throw new Error("Invalid Forge project format in Android package");
if(!Array.isArray(project.scene?.entities))throw new Error("Android project scene is missing entities");
const syntax=spawnSync(process.execPath,["--check",path.join(dir,"game.js")],{encoding:"utf8"});
if(syntax.status!==0)throw new Error("Bundled game.js syntax error: "+(syntax.stderr||syntax.stdout||""));
console.log(JSON.stringify({ok:true,bundleBytes:stat.size,entities:project.scene.entities.length},null,2));
