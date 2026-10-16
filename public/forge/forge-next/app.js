const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const PREFS_KEY = "forge.next.preferences.v1";
const defaults = { left:264, right:302, timeline:178, leftCollapsed:false, rightCollapsed:false };
const state = {engine:null,workspace:"layout",leftPanel:"scene",inspectorPanel:"properties",tool:"select",preview:false,timelinePlaying:false,snap:false,grid:true,assets:[],statusTimer:0,prefs:{...defaults},lastError:null};
const commands = new Map();
function registerCommand(name, execute){if(commands.has(name))throw new Error("Duplicate command: "+name);commands.set(name,execute)}
function clamp(n,min,max,fallback){const v=Number(n);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback}
function status(message,kind="ready"){
  const el=$("#saveState");if(el){el.classList.toggle("is-dirty",kind==="dirty");el.classList.toggle("is-error",kind==="error");const text=el.querySelector("span:last-child");if(text)text.textContent=message;el.title=message}
  const e=$("#engineStatus");if(e){e.textContent=message;e.classList.toggle("diagnostic-error",kind==="error");e.classList.toggle("diagnostic-warn",kind==="warn")}
}
function reportError(label,error){
  const message=error?.message||String(error);console.error("[Forge Next] "+label+": "+message,error);state.lastError=message;status(label+": "+message,"error");
  if($("#noticeTitle")&&$("#noticeBody")&&$("#noticeDialog")){ $("#noticeTitle").textContent=label;$("#noticeBody").textContent=message;if(!$("#noticeDialog").open)$("#noticeDialog").showModal() }
}
function safeRun(label,fn){try{const result=fn();if(result&&typeof result.then==="function")return result.catch(error=>reportError(label,error));return result}catch(error){reportError(label,error)}}
function notice(title,message){$("#noticeTitle").textContent=title;$("#noticeBody").textContent=message;$("#noticeDialog").showModal()}
function projectLabel(){return ($("#projectName")?.value||"Untitled Project").trim().slice(0,80)||"Untitled Project"}
function fileBaseName(value){return String(value||"forge-project").trim().replace(/[^a-z0-9_-]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,70)||"forge-project"}
function persistPrefs(){
  const root=$("#editorLayout"),css=getComputedStyle(document.documentElement);
  const prefs={...state.prefs,left:parseInt(css.getPropertyValue("--left-dock-width"),10)||defaults.left,right:parseInt(css.getPropertyValue("--right-dock-width"),10)||defaults.right,timeline:parseInt(css.getPropertyValue("--timeline-height"),10)||defaults.timeline,workspace:state.workspace,leftPanel:state.leftPanel,inspectorPanel:state.inspectorPanel,leftCollapsed:root.classList.contains("left-collapsed"),rightCollapsed:root.classList.contains("right-collapsed")};
  try{localStorage.setItem(PREFS_KEY,JSON.stringify(prefs))}catch(error){console.warn("Cannot persist Forge layout",error)}
}
function loadPrefs(){
  try{
    const saved=JSON.parse(localStorage.getItem(PREFS_KEY)||"null");
    if(saved&&typeof saved==="object"){
      state.prefs={...defaults,left:clamp(saved.left,200,420,defaults.left),right:clamp(saved.right,230,460,defaults.right),timeline:clamp(saved.timeline,130,320,defaults.timeline),leftCollapsed:saved.leftCollapsed===true,rightCollapsed:saved.rightCollapsed===true};
      document.documentElement.style.setProperty("--left-dock-width",state.prefs.left+"px");document.documentElement.style.setProperty("--right-dock-width",state.prefs.right+"px");document.documentElement.style.setProperty("--timeline-height",state.prefs.timeline+"px");
      if(saved.leftPanel==="assets")state.leftPanel="assets";if(saved.inspectorPanel==="scene")state.inspectorPanel="scene";
      if(state.prefs.leftCollapsed)$("#editorLayout").classList.add("left-collapsed");if(state.prefs.rightCollapsed)$("#editorLayout").classList.add("right-collapsed");
    }
  }catch{state.prefs={...defaults}}
}
function setWorkspace(name,{save=true}={}){
  const allowed=["layout","modeling","materials","animation","assets","world","review"];if(!allowed.includes(name))return;
  state.workspace=name;document.documentElement.dataset.forgeWorkspace=name;document.documentElement.classList.remove("timeline-manually-closed");
  $$(".workspace-tab").forEach(tab=>{const active=tab.dataset.workspace===name;tab.classList.toggle("is-active",active);tab.setAttribute("aria-selected",String(active))});
  const contexts={layout:["SCENE / LAYOUT","Orbit: drag · Pan: right-drag · Zoom: wheel"],modeling:["MODELING","Select · Move W · Rotate E · Scale R · Focus F"],materials:["MATERIALS","Surface appearance · Base color, metalness and roughness"],animation:["ANIMATION","Timeline controls are independent from scene preview"],assets:["ASSET WORKFLOW","Import and inspect 2D/3D content"],world:["WORLD SETTINGS","Grid and unit settings"],review:["REVIEW / QA","Scene diagnostics and engine status"]};
  $("#workspaceContext").textContent=contexts[name][0];$("#viewportHelp").textContent=contexts[name][1];$("#timelinePanel").hidden=name!=="animation";
  if(name==="assets")setLeftPanel("assets",{save:false});
  if(["layout","modeling","review"].includes(name))setLeftPanel("scene",{save:false});
  if(name==="materials"){setInspectorPanel("properties",{save:false});$("#materialSection").classList.add("is-open")}
  if(name==="world")setInspectorPanel("scene",{save:false});
  if(name==="animation")refreshTimeline();
  if(innerWidth<=850&&["assets","materials","world","review"].includes(name))openMobilePanel(name==="assets"?"assets":"properties");
  if(save)persistPrefs();
}
function setLeftPanel(name,{save=true}={}){
  if(!["scene","assets"].includes(name))return;state.leftPanel=name;
  $$("[data-left-tab]").forEach(t=>{const active=t.dataset.leftTab===name;t.classList.toggle("is-active",active);t.setAttribute("aria-selected",String(active))});
  $$("[data-left-panel]").forEach(p=>p.hidden=p.dataset.leftPanel!==name);if(save)persistPrefs();
}
function setInspectorPanel(name,{save=true}={}){
  if(!["properties","scene"].includes(name))return;state.inspectorPanel=name;
  $$("[data-inspector-tab]").forEach(t=>{const active=t.dataset.inspectorTab===name;t.classList.toggle("is-active",active);t.setAttribute("aria-selected",String(active))});
  $$("[data-inspector-panel]").forEach(p=>p.hidden=p.dataset.inspectorPanel!==name);if(save)persistPrefs();
}
function closeMobileDrawers(){$("#leftDock").classList.remove("is-open");$("#rightDock").classList.remove("is-open");$("#drawerScrim").hidden=true;$$(".mobile-panel-bar button").forEach(b=>b.classList.remove("is-active"))}
function openMobilePanel(name){
  closeMobileDrawers();
  if(name==="scene"||name==="assets"){setLeftPanel(name);$("#leftDock").classList.add("is-open");const b=$('[data-mobile-panel="'+name+'"]');b?.classList.add("is-active")}
  else if(name==="properties"){setInspectorPanel("properties");$("#rightDock").classList.add("is-open");$('[data-mobile-panel="properties"]')?.classList.add("is-active")}
  else if(name==="timeline"){setWorkspace("animation");$('[data-mobile-panel="timeline"]')?.classList.add("is-active")}
  $("#drawerScrim").hidden=!["scene","assets","properties"].includes(name);
}
function iconForKind(kind){return ({box:"□",sphere:"◉",cylinder:"⬡",capsule:"◌",plane:"▱",camera:"▣",light:"☼",model:"◇",mesh:"◇"})[String(kind).toLowerCase()]||"◇"}
function selectedRecord(){return state.engine?.selected?.()||null}
function refreshHierarchy(){
  const engine=state.engine;if(!engine)return;const search=($("#sceneSearch").value||"").trim().toLowerCase(),tree=$("#hierarchy");
  const items=[...engine.entities.values()].filter(r=>!search||r.name.toLowerCase().includes(search)||r.kind.toLowerCase().includes(search));
  tree.replaceChildren();const frag=document.createDocumentFragment();
  for(const record of items){
    const row=document.createElement("button");row.type="button";row.className="tree-row"+(record.id===engine.selectedId?" is-selected":"");row.dataset.entityId=record.id;row.setAttribute("role","treeitem");row.setAttribute("aria-selected",String(record.id===engine.selectedId));
    const glyph=document.createElement("span");glyph.className="tree-row-icon";glyph.textContent=iconForKind(record.kind);
    const name=document.createElement("span");name.className="tree-row-name";name.textContent=record.name;name.title=record.name;
    const type=document.createElement("span");type.className="tree-row-type";type.textContent=record.kind;
    row.append(glyph,name,type);row.addEventListener("click",()=>engine.select(record.id));frag.append(row)
  }
  tree.append(frag);$("#entityCount").textContent=engine.entities.size+(engine.entities.size===1?" object":" objects");$("#sceneFooter").textContent=engine.selected()?"Selected: "+engine.selected().name:"Scene ready";$("#emptyHierarchy").hidden=items.length!==0;$("#entityStatus").textContent=engine.entities.size+" entities";$("#viewportHint").hidden=engine.entities.size>0;refreshAssetList();
}
function refreshInspector(){
  const record=selectedRecord();$("#noSelection").hidden=!!record;$("#transformForm").hidden=!record;$("#inspectorTitle").textContent=record?.name||"Inspector";$("#inspectorType").textContent=record?String(record.kind).toUpperCase():"No selection";$("#selectedCount").textContent=record?"1 selected":"0 selected";$("#selectionStatus").textContent=record?.name||"No selection";$("#selectionHud").hidden=!record;$("#selectedNameHud").textContent=record?.name||"";
  if(!record){$("#timelineTrackName").textContent="No object selected";$("#keyCount").textContent="0 keys";return}
  const e=record.entity,p=e.getLocalPosition(),r=e.getLocalEulerAngles(),s=e.getLocalScale(),values={objectName:record.name,positionX:p.x,positionY:p.y,positionZ:p.z,rotationX:r.x,rotationY:r.y,rotationZ:r.z,scaleX:s.x,scaleY:s.y,scaleZ:s.z};
  for(const [id,value] of Object.entries(values)){const input=$("#"+id);if(input&&document.activeElement!==input)input.value=id==="objectName"?value:Number(value).toFixed(3).replace(/\.?0+$/,"")}
  const mat=record.components?.material||{},color=mat.color||[.22,.62,.9],hex="#"+color.map(v=>Math.round(clamp(v*255,0,255,0)).toString(16).padStart(2,"0")).join("").toUpperCase();
  $("#materialColor").value=hex;$("#materialHex").value=hex;$("#metalness").value=String(mat.metalness??.05);$("#roughness").value=String(mat.roughness??.5);$("#metalnessValue").textContent=Number(mat.metalness??.05).toFixed(2);$("#roughnessValue").textContent=Number(mat.roughness??.5).toFixed(2);
  $("#timelineTrackName").textContent=record.name;refreshTimeline();
}
function applyTransform(){
  const engine=state.engine,record=selectedRecord();if(!engine||!record)return;
  record.name=$("#objectName").value.trim()||record.name;record.entity.name=record.name;if(record.entity.__forge)record.entity.__forge.name=record.name;
  engine.transform({x:Number($("#positionX").value),y:Number($("#positionY").value),z:Number($("#positionZ").value),rx:Number($("#rotationX").value),ry:Number($("#rotationY").value),rz:Number($("#rotationZ").value),sx:Number($("#scaleX").value),sy:Number($("#scaleY").value),sz:Number($("#scaleZ").value});
  refreshHierarchy();refreshInspector();status("Changes applied","dirty");
}
function applyMaterial(){
  const engine=state.engine;if(!engine||!selectedRecord())return;const hex=$("#materialColor").value,color=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const params={color,metalness:Number($("#metalness").value),roughness:Number($("#roughness").value),opacity:1};
  if(engine.applyMaterial(params)){ $("#materialHex").value=hex.toUpperCase();$("#metalnessValue").textContent=params.metalness.toFixed(2);$("#roughnessValue").textContent=params.roughness.toFixed(2);status("Material updated","dirty");refreshInspector()}
}
function refreshAssetList(){
  const list=$("#assetList");if(!list||!state.engine)return;const all=[...(state.engine.assets?.entries?.()||[])].map(([name,a])=>({name,type:a.type||"asset"})),q=($("#assetSearch")?.value||"").trim().toLowerCase(),assets=all.filter(a=>a.name.toLowerCase().includes(q));
  list.replaceChildren();
  for(const asset of assets){const row=document.createElement("button");row.type="button";row.className="asset-row";const icon=document.createElement("span");icon.className="asset-row-icon";icon.textContent=iconForKind(asset.type);const copy=document.createElement("span");copy.className="asset-row-copy";const title=document.createElement("b");title.textContent=asset.name;title.title=asset.name;const type=document.createElement("small");type.textContent=String(asset.type).toUpperCase();copy.append(title,type);row.append(icon,copy);row.addEventListener("click",()=>{const record=[...state.engine.entities.values()].find(r=>r.name===asset.name||r.components?.asset?.name===asset.name);if(record)state.engine.select(record.id);else notice("Asset browser",asset.name+" is available in this session but is not represented as a scene entity.")});list.append(row)}
  $("#assetCount").textContent=assets.length+" imported";$("#assetEmpty").hidden=assets.length!==0;
}
function refreshTimeline(){
  const engine=state.engine;if(!engine)return;const frame=Math.round((engine.timelineTime||0)*24);$("#currentFrame").value=String(frame);$("#timelinePlay").setAttribute("aria-pressed",String(engine.timelinePlaying===true));$("#timelinePlay").textContent=engine.timelinePlaying?"Ⅱ":"▶";$("#timelineStatus").textContent="24 FPS · "+frame+" F";
  const record=selectedRecord(),keys=record?(engine.keyframes.get(record.id)||[]):[];$("#keyCount").textContent=keys.length+(keys.length===1?" key":" keys");const markers=$("#timelineKeyMarkers");markers.replaceChildren();
  for(const key of keys){const marker=document.createElement("span");marker.className="timeline-key-marker";marker.style.left=(clamp(key.time/10,0,1,0)*100)+"%";marker.title="Frame "+Math.round(key.time*24);markers.append(marker)}
  $("#timelinePlayhead").style.left=(clamp(engine.timelineTime/10,0,1,0)*100)+"%";
}
function refreshDiagnostics(){
  const engine=state.engine;if(!engine)return;const d=engine.diagnostics();$("#rendererStatus").textContent=d.renderer||"WebGL";$("#fpsStatus").textContent=(Number(d.fps)||0).toFixed(0)+" FPS · "+(Number(d.frameMs)||0).toFixed(1)+" ms";$("#entityStatus").textContent=d.entities+" entities";$("#unitLabel").textContent=String(d.unitSystem||"meters").toUpperCase();$("#unitSystem").value=d.unitSystem==="centimeters"?"centimeters":"meters";$("#snapEnabled").checked=engine.snapEnabled===true;$("#showGrid").checked=state.grid;$("#engineStatus").textContent=state.preview?"Scene preview active":"Engine ready";$("#diagnosticStatus").textContent=state.lastError?"1 error":"No errors";$("#diagnosticStatus").classList.toggle("diagnostic-error",!!state.lastError);if(state.timelinePlaying)refreshTimeline();
}
function refreshAll(){refreshHierarchy();refreshInspector();refreshDiagnostics()}
function changed(){refreshAll();status("Scene changed · unsaved","dirty")}
async function saveProject(){if(!window.ForgeProject)throw new Error("Project serializer did not load");window.ForgeProject.download(fileBaseName(projectLabel())+".forge.json");document.title=projectLabel()+" — Forge Next";status("Project exported")}
function openProject(){ $("#projectInput").click() }
function importAssets(){ $("#assetInput").click() }
async function loadAssets(files){
  for(const file of files){try{status("Importing "+file.name+"…");const result=await state.engine.importFile(file);state.assets.push({name:file.name,size:file.size,type:file.type});console.info("[Forge Next] Imported",file.name,result?.type||"asset")}catch(error){reportError("Import failed: "+file.name,error)}}
  changed();refreshAssetList()
}
function createObject(kind){
  const e=state.engine,n=e.entities.size+1;let record;
  if(kind==="camera")record=e.createCamera("Camera "+n,{x:6,y:4,z:8});else if(kind==="light")record=e.createLight("Light "+n);else record=e.primitive(kind,kind[0].toUpperCase()+kind.slice(1)+" "+n);
  if(record){e.select(record.id);changed();e.frame();status(record.name+" created","dirty")}
}
function toggleGrid(value=!state.grid){state.grid=!!value;window.ForgeViewport?.setGridVisible?.(state.grid);$$('[data-command="grid"]').forEach(b=>{b.classList.toggle("is-active",state.grid);b.setAttribute("aria-pressed",String(state.grid))});$("#showGrid").checked=state.grid;persistPrefs()}
function toggleSnap(value=!state.snap){state.snap=!!value;state.engine.snapEnabled=state.snap;state.engine.snapSize=Number($("#gridSize").value||.25);$("#snapEnabled").checked=state.snap;$$('[data-command="snap"]').forEach(b=>{b.classList.toggle("is-active",state.snap);b.setAttribute("aria-pressed",String(state.snap))});window.dispatchEvent(new Event("forge-gizmo-config"))}
function chooseTool(mode){
  if(!["select","translate","rotate","scale"].includes(mode))return;state.tool=mode;window.ForgeGizmo?.setMode?.(mode);
  $$("[data-tool]").forEach(b=>{const active=b.dataset.tool===mode;b.classList.toggle("is-active",active);b.setAttribute("aria-pressed",String(active))});$("#viewport").focus({preventScroll:true})
}
function chooseView(mode){
  if(!state.engine?.setView(mode))return;const viewport=window.ForgeViewport,cam=state.engine.camera(),target=state.engine.selected()?.entity.getPosition();
  if(viewport&&cam){if(target)viewport.state.target.copy(target);const p=cam.getPosition(),t=viewport.state.target,dx=p.x-t.x,dy=p.y-t.y,dz=p.z-t.z;viewport.state.distance=Math.max(.05,Math.hypot(dx,dy,dz));viewport.state.yaw=Math.atan2(dx,dz);viewport.state.pitch=Math.asin(Math.max(-1,Math.min(1,dy/viewport.state.distance)))}
  $$("[data-view]").forEach(b=>{const active=b.dataset.view===mode;b.classList.toggle("is-active",active);b.setAttribute("aria-pressed",String(active))});$("#projectionLabel").textContent=mode.toUpperCase();status(mode.charAt(0).toUpperCase()+mode.slice(1)+" view")
}
function frameSelection(){if(selectedRecord())state.engine.frame();else window.ForgeViewport?.frame?.()}
function togglePreview(force){const next=typeof force==="boolean"?force:!state.preview;state.preview=next;state.engine.running=next;const b=$("#previewScene");b.setAttribute("aria-pressed",String(next));b.querySelector(".preview-symbol").textContent=next?"■":"▷";b.querySelector("[data-preview-label]").textContent=next?"Stop":"Preview";b.title=next?"Stop scene preview":"Run or stop scene preview";status(next?"Scene preview active":"Engine ready");window.dispatchEvent(new CustomEvent("forge-play-state",{detail:{running:next}}))}
function toggleTimeline(){state.engine.timelinePlaying=!state.engine.timelinePlaying;state.timelinePlaying=state.engine.timelinePlaying;refreshTimeline()}
function setTimelineFrame(value){const frame=clamp(value,0,100000,0);state.engine.timelineTime=frame/24;state.engine.evalAnimation(state.engine.timelineTime);refreshInspector();refreshTimeline()}
function setSplitter(handle,event){
  event.preventDefault();const side=handle.dataset.splitter,key=side==="left"?"--left-dock-width":"--right-dock-width",root=document.documentElement,start=event.clientX,old=parseInt(getComputedStyle(root).getPropertyValue(key),10)||(side==="left"?defaults.left:defaults.right);
  handle.classList.add("is-dragging");handle.setPointerCapture(event.pointerId);
  const move=e=>{const w=clamp(old+(side==="left"?e.clientX-start:start-e.clientX),side==="left"?200:230,side==="left"?420:460,old);root.style.setProperty(key,w+"px")};
  const end=()=>{handle.classList.remove("is-dragging");handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",end);handle.removeEventListener("pointercancel",end);persistPrefs()};
  handle.addEventListener("pointermove",move);handle.addEventListener("pointerup",end,{once:true});handle.addEventListener("pointercancel",end,{once:true})
}
function toggleCollapsed(side){const root=$("#editorLayout"),key=side==="left"?"left-collapsed":"right-collapsed";root.classList.toggle(key);state.prefs[side+"Collapsed"]=root.classList.contains(key);persistPrefs()}
function resetLayout(){
  $("#editorLayout").classList.remove("left-collapsed","right-collapsed");document.documentElement.classList.remove("timeline-manually-closed");
  document.documentElement.style.setProperty("--left-dock-width",defaults.left+"px");document.documentElement.style.setProperty("--right-dock-width",defaults.right+"px");document.documentElement.style.setProperty("--timeline-height",defaults.timeline+"px");state.prefs={...defaults};closeMobileDrawers();persistPrefs();status("Editor layout reset")
}
function fullscreenViewport(){const target=$("#viewportStage");if(document.fullscreenElement){document.exitFullscreen?.();return}if(!target.requestFullscreen){notice("Viewport","Fullscreen is not supported by this browser.");return}target.requestFullscreen().catch(e=>notice("Viewport",e.message||"Could not enter fullscreen."))}
function sceneSummary(){const d=state.engine.diagnostics();notice("Scene summary",d.entities+" entities · "+d.renderables+" renderables · "+d.physics+" physics bodies · "+d.tracks+" animation tracks · "+d.renderer+".")}
function registerCommands(){
  registerCommand("new",()=>{if(confirm("Start a new scene? Unsaved changes are not kept automatically.")){state.engine.resetScene(true);const cube=state.engine.primitive("box","Cube");state.engine.select(cube.id);changed();window.ForgeViewport?.frame?.();status("New scene created","dirty")}});
  registerCommand("open",openProject);registerCommand("save",saveProject);registerCommand("import",importAssets);registerCommand("preview",()=>togglePreview());registerCommand("reset-layout",resetLayout);
  registerCommand("collapse-left",()=>toggleCollapsed("left"));registerCommand("collapse-right",()=>toggleCollapsed("right"));registerCommand("scene-menu",sceneSummary);registerCommand("inspector-menu",()=>{refreshInspector();status("Inspector refreshed")});
  registerCommand("grid",()=>toggleGrid());registerCommand("snap",()=>toggleSnap());registerCommand("frame-selected",frameSelection);registerCommand("frame-all",()=>{state.engine.frame();status("Framed scene")});registerCommand("fullscreen",fullscreenViewport);
  registerCommand("duplicate",()=>{if(state.engine.duplicate())changed()});registerCommand("delete",()=>{const r=selectedRecord();if(r&&confirm("Delete "+r.name+"?")){state.engine.delete();changed()}});
  registerCommand("timeline-play",toggleTimeline);registerCommand("timeline-start",()=>setTimelineFrame(0));registerCommand("timeline-end",()=>setTimelineFrame(240));registerCommand("keyframe",()=>{state.engine.key();refreshTimeline();status("Keyframe inserted","dirty")});registerCommand("close-timeline",()=>{document.documentElement.classList.add("timeline-manually-closed");status("Timeline hidden")});registerCommand("close-notice",()=>$("#noticeDialog").close());
}
function bindUI(){
  registerCommands();
  $$("[data-command]").forEach(b=>b.addEventListener("click",()=>safeRun(b.dataset.command,()=>commands.get(b.dataset.command)?.())));
  $$("[data-create]").forEach(b=>b.addEventListener("click",()=>safeRun("Create "+b.dataset.create,()=>createObject(b.dataset.create))));
  $$("[data-workspace]").forEach(b=>b.addEventListener("click",()=>setWorkspace(b.dataset.workspace)));
  $$("[data-left-tab]").forEach(b=>b.addEventListener("click",()=>setLeftPanel(b.dataset.leftTab)));
  $$("[data-inspector-tab]").forEach(b=>b.addEventListener("click",()=>setInspectorPanel(b.dataset.inspectorTab)));
  $$("[data-tool]").forEach(b=>b.addEventListener("click",()=>chooseTool(b.dataset.tool)));
  $$("[data-view]").forEach(b=>b.addEventListener("click",()=>chooseView(b.dataset.view)));
  $$("[data-mobile-panel]").forEach(b=>b.addEventListener("click",()=>openMobilePanel(b.dataset.mobilePanel)));
  $("#drawerScrim").addEventListener("click",closeMobileDrawers);
  $("#sceneSearch").addEventListener("input",refreshHierarchy);$("#assetSearch").addEventListener("input",refreshAssetList);
  $("#assetInput").addEventListener("change",e=>{const files=[...e.target.files];if(files.length)void loadAssets(files);e.target.value=""});
  $("#projectInput").addEventListener("change",async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;try{const data=JSON.parse(await file.text());await window.ForgeProject.load(data);$("#projectName").value=data.meta?.name||file.name.replace(/\.forge\.json$|\.json$/i,"");refreshAll();status("Project loaded")}catch(error){reportError("Project could not be opened",error)}});
  $("#viewportStage").addEventListener("dragover",e=>{e.preventDefault();$("#viewportStage").classList.add("is-dragover")});
  $("#viewportStage").addEventListener("dragleave",e=>{if(!$("#viewportStage").contains(e.relatedTarget))$("#viewportStage").classList.remove("is-dragover")});
  $("#viewportStage").addEventListener("drop",e=>{e.preventDefault();$("#viewportStage").classList.remove("is-dragover");if(e.dataTransfer?.files?.length)void loadAssets([...e.dataTransfer.files])});
  $("#transformForm").addEventListener("change",e=>{if(e.target.matches("#objectName,#positionX,#positionY,#positionZ,#rotationX,#rotationY,#rotationZ,#scaleX,#scaleY,#scaleZ"))safeRun("Apply transform",applyTransform);if(e.target.matches("#materialColor,#metalness,#roughness"))safeRun("Apply material",applyMaterial)});
  $("#materialColor").addEventListener("input",()=>$("#materialHex").value=$("#materialColor").value.toUpperCase());$("#metalness").addEventListener("input",()=>$("#metalnessValue").textContent=Number($("#metalness").value).toFixed(2));$("#roughness").addEventListener("input",()=>$("#roughnessValue").textContent=Number($("#roughness").value).toFixed(2));
  $("#currentFrame").addEventListener("change",e=>setTimelineFrame(e.target.value));$("#unitSystem").addEventListener("change",e=>{state.engine.unitSystem=e.target.value;refreshDiagnostics();persistPrefs()});$("#gridSize").addEventListener("change",e=>{state.engine.snapSize=Number(e.target.value)||.25;persistPrefs()});$("#showGrid").addEventListener("change",e=>toggleGrid(e.target.checked));$("#snapEnabled").addEventListener("change",e=>toggleSnap(e.target.checked));
  $$(".property-section-heading").forEach(b=>b.addEventListener("click",()=>{const section=b.closest(".property-section");section.classList.toggle("is-open");b.setAttribute("aria-expanded",String(section.classList.contains("is-open")))}));
  $$("[data-splitter]").forEach(handle=>{handle.addEventListener("pointerdown",e=>setSplitter(handle,e));handle.addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight"].includes(e.key))return;e.preventDefault();const side=handle.dataset.splitter,property=side==="left"?"--left-dock-width":"--right-dock-width",root=document.documentElement,old=parseInt(getComputedStyle(root).getPropertyValue(property),10)||260;root.style.setProperty(property,clamp(old+(e.key==="ArrowRight"?10:-10)*(side==="left"?1:-1),side==="left"?200:230,side==="left"?420:460,old)+"px");persistPrefs()})});
  $("#projectName").addEventListener("change",()=>{document.title=projectLabel()+" — Forge Next";status("Project name updated","dirty")});
  document.addEventListener("keydown",e=>{
    const t=e.target,editing=t instanceof HTMLElement&&(t.isContentEditable||["INPUT","TEXTAREA","SELECT"].includes(t.tagName)),mod=e.ctrlKey||e.metaKey;
    if(mod&&e.key.toLowerCase()==="s"){e.preventDefault();safeRun("Save project",saveProject);return}
    if(mod&&e.key.toLowerCase()==="o"){e.preventDefault();safeRun("Open project",openProject);return}
    if(editing)return;
    if(mod&&e.key.toLowerCase()==="z"){e.preventDefault();safeRun("Undo",()=>{const ok=e.shiftKey?state.engine.redo():state.engine.undo();if(ok)refreshAll()});return}
    if(mod&&e.key.toLowerCase()==="y"){e.preventDefault();safeRun("Redo",()=>{if(state.engine.redo())refreshAll()});return}
    const shortcuts={q:"select",w:"translate",e:"rotate",r:"scale"};if(shortcuts[e.key.toLowerCase()]){chooseTool(shortcuts[e.key.toLowerCase()]);return}
    if(e.key.toLowerCase()==="f"){frameSelection();return}
    if(e.key==="Escape"){closeMobileDrawers();if(state.preview)togglePreview(false)}
    if(e.key==="Delete"||e.key==="Backspace"){if(selectedRecord())safeRun("Delete",()=>commands.get("delete")())}
  });
  window.addEventListener("forge-selection",()=>{refreshHierarchy();refreshInspector()});window.addEventListener("forge-assets-changed",()=>{refreshHierarchy();refreshAssetList();refreshInspector()});window.addEventListener("resize",()=>state.engine?.app?.resizeCanvas?.());
  const ro=new ResizeObserver(()=>requestAnimationFrame(()=>state.engine?.app?.resizeCanvas?.()));ro.observe($("#viewportStage"));
}
function bootFailed(error){state.lastError=error?.message||String(error);$("#bootMessage").textContent="Startup failed: "+state.lastError;$("#bootScreen").querySelector(".boot-meter").hidden=true;console.error("[Forge Next] Startup failed",error)}
async function boot(){
  loadPrefs();status("Loading engine…");
  const {ForgeEngine}=await import("../forge-engine.js");
  const engine=new ForgeEngine($("#viewport"),message=>console.info("[Forge Engine]",message));state.engine=engine;await engine.init();window.Forge=engine;
  status("Installing viewport…");await import("../forge-viewport.js");
  try{await import("../forge-spatial.js")}catch(error){console.warn("Spatial overlay unavailable",error)}
  try{await import("../forge-gizmo.js")}catch(error){console.warn("Transform gizmo adapter unavailable",error)}
  await import("../forge-project.js");
  try{await import("../forge-export.js")}catch(error){console.warn("Asset export adapter unavailable",error)}
  window.ForgeReady=true;window.ForgeBootState="ready";window.dispatchEvent(new Event("forge-ready"));bindUI();
  const cube=engine.primitive("box","Cube");engine.select(cube.id);engine.frame();try{await window.ForgeGizmo?.init?.()}catch(error){console.warn("Native gizmo did not attach",error)}
  toggleGrid(true);chooseTool("select");chooseView("perspective");setWorkspace("layout",{save:false});setLeftPanel(state.leftPanel,{save:false});setInspectorPanel(state.inspectorPanel,{save:false});refreshAll();
  $("#bootMessage").textContent="Ready";$("#bootScreen").hidden=true;$("#forgeApp").classList.remove("is-booting");$("#forgeApp").classList.add("is-ready");status("Forge Next ready");state.statusTimer=window.setInterval(refreshDiagnostics,500);
}
boot().catch(bootFailed);
