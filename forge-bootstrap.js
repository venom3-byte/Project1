const bootStarted=performance.now();
const bootTimings=[];
window.ForgeBoot={ok:false,phase:"starting",startedAt:Date.now(),startedPerf:bootStarted,timings:bootTimings};

const importTimed=async(url,phase)=>{
  const t0=performance.now();
  await import(url);
  const ms=Number((performance.now()-t0).toFixed(2));
  bootTimings.push({phase,url,ms});
  window.ForgeBoot.timings=bootTimings;
  return ms;
};

const coreModules=[
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
  "./forge-runtime.js"
];

try{
  await importTimed("./forge-ui.js","editor-core");
  window.ForgeBoot.engineReadyMs=Number((performance.now()-bootStarted).toFixed(2));

  window.ForgeBoot.phase="core";
  for(const url of coreModules) await importTimed(url,"core");
  window.ForgeBoot.coreReadyMs=Number((performance.now()-bootStarted).toFixed(2));

  window.ForgeBoot.phase="gameplay";
  await importTimed("./forge-gameplay.js","gameplay");
  window.ForgeBoot.gameplayReadyMs=Number((performance.now()-bootStarted).toFixed(2));

  window.ForgeBoot.phase="tools";
  await importTimed("./forge-agent.js","tools");
  await importTimed("./forge-production.js","tools");

  const totalMs=Number((performance.now()-bootStarted).toFixed(2));
  window.ForgeBoot={...window.ForgeBoot,ok:true,phase:"ready",modules:coreModules.length+4,totalMs,readyAt:Date.now()};
  document.documentElement.dataset.forgeBootMs=String(totalMs);
  document.dispatchEvent(new CustomEvent("forgebootready",{detail:window.ForgeBoot}));
}catch(error){
  const totalMs=Number((performance.now()-bootStarted).toFixed(2));
  window.ForgeBoot={...window.ForgeBoot,ok:false,phase:"error",error:error?.message||String(error),totalMs,failedAt:Date.now()};
  console.error("[ForgeBoot]",error);
  const log=document.querySelector("#log");
  if(log)log.textContent+="[BOOT ERROR] "+(error?.stack||error)+"\n";
  document.documentElement.dataset.forgeBootMs=String(totalMs);
  throw error;
}
