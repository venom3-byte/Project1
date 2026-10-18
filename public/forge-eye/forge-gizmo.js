const pc=window.ForgePlayCanvas;
const F=window.Forge;
const state={mode:"select",space:"world",layer:null,gizmos:{},ready:true,nativeReady:false,initializing:false};
function log(s){try{F.log(s)}catch{console.info("[Forge Gizmo]",s)}}
function cameraComponent(){return F?.camera?.()?.camera||null}
function attach(){
  if(state.nativeReady||state.initializing)return state.nativeReady;
  const cam=cameraComponent();if(!cam||!F?.app)return false;
  state.initializing=true;
  const Gizmo=pc.Gizmo,Translate=pc.TranslateGizmo,Rotate=pc.RotateGizmo,Scale=pc.ScaleGizmo;
  if(!Gizmo||!Translate||!Rotate||!Scale){state.initializing=false;state.fallbackReady=true;log("Native gizmos unavailable; screen-space transform fallback enabled.");return false}
  try{
    state.layer=Gizmo.createLayer(F.app);
    state.gizmos.translate=new Translate(cam,state.layer);
    state.gizmos.rotate=new Rotate(cam,state.layer);
    state.gizmos.scale=new Scale(cam,state.layer);
    for(const[name,g]of Object.entries(state.gizmos)){
      g.off?.();
      g.on("transform:start",()=>{const r=F.selected?.();state.before=r?{[r.id]:F._transformState?.(r)}:{};});
      g.on("transform:end",()=>{
        const r=F.selected?.();if(r&&state.before?.[r.id])F.recordTransformHistory?.(r.id,state.before[r.id],F._transformState?.(r));
        window.dispatchEvent(new Event("forge-gizmo-transform"));
      });
      g.coordSpace=state.space;
      g.snap=Boolean(F.snapEnabled);
      g.snapIncrement=Number(F.snapSize||.25);
      g.enabled=false;
    }
    state.ready=true;state.nativeReady=true;state.initializing=false;sync();return true;
  }catch(e){state.initializing=false;log("Gizmo init failed: "+e.message);return false}
}
function sync(){
  if(!state.ready||!state.nativeReady)return;
  const r=F.selected(),node=r?.entity||null;
  for(const[name,g]of Object.entries(state.gizmos)){g.enabled=Boolean(node)&&name===state.mode;if(g.coordSpace!==state.space)g.coordSpace=state.space;g.snap=Boolean(F.snapEnabled);g.snapIncrement=Number(F.snapSize||.25);if(g.enabled)g.attach([node]);else g.detach()}
}
function setMode(mode){
  if(!["select","translate","rotate","scale"].includes(mode))return false;
  state.mode=mode;
  if(state.nativeReady)sync();
  return true
}
function setSpace(space){
  state.space=space==="local"?"local":"world";
  if(state.nativeReady)sync();
  return state.space
}

function beginPointerGesture(event){
  if(state.nativeReady||state.mode==="select")return null;
  const r=F?.selected?.(),camera=F?.camera?.();
  if(!r||!camera?.camera)return null;
  const p=F._transformState?.(r);if(!p)return null;
  const h=Math.max(1,F.canvas?.clientHeight||F.canvas?.height||600),distance=Math.max(.05,r.entity.getPosition().distance(camera.getPosition())||1);
  const span=camera.camera.projection===pc.PROJECTION_ORTHOGRAPHIC?2*camera.camera.orthoHeight:2*distance*Math.tan((camera.camera.fov||60)*Math.PI/360);
  return{id:event.pointerId,recordId:r.id,mode:state.mode,startX:event.clientX,startY:event.clientY,before:JSON.parse(JSON.stringify(p)),unitsPerPixel:span/h,space:state.space};
}
function movePointerGesture(event,drag){
  if(!drag||drag.id!==event.pointerId)return false;
  const r=F?.entities?.get(drag.recordId);if(!r)return false;
  const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY,b=drag.before,p=r.entity.getLocalPosition(),rot=b.r,sc=b.s;
  if(drag.mode==="translate"){
    const cam=F.camera(),right=cam?.right,up=cam?.up,unit=drag.unitsPerPixel;
    if(!right||!up)return false;
    let x=b.p[0]+right.x*dx*unit-up.x*dy*unit;
    let y=b.p[1]+right.y*dx*unit-up.y*dy*unit;
    let z=b.p[2]+right.z*dx*unit-up.z*dy*unit;
    if(F.snapEnabled){const step=Math.max(.0001,Number(F.snapSize)||.25);x=Math.round(x/step)*step;y=Math.round(y/step)*step;z=Math.round(z/step)*step}
    r.entity.setLocalPosition(x,y,z);
  }else if(drag.mode==="rotate"){
    const amount=event.shiftKey ? 0.1 : 0.5;
    r.entity.setLocalEulerAngles(rot[0]+dy*amount,rot[1]+dx*amount,rot[2]+(event.altKey?dx*amount:0));
  }else if(drag.mode==="scale"){
    const factor=Math.max(.01,Math.min(100,Math.exp((dx-dy)*.008)));
    const values=sc.map(v=>Math.max(.0001,Math.min(10000,v*factor)));
    r.entity.setLocalScale(values[0],values[1],values[2]);
  }else return false;
  window.dispatchEvent(new Event("forge-transform-preview"));
  return true;
}
function endPointerGesture(drag){
  if(!drag)return false;
  const r=F?.entities?.get(drag.recordId);if(!r)return false;
  const after=F._transformState?.(r),changed=F.recordTransformHistory?.(r.id,drag.before,after)===true;
  if(changed&&F.autoKey)F.key({interpolation:F.keyInterpolation});
  window.dispatchEvent(new Event("forge-gizmo-transform"));
  window.dispatchEvent(new Event("forge-selection"));
  return changed;
}

window.ForgeGizmo={state,init:attach,setMode,setSpace,sync,beginPointerGesture,movePointerGesture,endPointerGesture};
window.addEventListener("forge-selection",()=>{if(state.nativeReady)sync()});
window.addEventListener("forge-gizmo-config",()=>{if(state.nativeReady)sync()});
