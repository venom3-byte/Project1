import * as pc from 'https://cdn.jsdelivr.net/npm/playcanvas@2.22.6/build/playcanvas.mjs';
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/+esm';

const V=(x=0,y=0,z=0)=>new pc.Vec3(x,y,z);
const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};
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


function triangulateContour(points){
  if(!Array.isArray(points)||points.length<3||points.length>256)throw new Error("A silhouette needs 3–256 contour points.");
  const pts=points.map(p=>[Number(p[0]),Number(p[1])]);
  if(pts.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))throw new Error("Contour contains invalid points.");
  let area=0;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];area+=a[0]*b[1]-b[0]*a[1]}
  if(Math.abs(area)<1e-6)throw new Error("Contour area is too small. Draw a wider outline.");
  const ids=pts.map((_,i)=>i);if(area<0)ids.reverse();
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const inside=(p,a,b,c)=>{const x=cross(a,b,p),y=cross(b,c,p),z=cross(c,a,p);return x>=-1e-8&&y>=-1e-8&&z>=-1e-8};
  const triangles=[];let guard=0;
  while(ids.length>3&&guard++<points.length*points.length){
    let clipped=false;
    for(let i=0;i<ids.length;i++){
      const ia=ids[(i+ids.length-1)%ids.length],ib=ids[i],ic=ids[(i+1)%ids.length],a=pts[ia],b=pts[ib],c=pts[ic];
      if(cross(a,b,c)<=1e-8)continue;
      let blocked=false;
      for(const id of ids){if(id===ia||id===ib||id===ic)continue;if(inside(pts[id],a,b,c)){blocked=true;break}}
      if(blocked)continue;
      triangles.push([ia,ib,ic]);ids.splice(i,1);clipped=true;break;
    }
    if(!clipped)throw new Error("Cannot triangulate this outline. Remove crossing lines and duplicate points, then trace again.");
  }
  if(ids.length===3)triangles.push([ids[0],ids[1],ids[2]]);
  return triangles;
}

function pointInContour(point,contour){
  const x=point[0],y=point[1];let inside=false;
  for(let i=0,j=contour.length-1;i<contour.length;j=i++){
    const a=contour[i],b=contour[j];
    if(((a[1]>y)!==(b[1]>y))&&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1]+1e-15)+a[0]))inside=!inside;
  }
  return inside;
}

export class ForgeEngine{
  constructor(canvas,log=()=>{}){
    this.canvas=canvas;this.log=log;this.app=null;this.root=null;this.entities=new Map();this.selectedId=null;this.assets=new Map();
    this.rapier=null;this.world=null;this.physics=new Map();this.keyframes=new Map();this.scripts=new Map();this.timelineTime=0;this.timelineStart=0;this.timelineEnd=10;this.timelineLoop=true;this.running=false;this.timelinePlaying=false;this.autoKey=false;this.keyInterpolation='ease';this.fps=0;this.frames=0;this.lastFPS=performance.now();this.frameMs=0;
    this.physicsAccumulator=0;this.physicsFixedDt=1/60;this.physicsMaxSubsteps=5;this.prePhysicsSystems=new Set();this.postPhysicsSystems=new Set();this.collisionListeners=new Set();this.colliderEntityMap=new Map();this.eventQueue=null;
    this.triangleCache=new WeakMap();this.pickBudget=120000;this.unitSystem='meters';this.viewMode='perspective';this.gizmoSpace='world';this.snapEnabled=false;this.snapSize=.25;this.history=[];this.redoStack=[];this.historyLimit=100;
  }
  async init(){
    this.app=new pc.Application(this.canvas,{graphicsDeviceOptions:{antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true}});
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);this.app.graphicsDevice.maxPixelRatio=Math.min(2.5,Math.max(1,window.devicePixelRatio||1));this.app.setCanvasResolution(pc.RESOLUTION_AUTO);this.app.scene.gammaCorrection=pc.GAMMA_SRGB;this.app.scene.toneMapping=pc.TONEMAP_ACES;this.app.scene.physicalUnits=true;this.app.scene.ambientLightColor=new pc.Color(.18,.22,.28);this.app.scene.ambientLightColor=new pc.Color(.18,.22,.28);
    this.root=new pc.Entity('ForgeScene');this.app.root.addChild(this.root);
    await RAPIER.init();this.rapier=RAPIER;this.world=new RAPIER.World({x:0,y:-9.81,z:0});this.eventQueue=new RAPIER.EventQueue(true);
    this.createCamera('Main Camera',{x:7,y:5,z:9});this.createLight('Sun');this.createPlane('Ground',30,30);
    this.app.on('update',dt=>this.update(dt));window.addEventListener('resize',()=>this.app.resizeCanvas());this.app.resizeCanvas();this.app.autoRender=true;this.app.start();this.app.render?.();this.log('Forge Engine 3.0 online');return this
  }
  rec(name,kind,e){const id=crypto.randomUUID();e.__forge={id,kind,name,components:{}};const r={id,kind,name,entity:e,components:e.__forge.components};this.entities.set(id,r);return r}
  add(kind,name){const e=new pc.Entity(name);this.root.addChild(e);return this.rec(name,kind,e)}
  _buildRigMarker(record,offsetY=.82){
    if(!record?.entity||!this.app?.graphicsDevice)return false;
    const radius=.13,y=clamp(offsetY,.1,100,.82);
    const positions=[
      0,y+radius,0,
      -radius,y,0,
      0,y,radius,
      radius,y,0,
      0,y,-radius,
      0,y-radius,0,
    ];
    const indices=[
      0,1,2, 0,2,3, 0,3,4, 0,4,1,
      5,2,1, 5,3,2, 5,4,3, 5,1,4,
    ];
    const mesh=new pc.Mesh(this.app.graphicsDevice);
    mesh.setPositions(positions);mesh.setIndices(indices);
    mesh.setNormals(pc.calculateNormals(positions,indices));mesh.update();
    const material=this.material([1,.43,.12]);
    material.emissive=new pc.Color(1,.25,.035);material.emissiveIntensity=.75;
    material.metalness=0;material.gloss=.35;material.update();
    if(record.entity.render)record.entity.removeComponent("render");
    const instance=new pc.MeshInstance(mesh,material);
    record.entity.addComponent("render",{meshInstances:[instance]});
    record.entity.render.layers=[pc.LAYERID_WORLD];record.entity.render.frustumCulling=false;
    record.entity.render.castShadows=false;record.entity.render.receiveShadows=false;
    return true;
  }
  createRigPivotForSelected(name){
    const child=this.selected();if(!child||child.kind==="rig")return null;
    const position=child.entity.getPosition().clone(),rotation=child.entity.getRotation().clone(),localScale=child.entity.getLocalScale().clone();
    const oldParent=child.entity.parent;
    if(oldParent?.__forge?.kind==="rig"){
      const previous=this.entities.get(oldParent.__forge.id),children=previous?.components?.rigControl?.children||[];
      if(previous)previous.components.rigControl.children=children.filter(id=>id!==child.id);
    }
    const control=this.add("rig",name||child.name+" Pivot");
    control.entity.setPosition(position);control.entity.setRotation(rotation);
    const size=Math.max(.65,Math.abs(localScale.y)*.6+.15);
    control.components.rigControl={role:"pivot",visual:"sphere-control",markerOffset:size,children:[child.id],notes:"Rigid-part forward-kinematics pivot; does not skin-deform vertices."};
    this._buildRigMarker(control,size);
    control.entity.addChild(child.entity);
    child.entity.setPosition(position);child.entity.setRotation(rotation);child.entity.setLocalScale(localScale.x,localScale.y,localScale.z);
    child.components.rigParentId=control.id;
    window.dispatchEvent(new CustomEvent("forge-hierarchy-changed"));
    this.select(control.id);return control;
  }
  attachSelectedToRigControl(controlId){
    const child=this.selected(),control=this.entities.get(controlId);
    if(!child||!control||control.kind!=="rig"||child.id===control.id||child.kind==="rig")return false;
    for(let node=control.entity;node;node=node.parent)if(node===child.entity)return false;
    const position=child.entity.getPosition().clone(),rotation=child.entity.getRotation().clone(),localScale=child.entity.getLocalScale().clone(),oldParent=child.entity.parent;
    if(oldParent?.__forge?.kind==="rig"){
      const previous=this.entities.get(oldParent.__forge.id);
      if(previous?.components?.rigControl)previous.components.rigControl.children=(previous.components.rigControl.children||[]).filter(id=>id!==child.id);
    }
    control.entity.addChild(child.entity);child.entity.setPosition(position);child.entity.setRotation(rotation);child.entity.setLocalScale(localScale.x,localScale.y,localScale.z);
    child.components.rigParentId=control.id;
    control.components.rigControl=control.components.rigControl||{role:"pivot",visual:"sphere-control",children:[]};
    control.components.rigControl.children=[...new Set([...(control.components.rigControl.children||[]),child.id])];
    window.dispatchEvent(new CustomEvent("forge-hierarchy-changed"));window.dispatchEvent(new CustomEvent("forge-selection"));
    return true;
  }
  detachSelectedFromRigControl(){
    const child=this.selected();if(!child||child.kind==="rig")return false;
    const oldParent=child.entity.parent;
    if(oldParent?.__forge?.kind!=="rig"&&!child.components.rigParentId)return false;
    const position=child.entity.getPosition().clone(),rotation=child.entity.getRotation().clone(),localScale=child.entity.getLocalScale().clone();
    if(oldParent?.__forge?.kind==="rig"){
      const previous=this.entities.get(oldParent.__forge.id);
      if(previous?.components?.rigControl)previous.components.rigControl.children=(previous.components.rigControl.children||[]).filter(id=>id!==child.id);
    }
    this.root.addChild(child.entity);child.entity.setPosition(position);child.entity.setRotation(rotation);child.entity.setLocalScale(localScale.x,localScale.y,localScale.z);
    delete child.components.rigParentId;
    window.dispatchEvent(new CustomEvent("forge-hierarchy-changed"));window.dispatchEvent(new CustomEvent("forge-selection"));
    return true;
  }
  material(color=[.22,.62,.9]){const m=new pc.StandardMaterial();m.diffuse=new pc.Color(...color);m.emissive=new pc.Color(0,0,0);m.emissiveIntensity=0;m.metalness=0;m.gloss=.55;m.useMetalness=true;m.useLighting=true;m.useTonemap=true;m.specular=new pc.Color(.04,.04,.04);m.update();return m}
  primitive(kind,name){const r=this.add(kind,name||kind+'-'+(this.entities.size+1)),type=kind==='sphere'?'sphere':kind==='cylinder'?'cylinder':kind==='capsule'?'capsule':kind==='plane'?'plane':'box';r.entity.addComponent('render',{type});r.entity.render.layers=[pc.LAYERID_WORLD];r.entity.render.frustumCulling=false;r.entity.render.enabled=true;r.entity.render.material=this.material(kind==='plane'?[.08,.15,.2]:[.22,.62,.9]);if(kind!=='plane')r.entity.setLocalPosition((Math.random()-.5)*4,1+(Math.random()*1.7),(Math.random()-.5)*4);r.components.geometry={sourceUnits:'meters'};return r}
  createPlane(name,w=30,d=30){const r=this.primitive('plane',name);r.entity.setLocalScale(w,1,d);r.entity.setLocalPosition(0,0,0);if(name==='Ground')r.entity.render.layers=[];this.setPhysics(r.id,'fixed','box');return r}
  createCamera(name,pos){const r=this.add('camera',name),active=![...this.entities.values()].some(item=>item.kind==='camera'&&item.components.camera?.active);r.entity.addComponent('camera',{clearColor:new pc.Color(.035,.07,.12),clearColorBuffer:true,clearDepthBuffer:true,fov:60,nearClip:.01,farClip:10000,enabled:active,layers:[pc.LAYERID_WORLD]});r.entity.setLocalPosition(pos.x,pos.y,pos.z);r.entity.lookAt(0,1,0);r.components.camera={active,fov:60,projection:'perspective'};r.entity.camera.enabled=active;return r}
  createLight(name){const r=this.add('light',name);r.entity.addComponent('light',{type:'directional',color:new pc.Color(1,.96,.88),intensity:2.5,castShadows:true,shadowDistance:80,enabled:true,layers:[pc.LAYERID_WORLD]});r.entity.setEulerAngles(48,-32,0);r.components.light={type:'directional',color:[1,.96,.88],intensity:2.5,castShadows:true,range:12,innerConeAngle:25,outerConeAngle:45};return r}
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
    const r=this.selected();if(!r)return false;
    if(r.components?.asset)r.components.asset.derivedDirty=true;
    const prior=r.components.material||{},color=(params.color||prior.color||[.22,.62,.9]).map(v=>clamp(Number(v),0,1,0));
    const metalness=clamp(params.metalness??prior.metalness??0,0,1,0);
    const roughness=clamp(params.roughness??prior.roughness??.55,0,1,.55);
    const opacity=clamp(params.opacity??prior.opacity??1,0,1,1),mats=[];
    const walk=e=>{
      for(const mi of(e.render?.meshInstances||[])){
        const current=mi.material,m=current?.__forgeOwnerId===r.id?current:(current?.clone?.()||this.material(color));
        m.__forgeOwnerId=r.id;
        m.diffuse=new pc.Color(...color);m.useLighting=true;m.useMetalness=true;m.useTonemap=true;
        m.metalness=metalness;m.gloss=1-roughness;m.opacity=opacity;
        m.blendType=opacity<.999?pc.BLEND_NORMAL:pc.BLEND_NONE;m.depthWrite=opacity>=.999;m.alphaTest=0;
        if(params.emissive){m.emissive=new pc.Color(...params.emissive);m.emissiveIntensity=clamp(params.emissiveIntensity??1,0,20,1)}
        else if(!r.components?.asset||r.components.asset.type!=='image'){m.emissive=new pc.Color(0,0,0);m.emissiveIntensity=0}
        m.update();mi.material=m;mats.push(m);
      }
      for(const c of e.children)walk(c);
    };
    walk(r.entity);
    r.components.material={...prior,color,metalness,roughness,opacity,emissive:params.emissive||prior.emissive||[0,0,0],preset:params.preset||prior.preset||'custom'};
    return mats.length;
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
    if(this.timelinePlaying){
      const start=Math.max(0,Number(this.timelineStart)||0),end=Math.max(start+.01,Number(this.timelineEnd)||10);
      this.timelineTime+=frameDt;
      if(this.timelineTime>=end){
        if(this.timelineLoop)this.timelineTime=start+(this.timelineTime-start)%(end-start);
        else{this.timelineTime=end;this.timelinePlaying=false}
      }
      this.evalAnimation(this.timelineTime);
    }
    if(this.running)this.runScripts(frameDt)
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
    const ray=this._rayFromScreen(e);if(!ray)return null;let best=null,bt=Infinity,tested=0;const candidates=[];
    // Imported GLB/GLTF assets usually put their render components on descendant
    // entities. Traverse the entire selectable record, but always return its root
    // record so transforms, materials, and hierarchy selection stay coherent.
    const visit=(r,node)=>{
      if(!node||node.enabled===false)return;
      for(const mi of(node.render?.meshInstances||[])){
        if(mi.visible===false||!mi.aabb)continue;
        const t=rayAabb(ray.a,ray.d,mi.aabb);
        if(t!==null&&t<bt+10)candidates.push({r,mi,t});
      }
      for(const child of(node.children||[]))visit(r,child);
    };
    for(const r of this.entities.values())visit(r,r.entity);
    candidates.sort((a,b)=>a.t-b.t);
    for(const c of candidates){
      const data=this._triangleData(c.mi.mesh);
      if(!data.positions||tested>this.pickBudget){if(c.t<bt){bt=c.t;best=c.r}continue}
      const inv=(c.mi.node?.getWorldTransform?.()||c.r.entity.getWorldTransform()).clone().invert(),ro=inv.transformPoint(ray.a.clone()),rp=inv.transformPoint(ray.a.clone().add(ray.d.clone())),rd=new pc.Vec3().sub2(rp,ro).normalize();
      let hit=null;const prims=c.mi.mesh.primitive||[{base:0,count:data.indices?data.indices.length:data.positions.length/3,indexed:!!data.indices}];
      for(const p of prims){
        if(p.type!==pc.PRIMITIVE_TRIANGLES)continue;
        const end=p.base+p.count;
        if(p.indexed&&data.indices){
          for(let i=p.base;i<end;i+=3){const ia=data.indices[i],ib=data.indices[i+1],ic=data.indices[i+2],a=V(data.positions[ia*3],data.positions[ia*3+1],data.positions[ia*3+2]),b=V(data.positions[ib*3],data.positions[ib*3+1],data.positions[ib*3+2]),cc=V(data.positions[ic*3],data.positions[ic*3+1],data.positions[ic*3+2]),t=rayTriangle(ro,rd,a,b,cc);tested++;if(t!=null&&(hit==null||t<hit))hit=t;if(tested>this.pickBudget)break}
        }else{
          for(let i=p.base;i<end;i+=3){const a=V(data.positions[i*3],data.positions[i*3+1],data.positions[i*3+2]),b=V(data.positions[(i+1)*3],data.positions[(i+1)*3+1],data.positions[(i+1)*3+2]),cc=V(data.positions[(i+2)*3],data.positions[(i+2)*3+1],data.positions[(i+2)*3+2]),t=rayTriangle(ro,rd,a,b,cc);tested++;if(t!=null&&(hit==null||t<hit))hit=t;if(tested>this.pickBudget)break}
        }
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
    r.entity.setLocalPosition(Number.isFinite(v.x)?snap(v.x):p.x,Number.isFinite(v.y)?snap(v.y):p.y,Number.isFinite(v.z)?snap(v.z):p.z);r.entity.setLocalEulerAngles(Number.isFinite(v.rx)?v.rx:rot.x,Number.isFinite(v.ry)?v.ry:rot.y,Number.isFinite(v.rz)?v.rz:rot.z);r.entity.setLocalScale(Number.isFinite(v.sx)?Math.max(.0001,v.sx):s.x,Number.isFinite(v.sy)?Math.max(.0001,v.sy):s.y,Number.isFinite(v.sz)?Math.max(.0001,v.sz):s.z);if(options.history!==false)this.recordTransformHistory(r.id,before,this._transformState(r));if(this.autoKey&&options.autoKey!==false)this.key({interpolation:this.keyInterpolation});return r
  }
  undo(){const h=this.history.pop();if(!h)return false;const r=this.entities.get(h.id);if(!r){this.redoStack.push(h);return false}this._applyTransformState(r,h.before);this.redoStack.push(h);this.select(r.id);return true}
  redo(){const h=this.redoStack.pop();if(!h)return false;const r=this.entities.get(h.id);if(!r){this.history.push(h);return false}this._applyTransformState(r,h.after);this.history.push(h);this.select(r.id);return true}
  setWorldPosition(id,p){const r=this.entities.get(id);if(!r)return false;r.entity.setPosition(Number(p.x)||0,Number(p.y)||0,Number(p.z)||0);return true}
  duplicate(){const r=this.selected();if(!r)return null;const e=r.entity.clone();e.name=r.name+' Copy';this.root.addChild(e);const n=this.rec(e.name,r.kind,e);n.components=JSON.parse(JSON.stringify(r.components));const p=e.getLocalPosition();e.setLocalPosition(p.x+1,p.y,p.z);if(n.components.physics)this.setPhysics(n.id,n.components.physics.mode,n.components.physics.shape);this.select(n.id);return n}
  delete(){const r=this.selected();if(!r)return;this.removePhysics(r.id);r.entity.destroy();this.entities.delete(r.id);this.selectedId=null;window.dispatchEvent(new CustomEvent('forge-selection'))}
  _componentAnimationState(r){
    const state={},light=r?.entity?.light,camera=r?.entity?.camera;
    if(r?.kind==='light'&&light){
      state.light={type:light.type||'directional',intensity:Number(light.intensity)||0,range:Number(light.range)||12,
        innerConeAngle:Number(light.innerConeAngle)||0,outerConeAngle:Number(light.outerConeAngle)||45,
        color:[light.color.r,light.color.g,light.color.b],castShadows:light.castShadows===true};
    }
    if(r?.kind==='camera'&&camera){
      state.camera={fov:Number(camera.fov)||60,orthoHeight:Number(camera.orthoHeight)||5,
        projection:camera.projection===pc.PROJECTION_ORTHOGRAPHIC?'orthographic':'perspective'};
    }
    return state;
  }
  _applyAnimatedComponents(r,components){
    if(!r||!components)return;
    const lightData=components.light,light=r.entity.light;
    if(r.kind==='light'&&light&&lightData){
      if(['directional','omni','spot'].includes(lightData.type))light.type=lightData.type;
      if(Array.isArray(lightData.color)&&lightData.color.length>=3)light.color=new pc.Color(...lightData.color.map(v=>Math.max(0,Math.min(1,Number(v)||0))));
      if(Number.isFinite(lightData.intensity))light.intensity=Math.max(0,Math.min(100000,lightData.intensity));
      if(Number.isFinite(lightData.range))light.range=Math.max(.01,Math.min(100000,lightData.range));
      if(Number.isFinite(lightData.innerConeAngle))light.innerConeAngle=Math.max(0,Math.min(89,lightData.innerConeAngle));
      if(Number.isFinite(lightData.outerConeAngle))light.outerConeAngle=Math.max(1,Math.min(89,lightData.outerConeAngle));
      if(typeof lightData.castShadows==='boolean')light.castShadows=lightData.castShadows;
      r.components.light={...r.components.light,...lightData};
    }
    const cameraData=components.camera,camera=r.entity.camera;
    if(r.kind==='camera'&&camera&&cameraData){
      if(Number.isFinite(cameraData.fov))camera.fov=Math.max(20,Math.min(110,cameraData.fov));
      if(Number.isFinite(cameraData.orthoHeight))camera.orthoHeight=Math.max(.01,Math.min(100000,cameraData.orthoHeight));
      if(cameraData.projection==='orthographic')camera.projection=pc.PROJECTION_ORTHOGRAPHIC;
      else if(cameraData.projection==='perspective')camera.projection=pc.PROJECTION_PERSPECTIVE;
      r.components.camera={...r.components.camera,...cameraData};
    }
  }
  _mixAnimationComponents(a={},b={},f=0){
    const result={};
    for(const type of ['light','camera']){
      const from=a?.[type],to=b?.[type];
      if(!from&&!to)continue;
      if(!from||!to){result[type]=from||to;continue}
      const mixed={};
      for(const key of new Set([...Object.keys(from),...Object.keys(to)])){
        const x=from[key],y=to[key];
        if(Array.isArray(x)&&Array.isArray(y)&&x.length===y.length)mixed[key]=x.map((v,i)=>(Number(v)||0)+((Number(y[i])||0)-(Number(v)||0))*f);
        else if(typeof x==='number'&&typeof y==='number')mixed[key]=x+(y-x)*f;
        else mixed[key]=f<.5?x:y;
      }
      result[type]=mixed;
    }
    return result;
  }
  key({interpolation=this.keyInterpolation||'linear'}={}) {
    const r=this.selected();if(!r)return null;
    const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles(),sc=r.entity.getLocalScale();
    const a=this.keyframes.get(r.id)||[],time=Math.max(0,Number(this.timelineTime)||0);
    const mode=['linear','ease','constant'].includes(interpolation)?interpolation:'linear';
    const existing=a.find(k=>Math.abs(k.time-time)<1e-5);
    const key={time,p:[p.x,p.y,p.z],r:[q.x,q.y,q.z],s:[sc.x,sc.y,sc.z],
      components:this._componentAnimationState(r),interpolation:mode};
    if(existing)Object.assign(existing,key);else a.push(key);
    a.sort((x,y)=>x.time-y.time);this.keyframes.set(r.id,a);
    return{key:existing||key,updated:!!existing,count:a.length};
  }
  evalAnimation(t){
    for(const[id,a]of this.keyframes){
      const r=this.entities.get(id);if(!r||!a.length)continue;
      let value=a[0];
      if(t>=a[a.length-1].time)value=a[a.length-1];
      else if(t>a[0].time){
        for(let i=0;i<a.length-1;i++){
          const A=a[i],B=a[i+1];if(t<A.time||t>B.time)continue;
          let f=(t-A.time)/Math.max(.0001,B.time-A.time);
          const mode=A.interpolation||'linear';
          if(mode==='constant')f=0;else if(mode==='ease')f=f*f*(3-2*f);
          const mix=(from,to)=>from.map((v,j)=>v+(to[j]-v)*f);
          value={p:mix(A.p,B.p),r:mix(A.r,B.r),s:mix(A.s,B.s),
            components:this._mixAnimationComponents(A.components,B.components,f)};
          break;
        }
      }
      r.entity.setLocalPosition(...value.p);r.entity.setLocalEulerAngles(...value.r);r.entity.setLocalScale(...value.s);
      this._applyAnimatedComponents(r,value.components);
    }
  }

  createExtrudedSilhouette({name="Image Silhouette",contour=[],axis="front",width=3,height=2,depth=.25,color=[.34,.55,.72],record=null}={}){
    const pts=contour.map(p=>[Number(p[0]),Number(p[1])]);
    const tris=triangulateContour(pts),w=Math.max(.01,Math.min(10000,Number(width)||3)),h=Math.max(.01,Math.min(10000,Number(height)||2)),d=Math.max(.005,Math.min(10000,Number(depth)||.25));
    const orient=["front","side","top"].includes(axis)?axis:"front",positions=[],indices=[];
    const pos=(p,side)=>{
      const x=(p[0]-.5)*w,y=(.5-p[1])*h,z=(p[1]-.5)*h,n=side*d/2;
      if(orient==="side")return[n,y,(p[0]-.5)*w];
      if(orient==="top")return[x,n,z];
      return[x,y,n];
    };
    const tri=(a,b,c)=>{const base=positions.length/3;positions.push(...a,...b,...c);indices.push(base,base+1,base+2)};
    for(const t of tris){
      tri(pos(pts[t[0]],1),pos(pts[t[2]],1),pos(pts[t[1]],1));
      tri(pos(pts[t[0]],-1),pos(pts[t[1]],-1),pos(pts[t[2]],-1));
    }
    for(let i=0;i<pts.length;i++){
      const j=(i+1)%pts.length,fa=pos(pts[i],1),fb=pos(pts[j],1),ba=pos(pts[i],-1),bb=pos(pts[j],-1);
      tri(fa,ba,bb);tri(fa,bb,fb);
    }
    const mesh=new pc.Mesh(this.app.graphicsDevice);mesh.setPositions(positions);mesh.setIndices(indices);mesh.setNormals(pc.calculateNormals(positions,indices));mesh.update();
    const mat=this.material(color);mat.cull=pc.CULLFACE_NONE;mat.update();
    const meshInstance=new pc.MeshInstance(mesh,mat);
    let out=record;
    if(!out){const entity=new pc.Entity(name);this.root.addChild(entity);out=this.rec(name,"mesh",entity)}
    out.name=name;out.kind="mesh";out.entity.name=name;
    if(out.entity.render)out.entity.removeComponent("render");
    out.entity.addComponent("render",{meshInstances:[meshInstance]});out.entity.render.layers=[pc.LAYERID_WORLD];out.entity.render.frustumCulling=false;
    if(orient==="front")out.entity.setLocalPosition(0,h/2,.05+d/2);
    else if(orient==="side")out.entity.setLocalPosition(.05+d/2,h/2,0);
    else out.entity.setLocalPosition(0,.03+d/2,0);
    out.components.geometry={kind:"extruded-silhouette",version:1,contour:pts,axis:orient,width:w,height:h,depth:d,color:[...color],sourceName:String(name)};
    out.components.material={color:[...color],metalness:0.05,roughness:0.65,opacity:1};
    return out;
  }
  createLatheMeshFromData({name="Rust Lathe Mesh",meshData,profile=[],options={},color=[.34,.62,.78],record=null}={}){
    if(!meshData||!Array.isArray(meshData.positions)||!Array.isArray(meshData.indices)||meshData.indices.length<3)throw new Error("Rust did not return usable triangle geometry.");
    if(meshData.positions.length>1000000||meshData.indices.length>6000000)throw new Error("Generated mesh exceeds the browser safety budget.");
    const positions=meshData.positions.flatMap(point=>point.map(Number));
    const normals=Array.isArray(meshData.normals)&&meshData.normals.length===meshData.positions.length?meshData.normals.flatMap(point=>point.map(Number)):pc.calculateNormals(positions,meshData.indices);
    const indices=meshData.indices.map(Number);
    if(positions.some(value=>!Number.isFinite(value))||normals.some(value=>!Number.isFinite(value))||indices.some(value=>!Number.isInteger(value)||value<0||value>=meshData.positions.length))throw new Error("Rust mesh data failed geometry validation.");
    const mesh=new pc.Mesh(this.app.graphicsDevice);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setIndices(indices);mesh.update();
    const material=this.material(color);material.cull=pc.CULLFACE_NONE;material.update();
    const instance=new pc.MeshInstance(mesh,material);
    let out=record;if(!out){const entity=new pc.Entity(name);this.root.addChild(entity);out=this.rec(name,"mesh",entity)}
    out.name=name;out.kind="mesh";out.entity.name=name;if(out.entity.render)out.entity.removeComponent("render");
    out.entity.addComponent("render",{meshInstances:[instance]});out.entity.render.layers=[pc.LAYERID_WORLD];out.entity.render.frustumCulling=false;
    out.components.geometry={kind:"rust-lathe",version:1,axis:options.axis||"y",radialSegments:Number(options.radial_segments)||64,profileSubdivisions:Number(options.profile_subdivisions)||0,vertexCount:meshData.positions.length,triangleCount:Math.floor(indices.length/3),sourceName:String(name)};
    out.components.procedural={generator:"forge-eye-core-lathe",version:"0.1.0",profile:profile.map(point=>({radius:Number(point.radius),height:Number(point.height)})),options:{...options},authoredIn:"Rust/WebAssembly"};
    out.components.material={color:[...color],metalness:.05,roughness:.55,opacity:1};
    if(!record)this.select(out.id);return out;
  }
  createVisualHullMeshFromData({name="Rust Visual Hull",result,frontContour=[],sideContour=[],topContour=[],width=3,height=2,depth=3,resolution=24,color=[.3,.62,.78],record=null}={}){
    const meshData=result?.mesh;
    if(!meshData||!Array.isArray(meshData.positions)||!Array.isArray(meshData.indices)||meshData.indices.length<36)throw new Error("Rust did not return a usable multi-view visual-hull mesh.");
    if(meshData.positions.length>1500000||meshData.indices.length>9000000)throw new Error("Rust visual hull exceeds the browser mesh safety budget.");
    const positions=meshData.positions.flatMap(point=>point.map(Number));
    const normals=Array.isArray(meshData.normals)&&meshData.normals.length===meshData.positions.length?meshData.normals.flatMap(point=>point.map(Number)):pc.calculateNormals(positions,meshData.indices);
    const indices=meshData.indices.map(Number);
    if(positions.some(value=>!Number.isFinite(value))||normals.some(value=>!Number.isFinite(value))||indices.some(value=>!Number.isInteger(value)||value<0||value>=meshData.positions.length))throw new Error("Rust visual-hull geometry failed validation.");
    const mesh=new pc.Mesh(this.app.graphicsDevice);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setIndices(indices);mesh.update();
    const material=this.material(color);material.cull=pc.CULLFACE_NONE;material.update();const instance=new pc.MeshInstance(mesh,material);
    let out=record;
    if(!out){const entity=new pc.Entity(name);this.root.addChild(entity);out=this.rec(name,"mesh",entity)}
    out.name=name;out.kind="mesh";out.entity.name=name;if(out.entity.render)out.entity.removeComponent("render");
    out.entity.addComponent("render",{meshInstances:[instance]});out.entity.render.layers=[pc.LAYERID_WORLD];out.entity.render.frustumCulling=false;
    out.entity.setLocalPosition(0,0,0);out.entity.setLocalEulerAngles(0,0,0);out.entity.setLocalScale(1,1,1);
    const viewCount=Number(result.view_count)||((topContour?.length||0)>=3?3:2),occupiedVoxels=Number(result.occupied_voxels)||0,r=Number(result.resolution)||Number(resolution)||24;
    out.components.geometry={kind:"rust-visual-hull",version:1,frontContour:frontContour.map(p=>[...p]),sideContour:sideContour.map(p=>[...p]),topContour:(topContour||[]).map(p=>[...p]),width:Number(width),height:Number(height),depth:Number(depth),resolution:r,color:[...color],viewCount,occupiedVoxels,sourceName:String(name),vertexCount:meshData.positions.length,triangleCount:Math.floor(indices.length/3)};
    out.components.procedural={generator:"forge-eye-core-visual-hull",version:"0.1.0",options:{width:Number(width),height:Number(height),depth:Number(depth),resolution:r},authoredIn:"Rust/WebAssembly"};
    out.components.diagnostics={method:viewCount===3?"three-view silhouette intersection":"two-view silhouette intersection",viewCount,occupiedVoxels,resolution:r};
    out.components.material={color:[...color],metalness:.05,roughness:.68,opacity:1};
    if(!record)this.select(out.id);return out;
  }
  createSilhouetteVisualHull({name="Multi-view Silhouette Hull",frontContour=[],sideContour=[],topContour=[],width=3,height=2,depth=3,resolution=32,color=[.3,.62,.78],record=null}={}){
    const front=frontContour.map(p=>[Number(p[0]),Number(p[1])]),side=sideContour.map(p=>[Number(p[0]),Number(p[1])]),top=topContour.map(p=>[Number(p[0]),Number(p[1])]);
    triangulateContour(front);triangulateContour(side);if(top.length)triangulateContour(top);
    const w=Math.max(.01,Math.min(10000,Number(width)||3)),h=Math.max(.01,Math.min(10000,Number(height)||2)),d=Math.max(.01,Math.min(10000,Number(depth)||3));
    const r=Math.max(12,Math.min(48,Math.round(Number(resolution)||32))),slice=r*r;
    const frontMask=new Uint8Array(slice),sideMask=new Uint8Array(slice),topMask=top.length?new Uint8Array(slice):null,occupied=new Uint8Array(slice*r);
    for(let j=0;j<r;j++){
      const v=(j+.5)/r;
      for(let i=0;i<r;i++){
        const u=(i+.5)/r;
        frontMask[j*r+i]=pointInContour([u,v],front)?1:0;
        sideMask[j*r+i]=pointInContour([u,v],side)?1:0;
        if(topMask)topMask[j*r+i]=pointInContour([u,v],top)?1:0;
      }
    }
    let filled=0;
    for(let k=0;k<r;k++)for(let j=0;j<r;j++)for(let i=0;i<r;i++){
      const at=i+r*(j+r*k);
      if(frontMask[j*r+i]&&sideMask[j*r+k]&&(!topMask||topMask[k*r+i])){occupied[at]=1;filled++}
    }
    if(!filled)throw new Error("The front and side silhouettes do not intersect. Check view alignment and shared height.");
    if(filled>slice*r*.92)throw new Error("The silhouettes fill nearly the entire volume. Check that both outlines closely follow the object.");
    const positions=[],normals=[],indices=[];
    const quad=(verts,n)=>{
      const base=positions.length/3;
      for(const v of verts){positions.push(v[0],v[1],v[2]);normals.push(n[0],n[1],n[2])}
      indices.push(base,base+1,base+2,base,base+2,base+3);
    };
    const has=(i,j,k)=>i>=0&&j>=0&&k>=0&&i<r&&j<r&&k<r&&occupied[i+r*(j+r*k)]===1;
    const dx=w/r,dy=h/r,dz=d/r;
    for(let k=0;k<r;k++)for(let j=0;j<r;j++)for(let i=0;i<r;i++){
      if(!has(i,j,k))continue;
      const x0=-w/2+i*dx,x1=x0+dx,y0=h/2-j*dy,y1=y0-dy,z0=-d/2+k*dz,z1=z0+dz;
      if(!has(i-1,j,k))quad([[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],[-1,0,0]);
      if(!has(i+1,j,k))quad([[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]],[1,0,0]);
      if(!has(i,j-1,k))quad([[x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]],[0,1,0]);
      if(!has(i,j+1,k))quad([[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]],[0,-1,0]);
      if(!has(i,j,k-1))quad([[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],[0,0,-1]);
      if(!has(i,j,k+1))quad([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],[0,0,1]);
    }
    const mesh=new pc.Mesh(this.app.graphicsDevice);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setIndices(indices);mesh.update();
    const mat=this.material(color);mat.cull=pc.CULLFACE_NONE;mat.update();const meshInstance=new pc.MeshInstance(mesh,mat);
    let out=record;if(!out){const entity=new pc.Entity(name);this.root.addChild(entity);out=this.rec(name,"mesh",entity)}
    out.name=name;out.kind="mesh";out.entity.name=name;if(out.entity.render)out.entity.removeComponent("render");
    out.entity.addComponent("render",{meshInstances:[meshInstance]});out.entity.render.layers=[pc.LAYERID_WORLD];out.entity.render.frustumCulling=false;
    out.entity.setLocalPosition(0,h/2,0);out.entity.setLocalEulerAngles(0,0,0);out.entity.setLocalScale(1,1,1);
    out.components.geometry={kind:"silhouette-visual-hull",version:2,frontContour:front,sideContour:side,topContour:top,width:w,height:h,depth:d,resolution:r,color:[...color],sourceName:String(name)};
    out.components.material={color:[...color],metalness:.05,roughness:.68,opacity:1};
    out.components.diagnostics={method:top.length?"three-view silhouette intersection":"two-view silhouette intersection",viewCount:top.length?3:2,occupiedVoxels:filled,resolution:r};
    return out;
  }
  attachScript(id,code){this.scripts.set(id,code)}
  runScripts(dt){for(const[id,code]of this.scripts){const r=this.entities.get(id);if(!r)continue;try{new Function('api',code)({entity:r.entity,time:this.timelineTime,dt,engine:this})}catch(e){this.log('Script error '+e.message,'error')}}}
  async importFile(file){
    const url=URL.createObjectURL(file);if(file.name.toLowerCase().endsWith('.forge.json'))return{type:'project',data:JSON.parse(await file.text())};
    let analysis=null;try{analysis=await window.ForgeProduction?.assets?.analyze?.(file)}catch{}
    if(/^image\//.test(file.type)){
      const bmp=await createImageBitmap(file),sourceWidth=bmp.width,sourceHeight=bmp.height;
      // Preserve the original file in the project. Only cap the GPU upload when
      // the hardware cannot accept the source texture's dimensions.
      const maxTextureSize=Number(this.app.graphicsDevice.maxTextureSize)||8192;
      const renderScale=Math.min(1,maxTextureSize/Math.max(sourceWidth,sourceHeight));
      const renderWidth=Math.max(1,Math.round(sourceWidth*renderScale)),renderHeight=Math.max(1,Math.round(sourceHeight*renderScale));
      const c=document.createElement('canvas');c.width=renderWidth;c.height=renderHeight;
      const ctx=c.getContext('2d',{alpha:true});
      if(!ctx){bmp.close?.();throw new Error('Could not allocate the image texture canvas')}
      ctx.imageSmoothingEnabled=renderScale<1;ctx.drawImage(bmp,0,0,renderWidth,renderHeight);bmp.close?.();
      const tex=new pc.Texture(this.app.graphicsDevice,{width:renderWidth,height:renderHeight,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true});
      tex.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;tex.magFilter=pc.FILTER_LINEAR;tex.setSource(c);
      const mat=this.material([1,1,1]);mat.diffuseMap=tex;mat.emissiveMap=tex;mat.emissive=new pc.Color(1,1,1);mat.update();
      const r=this.primitive('plane',file.name);r.entity.render.material=mat;
      r.components.asset={type:'image',name:file.name,width:sourceWidth,height:sourceHeight,renderWidth,renderHeight,sourceBytes:file.size,analysis,derivedDirty:false};
      this.assets.set(file.name,{type:'image',file,url,width:sourceWidth,height:sourceHeight,renderWidth,renderHeight});this.select(r.id);
      window.dispatchEvent(new Event('forge-assets-changed'));window.ForgeRefreshUI?.();return{type:'image',record:r}
    }
    if(/\.(glb|gltf)$/i.test(file.name))return new Promise(async(resolve,reject)=>{
      if(/\.gltf$/i.test(file.name)){try{const json=JSON.parse(await file.text()),external=[...(json.buffers||[]),...(json.images||[])].some(x=>x?.uri&&!String(x.uri).startsWith('data:'));if(external)throw new Error('This .gltf references external files. Use a packaged .glb so Forge can preserve the asset without path breakage')}catch(e){reject(e);return}}
      const asset=new pc.Asset(file.name,'container',{url});this.app.assets.add(asset);asset.once('error',reject);asset.once('load',()=>{try{const e=asset.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});e.name=file.name.replace(/\.[^.]+$/,'');this.root.addChild(e);const r=this.rec(e.name,'model',e);r.components.asset={type:'model',name:file.name,analysis:analysis||null,sourceUnits:'meters',importScale:1,derivedDirty:false};const clips=this.attachAnimations(e,asset.resource,analysis?.animationNames||[]);if(clips.length)r.components.animation={clips,playing:true};this.assets.set(file.name,{type:'model',file,url,resource:asset.resource});window.dispatchEvent(new Event('forge-assets-changed'));this.select(r.id);window.ForgeRefreshUI?.();requestAnimationFrame(()=>{requestAnimationFrame(()=>{window.ForgeSpatial?.inspect?.(r);resolve({type:'model',record:r})})})}catch(err){reject(err)}});this.app.assets.load(asset)
    });
    return{type:'asset',name:file.name,analysis}
  }
  attachAnimations(entity,resource,names=[]){const tracks=resource?.animations||[];if(!tracks.length)return[];try{if(!entity.anim)entity.addComponent('anim',{activate:true,speed:1});const clips=[];for(let i=0;i<tracks.length;i++){const name=names[i]||tracks[i]?.name||('Clip_'+i);entity.anim.assignAnimation(name,tracks[i],undefined,1,true);clips.push(name)}entity.anim.playing=true;return clips}catch(e){this.log('Animation attach failed: '+e.message,'error');return[]}}
  setAnimationState(id,state){const r=this.entities.get(id);if(!r?.entity?.anim?.baseLayer)return false;try{r.entity.anim.baseLayer.play(state);return true}catch{return false}}
  serialize(){return{format:'forge-scene',version:4,meta:{engine:'Forge Eye 0.4',time:new Date().toISOString(),units:'meters'},entities:[...this.entities.values()].map(r=>{const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles(),s=r.entity.getLocalScale();return{id:r.id,name:r.name,kind:r.kind,parentId:r.entity.parent?.__forge?.id||null,transform:{p:[p.x,p.y,p.z],r:[q.x,q.y,q.z],s:[s.x,s.y,s.z]},components:r.components,keyframes:this.keyframes.get(r.id)||[],script:this.scripts.get(r.id)||null}})}}
  async load(data,{assetRoot='' }={}) {
    for(const r of [...this.entities.values()]){
      this.removePhysics(r.id); r.entity.destroy();
    }
    this.entities.clear(); this.selectedId=null; this.keyframes.clear(); this.scripts.clear();
    const serializedEntities=Array.isArray(data.entities)?data.entities:[];
    const activeCameraSource=serializedEntities.find(item=>item.kind==='camera'&&item.components?.camera?.active)?.id
      || serializedEntities.find(item=>item.kind==='camera')?.id
      || null;
    const sourceIdToRecord=new Map();

    for(const d of serializedEntities){
      if(d.kind==='terrain'&&d.components?.terrain&&window.ForgeTerrain){
        window.ForgeTerrain.generate(d.name,d.components.terrain); continue;
      }
      const r=this.add(d.kind,d.name), t=d.transform||{};
      if(d.id)sourceIdToRecord.set(d.id,r);
      r.entity.setLocalPosition(...(t.p||[0,0,0]));
      r.entity.setLocalEulerAngles(...(t.r||[0,0,0]));
      r.entity.setLocalScale(...(t.s||[1,1,1]));
      if(['box','sphere','cylinder','capsule','plane'].includes(d.kind)){
        r.entity.addComponent('render',{type:d.kind==='sphere'?'sphere':d.kind==='cylinder'?'cylinder':d.kind==='capsule'?'capsule':d.kind==='plane'?'plane':'box'});
        r.entity.render.material=this.material();
      }
      const cameraMeta=d.components?.camera||{};
      if(d.kind==='camera'){
        const active=d.id===activeCameraSource,projection=cameraMeta.projection==='orthographic'?pc.PROJECTION_ORTHOGRAPHIC:pc.PROJECTION_PERSPECTIVE;
        r.entity.addComponent('camera',{clearColor:new pc.Color(.02,.05,.09),fov:clamp(cameraMeta.fov,20,110,60),projection,orthoHeight:Math.max(.5,Number(cameraMeta.orthoHeight)||5),enabled:active});
        r.entity.camera.enabled=active;
      }
      const lightMeta=d.components?.light||{};
      if(d.kind==='light'){
        const lightColor=Array.isArray(lightMeta.color)&&lightMeta.color.length>=3?lightMeta.color:[1,.96,.88];
        r.entity.addComponent('light',{type:['directional','omni','spot'].includes(lightMeta.type)?lightMeta.type:'directional',color:new pc.Color(...lightColor),intensity:clamp(lightMeta.intensity,0,1000,2.5),range:clamp(lightMeta.range,0.01,10000,12),innerConeAngle:clamp(lightMeta.innerConeAngle,0,89,25),outerConeAngle:clamp(lightMeta.outerConeAngle,1,89,45),castShadows:lightMeta.castShadows!==false,enabled:true,layers:[pc.LAYERID_WORLD]});
      }
      r.components=d.components||{};
      r.entity.__forge.components=r.components;
      if(d.kind==="rig")this._buildRigMarker(r,Number(d.components?.rigControl?.markerOffset)||.82);
      if(d.components?.geometry?.kind==="rust-lathe"&&d.components?.procedural?.generator==="forge-eye-core-lathe"&&window.ForgeEyeRust?.latheMesh){
        const profile=d.components.procedural.profile||[],options=d.components.procedural.options||{},meshData=window.ForgeEyeRust.latheMesh(profile,options);
        this.createLatheMeshFromData({record:r,name:d.name,meshData,profile,options,color:d.components.material?.color||[.34,.62,.78]});
      }else if(d.components?.geometry?.kind==="rust-visual-hull"&&window.ForgeEyeRust?.visualHullMesh){
        const g=d.components.geometry,options=d.components.procedural?.options||{width:g.width,height:g.height,depth:g.depth,resolution:g.resolution};
        const result=window.ForgeEyeRust.visualHullMesh(g.frontContour||[],g.sideContour||[],g.topContour||[],options);
        this.createVisualHullMeshFromData({record:r,name:d.name,result,frontContour:g.frontContour||[],sideContour:g.sideContour||[],topContour:g.topContour||[],width:g.width,height:g.height,depth:g.depth,resolution:g.resolution,color:g.color||d.components.material?.color||[.3,.62,.78]});
      }else if(d.components?.geometry?.kind==="extruded-silhouette")this.createExtrudedSilhouette({record:r,name:d.name,...d.components.geometry});
      else if(d.components?.geometry?.kind==="silhouette-visual-hull")this.createSilhouetteVisualHull({record:r,name:d.name,...d.components.geometry});
      if(d.components?.material){
        const previous=this.selectedId;
        this.selectedId=r.id; this.applyMaterial(d.components.material); this.selectedId=previous;
      }
      if(d.components?.physics)this.setPhysics(r.id,d.components.physics.mode,d.components.physics.shape);
      if(d.keyframes?.length)this.keyframes.set(r.id,d.keyframes);
      if(d.script)this.scripts.set(r.id,d.script);

      const asset=d.components?.asset;
      const referenceData=d.components?.reference?.imageDataUrl;
      if(asset?.name&&asset.type==='image'&&referenceData){
        try{
          const response=await fetch(referenceData);
          if(!response.ok)throw new Error("Embedded reference image could not be read");
          const file=await response.blob(),bitmap=await createImageBitmap(file),sourceWidth=bitmap.width,sourceHeight=bitmap.height,canvas=document.createElement('canvas');
          const maxTextureSize=Number(this.app.graphicsDevice.maxTextureSize)||8192,renderScale=Math.min(1,maxTextureSize/Math.max(sourceWidth,sourceHeight));
          canvas.width=Math.max(1,Math.round(sourceWidth*renderScale));canvas.height=Math.max(1,Math.round(sourceHeight*renderScale));
          const ctx=canvas.getContext('2d',{alpha:true});if(!ctx){bitmap.close?.();throw new Error("Could not allocate the restored image texture canvas")}
          ctx.imageSmoothingEnabled=renderScale<1;ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
          const texture=new pc.Texture(this.app.graphicsDevice,{width:canvas.width,height:canvas.height,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true});
          texture.minFilter=pc.FILTER_LINEAR_MIPMAP_LINEAR;texture.magFilter=pc.FILTER_LINEAR;
          texture.setSource(canvas);const material=this.material([1,1,1]);material.diffuseMap=texture;material.emissiveMap=texture;material.emissive=new pc.Color(1,1,1);material.cull=pc.CULLFACE_NONE;material.update();
          for(const instance of(r.entity.render?.meshInstances||[]))instance.material=material;
          this.assets.set(asset.name,{type:'image',file,url:referenceData,embedded:true});
        }catch(error){this.log("Reference image restore failed: "+(error?.message||String(error)),"error")}
      }
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
    for(const d of serializedEntities){
      const r=d.id?sourceIdToRecord.get(d.id):null;if(!r)continue;
      if(d.parentId){
        const parent=sourceIdToRecord.get(d.parentId);
        if(parent&&parent.id!==r.id){
          let ancestor=parent.entity,cyclic=false;
          while(ancestor){if(ancestor===r.entity){cyclic=true;break}ancestor=ancestor.parent}
          if(!cyclic)parent.entity.addChild(r.entity);
        }
      }
    }
    for(const r of this.entities.values()){
      if(r.components.rigParentId){const remapped=sourceIdToRecord.get(r.components.rigParentId);if(remapped)r.components.rigParentId=remapped.id;else delete r.components.rigParentId}
      if(Array.isArray(r.components.rigControl?.children))r.components.rigControl.children=r.components.rigControl.children.map(id=>sourceIdToRecord.get(id)?.id).filter(Boolean);
      if(r.components.rigControl)r.components.rigControl.markerOffset=Number(r.components.rigControl.markerOffset)||.82;
    }
    if(![...this.entities.values()].some(item=>item.kind==='camera'&&item.components.camera?.active)){
      this.createCamera('Main Camera',{x:7,y:5,z:9});
    }
    this.frame();
  }

  diagnostics(){return{ok:true,renderer:/webgpu/i.test(this.app?.graphicsDevice?.constructor?.name||'')?'WebGPU':'WebGL2',fps:Number(this.fps.toFixed(1)),frameMs:Number(this.frameMs.toFixed(2)),entities:this.entities.size,renderables:[...this.entities.values()].filter(r=>r.entity.render?.meshInstances?.length).length,physics:this.physics.size,scripts:this.scripts.size,tracks:this.keyframes.size,time:Number(this.timelineTime.toFixed(2)),unitSystem:this.unitSystem,view:this.viewMode,spatial:this.spatial?true:false}}
}
if(typeof window!=="undefined")window.ForgePlayCanvas=pc;
export{pc,RAPIER};
