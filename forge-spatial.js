import { pc } from './forge-engine.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const vec=(x=0,y=0,z=0)=>new pc.Vec3(x,y,z);

function expand(out,p){
  out.min.x=Math.min(out.min.x,p.x); out.min.y=Math.min(out.min.y,p.y); out.min.z=Math.min(out.min.z,p.z);
  out.max.x=Math.max(out.max.x,p.x); out.max.y=Math.max(out.max.y,p.y); out.max.z=Math.max(out.max.z,p.z);
}
function emptyBounds(){return{min:vec(Infinity,Infinity,Infinity),max:vec(-Infinity,-Infinity,-Infinity)}}
function cornersFromAabb(aabb){
  const mn=typeof aabb?.getMin==="function"?aabb.getMin():aabb?.min;
  const mx=typeof aabb?.getMax==="function"?aabb.getMax():aabb?.max;
  if(!mn||!mx)return[];
  return [vec(mn.x,mn.y,mn.z),vec(mx.x,mn.y,mn.z),vec(mn.x,mx.y,mn.z),vec(mx.x,mx.y,mn.z),vec(mn.x,mn.y,mx.z),vec(mx.x,mn.y,mx.z),vec(mn.x,mx.y,mx.z),vec(mx.x,mx.y,mx.z)];
}

class SpatialCore{
  constructor(engine){this.engine=engine;this.overlay=null;this.overlayCtx=null;this.overlayEnabled=true;this.showBounds=true;this.showAxes=true;this.space='world';this.snapEnabled=false;this.snap=.25;this.last=null;this._raf=0}
  installOverlay(canvas){
    const parent=canvas.parentElement;if(!parent)return;
    let o=parent.querySelector('#spatialOverlay');
    if(!o){o=document.createElement('canvas');o.id='spatialOverlay';o.setAttribute('aria-hidden','true');Object.assign(o.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:2});parent.appendChild(o)}
    this.overlay=o;this.overlayCtx=o.getContext('2d');
    const resize=()=>{const r=parent.getBoundingClientRect(),d=devicePixelRatio||1;o.width=Math.max(1,Math.floor(r.width*d));o.height=Math.max(1,Math.floor(r.height*d));this.overlayCtx.setTransform(d,0,0,d,0,0);this.overlayCss={w:r.width,h:r.height}};
    resize();window.addEventListener('resize',resize,{passive:true});
    const draw=()=>{this._raf=requestAnimationFrame(draw);this.draw()};draw();
  }
  setSnap(v){this.snapEnabled=!!v;this.snap=Math.max(.001,Number(v)||.25)}
  snapValue(v){return this.snapEnabled?Math.round(v/this.snap)*this.snap:v}
  _localBounds(entity){
    const out=emptyBounds();let count=0,triangles=0,vertices=0,uvChannels=0,materials=0;const renderables=[],rootInv=entity.getWorldTransform().clone().invert();
    entity.forEach(n=>{
      if(!n.render?.meshInstances?.length)return;
      for(const mi of n.render.meshInstances){
        renderables.push(mi);const mesh=mi.mesh;
        if(mesh?.aabb){
          const nodeWorld=mi.node?.getWorldTransform?.()||n.getWorldTransform();
          const nodeMatrix=new pc.Mat4().mul2(rootInv,nodeWorld);
          for(const c of cornersFromAabb(mesh.aabb))expand(out,nodeMatrix.transformPoint(c));
        }
        if(mesh){
          try{
            const vb=mesh.vertexBuffer;
            vertices+=Number(vb?.numVertices||vb?.getNumVertices?.()||0);
            for(const prim of(mesh.primitive||[])){
              if(prim?.type===pc.PRIMITIVE_TRIANGLES)triangles+=Math.floor(Number(prim.count||0)/3);
            }
          }catch{}
          try{
            const f=mesh.vertexBuffer?.getFormat?.();
            if(f?.elements){
              for(const e of f.elements){
                const sem=String(e.semantic||'');
                if(sem.startsWith('TEXCOORD'))uvChannels=Math.max(uvChannels,(Number(sem.replace(/\D+/g,''))||0)+1);
              }
            }
          }catch{}
        }
        materials+=mi.material?1:0;count++;
      }
    });
    if(count===0){out.min.set(0,0,0);out.max.set(0,0,0)}
    const size=vec(out.max.x-out.min.x,out.max.y-out.min.y,out.max.z-out.min.z);
    return{bounds:out,size,meshInstances:count,vertices,triangles,uvChannels,materials,renderables}
  }
  inspect(r){
    if(!r?.entity)return null;const e=r.entity,local=this._localBounds(e),world=this.worldBounds(e),s=e.getLocalScale(),lp=e.getLocalPosition(),p=e.getPosition(),rot=e.getEulerAngles(),asset=r.components.asset||{},analysis=asset.analysis||{};
    return{id:r.id,name:r.name,kind:r.kind,units:'meters',coordinateSystem:'right-handed, +Y up, +Z forward',
      source:{size:{x:local.size.x,y:local.size.y,z:local.size.z},bounds:{min:[local.bounds.min.x,local.bounds.min.y,local.bounds.min.z],max:[local.bounds.max.x,local.bounds.max.y,local.bounds.max.z]},pivot:[0,0,0]},
      world:{size:{x:world.size.x,y:world.size.y,z:world.size.z},bounds:{min:[world.bounds.min.x,world.bounds.min.y,world.bounds.min.z],max:[world.bounds.max.x,world.bounds.max.y,world.bounds.max.z]},center:[world.center.x,world.center.y,world.center.z],radius:world.radius},
      transform:{local:{position:[lp.x,lp.y,lp.z],rotation:[e.getLocalEulerAngles().x,e.getLocalEulerAngles().y,e.getLocalEulerAngles().z],scale:[s.x,s.y,s.z]},world:{position:[p.x,p.y,p.z],rotation:[rot.x,rot.y,rot.z]}},
      geometry:{meshInstances:local.meshInstances,vertices:analysis.vertices||local.vertices,triangles:analysis.triangles||local.triangles,uvChannels:analysis.uvChannels||local.uvChannels,materials:analysis.materials||local.materials,meshes:analysis.meshes||local.meshInstances,animations:analysis.animations||0,skins:analysis.skins||0,joints:analysis.joints||0},
      render:{lods:analysis.lods||1,collision:r.components.physics||null},asset}
  }
  worldBounds(entity){
    const b=emptyBounds();let valid=0;
    entity.forEach(n=>{for(const mi of(n.render?.meshInstances||[])){if(!mi.aabb)continue;for(const c of cornersFromAabb(mi.aabb)){expand(b,c);valid++}}});
    if(!valid){const p=entity.getPosition();b.min.copy(p);b.max.copy(p)}
    const size=vec(b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z),center=vec((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2,(b.min.z+b.max.z)/2);
    return{bounds:b,size,center,radius:Math.max(size.x,size.y,size.z)*.5}
  }
  screenRect(r){
    const cam=this.engine.camera();if(!cam?.camera||!r)return null;const wb=this.worldBounds(r.entity),out=[];
    for(const p of cornersFromAabb(wb.bounds)){const s=cam.camera.worldToScreen(p);out.push([s.x,s.y,s.z])}
    const xs=out.map(v=>v[0]),ys=out.map(v=>v[1]);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys),depth:Math.min(...out.map(v=>v[2]))}
  }
  sceneVision(){
    const cam=this.engine.camera(),objects=[];
    for(const r of this.engine.entities.values()){
      if(!r.entity.render?.meshInstances?.length)continue;
      const info=this.inspect(r),rect=this.screenRect(r);if(rect)objects.push({id:r.id,name:r.name,kind:r.kind,screen:rect,world:info.world,size:info.source.size,geometry:info.geometry,selected:r.id===this.engine.selectedId})
    }
    objects.sort((a,b)=>a.screen.depth-b.screen.depth);
    return{camera:cam?{position:[cam.getPosition().x,cam.getPosition().y,cam.getPosition().z],fov:cam.camera?.fov||60}:null,objects,selected:this.engine.selectedId}
  }
  moveToScreen(id,x,y,depth=.5,planeY=null){
    const r=this.engine.entities.get(id),cam=this.engine.camera();if(!r||!cam)return false;
    const rect=this.engine.canvas.getBoundingClientRect(),sx=(Number(x)||0)-rect.left,sy=(Number(y)||0)-rect.top;
    const a=cam.camera.screenToWorld(sx,sy,cam.camera.nearClip),b=cam.camera.screenToWorld(sx,sy,cam.camera.farClip);let t=depth;
    if(planeY!=null){const dy=b.y-a.y;if(Math.abs(dy)>1e-6)t=(planeY-a.y)/dy}
    const f=clamp(t,0,1),p=a.clone().add(b.clone().sub(a).mulScalar(f));
    if(this.snapEnabled){p.x=this.snapValue(p.x);p.y=this.snapValue(p.y);p.z=this.snapValue(p.z)}
    r.entity.setPosition(p);return this.inspect(r)
  }
  frameSelection(padding=1.25){
    const r=this.engine.selected();const cam=this.engine.camera();if(!r||!cam)return false;const wb=this.worldBounds(r.entity),fov=(cam.camera?.fov||60)*Math.PI/180,half=Math.max(wb.size.x,wb.size.y,wb.size.z)*.5*padding,dist=Math.max(.5,half/Math.tan(fov/2)),target=wb.center,forward=cam.forward.clone().normalize(),pos=target.clone().sub(forward.mulScalar(dist));cam.setPosition(pos);cam.lookAt(target);return this.inspect(r)
  }
  draw(){
    if(!this.overlay||!this.overlayCtx)return;const ctx=this.overlayCtx,host=this.overlay.parentElement.getBoundingClientRect();ctx.clearRect(0,0,host.width,host.height);if(!this.overlayEnabled)return;
    const r=this.engine.selected();if(!r?.entity?.render?.meshInstances?.length)return;const cam=this.engine.camera();if(!cam?.camera)return;
    const rect=this.screenRect(r);
    if(this.showBounds&&rect){
      ctx.save();ctx.strokeStyle='#52e5ff';ctx.lineWidth=1.25;ctx.setLineDash([5,4]);ctx.strokeRect(rect.x,rect.y,rect.width,rect.height);ctx.setLineDash([]);
      ctx.fillStyle='#07121dcc';ctx.fillRect(rect.x,Math.max(4,rect.y-22),Math.max(220,rect.width),18);ctx.fillStyle='#c6f5ff';ctx.font='11px ui-monospace,SFMono-Regular,monospace';
      const i=this.inspect(r),s=i.world.size;ctx.fillText(r.name+'  '+s.x.toFixed(3)+' × '+s.y.toFixed(3)+' × '+s.z.toFixed(3)+' m',rect.x+7,Math.max(17,rect.y-9));ctx.restore()
    }
    if(this.showAxes){
      const p=r.entity.getPosition(),o=cam.camera.worldToScreen(p),axes=[[r.entity.right,'#ff6363','X'],[r.entity.up,'#63f18e','Y'],[r.entity.forward,'#6e9dff','Z']];
      ctx.save();ctx.lineWidth=2;
      for(const [v,c,label] of axes){const end=o.clone().add(v.clone().mulScalar(.35)),s=cam.camera.worldToScreen(end),dx=s.x-o.x,dy=s.y-o.y,L=Math.hypot(dx,dy)||1,tx=o.x+dx/L*48,ty=o.y+dy/L*48;ctx.strokeStyle=c;ctx.beginPath();ctx.moveTo(o.x,o.y);ctx.lineTo(tx,ty);ctx.stroke();ctx.fillStyle=c;ctx.font='bold 11px system-ui';ctx.fillText(label,tx+4,ty+4)}
      ctx.restore()
    }
  }
}

window.ForgeSpatial=null;
window.addEventListener('forge-ready',()=>{if(!window.ForgeSpatial&&window.Forge){window.ForgeSpatial=new SpatialCore(window.Forge);window.ForgeSpatial.installOverlay(window.Forge.canvas);window.Forge.spatial=window.ForgeSpatial;window.Forge.log('Spatial Core 3.0 online')}});
if(window.Forge&&!window.ForgeSpatial){window.ForgeSpatial=new SpatialCore(window.Forge);window.ForgeSpatial.installOverlay(window.Forge.canvas);window.Forge.spatial=window.ForgeSpatial}
export{SpatialCore};
