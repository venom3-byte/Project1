const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const PREFS_KEY = "forge.eye.preferences.v1";
const defaults = { left:264, right:302, timeline:178, leftCollapsed:false, rightCollapsed:false };
const state = {engine:null,rustCore:null,workspace:"layout",leftPanel:"scene",inspectorPanel:"properties",tool:"select",preview:false,timelinePlaying:false,timelineView:"dopesheet",graphChannel:"p0",autoKey:false,snap:false,grid:true,assets:[],trace:null,latheProfile:[],latheSelectedPoint:0,latheDrag:null,statusTimer:0,prefs:{...defaults},lastError:null};
const commands = new Map();
function registerCommand(name, execute){if(commands.has(name))throw new Error("Duplicate command: "+name);commands.set(name,execute)}
function clamp(n,min,max,fallback){const v=Number(n);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback}
function status(message,kind="ready"){
  if(kind!=="error")state.lastError=null;
  const el=$("#saveState");if(el){el.classList.toggle("is-dirty",kind==="dirty");el.classList.toggle("is-error",kind==="error");const text=el.querySelector("span:last-child");if(text)text.textContent=message;el.title=message}
  const e=$("#engineStatus");if(e){e.textContent=message;e.classList.toggle("diagnostic-error",kind==="error");e.classList.toggle("diagnostic-warn",kind==="warn")}
}
function setRustStatus(message,ready){
  const label=$("#rustCoreStatus"),led=$("#rustCoreLed");
  if(label)label.textContent=message;
  if(led)led.dataset.ready=String(ready===true);
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
  if(innerWidth<=850){if(["assets","materials","world","review","references"].includes(name))openMobilePanel(name==="assets"?"assets":name==="references"?"references":"properties");else closeMobileDrawers();}
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
    const name=document.createElement("b");name.textContent=record.name;name.title=record.name;const outlineInfo=Array.isArray(meta.outline)&&meta.outline.length>=3?(" · "+meta.outline.length+" pts"):" · no outline";const details=document.createElement("small");details.textContent=String(meta.axis||"front").toUpperCase()+" · "+Number(meta.width||0).toFixed(2)+" m"+outlineInfo;
    select.append(name,details);select.addEventListener("click",()=>{state.engine.select(record.id);$("#referenceAxis").value=meta.axis||"front";$("#referenceWidth").value=String(meta.width||3);$("#referenceOpacity").value=String(meta.opacity??0.45);$("#referenceOpacityValue").textContent=Math.round((meta.opacity??0.45)*100)+"%";chooseView(meta.axis==="side"?"right":meta.axis||"front")});row.append(select);
    const visibility=document.createElement("button");visibility.type="button";visibility.className="reference-visibility";visibility.textContent=record.entity.enabled===false?"Show":"Hide";
    visibility.addEventListener("click",()=>{record.entity.enabled=record.entity.enabled===false;meta.visible=record.entity.enabled;refreshReferences();status(record.entity.enabled?"Reference shown":"Reference hidden","dirty")});row.append(visibility);list.append(row);
  }
  const chosen=selectedRecord();if(chosen?.components?.reference){const d=chosen.components.reference;$("#referenceAxis").value=d.axis||"front";$("#referenceWidth").value=String(d.width||3);$("#referenceOpacity").value=String(d.opacity??0.45);$("#referenceOpacityValue").textContent=Math.round((d.opacity??0.45)*100)+"%"}
}
function focusReferenceView(){const ref=selectedRecord()?.components?.reference;if(!ref){notice("Image Modeling","Select a calibrated reference plane first.");return}chooseView(ref.axis==="side"?"right":ref.axis||"front");state.engine.frame();status("Reference aligned in "+ref.axis+" view")}
// Preserve the exact uploaded bytes. Do not shrink or recompress reference art:
// image references are often engineering drawings where fine line detail matters.
async function referenceImageDataUrl(file){
  if(!file||typeof file.slice!=="function")throw new Error("Reference image file is not readable");
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>typeof reader.result==="string"?resolve(reader.result):reject(new Error("Could not preserve original reference image"));
    reader.onerror=()=>reject(reader.error||new Error("Could not read the original reference image"));
    reader.readAsDataURL(file);
  });
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
  if(trace.points.length){
    ctx.save();ctx.lineWidth=Math.max(2,Math.min(w,h)*.0035);ctx.strokeStyle="#54d6ff";ctx.fillStyle="#b0efff";ctx.lineJoin="round";ctx.lineCap="round";
    ctx.beginPath();trace.points.forEach((p,i)=>{const x=p[0]*w,y=p[1]*h;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});
    if(trace.closed||trace.points.length>2)ctx.lineTo(trace.points[0][0]*w,trace.points[0][1]*h);ctx.stroke();
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
    state.trace={record,bitmap,points:Array.isArray(meta.outline)?meta.outline.map(point=>[...point]):[],closed:false,editing:Array.isArray(meta.outline)&&meta.outline.length>=3,axis:meta.axis||"front",width:Number(meta.width)||3,height:Number(meta.height)||((Number(meta.width)||3)/(Number(meta.aspect)||1))};
    $("#traceDepth").value=$("#silhouetteDepth").value||"0.35";
    $("#traceMessage").textContent=state.trace.points.length?"Loaded saved "+state.trace.points.length+"-point outline. Continue editing it or save a revised contour.":"Tap around the object outline. Click near the first point to close the contour, or Build 3D mesh closes it automatically.";
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
  if(trace.points.length>=3){
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
  if(trace.points.length>=3&&Math.hypot((point[0]-trace.points[0][0])*canvas.width,(point[1]-trace.points[0][1])*canvas.height)<limit){addTracePoint(event);return}
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
function buildTraceMesh(){
  const trace=state.trace;if(!trace)return;
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
  meta.outline=trace.points.map(point=>[Number(point[0]),Number(point[1])]);
  meta.outlineSavedAt=new Date().toISOString();meta.outlineClosed=true;trace.editing=true;trace.closed=true;
  refreshReferences();refreshHierarchy();
  $("#traceMessage").textContent="Saved "+meta.axis+" outline · "+meta.outline.length+" points. This reference can now contribute to a two-view volume.";
  status("Reference outline saved","dirty");
}
function buildSilhouetteHull(){
  const references=[...state.engine.entities.values()].filter(record=>record.components?.reference&&Array.isArray(record.components.reference.outline)&&record.components.reference.outline.length>=3);
  const front=references.find(record=>record.components.reference.axis==="front");
  const side=references.find(record=>record.components.reference.axis==="side");
  const top=references.find(record=>record.components.reference.axis==="top");
  if(!front||!side){
    $("#hullStatus").textContent="Required: saved Front + Side outlines. A saved Top outline is optional and tightens the reconstructed volume. Trace each image, then tap Save outline.";
    $("#hullStatus").dataset.state="error";status("Visual hull needs front and side outlines","warn");return;
  }
  if(!state.rustCore?.visualHullMesh)throw new Error("Rust/WASM visual-hull generator is unavailable. Reload after the Rust core finishes loading.");
  const fm=front.components.reference,sm=side.components.reference,tm=top?.components.reference;
  const frontHeight=Number(fm.height)||Number(fm.width)/(Number(fm.aspect)||1);
  const sideHeight=Number(sm.height)||Number(sm.width)/(Number(sm.aspect)||1);
  const heightMismatch=Math.abs(frontHeight-sideHeight)/Math.max(frontHeight,sideHeight,.01);
  if(heightMismatch>.05){
    $("#hullStatus").textContent="Front/side image heights differ by "+(heightMismatch*100).toFixed(1)+"%. Align their real-world heights within 5%.";
    $("#hullStatus").dataset.state="error";status("Align front and side reference scale","warn");return;
  }
  if(top){
    const topWidth=Number(tm.width)||0,topDepth=Number(tm.height)||topWidth/(Number(tm.aspect)||1);
    const widthMismatch=Math.abs(topWidth-Number(fm.width))/Math.max(topWidth,Number(fm.width),.01);
    const depthMismatch=Math.abs(topDepth-Number(sm.width))/Math.max(topDepth,Number(sm.width),.01);
    if(widthMismatch>.05||depthMismatch>.05){
      $("#hullStatus").textContent="Top reference scale must match Front width and Side depth. Width mismatch: "+(widthMismatch*100).toFixed(1)+"%; depth mismatch: "+(depthMismatch*100).toFixed(1)+"%.";
      $("#hullStatus").dataset.state="error";status("Align top reference dimensions","warn");return;
    }
  }
  try{
    const height=(frontHeight+sideHeight)/2,width=clamp(fm.width,.01,10000,3),depth=clamp(sm.width,.01,10000,3),resolution=clamp($("#hullResolution").value,12,48,24),viewCount=top?3:2;
    $("#hullStatus").textContent="Rust/WASM is intersecting "+viewCount+" silhouettes at "+resolution+"³…";$("#hullStatus").dataset.state="";
    setRustStatus("Building visual hull in Rust/WASM…",true);
    const result=state.rustCore.visualHullMesh(fm.outline,sm.outline,tm?.outline||[],{width,height,depth,resolution});
    const record=state.engine.createVisualHullMeshFromData({
      name:front.name.replace(/\.[^.]+$/,"")+" — "+viewCount+"-view Rust Hull",
      result,frontContour:fm.outline,sideContour:sm.outline,topContour:tm?.outline||[],
      width,height,depth,resolution,color:[.32,.62,.76]
    });
    state.engine.select(record.id);refreshAll();setWorkspace("modeling");
    const diag=record.components.diagnostics||{};
    $("#hullStatus").textContent=viewCount+"-view Rust visual hull built · "+Number(diag.occupiedVoxels||0).toLocaleString()+" voxels · "+record.components.geometry.triangleCount.toLocaleString()+" triangles. Review and refine the mesh.";
    $("#hullStatus").dataset.state="success";setRustStatus("Rust/WASM geometry core ready",true);
    status(viewCount+"-view Rust visual hull generated · inspect all orthographic views","dirty");
  }catch(error){
    $("#hullStatus").textContent=error?.message||String(error);$("#hullStatus").dataset.state="error";
    setRustStatus("Rust/WASM visual-hull build failed",false);status("Multi-view volume could not be built","error");
  }
}
const LATHE_PRESETS = {
  bottle:[[0,0],[.19,0],[.25,.04],[.29,.12],[.29,.38],[.23,.49],[.15,.59],[.135,.8],[.105,.88],[0,.92]],
  vase:[[0,0],[.22,0],[.29,.07],[.24,.2],[.17,.37],[.21,.53],[.31,.7],[.32,.83],[.24,.94],[0,.97]],
  cup:[[0,0],[.23,0],[.29,.035],[.31,.16],[.32,.65],[.30,.69],[0,.69]],
  flask:[[0,0],[.16,0],[.23,.05],[.27,.2],[.32,.38],[.31,.6],[.22,.78],[.17,.87],[.17,.94],[0,.96]]
};
function latheProfileBounds(profile=state.latheProfile){
  return {
    maxRadius:Math.max(.55,...profile.map(point=>Number(point.radius)||0))*1.16,
    maxHeight:Math.max(1,...profile.map(point=>Number(point.height)||0))*1.08
  };
}
function latheChart(canvas,profile=state.latheProfile){
  const w=canvas.width||720,h=canvas.height||600,bounds=latheProfileBounds(profile);
  return {w,h,x0:68,x1:w-28,y0:28,y1:h-44,...bounds};
}
function latheCanvasPoint(event,canvas,chart){
  const rect=canvas.getBoundingClientRect();
  return {
    x:clamp((event.clientX-rect.left)*chart.w/Math.max(1,rect.width),chart.x0,chart.x1,chart.x0),
    y:clamp((event.clientY-rect.top)*chart.h/Math.max(1,rect.height),chart.y0,chart.y1,chart.y1)
  };
}
function latheProfilePointFromCanvas(point,chart){
  return {
    radius:clamp((point.x-chart.x0)/(chart.x1-chart.x0)*chart.maxRadius,0,100,0),
    height:clamp((chart.y1-point.y)/(chart.y1-chart.y0)*chart.maxHeight,0,100,0)
  };
}
function drawLatheProfile(){
  const canvas=$("#latheProfileCanvas");if(!canvas)return;
  const ctx=canvas.getContext("2d");if(!ctx)return;
  const profile=state.latheProfile,chart=latheChart(canvas,profile);
  ctx.clearRect(0,0,chart.w,chart.h);ctx.fillStyle="#0a1118";ctx.fillRect(0,0,chart.w,chart.h);
  ctx.font="11px ui-monospace,monospace";ctx.textBaseline="middle";
  const xFor=radius=>chart.x0+Number(radius)/chart.maxRadius*(chart.x1-chart.x0);
  const yFor=height=>chart.y1-Number(height)/chart.maxHeight*(chart.y1-chart.y0);
  for(let i=0;i<=4;i++){
    const f=i/4,x=chart.x0+f*(chart.x1-chart.x0),y=chart.y1-f*(chart.y1-chart.y0);
    ctx.strokeStyle=i===0?"#536678":"#22313e";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x,chart.y0);ctx.lineTo(x,chart.y1);ctx.stroke();
    ctx.beginPath();ctx.moveTo(chart.x0,y);ctx.lineTo(chart.x1,y);ctx.stroke();
    ctx.fillStyle="#6f8496";ctx.fillText((f*chart.maxRadius).toFixed(2),x-12,chart.y1+17);
    if(i>0)ctx.fillText((f*chart.maxHeight).toFixed(2),8,y);
  }
  ctx.strokeStyle="#647d91";ctx.lineWidth=1.25;ctx.beginPath();ctx.moveTo(chart.x0,chart.y0);ctx.lineTo(chart.x0,chart.y1);ctx.stroke();
  ctx.fillStyle="#9aafbf";ctx.fillText("RADIUS (m)",chart.x0+8,chart.y0-12);
  ctx.fillText("HEIGHT",chart.x1-52,chart.y0-12);
  if(profile.length<2){
    ctx.fillStyle="#91a4b3";ctx.fillText("Choose a preset or add profile points",chart.x0+18,(chart.y0+chart.y1)/2);
    return;
  }
  ctx.beginPath();
  profile.forEach((point,index)=>{
    const x=xFor(point.radius),y=yFor(point.height);
    if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  ctx.strokeStyle="#4fd1c5";ctx.lineWidth=2.5;ctx.lineJoin="round";ctx.stroke();
  for(let i=0;i<profile.length;i++){
    const point=profile[i],x=xFor(point.radius),y=yFor(point.height),selected=i===state.latheSelectedPoint;
    ctx.beginPath();ctx.arc(x,y,selected?7:5,0,Math.PI*2);
    ctx.fillStyle=selected?"#f4c66a":"#dceaf3";ctx.fill();
    ctx.strokeStyle=selected?"#fff0bf":"#31566c";ctx.lineWidth=selected?2:1.5;ctx.stroke();
  }
}
function setLathePreset(name){
  const preset=name||$("#lathePreset")?.value||"bottle";
  if(preset==="custom"){
    if(!state.latheProfile.length)state.latheProfile=LATHE_PRESETS.bottle.map(([radius,height])=>({radius,height}));
  }else{
    state.latheProfile=(LATHE_PRESETS[preset]||LATHE_PRESETS.bottle).map(([radius,height])=>({radius,height}));
  }
  if($("#lathePreset"))$("#lathePreset").value=preset;
  state.latheSelectedPoint=Math.min(state.latheSelectedPoint,state.latheProfile.length-1);
  drawLatheProfile();
  const label=$("#latheStatus");
  if(label)label.textContent="Editable "+preset+" profile · drag points or tap the curve to add a point.";
}
function openLatheEditor(){
  if(!state.latheProfile.length)setLathePreset($("#lathePreset").value||"bottle");
  const dialog=$("#latheDialog");
  if(dialog&&!dialog.open)dialog.showModal();
  drawLatheProfile();
  status("Profile editor ready · edit the curve, then generate a Rust mesh");
}
function lathePointerDown(event){
  const canvas=$("#latheProfileCanvas");if(!canvas)return;
  if(!state.latheProfile.length)setLathePreset($("#lathePreset").value||"bottle");
  event.preventDefault();
  const chart=latheChart(canvas),point=latheCanvasPoint(event,canvas,chart);
  let best=-1,bestDistance=Infinity;
  state.latheProfile.forEach((p,index)=>{
    const x=chart.x0+p.radius/chart.maxRadius*(chart.x1-chart.x0),y=chart.y1-p.height/chart.maxHeight*(chart.y1-chart.y0);
    const distance=Math.hypot(x-point.x,y-point.y);if(distance<bestDistance){bestDistance=distance;best=index}
  });
  if(best>=0&&bestDistance<22){
    state.latheSelectedPoint=best;
    state.latheDrag={point:state.latheProfile[best],maxRadius:chart.maxRadius,maxHeight:chart.maxHeight};
  }else{
    const value=latheProfilePointFromCanvas(point,chart),added={radius:value.radius,height:value.height};
    state.latheProfile.push(added);state.latheProfile.sort((a,b)=>a.height-b.height);
    state.latheSelectedPoint=state.latheProfile.indexOf(added);
    if($("#lathePreset"))$("#lathePreset").value="custom";
    state.latheDrag={point:added,maxRadius:chart.maxRadius,maxHeight:chart.maxHeight};
  }
  try{canvas.setPointerCapture(event.pointerId)}catch{}
  drawLatheProfile();
}
function lathePointerMove(event){
  const drag=state.latheDrag,canvas=$("#latheProfileCanvas");if(!drag||!canvas)return;
  const chart=latheChart(canvas),point=latheCanvasPoint(event,canvas,chart);
  drag.point.radius=clamp((point.x-chart.x0)/(chart.x1-chart.x0)*drag.maxRadius,0,100,drag.point.radius);
  drag.point.height=clamp((chart.y1-point.y)/(chart.y1-chart.y0)*drag.maxHeight,0,100,drag.point.height);
  if($("#lathePreset"))$("#lathePreset").value="custom";
  drawLatheProfile();
}
function lathePointerUp(){
  if(!state.latheDrag)return;
  const selected=state.latheDrag.point;
  state.latheProfile.sort((a,b)=>a.height-b.height);
  state.latheSelectedPoint=Math.max(0,state.latheProfile.indexOf(selected));
  state.latheDrag=null;drawLatheProfile();
}
function addLatheProfilePoint(){
  if(!state.latheProfile.length)setLathePreset($("#lathePreset").value||"bottle");
  if(state.latheProfile.length>=128){notice("Profile editor","A profile is limited to 128 points for responsive interactive editing.");return}
  const profile=state.latheProfile,index=clamp(state.latheSelectedPoint,0,profile.length-1,0);
  const current=profile[index],next=profile[Math.min(index+1,profile.length-1)],previous=profile[Math.max(index-1,0)];
  let height,radius;
  if(index<profile.length-1){height=(current.height+next.height)/2;radius=(current.radius+next.radius)/2}
  else{height=current.height+Math.max(.025,(current.height-previous.height)*.5);radius=(current.radius+previous.radius)/2}
  const point={radius:Math.max(0,radius),height:Math.max(0,height)};
  profile.push(point);profile.sort((a,b)=>a.height-b.height);state.latheSelectedPoint=profile.indexOf(point);
  if($("#lathePreset"))$("#lathePreset").value="custom";drawLatheProfile();
  $("#latheStatus").textContent="Point added · drag it to refine radius and height.";
}
function removeLatheProfilePoint(){
  if(state.latheProfile.length<=3){$("#latheStatus").textContent="Keep at least three points to define a valid surface.";return}
  const index=clamp(state.latheSelectedPoint,0,state.latheProfile.length-1,0);
  state.latheProfile.splice(index,1);state.latheSelectedPoint=Math.max(0,Math.min(index,state.latheProfile.length-1));
  if($("#lathePreset"))$("#lathePreset").value="custom";drawLatheProfile();
  $("#latheStatus").textContent="Point removed · profile retained as editable geometry.";
}
function buildLatheMesh(name,{closeDialog=false}={}){
  if(!state.engine||!state.rustCore?.latheMesh)throw new Error("Rust/WASM lathe core is unavailable. Reload the editor and wait for the geometry core.");
  const profile=state.latheProfile.map(point=>({radius:Number(point.radius),height:Number(point.height)})).sort((a,b)=>a.height-b.height);
  if(profile.length<3||profile.some(point=>!Number.isFinite(point.radius)||!Number.isFinite(point.height)||point.radius<0||point.height<0))throw new Error("A valid profile needs at least three points with non-negative radius and height.");
  const options={
    radial_segments:clamp($("#latheSegments").value,12,128,64),
    profile_subdivisions:clamp($("#latheSmoothing").value,0,3,1),
    cap_ends:$("#latheCaps").checked,
    axis:$("#latheAxis").value==="z"?"z":"y"
  };
  $("#latheStatus").textContent="Rust/WASM is revolving "+profile.length+" profile points…";
  const meshData=state.rustCore.latheMesh(profile,options);
  const record=state.engine.createLatheMeshFromData({name,meshData,profile,options,color:[.34,.62,.78]});
  state.engine.select(record.id);state.engine.frame();refreshAll();
  const geometry=record.components.geometry;
  $("#latheMeshStats").textContent=geometry.vertexCount.toLocaleString()+" vertices · "+geometry.triangleCount.toLocaleString()+" triangles";
  $("#latheStatus").textContent="Real indexed mesh created by Rust/WebAssembly · source profile remains editable.";
  status("Rust lathe mesh generated · "+geometry.triangleCount.toLocaleString()+" triangles","dirty");
  if(closeDialog&&$("#latheDialog").open)$("#latheDialog").close();
  return record;
}
function quickCreateBottle(){
  setLathePreset("bottle");
  return buildLatheMesh("Bottle — Rust Lathe Mesh");
}
function generateLatheFromProfile(){
  const preset=$("#lathePreset").value||"custom";
  const record=buildLatheMesh(projectLabel()+" — "+preset.charAt(0).toUpperCase()+preset.slice(1)+" Mesh",{closeDialog:true});
  setWorkspace("modeling");return record;
}
function useReferenceOutlineForLathe(){
  const record=selectedRecord(),meta=record?.components?.reference;
  if(!meta||!Array.isArray(meta.outline)||meta.outline.length<3){
    notice("Profile from reference","Select an image reference with a saved outline first. Open Image Model, trace the silhouette and tap Save outline.");return;
  }
  const outline=meta.outline.map(point=>[clamp(point[0],0,1,0),clamp(point[1],0,1,0)]);
  const left=Math.min(...outline.map(point=>point[0])),right=Math.max(...outline.map(point=>point[0]));
  const center=(left+right)/2,width=Number(meta.width)||3,height=Number(meta.height)||(width/(Number(meta.aspect)||1));
  const levels=outline.map(([x,y])=>({radius:Math.abs(x-center)*width,height:(1-y)*height}))
    .sort((a,b)=>a.height-b.height);
  const profile=[];
  for(const point of levels){
    const previous=profile[profile.length-1];
    if(previous&&Math.abs(previous.height-point.height)<Math.max(.001,height*.006))previous.radius=Math.max(previous.radius,point.radius);
    else profile.push(point);
  }
  if(profile.length<3){notice("Profile from reference","The outline has too few distinct height levels. Add more tracing points and save it again.");return}
  if(profile[0].height>.001)profile.unshift({radius:0,height:0});
  if(profile[profile.length-1].height<height*.999)profile.push({radius:0,height});
  state.latheProfile=profile;state.latheSelectedPoint=Math.min(1,profile.length-1);
  if($("#lathePreset"))$("#lathePreset").value="custom";
  drawLatheProfile();openLatheEditor();
  $("#latheStatus").textContent="Profile extracted from "+record.name+" · approximate rotational interpretation; inspect before generating.";
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
  $("#createBottleQuick").addEventListener("click",()=>safeRun("Rust bottle generation",quickCreateBottle));
  $("#openLatheEditor").addEventListener("click",openLatheEditor);
  $("#useReferenceForLathe").addEventListener("click",()=>safeRun("Profile from reference",useReferenceOutlineForLathe));
  $("#latheProfileCanvas").addEventListener("pointerdown",lathePointerDown);
  window.addEventListener("pointermove",lathePointerMove);
  window.addEventListener("pointerup",lathePointerUp);
  window.addEventListener("pointercancel",lathePointerUp);
  $("#latheClose").addEventListener("click",()=>$("#latheDialog").close());
  $("#latheDialog").addEventListener("cancel",()=>{state.latheDrag=null});
  $("#lathePreset").addEventListener("change",event=>setLathePreset(event.target.value));
  $("#latheAddPoint").addEventListener("click",addLatheProfilePoint);
  $("#latheRemovePoint").addEventListener("click",removeLatheProfilePoint);
  $("#latheResetProfile").addEventListener("click",()=>setLathePreset($("#lathePreset").value||"bottle"));
  $("#latheCreateMesh").addEventListener("click",()=>safeRun("Rust lathe mesh",()=>generateLatheFromProfile()));
  $("#latheSegments").addEventListener("change",()=>{$("#latheStatus").textContent="Quality changed. Generate again to apply the new radial segment count."});
  $("#latheSmoothing").addEventListener("change",()=>{$("#latheStatus").textContent="Profile smoothing changed. Generate again to apply it."});
  $("#addReferenceImages").addEventListener("click",()=>$("#referenceInput").click());
  $("#traceSilhouette").addEventListener("click",()=>void startSilhouetteTrace());
  $("#traceCanvas").addEventListener("pointerdown",handleTracePointerDown);
  $("#traceUndo").addEventListener("click",()=>{if(state.trace){state.trace.points.pop();state.trace.closed=false;$("#traceMessage").textContent="Last contour point removed.";traceDraw()}});
  $("#traceClear").addEventListener("click",()=>{if(state.trace){state.trace.points=[];state.trace.closed=false;state.trace.editing=false;$("#traceMessage").textContent="Outline cleared. Trace a new contour in one direction.";traceDraw()}});
  $("#traceSaveOutline").addEventListener("click",saveTraceOutline);
  $("#traceBuild").addEventListener("click",buildTraceMesh);
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
  window.addEventListener("resize",()=>{if(state.timelineView==="graph")drawGraphEditor();if($("#latheDialog")?.open)drawLatheProfile()});
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
  loadPrefs();status("Loading Rust geometry core…");
  try{
    const {initForgeEyeCore}=await import("./forge-eye-wasm.js");
    state.rustCore=await initForgeEyeCore("./forge_eye_core.wasm.gz");
    window.ForgeEyeRust=state.rustCore;setRustStatus("Rust/WASM core ready",true);
  }catch(error){
    state.rustCore=null;window.ForgeEyeRust=null;setRustStatus("Rust core unavailable · "+(error?.message||String(error)),false);
    console.error("[Forge Eye] Rust WASM initialization failed",error);
  }
  status("Loading 3D renderer…");
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
  $("#bootMessage").textContent="Ready";$("#bootScreen").hidden=true;$("#forgeApp").classList.remove("is-booting");$("#forgeApp").classList.add("is-ready");status(state.rustCore?"Forge Eye ready · Rust/WASM":"Forge Eye ready · Rust core unavailable","ready");if(state.latheProfile.length)drawLatheProfile();state.statusTimer=window.setInterval(refreshDiagnostics,500);
}
boot().catch(bootFailed);
