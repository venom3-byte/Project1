const bootEl=document.getElementById("forgeBoot"),bootText=document.getElementById("forgeBootText");
window.ForgeReady=false;window.ForgeBootState="loading";document.documentElement.dataset.forgeReady="0";
function bootMessage(s,error=false){if(bootText)bootText.textContent=s;if(error){bootEl?.classList.remove("hidden");if(bootText)bootText.style.color="#ff9aa6"}}
const $=id=>document.getElementById(id),out=$("log");
let forgeExportPromise=null;
const loadForgeExport=async()=>{
  if(forgeExportPromise)return forgeExportPromise;
  forgeExportPromise=import("./forge-export.js").then(()=>window.ForgeExport);
  return forgeExportPromise;
};
const forgeExportProxy=new Proxy({},{
  get(_target,prop){
    return async(...args)=>{
      const api=await loadForgeExport();
      const fn=api?.[prop];
      if(typeof fn!=="function")throw new Error("Forge export API method unavailable: "+String(prop));
      return fn(...args);
    };
  }
});
window.ForgeExport=forgeExportProxy;
let forgeAgentPromise=null;
const loadForgeAgent=async()=>{
  if(forgeAgentPromise)return forgeAgentPromise;
  forgeAgentPromise=import("./forge-agent.js").then(()=>window.ForgeAgent);
  return forgeAgentPromise;
};
const forgeAgentProxy=new Proxy({},{
  get(_target,prop){
    if(prop==="serverCapable")return()=>location.protocol!=="file:"&&!/github\\.io$/i.test(location.hostname);
    return async(...args)=>{
      const api=await loadForgeAgent();
      const fn=api?.[prop];
      if(typeof fn!=="function")throw new Error("Forge agent API method unavailable: "+String(prop));
      return fn.apply(api,args);
    };
  }
});
window.ForgeAgent=forgeAgentProxy;
let forgeVisionPromise=null;
const loadForgeVision=async()=>{
  if(forgeVisionPromise)return forgeVisionPromise;
  forgeVisionPromise=import("./live-vision.js").then(()=>window.AssetForgeLiveVision);
  return forgeVisionPromise;
};
const lightweightVision={
  visualHealth(){
    const canvas=document.getElementById("viewport"),root=document.documentElement;
    const rect=canvas?.getBoundingClientRect?.()||{width:0,height:0};
    const viewport={width:rect.width||0,height:rect.height||0};
    const overflow=Math.max(0,(root.scrollWidth||0)-(root.clientWidth||0));
    return{ok:viewport.width>300&&viewport.height>300&&overflow<=1,viewport,overflow,mode:"lightweight"};
  },
  status(){return{running:false,connected:false,standalone:location.protocol==="file:"||/github\\.io$/i.test(location.hostname),lazy:true};}
};
const forgeVisionProxy=new Proxy(lightweightVision,{
  get(target,prop){
    if(prop in target)return target[prop];
    return async(...args)=>{
      const api=await loadForgeVision();
      const fn=api?.[prop];
      if(typeof fn!=="function")throw new Error("Forge vision API method unavailable: "+String(prop));
      return fn(...args);
    };
  }
});
window.AssetForgeLiveVision=forgeVisionProxy;const write=(s,type="info")=>{out.textContent+="["+new Date().toLocaleTimeString()+"] "+s+"\n";out.scrollTop=out.scrollHeight;if(type==="error")console.error(s)};
const toast=s=>{const e=document.createElement("div");e.textContent=s;Object.assign(e.style,{position:"fixed",bottom:"18px",left:"50%",transform:"translateX(-50%)",background:"#0b1d31",border:"1px solid #31506f",padding:"10px 14px",borderRadius:"10px",zIndex:99,maxWidth:"92vw",boxShadow:"0 8px 30px #0008"});document.body.appendChild(e);setTimeout(()=>e.remove(),1900)};
import{ForgeEngine}from"./forge-engine.js";
const forgeRuntimeDefaults=()=>{
  const bindings=new Map([
    ["moveForward",["KeyW","ArrowUp"]],["moveBack",["KeyS","ArrowDown"]],
    ["moveLeft",["KeyA","ArrowLeft"]],["moveRight",["KeyD","ArrowRight"]],
    ["jump",["Space"]],["fire",["Mouse0","KeyJ"]],["sprint",["ShiftLeft","ShiftRight"]]
  ]);
  const down=new Set(),gamepadDown=new Set();
  const input={
    bindings,down,gamepadDown,virtualMove:{x:0,z:0},gamepadMove:{x:0,z:0},
    bind(action,keys){bindings.set(action,[...(keys||[])]);return this},
    isDown(action){return down.has(action)||gamepadDown.has(action)},
    moveVector(){const x=this.virtualMove.x+((down.has("moveRight")?1:0)-(down.has("moveLeft")?1:0));const z=this.virtualMove.z+((down.has("moveForward")?1:0)-(down.has("moveBack")?1:0));const l=Math.hypot(x,z);return l>1?{x:x/l,z:z/l}:{x,z}},
    snapshot(){return Object.fromEntries([...bindings].map(([k])=>[k,this.isDown(k)]))},
    mountMobileControls(){return this}
  };
  addEventListener("keydown",e=>{for(const[k,keys]of bindings)if(keys.includes(e.code)||keys.includes(e.key))down.add(k)});
  addEventListener("keyup",e=>{for(const[k,keys]of bindings)if(keys.includes(e.code)||keys.includes(e.key))down.delete(k)});
  addEventListener("blur",()=>{down.clear();gamepadDown.clear()});
  const nav={cell:.75,width:80,height:80,blocked:new Uint8Array(80*80),clear(){this.blocked.fill(0)},bakeFromScene(F){this.clear();for(const r of F.entities.values()){if(!r.components.navObstacle)continue;const p=r.entity.getPosition(),s=r.entity.getLocalScale();const min={x:Math.floor((p.x-s.x)/this.cell+this.width/2),z:Math.floor((p.z-s.z)/this.cell+this.height/2)},max={x:Math.floor((p.x+s.x)/this.cell+this.width/2),z:Math.floor((p.z+s.z)/this.cell+this.height/2)};for(let z=Math.max(0,min.z);z<=Math.min(this.height-1,max.z);z++)for(let x=Math.max(0,min.x);x<=Math.min(this.width-1,max.x);x++)this.blocked[z*this.width+x]=1}},path(){return[]}};
  const save={save(slot,data){localStorage.setItem("forge.slot."+slot,JSON.stringify({savedAt:new Date().toISOString(),data}));return true},load(slot){const v=localStorage.getItem("forge.slot."+slot);return v?JSON.parse(v):null},list(){return Object.keys(localStorage).filter(k=>k.startsWith("forge.slot.")).map(k=>k.slice(11))},remove(slot){localStorage.removeItem("forge.slot."+slot)}};
  const audio={volumes:{master:1,music:1,sfx:1,ui:1,ambience:1},serialize(){return{volumes:this.volumes}},loadState(d){if(d?.volumes)this.volumes=Object.assign(this.volumes,d.volumes)},setVolume(bus,value){this.volumes[bus]=Math.max(0,Math.min(1,Number(value)||0))}};
  const prefabs={store:new Map(JSON.parse(localStorage.getItem("forge.prefabs")||"[]")),list(){return[...this.store.keys()]},persist(){localStorage.setItem("forge.prefabs",JSON.stringify([...this.store.entries()]))},capture(){return null},save(){return null},get(){return null},spawn(){return null}};
  return{input,nav,save,audio,prefabs,snapshot(){return{input:input.snapshot(),slots:save.list(),prefabs:prefabs.list(),audio:audio.serialize(),lazyRuntime:true}}};
};
if(!window.ForgeRuntime)window.ForgeRuntime=forgeRuntimeDefaults();
let forgeRuntimePromise=null;
const loadForgeRuntime=async()=>{
  if(forgeRuntimePromise)return forgeRuntimePromise;
  forgeRuntimePromise=import("./forge-runtime.js").then(()=>{
    const R=window.ForgeRuntime;
    if(R){const old=R.snapshot;R.snapshot=()=>Object.assign(old?old():{},window.ForgeGameplay?{gameplay:window.ForgeGameplay.status()}:{});R.__lazyLoaded=true}
    return R;
  });
  return forgeRuntimePromise;
};
const engine=new ForgeEngine($("viewport"),write);
try{bootMessage("Starting renderer and physics…");await engine.init();window.Forge=engine;bootMessage("Loading spatial core and editor systems…");await import("./forge-spatial.js");for(const module of [
  "./forge-production.js","./forge-project.js","./forge-render.js","./forge-ui-system.js","./forge-vfx.js",
  "./forge-2d.js","./forge-ai.js","./forge-gameplay-data.js","./forge-network.js","./forge-replay.js",
  "./forge-session.js","./forge-shader.js","./forge-terrain.js","./forge-qa.js","./forge-animation.js","./forge-gameplay.js",
]){
  bootMessage("Loading "+module+"…");
  const started=performance.now();
  await Promise.race([
    import(module),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error("Module load timeout after 15000ms: "+module)),15000))
  ]);
  write("Loaded "+module+" in "+Math.round(performance.now()-started)+"ms");
}}
catch(error){window.ForgeBootState="error";bootMessage("Forge could not complete startup: "+(error?.message||String(error)),true);console.error(error);throw error}

let forgeGizmoLoad=null;
function ensureForgeGizmo(){
  if(window.ForgeGizmo?.nativeReady) return Promise.resolve(window.ForgeGizmo);
  if(forgeGizmoLoad) return forgeGizmoLoad;
  forgeGizmoLoad=import("./forge-gizmo.js").then(()=>window.ForgeGizmo).catch(error=>{
    forgeGizmoLoad=null;
    write("Native gizmo load failed: "+error.message,"error");
    return window.ForgeGizmo;
  });
  return forgeGizmoLoad;
}
if(!window.ForgeGizmo){
  const state={mode:"translate",space:"world",layer:null,gizmos:{},ready:true,nativeReady:false,initializing:false};
  window.ForgeGizmo={
    state,
    setMode(mode){if(!["translate","rotate","scale"].includes(mode))return false;state.mode=mode;return true},
    setSpace(space){state.space=space==="local"?"local":"world";return state.space},
    init(){return ensureForgeGizmo().then(g=>g?.init?.().then?.(()=>g)??g)}
  };
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function icon(k){return({box:"▣",sphere:"●",cylinder:"⬢",capsule:"◉",plane:"▱",camera:"◫",light:"☼",model:"◇",audio:"♫",empty:"＋"})[k]||"•"}
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
  const s=engine.selected();$("selected").textContent=s?s.name:"None";$("sceneCount").textContent=engine.entities.size+" entities";$("hierarchyCount").textContent=engine.entities.size?String(engine.entities.size):"";updateSpatial();updateAssetPanel();updateAssetBrowser()
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
  const center=i.world.center;
  const cx=Number(center?.x??center?.[0]??0),cy=Number(center?.y??center?.[1]??0),cz=Number(center?.z??center?.[2]??0);
  $("worldCenter").textContent=[cx,cy,cz].map(v=>v.toFixed(3)).join(", ");
  $("geoVertices").textContent=String(g.vertices||0);
  $("geoTriangles").textContent=String(g.triangles||0);
  $("geoUV").textContent=String(g.uvChannels||0);
  $("geoMaterials").textContent=String(g.materials||0);
  $("geoAnimations").textContent=String(g.animations||0);
  $("geoLOD").textContent=String(g.lods||1);
  $("geoCollision").textContent=r.components.physics?(r.components.physics.mode+"/"+r.components.physics.shape):"none";
}
function updateAssetPanel(){
  const r=engine.selected(),label=$("assetSelected"),type=$("assetType"),meta=$("assetMeta");
  if(!label||!type)return;
  const a=r?.components?.asset;
  label.textContent=r?.name||"No asset selected";
  type.textContent=a?.type?(a.type==="model"?"3D Model":a.type==="image"?"2D Image":a.type==="audio"?"AUDIO":a.type==="file"?"SOURCE FILE":"FILE"):"Scene object";
  const play=$("assetPlay");
  if(play){
    const isAudio=a?.type==="audio"&&!!r?.entity?.sound?.slot?.("main");
    play.disabled=!isAudio;
    play.textContent=isAudio?(r.entity.sound.slot("main").isPlaying?"■ Stop Audio":"▶ Play Audio"):"▶ Play Audio";
  }
  if(meta){
    if(!a){
      meta.textContent="Select an imported asset to inspect source metadata.";
    }else{
      const entry=engine.assets?.get?.(a.name);
      const bytes=Number(entry?.file?.size||0);
      const mime=entry?.file?.type||"application/octet-stream";
      const dims=a.width&&a.height?(" · "+a.width+"×"+a.height+"px"):"";
      meta.textContent="SOURCE · "+a.name+" · "+bytes.toLocaleString()+" bytes · "+mime+dims;
    }
  }
}
function updateAssetBrowser(){
  const list=$("assetList");if(!list)return;
  const q=String($("assetSearch")?.value||"").trim().toLowerCase();
  list.innerHTML="";
  const records=[...engine.entities.values()].filter(r=>r.components?.asset?.name).filter(r=>!q||r.name.toLowerCase().includes(q)||String(r.components.asset.type).toLowerCase().includes(q));
  if(!records.length){const e=document.createElement("div");e.className="asset-empty";e.textContent="No imported assets";list.append(e);return}
  for(const r of records){
    const row=document.createElement("button");row.className="asset-row"+(r.id===engine.selectedId?" active":"");
    const t=r.components.asset.type==="model"?"3D":r.components.asset.type==="image"?"2D":r.components.asset.type==="audio"?"AUD":"FILE";
    const visual=document.createElement("span");visual.className="asset-visual";
    const entry=engine.assets?.get?.(r.components.asset.name);
    if(r.components.asset.type==="image"&&entry?.file){
      if(!entry.previewUrl){try{entry.previewUrl=URL.createObjectURL(entry.file)}catch{}}
      if(entry.previewUrl){
        const img=document.createElement("img");img.className="asset-thumb";img.alt="";img.src=entry.previewUrl;visual.append(img);
      }else{
        const ic=document.createElement("span");ic.className="asset-icon";ic.textContent=t;visual.append(ic);
      }
    }else{
      const ic=document.createElement("span");ic.className="asset-icon";ic.textContent=t;visual.append(ic);
    }
    row.append(visual);
    const nameNode=document.createElement("span");nameNode.className="asset-name";nameNode.textContent=r.name;row.append(nameNode);
    const kindNode=document.createElement("span");kindNode.className="asset-kind";kindNode.textContent=r.kind;row.append(kindNode);
    row.onclick=()=>{engine.select(r.id);refresh();inspect();engine.focus()};
    list.append(row)
  }
}
function apply(){
  const r=engine.selected();if(!r)return;
  engine.transform({x:+$("px").value,y:+$("py").value,z:+$("pz").value,rx:+$("rx").value,ry:+$("ry").value,rz:+$("rz").value,sx:+$("sx").value,sy:+$("sy").value,sz:+$("sz").value});
  r.name=$("name").value||r.name;r.entity.name=r.name;
  const b=$("body").value,sh=$("shape").value;if(b==="none")engine.removePhysics(r.id);else engine.setPhysics(r.id,b,sh==="none"?"box":sh);
  refresh();inspect()
}
const selectAndRefresh=(r)=>{
  if(!r)return;
  engine.select(r.id);
  try{refresh()}catch(e){write("Selection refresh failed: "+e.message,"error")}
  try{inspect()}catch(e){write("Selection inspect failed: "+e.message,"error")}
  requestAnimationFrame(()=>{try{refresh();inspect()}catch(e){write("Deferred selection UI failed: "+e.message,"error")}});
};
document.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{
  const r=b.dataset.add==="camera"?engine.createCamera("Camera "+(engine.entities.size+1),{x:6,y:4,z:8}):b.dataset.add==="light"?engine.createLight("Light "+(engine.entities.size+1)):engine.primitive(b.dataset.add,b.dataset.add+"-"+(engine.entities.size+1));
  selectAndRefresh(r);
});
$("apply").onclick=apply;["px","py","pz","rx","ry","rz","sx","sy","sz","name"].forEach(id=>$(id).onchange=apply);
$("duplicate").onclick=()=>{if(engine.duplicate()){refresh();inspect()}};$("undo")?.addEventListener("click",()=>{if(engine.undo()){refresh();inspect()}});$("redo")?.addEventListener("click",()=>{if(engine.redo()){refresh();inspect()}});
$("delete").onclick=()=>{engine.delete();refresh();inspect()};$("focus").onclick=()=>engine.focus();$("frame").onclick=()=>engine.frame();$("reset")?.addEventListener("click",()=>location.reload());
const setForgeRuntimeActive=active=>{document.body.dataset.forgeRuntimeActive=active?"1":"0";document.documentElement.dataset.forgeRuntimeActive=active?"1":"0";window.dispatchEvent(new Event("forge-runtime-visibility"))};
setForgeRuntimeActive(false);
$("play").onclick=()=>{$("play").textContent=engine.running?"❚❚ Play":"▶ Play";engine.running=!engine.running;engine.timelinePlaying=engine.running;setForgeRuntimeActive(engine.running)};$("timelinePlay").onclick=()=>$("play").click();
$("rewind").onclick=()=>{engine.timelineTime=0;$("time").value=0;engine.evalAnimation(0);inspect()};$("time").oninput=e=>{engine.timelineTime=+e.target.value||0;engine.evalAnimation(engine.timelineTime);$("playhead").style.left=(engine.timelineTime*60)+"px";inspect()};$("key").onclick=()=>{engine.key();toast("Keyframe added")};
$("draw2dOpen")?.addEventListener("click",()=>{
  const d=$("draw2dDialog");
  if(d&&!d.open)try{d.showModal()}catch{d.setAttribute("open","")}
});
const REALISTIC_CAR_URL="https://raw.githubusercontent.com/M-ZohaibAli/Velocity/main/public/models/CAR%20Model.glb";
async function importRealisticCar(){
  const button=$("importRealCar");
  const previous=button?.textContent;
  try{
    if(button){button.disabled=true;button.textContent="🚘 Loading high-quality car…"}
    const response=await fetch(REALISTIC_CAR_URL,{mode:"cors",cache:"no-store"});
    if(!response.ok)throw new Error("Realistic car download failed: HTTP "+response.status);
    const blob=await response.blob();
    const file=new File([blob],"Forge-Realistic-Supercar.glb",{type:"model/gltf-binary"});
    await window.ForgeProduction?.assets?.storeFile?.(file);
    const existing=engine.assets.get(file.name);
    if(existing)engine.assets.delete(file.name);
    const record=engine.add("model",file.name.replace(/\.[^.]+$/,""));
    record.components.asset={type:"model",name:file.name,analysis:await window.ForgeProduction?.assets?.analyze?.(file).catch?.(()=>null),sourceUnits:"source-native",sourcePreserved:true,previewOnly:true,previewRenderer:"three.js",remoteSource:REALISTIC_CAR_URL,license:"CC-BY 3.0",catalogSource:"Ignition Labs — CAR Model via Poly Pizza, mirrored in M-ZohaibAli/Velocity",qualityProfile:"realistic-supercar-pbr"};
    engine.assets.set(file.name,{type:"model",file,url:URL.createObjectURL(file),remoteSource:REALISTIC_CAR_URL,previewOnly:true});
    engine.select(record.id);
    refresh();inspect();
    const preview=await import("./forge-realcar-preview.js");
    await preview.openRealCarPreview({file,name:record.name,meta:record.components.asset});
    engine.select(record.id);refresh();inspect();
    toast("Realistic supercar imported — real GLB rendered in 3D preview");
    write("Imported Ignition Labs CAR Model — CC-BY 3.0 — Three.js preview");
    return{type:"model",record,previewOnly:true};
  }finally{
    if(button){button.disabled=false;button.textContent=previous||"🚘 Import high-quality car"}
  }
}
window.ForgeDemoAssets={importRealisticCar,REALISTIC_CAR_URL};
$("importAssets").onclick=()=>$("assetInput").click();$("assetInput").onchange=e=>loadFiles([...e.target.files]);
async function fileDataUri(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+chunk)));
  const mime=file.type||(()=>{const e=file.name.toLowerCase().split(".").pop();return({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",avif:"image/avif",gif:"image/gif",bmp:"image/bmp",wav:"audio/wav",mp3:"audio/mpeg",ogg:"audio/ogg"}[e]||"application/octet-stream")})();
  return "data:"+mime+";base64,"+btoa(binary);
}
async function packageGltfWithSelectedFiles(gltf,files){
  const json=JSON.parse(await gltf.text());
  const byName=new Map(files.map(f=>[f.name.replaceAll("\\","/").split("/").at(-1).toLowerCase(),f]));
  const patchUris=async group=>{
    for(const item of group||[]){
      const uri=item?.uri;
      if(!uri||String(uri).startsWith("data:"))continue;
      const clean=decodeURIComponent(String(uri).split(/[?#]/)[0]).replaceAll("\\","/").split("/").at(-1).toLowerCase();
      const f=byName.get(clean);
      if(!f)throw new Error("Missing glTF dependency: "+uri);
      item.uri=await fileDataUri(f);
    }
  };
  await patchUris(json.buffers);
  await patchUris(json.images);
  return new File([JSON.stringify(json)],gltf.name,{type:"model/gltf+json"});
}
async function loadFiles(files){
  const list=[...(files||[])].filter(Boolean);
  for(const f of list)try{await window.ForgeProduction?.assets?.storeFile?.(f)}catch(e){write("Asset vault store failed "+f.name+": "+e.message,"error")}
  const gltf=list.find(f=>/\.gltf$/i.test(f.name));
  if(gltf){
    try{
      const packaged=await packageGltfWithSelectedFiles(gltf,list);
      const r=await engine.importFile(packaged);
      if(r.type==="project")await engine.load(r.data);
      write("Imported packaged glTF "+gltf.name);
      refresh();inspect();
      return;
    }catch(e){
      write("glTF package import failed; source files remain in Content Browser: "+e.message,"error");
    }
  }
  const legacyModels=list.filter(f=>/\.(fbx|obj|dae|3ds)$/i.test(f.name));
  const legacyDependencyNames=new Set(list.filter(f=>/\.(mtl|tga|dds)$/i.test(f.name)).map(f=>f.name));
  for(const f of legacyModels){
    try{await engine.importFile(f,{files:list});write("Imported and converted "+f.name+" to an internal GLB representation")}
    catch(e){write("Legacy 3D conversion failed "+f.name+": "+e.message,"error")}
  }
  for(const f of list){
    if(gltf&&f===gltf)continue;
    if(legacyModels.includes(f))continue;
    if(legacyDependencyNames.has(f.name))continue;
    if(gltf&&f===gltf)continue;
    try{
      const r=await engine.importFile(f);
      if(r.type==="project")await engine.load(r.data);
      write("Imported "+f.name);
    }catch(e){
      write("Import failed "+f.name+": "+e.message,"error");
    }
  }
  refresh();inspect();
}
document.addEventListener("dragover",e=>{e.preventDefault();$("dropOverlay").classList.remove("hidden")});document.addEventListener("drop",e=>{e.preventDefault();$("dropOverlay").classList.add("hidden");if(e.dataTransfer?.files?.length)loadFiles([...e.dataTransfer.files])});
$("saveProject").onclick=()=>{window.ForgeProject.download();toast("Complete Forge project saved")};$("openProject").onclick=()=>$("projectInput").click();$("projectInput").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await window.ForgeProject.load(JSON.parse(await f.text()));refresh();inspect();toast("Complete Forge project loaded")}catch(err){write("Project load failed: "+err.message,"error")}};
$("openEditors")?.addEventListener("click",()=>window.ForgeProduction?.openEditors?.());
$("build").onclick=async()=>{if(window.ForgeProduction?.build){try{const r=await window.ForgeProduction.build();if(r?.url){location.href=r.url;return}}catch(e){write("Build failed: "+e.message,"error")}}window.ForgeProject.download("forge-project-3.5.forge.json");toast("Portable Forge project exported")};
async function assetAction(fn,label){try{const r=await fn();$("assetReport").textContent=JSON.stringify(r,null,2);$("assetBadge").textContent=r.ok?"PASS":"CHECK";$("assetBadge").className="qa-badge "+(r.ok?"pass":"warn");toast(label+(r.ok?" — PASS":" — inspect report"))}catch(e){$("assetBadge").textContent="FAIL";$("assetBadge").className="qa-badge fail";$("assetReport").textContent=JSON.stringify({ok:false,error:e.message},null,2);toast(label+" — "+e.message)}}
$("exportSource")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportSource(),"Source export"));
$("exportGLB")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportSceneGLB(),"GLB export"));
$("exportPreview")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportPreview(),"Viewport PNG"));
$("exportManifest")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportManifest(),"Asset manifest"));
$("validateAsset")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.validateSelected(),"Asset validation"));
$("assetQA")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.runExportQA(),"Export round-trip QA"));
$("assetPlay")?.addEventListener("click",()=>{
  const r=engine.selected(),slot=r?.entity?.sound?.slot?.("main");
  if(!slot)return;
  try{
    if(slot.isPlaying)slot.stop();else slot.play();
    updateAssetPanel();
  }catch(e){write("Audio playback failed: "+e.message,"error")}
});
$("treeFilter")?.addEventListener("input",refresh);
$("assetSearch")?.addEventListener("input",updateAssetBrowser);
$("quickFocus")?.addEventListener("click",()=>engine.focus());
$("quickFrame")?.addEventListener("click",()=>engine.frame());
$("quickVision")?.addEventListener("click",()=>$("visionOpen")?.click());
document.querySelectorAll("[data-gizmo]")?.forEach(b=>b.addEventListener("click",()=>{
  const mode=b.dataset.gizmo;
  if(window.ForgeGizmo?.setMode(mode)){
    document.querySelectorAll("[data-gizmo]").forEach(x=>x.classList.toggle("active",x===b));
    write("Gizmo: "+mode);
    requestAnimationFrame(()=>ensureForgeGizmo().then(g=>g?.init?.()));
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
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();if(engine.undo()){refresh();inspect()}return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();if(engine.redo()){refresh();inspect()}return}

  if(e.key==="1")document.querySelector('[data-gizmo="translate"]')?.click();
  else if(e.key==="2")document.querySelector('[data-gizmo="rotate"]')?.click();
  else if(e.key==="3")document.querySelector('[data-gizmo="scale"]')?.click();
});
$("mFocus")?.addEventListener("click",()=>engine.focus());
$("mFrame")?.addEventListener("click",()=>engine.frame());
$("mExport")?.addEventListener("click",()=>assetAction(()=>window.ForgeExport.exportSource(),"Source export"));

function smoke(){
  const d=engine.diagnostics(),v=window.AssetForgeLiveVision?.visualHealth?.()||null;
  const vision={camera:!!engine.camera(),objects:[...engine.entities.values()].filter(x=>x.entity.render?.meshInstances?.length).map(x=>({id:x.id,name:x.name,kind:x.kind}))};
  const checks=[["renderer",d.renderer==="WebGPU"||d.renderer==="WebGL2"],["scene",d.entities>0],["camera",[...engine.entities.values()].some(x=>x.kind==="camera")],["ground",[...engine.entities.values()].some(x=>x.name==="Ground")],["physics",d.physics>0],["spatialCore",!!d.spatial],["renderLoop",d.fps>=0],["sceneVision",!!vision]];
  return{ok:checks.every(x=>x[1])&&(v?.ok!==false),checks,diagnostics:d,vision,visualHealth:v}
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
engine.canvas.addEventListener("pointerdown",()=>{
  requestAnimationFrame(()=>ensureForgeGizmo().then(g=>g?.init?.()));
  setTimeout(()=>{refresh();inspect()},0)
});
window.addEventListener("forge-selection",()=>{try{refresh()}catch(e){write("Selection event refresh failed: "+e.message,"error")}try{inspect()}catch(e){write("Selection event inspect failed: "+e.message,"error")}});
window.addEventListener("forge-assets-changed",()=>{try{refresh()}catch(e){write("Asset event refresh failed: "+e.message,"error")}try{inspect()}catch(e){write("Asset event inspect failed: "+e.message,"error")}});
window.ForgeRefreshUI=()=>{refresh();inspect();};
window.ForgeVision={scan:()=>window.ForgeSpatial?.sceneVision?.()||{},inspect:id=>{const r=engine.entities.get(id);return r?window.ForgeSpatial?.inspect?.(r):null},selectAt:(x,y)=>engine.pick({clientX:x,clientY:y})};
function stats(){const d=engine.diagnostics();$("renderer").textContent=d.renderer;$("fps").textContent=d.fps;$("physics").textContent=d.physics;requestAnimationFrame(stats)}
const waitForPublicAPIs=async()=>{
  const required={
    ForgeGameplay:["createThirdPersonTemplate","createRacingTemplate","createShowcaseGame","status"],
    Forge2D:["createPlatformerTemplate","status"],
    ForgeProject:["serialize","load"],
    ForgeRender:["apply","quality","serialize"],
    ForgeVFX:["spawn","status"],
    ForgeRuntime:["snapshot","input"],
    ForgeQAPro:["audit","saveBaseline","diff"],
    ForgeTerrain:["generate","status"],
    ForgeData:["actor","quests"],
    ForgeReplay:["startRecord","recordStep","stopRecord","play","status"],
    ForgeSession:["addPlayer","start","serialize","end","load"],
    ForgeShaders:["applyPreset"],
    ForgeAI:["status","createAgent"],
    ForgeAnimation:["status"]
  };
  for(let i=0;i<120;i++){
    let ok=true;
    for(const[k,methods] of Object.entries(required)){
      const api=window[k];
      if(!api||methods.some(m=>typeof api[m]!=="function"&&typeof api[m]!=="object")){ok=false;break}
    }
    if(ok)return true;
    await new Promise(r=>requestAnimationFrame(r));
  }
  return false;
};
await waitForPublicAPIs();
window.ForgeReady=true;
loadForgeRuntime().catch(error=>{window.ForgeRuntime.__runtimeLoadError=error?.message||String(error);write("Deferred runtime load failed: "+window.ForgeRuntime.__runtimeLoadError,"error")});
window.ForgeBootState="ready";
document.documentElement.dataset.forgeReady="1";
bootEl?.classList.add("hidden");
write("Forge Studio ready flag set");
setTimeout(()=>{
  try{
    const initialDiagnostics={
      renderer:/webgpu/i.test(engine.app?.graphicsDevice?.constructor?.name||"")?"WebGPU":"WebGL2",
      physics:engine.physics?.size||0
    };
    $("renderer").textContent=initialDiagnostics.renderer;
    $("fps").textContent=String(engine.fps||0);
    $("physics").textContent=String(initialDiagnostics.physics);
    $("sceneCount").textContent=engine.entities.size+" entities";
    $("selected").textContent=engine.selected()?.name||"None";
    $("standaloneMode").textContent=location.protocol==="file:"?"Local file":(/github\\.io$/i.test(location.hostname)?"Standalone PWA":"Server + WebSocket");
    refresh();inspect();
    requestAnimationFrame(()=>{try{stats()}catch(e){write("Deferred stats failed: "+e.message,"error")}});
    setTimeout(()=>{try{window.dispatchEvent(new Event("forge-ready"))}catch(e){write("Deferred forge-ready dispatch failed: "+e.message,"error")}},0);
  }catch(e){window.ForgeBootState="ui-error";write("Deferred boot UI failed: "+(e?.message||String(e)),"error");console.error(e)}
},0);
write("Forge Studio 3.9 ready");
