import "./forge-ui.js";

const modules=[
  "./forge-project.js",
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
  "./forge-vision.js",
  "./forge-pose-search.js",
  "./forge-runtime.js",
  "./forge-gameplay.js",
  "./forge-agent.js",
  "./forge-production.js"
];

try{
  for(const url of modules) await import(url);
  window.ForgeBoot={ok:true,modules:modules.length,at:Date.now()};
}catch(error){
  window.ForgeBoot={ok:false,error:error?.message||String(error),at:Date.now()};
  console.error("[ForgeBoot]",error);
  const log=document.querySelector("#log");
  if(log)log.textContent+="[BOOT ERROR] "+(error?.stack||error)+"\n";
  throw error;
}
