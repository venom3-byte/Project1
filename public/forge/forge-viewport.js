import { pc } from "./forge-engine.js";

const F = window.Forge;
const canvas = document.getElementById("viewport");
const gridExtent = 15;
const minorStep = 1;
const majorStep = 5;
const vec = (x=0,y=0,z=0) => new pc.Vec3(x,y,z);
const state = {
  gridVisible: true,
  gridEntities: [],
  helperRoot: null,
  ground: null,
  target: vec(0,1,0),
  yaw: 0,
  pitch: 0,
  distance: 12,
  gesture: null,
  touches: new Map(),
  lastPinch: null,
  installed: false
};

function makeMaterial(rgb, { lighting=false, emissive=0.18 }={}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(rgb[0],rgb[1],rgb[2]);
  m.emissive = new pc.Color(rgb[0],rgb[1],rgb[2]);
  m.emissiveIntensity = emissive;
  m.useLighting = lighting;
  m.useMetalness = false;
  m.metalness = 0;
  m.gloss = 0.35;
  m.specular = new pc.Color(0,0,0);
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}
function pushQuad(buffer, p0, p1, p2, p3) {
  const start = buffer.positions.length/3;
  for (const p of [p0,p1,p2,p3]) buffer.positions.push(p[0],p[1],p[2]);
  buffer.indices.push(start,start+1,start+2,start,start+2,start+3);
}
function groundLine(buffer, along, fixed, extent, width, y) {
  const h = width/2;
  if (along === "x") {
    pushQuad(buffer,[-extent,y,fixed-h],[extent,y,fixed-h],[extent,y,fixed+h],[-extent,y,fixed+h]);
  } else {
    pushQuad(buffer,[fixed-h,y,-extent],[fixed+h,y,-extent],[fixed+h,y,extent],[fixed-h,y,extent]);
  }
}
function makeMesh(name, buffer, material) {
  if (!buffer.positions.length) return null;
  const mesh = new pc.Mesh(F.app.graphicsDevice);
  mesh.setPositions(new Float32Array(buffer.positions));
  mesh.setIndices(new Uint16Array(buffer.indices));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const entity = new pc.Entity(name);
  state.helperRoot.addChild(entity);
  const instance = new pc.MeshInstance(mesh,material,entity);
  entity.addComponent("render",{meshInstances:[instance]});
  entity.render.layers = [pc.LAYERID_WORLD];
  entity.render.frustumCulling = false;
  entity.render.castShadows = false;
  entity.render.receiveShadows = false;
  state.gridEntities.push(entity);
  return entity;
}
function createWorldGrid() {
  state.helperRoot = new pc.Entity("Forge Editor Grid — helper");
  F.root.addChild(state.helperRoot);
  state.helperRoot.enabled = true;

  state.ground = [...F.entities.values()].find(r => r.name === "Ground" && r.entity.render);
  if (state.ground) {
    const plane = state.ground.entity;
    plane.render.layers = [pc.LAYERID_WORLD];
    plane.render.enabled = true;
    plane.setLocalPosition(0,-0.025,0);
    const material = makeMaterial([0.035,0.048,0.064],{lighting:true,emissive:0.02});
    material.gloss = 0.2;
    material.update();
    plane.render.material = material;
    plane.render.castShadows = false;
    plane.render.receiveShadows = true;
  }

  const minor = {positions:[],indices:[]};
  const major = {positions:[],indices:[]};
  const extent = gridExtent;
  for (let v=-extent; v<=extent; v+=minorStep) {
    if (v===0 || Math.abs(v%majorStep)<1e-6) continue;
    groundLine(minor,"x",v,extent,0.012,0.002);
    groundLine(minor,"z",v,extent,0.012,0.002);
  }
  for (let v=-extent; v<=extent; v+=majorStep) {
    if (v===0) continue;
    groundLine(major,"x",v,extent,0.024,0.006);
    groundLine(major,"z",v,extent,0.024,0.006);
  }
  makeMesh("Forge Grid — 1m subdivisions",minor,makeMaterial([0.15,0.205,0.265],{emissive:0.28}));
  makeMesh("Forge Grid — 5m major lines",major,makeMaterial([0.235,0.315,0.39],{emissive:0.32}));

  const axisX={positions:[],indices:[]};
  const axisZ={positions:[],indices:[]};
  const axisY={positions:[],indices:[]};
  groundLine(axisX,"x",0,extent,0.055,0.014);
  groundLine(axisZ,"z",0,extent,0.055,0.016);
  const w=0.035, z=0.018, top=4.5;
  pushQuad(axisY.positions.length ? axisY : axisY,
    [-w/2,0,z],[w/2,0,z],[w/2,top,z],[-w/2,top,z]);
  makeMesh("World axis X",axisX,makeMaterial([0.93,0.22,0.28],{emissive:0.72}));
  makeMesh("World axis Z",axisZ,makeMaterial([0.17,0.54,1],{emissive:0.72}));
  makeMesh("World axis Y",axisY,makeMaterial([0.24,0.88,0.47],{emissive:0.72}));
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
  if (e.pointerType==="touch") {
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
  const dx=e.clientX-g.lastX,dy=e.clientY-g.lastY;
  if (Math.hypot(e.clientX-g.x,e.clientY-g.y)>4) g.moved=true;
  if (g.mode==="orbit" && g.moved) orbit(dx,dy);
  else if (g.mode==="pan" && g.moved) pan(dx,dy);
  g.lastX=e.clientX;g.lastY=e.clientY;
}
function endGesture(e) {
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
  for (const entity of state.gridEntities) entity.enabled=state.gridVisible;
  return state.gridVisible;
}
function toggleGrid() { return setGridVisible(!state.gridVisible); }
function status() {
  const camera=activeCamera(),position=camera?.getPosition();
  return {
    ok:Boolean(F.app?.graphicsDevice&&camera?.camera&&state.helperRoot&&state.gridEntities.length===5&&state.ground?.entity?.render?.enabled),
    renderer:F.diagnostics?.().renderer||"unknown",
    gridVisible:state.gridVisible,
    gridMeshes:state.gridEntities.length,
    groundVisible:Boolean(state.ground?.entity?.render?.enabled&&state.ground.entity.render.layers.includes(pc.LAYERID_WORLD)),
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
window.ForgeViewport={state,status,setGridVisible,toggleGrid,orbit,pan,zoomBy,frame:()=>F.frame()};
