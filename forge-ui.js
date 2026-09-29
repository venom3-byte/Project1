const $=id=>document.getElementById(id),out=$("log");
const write=(s,type="info")=>{out.textContent+="["+new Date().toLocaleTimeString()+"] "+s+"\n";out.scrollTop=out.scrollHeight;if(type==="error")console.error(s)};
const toast=s=>{const e=document.createElement("div");e.textContent=s;Object.assign(e.style,{position:"fixed",bottom:"18px",left:"50%",transform:"translateX(-50%)",background:"#0b1d31",border:"1px solid #31506f",padding:"10px 14px",borderRadius:"10px",zIndex:99,maxWidth:"92vw",boxShadow:"0 8px 30px #0008"});document.body.appendChild(e);setTimeout(()=>e.remove(),1900)};
import{ForgeEngine}from"./forge-engine.js";
const engine=new ForgeEngine($("viewport"),write);
await engine.init();
window.Forge=engine;
await import("./forge-spatial.js");
for(const module of [
  "./forge-production.js","./forge-project.js","./forge-render.js","./forge-ui-system.js","./forge-vfx.js",
  "./forge-2d.js","./forge-ai.js","./forge-gameplay-data.js","./forge-network.js","./forge-replay.js",
  "./forge-session.js","./forge-shader.js","./forge-terrain.js","./forge-qa.js","./forge-animation.js",
  "./forge-runtime.js","./forge-gameplay.js","./live-vision.js","./forge-agent.js","./forge-export.js","./forge-gizmo.js"
]) await import(module);
window.dispatchEvent(new Event("forge-ready"));

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function icon(k){return({box:"▣",sphere:"●",cylinder:"⬢",capsule:"◉",plane:"▱",camera:"◫",light:"☼",model:"◇",empty:"＋"})[k]||"•"}
function matchesFilter(r){const q=String($("treeFilter")?.value||"").trim().toLowerCase();return !q||r.name.toLowerCase().includes(q)||r.kind.toLowerCase().includes(q)}
function refresh(){
  const tree=$("tree");tree.innerHTML="";
  for(const r of engine.entities.values()){
    if(!matchesFilter(r))continue;
    const row=document.createElement("div");row.className="tree-row"+(r.id===engine.selectedId?" active":"");
    row.innerHTML="<span>"+icon(r.kind)+"</span><span title='"+esc(r.name)+"'>"+esc(r.name)+"</span><small>"+r.kind+"</small>";
    row.onclick=()=>{engine.select(r.id);inspect();refresh()};
    tree.append(row)
  }
  const s=engine.selected();$("selected").textContent=s?s.name:"None";$("sceneCount").textContent=engine.entities.size+" entities";$("hierarchyCount").textContent=engine.entities.size?String(engine.entities.size):"";updateSpatial();updateAssetPanel()
}
function inspect(){
  const r=engine.selected();$("empty").classList.toggle("hidden",!!r);$("form").classList.toggle("hidden",!r);$("kind").textContent=r?r.kind:"—";
  if(!r){$("spatialInfo").classList.add("hidden");updateAssetPanel();return}
  $("name").value=r.name;const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale();
  for(const[id,v]of[["px",p.x],["py",p.y],["pz",p.z],["rx",q.x],["ry",q.y],["rz",q.z],["sx",s.x],["sy",s.y],["sz",s.z]])$(id).value=Number(v.toFixed(3));
  $("body").value=r.components.physics?.mode||"none";$("shape").value=r.components.physics?.shape||"none";updateSpatial();updateAssetPanel()
}
function updateSpatial(){
  const r=engine.selected(),box=$("spatialInfo");if(!box)return;
  if(!r||!window.ForgeSpatial){box.classList.add("hidden");return}
  const i=window.ForgeSpatial.inspect(r);if(!i){box.classList.add("hidden");return}
  box.classList.remove("hidden");const s=i.world.size,o=i.source.size,g=i.geometry||{};
  $("sourceDim").textContent=[o.x,o.y,o.z].map(v=>v.toFixed(3)).join(" × ")+" m";
  $("worldDim").textContent=[s.x,s.y,s.z].map(v=>v.toFixed(3)).join(" × ")+" m";
  $("worldCenter").textContent=[i.world.center.x,i.world.center.y,i.world.center.z].map(v=>v.toFixed(3)).join(", ");
  $("geoVertices").textContent=String(g.vertices||0);
  $("geoTriangles").textContent=String(g.triangles||0);
  $("geoUV").textContent=String(g.uvChannels||0);
  $("geoMaterials").textContent=String(g.materials||0);
  $("geoAnimations").textContent=String(g.animations||0);
  $("geoLOD").textContent=String(g.lods||1);
  $("geoCollision").textContent=r.components.physics?(r.components.physics.mode+"/"+r.components.physics.shape):"none";
}
function updateAssetPanel(){
  const r=engine.selected(),label=$("assetSelected"),type=$("assetType");
  if(!label||!type)return;
  const a=r?.components?.asset;
  label.textContent=r?.name||"No asset selected";
  type.textContent=a?.type?(a.type==="model"?"3D GLB":a.type==="image"?"2D Image":a.type.toUpperCase()):"Scene object";
}
function apply(){
  const r=engine.selected();if(!r)return;
  engine.transform({x:+$("px").value,y:+$("py").value,z:+$("pz").value,rx:+$("rx").value,ry:+$("ry").value,rz:+$("rz").value,sx:+$("sx").value,sy:+$("sy").value,sz:+$("sz").value});
  r.name=$("name").value||r.name;r.entity.name=r.name;
  const b=$("body").value,sh=$("shape").value;if(b==="none")engine.removePhysics(r.id);else engine.setPhysics(r.id,b,sh==="none"?"box":sh);
  refresh();inspect()
}
document.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{let r=b.dataset.add==="camera"?engine.createCamera("Camera "+(engine.entities.size+1),{x:6,y:4,z:8}):b.dataset.add==="light"?engine.createLight("Light "+(engine.entities.size+1)):engine.primitive(b.dataset.add,b.dataset.add+"-"+(engine.entities.size+1));engine.select(r.id);refresh();inspect()});
$("apply").onclick=apply;["px","py","pz","rx","ry","rz","sx","sy","sz","name"].forEach(id=>$(id).onchange=apply);
$("duplicate").onclick=()=>{if(engine.duplicate()){refresh();inspect()}};$("delete").onclick=()=>{engine.delete();refresh();inspect()};$("focus").onclick=()=>engine.focus();$("frame").onclick=()=>engine.frame();$("reset").onclick=()=>location.reload();
$("play").onclick=()=>{$("play").textContent=engine.running?"❚❚ Play":"▶ Play";engine.running=!engine.running;engine.timelinePlaying=engine.running};$("timelinePlay").onclick=()=>$("play").click();
$("rewind").onclick=()=>{engine.timelineTime=0;$("time").value=0;engine.evalAnimation(0);inspect()};$("time").oninput=e=>{engine.timelineTime=+e.target.value||0;engine.evalAnimation(engine.timelineTime);$("playhead").style.left=(engine.timelineTime*60)+"px";inspect()};$("key").onclick=()=>{engine.key();toast("Keyframe added")};
$("importAssets").onclick=()=>$("assetInput").click();$("assetInput").onchange=e=>loadFiles([...e.target.files]);
async function loadFiles(files){for(const f of files)try{await window.ForgeProduction?.assets?.storeFile?.(f);const r=await engine.importFile(f);if(r.type==="project")await engine.load(r.data);write("Imported "+f.name)}catch(e){write("Import failed "+f.name+": "+e.message,"error")}refresh();inspect()}
document.addEventListener("dragover",e=>{e.preventDefault();$("dropOverlay").classList.remove("hidden")});document.addEventListener("drop",e=>{e.preventDefault();$("dropOverlay").classList.add("hidden");if(e.dataTransfer?.files?.length)loadFiles([...e.dataTransfer.files])});
$("saveProject").onclick=()=>{window.ForgeProject.download();toast("Complete Forge project saved")};$("openProject").onclick=()=>$("projectInput").click();$("projectInput").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await window.ForgeProject.load(JSON.parse(await f.text()));refresh();inspect();toast("Complete Forge project loaded")}catch(err){write("Project load failed: "+err.message,"error")}};
$("build").onclick=async()=>{if(window.ForgeProduction?.build){try{const r=await window.ForgeProduction.build();if(r?.url){location.href=r.url;return}}catch(e){write("Build failed: "+e.message,"error")}}window.ForgeProject.download("forge-project-3.5.forge.json");toast("Portable Forge project exported")};
async function assetAction(fn,label){try{const r=await fn();$("assetReport").textContent=JSON.stringify(r,null,2);$("assetBadge").textContent=r.ok?"PASS":"CHECK";$("assetBadge").className="qa-badge "+(r.ok?"pass":"warn");toast(label+(r.ok?" — PASS":" — inspect report"))}catch(e){$("assetBadge").textContent="FAIL";$("assetBadge").className="qa-badge fail";$("assetReport").textContent=JSON.stringify({ok:false,error:e.message},null,2);toast(label+" — "+e.message)}}
$("exportSource")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportSource(),"Source export"));
$("exportGLB")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportSceneGLB(),"GLB export"));
$("exportPreview")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportPreview(),"Viewport PNG"));
$("exportManifest")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportManifest(),"Asset manifest"));
$("validateAsset")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.validateSelected(),"Asset validation"));
$("assetQA")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.runExportQA(),"Export round-trip QA"));
$("treeFilter")?.addEventListener("input",refresh);
$("quickFocus")?.addEventListener("click",()=>engine.focus());
$("quickFrame")?.addEventListener("click",()=>engine.frame());
$("quickVision")?.addEventListener("click",()=>$("visionOpen")?.click());
document.querySelectorAll("[data-gizmo]")?.forEach(b=>b.addEventListener("click",()=>{
  const mode=b.dataset.gizmo;if(window.ForgeGizmo?.setMode(mode)){
    document.querySelectorAll("[data-gizmo]").forEach(x=>x.classList.toggle("active",x===b));
    write("Gizmo: "+mode)
  }
}));
$("spaceToggle")?.addEventListener("click",()=>{
  const next=window.ForgeGizmo?.state?.space==="local"?"world":"local";
  window.ForgeGizmo?.setSpace(next);
  $("spaceToggle").textContent=next==="local"?"Local":"World";
});
window.addEventListener("forge-gizmo-transform",()=>{refresh();inspect()});
window.addEventListener("keydown",e=>{
  if(e.target?.matches?.("input,textarea,select"))return;
  if(e.key==="1")document.querySelector('[data-gizmo="translate"]')?.click();
  else if(e.key==="2")document.querySelector('[data-gizmo="rotate"]')?.click();
  else if(e.key==="3")document.querySelector('[data-gizmo="scale"]')?.click();
});
$("mFocus")?.addEventListener("click",()=>engine.focus());
$("mFrame")?.addEventListener("click",()=>engine.frame());
$("mExport")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportSource(),"Source export"));

function smoke(){
  const d=engine.diagnostics(),s=window.ForgeSpatial?window.ForgeSpatial.sceneVision():null;
  const checks=[["renderer",d.renderer==="WebGPU"||d.renderer==="WebGL2"],["scene",d.entities>0],["camera",[...engine.entities.values()].some(x=>x.kind==="camera")],["ground",[...engine.entities.values()].some(x=>x.name==="Ground")],["physics",d.physics>0],["spatialCore",!!d.spatial],["renderLoop",d.fps>=0],["sceneVision",!!s]];
  return{ok:checks.every(x=>x[1]),checks,diagnostics:d,vision:s}
}
$("qa").onclick=()=>{$("qaReport").textContent=JSON.stringify(smoke(),null,2);$("qaDialog").showModal()};$("runQA").onclick=()=>{$("qaReport").textContent=JSON.stringify(smoke(),null,2)};
$("script").onclick=()=>{const r=engine.selected();if(!r)return toast("Select an entity");$("scriptDialog").showModal();$("code").value=engine.scripts.get(r.id)||$("code").value};$("saveScript").onclick=()=>{const r=engine.selected();if(r){engine.attachScript(r.id,$("code").value);$("scriptDialog").close();toast("Script attached")}};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).close());$("clear").onclick=()=>out.textContent="";
document.querySelectorAll(".mode").forEach(b=>b.onclick=()=>{document.querySelectorAll(".mode").forEach(x=>x.classList.remove("active"));b.classList.add("active");write("Workspace: "+b.dataset.mode)});
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{engine.setView(b.dataset.view);refresh();inspect()});
$("snapToggle")?.addEventListener("change",e=>{engine.snapEnabled=e.target.checked;window.ForgeSpatial?.setSnap(engine.snapSize)});
$("snapSize")?.addEventListener("change",e=>{engine.snapSize=Math.max(.001,+e.target.value||.25);window.ForgeSpatial?.setSnap(engine.snapSize)});
$("boundsToggle")?.addEventListener("change",e=>{if(window.ForgeSpatial)window.ForgeSpatial.showBounds=e.target.checked});
$("visionRefresh")?.addEventListener("click",()=>{$("visionReport").textContent=JSON.stringify(window.ForgeSpatial?.sceneVision?.()||{},null,2)});
$("visionCenter")?.addEventListener("click",()=>{engine.frame();$("visionReport").textContent=JSON.stringify(window.ForgeSpatial?.sceneVision?.()||{},null,2)});
$("visionMove")?.addEventListener("click",()=>{const r=engine.selected(),rect=$("viewport").getBoundingClientRect();if(!r||!window.ForgeSpatial)return;window.ForgeSpatial.moveToScreen(r.id,rect.left+rect.width/2,rect.top+rect.height/2,.5,0);refresh();inspect()});
$("visionOpen")?.addEventListener("click",()=>{if(!window.ForgeSpatial)return;$("visionReport").textContent=JSON.stringify(window.ForgeSpatial.sceneVision(),null,2);$("visionDialog").showModal()});
$("visionSelect")?.addEventListener("click",()=>toast("Tap an object in the viewport to select it"));
$("standaloneMode").textContent=location.protocol==="file:"?"Local file":(/github\.io$/i.test(location.hostname)?"Standalone PWA":"Server + WebSocket");
engine.canvas.addEventListener("pointerdown",()=>{setTimeout(()=>{refresh();inspect()},0)});
window.addEventListener("forge-selection",()=>{refresh();inspect()});
window.ForgeVision={scan:()=>window.ForgeSpatial?.sceneVision?.()||{},inspect:id=>{const r=engine.entities.get(id);return r?window.ForgeSpatial?.inspect?.(r):null},selectAt:(x,y)=>engine.pick({clientX:x,clientY:y})};
function stats(){const d=engine.diagnostics();$("renderer").textContent=d.renderer;$("fps").textContent=d.fps;$("physics").textContent=d.physics;requestAnimationFrame(stats)}
stats();refresh();inspect();write("Forge Studio 3.5 ready");
