const pc=window.ForgePlayCanvas;
const F=window.Forge;
const state={mode:"translate",space:"world",layer:null,gizmos:{},ready:true,nativeReady:false,initializing:false};
function log(s){try{F.log(s)}catch{console.info("[Forge Gizmo]",s)}}
function cameraComponent(){return F?.camera?.()?.camera||null}
function attach(){
  if(state.nativeReady||state.initializing)return state.nativeReady;
  const cam=cameraComponent();if(!cam||!F?.app)return false;
  state.initializing=true;
  const Gizmo=pc.Gizmo,Translate=pc.TranslateGizmo,Rotate=pc.RotateGizmo,Scale=pc.ScaleGizmo;
  if(!Gizmo||!Translate||!Rotate||!Scale){log("Transform gizmos unavailable in this engine build.");return false}
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
  if(!["translate","rotate","scale"].includes(mode))return false;
  state.mode=mode;
  if(state.nativeReady)sync();
  return true
}
function setSpace(space){
  state.space=space==="local"?"local":"world";
  if(state.nativeReady)sync();
  return state.space
}
window.ForgeGizmo={state,init:attach,setMode,setSpace,sync};
window.addEventListener("forge-selection",()=>{if(state.nativeReady)sync()});
window.addEventListener("forge-gizmo-config",()=>{if(state.nativeReady)sync()});
