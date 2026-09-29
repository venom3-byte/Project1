const ForgeRuntime={};

class InputSystem{
  constructor(){this.bindings=new Map();this.down=new Set();this.listeners=new Map();this.bindDefaults();
    addEventListener("keydown",e=>{for(const [a,keys] of this.bindings){if(keys.includes(e.code)||keys.includes(e.key))this.down.add(a)}});
    addEventListener("keyup",e=>{for(const [a,keys] of this.bindings){if(keys.includes(e.code)||keys.includes(e.key))this.down.delete(a)}});
  }
  bind(action,keys){this.bindings.set(action,[...(keys||[])]);return this}
  bindDefaults(){this.bind("moveForward",["KeyW","ArrowUp"]);this.bind("moveBack",["KeyS","ArrowDown"]);this.bind("moveLeft",["KeyA","ArrowLeft"]);this.bind("moveRight",["KeyD","ArrowRight"]);this.bind("jump",["Space"]);this.bind("fire",["Mouse0","KeyJ"]);this.bind("sprint",["ShiftLeft","ShiftRight"]);}
  isDown(action){return this.down.has(action)}
  snapshot(){return Object.fromEntries([...this.bindings].map(([k])=>[k,this.isDown(k)]))}
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
  constructor(){this.ctx=null;this.buffers=new Map();this.master=null}
  init(){if(this.ctx)return;this.ctx=new AudioContext();this.master=this.ctx.createGain();this.master.gain.value=.9;this.master.connect(this.ctx.destination)}
  async load(name,file){this.init();const b=await this.ctx.decodeAudioData(await file.arrayBuffer());this.buffers.set(name,b);return name}
  play(name,{volume=1,loop=false,position=null}={}){this.init();const b=this.buffers.get(name);if(!b)throw new Error("Audio not loaded: "+name);const src=this.ctx.createBufferSource(),gain=this.ctx.createGain();src.buffer=b;src.loop=loop;gain.gain.value=volume;src.connect(gain);if(position&&this.ctx.createPanner){const p=this.ctx.createPanner();p.panningModel="HRTF";p.distanceModel="inverse";p.positionX.value=position.x;p.positionY.value=position.y;p.positionZ.value=position.z;gain.connect(p);p.connect(this.master)}else gain.connect(this.master);src.start();return src}
  stopAll(){}
}

class PrefabSystem{
  constructor(){this.store=new Map(JSON.parse(localStorage.getItem("forge.prefabs")||"[]"))}
  save(name,record){this.store.set(name,{name,record:JSON.parse(JSON.stringify(record))});this.persist();return this.store.get(name)}
  get(name){return this.store.get(name)?.record||null}
  list(){return [...this.store.keys()]}
  spawn(name,position={x:0,y:0,z:0}){const d=this.get(name);if(!d)return null;let r;if(["box","sphere","cylinder","capsule","plane"].includes(d.kind))r=Forge.primitive(d.kind,name+" Instance");else r=Forge.add?Forge.add("empty",name+" Instance"):null;if(!r)return null;const p=d.transform?.position||[position.x,position.y,position.z];r.entity.setLocalPosition(...(position? [position.x,position.y,position.z]:p));if(d.transform?.rotation)r.entity.setLocalEulerAngles(...d.transform.rotation);if(d.transform?.scale)r.entity.setLocalScale(...d.transform.scale);if(d.components?.physics)Forge.setPhysics(r.id,d.components.physics.mode,d.components.physics.shape);return r}
  persist(){localStorage.setItem("forge.prefabs",JSON.stringify([...this.store.entries()]))}
}

ForgeRuntime.input=new InputSystem();ForgeRuntime.nav=new NavigationSystem();ForgeRuntime.save=new SaveSystem();ForgeRuntime.audio=new AudioSystem();ForgeRuntime.prefabs=new PrefabSystem();
ForgeRuntime.snapshot=()=>({input:ForgeRuntime.input.snapshot(),slots:ForgeRuntime.save.list(),prefabs:ForgeRuntime.prefabs.list()});
window.ForgeRuntime=ForgeRuntime;
window.addEventListener("blur",()=>ForgeRuntime.input.down.clear());
