import{ForgeEngine}from"./forge-engine.js";

const canvas=document.getElementById("viewport");
const logEl=document.getElementById("log");
const log=(message,type="info")=>{
  if(logEl){logEl.textContent+="["+new Date().toLocaleTimeString()+"] "+message+"\n";logEl.scrollTop=logEl.scrollHeight}
  if(type==="error")console.error(message);
};

if(!canvas)throw new Error("Forge viewport canvas is missing");
if(window.ForgeReady)await window.ForgeReady;
if(!window.Forge){
  const engine=new ForgeEngine(canvas,log);
  window.Forge=engine;
  window.ForgeReady=engine.init().then(()=>{
    window.dispatchEvent(new CustomEvent("forge-engine-ready",{detail:engine}));
    return engine;
  }).catch(error=>{
    window.ForgeBootError=error;
    log("Forge boot failed: "+(error?.stack||error),"error");
    throw error;
  });
}
try{
  await window.ForgeReady;
  await import("./forge-spatial.js");
  window.dispatchEvent(new Event("forge-ready"));
  const modules=[
    "./forge-production.js",
    "./forge-render.js",
    "./forge-ui-system.js",
    "./forge-vfx.js",
    "./forge-2d.js",
    "./forge-ai.js",
    "./forge-gameplay-data.js",
    "./forge-network.js",
    "./forge-replay.js",
    "./forge-session.js",
    "./forge-shader.js",
    "./forge-terrain.js",
    "./forge-qa.js",
    "./forge-animation.js",
    "./live-vision.js",
    "./forge-runtime.js",
    "./forge-agent.js",
    "./forge-gameplay.js",
    "./forge-project.js",
    "./forge-ui.js"
  ];
  for(const module of modules)await import(module);
  window.ForgeBootState={ok:true,version:"3.0",modules:modules.length,readyAt:new Date().toISOString()};
  log("Forge Studio 3.0 boot sequence complete");
}catch(error){
  window.ForgeBootState={ok:false,error:String(error)};
  log("Forge boot sequence halted: "+(error?.stack||error),"error");
  const state=document.getElementById("standaloneMode");
  if(state)state.textContent="Boot error";
  throw error;
}
