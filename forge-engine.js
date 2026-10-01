import * as pc from 'https://cdn.jsdelivr.net/npm/playcanvas@2.22.6/build/playcanvas.mjs';
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/+esm';

const V=(x=0,y=0,z=0)=>new pc.Vec3(x,y,z);
const ASSIMP_MODEL_EXTENSIONS=new Set("3ds 3mf ac ac3d acc amj ase ask b3d bvh cob dae dxf enff fbx ifc iqm irr irrmesh lwo lws lxo m3d md2 md3 md5 mdc mdl mesh mesh.xml mot ms3d ndo nff obj off ogex ply pmx prj q3o q3s raw scn sib smd stp stl ter uc usd vta x x3d xgl zgl".split(" "));
const MODEL_EXTENSIONS=new Set(["glb","gltf",...ASSIMP_MODEL_EXTENSIONS]);
const IMAGE_EXTENSIONS=new Set(["png","jpg","jpeg","webp","avif","gif","bmp","svg","tif","tiff","tga","dds","ktx","ktx2","hdr","exr"]);
const AUDIO_EXTENSIONS=new Set(["wav","mp3","ogg","m4a","aac","flac","webm"]);
const SOURCE_EXTENSIONS=new Set(["ttf","ttc","otf","css","js","mjs","glsl","vert","frag","wgsl","wasm","json","forge.json"]);
const extOf=name=>String(name||"").toLowerCase().includes(".")?String(name).toLowerCase().split(".").pop():"";
function rayAabb(o,d,a){
  const mn=a.getMin(),mx=a.getMax();let lo=-Infinity,hi=Infinity;
  for(const k of ['x','y','z']){
    if(Math.abs(d[k])<1e-8){if(o[k]<mn[k]||o[k]>mx[k])return null;continue}
    let t1=(mn[k]-o[k])/d[k],t2=(mx[k]-o[k])/d[k];if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)return null
  }
  return hi<0?null:Math.max(0,lo)
}
function rayTriangle(ro,rd,a,b,c){
  const e1=new pc.Vec3().sub2(b,a),e2=new pc.Vec3().sub2(c,a),p=new pc.Vec3().cross(rd,e2),det=e1.dot(p);
  if(Math.abs(det)<1e-8)return null;const inv=1/det,q=new pc.Vec3().sub2(ro,a),u=q.dot(p)*inv;if(u<0||u>1)return null;
  const v=q.cross(e1).dot(rd)*inv;if(v<0||u+v>1)return null;const t=e2.dot(q.cross(e1))*inv;return t>=0?t:null
}

export class ForgeEngine{
  constructor(canvas,log=()=>{}){
    this.canvas=canvas;this.log=log;this.app=null;this.root=null;this.entities=new Map();this.selectedId=null;this.assets=new Map();
    this.rapier=null;this.world=null;this.physics=new Map();this.keyframes=new Map();this.scripts=new Map();this.timelineTime=0;this.running=false;this.timelinePlaying=false;this.fps=0;this.frames=0;this.lastFPS=performance.now();this.frameMs=0;
    this.physicsAccumulator=0;this.physicsFixedDt=1/60;this.physicsMaxSubsteps=5;this.prePhysicsSystems=new Set();this.postPhysicsSystems=new Set();this.collisionListeners=new Set();this.colliderEntityMap=new Map();this.eventQueue=null;
    this.triangleCache=new WeakMap();this.pickBudget=120000;this.unitSystem='meters';this.viewMode='perspective';this.gizmoSpace='world';this.snapEnabled=false;this.snapSize=.25;this.history=[];this.redoStack=[];this.historyLimit=100;
  }
  async init(){
    this.app=new pc.Application(this.canvas,{graphicsDeviceOptions:{antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true}});
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);this.app.setCanvasResolution(pc.RESOLUTION_AUTO);this.app.scene.gammaCorrection=pc.GAMMA_SRGB;this.app.scene.toneMapping=pc.TONEMAP_ACES;this.app.scene.physicalUnits=true;this.app.scene.ambientLightColor=new pc.Color(.18,.22,.28);this.app.scene.ambientLightColor=new pc.Color(.18,.22,.28);
    this.root=new pc.Entity('ForgeScene');this.app.root.addChild(this.root);
    await RAPIER.init();this.rapier=RAPIER;this.world=new RAPIER.World({x:0,y:-9.81,z:0});this.eventQueue=new RAPIER.EventQueue(true);
    this.createCamera('Main Camera',{x:7,y:5,z:9});this.createLight('Sun');this.createPlane('Ground',30,30);this.app.scene.ambientLight=new pc.Color(.16,.18,.22);this.app.scene.exposure=1.15;
    this.app.on('update',dt=>this.update(dt));this.canvas.addEventListener('pointerdown',e=>this.pick(e));window.addEventListener('resize',()=>this.app.resizeCanvas());this.app.resizeCanvas();this.app.autoRender=true;this.app.start();this.app.render?.();this.log('Forge Engine 3.0 online');return this
  }
  rec(name,kind,e){const id=crypto.randomUUID();e.__forge={id,kind,name,components:{}};const r={id,kind,name,entity:e,components:e.__forge.components};this.entities.set(id,r);return r}
  add(kind,name){const e=new pc.Entity(name);this.root.addChild(e);return this.rec(name,kind,e)}
  material(color=[.22,.62,.9]){const m=new pc.StandardMaterial();m.diffuse=new pc.Color(...color);m.emissive=new pc.Color(...color);m.emissiveIntensity=2;m.metalness=.0;m.gloss=.5;m.useMetalness=false;m.useLighting=false;m.useTonemap=false;m.specular=new pc.Color(0,0,0);m.update();return m}
  primitive(kind,name){const r=this.add(kind,name||kind+'-'+(this.entities.size+1)),type=kind==='sphere'?'sphere':kind==='cylinder'?'cylinder':kind==='capsule'?'capsule':kind==='plane'?'plane':'box';r.entity.addComponent('render',{type});r.entity.render.layers=[pc.LAYERID_WORLD];r.entity.render.frustumCulling=false;r.entity.render.enabled=true;r.entity.render.material=this.material(kind==='plane'?[.08,.15,.2]:[.22,.62,.9]);if(kind!=='plane')r.entity.setLocalPosition((Math.random()-.5)*4,1+(Math.random()*1.7),(Math.random()-.5)*4);r.components.geometry={sourceUnits:'meters'};return r}
  createPlane(name,w=30,d=30){const r=this.primitive('plane',name);r.entity.setLocalScale(w,1,d);r.entity.setLocalPosition(0,0,0);if(name==='Ground')r.entity.render.layers=[];this.setPhysics(r.id,'fixed','box');return r}
  createCamera(name,pos){const r=this.add('camera',name);r.entity.addComponent('camera',{clearColor:new pc.Color(.035,.07,.12),clearColorBuffer:true,clearDepthBuffer:true,fov:60,nearClip:.01,farClip:10000,enabled:true,layers:[pc.LAYERID_WORLD]});r.entity.addComponent('audiolistener');r.entity.setLocalPosition(pos.x,pos.y,pos.z);r.entity.lookAt(0,1,0);r.components.camera={active:true};r.entity.camera.enabled=true;return r}
  createLight(name){const r=this.add('light',name);r.entity.addComponent('light',{type:'directional',color:new pc.Color(1,.96,.88),intensity:2.5,castShadows:true,shadowDistance:80,enabled:true,layers:[pc.LAYERID_WORLD]});r.entity.setEulerAngles(48,-32,0);r.components.light={type:'directional'};return r}
  camera(){return[...this.entities.values()].find(r=>r.kind==='camera'&&r.components.camera?.active)?.entity}
  selected(){return this.selectedId?this.entities.get(this.selectedId):null}
  select(id){this.selectedId=id;window.dispatchEvent(new CustomEvent('forge-selection',{detail:this.selected()}));return this.selected()}
  setView(mode){
    const cam=this.camera();if(!cam?.camera)return false;
    const selected=this.selected(),inspected=selected&&this.spatial?.inspect?.(selected);
    const target=selected?.entity.getPosition()||new pc.Vec3(0,1,0);
    const radius=Math.max(.5,Number(inspected?.world?.radius||0)||0.5);
    const dist=Math.max(3,radius*3.2);
    const positions={front:new pc.Vec3(target.x,target.y,target.z+dist),back:new pc.Vec3(target.x,target.y,target.z-dist),left:new pc.Vec3(target.x-dist,target.y,target.z),right:new pc.Vec3(target.x+dist,target.y,target.z),top:new pc.Vec3(target.x,target.y+dist,target.z),bottom:new pc.Vec3(target.x,target.y-dist,target.z)};
    if(mode==='perspective'){
      this.viewMode='perspective';cam.camera.projection=pc.PROJECTION_PERSPECTIVE;
      cam.setPosition(target.x+dist*.75,target.y+dist*.5,target.z+dist);cam.lookAt(target)
    }else if(positions[mode]){
      this.viewMode=mode;cam.camera.projection=pc.PROJECTION_ORTHOGRAPHIC;
      cam.camera.orthoHeight=Math.max(.5,radius*2.35);
      cam.setPosition(positions[mode]);cam.lookAt(target)
    }
    this.app?.resizeCanvas?.();
    return true
  }
  applyMaterial(params={}){
    const r=this.selected();if(!r)return false;if(r.components?.asset)r.components.asset.derivedDirty=true;const color=params.color||[.22,.62,.9],mats=[],walk=e=>{for(const mi of(e.render?.meshInstances||[])){let m=mi.material?.clone?.()||this.material(color);m.diffuse=new pc.Color(...color);if(params.metalness!=null)m.metalness=Number(params.metalness);if(params.roughness!=null)m.gloss=1-Number(params.roughness);if(params.opacity!=null){m.opacity=Number(params.opacity);m.blendType=params.opacity<1?pc.BLEND_NORMAL:pc.BLEND_NONE;m.alphaTest=params.opacity<1?.01:0}if(params.emissive){m.emissive=new pc.Color(...params.emissive);m.emissiveIntensity=Number(params.emissiveIntensity||0)}m.update();mi.material=m;mats.push(m)}for(const c of e.children)walk(c)};walk(r.entity);
    r.components.material={color,metalness:Number(params.metalness??.05),roughness:Number(params.roughness??.5),opacity:Number(params.opacity??1),emissive:params.emissive||[0,0,0]};return mats.length
  }
  materialState(){return this.selected()?.components.material||null}
  onPrePhysics(fn){this.prePhysicsSystems.add(fn);return()=>this.prePhysicsSystems.delete(fn)}
  onPostPhysics(fn){this.postPhysicsSystems.add(fn);return()=>this.postPhysicsSystems.delete(fn)}
  onCollision(fn){this.collisionListeners.add(fn);return()=>this.collisionListeners.delete(fn)}
  emitCollision(h1,h2,started){const e1=this.entities.get(this.colliderEntityMap.get(h1)),e2=this.entities.get(this.colliderEntityMap.get(h2));for(const fn of this.collisionListeners){try{fn({handle1:h1,handle2:h2,started,a:e1,b:e2})}catch(e){this.log('Collision listener error: '+e.message,'error')}}}
  setPhysics(id,mode,shape){
    const r=this.entities.get(id);if(!r||!this.world)return;this.removePhysics(id);const p=r.entity.getPosition();
    let body=mode==='fixed'?this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(p.x,p.y,p.z)):mode==='kinematic'?this.world.createRigidBody(this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.y,p.z)):this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z));
    const s=r.entity.getLocalScale();let c=shape==='ball'?this.rapier.ColliderDesc.ball(Math.max(.2,Math.max(s.x,s.y,s.z)*.5)):shape==='capsule'?this.rapier.ColliderDesc.capsule(Math.max(.2,s.y*.5),Math.max(.15,s.x*.5)):this.rapier.ColliderDesc.cuboid(Math.max(.15,s.x*.5),Math.max(.15,s.y*.5),Math.max(.15,s.z*.5));
    c.setActiveEvents?.(this.rapier.ActiveEvents.COLLISION_EVENTS);const collider=this.world.createCollider(c,body);this.physics.set(id,{body,collider,mode,shape,colliderHandle:collider.handle});this.colliderEntityMap.set(collider.handle,id);r.components.physics={mode,shape}
  }
  removePhysics(id){const p=this.physics.get(id);if(p&&this.world){this.colliderEntityMap.delete(p.collider?.handle);try{this.world.removeRigidBody(p.body,true)}catch{}}this.physics.delete(id);const r=this.entities.get(id);if(r)delete r.components.physics}
  resetScene(includeDefaults=true){for(const r of[...this.entities.values()]){this.removePhysics(r.id);r.entity.destroy()}this.entities.clear();this.selectedId=null;this.keyframes.clear();this.scripts.clear();if(includeDefaults){this.createCamera('Main Camera',{x:7,y:5,z:9});this.createLight('Sun');this.createPlane('Ground',30,30)}this.frame()}
  update(dt){
    this.frameMs=dt*1000;this.frames++;const now=performance.now();if(now-this.lastFPS>800){this.fps=this.frames*1000/(now-this.lastFPS);this.frames=0;this.lastFPS=now}
    const frameDt=Math.min(.1,Math.max(0,dt));
    if(this.world){this.physicsAccumulator=Math.min(this.physicsAccumulator+frameDt,this.physicsFixedDt*this.physicsMaxSubsteps);let steps=0;while(this.physicsAccumulator>=this.physicsFixedDt&&steps<this.physicsMaxSubsteps){for(const fn of this.prePhysicsSystems){try{fn(this.physicsFixedDt)}catch(e){this.log('Pre-physics error: '+e.message,'error')}}this.world.step(this.eventQueue);this.eventQueue?.drainCollisionEvents((h1,h2,started)=>this.emitCollision(h1,h2,started));for(const fn of this.postPhysicsSystems){try{fn(this.physicsFixedDt)}catch(e){this.log('Post-physics error: '+e.message,'error')}}this.physicsAccumulator-=this.physicsFixedDt;steps++}for(const[id,p]of this.physics){if(p.mode==='fixed')continue;const r=this.entities.get(id);if(!r)continue;const t=p.body.translation(),q=p.body.rotation();r.entity.setPosition(t.x,t.y,t.z);r.entity.setRotation(q.x,q.y,q.z,q.w)}}
    if(this.timelinePlaying){this.timelineTime+=frameDt;this.evalAnimation(this.timelineTime)}if(this.running)this.runScripts(frameDt)
  }
  worldBounds(){
    const b={min:V(Infinity,Infinity,Infinity),max:V(-Infinity,-Infinity,-Infinity)};let count=0;
    for(const r of this.entities.values())for(const mi of(r.entity.render?.meshInstances||[])){const a=mi.aabb;if(!a)continue;const mn=a.getMin(),mx=a.getMax();for(const p of[V(mn.x,mn.y,mn.z),V(mx.x,mn.y,mn.z),V(mn.x,mx.y,mn.z),V(mx.x,mx.y,mn.z),V(mn.x,mn.y,mx.z),V(mx.x,mn.y,mx.z),V(mn.x,mx.y,mx.z),V(mx.x,mx.y,mx.z)]){b.min.x=Math.min(b.min.x,p.x);b.min.y=Math.min(b.min.y,p.y);b.min.z=Math.min(b.min.z,p.z);b.max.x=Math.max(b.max.x,p.x);b.max.y=Math.max(b.max.y,p.y);b.max.z=Math.max(b.max.z,p.z)}count++}
    if(!count)return null;const size=V(b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z),center=V((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2,(b.min.z+b.max.z)/2);return{...b,size,center,radius:Math.max(size.x,size.y,size.z)*.5}
  }
  frame(){const cam=this.camera();if(!cam)return;const target=this.selected()?.entity.getPosition()||this.worldBounds()?.center||new pc.Vec3(0,1,0);let rad=2;const sel=this.selected();if(sel){const s=this.spatial?.inspect(sel);if(s)rad=Math.max(.5,s.world.radius)}else{const b=this.worldBounds();if(b)rad=Math.max(.5,b.radius)}const dist=Math.max(4,rad*2.6);cam.setPosition(target.x+dist*.85,target.y+dist*.55,target.z+dist);cam.lookAt(target)}
  focus(){const r=this.selected(),cam=this.camera();if(!r||!cam)return;const target=r.entity.getPosition(),d=Math.max(4,(this.spatial?.inspect(r)?.world.radius||1)*3);cam.setPosition(target.x+d*.7,target.y+d*.45,target.z+d);cam.lookAt(target)}
  _rayFromScreen(e){const cam=this.camera();if(!cam?.camera)return null;const rect=this.canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,a=cam.camera.screenToWorld(x,y,cam.camera.nearClip),b=cam.camera.screenToWorld(x,y,cam.camera.farClip),d=new pc.Vec3().sub2(b,a).normalize();return{a,b,d}}
  _triangleData(mesh){if(this.triangleCache.has(mesh))return this.triangleCache.get(mesh);let positions=null,indices=null;try{positions=mesh.getPositions?.();indices=mesh.getIndices?.()}catch{positions=null}const data={positions,indices};this.triangleCache.set(mesh,data);return data}
  pick(e){
    const ray=this._rayFromScreen(e);if(!ray)return null;let best=null,bt=Infinity;const candidates=[];
    for(const r of this.entities.values())for(const mi of(r.entity.render?.meshInstances||[])){const t=rayAabb(ray.a,ray.d,mi.aabb);if(t!==null&&t<bt+10)candidates.push({r,mi,t})}
    candidates.sort((a,b)=>a.t-b.t);let tested=0;
    for(const c of candidates){
      const data=this._triangleData(c.mi.mesh);
      if(!data.positions||tested>this.pickBudget){if(c.t<bt){bt=c.t;best=c.r}continue}
      const inv=(c.mi.node?.getWorldTransform?.()||c.r.entity.getWorldTransform()).clone().invert(),ro=inv.transformPoint(ray.a.clone()),rp=inv.transformPoint(ray.a.clone().add(ray.d.clone())),rd=new pc.Vec3().sub2(rp,ro).normalize();
      let hit=null;const prims=c.mi.mesh.primitive||[{base:0,count:data.indices?data.indices.length:data.positions.length/3,indexed:!!data.indices}];
      for(const p of prims){if(p.type!==pc.PRIMITIVE_TRIANGLES)continue;const end=p.base+p.count;
        if(p.indexed&&data.indices){for(let i=p.base;i<end;i+=3){const ia=data.indices[i],ib=data.indices[i+1],ic=data.indices[i+2],a=V(data.positions[ia*3],data.positions[ia*3+1],data.positions[ia*3+2]),b=V(data.positions[ib*3],data.positions[ib*3+1],data.positions[ib*3+2]),cc=V(data.positions[ic*3],data.positions[ic*3+1],data.positions[ic*3+2]),t=rayTriangle(ro,rd,a,b,cc);tested++;if(t!=null&&(hit==null||t<hit))hit=t;if(tested>this.pickBudget)break}}
        else{for(let i=p.base;i<end;i+=3){const a=V(data.positions[i*3],data.positions[i*3+1],data.positions[i*3+2]),b=V(data.positions[(i+1)*3],data.positions[(i+1)*3+1],data.positions[(i+1)*3+2]),cc=V(data.positions[(i+2)*3],data.positions[(i+2)*3+1],data.positions[(i+2)*3+2]),t=rayTriangle(ro,rd,a,b,cc);tested++;if(t!=null&&(hit==null||t<hit))hit=t;if(tested>this.pickBudget)break}}
      }
      if(hit!=null){const worldHit=c.mi.node?.getWorldTransform?.().transformPoint(ro.clone().add(rd.clone().mulScalar(hit)))||ray.a.clone().add(ray.d.clone().mulScalar(c.t)),wt=worldHit.distance(ray.a);if(wt<bt){bt=wt;best=c.r}}
    }
    if(best)this.select(best.id);return best
  }
  _transformState(r){if(!r)return null;const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale(),nz=v=>Object.is(v,-0)?0:v;return{p:[nz(p.x),nz(p.y),nz(p.z)],r:[nz(q.x),nz(q.y),nz(q.z)],s:[nz(s.x),nz(s.y),nz(s.z)]}}
  _applyTransformState(r,state){if(!r||!state)return false;r.entity.setLocalPosition(...state.p);r.entity.setLocalEulerAngles(...state.r);r.entity.setLocalScale(...state.s);return true}
  recordTransformHistory(id,before,after){if(!id||!before||!after)return false;if(JSON.stringify(before)===JSON.stringify(after))return false;this.history.push({type:'transform',id,before,after});if(this.history.length>this.historyLimit)this.history.shift();this.redoStack.length=0;return true}
  transform(v,options={}){
    const r=this.selected();if(r?.components?.asset)r.components.asset.derivedDirty=true;if(!r)return null;const before=this._transformState(r),p=r.entity.getLocalPosition(),rot=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale(),snap=n=>{const v=this.snapEnabled?Math.round(Number(n)/this.snapSize)*this.snapSize:Number(n);return Object.is(v,-0)?0:v};
    r.entity.setLocalPosition(Number.isFinite(v.x)?snap(v.x):p.x,Number.isFinite(v.y)?snap(v.y):p.y,Number.isFinite(v.z)?snap(v.z):p.z);r.entity.setLocalEulerAngles(Number.isFinite(v.rx)?v.rx:rot.x,Number.isFinite(v.ry)?v.ry:rot.y,Number.isFinite(v.rz)?v.rz:rot.z);r.entity.setLocalScale(Number.isFinite(v.sx)?Math.max(.0001,v.sx):s.x,Number.isFinite(v.sy)?Math.max(.0001,v.sy):s.y,Number.isFinite(v.sz)?Math.max(.0001,v.sz):s.z);if(options.history!==false)this.recordTransformHistory(r.id,before,this._transformState(r));return r
  }
  undo(){const h=this.history.pop();if(!h)return false;const r=this.entities.get(h.id);if(!r){this.redoStack.push(h);return false}this._applyTransformState(r,h.before);this.redoStack.push(h);this.select(r.id);return true}
  redo(){const h=this.redoStack.pop();if(!h)return false;const r=this.entities.get(h.id);if(!r){this.history.push(h);return false}this._applyTransformState(r,h.after);this.history.push(h);this.select(r.id);return true}
  setWorldPosition(id,p){const r=this.entities.get(id);if(!r)return false;r.entity.setPosition(Number(p.x)||0,Number(p.y)||0,Number(p.z)||0);return true}
  duplicate(){const r=this.selected();if(!r)return null;const e=r.entity.clone();e.name=r.name+' Copy';this.root.addChild(e);const n=this.rec(e.name,r.kind,e);n.components=JSON.parse(JSON.stringify(r.components));const p=e.getLocalPosition();e.setLocalPosition(p.x+1,p.y,p.z);if(n.components.physics)this.setPhysics(n.id,n.components.physics.mode,n.components.physics.shape);this.select(n.id);return n}
  delete(){const r=this.selected();if(!r)return;this.removePhysics(r.id);r.entity.destroy();this.entities.delete(r.id);this.selectedId=null;window.dispatchEvent(new CustomEvent('forge-selection'))}
  key(){const r=this.selected();if(!r)return;const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale(),a=this.keyframes.get(r.id)||[];a.push({time:this.timelineTime,p:[p.x,p.y,p.z],r:[q.x,q.y,q.z],s:[s.x,s.y,s.z]});a.sort((x,y)=>x.time-y.time);this.keyframes.set(r.id,a)}
  evalAnimation(t){for(const[id,a]of this.keyframes){const r=this.entities.get(id);if(!r||!a.length)continue;let k=a[0];for(let i=0;i<a.length-1;i++)if(t>=a[i].time&&t<=a[i+1].time){const A=a[i],B=a[i+1],f=(t-A.time)/Math.max(.0001,B.time-A.time);k={p:A.p.map((v,j)=>v+(B.p[j]-v)*f),r:A.r.map((v,j)=>v+(B.r[j]-v)*f),s:A.s.map((v,j)=>v+(B.s[j]-v)*f)};break}r.entity.setLocalPosition(...k.p);r.entity.setLocalEulerAngles(...k.r);r.entity.setLocalScale(...k.s)}}
  attachScript(id,code){this.scripts.set(id,code)}
  runScripts(dt){for(const[id,code]of this.scripts){const r=this.entities.get(id);if(!r)continue;try{new Function('api',code)({entity:r.entity,time:this.timelineTime,dt,engine:this})}catch(e){this.log('Script error '+e.message,'error')}}}
  assetImportCapabilities(){
    return{
      native3D:["glb","gltf"],
      assimpWasm:[...ASSIMP_MODEL_EXTENSIONS].sort(),
      images:[...IMAGE_EXTENSIONS].sort(),
      audio:[...AUDIO_EXTENSIONS].sort(),
      source:[...SOURCE_EXTENSIONS].sort(),
      notes:{
        native3D:"glTF/GLB is loaded directly in the PlayCanvas runtime.",
        assimpWasm:"40+ legacy/industry formats are normalized to an internal GLB representation while the original source bytes remain preserved.",
        images:"Raster/vector sources are kept as source assets; raster formats with browser decoders can be previewed directly.",
        audio:"Browser-supported audio is registered as a real Forge Sound asset.",
        source:"Non-renderable source files are preserved with type metadata for project pipelines."
      }
    }
  }
  async sha256File(file){
    const bytes=await file.arrayBuffer();
    if(globalThis.crypto?.subtle){
      const hash=await crypto.subtle.digest("SHA-256",bytes);
      return[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("");
    }
    return null;
  }
  async fileToDataUri(file){
    const bytes=new Uint8Array(await file.arrayBuffer());
    let binary="";
    for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
    return"data:"+(file.type||"application/octet-stream")+";base64,"+btoa(binary);
  }
  async packageExternalGltf(file,bundle=[]){
    const json=JSON.parse(await file.text());
    const sources=[file,...(bundle||[])].filter(Boolean);
    const pathOf=f=>String(f.webkitRelativePath||f.name||"").replaceAll("\\","/").replace(/^\.\//,"").toLowerCase();
    const map=new Map(sources.map(f=>[pathOf(f),f]));
    const byBase=new Map(sources.map(f=>[pathOf(f).split("/").at(-1),f]));
    const resolve=uri=>{
      const clean=decodeURIComponent(String(uri).split(/[?#]/)[0]).replaceAll("\\","/").replace(/^\.\//,"").toLowerCase();
      return map.get(clean)||byBase.get(clean.split("/").at(-1));
    };
    const patch=async list=>{
      for(const item of list||[]){
        if(!item?.uri||String(item.uri).startsWith("data:"))continue;
        const f=resolve(item.uri);
        if(!f)throw new Error("Missing glTF dependency: "+item.uri);
        item.uri=await this.fileToDataUri(f);
      }
    };
    await patch(json.buffers);await patch(json.images);
    return new File([JSON.stringify(json)],file.name,{type:"model/gltf+json"});
  }
  importedModelBounds(root){
    const min=new pc.Vec3(Infinity,Infinity,Infinity),max=new pc.Vec3(-Infinity,-Infinity,-Infinity);
    root.syncHierarchy?.();
    root.forEach(n=>{
      for(const mi of n.render?.meshInstances||[]){
        const a=mi.aabb,mn=a?.getMin?.()||a?.min,mx=a?.getMax?.()||a?.max;
        if(!mn||!mx)continue;
        min.x=Math.min(min.x,mn.x);min.y=Math.min(min.y,mn.y);min.z=Math.min(min.z,mn.z);
        max.x=Math.max(max.x,mx.x);max.y=Math.max(max.y,mx.y);max.z=Math.max(max.z,mx.z);
      }
    });
    if(!Number.isFinite(min.x))return null;
    return{min,max,size:new pc.Vec3(max.x-min.x,max.y-min.y,max.z-min.z),center:new pc.Vec3((min.x+max.x)/2,(min.y+max.y)/2,(min.z+max.z)/2)};
  }
  normalizeImportedModel(root,targetSize=2.4){
    const b=this.importedModelBounds(root);if(!b)return{ok:false,scale:1};
    const extent=Math.max(b.size.x,b.size.y,b.size.z),scale=extent>1e-6?targetSize/extent:1;
    root.setLocalScale(scale,scale,scale);
    root.setLocalPosition(-b.center.x*scale,targetSize*.5-b.center.y*scale,-b.center.z*scale);
    root.syncHierarchy?.();
    return{ok:true,scale,sourceSize:[b.size.x,b.size.y,b.size.z],targetSize};
  }
  prepareImportedModelPreview(root){
    let textured=0,previewAdjusted=0,cullAdjusted=0,pbrPreserved=0;
    root.forEach(n=>{
      for(const mi of n.render?.meshInstances||[]){
        const mat=mi.material;
        if(!mat)continue;
        const preview=mat.clone?.()||this.material([.62,.68,.76]);
        const hasMap=!!mat.diffuseMap;
        const hadPbr=!!(mat.metalnessMap||mat.glossMap||mat.normalMap||mat.emissiveMap||mat.useMetalness);
        if(hasMap){
          textured++;
          preview.diffuse=new pc.Color(1,1,1);
          preview.diffuseMap=mat.diffuseMap;
          if(!mat.emissiveMap){
            preview.emissiveMap=mat.diffuseMap;
            preview.emissive=new pc.Color(1,1,1);
            preview.emissiveIntensity=Math.min(.18,Number(mat.emissiveIntensity||.18));
          }
        }else if(!preview.diffuse){
          preview.diffuse=new pc.Color(.62,.68,.76);
          preview.emissive=new pc.Color(.06,.08,.11);
          preview.emissiveIntensity=.08;
        }
        preview.useLighting=true;
        preview.useMetalness=true;
        preview.useTonemap=true;
        if(hadPbr)pbrPreserved++;
        if("cull" in preview)preview.cull=pc.CULLFACE_NONE;
        if("blendType" in preview)preview.blendType=Number(preview.opacity||1)<1?pc.BLEND_NORMAL:pc.BLEND_NONE;
        if("opacity" in preview&&preview.opacity==null)preview.opacity=1;
        preview.alphaTest=Number(preview.alphaTest||0);
        preview.update?.();
        mi.material=preview;
        previewAdjusted++;
        if(preview.cull===pc.CULLFACE_NONE)cullAdjusted++;
      }
    });
    const normalized=this.normalizeImportedModel(root,2.4);
    root.__forgeViewportPreview={textured,previewAdjusted,cullAdjusted,pbrPreserved,normalized};
    return root.__forgeViewportPreview;
  }

  async convertLegacyModelToGLB(file,bundle=[]){
    const files=[file,...(bundle||[])].filter(Boolean);
    const unique=[...new Map(files.map(f=>[f.name.replaceAll("\\","/"),f])).values()];
    if(!window.__ForgeAssimpJS){
      if(!window.__ForgeAssimpLoading){
        window.__ForgeAssimpLoading=new Promise((resolve,reject)=>{
          if(typeof window.assimpjs==="function"){resolve(window.assimpjs);return}
          const s=document.createElement("script");
          s.src="https://cdn.jsdelivr.net/npm/assimpjs@0.0.10/dist/assimpjs.js";
          s.async=true;
          s.onload=()=>resolve(window.assimpjs);
          s.onerror=()=>reject(new Error("AssimpJS loader failed"));
          document.head.appendChild(s);
        }).then(factory=>{
          if(typeof factory!=="function")throw new Error("AssimpJS global API unavailable");
          return factory();
        });
      }
      window.__ForgeAssimpJS=await window.__ForgeAssimpLoading;
    }
    const ajs=window.__ForgeAssimpJS;
    const list=new ajs.FileList();
    for(const source of unique)list.AddFile(String(source.webkitRelativePath||source.name).replaceAll("\\","/"),new Uint8Array(await source.arrayBuffer()));
    const result=ajs.ConvertFileList(list,"glb2");
    if(!result?.IsSuccess?.()||!result?.FileCount?.())throw new Error("Legacy 3D conversion failed: "+String(result?.GetErrorCode?.()||"unknown AssimpJS error"));
    const out=result.GetFile(0);
    return new File([out.GetContent()],file.name.replace(/\.[^.]+$/,"")+".glb",{type:"model/gltf-binary"});
  }
  async sanitizeGlbPreview(file){
    const name=String(file?.name||"").toLowerCase();
    if(!name.endsWith(".glb"))return{file,sanitized:false,removedExtensions:[]};
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length<20)return{file,sanitized:false,removedExtensions:[]};
    const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(dv.getUint32(0,true)!==0x46546c67||dv.getUint32(4,true)!==2)return{file,sanitized:false,removedExtensions:[]};
    const total=dv.getUint32(8,true);
    let off=12,json=null,chunks=[];
    while(off+8<=Math.min(total,bytes.length)){
      const length=dv.getUint32(off,true),type=dv.getUint32(off+4,true),start=off+8,end=start+length;
      if(end>bytes.length)break;
      const chunk=bytes.slice(start,end);
      chunks.push({type,bytes:chunk});
      if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(chunk).trim());
      off=end;
    }
    if(!json)return{file,sanitized:false,removedExtensions:[]};
    const unsupported=new Set([
      "KHR_materials_clearcoat","KHR_materials_emissive_strength","KHR_materials_iridescence",
      "KHR_materials_transmission","KHR_materials_variants","KHR_texture_transform"
    ]);
    const used=[...(json.extensionsUsed||[])].filter(x=>unsupported.has(x));
    const required=[...(json.extensionsRequired||[])].filter(x=>unsupported.has(x));
    if(required.length)throw new Error("GLB requires unsupported glTF extensions: "+required.join(", "));
    if(!used.length)return{file,sanitized:false,removedExtensions:[]};
    const strip=o=>{
      if(!o||typeof o!=="object")return;
      if(Array.isArray(o)){for(const v of o)strip(v);return}
      if(o.extensions&&typeof o.extensions==="object"){
        for(const k of unsupported)o.extensions[k]===undefined||delete o.extensions[k];
        if(!Object.keys(o.extensions).length)delete o.extensions;
      }
      for(const v of Object.values(o))strip(v);
    };
    strip(json);
    json.extensionsUsed=(json.extensionsUsed||[]).filter(x=>!unsupported.has(x));
    json.extensionsRequired=(json.extensionsRequired||[]).filter(x=>!unsupported.has(x));
    if(!json.extensionsUsed.length)delete json.extensionsUsed;
    if(!json.extensionsRequired.length)delete json.extensionsRequired;
    const encoder=new TextEncoder();
    const jb=encoder.encode(JSON.stringify(json));
    const pad4=n=>(n+3)&~3;
    const jp=new Uint8Array(pad4(jb.length));jp.set(jb);jp.fill(0x20,jb.length);
    const outChunks=[{type:0x4e4f534a,bytes:jp},...chunks.filter(c=>c.type!==0x4e4f534a).map(c=>({type:c.type,bytes:new Uint8Array(c.bytes)}))];
    const totalLength=12+outChunks.reduce((n,c)=>n+8+c.bytes.length,0);
    const out=new Uint8Array(totalLength),od=new DataView(out.buffer);od.setUint32(0,0x46546c67,true);od.setUint32(4,2,true);od.setUint32(8,totalLength,true);
    let w=12;
    for(const c of outChunks){od.setUint32(w,c.bytes.length,true);od.setUint32(w+4,c.type,true);out.set(c.bytes,w+8);w+=8+c.bytes.length}
    return{file:new File([out],file.name,{type:"model/gltf-binary"}),sanitized:true,removedExtensions:used};
  }

  async importFile(file,options={}){
    const url=URL.createObjectURL(file);if(file.name.toLowerCase().endsWith('.forge.json'))return{type:'project',data:JSON.parse(await file.text())};
    let analysis=null;try{analysis=await window.ForgeProduction?.assets?.analyze?.(file)}catch{}
    if(/^audio\//.test(file.type) || /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(file.name)){
      let asset=null;
      await new Promise((resolve,reject)=>{
        this.app.assets.loadFromUrlAndFilename(url,file.name,'audio',(err,loaded)=>{
          if(err){reject(err);return}
          asset=loaded;resolve();
        });
      });
      const r=this.add('audio',file.name);
      r.entity.addComponent('sound',{positional:true,volume:1});
      r.entity.sound.addSlot('main',{asset:asset.id,autoPlay:false,loop:false,overlap:false,volume:1,pitch:1});
      r.components.asset={type:'audio',name:file.name,analysis,sourceBytes:file.size,sourceSha256:await this.sha256File(file),remoteSource:options.remoteSource||null,derivedDirty:false};
      this.assets.set(file.name,{type:'audio',file,url,resource:asset.resource,asset});
      this.select(r.id);
      window.dispatchEvent(new Event('forge-assets-changed'));
      window.ForgeRefreshUI?.();
      return{type:'audio',record:r,asset};
    }
    if(/^image\//.test(file.type)){
      const bmp=await createImageBitmap(file);
      const c=document.createElement("canvas");c.width=bmp.width;c.height=bmp.height;c.getContext("2d").drawImage(bmp,0,0);
      const tex=new pc.Texture(this.app.graphicsDevice,{width:bmp.width,height:bmp.height,format:pc.PIXELFORMAT_R8_G8_B8_A8});
      tex.setSource(c);
      const mat=new pc.StandardMaterial();
      mat.diffuse=new pc.Color(1,1,1);mat.diffuseMap=tex;
      mat.emissive=new pc.Color(1,1,1);mat.emissiveMap=tex;mat.emissiveIntensity=.35;
      mat.useLighting=false;mat.useTonemap=false;mat.cull=pc.CULLFACE_NONE;mat.blendType=pc.BLEND_NONE;mat.opacity=1;mat.alphaTest=0;mat.update();
      const r=this.primitive("plane",file.name);
      const h=2.6,w=Math.max(.25,h*(bmp.width/Math.max(1,bmp.height)));
      r.entity.setLocalEulerAngles(90,0,0);r.entity.setLocalScale(w,1,h);r.entity.setLocalPosition(0,h*.5,0);
      r.entity.render.material=mat;r.entity.render.frustumCulling=false;
      r.components.asset={type:"image",name:file.name,width:bmp.width,height:bmp.height,analysis,sourceBytes:file.size,sourceSha256:await this.sha256File(file),remoteSource:options.remoteSource||null,sourceUnits:"pixels",presentation:"upright-2d-preview",pixelsPerWorldUnit:bmp.height/h,derivedDirty:false};
      this.assets.set(file.name,{type:"image",file,url});this.select(r.id);this.setView("front");this.frame();
      window.dispatchEvent(new Event("forge-assets-changed"));window.ForgeRefreshUI?.();
      return{type:"image",record:r};
    }
    if(/\.(glb|gltf|fbx|obj|dae|3ds)$/i.test(file.name)){
      if(/\.(fbx|obj|dae|3ds)$/i.test(file.name)){
        const converted=await this.convertLegacyModelToGLB(file,options?.files||[file]);
        const convertedResult=await this.importFile(converted,{internalConversion:true,sourceFile:file,remoteSource:options.remoteSource,files:options.files});
        const record=convertedResult.record,internalEntry=this.assets.get(converted.name);
        this.assets.delete(converted.name);
        this.assets.set(file.name,{type:"model",file,url,resource:internalEntry?.resource,converted:true,convertedFrom:file.name});
        record.name=file.name.replace(/\.[^.]+$/,"");record.entity.name=record.name;
        record.components.asset={...record.components.asset,type:"model",name:file.name,analysis:analysis||null,sourceUnits:"source-native",sourceBytes:file.size,sourceSha256:await this.sha256File(file),remoteSource:options.remoteSource||null,converted:true,convertedFrom:file.name,converter:"AssimpJS",sourcePreserved:true,dependencyFiles:(options.files||[]).map(f=>f.name).filter(n=>n!==file.name),derivedDirty:false,importScale:record.components.asset?.importScale||1,normalized:!!record.components.asset?.normalized,viewportPreview:record.components.asset?.viewportPreview||null};
        this.select(record.id);window.dispatchEvent(new Event("forge-assets-changed"));window.ForgeRefreshUI?.();
        return{type:"model",record,converted:true};
      }
      return new Promise(async(resolve,reject)=>{
        try{
          if(/\.gltf$/i.test(file.name)){
            const json=JSON.parse(await file.text());
            const external=[...(json.buffers||[]),...(json.images||[])].some(x=>x?.uri&&!String(x.uri).startsWith("data:"));
            if(external)throw new Error("This glTF still references external files; select its dependency files together so Forge can package them.");
          }
          const previewSource=await this.sanitizeGlbPreview(file);
          const loadFile=previewSource.file;
          const loadUrl=URL.createObjectURL(loadFile);
          const asset=new pc.Asset(file.name,"container",{url:loadUrl});
          this.app.assets.add(asset);
          asset.once("error",err=>{URL.revokeObjectURL(loadUrl);reject(err)});
          asset.once("load",()=>{
            try{
              const e=asset.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});
              e.name=file.name.replace(/\.[^.]+$/,"");this.root.addChild(e);
              const preview=this.prepareImportedModelPreview(e),r=this.rec(e.name,"model",e);
              r.components.asset={
                type:"model",name:file.name,analysis:analysis||null,sourceUnits:"source-native",sourceBytes:file.size,sourceSha256:await this.sha256File(file),remoteSource:options.remoteSource||null,dependencyFiles:(options.files||[]).map(f=>f.name).filter(n=>n!==file.name),
                sourcePreserved:true,viewportSanitized:previewSource.sanitized===true,
                sanitizedExtensions:previewSource.removedExtensions||[],
                importScale:preview.normalized?.scale||1,normalized:!!preview.normalized?.ok,
                derivedDirty:false,viewportPreview:preview
              };
              const clips=this.attachAnimations(e,asset.resource,analysis?.animationNames||[]);if(clips.length)r.components.animation={clips,playing:true};
              this.assets.set((sourceFile||file).name,{type:"model",file:sourceFile||file,url,resource:asset.resource,asset,viewportFile:loadFile,dependencies:options.files||[sourceFile||file]});
              URL.revokeObjectURL(loadUrl);
              window.dispatchEvent(new Event("forge-assets-changed"));window.ForgeRefreshUI?.();
              requestAnimationFrame(()=>requestAnimationFrame(()=>{this.select(r.id);window.ForgeSpatial?.inspect?.(r);resolve({type:"model",record:r})}));
            }catch(err){URL.revokeObjectURL(loadUrl);reject(err)}
          });
          this.app.assets.load(asset);
        }catch(err){reject(err)}
      });
    }
    return{type:'asset',name:file.name,analysis,sourceBytes:file.size,sourceSha256:await this.sha256File(file),extension,kind:SOURCE_EXTENSIONS.has(extension)?"source":"file"}
  }
  attachAnimations(entity,resource,names=[]){const tracks=resource?.animations||[];if(!tracks.length)return[];try{if(!entity.anim)entity.addComponent('anim',{activate:true,speed:1});const clips=[];for(let i=0;i<tracks.length;i++){const name=names[i]||tracks[i]?.name||('Clip_'+i);entity.anim.assignAnimation(name,tracks[i],undefined,1,true);clips.push(name)}entity.anim.playing=true;return clips}catch(e){this.log('Animation attach failed: '+e.message,'error');return[]}}
  setAnimationState(id,state){const r=this.entities.get(id);if(!r?.entity?.anim?.baseLayer)return false;try{r.entity.anim.baseLayer.play(state);return true}catch{return false}}
  serialize(){return{format:'forge-scene',version:3,meta:{engine:'Forge Studio 3.0',time:new Date().toISOString(),units:'meters'},entities:[...this.entities.values()].map(r=>{const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale();return{id:r.id,name:r.name,kind:r.kind,transform:{p:[p.x,p.y,p.z],r:[q.x,q.y,q.z],s:[s.x,s.y,s.z]},components:r.components,keyframes:this.keyframes.get(r.id)||[],script:this.scripts.get(r.id)||null}})}}
  async load(data,{assetRoot='' }={}) {
    for(const r of [...this.entities.values()]){
      this.removePhysics(r.id); r.entity.destroy();
    }
    this.entities.clear(); this.selectedId=null; this.keyframes.clear(); this.scripts.clear();

    for(const d of data.entities||[]){
      if(d.kind==='terrain'&&d.components?.terrain&&window.ForgeTerrain){
        window.ForgeTerrain.generate(d.name,d.components.terrain); continue;
      }
      const r=this.add(d.kind,d.name), t=d.transform||{};
      r.entity.setLocalPosition(...(t.p||[0,0,0]));
      r.entity.setLocalEulerAngles(...(t.r||[0,0,0]));
      r.entity.setLocalScale(...(t.s||[1,1,1]));
      if(['box','sphere','cylinder','capsule','plane'].includes(d.kind)){
        r.entity.addComponent('render',{type:d.kind==='sphere'?'sphere':d.kind==='cylinder'?'cylinder':d.kind==='capsule'?'capsule':d.kind==='plane'?'plane':'box'});
        r.entity.render.material=this.material();
      }
      if(d.kind==='camera')r.entity.addComponent('camera',{clearColor:new pc.Color(.02,.05,.09)});
      if(d.kind==='light')r.entity.addComponent('light',{type:'directional',intensity:2,castShadows:true});
      r.components=d.components||{};
      if(d.components?.material){
        const previous=this.selectedId;
        this.selectedId=r.id; this.applyMaterial(d.components.material); this.selectedId=previous;
      }
      if(d.components?.physics)this.setPhysics(r.id,d.components.physics.mode,d.components.physics.shape);
      if(d.keyframes?.length)this.keyframes.set(r.id,d.keyframes);
      if(d.script)this.scripts.set(r.id,d.script);

      const asset=d.components?.asset;
      if(asset?.name&&assetRoot&&asset.type==='audio'){
        const a=new pc.Asset(asset.name,'audio',{url:assetRoot+'assets/'+encodeURIComponent(asset.name)});
        this.app.assets.add(a);
        await new Promise((resolve,reject)=>{
          a.once('error',reject);
          a.once('load',()=>{
            try{
              if(!r.entity.sound)r.entity.addComponent('sound',{positional:true,volume:1});
              if(!r.entity.sound.slot('main'))r.entity.sound.addSlot('main',{asset:a.id,autoPlay:false,loop:false,overlap:false,volume:1,pitch:1});
              this.assets.set(asset.name,{type:'audio',file:null,url:a.getFileUrl?.()||assetRoot+'assets/'+encodeURIComponent(asset.name),resource:a.resource,asset:a});
              resolve();
            }catch(err){reject(err)}
          });
          this.app.assets.load(a);
        });
      } else if(asset?.name&&assetRoot&&asset.type==='model'){
        const a=new pc.Asset(asset.name,'container',{url:assetRoot+'assets/'+encodeURIComponent(asset.name)});
        this.app.assets.add(a);
        await new Promise((resolve,reject)=>{
          a.once('error',reject);
          a.once('load',()=>{
            try{
              const child=a.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});
              child.name=r.name;
              const p=r.entity.getLocalPosition(), euler=r.entity.getLocalEulerAngles(), s=r.entity.getLocalScale();
              r.entity.destroy();
              this.root.addChild(child);
              child.setLocalPosition(p.x,p.y,p.z);
              child.setLocalEulerAngles(euler.x,euler.y,euler.z);
              child.setLocalScale(s.x,s.y,s.z);
              r.entity=child;
              child.__forge={id:r.id,kind:'model',name:r.name,components:r.components};
              this.attachAnimations(child,a.resource);
              this.entities.set(r.id,r);
              resolve();
            }catch(err){reject(err)}
          });
          this.app.assets.load(a);
        });
      }
    }
    this.frame();
  }

  diagnostics(){return{ok:true,renderer:/webgpu/i.test(this.app?.graphicsDevice?.constructor?.name||'')?'WebGPU':'WebGL2',fps:Number(this.fps.toFixed(1)),frameMs:Number(this.frameMs.toFixed(2)),entities:this.entities.size,renderables:[...this.entities.values()].filter(r=>r.entity.render?.meshInstances?.length).length,physics:this.physics.size,scripts:this.scripts.size,tracks:this.keyframes.size,time:Number(this.timelineTime.toFixed(2)),unitSystem:this.unitSystem,view:this.viewMode,spatial:this.spatial?true:false}}
}
if(typeof window!=="undefined")window.ForgePlayCanvas=pc;
export{pc,RAPIER};
