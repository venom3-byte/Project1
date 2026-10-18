import { pc } from "./forge-engine.js";

const F = window.Forge;
const canvas = document.getElementById("viewport");
const GRID_METERS = 30;
const GRID_TEXTURE_SIZE = 1024;
const vec = (x=0,y=0,z=0) => new pc.Vec3(x,y,z);
const state = {
  gridVisible:true,
  gridEntities:[],
  helperRoot:null,
  ground:null,
  gridTexture:null,
  gridMaterial:null,
  plainMaterial:null,
  axisY:null,
  target:vec(0,1,0),
  yaw:0,
  pitch:0,
  distance:12,
  gesture:null,
  touches:new Map(),
  lastPinch:null,
  installed:false
};

function makeMaterial(rgb,{lighting=false,emissive=0.18}={}) {
  const m=new pc.StandardMaterial();
  m.diffuse=new pc.Color(rgb[0],rgb[1],rgb[2]);
  m.emissive=new pc.Color(rgb[0],rgb[1],rgb[2]);
  m.emissiveIntensity=emissive;
  m.useLighting=lighting;
  m.useMetalness=false;
  m.metalness=0;
  m.gloss=0.28;
  m.specular=new pc.Color(0,0,0);
  m.cull=pc.CULLFACE_NONE;
  m.update();
  return m;
}
function createGridTexture() {
  const size=GRID_TEXTURE_SIZE;
  const surface=document.createElement("canvas");
  surface.width=size;surface.height=size;
  const ctx=surface.getContext("2d");
  ctx.fillStyle="#0c131d";
  ctx.fillRect(0,0,size,size);

  // The ground plane is 30 x 30 world units: each subdivision represents 1 meter.
  const spacing=size/GRID_METERS;
  for(let i=0;i<=GRID_METERS;i++){
    const major=i%5===0;
    const p=Math.round(i*spacing)+0.5;
    ctx.strokeStyle=major?"#51677d":"#2b3a4c";
    ctx.lineWidth=major?2.5:1.35;
    ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,size);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,p);ctx.lineTo(size,p);ctx.stroke();
  }

  // World axes: X red, Z blue. The Y axis is a separate upright 3D primitive.
  const center=Math.round(size/2)+0.5;
  ctx.strokeStyle="#ed6872";ctx.lineWidth=4.5;
  ctx.beginPath();ctx.moveTo(center,0);ctx.lineTo(center,size);ctx.stroke();
  ctx.strokeStyle="#559cff";ctx.lineWidth=4.5;
  ctx.beginPath();ctx.moveTo(0,center);ctx.lineTo(size,center);ctx.stroke();
  ctx.fillStyle="#f3f7ff";ctx.beginPath();ctx.arc(center,center,5,0,Math.PI*2);ctx.fill();

  const texture=new pc.Texture(F.app.graphicsDevice,{
    width:size,height:size,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true
  });
  texture.setSource(surface);
  texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;
  texture.magFilter=pc.FILTER_LINEAR;
  texture.addressU=pc.ADDRESS_CLAMP_TO_EDGE;
  texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;
  return texture;
}
function createSolidTexture(color) {
  const surface=document.createElement("canvas");
  surface.width=surface.height=32;
  const ctx=surface.getContext("2d");
  ctx.fillStyle=color;
  ctx.fillRect(0,0,32,32);
  const texture=new pc.Texture(F.app.graphicsDevice,{
    width:32,height:32,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:false
  });
  texture.setSource(surface);
  texture.minFilter=pc.FILTER_LINEAR;
  texture.magFilter=pc.FILTER_LINEAR;
  texture.addressU=pc.ADDRESS_CLAMP_TO_EDGE;
  texture.addressV=pc.ADDRESS_CLAMP_TO_EDGE;
  return texture;
}
function createGridMaterials() {
  state.gridTexture=createGridTexture();
  state.gridMaterial=new pc.StandardMaterial();
  state.gridMaterial.diffuse=new pc.Color(1,1,1);
  state.gridMaterial.emissive=new pc.Color(1,1,1);
  state.gridMaterial.emissiveIntensity=1.1;
  state.gridMaterial.diffuseMap=state.gridTexture;
  state.gridMaterial.emissiveMap=state.gridTexture;
  state.gridMaterial.useLighting=false;
  state.gridMaterial.useMetalness=false;
  state.gridMaterial.metalness=0;
  state.gridMaterial.useTonemap=false;
  state.gridMaterial.gloss=0.25;
  state.gridMaterial.specular=new pc.Color(0,0,0);
  state.gridMaterial.update();

  state.plainMaterial=new pc.StandardMaterial();
  state.plainMaterial.diffuse=new pc.Color(0.045,0.057,0.075);
  state.plainMaterial.emissive=new pc.Color(0.035,0.045,0.06);
  state.plainMaterial.emissiveIntensity=0.35;
  state.plainMaterial.useLighting=true;
  state.plainMaterial.gloss=0.2;
  state.plainMaterial.update();
}
function createWorldGrid() {
  state.helperRoot=new pc.Entity("Forge Editor Helpers");
  F.root.addChild(state.helperRoot);

  state.ground=[...F.entities.values()].find(r=>r.name==="Ground"&&r.entity.render);
  createGridMaterials();
  if(state.ground){
    const plane=state.ground.entity;
    plane.render.layers=[pc.LAYERID_WORLD];
    plane.render.enabled=true;
    plane.setLocalScale(GRID_METERS,1,GRID_METERS);
    plane.setLocalPosition(0,-0.025,0);
    plane.render.material=state.gridMaterial;
    plane.render.castShadows=false;
    plane.render.receiveShadows=true;
    plane.render.frustumCulling=false;
  }

  // Real renderable geometry for the vertical world axis; it is intentionally not
  // part of the user's scene registry or serialized project.
  const axis=new pc.Entity("World axis Y — helper");
  state.helperRoot.addChild(axis);
  axis.addComponent("render",{type:"cylinder"});
  axis.setLocalPosition(0,2,0);
  axis.setLocalScale(0.045,4,0.045);
  axis.render.layers=[pc.LAYERID_WORLD];
  const axisTexture=createSolidTexture("#35d982");
  const axisMaterial=new pc.StandardMaterial();
  axisMaterial.diffuse=new pc.Color(1,1,1);
  axisMaterial.emissive=new pc.Color(1,1,1);
  axisMaterial.diffuseMap=axisTexture;
  axisMaterial.emissiveMap=axisTexture;
  axisMaterial.useLighting=false;
  axisMaterial.useMetalness=false;
  axisMaterial.useTonemap=false;
  axisMaterial.gloss=0;
  axisMaterial.update();
  axis.render.material=axisMaterial;
  for(const instance of axis.render.meshInstances||[]){
    instance.material=axisMaterial;
    instance.castShadow=false;
    instance.receiveShadow=false;
  }
  axis.render.castShadows=false;
  axis.render.receiveShadows=false;
  axis.render.frustumCulling=false;
  state.axisY=axis;
  state.gridEntities.push(axis);
}
function activeCamera() { return F.camera(); }
function readCamera(targetHint) {
  const entity = activeCamera();
  if (!entity?.camera) return;
  const pos = entity.getPosition();
  if (targetHint) state.target.copy(targetHint);
  const dx=pos.x-state.target.x, dy=pos.y-state.target.y, dz=pos.z-state.target.z;
  state.distance=Math.max(0.05,Math.hypot(dx,dy,dz));
  state.yaw=Math.atan2(dx,dz);
  state.pitch=Math.asin(Math.max(-1,Math.min(1,dy/state.distance)));
}
function applyCamera() {
  const entity=activeCamera();
  if (!entity?.camera) return;
  state.pitch=Math.max(-1.535,Math.min(1.535,state.pitch));
  state.distance=Math.max(0.15,Math.min(2000,state.distance));
  const cp=Math.cos(state.pitch);
  entity.setPosition(
    state.target.x + Math.sin(state.yaw)*state.distance*cp,
    state.target.y + Math.sin(state.pitch)*state.distance,
    state.target.z + Math.cos(state.yaw)*state.distance*cp
  );
  entity.lookAt(state.target);
}
function orbit(dx,dy) {
  const sensitivity=0.006;
  state.yaw -= dx*sensitivity;
  state.pitch -= dy*sensitivity;
  applyCamera();
}
function zoomBy(factor) {
  const entity=activeCamera();
  if (!entity?.camera || !Number.isFinite(factor) || factor<=0) return;
  if (entity.camera.projection===pc.PROJECTION_ORTHOGRAPHIC) {
    entity.camera.orthoHeight=Math.max(0.04,Math.min(5000,entity.camera.orthoHeight*factor));
  } else {
    state.distance=Math.max(0.15,Math.min(2000,state.distance*factor));
    applyCamera();
  }
}
function pan(dx,dy) {
  const entity=activeCamera();
  if (!entity?.camera) return;
  const h=Math.max(1,canvas.clientHeight||canvas.height||600);
  const perspectiveSpan=2*state.distance*Math.tan((entity.camera.fov||60)*Math.PI/360);
  const span=entity.camera.projection===pc.PROJECTION_ORTHOGRAPHIC
    ? 2*entity.camera.orthoHeight
    : perspectiveSpan;
  const unitsPerPixel=span/h;
  const right=entity.right.clone().mulScalar(-dx*unitsPerPixel);
  const up=entity.up.clone().mulScalar(dy*unitsPerPixel);
  state.target.add(right).add(up);
  applyCamera();
}
function rectContainsEvent(e) {
  const r=canvas.getBoundingClientRect();
  return e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
}
function startGesture(e) {
  const gizmo=window.ForgeGizmo;
  if (e.pointerType==="touch") {
    if(state.touches.size===0&&gizmo&&!gizmo.state?.nativeReady&&gizmo.state?.mode!=="select"){
      const selected=F.selected(),componentSelection=selected&&["camera","light"].includes(selected.kind),picked=componentSelection?selected:F.pick(e);
      if(picked){
        const transform=gizmo.beginPointerGesture?.(e);
        if(transform){state.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});state.gesture={id:e.pointerId,mode:"transform",transform,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};e.preventDefault();try{canvas.setPointerCapture(e.pointerId)}catch{}return}
      }
    }
    state.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    if (state.touches.size===1) {
      state.gesture={id:e.pointerId,mode:"touch",x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};
    } else if (state.touches.size>=2) {
      const a=[...state.touches.values()];
      state.gesture={mode:"pinch",moved:true};
      state.lastPinch={
        distance:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),
        center:{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2}
      };
    }
    return;
  }
  let mode="select";
  if (e.button===1 || (e.button===0 && e.altKey)) mode=e.shiftKey?"pan":"orbit";
  else if (e.button===2) mode=e.shiftKey?"orbit":"pan";
  if(mode==="select"&&e.button===0&&gizmo&&!gizmo.state?.nativeReady&&gizmo.state?.mode!=="select"){
    const selected=F.selected(),componentSelection=selected&&["camera","light"].includes(selected.kind),picked=componentSelection?selected:F.pick(e);
    if(picked){
      const transform=gizmo.beginPointerGesture?.(e);
      if(transform){state.gesture={id:e.pointerId,mode:"transform",transform,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};e.preventDefault();try{canvas.setPointerCapture(e.pointerId)}catch{}return}
    }
  }
  state.gesture={id:e.pointerId,mode,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};
  if (mode==="orbit" || mode==="pan") {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }
}
function moveGesture(e) {
  if (e.pointerType==="touch") {
    if (!state.touches.has(e.pointerId)) return;
    state.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(state.touches.size===1&&state.gesture?.mode==="transform"&&state.gesture.id===e.pointerId){
      window.ForgeGizmo?.movePointerGesture?.(e,state.gesture.transform);
      state.gesture.lastX=e.clientX;state.gesture.lastY=e.clientY;state.gesture.moved=true;return;
    }
    if (state.touches.size>=2) {
      const a=[...state.touches.values()];
      const distance=Math.max(1,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y));
      const center={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};
      if (state.lastPinch) {
        pan(center.x-state.lastPinch.center.x,center.y-state.lastPinch.center.y);
        zoomBy(state.lastPinch.distance/distance);
      }
      state.lastPinch={distance,center};
      return;
    }
    const g=state.gesture;
    if (!g || g.mode!=="touch" || g.id!==e.pointerId) return;
    const dx=e.clientX-g.lastX,dy=e.clientY-g.lastY;
    if (Math.hypot(e.clientX-g.x,e.clientY-g.y)>4) g.moved=true;
    if (g.moved) orbit(dx,dy);
    g.lastX=e.clientX;g.lastY=e.clientY;
    return;
  }
  const g=state.gesture;
  if (!g || g.id!==e.pointerId) return;
  if(g.mode==="transform"){window.ForgeGizmo?.movePointerGesture?.(e,g.transform);g.lastX=e.clientX;g.lastY=e.clientY;g.moved=true;return}
  const dx=e.clientX-g.lastX,dy=e.clientY-g.lastY;
  if (Math.hypot(e.clientX-g.x,e.clientY-g.y)>4) g.moved=true;
  if (g.mode==="orbit" && g.moved) orbit(dx,dy);
  else if (g.mode==="pan" && g.moved) pan(dx,dy);
  g.lastX=e.clientX;g.lastY=e.clientY;
}
function endGesture(e) {
  if(state.gesture?.mode==="transform"&&state.gesture.id===e.pointerId){
    window.ForgeGizmo?.endPointerGesture?.(state.gesture.transform);
    state.touches.delete(e.pointerId);state.gesture=null;state.lastPinch=null;return;
  }
  if (e.pointerType==="touch") {
    const g=state.gesture;
    const tap=state.touches.size===1 && g?.mode==="touch" && g.id===e.pointerId && !g.moved;
    state.touches.delete(e.pointerId);
    if (tap && rectContainsEvent(e)) F.pick(e);
    if (state.touches.size===0) { state.gesture=null;state.lastPinch=null; }
    else {
      const remaining=[...state.touches.entries()][0];
      state.gesture={id:remaining[0],mode:"touch",x:remaining[1].x,y:remaining[1].y,lastX:remaining[1].x,lastY:remaining[1].y,moved:true};
      state.lastPinch=null;
    }
    return;
  }
  const g=state.gesture;
  if (g && g.id===e.pointerId && g.mode==="select" && !g.moved && rectContainsEvent(e)) F.pick(e);
  if (g && g.id===e.pointerId) state.gesture=null;
}
canvas.addEventListener("pointerdown",startGesture,{passive:false});
canvas.addEventListener("pointermove",moveGesture,{passive:false});
window.addEventListener("pointerup",endGesture,true);
window.addEventListener("pointercancel",endGesture,true);
canvas.addEventListener("contextmenu",e=>e.preventDefault());
canvas.addEventListener("wheel",e=>{
  e.preventDefault();
  zoomBy(Math.exp(Math.max(-1.5,Math.min(1.5,e.deltaY*0.0012))));
},{passive:false});

const originalFrame=F.frame.bind(F);
F.frame=function(...args){
  const result=originalFrame(...args);
  const selected=F.selected();
  const bounds=F.worldBounds?.();
  readCamera(selected?.entity.getPosition()||bounds?.center||vec(0,1,0));
  return result;
};
const originalFocus=F.focus.bind(F);
F.focus=function(...args){
  const result=originalFocus(...args);
  const selected=F.selected();
  if (selected) readCamera(selected.entity.getPosition());
  return result;
};
const originalSetView=F.setView.bind(F);
F.setView=function(mode,...args){
  const target=F.selected()?.entity.getPosition()||vec(0,1,0);
  const result=originalSetView(mode,...args);
  readCamera(target);
  return result;
};

function setGridVisible(visible) {
  state.gridVisible=Boolean(visible);
  if(state.ground?.entity?.render){
    state.ground.entity.render.material=state.gridVisible?state.gridMaterial:state.plainMaterial;
  }
  if(state.axisY)state.axisY.enabled=state.gridVisible;
  return state.gridVisible;
}
function toggleGrid(){return setGridVisible(!state.gridVisible)}
function status(){
  const camera=activeCamera(),position=camera?.getPosition();
  return{
    ok:Boolean(F.app?.graphicsDevice&&camera?.camera&&state.helperRoot&&state.ground?.entity?.render?.enabled&&state.gridTexture&&state.axisY),
    renderer:F.diagnostics?.().renderer||"unknown",
    gridVisible:state.gridVisible,
    gridMeshes:1+state.gridEntities.length,
    gridTexture:Boolean(state.gridTexture),
    gridScaleMeters:GRID_METERS,
    minorSubdivisionMeters:1,
    majorSubdivisionMeters:5,
    groundVisible:Boolean(state.ground?.entity?.render?.enabled&&state.ground.entity.render.layers.includes(pc.LAYERID_WORLD)),
    axes:{x:true,y:Boolean(state.axisY),z:true},
    axisYColor:state.axisY?.render?.meshInstances?.[0]?.material?.emissiveMap?"#35d982":"unknown",
    navigation:{orbit:true,pan:true,zoom:true,touch:true,clickSelect:true},
    camera:camera&&position?{
      position:[position.x,position.y,position.z],
      target:[state.target.x,state.target.y,state.target.z],
      distance:Number(state.distance.toFixed(4)),
      projection:camera.camera.projection===pc.PROJECTION_ORTHOGRAPHIC?"orthographic":"perspective"
    }:null
  };
}
state.installed=true;
createWorldGrid();
readCamera(vec(0,1,0));
window.ForgeViewport={state,status,setGridVisible,toggleGrid,orbit,pan,zoomBy,frame:()=>F.frame(),syncCamera:()=>readCamera(state.target)};
