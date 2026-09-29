import { pc } from "./forge-engine.js";

class ForgeVisionCore {
  constructor() {
    this.version = 1;
    this.overlayRoot = null;
    this.overlayMode = "selected";
    this.running = false;
    this.timer = 0;
    this.frameId = 0;
    this.lastFrame = null;
    this.baselines = new Map();
  }

  canvas() {
    return window.Forge?.canvas || document.querySelector("#viewport");
  }

  camera() {
    return window.Forge?.camera?.();
  }

  viewportRect() {
    const c = this.canvas();
    return c?.getBoundingClientRect?.() || {left:0, top:0, width:c?.clientWidth||0, height:c?.clientHeight||0};
  }

  meshInstances(entity) {
    const out = [];
    const walk = (e) => {
      if (e?.render?.meshInstances?.length) out.push(...e.render.meshInstances);
      for (const child of e?.children || []) walk(child);
    };
    walk(entity);
    return out;
  }

  bounds(entity) {
    const instances = this.meshInstances(entity);
    if (!instances.length) return null;
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for (const mi of instances) {
      const a = mi.aabb;
      if (!a) continue;
      const mn=a.getMin(), mx=a.getMax();
      minX=Math.min(minX,mn.x); minY=Math.min(minY,mn.y); minZ=Math.min(minZ,mn.z);
      maxX=Math.max(maxX,mx.x); maxY=Math.max(maxY,mx.y); maxZ=Math.max(maxZ,mx.z);
    }
    if (!Number.isFinite(minX)) return null;
    return {min:[minX,minY,minZ],max:[maxX,maxY,maxZ]};
  }

  project(worldPoint) {
    const cam = this.camera();
    if (!cam?.camera) return null;
    const out = new pc.Vec3();
    cam.camera.worldToScreen(worldPoint, out);
    return {x:Number(out.x.toFixed(2)),y:Number(out.y.toFixed(2)),z:Number(out.z.toFixed(3))};
  }

  projectBounds(bounds) {
    if (!bounds) return null;
    const [x0,y0,z0]=bounds.min,[x1,y1,z1]=bounds.max;
    const pts = [
      new pc.Vec3(x0,y0,z0),new pc.Vec3(x1,y0,z0),new pc.Vec3(x0,y1,z0),new pc.Vec3(x1,y1,z0),
      new pc.Vec3(x0,y0,z1),new pc.Vec3(x1,y0,z1),new pc.Vec3(x0,y1,z1),new pc.Vec3(x1,y1,z1)
    ].map(p=>this.project(p)).filter(Boolean);
    if (!pts.length) return null;
    const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),zs=pts.map(p=>p.z);
    const rect=this.viewportRect();
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    return {
      x:Number(left.toFixed(1)),y:Number(top.toFixed(1)),
      width:Number(Math.max(0,right-left).toFixed(1)),height:Number(Math.max(0,bottom-top).toFixed(1)),
      depth:Number(Math.min(...zs).toFixed(3)),
      onscreen:Math.min(...zs)>0 && right>=0 && bottom>=0 && left<=rect.width && top<=rect.height
    };
  }

  entityRecord(r) {
    const e=r.entity;
    const b=this.bounds(e);
    const center=b ? new pc.Vec3(
      (b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2
    ) : e.getPosition();
    const screen=this.project(center);
    return {
      id:r.id,name:r.name,kind:r.kind,
      visible:!!b,
      screen:screen ? {x:screen.x,y:screen.y,z:screen.z} : null,
      bounds:this.projectBounds(b),
      world:{position:[+e.getPosition().x.toFixed(3),+e.getPosition().y.toFixed(3),+e.getPosition().z.toFixed(3)]},
      components:Object.keys(r.components||{})
    };
  }

  map(options={}) {
    const F=window.Forge;
    if (!F) throw new Error("Forge engine unavailable");
    const list=[...F.entities.values()].map(r=>this.entityRecord(r)).filter(x=>x.visible || options.includeNonRenderable);
    return {
      version:this.version,
      frameId:this.frameId,
      viewport:this.viewportRect(),
      selectedId:F.selectedId,
      camera:F.camera()?.getPosition?.() ? [
        +F.camera().getPosition().x.toFixed(3),+F.camera().getPosition().y.toFixed(3),+F.camera().getPosition().z.toFixed(3)
      ] : null,
      entities:list
    };
  }

  rayFromScreen(x,y) {
    const cam=this.camera();
    const rect=this.viewportRect();
    if (!cam?.camera) throw new Error("Active camera unavailable");
    const sx=Number(x)||0,sy=Number(y)||0;
    const a=cam.camera.screenToWorld(sx,sy,cam.camera.nearClip);
    const b=cam.camera.screenToWorld(sx,sy,cam.camera.farClip);
    const d=new pc.Vec3().sub2(b,a).normalize();
    return {origin:a,direction:d};
  }

  hitTest(x,y) {
    const F=window.Forge, ray=this.rayFromScreen(x,y);
    let best=null,bestT=Infinity;
    for (const r of F.entities.values()) {
      for (const mi of this.meshInstances(r.entity)) {
        const t=F.rayAABB(ray.origin,ray.direction,mi.aabb);
        if (t!==null && t<bestT) {bestT=t;best=r;break;}
      }
    }
    return {
      x:Number(x)||0,y:Number(y)||0,
      hit:!!best,
      distance:best?Number(bestT.toFixed(3)):null,
      entity:best?{id:best.id,name:best.name,kind:best.kind}:null
    };
  }

  ensureOverlay() {
    if (this.overlayRoot?.isConnected) return this.overlayRoot;
    const host=this.canvas()?.parentElement || document.body;
    const el=document.createElement("div");
    el.id="forgeVisionOverlay";
    Object.assign(el.style,{position:"absolute",inset:"0",pointerEvents:"none",zIndex:"20",overflow:"hidden"});
    if (getComputedStyle(host).position==="static") host.style.position="relative";
    host.appendChild(el);
    this.overlayRoot=el;
    return el;
  }

  renderOverlay(options={}) {
    const mode=options.mode||this.overlayMode;
    const root=this.ensureOverlay();
    root.innerHTML="";
    const selectedId=window.Forge?.selectedId;
    const m=this.map({includeNonRenderable:false});
    for (const item of m.entities) {
      if (!item.bounds?.onscreen) continue;
      if (mode==="selected" && item.id!==selectedId) continue;
      const box=document.createElement("div");
      const active=item.id===selectedId;
      Object.assign(box.style,{
        position:"absolute",left:item.bounds.x+"px",top:item.bounds.y+"px",
        width:Math.max(2,item.bounds.width)+"px",height:Math.max(2,item.bounds.height)+"px",
        border:(active?"2px solid #65e6ff":"1px solid rgba(255,210,80,.55)"),
        background:active?"rgba(40,190,255,.08)":"transparent",boxSizing:"border-box"
      });
      const label=document.createElement("div");
      label.textContent=item.name+" · "+item.kind;
      Object.assign(label.style,{position:"absolute",left:"0",top:"-18px",font:"11px/16px ui-monospace,monospace",padding:"1px 5px",borderRadius:"4px",background:"rgba(2,11,22,.82)",color:active?"#8cecff":"#ffe28a",whiteSpace:"nowrap"});
      box.appendChild(label);root.appendChild(box);
    }
    return m;
  }

  startOverlay(intervalMs=120) {
    if (this.running) return;
    this.running=true;
    const tick=()=>{
      if (!this.running) return;
      this.renderOverlay();
      this.timer=setTimeout(tick,intervalMs);
    };
    tick();
  }

  stopOverlay() {
    this.running=false;
    clearTimeout(this.timer);
  }

  capture(options={}) {
    const c=this.canvas();
    if (!c) throw new Error("Forge canvas unavailable");
    const w=c.width||c.clientWidth,h=c.height||c.clientHeight;
    const scale=Number(options.scale||1);
    const out=document.createElement("canvas");
    out.width=Math.max(1,Math.round(w*scale));out.height=Math.max(1,Math.round(h*scale));
    const g=out.getContext("2d");
    g.drawImage(c,0,0,out.width,out.height);
    const m=this.map();
    if (options.annotate) {
      const sx=out.width/Math.max(1,c.clientWidth||w),sy=out.height/Math.max(1,c.clientHeight||h);
      g.font=Math.max(10,Math.round(11*scale))+"px ui-monospace, monospace";
      for (const item of m.entities) {
        if (!item.bounds?.onscreen) continue;
        const b=item.bounds;
        g.strokeStyle=item.id===window.Forge.selectedId?"#65e6ff":"#ffd24d";
        g.lineWidth=Math.max(1,2*scale);
        g.strokeRect(b.x*sx,b.y*sy,b.width*sx,b.height*sy);
        g.fillStyle="rgba(2,11,22,.82)";
        const label=item.name+" · "+item.kind;
        const tw=g.measureText(label).width+8*scale;
        g.fillRect(b.x*sx,(b.y-16)*sy,tw,14*scale);
        g.fillStyle="#ffffff";
        g.fillText(label,(b.x+4)*sx,(b.y-5)*sy);
      }
    }
    this.frameId++;
    this.lastFrame={frameId:this.frameId,width:out.width,height:out.height,createdAt:Date.now(),map:m};
    const data=out.toDataURL("image/png");
    return {frameId:this.frameId,width:out.width,height:out.height,dataUrl:options.dataUrl===false?null:data,map:m};
  }

  domAudit() {
    const c=this.canvas(), rect=c?.getBoundingClientRect?.();
    if(!rect?.width||!rect?.height) return {interactive:0,visible:0,overlaps:0,oversized:[],offscreen:0,coverage:0};
    const area=rect.width*rect.height;
    const items=[];
    for(const el of document.querySelectorAll('button,input,select,textarea,[role="button"],a')){
      const s=getComputedStyle(el), r=el.getBoundingClientRect();
      if(s.display==="none"||s.visibility==="hidden"||Number(s.opacity)===0||r.width<=0||r.height<=0) continue;
      const ix=Math.max(0,Math.min(rect.right,r.right)-Math.max(rect.left,r.left));
      const iy=Math.max(0,Math.min(rect.bottom,r.bottom)-Math.max(rect.top,r.top));
      const overlap=ix*iy;
      if(overlap>0) items.push({id:el.id||"",tag:el.tagName.toLowerCase(),text:(el.textContent||"").trim().slice(0,48),area:Number((overlap/area).toFixed(4)),rect:{x:r.left-rect.left,y:r.top-rect.top,width:r.width,height:r.height}});
    }
    const coverage=items.reduce((sum,x)=>sum+x.area,0);
    return {
      interactive:document.querySelectorAll('button,input,select,textarea,[role="button"],a').length,
      visible:items.length,
      overlaps:items.length,
      oversized:items.filter(x=>x.area>=.18).sort((a,b)=>b.area-a.area).slice(0,12),
      offscreen:items.filter(x=>x.rect.x+x.rect.width<0||x.rect.y+x.rect.height<0||x.rect.x>rect.width||x.rect.y>rect.height).length,
      coverage:Number(Math.min(1,coverage).toFixed(4))
    };
  }

  async report(options={}) {
    const qa=window.ForgeQAPro ? await window.ForgeQAPro.audit() : null;
    const map=this.map({includeNonRenderable:!!options.includeNonRenderable});
    const dom=this.domAudit();
    const visual = {
      blank:qa?qa.visibleRatio<0.01:false,
      mostlyBlack:qa?qa.blackRatio>0.92:false,
      lowContrast:qa?qa.meanLuminance<8:false,
      offscreenEntities:map.entities.filter(x=>x.bounds&&!x.bounds.onscreen).length,
      renderableEntities:map.entities.filter(x=>x.visible).length,
      uiOvercrowded:dom.coverage>.55||dom.oversized.length>2,
      blackCanvasWithUI:qa?qa.blackRatio>.92&&dom.visible>0:false,
      renderedContentMissing:qa?qa.visibleRatio<.01&&map.entities.filter(x=>x.visible).length===0:false
    };
    return {version:this.version,frameId:this.frameId,qa,map,dom,visual};
  }

  async saveBaseline(name="default") {
    const report=await this.report();
    this.baselines.set(name,report);
    localStorage.setItem("forge.vision.baselines",JSON.stringify([...this.baselines]));
    return report;
  }

  async diff(name="default") {
    const base=this.baselines.get(name);
    const current=await this.report();
    if (!base) return {ok:false,error:"Vision baseline not found",current};
    const prev=new Map((base.map?.entities||[]).map(x=>[x.id,x]));
    const now=new Map((current.map?.entities||[]).map(x=>[x.id,x]));
    const added=[],removed=[],moved=[],resized=[];
    for (const [id,x] of now) {
      if (!prev.has(id)) {added.push(x);continue;}
      const p=prev.get(id);
      const a=x.screen,b=p.screen;
      if (a&&b&&Math.hypot(a.x-b.x,a.y-b.y)>6) moved.push({id,name:x.name,from:b,to:a});
      const aw=x.bounds,bw=p.bounds;
      if (aw&&bw&&(Math.abs(aw.width-bw.width)>6||Math.abs(aw.height-bw.height)>6)) resized.push({id,name:x.name,from:bw,to:aw});
    }
    for (const [id,x] of prev) if (!now.has(id)) removed.push(x);
    const visualDelta={
      blackRatio:Math.abs((current.qa?.blackRatio||0)-(base.qa?.blackRatio||0)),
      visibleRatio:Math.abs((current.qa?.visibleRatio||0)-(base.qa?.visibleRatio||0)),
      luminance:Math.abs((current.qa?.meanLuminance||0)-(base.qa?.meanLuminance||0))
    };
    return {ok:visualDelta.blackRatio<0.08&&visualDelta.visibleRatio<0.08&&added.length===0&&removed.length===0,moved,resized,added,removed,visualDelta,current};
  }

  selectAt(x,y) {
    const hit=this.hitTest(x,y);
    if (hit.entity) window.Forge.select(hit.entity.id);
    return hit;
  }

  focusAt(x,y) {
    const hit=this.selectAt(x,y);
    if (hit.entity) window.Forge.focus();
    return hit;
  }

  status() {
    return {version:this.version,frameId:this.frameId,overlay:this.running,overlayMode:this.overlayMode,lastFrame:this.lastFrame?{frameId:this.lastFrame.frameId,width:this.lastFrame.width,height:this.lastFrame.height,createdAt:this.lastFrame.createdAt}:null};
  }
}

const ForgeVision = new ForgeVisionCore();
window.ForgeVision = ForgeVision;
export { ForgeVision };
