
const ForgeAgent={
  connected:false,
  ws:null,
  commands:new Map(),
  connect(){
    if(this.ws && (this.ws.readyState===1 || this.ws.readyState===0)) return;
    const proto=location.protocol==="https:"?"wss:":"ws:";
    const ws=new WebSocket(proto+"//"+location.host+"/live");this.ws=ws;
    ws.onopen=()=>{this.connected=true;ws.send(JSON.stringify({type:"hello",role:"forge-agent",protocol:2}));};
    ws.onclose=()=>{this.connected=false;setTimeout(()=>this.connect(),1200)};
    ws.onmessage=async e=>{
      let m;try{m=JSON.parse(e.data)}catch{return}
      if(m.type!=="forge-command")return;
      try{const result=await this.execute(m.command||{});ws.send(JSON.stringify({type:"forge-result",id:m.id||null,ok:true,result}))}
      catch(err){ws.send(JSON.stringify({type:"forge-result",id:m.id||null,ok:false,error:err.message||String(err)}))}
    };
  },
  async execute(c){
    const F=window.Forge,P=window.ForgeProduction;
    switch(c.op){
      case "diagnostics": return F.diagnostics();
      case "entities": return [...F.entities.values()].map(r=>({id:r.id,name:r.name,kind:r.kind,components:r.components}));
      case "select": {const r=c.id?F.select(c.id):[...F.entities.values()].find(x=>x.name===c.name);if(!r)throw new Error("Entity not found");return{ id:r.id,name:r.name,kind:r.kind};}
      case "create": {let r;if(c.kind==="camera")r=F.createCamera(c.name||"Camera",{x:c.x||6,y:c.y||4,z:c.z||8});else if(c.kind==="light")r=F.createLight(c.name||"Light");else r=F.primitive(c.kind||"box",c.name);if(c.x!=null||c.y!=null||c.z!=null)r.entity.setLocalPosition(c.x||0,c.y||0,c.z||0);F.select(r.id);return{ id:r.id,name:r.name,kind:r.kind};}
      case "transform": {if(c.id)F.select(c.id);F.transform(c);return F.selected()?{id:F.selected().id,name:F.selected().name}:null;}
      case "physics": {if(c.id)F.select(c.id);const r=F.selected();if(!r)throw new Error("Select an entity first");if(c.mode==="none")F.removePhysics(r.id);else F.setPhysics(r.id,c.mode||"dynamic",c.shape||"box");return r.components.physics||null;}
      case "duplicate": {if(c.id)F.select(c.id);const r=F.duplicate();return r?{id:r.id,name:r.name,kind:r.kind}:null;}
      case "delete": {if(c.id)F.select(c.id);F.delete();return true;}
      case "focus": F.focus();return true;
      case "frame": F.frame();return true;
      case "play": F.running=true;F.timelinePlaying=true;return true;
      case "stop": F.running=false;F.timelinePlaying=false;return true;
      case "key": F.key();return true;
      case "pcg": {if(!P)throw new Error("Production layer unavailable");const rs=P.world.generate(c.kind||"trees",{seed:c.seed||1337,count:c.count||30,area:c.area||30});F.frame();return{created:rs.length};}
      case "stream": {if(!P)throw new Error("Production layer unavailable");P.world.updateStreaming(c.radius||2);return P.world.partition();}
      case "graph-run": {if(!P)throw new Error("Production layer unavailable");return P.graph.run();}
      case "project": return F.serialize();
      case "save": {const data=JSON.stringify(F.serialize(),null,2);return{fileName:"forge-project.forge.json",data};}
      case "asset-registry": return P?P.assets.all():[];
      case "qa": return window.ForgeQA?.status?window.ForgeQA.status():F.diagnostics();
      case "screenshot": {const canvas=document.querySelector("#viewport");return{dataUrl:canvas?.toDataURL("image/png")||null};}
      case "runtime": return window.ForgeRuntime?.snapshot?.()||{};
      case "nav-bake": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");window.ForgeRuntime.nav.bakeFromScene(F);return{width:window.ForgeRuntime.nav.width,height:window.ForgeRuntime.nav.height,cell:window.ForgeRuntime.nav.cell};}
      case "nav-path": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");return window.ForgeRuntime.nav.path(c.start,c.goal);}
      case "save-slot": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");window.ForgeRuntime.save.save(String(c.slot||"default"),c.data||F.serialize());return true;}
      case "load-slot": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");return window.ForgeRuntime.save.load(String(c.slot||"default"));}
      case "prefab-save": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");const r=F.selected();if(!r)throw new Error("Select entity first");return window.ForgeRuntime.prefabs.save(c.name||r.name,{name:r.name,kind:r.kind,components:r.components,transform:{position:[r.entity.getLocalPosition().x,r.entity.getLocalPosition().y,r.entity.getLocalPosition().z],rotation:[r.entity.getLocalEulerAngles().x,r.entity.getLocalEulerAngles().y,r.entity.getLocalEulerAngles().z],scale:[r.entity.getLocalScale().x,r.entity.getLocalScale().y,r.entity.getLocalScale().z]}});}
      case "template-third-person": return window.ForgeGameplay.createThirdPersonTemplate();
      case "template-racing": return window.ForgeGameplay.createRacingTemplate();
      case "gameplay-status": return window.ForgeGameplay.status();
      case "build": if(P?.build) return P.build(); return{supported:false};
      default: throw new Error("Unknown Forge command: "+c.op);
    }
  }
};
window.ForgeAgent=ForgeAgent;
ForgeAgent.connect();
