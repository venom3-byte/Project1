const ForgeRuntime={};

class InputSystem{
  constructor(){this.bindings=new Map();this.down=new Set();this.listeners=new Map();this.virtualMove={x:0,z:0};this.gamepadMove={x:0,z:0};this.gamepadDown=new Set();this.bindDefaults();
    addEventListener("keydown",e=>{for(const [a,keys] of this.bindings){if(keys.includes(e.code)||keys.includes(e.key))this.down.add(a)}});
    addEventListener("keyup",e=>{for(const [a,keys] of this.bindings){if(keys.includes(e.code)||keys.includes(e.key))this.down.delete(a)}});addEventListener("blur",()=>this.down.clear());
  }
  bind(action,keys){this.bindings.set(action,[...(keys||[])]);return this}
  bindDefaults(){this.bind("moveForward",["KeyW","ArrowUp"]);this.bind("moveBack",["KeyS","ArrowDown"]);this.bind("moveLeft",["KeyA","ArrowLeft"]);this.bind("moveRight",["KeyD","ArrowRight"]);this.bind("jump",["Space"]);this.bind("fire",["Mouse0","KeyJ"]);this.bind("sprint",["ShiftLeft","ShiftRight"]);}
  pollGamepad(){const pads=navigator.getGamepads?.()||[];const p=[...pads].find(x=>x);this.gamepadDown.clear();if(!p){this.gamepadMove={x:0,z:0};return}const ax=Number(p.axes?.[0]||0),ay=Number(p.axes?.[1]||0);this.gamepadMove={x:Math.abs(ax)>.12?ax:0,z:Math.abs(ay)>.12?-ay:0};if(p.buttons?.[0]?.pressed)this.gamepadDown.add("jump");if(p.buttons?.[7]?.pressed)this.gamepadDown.add("fire");if(p.buttons?.[10]?.pressed)this.gamepadDown.add("sprint")}
  isDown(action){this.pollGamepad();return this.down.has(action)||this.gamepadDown.has(action)}
  moveVector(){this.pollGamepad();const x=this.virtualMove.x+this.gamepadMove.x+((this.down.has("moveRight")?1:0)-(this.down.has("moveLeft")?1:0));const z=this.virtualMove.z+this.gamepadMove.z+((this.down.has("moveForward")?1:0)-(this.down.has("moveBack")?1:0));const l=Math.hypot(x,z);return l>1?{x:x/l,z:z/l}:{x,z}}
  snapshot(){return Object.fromEntries([...this.bindings].map(([k])=>[k,this.isDown(k)]))}

  mountMobileControls(){
    if(document.getElementById("forgeMobileControls"))return;
    const root=document.createElement("div");root.id="forgeMobileControls";Object.assign(root.style,{position:"fixed",inset:"0",zIndex:"110",pointerEvents:"none",display:"none"});
    root.innerHTML='<div id="forgeJoy" style="position:absolute;left:22px;bottom:22px;width:120px;height:120px;border-radius:50%;border:1px solid #ffffff55;background:#07132166;pointer-events:auto"><div id="forgeKnob" style="position:absolute;left:38px;top:38px;width:44px;height:44px;border-radius:50%;background:#4dd7ffaa"></div></div><div style="position:absolute;right:22px;bottom:22px;display:flex;gap:12px"><button data-mobile="sprint" style="pointer-events:auto;border-radius:50%;width:58px;height:58px">RUN</button><button data-mobile="jump" style="pointer-events:auto;border-radius:50%;width:70px;height:70px">JUMP</button><button data-mobile="fire" style="pointer-events:auto;border-radius:50%;width:70px;height:70px">FIRE</button></div>';
    document.body.appendChild(root);
    const joy=root.querySelector("#forgeJoy"),knob=root.querySelector("#forgeKnob");let active=false,cx=0,cy=0;
    const move=e=>{if(!active)return;const r=joy.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),m=45,l=Math.min(m,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);const x=Math.cos(a)*l/m,y=Math.sin(a)*l/m;knob.style.transform="translate("+Math.round(x*36)+"px,"+Math.round(y*36)+"px)";this.virtualMove={x:x,z:-y}};
    const end=()=>{active=false;this.virtualMove={x:0,z:0};knob.style.transform=""};
    joy.addEventListener("pointerdown",e=>{active=true;joy.setPointerCapture(e.pointerId);move(e)});joy.addEventListener("pointermove",move);joy.addEventListener("pointerup",end);joy.addEventListener("pointercancel",end);
    for(const b of root.querySelectorAll("[data-mobile]")){const a=b.dataset.mobile;b.addEventListener("pointerdown",e=>{e.preventDefault();this.down.add(a);try{window.ForgeAndroid?.vibrate?.(a==="fire"?18:10)}catch{}});b.addEventListener("pointerup",()=>this.down.delete(a));b.addEventListener("pointercancel",()=>this.down.delete(a));b.addEventListener("pointerleave",()=>this.down.delete(a))}
    const show=()=>{const touch=navigator.maxTouchPoints>0||matchMedia("(pointer:coarse)").matches;const playMode=document.body?.dataset?.forgeMode==="play";root.style.display=(touch&&playMode)?"block":"none"};show();addEventListener("resize",show);window.addEventListener("forgegamemodechange",show);
  }
}

class NavigationSystem{
  constructor(){this.cell=.75;this.width=80;this.height=80;this.blocked=new Uint8Array(this.width*this.height)}
  index(x,z){return z*this.width+x}
  clear(){this.blocked.fill(0)}
  worldToCell(v){return{x:Math.floor(v.x/this.cell+this.width/2),z:Math.floor(v.z/this.cell+this.height/2)}}
  cellToWorld(x,z){return{x:(x-this.width/2+.5)*this.cell,z:(z-this.height/2+.5)*this.cell}}
  bakeFromScene(engine){this.clear();for(const r of engine.entities.values()){if(!r.components.navObstacle)continue;const p=r.entity.getPosition(),s=r.entity.getLocalScale();const min=this.worldToCell({x:p.x-s.x,z:p.z-s.z}),max=this.worldToCell({x:p.x+s.x,z:p.z+s.z});for(let z=Math.max(0,min.z);z<=Math.min(this.height-1,max.z);z++)for(let x=Math.max(0,min.x);x<=Math.min(this.width-1,max.x);x++)this.blocked[this.index(x,z)]=1}}
  path(start,goal){const s=this.worldToCell(start),g=this.worldToCell(goal),key=(x,z)=>x+","+z;if(!this.in(s.x,s.z)||!this.in(g.x,g.z))return[];const open=[{x:s.x,z:s.z,g:0,f:0}],came=new Map(),best=new Map([[key(s.x,s.z),0]]);const h=(x,z)=>Math.abs(x-g.x)+Math.abs(z-g.z);while(open.length){open.sort((a,b)=>a.f-b.f);const n=open.shift();if(n.x===g.x&&n.z===g.z){const out=[];let k=key(n.x,n.z),cur=n;while(cur){out.push(this.cellToWorld(cur.x,cur.z));const prev=came.get(k);if(!prev)break;k=prev;cur=JSON.parse(prev)}return out.reverse()}for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=n.x+dx,z=n.z+dz;if(!this.in(x,z)||this.blocked[this.index(x,z)])continue;const ng=n.g+1,k2=key(x,z);if(!best.has(k2)||ng<best.get(k2)){best.set(k2,ng);came.set(k2,JSON.stringify({x:n.x,z:n.z}));open.push({x,z,g:ng,f:ng+h(x,z)})}}}return[]}
  in(x,z){return x>=0&&z>=0&&x<this.width&&z<this.height}
}

class SaveSystem{
  save(slot,data){localStorage.setItem("forge.slot."+slot,JSON.stringify({savedAt:new Date().toISOString(),data}));return true}
  load(slot){const v=localStorage.getItem("forge.slot."+slot);return v?JSON.parse(v):null}
  list(){return Object.keys(localStorage).filter(k=>k.startsWith("forge.slot.")).map(k=>k.slice(11))}
  remove(slot){localStorage.removeItem("forge.slot."+slot)}
}

class AudioSystem{
  constructor(){this.ctx=null;this.buffers=new Map();this.buses=new Map();this.active=new Set();this.volumes={master:1,music:1,sfx:1,ui:1,ambience:1}}
  init(){if(this.ctx)return;this.ctx=new AudioContext();this.buses.set("master",this.ctx.createGain());this.buses.set("music",this.ctx.createGain());this.buses.set("sfx",this.ctx.createGain());this.buses.set("ui",this.ctx.createGain());this.buses.set("ambience",this.ctx.createGain());this.buses.get("music").connect(this.buses.get("master"));this.buses.get("sfx").connect(this.buses.get("master"));this.buses.get("ui").connect(this.buses.get("master"));this.buses.get("ambience").connect(this.buses.get("master"));this.buses.get("master").connect(this.ctx.destination);this.applyVolumes()}
  applyVolumes(){for(const [name,g] of this.buses){g.gain.value=this.volumes[name]??1}}
  setVolume(bus,value){this.volumes[bus]=Math.max(0,Math.min(1,Number(value)||0));if(this.ctx)this.applyVolumes()}
  async load(name,file){this.init();const b=await this.ctx.decodeAudioData(await file.arrayBuffer());this.buffers.set(name,b);return name}
  play(name,{volume=1,loop=false,position=null,bus="sfx"}={}){this.init();const b=this.buffers.get(name);if(!b)throw new Error("Audio not loaded: "+name);if(this.ctx.state==="suspended")this.ctx.resume().catch(()=>{});const src=this.ctx.createBufferSource(),gain=this.ctx.createGain();src.buffer=b;src.loop=loop;gain.gain.value=volume;src.connect(gain);let target=this.buses.get(bus)||this.buses.get("sfx");if(position){const p=this.ctx.createPanner();p.panningModel="HRTF";p.distanceModel="inverse";p.refDistance=2;p.maxDistance=100;p.rolloffFactor=1;p.positionX.value=position.x;p.positionY.value=position.y;p.positionZ.value=position.z;gain.connect(p);p.connect(target)}else gain.connect(target);src.onended=()=>this.active.delete(src);this.active.add(src);src.start();return src}
  stopAll(){for(const s of this.active){try{s.stop()}catch{} }this.active.clear()}
  serialize(){return{volumes:this.volumes}}
  loadState(d){if(d?.volumes)this.volumes=Object.assign(this.volumes,d.volumes);if(this.ctx)this.applyVolumes()}
}

class PrefabSystem{
  constructor(){this.store=new Map(JSON.parse(localStorage.getItem("forge.prefabs")||"[]"))}
  capture(id){
    const r=Forge.entities.get(id);if(!r)return null;
    const serializeEntity=e=>({name:e.name,kind:e.__forge?.kind||"empty",transform:{position:[e.getLocalPosition().x,e.getLocalPosition().y,e.getLocalPosition().z],rotation:[e.getLocalEulerAngles().x,e.getLocalEulerAngles().y,e.getLocalEulerAngles().z],scale:[e.getLocalScale().x,e.getLocalScale().y,e.getLocalScale().z]},components:JSON.parse(JSON.stringify(e.__forge?.components||{})),children:e.children.map(serializeEntity)});
    return serializeEntity(r.entity)
  }
  save(name,recordOrId){const record=typeof recordOrId==="string"?this.capture(recordOrId):recordOrId;if(!record)throw new Error("Prefab source not found");this.store.set(name,{name,record:structuredClone(record)});this.persist();return this.store.get(name)}
  get(name){return this.store.get(name)?.record||null}
  list(){return [...this.store.keys()]}
  spawn(name,position={x:0,y:0,z:0}){
    const d=this.get(name);if(!d)return null;
    const spawnNode=(data,parent=null,isRoot=false)=>{
      let r;if(["box","sphere","cylinder","capsule","plane"].includes(data.kind))r=Forge.primitive(data.kind,data.name);else r=Forge.add("empty",data.name);
      if(parent)r.entity.reparent(parent.entity);
      const t=data.transform||{};r.entity.setLocalPosition(...(isRoot?[position.x,position.y,position.z]:(t.position||[0,0,0])));r.entity.setLocalEulerAngles(...(t.rotation||[0,0,0]));r.entity.setLocalScale(...(t.scale||[1,1,1]));
      r.components=data.components||{};r.entity.__forge.components=r.components;if(r.components.physics)Forge.setPhysics(r.id,r.components.physics.mode,r.components.physics.shape);
      for(const ch of data.children||[])spawnNode(ch,r,false);return r
    };
    return spawnNode(d,null,true)
  }
  persist(){localStorage.setItem("forge.prefabs",JSON.stringify([...this.store.entries()]))}
}

ForgeRuntime.input=new InputSystem();ForgeRuntime.nav=new NavigationSystem();ForgeRuntime.save=new SaveSystem();ForgeRuntime.audio=new AudioSystem();ForgeRuntime.prefabs=new PrefabSystem();
ForgeRuntime.snapshot=()=>({input:ForgeRuntime.input.snapshot(),slots:ForgeRuntime.save.list(),prefabs:ForgeRuntime.prefabs.list(),audio:ForgeRuntime.audio.serialize()});
window.ForgeRuntime=ForgeRuntime;ForgeRuntime.input.mountMobileControls();
window.addEventListener("blur",()=>{ForgeRuntime.input.down.clear();ForgeRuntime.input.gamepadDown.clear()});
