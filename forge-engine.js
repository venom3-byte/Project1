import * as pc from "https://cdn.jsdelivr.net/npm/playcanvas@2.22.6/build/playcanvas.mjs";
import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/+esm";

export class ForgeEngine{
  constructor(canvas,log=()=>{}){this.canvas=canvas;this.log=log;this.app=null;this.root=null;this.entities=new Map();this.selectedId=null;this.rapier=null;this.world=null;this.physics=new Map();this.keyframes=new Map();this.scripts=new Map();this.timelineTime=0;this.running=false;this.timelinePlaying=false;this.fps=0;this.frames=0;this.lastFPS=performance.now();this.frameMs=0;this.physicsAccumulator=0;this.physicsFixedDt=1/60;this.physicsMaxSubsteps=5;this.prePhysicsSystems=new Set();this.postPhysicsSystems=new Set();this.collisionListeners=new Set();this.colliderEntityMap=new Map();this.eventQueue=null}
  async init(){
    this.app=new pc.Application(this.canvas,{graphicsDeviceOptions:{antialias:true,alpha:false,powerPreference:"high-performance",preserveDrawingBuffer:true}});
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);this.app.setCanvasResolution(pc.RESOLUTION_AUTO);this.app.scene.gammaCorrection=pc.GAMMA_SRGB;this.app.scene.toneMapping=pc.TONEMAP_ACES;this.app.start();
    this.root=new pc.Entity("ForgeScene");this.app.root.addChild(this.root);
    await RAPIER.init();this.rapier=RAPIER;this.world=new RAPIER.World({x:0,y:-9.81,z:0});this.eventQueue=new RAPIER.EventQueue(true);
    this.createCamera("Main Camera",{x:7,y:5,z:9});this.createLight("Sun");this.createPlane("Ground",30,30);
    this.app.on("update",dt=>this.update(dt));this.canvas.addEventListener("pointerdown",e=>this.pick(e));window.addEventListener("resize",()=>this.app.resizeCanvas());this.app.resizeCanvas();this.log("Forge Engine 2.0 online");return this;
  }
  rec(name,kind,e){const id=crypto.randomUUID();e.__forge={id,kind,name,components:{}};const r={id,kind,name,entity:e,components:e.__forge.components};this.entities.set(id,r);return r}
  add(kind,name){const e=new pc.Entity(name);this.root.addChild(e);return this.rec(name,kind,e)}
  material(color=[.22,.62,.9]){const m=new pc.StandardMaterial();m.diffuse=new pc.Color(...color);m.metalness=.05;m.gloss=.5;m.update();return m}
  primitive(kind,name){const r=this.add(kind,name||kind+"-"+(this.entities.size+1));r.entity.addComponent("render",{type:kind==="sphere"?"sphere":kind==="cylinder"?"cylinder":kind==="capsule"?"capsule":kind==="plane"?"plane":"box"});r.entity.render.material=this.material(kind==="plane"?[.12,.2,.27]:[.22,.62,.9]);if(kind!=="plane")r.entity.setLocalPosition((Math.random()-.5)*4,1+(Math.random()*1.7),(Math.random()-.5)*4);return r}
  attachAnimations(entity,resource){
    const tracks=resource?.animations||[];
    if(!tracks.length)return [];
    try{
      if(!entity.anim)entity.addComponent("anim",{activate:true,speed:1});
      const clips=[];
      for(let i=0;i<tracks.length;i++){
        const track=tracks[i],name=track?.name||("Clip_"+i);
        entity.anim.assignAnimation(name,track,undefined,1,true);
        clips.push(name);
      }
      entity.anim.playing=true;
      return clips;
    }catch(error){this.log("Animation attach failed: "+error.message,"error");return []}
  }
  setAnimationState(id,state){
    const r=this.entities.get(id);if(!r?.entity?.anim?.baseLayer)return false;
    try{r.entity.anim.baseLayer.play(state);return true}catch{return false}
  }
  createPlane(name,w=30,d=30){const r=this.primitive("plane",name);r.entity.setLocalScale(w,1,d);r.entity.setLocalPosition(0,0,0);this.setPhysics(r.id,"fixed","box");return r}
  createCamera(name,pos){const r=this.add("camera",name);r.entity.addComponent("camera",{clearColor:new pc.Color(.02,.05,.09),fov:60});r.entity.setLocalPosition(pos.x,pos.y,pos.z);r.entity.lookAt(0,1,0);r.components.camera={active:true};return r}
  createLight(name){const r=this.add("light",name);r.entity.addComponent("light",{type:"directional",color:new pc.Color(1,.96,.88),intensity:2,castShadows:true,shadowDistance:40});r.entity.setEulerAngles(48,-32,0);r.components.light={type:"directional"};return r}
  applyMaterial(params={}){const r=this.selected();if(!r)return false;const color=params.color||[.22,.62,.9],mats=[];const walk=e=>{if(e.render?.meshInstances?.length){for(const mi of e.render.meshInstances){let m=mi.material?.clone?.()||this.material(color);m.diffuse=new pc.Color(...color);if(params.metalness!=null)m.metalness=Number(params.metalness);if(params.roughness!=null)m.gloss=1-Number(params.roughness);if(params.opacity!=null){m.opacity=Number(params.opacity);m.blendType=params.opacity<1?pc.BLEND_NORMAL:pc.BLEND_NONE;m.alphaTest=params.opacity<1?.01:0}if(params.emissive){m.emissive=new pc.Color(...params.emissive);m.emissiveIntensity=Number(params.emissiveIntensity||0)}m.update();mi.material=m;mats.push(m)}}for(let i=0;i<e.children.length;i++)walk(e.children[i])};walk(r.entity);r.components.material={color,metalness:Number(params.metalness??.05),roughness:Number(params.roughness??.5),opacity:Number(params.opacity??1),emissive:params.emissive||[0,0,0]};return mats.length};
  materialState(){const r=this.selected();return r?.components.material||null}
  onPrePhysics(fn){this.prePhysicsSystems.add(fn);return()=>this.prePhysicsSystems.delete(fn)}
  onPostPhysics(fn){this.postPhysicsSystems.add(fn);return()=>this.postPhysicsSystems.delete(fn)}
  onCollision(fn){this.collisionListeners.add(fn);return()=>this.collisionListeners.delete(fn)}
  emitCollision(h1,h2,started){const e1=this.entities.get(this.colliderEntityMap.get(h1));const e2=this.entities.get(this.colliderEntityMap.get(h2));for(const fn of this.collisionListeners){try{fn({handle1:h1,handle2:h2,started,a:e1,b:e2})}catch(e){this.log("Collision listener error: "+e.message,"error")}}}
  setPhysics(id,mode,shape){const r=this.entities.get(id);if(!r||!this.world)return;this.removePhysics(id);const p=r.entity.getLocalPosition();let body=mode==="fixed"?this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(p.x,p.y,p.z)):mode==="kinematic"?this.world.createRigidBody(this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.y,p.z)):this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z));const s=r.entity.getLocalScale();let c=shape==="ball"?this.rapier.ColliderDesc.ball(Math.max(.2,Math.max(s.x,s.y,s.z)*.5)):shape==="capsule"?this.rapier.ColliderDesc.capsule(Math.max(.2,s.y*.5),Math.max(.15,s.x*.5)):this.rapier.ColliderDesc.cuboid(Math.max(.15,s.x*.5),Math.max(.15,s.y*.5),Math.max(.15,s.z*.5));const collider=this.world.createCollider(c,body);this.physics.set(id,{body,collider,mode,shape,colliderHandle:collider.handle});r.components.physics={mode,shape}}
  resetScene(includeDefaults=true){for(const r of [...this.entities.values()]){this.removePhysics(r.id);r.entity.destroy()}this.entities.clear();this.selectedId=null;this.keyframes.clear();this.scripts.clear();if(includeDefaults){this.createCamera("Main Camera",{x:7,y:5,z:9});this.createLight("Sun");this.createPlane("Ground",30,30)}this.frame()}
  removePhysics(id){const p=this.physics.get(id);if(p&&this.world){this.colliderEntityMap.delete(p.collider?.handle);this.world.removeRigidBody(p.body,true)}this.physics.delete(id);const r=this.entities.get(id);if(r)delete r.components.physics}
  update(dt){this.frameMs=dt*1000;this.frames++;const now=performance.now();if(now-this.lastFPS>800){this.fps=this.frames*1000/(now-this.lastFPS);this.frames=0;this.lastFPS=now}const frameDt=Math.min(.1,Math.max(0,dt));if(this.world){this.physicsAccumulator=Math.min(this.physicsAccumulator+frameDt,this.physicsFixedDt*this.physicsMaxSubsteps);let steps=0;while(this.physicsAccumulator>=this.physicsFixedDt&&steps<this.physicsMaxSubsteps){for(const fn of this.prePhysicsSystems){try{fn(this.physicsFixedDt)}catch(e){this.log("Pre-physics system error: "+e.message,"error")}}this.world.step(this.eventQueue);this.eventQueue?.drainCollisionEvents((h1,h2,started)=>this.emitCollision(h1,h2,started));for(const fn of this.postPhysicsSystems){try{fn(this.physicsFixedDt)}catch(e){this.log("Post-physics system error: "+e.message,"error")}}this.physicsAccumulator-=this.physicsFixedDt;steps++}for(const [id,p] of this.physics){if(p.mode==="fixed")continue;const r=this.entities.get(id);if(!r)continue;const t=p.body.translation(),q=p.body.rotation();r.entity.setLocalPosition(t.x,t.y,t.z);r.entity.setLocalRotation(q.x,q.y,q.z,q.w)}}if(this.timelinePlaying){this.timelineTime+=frameDt;this.evalAnimation(this.timelineTime)}if(this.running)this.runScripts(frameDt)}
  camera(){return [...this.entities.values()].find(r=>r.kind==="camera"&&r.components.camera?.active)?.entity}
  pick(e){const cam=this.camera();if(!cam?.camera)return;const rect=this.canvas.getBoundingClientRect();const a=cam.camera.screenToWorld(e.clientX-rect.left,e.clientY-rect.top,0),b=cam.camera.screenToWorld(e.clientX-rect.left,e.clientY-rect.top,1),d=new pc.Vec3().sub2(b,a).normalize();let best=null,bt=1e9;for(const r of this.entities.values()){const mi=r.entity.render?.meshInstances?.[0];if(!mi)continue;const t=this.rayAABB(a,d,mi.aabb);if(t!==null&&t<bt){bt=t;best=r}}if(best)this.select(best.id)}
  rayAABB(o,d,a){const mn=a.getMin(),mx=a.getMax();let lo=-Infinity,hi=Infinity;for(const k of ["x","y","z"]){if(Math.abs(d[k])<1e-7){if(o[k]<mn[k]||o[k]>mx[k])return null}else{let x=(mn[k]-o[k])/d[k],y=(mx[k]-o[k])/d[k];if(x>y)[x,y]=[y,x];lo=Math.max(lo,x);hi=Math.min(hi,y);if(lo>hi)return null}}return hi<0?null:Math.max(0,lo)}
  select(id){this.selectedId=id;return this.entities.get(id)||null}selected(){return this.selectedId?this.entities.get(this.selectedId):null}
  transform(v){const r=this.selected();if(!r)return;const p=r.entity.getLocalPosition(),rot=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale();r.entity.setLocalPosition(Number.isFinite(v.x)?v.x:p.x,Number.isFinite(v.y)?v.y:p.y,Number.isFinite(v.z)?v.z:p.z);r.entity.setLocalEulerAngles(Number.isFinite(v.rx)?v.rx:rot.x,Number.isFinite(v.ry)?v.ry:rot.y,Number.isFinite(v.rz)?v.rz:rot.z);r.entity.setLocalScale(Number.isFinite(v.sx)?v.sx:s.x,Number.isFinite(v.sy)?v.sy:s.y,Number.isFinite(v.sz)?v.sz:s.z)}
  duplicate(){const r=this.selected();if(!r)return;const e=r.entity.clone();e.name=r.name+" Copy";this.root.addChild(e);const n=this.rec(e.name,r.kind,e);n.components=JSON.parse(JSON.stringify(r.components));const p=e.getLocalPosition();e.setLocalPosition(p.x+1,p.y,p.z);if(n.components.physics)this.setPhysics(n.id,n.components.physics.mode,n.components.physics.shape);this.select(n.id);return n}
  delete(){const r=this.selected();if(!r)return;this.removePhysics(r.id);r.entity.destroy();this.entities.delete(r.id);this.selectedId=null}
  focus(){const r=this.selected(),cam=this.camera();if(!r||!cam)return;const p=r.entity.getPosition();cam.setLocalPosition(p.x+5,p.y+3,p.z+7);cam.lookAt(p)}
  frame(){const cam=this.camera();const rs=[...this.entities.values()].filter(r=>r.entity.render?.meshInstances?.length);if(!cam||!rs.length)return;let c=new pc.Vec3(0,0,0);for(const r of rs)c.add(r.entity.getPosition());c.mulScalar(1/rs.length);let rad=2;for(const r of rs)rad=Math.max(rad,r.entity.getPosition().distance(c)+1);cam.setLocalPosition(c.x+rad*1.4,c.y+rad*.9,c.z+rad*1.5);cam.lookAt(c)}
  key(){const r=this.selected();if(!r)return;const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale();const a=this.keyframes.get(r.id)||[];a.push({time:this.timelineTime,p:[p.x,p.y,p.z],r:[q.x,q.y,q.z],s:[s.x,s.y,s.z]});a.sort((x,y)=>x.time-y.time);this.keyframes.set(r.id,a)}
  evalAnimation(t){for(const [id,a] of this.keyframes){const r=this.entities.get(id);if(!r||!a.length)continue;let k=a[0];for(let i=0;i<a.length-1;i++)if(t>=a[i].time&&t<=a[i+1].time){const A=a[i],B=a[i+1],f=(t-A.time)/Math.max(.0001,B.time-A.time);k={p:A.p.map((v,j)=>v+(B.p[j]-v)*f),r:A.r.map((v,j)=>v+(B.r[j]-v)*f),s:A.s.map((v,j)=>v+(B.s[j]-v)*f)};break}r.entity.setLocalPosition(...k.p);r.entity.setLocalEulerAngles(...k.r);r.entity.setLocalScale(...k.s)}}
  attachScript(id,code){this.scripts.set(id,code)}
  runScripts(dt){for(const [id,code] of this.scripts){const r=this.entities.get(id);if(!r)continue;try{new Function("api",code)({entity:r.entity,time:this.timelineTime,dt:dt,engine:this})}catch(e){this.log("Script error "+e.message,"error")}}}
  async importFile(file){
    const url=URL.createObjectURL(file);
    if(file.name.toLowerCase().endsWith(".forge.json"))return{type:"project",data:JSON.parse(await file.text())};
    if(/^image\//.test(file.type)){const bmp=await createImageBitmap(file),c=document.createElement("canvas");c.width=bmp.width;c.height=bmp.height;c.getContext("2d").drawImage(bmp,0,0);const tex=new pc.Texture(this.app.graphicsDevice,{width:bmp.width,height:bmp.height,format:pc.PIXELFORMAT_R8_G8_B8_A8});tex.setSource(c);const mat=this.material([1,1,1]);mat.diffuseMap=tex;mat.emissiveMap=tex;mat.emissive=new pc.Color(1,1,1);mat.update();const r=this.primitive("plane",file.name);r.entity.render.material=mat;r.components.asset={type:"image",name:file.name,width:bmp.width,height:bmp.height};this.assets.set(file.name,{type:"image",file,url});return{type:"image",record:r}}
    if(/\.glb$/i.test(file.name))return new Promise((resolve,reject)=>{const asset=new pc.Asset(file.name,"container",{url:url});this.app.assets.add(asset);asset.once("error",reject);asset.once("load",()=>{try{const e=asset.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});e.name=file.name.replace(/\.[^.]+$/,"");this.root.addChild(e);const r=this.rec(e.name,"model",e);r.components.asset={type:"model",name:file.name};this.select(r.id);resolve({type:"model",record:r})}catch(err){reject(err)}});this.app.assets.load(asset)});
    return{type:"asset",name:file.name}
  }
  serialize(){return{format:"forge-scene",version:2,meta:{engine:"Forge Studio 2.0",time:new Date().toISOString()},entities:[...this.entities.values()].map(r=>{const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale();return{id:r.id,name:r.name,kind:r.kind,transform:{p:[p.x,p.y,p.z],r:[q.x,q.y,q.z],s:[s.x,s.y,s.z]},components:r.components,keyframes:this.keyframes.get(r.id)||[],script:this.scripts.get(r.id)||null}})}}
  async load(data,{assetRoot=""}={}){for(const r of [...this.entities.values()]){this.removePhysics(r.id);r.entity.destroy()}this.entities.clear();this.selectedId=null;this.keyframes.clear();this.scripts.clear();
    for(const d of data.entities||[]){
      if(d.kind==="terrain" && d.components?.terrain && window.ForgeTerrain){window.ForgeTerrain.generate(d.name,d.components.terrain);continue}
      const r=this.add(d.kind,d.name);const t=d.transform||{};
      r.entity.setLocalPosition(...(t.p||[0,0,0]));r.entity.setLocalEulerAngles(...(t.r||[0,0,0]));r.entity.setLocalScale(...(t.s||[1,1,1]));
      if(["box","sphere","cylinder","capsule","plane"].includes(d.kind)){
        r.entity.addComponent("render",{type:d.kind==="sphere"?"sphere":d.kind==="cylinder"?"cylinder":d.kind==="capsule"?"capsule":d.kind==="plane"?"plane":"box"});r.entity.render.material=this.material()
      }
      if(d.kind==="camera")r.entity.addComponent("camera",{clearColor:new pc.Color(.02,.05,.09)});
      if(d.kind==="light")r.entity.addComponent("light",{type:"directional",intensity:2,castShadows:true});
      r.components=d.components||{};
      if(d.components?.material){const previous=this.selectedId;this.selectedId=r.id;this.applyMaterial(d.components.material);this.selectedId=previous;}
      if(d.components?.physics)this.setPhysics(r.id,d.components.physics.mode,d.components.physics.shape);
      if(d.keyframes?.length)this.keyframes.set(r.id,d.keyframes);if(d.script)this.scripts.set(r.id,d.script);
      const asset=d.components?.asset;
      if(asset?.name && assetRoot){
        const url=assetRoot+"assets/"+encodeURIComponent(asset.name);
        if(asset.type==="model"){
          await new Promise((resolve,reject)=>{const a=new pc.Asset(asset.name,"container",{url});this.app.assets.add(a);a.once("error",reject);a.once("load",()=>{try{const child=a.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});child.name=r.name;const p=r.entity.getLocalPosition(),e=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale();r.entity.destroy();this.root.addChild(child);child.setLocalPosition(p.x,p.y,p.z);child.setLocalEulerAngles(e.x,e.y,e.z);child.setLocalScale(s.x,s.y,s.z);r.entity=child;child.__forge={id:r.id,kind:"model",name:r.name,components:r.components};const clips=this.attachAnimations(child,a.resource);if(clips.length)r.components.animation={clips,playing:true};this.entities.set(r.id,r);resolve()}catch(error){reject(error)}});this.app.assets.load(a)})
        }else if(asset.type==="image"){
          const a=new pc.Asset(asset.name,"texture",{url,flipY:true});this.app.assets.add(a);await new Promise((resolve,reject)=>{a.once("error",reject);a.once("load",resolve);this.app.assets.load(a)});const mat=this.material([1,1,1]);mat.diffuseMap=a.resource;mat.emissiveMap=a.resource;mat.emissive=new pc.Color(1,1,1);mat.update();if(!r.entity.render)r.entity.addComponent("render",{type:"plane"});r.entity.render.material=mat;r.entity.render.castShadows=false
        }
      }
    }
    this.frame()
  }
  diagnostics(){return{ok:true,renderer:this.app?.graphicsDevice?.isWebGPU?"WebGPU":"WebGL2",fps:Number(this.fps.toFixed(1)),frameMs:Number(this.frameMs.toFixed(2)),entities:this.entities.size,renderables:[...this.entities.values()].filter(r=>r.entity.render?.meshInstances?.length).length,physics:this.physics.size,scripts:this.scripts.size,tracks:this.keyframes.size,time:Number(this.timelineTime.toFixed(2))}}
}
export{pc,RAPIER};
// Future importer adapters may register .gltf directory/zip packages here without changing the scene schema.
