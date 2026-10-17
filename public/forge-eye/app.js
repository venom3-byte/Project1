import initWasm,{ForgeEyeSession,engine_version,validate_contour_json} from "./pkg/forge_eye_wasm.js";

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const clamp=(v,min,max,fallback)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};
const defaultProfile=[[.50,.94],[.78,.94],[.82,.90],[.78,.84],[.67,.77],[.62,.69],[.62,.30],[.59,.23],[.55,.19],[.50,.18]];
const state={wasm:null,session:null,scene:null,engine:null,pc:null,renderMap:new Map(),references:{front:null,side:null,top:null},referenceView:"front",workspace:"scene",animationView:"dope",graphChannel:"position:0",profile:defaultProfile.map(p=>[...p]),profileUndo:[],profileReference:null,profileDrag:null,trace:null,traceImageRect:null,syncingSelection:false,syncingForm:false,playing:false,lastFrameAt:0,raf:0,dirty:false,externalAssets:[]};
const primitiveGlyph={cube:"◇",sphere:"●",cylinder:"◉",plane:"▱",cone:"△",torus:"◎",camera:"▣",light:"☼"};
const hexOf=c=>"#"+(c||[.32,.62,.76]).slice(0,3).map(v=>Math.round(clamp(v,0,1,0)*255).toString(16).padStart(2,"0")).join("").toUpperCase();
const color4=hex=>{const s=String(hex||"#529ec9").replace("#","");return[0,2,4].map(i=>parseInt(s.slice(i,i+2),16)/255).concat(1)};
function setStatus(message,kind="info"){ $("#statusText").textContent=message;const light=$(".status-light");light.classList.toggle("is-ready",kind==="success");light.classList.toggle("is-error",kind==="error"); }
function toast(message,kind="info"){const el=document.createElement("div");el.className="toast";el.dataset.kind=kind;el.textContent=message;$("#toastRegion").append(el);while($("#toastRegion").children.length>4)$("#toastRegion").firstElementChild.remove();setTimeout(()=>el.remove(),4200)}
function setDirty(v=true){state.dirty=!!v;$("#dirtyMark").hidden=!state.dirty}
function safeFilename(s){return String(s||"Forge-Eye").replace(/[^\p{L}\p{N}._-]+/gu,"-").slice(0,80)||"Forge-Eye"}
function download(name,blob){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function downloadText(name,text,mime="application/json"){download(name,new Blob([text],{type:mime}))}
async function fileToDataUrl(file,maxSide=1536){const bitmap=await createImageBitmap(file),scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));c.getContext("2d").drawImage(bitmap,0,0,c.width,c.height);bitmap.close?.();const webp=c.toDataURL("image/webp",.86);return webp.startsWith("data:image/webp")?webp:c.toDataURL("image/png")}
async function dataUrlToFile(url,name){const response=await fetch(url);if(!response.ok)throw new Error("Reference image couldn't be restored.");const blob=await response.blob();return new File([blob],name||"reference.png",{type:blob.type||"image/png"})}
function notifyEngine(message){console.info("[Forge Eye Engine]",message)}
async function boot(){
  try{
    setStatus("Loading Rust WebAssembly core…");
    const encoded=await fetch("./pkg/forge_eye_wasm_bg.wasm.b64",{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error("Rust WASM binary returned HTTP "+r.status);return r.text()});
    const bytes=Uint8Array.from(atob(encoded.replace(/\s+/g,"")),c=>c.charCodeAt(0));await initWasm(bytes);
    state.wasm={ForgeEyeSession,engine_version,validate_contour_json};state.session=new ForgeEyeSession();state.scene=JSON.parse(state.session.scene_json());
    const mod=await import("./runtime/forge-engine.js");state.pc=mod.pc;window.ForgePC=mod.pc;state.engine=new mod.ForgeEngine($("#viewport"),notifyEngine);await state.engine.init();window.Forge=state.engine;
    await import("./runtime/forge-viewport.js");attachRendererEvents();
    await runCore({type:"create_primitive",primitive:"cube",name:"Cube"},{dirty:false});
    $("#rustBadge").textContent=engine_version();$("#rustBadge").classList.add("is-ready");$("#rustBadge").title="Rust geometry and scene core loaded as WebAssembly";
    window.ForgeEyeReady=true;window.ForgeEyeState=state;window.ForgeEyeWasm=state.wasm;
    setStatus(engine_version()+" · scene ready","success");setWorkspace("scene");setDirty(false);requestAnimationFrame(updateRuntimeStatus);
  }catch(error){console.error("[Forge Eye boot]",error);$("#rustBadge").textContent="Rust/WASM boot failed";$("#rustBadge").classList.add("is-error");setStatus(error?.message||String(error),"error");$("#viewportNotice").hidden=false;$("#viewportNotice").textContent="Forge Eye could not start. Check that the WebAssembly glue and .b64 binary are published in /forge-eye/pkg/.";window.ForgeEyeBootError=error?.stack||String(error)}
}
function updateRuntimeStatus(){if(!state.engine)return;const d=state.engine.diagnostics?.()||{};$("#rendererStatus").textContent=d.renderer||"WebGL";$("#perfStatus").textContent=(d.fps??0)+" FPS · "+(d.frameMs??0)+" ms";$("#sceneStatus").textContent="Scene v"+(state.scene?.schema_version||1)+" · "+Object.keys(state.scene?.objects||{}).length+" objects";requestAnimationFrame(updateRuntimeStatus)}
function coreCommand(command){if(!state.session)throw new Error("Rust core isn't ready.");const out=JSON.parse(state.session.execute_json(JSON.stringify(command)));state.scene=out.scene;return out}
function sceneObjects(){return Object.values(state.scene?.objects||{}).sort((a,b)=>a.id-b.id)}
function recordForRust(id){const rendererId=state.renderMap.get(Number(id));return rendererId?state.engine.entities.get(rendererId)||null:null}
function rustIdForRenderer(record){return Number(record?.components?.forgeEye?.rustId)||0}
function setRendererTransform(record,t){if(record&&t){record.entity.setLocalPosition(...t.position);record.entity.setLocalEulerAngles(...t.rotation);record.entity.setLocalScale(...t.scale)}}
function setRendererMaterial(record,m){
  if(!record||!m)return;
  const previous=state.engine.selectedId;
  try{state.engine.selectedId=record.id;state.engine.applyMaterial({color:m.base_color.slice(0,3),metalness:m.metalness,roughness:m.roughness,opacity:m.opacity})}
  finally{state.engine.selectedId=previous}
  record.components.material={color:m.base_color.slice(0,3),metalness:m.metalness,roughness:m.roughness,opacity:m.opacity}
}
function removeRendererObject(rustId){const rendererId=state.renderMap.get(Number(rustId));if(!rendererId)return;const record=state.engine.entities.get(rendererId);if(record){state.engine.removePhysics?.(rendererId);record.entity.destroy();state.engine.entities.delete(rendererId);if(state.engine.selectedId===rendererId)state.engine.selectedId=null}state.renderMap.delete(Number(rustId))}
function addRendererObject(object){
  let record;
  if(object.kind?.type==="mesh"&&object.mesh)record=state.engine.createMeshFromData(object.mesh);
  else{const kind=object.kind?.primitive||"cube",rendererKind=kind==="cube"?"box":kind;if(["box","sphere","cylinder","plane","capsule"].includes(rendererKind))record=state.engine.primitive(rendererKind,object.name);else record=state.engine.primitive("box",object.name)}
  record.name=object.name;record.entity.name=object.name;record.components.forgeEye={rustId:Number(object.id)};
  state.renderMap.set(Number(object.id),record.id);applyObjectToRenderer(object,record);return record
}
function applyObjectToRenderer(object,record){
  if(!record||!object)return;record.name=object.name;record.entity.name=object.name;setRendererTransform(record,object.transform);record.entity.enabled=object.visible!==false;
  if(object.kind?.type!=="mesh"&&object.material)setRendererMaterial(record,object.material);
  record.components.forgeEye={...(record.components.forgeEye||{}),rustId:Number(object.id),objectKind:object.kind?.type==="mesh"?"mesh":object.kind?.primitive||"primitive",meshSignature:object.mesh?String(object.mesh.diagnostics?.vertex_count)+":"+String(object.mesh.diagnostics?.triangle_count):"primitive"};
  record.components.diagnostics=object.mesh?.diagnostics||record.components.diagnostics;
  state.engine.keyframes.set(record.id,(object.keyframes||[]).map(key=>({time:key.frame/(state.scene.timeline.fps||24),p:[...key.transform.position],r:[...key.transform.rotation],s:[...key.transform.scale],interpolation:key.interpolation||"ease"})));
}
function syncSceneToRenderer(){
  const objects=sceneObjects(),valid=new Set(objects.map(o=>Number(o.id)));
  for(const id of [...state.renderMap.keys()])if(!valid.has(id))removeRendererObject(id);
  for(const obj of objects){let r=recordForRust(obj.id);const signature=obj.mesh?String(obj.mesh.diagnostics?.vertex_count)+":"+String(obj.mesh.diagnostics?.triangle_count):"primitive";
    if(r&&obj.mesh&&r.components?.forgeEye?.meshSignature!==signature){removeRendererObject(obj.id);r=null}
    if(!r)r=addRendererObject(obj);else applyObjectToRenderer(obj,r);
  }
  const selected=state.scene.selected_id==null?null:recordForRust(state.scene.selected_id);state.syncingSelection=true;try{state.engine.select(selected?.id||null)}finally{state.syncingSelection=false}
  refreshAll();
}
async function runCore(command,{dirty=true}={}){
  const out=coreCommand(command),type=command.type;
  if(["create_primitive","duplicate_object","delete_object","spin_profile","extrude_silhouette","build_visual_hull"].includes(type))syncSceneToRenderer();
  else if(type==="evaluate_frame"){
    for(const obj of sceneObjects()){const r=recordForRust(obj.id);if(r){setRendererTransform(r,obj.transform);r.entity.enabled=obj.visible!==false;state.engine.keyframes.set(r.id,(obj.keyframes||[]).map(k=>({time:k.frame/(state.scene.timeline.fps||24),p:[...k.transform.position],r:[...k.transform.rotation],s:[...k.transform.scale],interpolation:k.interpolation||"ease"})))}}
    refreshInspector();refreshAnimation()
  }else if(type==="select"){
    const r=command.id==null?null:recordForRust(command.id);state.syncingSelection=true;try{state.engine.select(r?.id||null)}finally{state.syncingSelection=false}refreshAll()
  }else{
    const obj=command.id==null?selectedObject():state.scene.objects[String(command.id)],r=obj?recordForRust(obj.id):null;
    if(r){
      if(type==="set_transform")setRendererTransform(r,obj.transform);
      else if(type==="set_material")setRendererMaterial(r,obj.material);
      else if(type==="set_visibility")r.entity.enabled=obj.visible!==false;
      else if(type==="insert_keyframe")state.engine.keyframes.set(r.id,(obj.keyframes||[]).map(k=>({time:k.frame/(state.scene.timeline.fps||24),p:[...k.transform.position],r:[...k.transform.rotation],s:[...k.transform.scale],interpolation:k.interpolation||"ease"})));
    }
    refreshInspector();refreshAnimation();refreshHierarchy()
  }
  if(dirty)setDirty(true);refreshHistoryButtons();return out
}
function attachRendererEvents(){window.addEventListener("forge-selection",event=>{if(state.syncingSelection)return;const id=rustIdForRenderer(event.detail||state.engine.selected());if(!id)return;try{coreCommand({type:"select",id});refreshAll()}catch(error){console.error(error)}})}
function refreshHistoryButtons(){$("#undoBtn").disabled=!state.session?.can_undo();$("#redoBtn").disabled=!state.session?.can_redo()}
function refreshHierarchy(){
  const list=$("#objectList"),filter=$("#objectSearch").value.trim().toLowerCase(),objects=sceneObjects();list.replaceChildren();
  for(const obj of objects){if(filter&&!(obj.name+" "+(obj.kind?.primitive||"mesh")).toLowerCase().includes(filter))continue;
    const button=document.createElement("button");button.className="object-row"+(obj.id===state.scene.selected_id?" is-selected":"");button.type="button";
    const glyph=document.createElement("span");glyph.className="object-glyph";glyph.textContent=obj.kind?.type==="mesh"?"◇":(primitiveGlyph[obj.kind?.primitive]||"◇");
    const name=document.createElement("span");name.className="object-name";name.textContent=obj.name;
    const type=document.createElement("span");type.className="object-type";type.textContent=obj.kind?.type==="mesh"?"MESH":(obj.kind?.primitive||"PRIM").toUpperCase();
    button.append(glyph,name,type);button.addEventListener("click",()=>void runCore({type:"select",id:obj.id},{dirty:false}));list.append(button)
  }
  $("#objectCount").textContent=objects.length+" OBJECT"+(objects.length===1?"":"S");
  const selected=selectedObject();$("#duplicateBtn").disabled=!selected;$("#deleteBtn").disabled=!selected;
  $("#assetCount").textContent=String(state.externalAssets.length+Object.values(state.references).filter(Boolean).length);$("#assetMiniList").replaceChildren();
  const assets=[...Object.values(state.references).filter(Boolean).map(r=>({name:r.name,type:"IMAGE"})),...state.externalAssets];
  if(!assets.length){const empty=document.createElement("div");empty.className="empty-mini";empty.textContent="Imported images and meshes appear here.";$("#assetMiniList").append(empty)}
  for(const asset of assets){const row=document.createElement("div");row.className="asset-mini-row";const icon=document.createElement("span");icon.className="asset-mini-icon";icon.textContent=asset.type==="IMAGE"?"▧":"◇";const name=document.createElement("span");name.textContent=asset.name;row.append(icon,name);$("#assetMiniList").append(row)}
}
function selectedObject(){const id=state.scene?.selected_id;return id==null?null:state.scene.objects[String(id)]||null}
function refreshInspector(){
  const obj=selectedObject();$("#inspectorEmpty").hidden=!!obj;$("#inspectorForm").hidden=!obj;$("#inspectorKind").textContent=obj?(obj.kind?.type==="mesh"?"GENERATED MESH":(obj.kind?.primitive||"OBJECT").toUpperCase()):"NO SELECTION";
  $("#duplicateInspector").disabled=!obj;$("#deleteInspector").disabled=!obj;if(!obj)return;
  state.syncingForm=true;$("#objectName").value=obj.name;const t=obj.transform;
  [["px",t.position[0]],["py",t.position[1]],["pz",t.position[2]],["rx",t.rotation[0]],["ry",t.rotation[1]],["rz",t.rotation[2]],["sx",t.scale[0]],["sy",t.scale[1]],["sz",t.scale[2]]].forEach(([id,v])=>$("#"+id).value=String(Number(v.toFixed(4))));
  const m=obj.material||{base_color:[.32,.62,.76,1],metalness:.05,roughness:.65,opacity:1};$("#materialColor").value=hexOf(m.base_color);$("#materialHex").value=hexOf(m.base_color);
  $("#metalness").value=String(m.metalness);$("#roughness").value=String(m.roughness);$("#materialOpacity").value=String(m.opacity);$("#metalnessValue").textContent=Number(m.metalness).toFixed(2);$("#roughnessValue").textContent=Number(m.roughness).toFixed(2);$("#opacityValue").textContent=Number(m.opacity).toFixed(2);
  $("#objectVisible").checked=obj.visible!==false;$("#transformAutoKey").checked=state.scene.timeline.auto_key;
  const d=obj.mesh?.diagnostics;$("#geometryInfo").textContent=d?d.method+" · "+d.vertex_count+" vertices · "+d.triangle_count+" triangles":"Primitive geometry · meters";
  $("#meshDiagnostics").textContent=d?d.method+" · "+d.vertex_count+" verts · "+d.triangle_count+" tris · bounds "+d.bounds_min.map(v=>v.toFixed(3)).join(", ")+" → "+d.bounds_max.map(v=>v.toFixed(3)).join(", "):"Select a generated mesh to inspect its diagnostics.";
  state.syncingForm=false
}
function refreshAll(){refreshHierarchy();refreshInspector();refreshAnimation();refreshReferences();refreshHistoryButtons()}
function setWorkspace(name){
  if(!["scene","spin","image","animation","assets"].includes(name))return;state.workspace=name;
  $$("[data-workspace]").forEach(b=>{const active=b.dataset.workspace===name;b.classList.toggle("is-active",active);b.setAttribute("aria-selected",String(active))});
  $$("[data-workspace-panel]").forEach(p=>{p.hidden=p.dataset.workspacePanel!==name;p.classList.toggle("is-active",p.dataset.workspacePanel===name)});
  const titles={scene:["WORKSPACE 01","Scene & Modeling"],spin:["WORKSPACE 02","Spin / Lathe"],image:["WORKSPACE 03","Image Model"],animation:["WORKSPACE 04","Animation"],assets:["WORKSPACE 05","Assets & Export"]};
  $("#shelfEyebrow").textContent=titles[name][0];$("#shelfTitle").textContent=titles[name][1];$("#shelfStatus").textContent=state.wasm?engine_version():"Waiting for Rust core";
  if(name==="animation")refreshAnimation();if(name==="image")refreshReferences();if(name==="spin")drawProfile();closeMobileDrawers()
}
function openMobilePanel(name){
  closeMobileDrawers();if(name==="scene"){$("#leftDock").classList.add("is-open");$('[data-mobile-panel="scene"]').classList.add("is-active")}
  else if(name==="inspect"){$("#rightDock").classList.add("is-open");$('[data-mobile-panel="inspect"]').classList.add("is-active")}
  else if(name==="references"){setWorkspace("image");$("#rightDock").classList.add("is-open");$('[data-mobile-panel="references"]').classList.add("is-active")}
  else if(name==="animation"){setWorkspace("animation");$('[data-mobile-panel="animation"]').classList.add("is-active")}
  else if(name==="tools"){setWorkspace("spin");$('[data-mobile-panel="tools"]').classList.add("is-active")}
  $("#drawerScrim").hidden=!["scene","inspect","references"].includes(name)
}
function closeMobileDrawers(){$("#leftDock").classList.remove("is-open");$("#rightDock").classList.remove("is-open");$("#drawerScrim").hidden=true;$$("[data-mobile-panel]").forEach(b=>b.classList.remove("is-active"))}
async function applyInspectorTransform(){
  const obj=selectedObject();if(!obj)return;
  const transform={position:["px","py","pz"].map(id=>clamp($("#"+id).value,-10000,10000,0)),rotation:["rx","ry","rz"].map(id=>clamp($("#"+id).value,-10000,10000,0)),scale:["sx","sy","sz"].map(id=>clamp($("#"+id).value,.0001,10000,1))};
  return runCore({type:"set_transform",id:obj.id,transform,auto_key:$("#transformAutoKey").checked||state.scene.timeline.auto_key})
}
function applyReferenceStyle(record,opacity){
  const pc=state.pc,walk=e=>{for(const instance of(e.render?.meshInstances||[])){const m=instance.material?.clone?.();if(!m)continue;m.opacity=opacity;m.blendType=opacity<.999?pc.BLEND_NORMAL:pc.BLEND_NONE;m.depthWrite=opacity>=.999;m.cull=pc.CULLFACE_NONE;m.update();instance.material=m}for(const child of e.children||[])walk(child)};walk(record.entity)
}
async function createReference(file,axis,widthKnown){
  if(!file?.type.startsWith("image/"))throw new Error("Choose a PNG, JPEG, WebP or AVIF image.");
  const dataUrl=await fileToDataUrl(file),img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("Could not decode reference image."));img.src=dataUrl});
  const width=clamp(widthKnown,.01,10000,3),aspect=img.naturalWidth/Math.max(1,img.naturalHeight),height=width/aspect,old=state.references[axis];if(old)removeReference(old);
  const result=await state.engine.importFile(file);if(result.type!=="image"||!result.record)throw new Error("Renderer did not produce an image plane.");
  const record=result.record;record.components.asset={...(record.components.asset||{}),name:file.name,type:"image",width:img.naturalWidth,height:img.naturalHeight,sourceDataUrl:dataUrl};
  record.components.reference={axis,width,height,aspect,opacity:Number($("#referenceOpacity").value)||.45,imageDataUrl:dataUrl,outline:[],visible:true};
  const entity=record.entity;
  if(axis==="front"){entity.setLocalEulerAngles(90,0,0);entity.setLocalPosition(0,height/2,.04);entity.setLocalScale(width,1,height)}
  else if(axis==="side"){entity.setLocalEulerAngles(90,90,0);entity.setLocalPosition(.04,height/2,0);entity.setLocalScale(width,1,height)}
  else{entity.setLocalEulerAngles(0,0,0);entity.setLocalPosition(0,.04,0);entity.setLocalScale(width,1,height)}
  applyReferenceStyle(record,record.components.reference.opacity);
  state.references[axis]={id:record.id,axis,name:file.name,dataUrl,width,height,aspect,opacity:record.components.reference.opacity,outline:[],visible:true};
  state.engine.select(record.id);state.referenceView=axis;$("#referenceView").value=axis;$("#referenceWidth").value=String(width);
  refreshReferences();refreshHierarchy();setDirty(true);setStatus("Loaded "+axis+" reference · "+width.toFixed(2)+" m","success");return state.references[axis]
}
function removeReference(ref){
  const r=state.engine.entities.get(ref.id);if(r){state.engine.removePhysics?.(r.id);r.entity.destroy();state.engine.entities.delete(r.id)}
  if(state.engine.selectedId===ref.id)state.engine.selectedId=null
}
function activeReference(){return state.references[state.referenceView]||null}
function refreshReferences(){
  const ref=activeReference();$("#referenceFileName").textContent=ref?.name||"No reference image loaded";
  $("#referenceDimensions").textContent=ref?ref.width.toFixed(3)+" m × "+ref.height.toFixed(3)+" m · "+ref.axis.toUpperCase()+" view":"Import a front, side, or top view.";
  $("#referenceOpacityValue").value=Math.round((ref?.opacity??.45)*100)+"%";$("#referenceOpacity").value=String(ref?.opacity??.45);$("#referenceOutlineStatus").textContent=(ref?.outline?.length||0)+" outline points";
  const box=$("#referenceThumbnail");box.replaceChildren();if(ref?.dataUrl){const img=document.createElement("img");img.src=ref.dataUrl;img.alt=ref.name;box.append(img)}else{const span=document.createElement("span");span.textContent="NO IMAGE";box.append(span)}
}
function fitContain(iw,ih,w,h){const scale=Math.min(w/iw,h/ih),ww=iw*scale,hh=ih*scale;return{x:(w-ww)/2,y:(h-hh)/2,w:ww,h:hh}}
function traceDraw(){
  const t=state.trace,c=$("#traceCanvas");if(!t||!c)return;const ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.fillStyle="#0a1219";ctx.fillRect(0,0,w,h);
  const rect=fitContain(t.image.naturalWidth||1,t.image.naturalHeight||1,w,h);state.traceImageRect=rect;ctx.drawImage(t.image,rect.x,rect.y,rect.w,rect.h);
  const coords=t.points.map(p=>[rect.x+p[0]*rect.w,rect.y+p[1]*rect.h]);
  if(coords.length){ctx.strokeStyle="#67d5fb";ctx.lineWidth=2.3;ctx.lineJoin="round";ctx.beginPath();coords.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(t.closed)ctx.closePath();ctx.stroke();coords.forEach(([x,y],i)=>{ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=i===0?"#fff":"#7ce1ff";ctx.fill()})}
  $("#tracePointCount").textContent=t.points.length+" points"+(t.closed?" · closed":"")
}
async function openTrace(){const ref=activeReference();if(!ref){toast("Import a reference image for this view first.","error");return}const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error("Reference image didn't load"));img.src=ref.dataUrl});state.trace={ref,image:img,points:(ref.outline||[]).map(p=>[...p]),closed:false,dragIndex:-1};$("#traceSubtitle").textContent=ref.axis.toUpperCase()+" PROJECTION · "+ref.name;$("#traceStatus").textContent=ref.outline?.length?"Saved outline loaded. Drag points or tap along the edge.":"Trace the outer boundary in one direction.";$("#traceDialog").showModal();traceDraw()}
function tracePoint(event){const r=$("#traceCanvas").getBoundingClientRect(),c=$("#traceCanvas"),fit=state.traceImageRect,x=(event.clientX-r.left)*c.width/r.width,y=(event.clientY-r.top)*c.height/r.height;if(x<fit.x||x>fit.x+fit.w||y<fit.y||y>fit.y+fit.h)return null;return[(x-fit.x)/fit.w,(y-fit.y)/fit.h]}
function traceDown(e){
  if(!state.trace)return;e.preventDefault();const p=tracePoint(e);if(!p)return;const fit=state.traceImageRect,c=$("#traceCanvas");let best=14,ix=-1;
  state.trace.points.forEach((v,i)=>{const d=Math.hypot((v[0]-p[0])*fit.w,(v[1]-p[1])*fit.h);if(d<best){best=d;ix=i}});
  if(ix>=0){state.trace.dragIndex=ix;try{c.setPointerCapture(e.pointerId)}catch{}return}
  if(state.trace.points.length>=512){$("#traceStatus").textContent="Limit is 512 points.";return}
  state.trace.points.push(p);state.trace.closed=false;traceDraw()
}
function traceMove(e){const t=state.trace;if(!t||t.dragIndex<0)return;const p=tracePoint(e);if(p){t.points[t.dragIndex]=p;t.closed=false;traceDraw()}}
function traceUp(){if(state.trace)state.trace.dragIndex=-1}
function saveTrace(){
  const t=state.trace;if(!t)return;if(t.points.length<3){$("#traceStatus").textContent="At least three points are required.";return}
  try{validate_contour_json(JSON.stringify(t.points))}catch(error){$("#traceStatus").textContent=String(error);return}
  t.ref.outline=t.points.map(p=>[...p]);const record=state.engine.entities.get(t.ref.id);if(record?.components?.reference)record.components.reference.outline=t.ref.outline;
  $("#traceStatus").textContent="Saved "+t.ref.axis+" outline · "+t.ref.outline.length+" points.";refreshReferences();setDirty(true);toast("Reference outline validated by Rust.","success")
}
function buildFromOutline(){
  const ref=activeReference();if(!ref?.outline||ref.outline.length<3){toast("Trace and save an outline for this view first.","error");return}
  return runCore({type:"extrude_silhouette",request:{name:ref.name.replace(/\.[^.]+$/,"")+" — Silhouette Blockout",contour:ref.outline,axis:ref.axis,width:ref.width,height:ref.height,depth:clamp($("#hullDepth").value,.01,10000,.3),color:[.32,.62,.76,1]}})
}
function buildHull(){
  const front=state.references.front,side=state.references.side,top=state.references.top;
  if(!front?.outline||front.outline.length<3||!side?.outline||side.outline.length<3){$("#hullResult").dataset.state="error";$("#hullResult").textContent="Required: saved Front and Side outlines.";return}
  const width=clamp($("#hullWidth").value,.01,10000,front.width),height=clamp($("#hullHeight").value,.01,10000,front.height),depth=clamp($("#hullDepth").value,.01,10000,side.width);
  const mismatch=Math.abs(front.height-side.height)/Math.max(front.height,side.height,.01);
  if(mismatch>.05){$("#hullResult").dataset.state="error";$("#hullResult").textContent="Front/side heights differ by "+(mismatch*100).toFixed(1)+"%. Align the real-world scale first.";return}
  if(top?.outline?.length>=3){const wm=Math.abs(top.width-width)/Math.max(top.width,width,.01),dm=Math.abs(top.height-depth)/Math.max(top.height,depth,.01);if(wm>.05||dm>.05){$("#hullResult").dataset.state="error";$("#hullResult").textContent="Top reference width/depth doesn't match the front/side scale.";return}}
  const request={name:"Multi-view Visual Hull",front_contour:front.outline,side_contour:side.outline,top_contour:top?.outline?.length>=3?top.outline:undefined,width,height,depth,resolution:clamp($("#hullResolution").value,8,64,24),color:[.32,.62,.76,1]};
  return runCore({type:"build_visual_hull",request})
}
function drawProfile(){
  const c=$("#profileCanvas"),ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.fillStyle="#0b141c";ctx.fillRect(0,0,w,h);
  for(let i=0;i<=10;i++){const x=i*w/10,y=i*h/10;ctx.strokeStyle=i===5?"#3e728a":"#223643";ctx.lineWidth=i===5?1.5:1;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  ctx.strokeStyle="#b8cddd";ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(w*.5,0);ctx.lineTo(w*.5,h);ctx.stroke();ctx.setLineDash([]);
  if(state.profileImage?.complete&&state.profileImage.naturalWidth){ctx.save();ctx.globalAlpha=.25;ctx.drawImage(state.profileImage,0,0,w,h);ctx.restore()}
  const xy=state.profile.map(p=>[p[0]*w,p[1]*h]);if(xy.length){ctx.strokeStyle="#72d4f8";ctx.lineWidth=2.3;ctx.lineJoin="round";ctx.beginPath();xy.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();xy.forEach(([x,y],i)=>{ctx.beginPath();ctx.arc(x,y,4.5,0,Math.PI*2);ctx.fillStyle=i===0||i===xy.length-1?"#fff":"#86dfff";ctx.fill()})}
}
function profilePoint(e){const c=$("#profileCanvas"),r=c.getBoundingClientRect();return[clamp((e.clientX-r.left)/r.width,0,1,.5),clamp((e.clientY-r.top)/r.height,0,1,.5)]}
function saveProfileUndo(){state.profileUndo.push(state.profile.map(p=>[...p]));if(state.profileUndo.length>50)state.profileUndo.shift()}
function profileDown(e){const p=profilePoint(e),c=$("#profileCanvas");let index=-1,best=14;state.profile.forEach((v,i)=>{const d=Math.hypot((v[0]-p[0])*c.width,(v[1]-p[1])*c.height);if(d<best){best=d;index=i}});saveProfileUndo();if(index<0){if(state.profile.length>=256)return toast("Profile limit is 256 points.","error");state.profile.push(p);index=state.profile.length-1}state.profileDrag={index};try{c.setPointerCapture(e.pointerId)}catch{}drawProfile()}
function profileMove(e){if(!state.profileDrag)return;state.profile[state.profileDrag.index]=profilePoint(e);drawProfile()}
async function buildSpin(){
  const request={name:"Spin Profile Mesh",profile:state.profile,diameter:clamp($("#spinDiameter").value,.001,1000,.08),height:clamp($("#spinHeight").value,.001,1000,.25),segments:clamp($("#spinSegments").value,12,128,24),subdivision_level:clamp($("#spinSubdivision").value,0,3,2),smooth_shading:$("#spinSmooth").checked,color:[.32,.62,.76,1]};
  try{const out=await runCore({type:"spin_profile",request});const obj=state.scene.objects[String(out.result.id)];$("#spinResult").dataset.state="success";$("#spinResult").textContent="Built "+obj.mesh.diagnostics.vertex_count+" vertices · "+obj.mesh.diagnostics.triangle_count+" triangles · Rust";setWorkspace("scene");state.engine.frame();toast("Spin / Lathe mesh generated by Rust.","success")}catch(error){$("#spinResult").dataset.state="error";$("#spinResult").textContent=error?.message||String(error);toast(error?.message||String(error),"error")}
}
async function animationFrame(frame){const max=state.scene.timeline.end_frame||240;return runCore({type:"evaluate_frame",frame:clamp(Math.round(frame),0,max,0)},{dirty:false})}
function refreshAnimation(){
  if(!state.scene)return;const t=state.scene.timeline,frame=t.current_frame||0;
  $("#currentFrame").value=String(frame);$("#timelineFps").value=String(t.fps||24);$("#autoKeyToggle").checked=t.auto_key;$("#playTimeline").setAttribute("aria-pressed",String(state.playing));$("#playTimeline").textContent=state.playing?"Ⅱ":"▶";$("#loopToggle").classList.toggle("is-active",t.looping);$("#loopToggle").setAttribute("aria-pressed",String(t.looping));
  const rows=$("#dopeRows");rows.replaceChildren();const selected=selectedObject(),objects=selected?[selected]:sceneObjects();let total=0;
  for(const obj of objects){const keys=obj.keyframes||[];total+=keys.length;const row=document.createElement("div");row.className="dope-row";const name=document.createElement("div");name.className="dope-row-name";name.textContent="◆ "+obj.name;row.append(name);const lane=document.createElement("div");lane.className="dope-lane";
    keys.forEach(k=>{const b=document.createElement("button");b.className="dope-key";b.type="button";b.style.left=(clamp(k.frame/Math.max(1,t.end_frame),0,1,0)*100)+"%";b.title="Frame "+k.frame;b.addEventListener("click",()=>void animationFrame(k.frame));lane.append(b)});
    lane.addEventListener("click",e=>{if(e.target.closest(".dope-key"))return;const r=lane.getBoundingClientRect();void animationFrame((e.clientX-r.left)/r.width*t.end_frame)});row.append(lane);rows.append(row)
  }
  if(!objects.length){const empty=document.createElement("div");empty.className="dope-empty";empty.textContent="Create or select an object, then insert a keyframe.";rows.append(empty)}
  const ruler=$("#dopeRuler");ruler.replaceChildren();for(let i=0;i<=10;i++){const span=document.createElement("span");span.textContent=String(Math.round(t.end_frame*i/10));ruler.append(span)}
  $("#animationStatus").textContent=(t.fps||24)+" FPS · "+total+" keyframes · frame "+frame;if(state.animationView==="graph")drawGraph()
}
function setAnimationView(name){state.animationView=name==="graph"?"graph":"dope";$("#dopePane").hidden=state.animationView!=="dope";$("#graphPane").hidden=state.animationView!=="graph";$$("[data-animation-view]").forEach(b=>{const on=b.dataset.animationView===state.animationView;b.classList.toggle("is-active",on);b.setAttribute("aria-selected",String(on))});refreshAnimation()}
function graphDescriptor(){const p=state.graphChannel.split(":");return{group:p[0],axis:Number(p[1]),label:({position:"Location",rotation:"Rotation",scale:"Scale"})[p[0]]+" "+["X","Y","Z"][Number(p[1])]}}
function graphKeyValues(){const d=graphDescriptor();return(selectedObject()?.keyframes||[]).map(key=>({key,frame:key.frame,value:key.transform[d.group][d.axis]}))}
function drawGraph(){
  const c=$("#graphCanvas");if(!c||state.animationView!=="graph")return;const box=c.getBoundingClientRect();if(box.width<10||box.height<10)return;const dpr=Math.max(1,Math.min(2,devicePixelRatio||1));c.width=Math.round(box.width*dpr);c.height=Math.round(box.height*dpr);
  const ctx=c.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);const w=box.width,h=box.height,pad={left:42,right:12,top:10,bottom:23},pw=w-pad.left-pad.right,ph=h-pad.top-pad.bottom;ctx.fillStyle="#0a1219";ctx.fillRect(0,0,w,h);
  const keys=graphKeyValues(),frameMax=Math.max(1,state.scene.timeline.end_frame),values=keys.map(k=>k.value);let min=values.length?Math.min(...values):-1,max=values.length?Math.max(...values):1;
  if(max-min<.001){const margin=Math.max(.5,Math.abs(max)*.2);min-=margin;max+=margin}else{const margin=(max-min)*.15;min-=margin;max+=margin}
  const x=f=>pad.left+clamp(f/frameMax,0,1,0)*pw,y=v=>pad.top+(1-clamp((v-min)/(max-min),0,1,.5))*ph;ctx.font="9px ui-monospace,monospace";ctx.textBaseline="middle";ctx.textAlign="center";
  for(let i=0;i<=10;i++){const xx=pad.left+pw*i/10;ctx.strokeStyle="#253744";ctx.beginPath();ctx.moveTo(xx,pad.top);ctx.lineTo(xx,pad.top+ph);ctx.stroke();ctx.fillStyle="#7d96a7";ctx.fillText(String(Math.round(frameMax*i/10)),xx,h-10)}
  ctx.textAlign="right";for(let i=0;i<=4;i++){const yy=pad.top+ph*i/4;ctx.strokeStyle="#253744";ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(pad.left+pw,yy);ctx.stroke();ctx.fillStyle="#8599a8";ctx.fillText((max-(max-min)*i/4).toFixed(2),pad.left-5,yy)}
  if(keys.length){ctx.strokeStyle="#78cdee";ctx.lineWidth=2;ctx.beginPath();keys.forEach((k,i)=>i?ctx.lineTo(x(k.frame),y(k.value)):ctx.moveTo(x(k.frame),y(k.value)));ctx.stroke();keys.forEach(k=>{ctx.save();ctx.translate(x(k.frame),y(k.value));ctx.rotate(Math.PI/4);ctx.fillStyle="#a1e2fb";ctx.fillRect(-4,-4,8,8);ctx.restore()})}else{ctx.fillStyle="#8297a7";ctx.textAlign="center";ctx.fillText("Insert a keyframe to plot this channel",pad.left+pw/2,pad.top+ph/2)}
  const px=x(state.scene.timeline.current_frame);ctx.strokeStyle="#e0a16b";ctx.beginPath();ctx.moveTo(px,pad.top);ctx.lineTo(px,pad.top+ph);ctx.stroke();c.__metrics={x,y,min,max,pad,pw,ph,frameMax}
}
async function graphDown(e){
  const c=$("#graphCanvas"),m=c.__metrics;if(!m)return;const rect=c.getBoundingClientRect(),px=e.clientX-rect.left,py=e.clientY-rect.top,keys=graphKeyValues();let chosen=null,best=14;
  keys.forEach(k=>{const d=Math.hypot(m.x(k.frame)-px,m.y(k.value)-py);if(d<best){best=d;chosen=k}});
  if(!chosen){void animationFrame(Math.round(clamp((px-m.pad.left)/m.pw,0,1,0)*m.frameMax));return}
  e.preventDefault();const desc=graphDescriptor(),frame=chosen.frame;let moving=false;const move=async event=>{const y=event.clientY-rect.top,v=m.min+clamp(1-(y-m.pad.top)/m.ph,0,1,.5)*(m.max-m.min);moving=true;try{await runCore({type:"evaluate_frame",frame},{dirty:false});const obj=selectedObject();if(!obj)return;const t=structuredClone(obj.transform);t[desc.group][desc.axis]=v;await runCore({type:"set_transform",id:obj.id,transform:t,auto_key:true},{dirty:true})}catch(err){setStatus(err.message,"error")}};
  let running=false;const safeMove=async event=>{if(running)return;running=true;await move(event);running=false};const up=()=>{document.removeEventListener("pointermove",safeMove);document.removeEventListener("pointerup",up);document.removeEventListener("pointercancel",up);if(moving){refreshAnimation();setDirty(true)}};
  document.addEventListener("pointermove",safeMove);document.addEventListener("pointerup",up,{once:true});document.addEventListener("pointercancel",up,{once:true})
}
function setTimelinePlayback(enabled){
  state.playing=enabled;void runCore({type:"set_playing",playing:enabled},{dirty:false});$("#playTimeline").setAttribute("aria-pressed",String(enabled));$("#playTimeline").textContent=enabled?"Ⅱ":"▶";
  if(enabled){state.lastFrameAt=performance.now();state.raf=requestAnimationFrame(playTick)}else if(state.raf)cancelAnimationFrame(state.raf)
}
function playTick(now){
  if(!state.playing)return;const t=state.scene.timeline,step=1000/(t.fps||24);
  if(now-state.lastFrameAt>=step){state.lastFrameAt=now;let frame=t.current_frame+1;if(frame>t.end_frame)frame=t.looping?t.start_frame:t.end_frame;void animationFrame(frame);if(!t.looping&&frame>=t.end_frame){state.playing=false;void runCore({type:"set_playing",playing:false},{dirty:false});$("#playTimeline").textContent="▶";return}}
  state.raf=requestAnimationFrame(playTick)
}
async function saveProject(){
  const project={format:"forge-eye-project",schema_version:1,name:$("#projectName").value.trim()||"Untitled Project",saved_at:new Date().toISOString(),scene:JSON.parse(state.session.scene_json()),references:state.references,externalAssets:state.externalAssets,workspace:state.workspace,spinProfile:state.profile};
  downloadText(safeFilename(project.name)+".forge-eye.json",JSON.stringify(project,null,2));setDirty(false);setStatus("Project file downloaded","success");toast("Saved Forge Eye project.","success")
}
async function openProjectFile(file){
  const data=JSON.parse(await file.text());if(data.format!=="forge-eye-project"||!data.scene?.objects)throw new Error("This isn't a Forge Eye project file.");
  state.session.load_scene_json(JSON.stringify(data.scene));state.scene=JSON.parse(state.session.scene_json());
  for(const ref of Object.values(state.references))if(ref)removeReference(ref);state.references={front:null,side:null,top:null};state.externalAssets=data.externalAssets||[];for(const id of [...state.renderMap.keys()])removeRendererObject(id);
  for(const [axis,ref] of Object.entries(data.references||{})){if(!ref?.dataUrl)continue;const file=await dataUrlToFile(ref.dataUrl,ref.name||axis+".png");await createReference(file,axis,ref.width);const current=state.references[axis];current.outline=(ref.outline||[]).map(p=>[...p]);const record=state.engine.entities.get(current.id);if(record?.components?.reference)record.components.reference.outline=current.outline}
  $("#projectName").value=data.name||"Untitled Project";state.profile=(data.spinProfile||defaultProfile).map(p=>[...p]);syncSceneToRenderer();setWorkspace(data.workspace||"scene");drawProfile();refreshReferences();setDirty(false);setStatus("Project loaded and validated","success")
}
function exportObj(){
  const obj=selectedObject();if(!obj?.mesh){toast("Select a Rust-generated mesh before exporting OBJ.","error");return}
  const mesh=obj.mesh,lines=["o "+obj.name.replace(/\s+/g,"_")];for(const p of mesh.vertices)lines.push("v "+p[0]+" "+p[1]+" "+p[2]);for(const n of mesh.normals)lines.push("vn "+n[0]+" "+n[1]+" "+n[2]);
  for(let i=0;i<mesh.indices.length;i+=3){const a=mesh.indices[i]+1,b=mesh.indices[i+1]+1,c=mesh.indices[i+2]+1;lines.push("f "+a+"//"+a+" "+b+"//"+b+" "+c+"//"+c)}
  downloadText(safeFilename(obj.name)+".obj",lines.join("\n"),"text/plain");toast("Exported selected Rust mesh as OBJ.","success")
}
async function importFiles(files){for(const file of files){try{if(file.type.startsWith("image/"))await createReference(file,state.referenceView,$("#referenceWidth").value);else if(/\.(glb|gltf)$/i.test(file.name)){const result=await state.engine.importFile(file);if(result.record)state.externalAssets.push({name:file.name,type:"MODEL",rendererId:result.record.id})}else state.externalAssets.push({name:file.name,type:"ASSET"})}catch(err){toast(err.message,"error")}}refreshHierarchy();refreshReferences();setDirty(true)}
function setTool(name){
  state.tool=name;const mapping={select:"toolSelect",translate:"toolMove",rotate:"toolRotate",scale:"toolScale"};
  for(const [tool,id] of Object.entries(mapping)){const on=tool===name;$("#"+id).classList.toggle("is-active",on);$("#"+id).setAttribute("aria-pressed",String(on))}
  state.engine.spatial?.setTool?.(name)
}
function bindEvents(){
  $$("[data-workspace]").forEach(b=>b.addEventListener("click",()=>setWorkspace(b.dataset.workspace)));
  $$("[data-mobile-panel]").forEach(b=>b.addEventListener("click",()=>openMobilePanel(b.dataset.mobilePanel)));
  $("#drawerScrim").addEventListener("click",closeMobileDrawers);$("#leftDockClose").addEventListener("click",closeMobileDrawers);$("#rightDockClose").addEventListener("click",closeMobileDrawers);
  $("#objectSearch").addEventListener("input",refreshHierarchy);
  $$("[data-create-primitive]").forEach(b=>b.addEventListener("click",()=>void runCore({type:"create_primitive",primitive:b.dataset.createPrimitive,name:b.dataset.createPrimitive[0].toUpperCase()+b.dataset.createPrimitive.slice(1)})));
  $("#duplicateBtn").addEventListener("click",()=>{const obj=selectedObject();if(obj)void runCore({type:"duplicate_object",id:obj.id})});$("#duplicateInspector").addEventListener("click",()=>$("#duplicateBtn").click());
  $("#deleteBtn").addEventListener("click",()=>{const obj=selectedObject();if(obj)void runCore({type:"delete_object",id:obj.id})});$("#deleteInspector").addEventListener("click",()=>$("#deleteBtn").click());
  $("#applyTransform").addEventListener("click",()=>void applyInspectorTransform());
  $("#transformAutoKey").addEventListener("change",()=>void runCore({type:"set_auto_key",enabled:$("#transformAutoKey").checked}));
  $("#applyMaterial").addEventListener("click",()=>{const o=selectedObject();if(!o)return;void runCore({type:"set_material",id:o.id,material:{base_color:color4($("#materialColor").value),metalness:clamp($("#metalness").value,0,1,.05),roughness:clamp($("#roughness").value,0,1,.55),opacity:clamp($("#materialOpacity").value,0,1,1)}})});
  $("#materialColor").addEventListener("input",()=>$("#materialHex").value=$("#materialColor").value.toUpperCase());
  [["metalness","metalnessValue"],["roughness","roughnessValue"],["materialOpacity","opacityValue"]].forEach(([i,o])=>$("#"+i).addEventListener("input",()=>$("#"+o).value=Number($("#"+i).value).toFixed(2)));
  $("#objectVisible").addEventListener("change",()=>{const o=selectedObject();if(o)void runCore({type:"set_visibility",id:o.id,visible:$("#objectVisible").checked})});
  $("#undoBtn").addEventListener("click",()=>{try{state.session.undo_json();state.scene=JSON.parse(state.session.scene_json());syncSceneToRenderer();setDirty(true)}catch(e){toast(e.message,"error")}});
  $("#redoBtn").addEventListener("click",()=>{try{state.session.redo_json();state.scene=JSON.parse(state.session.scene_json());syncSceneToRenderer();setDirty(true)}catch(e){toast(e.message,"error")}});
  $("#newProjectBtn").addEventListener("click",()=>{if(state.dirty&&!confirm("Discard unsaved changes?"))return;state.session=new ForgeEyeSession();state.scene=JSON.parse(state.session.scene_json());for(const r of Object.values(state.references))if(r)removeReference(r);state.references={front:null,side:null,top:null};state.externalAssets=[];state.renderMap.clear();$("#projectName").value="Untitled Project";syncSceneToRenderer();void runCore({type:"create_primitive",primitive:"cube",name:"Cube"},{dirty:false});setDirty(false);toast("New Forge Eye project created.","success")});
  $("#openProjectBtn").addEventListener("click",()=>$("#projectInput").click());$("#projectInput").addEventListener("change",e=>{const f=e.target.files?.[0];if(f)openProjectFile(f).catch(err=>toast(err.message,"error"));e.target.value=""});
  $("#saveProjectBtn").addEventListener("click",()=>void saveProject());$("#saveProjectInline").addEventListener("click",()=>void saveProject());$("#exportObj").addEventListener("click",exportObj);
  $("#assetImportButton").addEventListener("click",()=>$("#assetInput").click());$("#assetInput").addEventListener("change",e=>{void importFiles([...e.target.files]);e.target.value=""});
  $("#referenceInput").addEventListener("change",e=>{const f=e.target.files?.[0];if(f)createReference(f,state.referenceView,$("#referenceWidth").value).catch(err=>toast(err.message,"error"));e.target.value=""});$("#uploadReference").addEventListener("click",()=>$("#referenceInput").click());
  $("#profileReferenceInput").addEventListener("change",async e=>{const f=e.target.files?.[0];if(f){state.profileReference=await fileToDataUrl(f);const img=new Image();img.onload=()=>{state.profileImage=img;drawProfile()};img.src=state.profileReference}e.target.value=""});
  $("#traceReference").addEventListener("click",()=>openTrace().catch(err=>toast(err.message,"error")));$("#closeTrace").addEventListener("click",()=>$("#traceDialog").close());
  $("#traceCanvas").addEventListener("pointerdown",traceDown);$("#traceCanvas").addEventListener("pointermove",traceMove);$("#traceCanvas").addEventListener("pointerup",traceUp);$("#traceCanvas").addEventListener("pointercancel",traceUp);
  $("#traceUndo").addEventListener("click",()=>{if(state.trace){state.trace.points.pop();traceDraw()}});$("#traceClear").addEventListener("click",()=>{if(state.trace){state.trace.points=[];traceDraw()}});
  $("#saveTraceOutline").addEventListener("click",saveTrace);$("#saveOutline").addEventListener("click",saveTrace);$("#buildExtrusion").addEventListener("click",()=>void buildFromOutline());$("#buildVisualHull").addEventListener("click",()=>void buildHull());
  $("#referenceView").addEventListener("change",()=>{state.referenceView=$("#referenceView").value;$("#referenceWidth").value=String(state.references[state.referenceView]?.width||3);refreshReferences()});
  $("#referenceOpacity").addEventListener("input",()=>{const r=activeReference();if(r){r.opacity=Number($("#referenceOpacity").value);const record=state.engine.entities.get(r.id);if(record)applyReferenceStyle(record,r.opacity);$("#referenceOpacityValue").value=Math.round(r.opacity*100)+"%";setDirty(true)}});
  $("#hideReference").addEventListener("click",()=>{const ref=activeReference();if(!ref)return;ref.visible=!ref.visible;const r=state.engine.entities.get(ref.id);if(r)r.entity.enabled=ref.visible;setDirty(true)});
  $("#profileCanvas").addEventListener("pointerdown",profileDown);$("#profileCanvas").addEventListener("pointermove",profileMove);$("#profileCanvas").addEventListener("pointerup",()=>{state.profileDrag=null});$("#profileCanvas").addEventListener("pointercancel",()=>{state.profileDrag=null});
  $("#profileReset").addEventListener("click",()=>{saveProfileUndo();state.profile=defaultProfile.map(p=>[...p]);drawProfile()});$("#profileUndo").addEventListener("click",()=>{const p=state.profileUndo.pop();if(p)state.profile=p;drawProfile()});$("#profileImportRef").addEventListener("click",()=>$("#profileReferenceInput").click());
  $("#spinSubdivision").addEventListener("input",()=>$("#spinSubdivValue").textContent=$("#spinSubdivision").value);$("#buildSpin").addEventListener("click",()=>void buildSpin());
  $$("[data-view]").forEach(b=>b.addEventListener("click",()=>{state.engine.setView(b.dataset.view);$$("[data-view]").forEach(x=>{const on=x===b;x.classList.toggle("is-active",on);x.setAttribute("aria-pressed",String(on))});$("#viewportModeLabel").textContent=b.dataset.view.toUpperCase()+" · "+(b.dataset.view==="perspective"?"LIT":"ORTHOGRAPHIC")}));
  $("#gridToggle").addEventListener("click",()=>{const visible=window.ForgeViewport?.toggleGrid?.();$("#gridToggle").classList.toggle("is-active",visible);$("#gridToggle").setAttribute("aria-pressed",String(visible))});
  $("#focusView").addEventListener("click",()=>state.engine.frame());$("#fullscreenView").addEventListener("click",()=>{const target=$(".viewport-wrap");if(document.fullscreenElement)document.exitFullscreen?.();else target.requestFullscreen?.()});
  $("#shelfCollapse").addEventListener("click",()=>$(".tool-shelf").classList.toggle("is-collapsed"));
  $("#toolSelect").addEventListener("click",()=>setTool("select"));$("#toolMove").addEventListener("click",()=>setTool("translate"));$("#toolRotate").addEventListener("click",()=>setTool("rotate"));$("#toolScale").addEventListener("click",()=>setTool("scale"));
  $("#goStart").addEventListener("click",()=>void animationFrame(state.scene.timeline.start_frame));$("#goEnd").addEventListener("click",()=>void animationFrame(state.scene.timeline.end_frame));
  $("#currentFrame").addEventListener("change",()=>void animationFrame($("#currentFrame").value));
  $("#timelineFps").addEventListener("change",()=>{const t=state.scene.timeline;void runCore({type:"set_timeline",fps:clamp($("#timelineFps").value,1,240,24),start_frame:t.start_frame,end_frame:t.end_frame,looping:t.looping})});
  $("#autoKeyToggle").addEventListener("change",()=>void runCore({type:"set_auto_key",enabled:$("#autoKeyToggle").checked}));
  $("#loopToggle").addEventListener("click",()=>{const t=state.scene.timeline;void runCore({type:"set_timeline",fps:t.fps,start_frame:t.start_frame,end_frame:t.end_frame,looping:!t.looping})});
  $("#playTimeline").addEventListener("click",()=>setTimelinePlayback(!state.playing));
  $("#insertKey").addEventListener("click",()=>{const o=selectedObject();if(!o){toast("Select an object before adding a keyframe.","error");return}void runCore({type:"insert_keyframe",id:o.id,frame:state.scene.timeline.current_frame,interpolation:$("#keyInterpolation").value})});
  $$("[data-animation-view]").forEach(b=>b.addEventListener("click",()=>setAnimationView(b.dataset.animationView)));
  $("#graphChannel").addEventListener("change",e=>{state.graphChannel=e.target.value;drawGraph()});$("#graphCanvas").addEventListener("pointerdown",e=>void graphDown(e));
  $$("[data-focus-inspector]").forEach(b=>b.addEventListener("click",()=>openMobilePanel("inspect")));
  document.addEventListener("keydown",e=>{if(["INPUT","TEXTAREA","SELECT"].includes(e.target?.tagName)||e.target?.isContentEditable)return;
    if(e.key==="q")setTool("select");if(e.key==="w")setTool("translate");if(e.key==="e")setTool("rotate");if(e.key==="r")setTool("scale");
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();void saveProject()}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();$("#undoBtn").click()}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();$("#redoBtn").click()}
    if(e.key==="Delete"){const o=selectedObject();if(o)void runCore({type:"delete_object",id:o.id})}
    if(e.key==="f")state.engine.focus()
  });
  window.addEventListener("beforeunload",e=>{if(state.dirty){e.preventDefault();e.returnValue=""}})
}
function setTool(name){
  state.tool=name;const map={select:"toolSelect",translate:"toolMove",rotate:"toolRotate",scale:"toolScale"};
  for(const [key,id] of Object.entries(map)){const on=key===name;$("#"+id).classList.toggle("is-active",on);$("#"+id).setAttribute("aria-pressed",String(on))}
  state.engine.spatial?.setTool?.(name)
}
async function init(){bindEvents();$("#rustBadge").textContent="Starting Rust Core";await boot()}
init();
