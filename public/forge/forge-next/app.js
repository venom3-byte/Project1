const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const PREFS_KEY = "forge.next.preferences.v1";
const defaults = { left:264, right:302, timeline:178, leftCollapsed:false, rightCollapsed:false };
const state = {engine:null,workspace:"layout",leftPanel:"scene",inspectorPanel:"properties",tool:"select",preview:false,timelinePlaying:false,timelineView:"dopesheet",graphChannel:"p0",autoKey:false,snap:false,grid:true,assets:[],trace:null,statusTimer:0,prefs:{...defaults},lastError:null};
const commands = new Map();
function registerCommand(name, execute){if(commands.has(name))throw new Error("Duplicate command: "+name);commands.set(name,execute)}
function clamp(n,min,max,fallback){const v=Number(n);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback}
function status(message,kind="ready"){
  if(kind!=="error")state.lastError=null;
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
  const allowed=["layout","modeling","references","materials","animation","assets","world","review"];if(!allowed.includes(name))return;
  state.workspace=name;document.documentElement.dataset.forgeWorkspace=name;document.documentElement.classList.remove("timeline-manually-closed");
  $$(".workspace-tab").forEach(tab=>{const active=tab.dataset.workspace===name;tab.classList.toggle("is-active",active);tab.setAttribute("aria-selected",String(active))});
  const contexts={layout:["SCENE / LAYOUT","Orbit: drag · Pan: right-drag · Zoom: wheel"],modeling:["MODELING","Select · Move W · Rotate E · Scale R · Focus F"],references:["IMAGE MODELING","Calibrate front, side and top reference planes before tracing geometry"],materials:["MATERIALS","Surface appearance · Base color, metalness and roughness"],animation:["ANIMATION","Keyframes store transforms; interpolation fills motion between them"],assets:["ASSET WORKFLOW","Import and inspect 2D/3D content"],world:["WORLD SETTINGS","Grid and unit settings"],review:["REVIEW / QA","Scene diagnostics and engine status"]};
  $("#workspaceContext").textContent=contexts[name][0];$("#viewportHelp").textContent=contexts[name][1];$("#timelinePanel").hidden=name!=="animation";
  if(name==="assets")setLeftPanel("assets",{save:false});
  if(["layout","modeling","references","review"].includes(name))setLeftPanel("scene",{save:false});
  if(name==="references")setInspectorPanel("references",{save:false});
  if(name==="modeling")setInspectorPanel("properties",{save:false});
  if(name==="materials"){setInspectorPanel("properties",{save:false});$("#materialSection").classList.add("is-open")}
  if(name==="world")setInspectorPanel("scene",{save:false});
  if(name==="animation")refreshTimeline();
  if(innerWidth<=850&&["assets","materials","world","review","references"].includes(name))openMobilePanel(name==="assets"?"assets":name==="references"?"references":"properties");
  if(save)persistPrefs();
}
function setLeftPanel(name,{save=true}={}){
  if(!["scene","assets"].includes(name))return;state.leftPanel=name;
  $$("[data-left-tab]").forEach(t=>{const active=t.dataset.leftTab===name;t.classList.toggle("is-active",active);t.setAttribute("aria-selected",String(active))});
  $$("[data-left-panel]").forEach(p=>p.hidden=p.dataset.leftPanel!==name);if(save)persistPrefs();
}
function setInspectorPanel(name,{save=true}={}){
  if(!["properties","scene","references"].includes(name))return;state.inspectorPanel=name;
  $$("[data-inspector-tab]").forEach(t=>{const active=t.dataset.inspectorTab===name;t.classList.toggle("is-active",active);t.setAttribute("aria-selected",String(active))});
  $$("[data-inspector-panel]").forEach(p=>p.hidden=p.dataset.inspectorPanel!==name);if(save)persistPrefs();
}
function closeMobileDrawers(){$("#leftDock").classList.remove("is-open");$("#rightDock").classList.remove("is-open");$("#drawerScrim").hidden=true;$$(".mobile-panel-bar button").forEach(b=>b.classList.remove("is-active"))}
function openMobilePanel(name){
  closeMobileDrawers();
  if(name==="scene"||name==="assets"){setLeftPanel(name);$("#leftDock").classList.add("is-open");const b=$('[data-mobile-panel="'+name+'"]');b?.classList.add("is-active")}
  else if(name==="properties"||name==="references"){setInspectorPanel(name==="references"?"references":"properties");$("#rightDock").classList.add("is-open");$('[data-mobile-panel="'+name+'"]')?.classList.add("is-active")}
  else if(name==="timeline"){setWorkspace("animation");$('[data-mobile-panel="timeline"]')?.classList.add("is-active")}
  $("#drawerScrim").hidden=!["scene","assets","properties","references"].includes(name);
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
  engine.transform({x:Number($("#positionX").value),y:Number($("#positionY").value),z:Number($("#positionZ").value),rx:Number($("#rotationX").value),ry:Number($("#rotationY").value),rz:Number($("#rotationZ").value),sx:Number($("#scaleX").value),sy:Number($("#scaleY").value),sz:Number($("#scaleZ").value)});
  refreshHierarchy();refreshInspector();refreshTimeline();status(state.autoKey?"Transform changed · auto-key recorded":"Changes applied","dirty");
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
  const engine=state.engine;if(!engine)return;
  const frame=Math.round((engine.timelineTime||0)*24);
  $("#currentFrame").value=String(frame);
  $("#timelinePlay").setAttribute("aria-pressed",String(engine.timelinePlaying===true));
  $("#timelinePlay").textContent=engine.timelinePlaying?"Ⅱ":"▶";
  $("#timelineStatus").textContent="24 FPS · "+frame+" F";
  state.timelinePlaying=engine.timelinePlaying===true;
  $("#autoKeyButton").setAttribute("aria-pressed",String(state.autoKey));
  $("#autoKeyButton").classList.toggle("is-active",state.autoKey);
  $("#timelineLoop").setAttribute("aria-pressed",String(engine.timelineLoop!==false));
  $("#timelineLoop").classList.toggle("is-active",engine.timelineLoop!==false);
  $("#keyInterpolation").value=engine.keyInterpolation||"ease";
  const record=selectedRecord(),keys=record?(engine.keyframes.get(record.id)||[]):[];
  $("#keyCount").textContent=keys.length+(keys.length===1?" key":" keys");
  $("#timelineTrackName").textContent=record?.name||"No object selected";
  const renderLane=(selector,channel)=>{
    const lane=$(selector);if(!lane)return;lane.replaceChildren();
    keys.forEach((key,index)=>{
      const marker=document.createElement("button");marker.type="button";marker.className="timeline-key-marker marker-"+channel;
      marker.dataset.keyIndex=String(index);marker.style.left=(clamp(key.time/10,0,1,0)*100)+"%";
      const keyFrame=Math.round(key.time*24);marker.title=channel+" · frame "+keyFrame;marker.setAttribute("aria-label",channel+" key at frame "+keyFrame);
      marker.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();setTimelineFrame(Math.round(key.time*24))});
      marker.addEventListener("pointerdown",event=>{
        if(event.button!==0)return;
        event.preventDefault();event.stopPropagation();
        const track=$("#timelineTrack"),rect=track.getBoundingClientRect(),keyRef=key;let dragged=false;
        const move=moveEvent=>{
          const frameNow=Math.round(clamp((moveEvent.clientX-rect.left)/Math.max(1,rect.width),0,1,0)*240);
          keyRef.time=frameNow/24;dragged=true;
          const left=(frameNow/240*100)+"%";$$(".timeline-key-marker[data-key-index='"+index+"']").forEach(item=>item.style.left=left);
          $("#currentFrame").value=String(frameNow);$("#timelinePlayhead").style.left=left;
        };
        const finish=()=>{
          document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",finish);document.removeEventListener("pointercancel",finish);
          if(dragged){keys.sort((a,b)=>a.time-b.time);setTimelineFrame(Math.round(keyRef.time*24));refreshTimeline();status("Keyframe moved","dirty")}
        };
        document.addEventListener("pointermove",move);document.addEventListener("pointerup",finish,{once:true});document.addEventListener("pointercancel",finish,{once:true});
      });
      lane.append(marker);
    });
  };
  renderLane("#timelineKeyMarkers","location");renderLane("#timelineRotationMarkers","rotation");renderLane("#timelineScaleMarkers","scale");
  $("#timelinePlayhead").style.left=(clamp(engine.timelineTime/10,0,1,0)*100)+"%";
  $("#timelineRuler").hidden=state.timelineView==="graph";
  $("#timelineDopeSheet").hidden=state.timelineView!=="dopesheet";
  $("#graphEditorPane").hidden=state.timelineView!=="graph";
  $$("[data-timeline-view]").forEach(button=>{const active=button.dataset.timelineView===state.timelineView;button.classList.toggle("is-active",active);button.setAttribute("aria-selected",String(active))});
  $("#graphChannel").value=state.graphChannel;
  $("#graphChannelSummary").textContent=graphChannelLabel(state.graphChannel);
  $("#timelineStatusHint").textContent=state.timelineView==="graph"?"Graph Editor · drag a key vertically to edit its value":"Dope Sheet · key = transform at a frame; interpolation creates motion between keys";
  if(state.timelineView==="graph")drawGraphEditor();
}
function graphChannelLabel(channel){
  const labels={p0:"Location X",p1:"Location Y",p2:"Location Z",r0:"Rotation X",r1:"Rotation Y",r2:"Rotation Z",s0:"Scale X",s1:"Scale Y",s2:"Scale Z"};
  return labels[channel]||"Location X";
}
function graphValues(keys,channel){
  const group=channel[0],axis=Number(channel[1]);
  return keys.map(key=>({time:Number(key.time)||0,value:Number((key[group]||[0,0,0])[axis])||0,key}));
}
function graphCurveValue(a,b,t){
  const duration=Math.max(0.0001,b.time-a.time);let f=clamp((t-a.time)/duration,0,1,0);
  const mode=a.key.interpolation||"linear";
  if(mode==="constant")f=0;else if(mode==="ease")f=f*f*(3-2*f);
  return a.value+(b.value-a.value)*f;
}
function drawGraphEditor(){
  const canvas=$("#graphEditorCanvas");if(!canvas||state.timelineView!=="graph")return;
  const box=canvas.getBoundingClientRect();if(box.width<1||box.height<1)return;
  const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1)),w=box.width,h=box.height;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
  const ctx=canvas.getContext("2d");if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  ctx.fillStyle="#0b1219";ctx.fillRect(0,0,w,h);
  const pad={left:42,right:14,top:12,bottom:22},plotW=Math.max(20,w-pad.left-pad.right),plotH=Math.max(30,h-pad.top-pad.bottom),timeMax=10;
  const record=selectedRecord(),keys=record?(state.engine.keyframes.get(record.id)||[]):[],values=graphValues(keys,state.graphChannel);
  const finite=values.map(v=>v.value).filter(Number.isFinite);let min=finite.length?Math.min(...finite):-1,max=finite.length?Math.max(...finite):1;
  let span=max-min;if(span<1e-4){span=Math.max(Math.abs(max)*.2,.5);min-=span;max+=span}else{min-=span*.16;max+=span*.16}
  const xFor=t=>pad.left+clamp(t/timeMax,0,1,0)*plotW,yFor=v=>pad.top+(1-clamp((v-min)/(max-min),0,1,.5))*plotH;
  ctx.font="9px ui-monospace, monospace";ctx.textBaseline="middle";
  for(let i=0;i<=10;i++){
    const x=pad.left+plotW*i/10;ctx.strokeStyle=i===0?"#405363":"#253440";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,pad.top);ctx.lineTo(x,pad.top+plotH);ctx.stroke();
    ctx.fillStyle="#7f96a7";ctx.textAlign="center";ctx.fillText(String(i*24),x,h-10);
  }
  for(let i=0;i<=4;i++){
    const y=pad.top+plotH*i/4,value=max-(max-min)*i/4;ctx.strokeStyle="#253440";ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(pad.left+plotW,y);ctx.stroke();
    ctx.fillStyle="#8498a7";ctx.textAlign="right";ctx.fillText(Math.abs(value)>=100?value.toFixed(0):value.toFixed(2),pad.left-6,y);
  }
  ctx.save();ctx.beginPath();ctx.rect(pad.left,pad.top,plotW,plotH);ctx.clip();
  if(values.length){
    ctx.strokeStyle="#72c6ee";ctx.lineWidth=2;ctx.beginPath();
    if(values.length===1){const point=values[0];ctx.moveTo(xFor(point.time),yFor(point.value));ctx.lineTo(xFor(point.time)+.1,yFor(point.value))}
    else{
      ctx.moveTo(xFor(values[0].time),yFor(values[0].value));
      for(let i=0;i<values.length-1;i++){const a=values[i],b=values[i+1];for(let j=1;j<=16;j++){const t=a.time+(b.time-a.time)*j/16;ctx.lineTo(xFor(t),yFor(graphCurveValue(a,b,t)))}}
    }
    ctx.stroke();
    values.forEach(point=>{const x=xFor(point.time),y=yFor(point.value);ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.fillStyle="#a7dff8";ctx.strokeStyle="#1a4258";ctx.lineWidth=1.4;ctx.fillRect(-4,-4,8,8);ctx.strokeRect(-4,-4,8,8);ctx.restore()});
  }
  const playX=xFor(state.engine.timelineTime||0);ctx.strokeStyle="#e59a67";ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(playX,pad.top);ctx.lineTo(playX,pad.top+plotH);ctx.stroke();
  ctx.restore();
  if(!values.length){ctx.fillStyle="#8095a5";ctx.font="11px system-ui, sans-serif";ctx.textAlign="center";ctx.fillText("Insert a keyframe to see the animation curve",pad.left+plotW/2,pad.top+plotH/2)}
  canvas.__graphMetrics={pad,plotW,plotH,min,max,timeMax,w,h,xFor,yFor};
}
function setGraphView(name){
  state.timelineView=name==="graph"?"graph":"dopesheet";refreshTimeline();
}
function graphPointerDown(event){
  const canvas=$("#graphEditorCanvas"),metrics=canvas.__graphMetrics;if(!metrics)return;
  const rect=canvas.getBoundingClientRect(),point=[(event.clientX-rect.left),event.clientY-rect.top],record=selectedRecord(),keys=record?(state.engine.keyframes.get(record.id)||[]):[],values=graphValues(keys,state.graphChannel);
  let nearest=null,distance=14;
  for(const v of values){const d=Math.hypot(metrics.xFor(v.time)-point[0],metrics.yFor(v.value)-point[1]);if(d<distance){distance=d;nearest=v}}
  if(nearest){
    event.preventDefault();event.stopPropagation();const selected=nearest;
    const move=e=>{
      const y=e.clientY-rect.top,ratio=clamp(1-(y-metrics.pad.top)/metrics.plotH,0,1,.5),value=metrics.min+ratio*(metrics.max-metrics.min),group=state.graphChannel[0],axis=Number(state.graphChannel[1]);
      selected.key[group][axis]=value;
      state.engine.evalAnimation(state.engine.timelineTime);
      refreshInspector();drawGraphEditor();
    };
    const end=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",end);document.removeEventListener("pointercancel",end);refreshTimeline();status(graphChannelLabel(state.graphChannel)+" key edited","dirty")};
    document.addEventListener("pointermove",move);document.addEventListener("pointerup",end,{once:true});document.addEventListener("pointercancel",end,{once:true});return;
  }
  setTimelineFrame(Math.round(clamp((point[0]-metrics.pad.left)/metrics.plotW,0,1,0)*240));
}
function toggleAutoKey(){state.autoKey=!state.autoKey;state.engine.autoKey=state.autoKey;state.engine.keyInterpolation=$("#keyInterpolation").value;refreshTimeline();status(state.autoKey?"Auto-key enabled for transforms":"Auto-key disabled")}
function configureTraceDialog(mode){
  const lathe=mode==="lathe-profile";
  $("#traceDialogTitle").textContent=lathe?"Trace lathe / spin profile":"Trace image silhouette";
  $("#traceModeLabel").textContent=lathe?"PROFILE · REVOLVE 360°":"OUTLINE · CLOSE · EXTRUDE";
  $("#traceInstructions").textContent=lathe
    ?"Trace a closed half-section: start at the outer bottom edge, follow the exterior up to the rim, trace inward and down the inner wall, then end at the inner bottom edge. The Spin operation connects the final point back to the start to form the bottle base."
    :"Tap around the outside edge of the object. Use at least three points; tracing should not cross itself. The 3D blockout uses the reference width and height set in the Images panel.";
  $("#traceDepthField").hidden=lathe;
  $("#traceBuild").hidden=lathe;
  $("#traceBuildLathe").hidden=!lathe;
  $("#traceSaveOutline").textContent=lathe?"Save profile":"Save outline";
  $("#traceCanvas").setAttribute("aria-label",lathe?"Trace a revolved bottle cross-section":"Trace the image silhouette");
}
async function startLatheProfileTrace(){
  const record=selectedRecord(),meta=record?.components?.reference,assetName=record?.components?.asset?.name,entry=assetName?state.engine.assets.get(assetName):null;
  if(!meta||!entry?.file){notice("Spin / Lathe Profile","Select a reference image imported in this session. Crop it tightly and align the centerline with the image middle. Re-import it if the project was reopened without its source file.");return}
  try{
    const bitmap=await createImageBitmap(entry.file),scale=Math.min(1000/bitmap.width,800/bitmap.height),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=$("#traceCanvas");canvas.width=width;canvas.height=height;
    const profile=Array.isArray(meta.latheProfile)?meta.latheProfile.map(point=>[...point]):[];
    state.trace={record,bitmap,points:profile,closed:false,editing:profile.length>=3,mode:"lathe-profile",axis:meta.axis||"front",width:Number(meta.width)||3,height:Number(meta.height)||((Number(meta.width)||3)/(Number(meta.aspect)||1))};
    configureTraceDialog("lathe-profile");
    $("#traceMessage").textContent=profile.length?"Loaded the saved "+profile.length+"-point profile. Drag points to refine it or add points on an edge.":"Start on the centerline at the bottom, trace the exterior to the rim, then trace the inside wall back toward the bottom centerline.";
    $("#traceDialog").showModal();traceDraw();
  }catch(error){reportError("Could not open lathe profile tracing",error)}
}
function applyReferenceMaterial(record,opacity){
  const pc=window.ForgePC,blend=pc?.BLEND_NORMAL??2,none=pc?.BLEND_NONE??0;
  const walk=entity=>{for(const instance of(entity.render?.meshInstances||[])){
    const material=instance.material?.clone?.();if(!material)continue;
    material.opacity=opacity;material.blendType=opacity<0.999?blend:none;material.depthWrite=opacity>=0.999;material.cull=pc?.CULLFACE_NONE??0;material.update();instance.material=material;
  }for(const child of entity.children||[])walk(child)};
  walk(record.entity);
}
function applyReferenceSetup(record=selectedRecord()){
  if(!record?.components?.reference){notice("Image Modeling","Select a reference image plane first, then set its view, width and opacity.");return false}
  const data=record.components.reference,axis=$("#referenceAxis").value,width=clamp($("#referenceWidth").value,0.01,10000,Number(data.width)||3);
  const opacity=clamp($("#referenceOpacity").value,0.1,1,Number(data.opacity)||0.45),aspect=clamp(data.aspect,0.001,1000,1),height=width/aspect,entity=record.entity;
  if(axis==="front"){entity.setLocalEulerAngles(90,0,0);entity.setLocalPosition(0,height/2,0.05)}
  else if(axis==="side"){entity.setLocalEulerAngles(90,90,0);entity.setLocalPosition(0.05,height/2,0)}
  else{entity.setLocalEulerAngles(0,0,0);entity.setLocalPosition(0,0.03,0)}
  entity.setLocalScale(width,1,height);Object.assign(data,{axis,width,height,opacity,visible:entity.enabled!==false,locked:false});
  applyReferenceMaterial(record,opacity);refreshReferences();refreshHierarchy();refreshInspector();status("Reference calibrated · "+axis+" view · "+width.toFixed(2)+" m","dirty");return true;
}
function refreshReferences(){
  const list=$("#referenceList");if(!list||!state.engine)return;const all=[...state.engine.entities.values()].filter(record=>record.components?.reference);
  $("#referenceCount").textContent=String(all.length);list.replaceChildren();
  for(const record of all){
    const meta=record.components.reference,row=document.createElement("div");row.className="reference-row";
    const select=document.createElement("button");select.type="button";select.className="reference-row-main"+(record.id===state.engine.selectedId?" is-selected":"");
    const name=document.createElement("b");name.textContent=record.name;name.title=record.name;const outlineInfo=Array.isArray(meta.outline)&&meta.outline.length>=3?(" · "+meta.outline.length+" pts"):"";const profileInfo=Array.isArray(meta.latheProfile)&&meta.latheProfile.length>=3?(" · spin "+meta.latheProfile.length+" pts"):"";const details=document.createElement("small");details.textContent=String(meta.axis||"front").toUpperCase()+" · "+Number(meta.width||0).toFixed(2)+" m"+(outlineInfo||profileInfo||" · no outline");
    select.append(name,details);select.addEventListener("click",()=>{state.engine.select(record.id);$("#referenceAxis").value=meta.axis||"front";$("#referenceWidth").value=String(meta.width||3);$("#referenceOpacity").value=String(meta.opacity??0.45);$("#referenceOpacityValue").textContent=Math.round((meta.opacity??0.45)*100)+"%";chooseView(meta.axis==="side"?"right":meta.axis||"front")});row.append(select);
    const visibility=document.createElement("button");visibility.type="button";visibility.className="reference-visibility";visibility.textContent=record.entity.enabled===false?"Show":"Hide";
    visibility.addEventListener("click",()=>{record.entity.enabled=record.entity.enabled===false;meta.visible=record.entity.enabled;refreshReferences();status(record.entity.enabled?"Reference shown":"Reference hidden","dirty")});row.append(visibility);list.append(row);
  }
  const chosen=selectedRecord();if(chosen?.components?.reference){const d=chosen.components.reference;$("#referenceAxis").value=d.axis||"front";$("#referenceWidth").value=String(d.width||3);$("#referenceOpacity").value=String(d.opacity??0.45);$("#referenceOpacityValue").textContent=Math.round((d.opacity??0.45)*100)+"%"}
}
function focusReferenceView(){const ref=selectedRecord()?.components?.reference;if(!ref){notice("Image Modeling","Select a calibrated reference plane first.");return}chooseView(ref.axis==="side"?"right":ref.axis||"front");state.engine.frame();status("Reference aligned in "+ref.axis+" view")}
async function referenceImageDataUrl(file,maxSide=1536){
  const bitmap=await createImageBitmap(file),scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext("2d");if(!ctx){bitmap.close?.();throw new Error("Could not allocate reference-image canvas")}
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  const webp=canvas.toDataURL("image/webp",0.86);
  return webp.startsWith("data:image/webp")?webp:canvas.toDataURL("image/png");
}
async function loadReferenceImages(files){
  let added=0;const axis=$("#referenceAxis").value,width=clamp($("#referenceWidth").value,0.01,10000,3),opacity=clamp($("#referenceOpacity").value,0.1,1,0.45);
  for(const file of files){
    if(!file.type.startsWith("image/")){reportError("Reference import rejected",new Error(file.name+" is not an image"));continue}
    try{
      status("Calibrating reference "+file.name+"…");const result=await state.engine.importFile(file),record=result?.record;
      if(!record||result.type!=="image")throw new Error("Image importer did not create a reference plane.");
      const asset=record.components.asset||{},aspect=Number(asset.width)>0&&Number(asset.height)>0?Number(asset.width)/Number(asset.height):1;
      const imageDataUrl=await referenceImageDataUrl(file);
      record.components.reference={name:file.name,axis,width,height:width/aspect,aspect,opacity,visible:true,locked:false,imageDataUrl};
      applyReferenceSetup(record);state.engine.select(record.id);added++;
    }catch(error){reportError("Reference import failed: "+file.name,error)}
  }
  refreshReferences();refreshAll();if(added)status(added+" calibrated reference image"+(added===1?"":"s")+" added","dirty");
}

function traceDraw(){
  const trace=state.trace,canvas=$("#traceCanvas");if(!trace||!canvas)return;
  const ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#0b1118";ctx.fillRect(0,0,w,h);ctx.drawImage(trace.bitmap,0,0,w,h);
  if(trace.mode==="lathe-profile"){
    ctx.save();ctx.setLineDash([Math.max(3,w*.008),Math.max(2,w*.004)]);ctx.strokeStyle="rgba(80,210,255,.9)";ctx.lineWidth=Math.max(1.5,w*.003);
    ctx.beginPath();ctx.moveTo(w*.5,0);ctx.lineTo(w*.5,h);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle="#72d9ff";ctx.font="bold "+Math.max(9,Math.min(12,w*.025))+"px ui-monospace, monospace";ctx.textAlign="left";ctx.textBaseline="top";ctx.fillText("ROTATION AXIS · Y",w*.5+5,5);ctx.restore();
  }
  if(trace.points.length){
    ctx.save();ctx.lineWidth=Math.max(2,Math.min(w,h)*.0035);ctx.strokeStyle="#54d6ff";ctx.fillStyle="#b0efff";ctx.lineJoin="round";ctx.lineCap="round";
    ctx.beginPath();trace.points.forEach((p,i)=>{const x=p[0]*w,y=p[1]*h;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});
    if(trace.closed||(trace.mode!=="lathe-profile"&&trace.points.length>2))ctx.lineTo(trace.points[0][0]*w,trace.points[0][1]*h);ctx.stroke();
    const r=Math.max(3,Math.min(w,h)*.006);
    trace.points.forEach((p,i)=>{ctx.beginPath();ctx.arc(p[0]*w,p[1]*h,r,0,Math.PI*2);ctx.fillStyle=i===0?"#fff":"#79dcff";ctx.fill();ctx.strokeStyle="#092331";ctx.lineWidth=1.5;ctx.stroke()});
    ctx.restore();
  }
  $("#tracePointCount").textContent=trace.points.length+" points"+(trace.closed?" · closed":"");
}
async function startSilhouetteTrace(){
  const record=selectedRecord(),meta=record?.components?.reference,assetName=record?.components?.asset?.name,entry=assetName?state.engine.assets.get(assetName):null;
  if(!meta||!entry?.file){notice("Trace image silhouette","Select a reference image imported in this session. Re-import it if the project was reopened without its original image file.");return}
  try{
    const bitmap=await createImageBitmap(entry.file),scale=Math.min(1000/bitmap.width,800/bitmap.height),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=$("#traceCanvas");canvas.width=width;canvas.height=height;
    state.trace={record,bitmap,points:Array.isArray(meta.outline)?meta.outline.map(point=>[...point]):[],closed:false,editing:Array.isArray(meta.outline)&&meta.outline.length>=3,mode:"silhouette",axis:meta.axis||"front",width:Number(meta.width)||3,height:Number(meta.height)||((Number(meta.width)||3)/(Number(meta.aspect)||1))};
    $("#traceDepth").value=$("#silhouetteDepth").value||"0.35";
    configureTraceDialog("silhouette");
    $("#traceMessage").textContent=state.trace.points.length?"Loaded saved "+state.trace.points.length+"-point outline. Continue editing it or save a revised contour.":"Tap around the outside edge. Click near the first point to close the contour.";
    $("#traceDialog").showModal();traceDraw();
  }catch(error){reportError("Could not open silhouette tracing",error)}
}
function traceImagePoint(event){
  const canvas=$("#traceCanvas"),rect=canvas.getBoundingClientRect();
  if(!rect.width||!rect.height)return null;
  return{point:[clamp((event.clientX-rect.left)/rect.width,0,1,0),clamp((event.clientY-rect.top)/rect.height,0,1,0)],rect,canvas};
}
function segmentDistancePixels(point,a,b,canvas){
  const px=point[0]*canvas.width,py=point[1]*canvas.height,ax=a[0]*canvas.width,ay=a[1]*canvas.height,bx=b[0]*canvas.width,by=b[1]*canvas.height,dx=bx-ax,dy=by-ay;
  const t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1),0,1,0),qx=ax+t*dx,qy=ay+t*dy;
  return Math.hypot(px-qx,py-qy);
}
function addTracePoint(event){
  const trace=state.trace,result=traceImagePoint(event);if(!trace||trace.closed||!result)return;
  const {point:p,canvas}=result,threshold=Math.max(12,Math.min(canvas.width,canvas.height)*.025);
  if(trace.mode!=="lathe-profile"&&trace.points.length>=3){
    const first=trace.points[0],distance=Math.hypot((p[0]-first[0])*canvas.width,(p[1]-first[1])*canvas.height);
    if(distance<threshold){trace.closed=true;$("#traceMessage").textContent="Contour closed. Review the outline, then save it or build a 3D mesh.";traceDraw();return}
  }
  for(let i=0;i<trace.points.length;i++){
    const vertex=trace.points[i],distance=Math.hypot((p[0]-vertex[0])*canvas.width,(p[1]-vertex[1])*canvas.height);
    if(distance<6)return;
  }
  if(trace.points.length>=256){$("#traceMessage").textContent="The outline reached 256 points. Build this contour or clear it and trace a simpler boundary.";return}
  trace.points.push(p);$("#traceMessage").textContent="Point added. Continue around the silhouette in one direction.";traceDraw();
}
function handleTracePointerDown(event){
  event.preventDefault();const trace=state.trace,result=traceImagePoint(event);if(!trace||!result)return;
  const {point,canvas}=result,limit=Math.max(12,Math.min(canvas.width,canvas.height)*.025);
  if(trace.mode!=="lathe-profile"&&trace.points.length>=3&&Math.hypot((point[0]-trace.points[0][0])*canvas.width,(point[1]-trace.points[0][1])*canvas.height)<limit){addTracePoint(event);return}
  let nearest=-1,nearestDistance=Infinity;
  for(let i=1;i<trace.points.length;i++){
    const v=trace.points[i],d=Math.hypot((point[0]-v[0])*canvas.width,(point[1]-v[1])*canvas.height);
    if(d<nearestDistance){nearest=i;nearestDistance=d}
  }
  if(nearest>=1&&nearestDistance<limit){
    const index=nearest;let moved=false;trace.closed=false;
    const move=moveEvent=>{const p=traceImagePoint(moveEvent)?.point;if(!p)return;trace.points[index]=p;moved=true;$("#traceMessage").textContent="Moving contour point "+(index+1)+". Release to keep the new position.";traceDraw()};
    const finish=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",finish);document.removeEventListener("pointercancel",finish);if(moved){trace.editing=true;$("#traceMessage").textContent="Contour point moved. Save outline to update the reference.";traceDraw()}};
    document.addEventListener("pointermove",move);document.addEventListener("pointerup",finish,{once:true});document.addEventListener("pointercancel",finish,{once:true});return;
  }
  if(trace.editing&&trace.points.length>=3){
    let best=Infinity,bestAfter=-1;
    for(let i=0;i<trace.points.length;i++){
      const j=(i+1)%trace.points.length,d=segmentDistancePixels(point,trace.points[i],trace.points[j],canvas);
      if(d<best){best=d;bestAfter=j}
    }
    if(best<limit&&trace.points.length<256){trace.points.splice(bestAfter,0,point);trace.closed=false;$("#traceMessage").textContent="Point inserted into the nearest contour edge. Save outline to keep the change.";traceDraw();return}
    $("#traceMessage").textContent="To refine a saved outline, drag a point or tap close to an existing edge. To start a new outline, clear it first.";return;
  }
  addTracePoint(event);
}
function closeTraceEditor(){
  if(state.trace?.bitmap)state.trace.bitmap.close?.();state.trace=null;
  if($("#traceDialog")?.open)$("#traceDialog").close();
}
function buildTraceLathe(){
  const trace=state.trace;if(!trace||trace.mode!=="lathe-profile")return;
  if(trace.points.length<4){$("#traceMessage").textContent="Add at least four profile points: bottom center, exterior contour, rim, and return path.";return}
  try{
    const record=state.engine.createLathedProfileMesh({
      name:trace.record.name.replace(/\.[^.]+$/,"")+" — Spin 360°",
      profile:trace.points,diameter:clamp($("#latheDiameter").value,.001,1000,.08),
      height:clamp($("#latheHeight").value,.001,1000,.25),segments:clamp($("#latheSegments").value,12,128,32),color:[.42,.62,.76]
    });
    const diag=record.components.diagnostics||{};
    state.engine.select(record.id);state.engine.frame();refreshAll();setWorkspace("modeling");closeTraceEditor();
    status("Spin 360° mesh built · "+Number(diag.vertices||0).toLocaleString()+" vertices · inspect wall thickness and topology","dirty");
  }catch(error){$("#traceMessage").textContent=error?.message||String(error);status("Lathe profile could not be built","error")}
}
function buildTraceMesh(){
  const trace=state.trace;if(!trace||trace.mode==="lathe-profile")return;
  if(trace.points.length<3){$("#traceMessage").textContent="Add at least three points before building a mesh.";return}
  try{
    const reference=trace.record.components.reference,depth=clamp($("#traceDepth").value,.01,1000,.35);$("#silhouetteDepth").value=String(depth);
    const base=trace.record.name.replace(/\.[^.]+$/,"");
    const record=state.engine.createExtrudedSilhouette({
      name:base+" — 3D Silhouette",contour:trace.points,axis:reference.axis||trace.axis,
      width:Number(reference.width)||trace.width,
      height:Number(reference.height)||trace.height,depth,color:[.36,.57,.76]
    });
    state.engine.select(record.id);state.engine.frame();refreshAll();setWorkspace("modeling");closeTraceEditor();
    status("3D silhouette mesh built · refine the geometry and compare other views","dirty");
  }catch(error){$("#traceMessage").textContent=error?.message||String(error);status("Silhouette mesh could not be built","error")}
}

function saveTraceOutline(){
  const trace=state.trace;if(!trace)return;
  if(trace.points.length<3){$("#traceMessage").textContent="Add at least three points before saving an outline.";return}
  const meta=trace.record.components.reference;
  if(trace.mode==="lathe-profile"){
    meta.latheProfile=trace.points.map(point=>[Number(point[0]),Number(point[1])]);
    meta.latheProfileSavedAt=new Date().toISOString();trace.editing=true;
    refreshReferences();refreshHierarchy();
    $("#traceMessage").textContent="Saved "+meta.axis+" spin profile · "+meta.latheProfile.length+" points. Use Spin 360° → Build mesh when ready.";
    status("Lathe profile saved","dirty");return;
  }
  meta.outline=trace.points.map(point=>[Number(point[0]),Number(point[1])]);
  meta.outlineSavedAt=new Date().toISOString();meta.outlineClosed=true;trace.editing=true;trace.closed=true;
  refreshReferences();refreshHierarchy();
  $("#traceMessage").textContent="Saved "+meta.axis+" outline · "+meta.outline.length+" points. This reference can now contribute to a silhouette volume.";
  status("Reference outline saved","dirty");
}
function buildSilhouetteHull(){
  const references=[...state.engine.entities.values()].filter(record=>record.components?.reference&&Array.isArray(record.components.reference.outline)&&record.components.reference.outline.length>=3);
  const front=references.find(record=>record.components.reference.axis==="front");
  const side=references.find(record=>record.components.reference.axis==="side");
  const top=references.find(record=>record.components.reference.axis==="top");
  if(!front||!side){
    $("#hullStatus").textContent="Required: saved Front + Side outlines. A saved Top outline is optional and tightens the reconstructed volume. Select each image, trace it, then tap Save outline.";
    $("#hullStatus").dataset.state="error";status("Visual hull needs front and side outlines","warn");return;
  }
  const fm=front.components.reference,sm=side.components.reference,tm=top?.components.reference;
  const frontHeight=Number(fm.height)||Number(fm.width)/(Number(fm.aspect)||1);
  const sideHeight=Number(sm.height)||Number(sm.width)/(Number(sm.aspect)||1);
  const heightMismatch=Math.abs(frontHeight-sideHeight)/Math.max(frontHeight,sideHeight,.01);
  if(heightMismatch>.05){
    $("#hullStatus").textContent="Front/side image heights differ by "+(heightMismatch*100).toFixed(1)+"%. Adjust known image widths so both share the same real object height (within 5%).";
    $("#hullStatus").dataset.state="error";status("Align front and side reference scale","warn");return;
  }
  if(top){
    const topWidth=Number(tm.width)||0,topDepth=Number(tm.height)||topWidth/(Number(tm.aspect)||1);
    const widthMismatch=Math.abs(topWidth-Number(fm.width))/Math.max(topWidth,Number(fm.width),.01);
    const depthMismatch=Math.abs(topDepth-Number(sm.width))/Math.max(topDepth,Number(sm.width),.01);
    if(widthMismatch>.05||depthMismatch>.05){
      $("#hullStatus").textContent="Top reference scale must match Front width and Side depth. Width mismatch: "+(widthMismatch*100).toFixed(1)+"%; depth mismatch: "+(depthMismatch*100).toFixed(1)+"%. Adjust its known width, then retry.";
      $("#hullStatus").dataset.state="error";status("Align top reference dimensions","warn");return;
    }
  }
  try{
    const height=(frontHeight+sideHeight)/2,width=clamp(fm.width,.01,10000,3),depth=clamp(sm.width,.01,10000,3),resolution=clamp($("#hullResolution").value,12,48,32),viewCount=top?3:2;
    $("#hullStatus").textContent="Building "+resolution+"³ voxel visual hull from "+viewCount+" calibrated view outlines…";$("#hullStatus").dataset.state="";
    const record=state.engine.createSilhouetteVisualHull({
      name:front.name.replace(/\.[^.]+$/,"")+" — "+viewCount+"-view Hull",
      frontContour:fm.outline,sideContour:sm.outline,topContour:tm?.outline||[],width,height,depth,resolution,color:[.32,.62,.76]
    });
    state.engine.select(record.id);window.ForgeViewport?.frame?.();refreshAll();setWorkspace("modeling");
    const diag=record.components.diagnostics||{};
    $("#hullStatus").textContent=viewCount+"-view visual hull built · "+Number(diag.occupiedVoxels||0).toLocaleString()+" occupied voxels at "+resolution+"³. This is a blockout; inspect orthographic views and refine details.";
    $("#hullStatus").dataset.state="success";status(viewCount+"-view visual hull built · inspect all orthographic views","dirty");
  }catch(error){
    $("#hullStatus").textContent=error?.message||String(error);$("#hullStatus").dataset.state="error";
    status("Multi-view volume could not be built","error");
  }
}
function refreshDiagnostics(){
  const engine=state.engine;if(!engine)return;const d=engine.diagnostics();$("#rendererStatus").textContent=d.renderer||"WebGL";$("#fpsStatus").textContent=(Number(d.fps)||0).toFixed(0)+" FPS · "+(Number(d.frameMs)||0).toFixed(1)+" ms";$("#entityStatus").textContent=d.entities+" entities";$("#unitLabel").textContent=String(d.unitSystem||"meters").toUpperCase();$("#unitSystem").value=d.unitSystem==="centimeters"?"centimeters":"meters";$("#snapEnabled").checked=engine.snapEnabled===true;$("#showGrid").checked=state.grid;$("#engineStatus").textContent=state.preview?"Scene preview active":"Engine ready";$("#diagnosticStatus").textContent=state.lastError?"1 error":"No errors";$("#diagnosticStatus").classList.toggle("diagnostic-error",!!state.lastError);if(state.timelinePlaying)refreshTimeline();
}
function refreshAll(){refreshHierarchy();refreshInspector();refreshDiagnostics();refreshReferences()}
function changed(){refreshAll();status("Scene changed · unsaved","dirty")}
async function saveProject(){if(!window.ForgeProject)throw new Error("Project serializer did not load");window.ForgeProject.download(fileBaseName(projectLabel())+".forge.json");document.title=projectLabel()+" — Forge Next";status("Project exported")}
function openProject(){ $("#projectInput").click() }
function importAssets(){ $("#assetInput").click() }
async function loadAssets(files){
  if(state.workspace==="references"){const images=files.filter(file=>file.type.startsWith("image/")),other=files.filter(file=>!file.type.startsWith("image/"));if(images.length)await loadReferenceImages(images);files=other}
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
function toggleTimeline(){state.engine.timelinePlaying=!state.engine.timelinePlaying;state.timelinePlaying=state.engine.timelinePlaying;refreshTimeline();status(state.timelinePlaying?"Timeline playback running":"Timeline playback stopped")}
function toggleTimelineLoop(){state.engine.timelineLoop=state.engine.timelineLoop===false;refreshTimeline();status(state.engine.timelineLoop?"Timeline loop enabled":"Timeline loop disabled")}
function setTimelineFrame(value){const frame=clamp(Math.round(Number(value)||0),0,240,0);state.engine.timelineTime=frame/24;state.engine.evalAnimation(state.engine.timelineTime);refreshInspector();refreshTimeline()}
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
  registerCommand("timeline-play",toggleTimeline);registerCommand("timeline-loop",toggleTimelineLoop);registerCommand("timeline-start",()=>setTimelineFrame(0));registerCommand("timeline-end",()=>setTimelineFrame(240));registerCommand("toggle-auto-key",toggleAutoKey);registerCommand("keyframe",()=>{state.engine.keyInterpolation=$("#keyInterpolation").value;const result=state.engine.key({interpolation:$("#keyInterpolation").value});refreshTimeline();status(result?.updated?"Keyframe replaced":"Keyframe inserted","dirty")});registerCommand("apply-reference-setup",()=>applyReferenceSetup());registerCommand("focus-reference-view",focusReferenceView);registerCommand("toggle-reference-visibility",()=>{const record=selectedRecord();if(!record?.components?.reference){notice("Image Modeling","Select a reference image plane first.");return}record.entity.enabled=record.entity.enabled===false;record.components.reference.visible=record.entity.enabled;refreshReferences();status(record.entity.enabled?"Reference shown":"Reference hidden","dirty")});registerCommand("close-timeline",()=>{document.documentElement.classList.add("timeline-manually-closed");status("Timeline hidden")});registerCommand("close-notice",()=>$("#noticeDialog").close());
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
  $("#addReferenceImages").addEventListener("click",()=>$("#referenceInput").click());
  $("#traceSilhouette").addEventListener("click",()=>void startSilhouetteTrace());
  $("#traceLatheProfile").addEventListener("click",()=>void startLatheProfileTrace());
  $("#traceCanvas").addEventListener("pointerdown",handleTracePointerDown);
  $("#traceUndo").addEventListener("click",()=>{if(state.trace){state.trace.points.pop();state.trace.closed=false;$("#traceMessage").textContent="Last contour point removed.";traceDraw()}});
  $("#traceClear").addEventListener("click",()=>{if(state.trace){state.trace.points=[];state.trace.closed=false;state.trace.editing=false;$("#traceMessage").textContent="Outline cleared. Trace a new contour in one direction.";traceDraw()}});
  $("#traceSaveOutline").addEventListener("click",saveTraceOutline);
  $("#traceBuild").addEventListener("click",buildTraceMesh);
  $("#traceBuildLathe").addEventListener("click",buildTraceLathe);
  $("#buildSilhouetteHull").addEventListener("click",buildSilhouetteHull);
  $("#traceClose").addEventListener("click",closeTraceEditor);
  $("#traceDialog").addEventListener("cancel",event=>{event.preventDefault();closeTraceEditor()});
  $("#referenceInput").addEventListener("change",e=>{const files=[...e.target.files];if(files.length)void loadReferenceImages(files);e.target.value=""});
  $("#referenceOpacity").addEventListener("input",()=>$("#referenceOpacityValue").textContent=Math.round(Number($("#referenceOpacity").value)*100)+"%");
  $("#keyInterpolation").addEventListener("change",()=>{state.engine.keyInterpolation=$("#keyInterpolation").value;refreshTimeline()});
  $("#timelineTrack").addEventListener("click",event=>{if(event.target.closest(".timeline-key-marker"))return;const rect=$("#timelineTrack").getBoundingClientRect();setTimelineFrame(Math.round(clamp((event.clientX-rect.left)/Math.max(1,rect.width),0,1,0)*240))});
  $$("[data-timeline-view]").forEach(button=>button.addEventListener("click",()=>setGraphView(button.dataset.timelineView)));
  $("#graphChannel").addEventListener("change",event=>{state.graphChannel=event.target.value;refreshTimeline()});
  $("#graphEditorCanvas").addEventListener("pointerdown",graphPointerDown);
  window.addEventListener("resize",()=>{if(state.timelineView==="graph")drawGraphEditor()});
  $("#timelineTrack").addEventListener("keydown",event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();setTimelineFrame(Number($("#currentFrame").value)+(event.key==="ArrowRight"?1:-1))}});
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
  window.addEventListener("forge-selection",()=>{refreshHierarchy();refreshInspector();refreshReferences()});window.addEventListener("forge-assets-changed",()=>{refreshHierarchy();refreshAssetList();refreshInspector();refreshReferences()});window.addEventListener("resize",()=>state.engine?.app?.resizeCanvas?.());
  const ro=new ResizeObserver(()=>requestAnimationFrame(()=>state.engine?.app?.resizeCanvas?.()));ro.observe($("#viewportStage"));
}
function bootFailed(error){state.lastError=error?.message||String(error);$("#bootMessage").textContent="Startup failed: "+state.lastError;$("#bootScreen").querySelector(".boot-meter").hidden=true;console.error("[Forge Next] Startup failed",error)}
async function boot(){
  loadPrefs();status("Loading engine…");
  const {ForgeEngine,pc}=await import("./forge-engine.js");
  window.ForgePC=pc;
  const engine=new ForgeEngine($("#viewport"),message=>console.info("[Forge Engine]",message));state.engine=engine;await engine.init();window.Forge=engine;
  status("Installing viewport…");await import("./forge-viewport.js");
  try{await import("./forge-spatial.js")}catch(error){console.warn("Spatial overlay unavailable",error)}
  try{await import("./forge-gizmo.js")}catch(error){console.warn("Transform gizmo adapter unavailable",error)}
  await import("./forge-project.js");
  try{await import("./forge-export.js")}catch(error){console.warn("Asset export adapter unavailable",error)}
  window.ForgeReady=true;window.ForgeBootState="ready";window.dispatchEvent(new Event("forge-ready"));bindUI();
  const cube=engine.primitive("box","Cube");engine.select(cube.id);engine.frame();try{await window.ForgeGizmo?.init?.()}catch(error){console.warn("Native gizmo did not attach",error)}
  toggleGrid(true);chooseTool("select");chooseView("perspective");setWorkspace("layout",{save:false});setLeftPanel(state.leftPanel,{save:false});setInspectorPanel(state.inspectorPanel,{save:false});refreshAll();
  $("#bootMessage").textContent="Ready";$("#bootScreen").hidden=true;$("#forgeApp").classList.remove("is-booting");$("#forgeApp").classList.add("is-ready");status("Forge Next ready");state.statusTimer=window.setInterval(refreshDiagnostics,500);
}
boot().catch(bootFailed);
