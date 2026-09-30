import * as pc from 'https://cdn.jsdelivr.net/npm/playcanvas@2.22.6/build/playcanvas.mjs';
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/+esm';

const V=(x=0,y=0,z=0)=>new pc.Vec3(x,y,z);
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
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);this.app.setCanvasResolution(pc.RESOLUTION_AUTO);this.app.scene.gammaCorrection=pc.GAMMA_SRGB;this.app.scene.toneMapping=pc.TONEMAP_ACES;this.app.scene.physicalUnits=true;this.app.scene.ambientLightColor=new pc.Color(.18,.22,.28);this.app.scene.ambientLightColor=new pc.Color(.18,.22,.28);
    this.root=new pc.Entity('ForgeScene');this.app.root.addChild(this.root);
    await RAPIER.init();this.rapier=RAPIER;this.world=new RAPIER.World({x:0,y:-9.81,z:0});this.eventQueue=new RAPIER.EventQueue(true);
    this.createCamera('Main Camera',{x:7,y:5,z:9});this.createLight('Sun');this.createPlane('Ground',30,30);
    this.app.on('update',dt=>this.update(dt));this.canvas.addEventListener('pointerdown',e=>this.pick(e));window.addEventListener('resize',()=>this.app.resizeCanvas());this.app.resizeCanvas();this.app.autoRender=true;this.app.start();this.app.render?.();this.log('Forge Engine 3.0 online');return this
  }
  rec(name,kind,e){const id=crypto.randomUUID();e.__forge={id,kind,name,components:{}};const r={id,kind,name,entity:e,components:e.__forge.components};this.entities.set(id,r);return r}
  add(kind,name){const e=new pc.Entity(name);this.root.addChild(e);return this.rec(name,kind,e)}
  material(color=[.22,.62,.9]){const m=new pc.StandardMaterial();m.diffuse=new pc.Color(...color);m.emissive=new pc.Color(...color);m.emissiveIntensity=2;m.metalness=.0;m.gloss=.5;m.useMetalness=false;m.useLighting=false;m.useTonemap=false;m.specular=new pc.Color(0,0,0);m.update();return m}
  primitive(kind,name){const r=this.add(kind,name||kind+'-'+(this.entities.size+1)),type=kind==='sphere'?'sphere':kind==='cylinder'?'cylinder':kind==='capsule'?'capsule':kind==='plane'?'plane':'box';r.entity.addComponent('render',{type});r.entity.render.layers=[pc.LAYERID_WORLD];r.entity.render.frustumCulling=false;r.entity.render.enabled=true;r.entity.render.material=this.material(kind==='plane'?[.08,.15,.2]:[.22,.62,.9]);if(kind!=='plane')r.entity.setLocalPosition((Math.random()-.5)*4,1+(Math.random()*1.7),(Math.random()-.5)*4);r.components.geometry={sourceUnits:'meters'};return r}
  createPlane(name,w=30,d=30){const r=this.primitive('plane',name);r.entity.setLocalScale(w,1,d);r.entity.setLocalPosition(0,0,0);if(name==='Ground')r.entity.render.layers=[];this.setPhysics(r.id,'fixed','box');return r}
  createCamera(name,pos){const r=this.add('camera',name);r.entity.addComponent('camera',{clearColor:new pc.Color(.035,.07,.12),clearColorBuffer:true,clearDepthBuffer:true,fov:60,nearClip:.01,farClip:10000,enabled:true,layers:[pc.LAYERID_WORLD]});r.entity.setLocalPosition(pos.x,pos.y,pos.z);r.entity.lookAt(0,1,0);r.components.camera={active:true};r.entity.camera.enabled=true;return r}
  createLight(name){const r=this.add('light',name);r.entity.addComponent('light',{type:'directional',color:new pc.Color(1,.96,.88),intensity:2.5,castShadows:true,shadowDistance:80,enabled:true,layers:[pc.LAYERID_WORLD]});r.entity.setEulerAngles(48,-32,0);r.components.light={type:'directional'};return r}
  camera(){return[...this.entities.values()].find(r=>r.kind==='camera'&&r.components.camera?.active)?.entity}
  selected(){return this.selectedId?this.entities.get(this.selectedId):null}
  select(id){this.selectedId=id;window.dispatchEvent(new CustomEvent('forge-selection',{detail:this.selected()}));return this.selected()}
  setView(mode){
    const cam=this.camera();if(!cam?.camera)return false;const target=this.selected()?.entity.getPosition()||new pc.Vec3(0,1,0),dist=Math.max(6,target.distance(cam.getPosition())||10);
    const positions={front:new pc.Vec3(0,target.y,target.z+dist),back:new pc.Vec3(0,target.y,target.z-dist),left:new pc.Vec3(-dist,target.y,target.z),right:new pc.Vec3(dist,target.y,target.z),top:new pc.Vec3(target.x,target.y+dist,target.z),bottom:new pc.Vec3(target.x,target.y-dist,target.z)};
    if(mode==='perspective'){this.viewMode='perspective';cam.camera.projection=pc.PROJECTION_PERSPECTIVE;cam.setPosition(target.x+dist*.75,target.y+dist*.5,target.z+dist);cam.lookAt(target)}
    else if(positions[mode]){this.viewMode=mode;cam.camera.projection=pc.PROJECTION_ORTHOGRAPHIC;cam.camera.orthoHeight=Math.max(.5,dist*.9);cam.setPosition(positions[mode]);cam.lookAt(target)}
    return true
  }
  applyMaterial(params={}){
    const r=this.selected();if(!r)return false;const color=params.color||[.22,.62,.9],mats=[],walk=e=>{for(const mi of(e.render?.meshInstances||[])){let m=mi.material?.clone?.()||this.material(color);m.diffuse=new pc.Color(...color);if(params.metalness!=null)m.metalness=Number(params.metalness);if(params.roughness!=null)m.gloss=1-Number(params.roughness);if(params.opacity!=null){m.opacity=Number(params.opacity);m.blendType=params.opacity<1?pc.BLEND_NORMAL:pc.BLEND_NONE;m.alphaTest=params.opacity<1?.01:0}if(params.emissive){m.emissive=new pc.Color(...params.emissive);m.emissiveIntensity=Number(params.emissiveIntensity||0)}m.update();mi.material=m;mats.push(m)}for(const c of e.children)walk(c)};walk(r.entity);
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
    c.setActiveEvents?.(this.rapier.ActiveEvents.COLLISION_EVENTS);c.setActiveHooks?.(this.rapier.ActiveHooks.FILTER_CONTACT_PAIRS);const collider=this.world.createCollider(c,body);this.physics.set(id,{body,collider,mode,shape,colliderHandle:collider.handle});this.colliderEntityMap.set(collider.handle,id);r.components.physics={mode,shape}
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
    const r=this.selected();if(!r)return null;const before=this._transformState(r),p=r.entity.getLocalPosition(),rot=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale(),snap=n=>{const v=this.snapEnabled?Math.round(Number(n)/this.snapSize)*this.snapSize:Number(n);return Object.is(v,-0)?0:v};
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
  async importFile(file){
    const url=URL.createObjectURL(file);if(file.name.toLowerCase().endsWith('.forge.json'))return{type:'project',data:JSON.parse(await file.text())};
    let analysis=null;try{analysis=await window.ForgeProduction?.assets?.analyze?.(file)}catch{}
    if(/^image\//.test(file.type)){const bmp=await createImageBitmap(file),c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;c.getContext('2d').drawImage(bmp,0,0);const tex=new pc.Texture(this.app.graphicsDevice,{width:bmp.width,height:bmp.height,format:pc.PIXELFORMAT_R8_G8_B8_A8});tex.setSource(c);const mat=this.material([1,1,1]);mat.diffuseMap=tex;mat.emissiveMap=tex;mat.emissive=new pc.Color(1,1,1);mat.update();const r=this.primitive('plane',file.name);r.entity.render.material=mat;r.components.asset={type:'image',name:file.name,width:bmp.width,height:bmp.height,analysis};this.assets.set(file.name,{type:'image',file,url});this.select(r.id);window.dispatchEvent(new Event('forge-assets-changed'));window.ForgeRefreshUI?.();return{type:'image',record:r}}
    if(/\.(glb|gltf)$/i.test(file.name))return new Promise(async(resolve,reject)=>{
      if(/\.gltf$/i.test(file.name)){try{const json=JSON.parse(await file.text()),external=[...(json.buffers||[]),...(json.images||[])].some(x=>x?.uri&&!String(x.uri).startsWith('data:'));if(external)throw new Error('This .gltf references external files. Use a packaged .glb so Forge can preserve the asset without path breakage')}catch(e){reject(e);return}}
      const asset=new pc.Asset(file.name,'container',{url});this.app.assets.add(asset);asset.once('error',reject);asset.once('load',()=>{try{const e=asset.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});e.name=file.name.replace(/\.[^.]+$/,'');this.root.addChild(e);const r=this.rec(e.name,'model',e);r.components.asset={type:'model',name:file.name,analysis:analysis||null,sourceUnits:'meters',importScale:1};const clips=this.attachAnimations(e,asset.resource);if(clips.length)r.components.animation={clips,playing:true};this.assets.set(file.name,{type:'model',file,url,resource:asset.resource});window.dispatchEvent(new Event('forge-assets-changed'));this.select(r.id);window.ForgeRefreshUI?.();requestAnimationFrame(()=>{requestAnimationFrame(()=>{window.ForgeSpatial?.inspect?.(r);resolve({type:'model',record:r})})})}catch(err){reject(err)}});this.app.assets.load(asset)
    });
    return{type:'asset',name:file.name,analysis}
  }
  attachAnimations(entity,resource){const tracks=resource?.animations||[];if(!tracks.length)return[];try{if(!entity.anim)entity.addComponent('anim',{activate:true,speed:1});const clips=[];for(let i=0;i<tracks.length;i++){const name=tracks[i]?.name||('Clip_'+i);entity.anim.assignAnimation(name,tracks[i],undefined,1,true);clips.push(name)}entity.anim.playing=true;return clips}catch(e){this.log('Animation attach failed: '+e.message,'error');return[]}}
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
      if(asset?.name&&assetRoot&&asset.type==='model'){
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
