
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
      if(m.type==="frame"){window.ForgeVisionLatestFrame=m;return}
      if(m.type!=="forge-command")return;
      try{const result=await this.execute(m.command||{});ws.send(JSON.stringify({type:"forge-result",id:m.id||null,ok:true,result}))}
      catch(err){ws.send(JSON.stringify({type:"forge-result",id:m.id||null,ok:false,error:err.message||String(err)}))}
    };
  },
  async execute(c){
    const F=window.Forge,P=window.ForgeProduction;
    switch(c.op){
      case "agent-task": return {accepted:true,task:String(c.task||""),note:"Natural-language task accepted by Forge control plane; convert to deterministic engine commands before execution."};
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
      case "qa": return window.ForgeQAPro?await window.ForgeQAPro.audit():F.diagnostics();
      case "qa-baseline": return window.ForgeQAPro?await window.ForgeQAPro.saveBaseline(c.name||"default"):null;
      case "qa-diff": return window.ForgeQAPro?await window.ForgeQAPro.diff(c.name||"default"):null;
      case "screenshot": {const canvas=document.querySelector("#viewport");return{dataUrl:canvas?.toDataURL("image/png")||null};}
      case "vision-map": return window.ForgeVision?.map(c.options||{})||null;
      case "vision-capture": return window.ForgeVision?.capture(c.options||{annotate:true})||null;
      case "vision-report": return window.ForgeVision?.report(c.options||{})||null;
      case "vision-latest": return window.ForgeVisionLatestFrame||null;
      case "vision-pick": return window.ForgeVision?.hitTest(Number(c.x)||0,Number(c.y)||0)||null;
      case "vision-select": return window.ForgeVision?.selectAt(Number(c.x)||0,Number(c.y)||0)||null;
      case "vision-focus": return window.ForgeVision?.focusAt(Number(c.x)||0,Number(c.y)||0)||null;
      case "vision-overlay": {
        if(!window.ForgeVision)throw new Error("Vision core unavailable");
        if(c.enabled===false)window.ForgeVision.stopOverlay();
        else {window.ForgeVision.overlayMode=c.mode||"selected";window.ForgeVision.startOverlay(c.intervalMs||120);}
        return window.ForgeVision.status();
      }

      case "runtime": return window.ForgeRuntime?.snapshot?.()||{};
      case "nav-bake": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");window.ForgeRuntime.nav.bakeFromScene(F);return{width:window.ForgeRuntime.nav.width,height:window.ForgeRuntime.nav.height,cell:window.ForgeRuntime.nav.cell};}
      case "nav-path": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");return window.ForgeRuntime.nav.path(c.start,c.goal);}
      case "save-slot": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");window.ForgeRuntime.save.save(String(c.slot||"default"),c.data||F.serialize());return true;}
      case "load-slot": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");return window.ForgeRuntime.save.load(String(c.slot||"default"));}
      case "prefab-spawn": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");const r=window.ForgeRuntime.prefabs.spawn(c.name||"Player",{x:c.x||0,y:c.y||0,z:c.z||0});if(!r)throw new Error("Prefab not found");return{id:r.id,name:r.name,kind:r.kind};}
      case "prefab-save": {if(!window.ForgeRuntime)throw new Error("Runtime layer unavailable");const r=F.selected();if(!r)throw new Error("Select entity first");return window.ForgeRuntime.prefabs.save(c.name||r.name,{name:r.name,kind:r.kind,components:r.components,transform:{position:[r.entity.getLocalPosition().x,r.entity.getLocalPosition().y,r.entity.getLocalPosition().z],rotation:[r.entity.getLocalEulerAngles().x,r.entity.getLocalEulerAngles().y,r.entity.getLocalEulerAngles().z],scale:[r.entity.getLocalScale().x,r.entity.getLocalScale().y,r.entity.getLocalScale().z]}});}
      case "template-third-person": return window.ForgeGameplay.createThirdPersonTemplate();
      case "template-racing": return window.ForgeGameplay.createRacingTemplate();
      case "template-showcase": return window.ForgeGameplay.createShowcaseGame();
      case "gameplay-status": return {runtime:window.ForgeGameplay.status(),actors:window.ForgeData?[...window.ForgeData.actors].map(([id,a])=>({id,attributes:a.attributes.serialize(),inventory:Object.fromEntries(a.inventory),tags:a.tags.all()})):[]};
      case "tag-add": {const a=window.ForgeData.actor(c.actor||"player");a.tags.add(...(c.tags||[]));return a.tags.all();}
      case "attribute": {const a=window.ForgeData.actor(c.actor||"player");if(c.value!=null)a.attributes.set(c.name,c.value);if(c.delta!=null)a.attributes.modify(c.name,c.delta);return a.attributes.get(c.name);}
      case "inventory-grant": {const a=window.ForgeData.actor(c.actor||"player");a.grantItem(c.item,c.count||1);return Object.fromEntries(a.inventory);}
      case "ability-define": {const a=window.ForgeData.actor(c.actor||"player");return a.addAbility(c.id,c.config||{}).id;}
      case "ability-use": {const a=window.ForgeData.actor(c.actor||"player"),ab=a.abilities.get(c.id);if(!ab)throw new Error("Ability not found");return ab.activate(a,c.context||{});}
      case "quest-define": return window.ForgeData.quests.define(c.id,c.data||{});
      case "quest-progress": window.ForgeData.quests.progress(c.id,c.objectiveId,c.amount||1);return window.ForgeData.quests.status(c.id);
      case "net-connect": window.ForgeNet.connect(c.room||"default",{peerId:c.peerId});return window.ForgeNet.status();
      case "net-status": return window.ForgeNet.status();
      case "net-bind": window.ForgeNet.bindEntity(c.id||window.Forge.selectedId);return window.ForgeNet.status();
      case "net-publish": return window.ForgeNet.publishEntity();
      case "replay-record": window.ForgeReplay.startRecord();return window.ForgeReplay.status();
      case "replay-stop": return window.ForgeReplay.stopRecord();
      case "replay-play": window.ForgeReplay.play(c.data||window.ForgeReplay.serialize());return window.ForgeReplay.status();
      case "terrain-generate": return window.ForgeTerrain.generate(c.name||"Terrain",c.options||{}).id;
      case "shader-apply": window.ForgeShaders.applyPreset(c.preset||"dissolve");return window.Forge.diagnostics();
      case "animation-state": return window.Forge.setAnimationState(c.id||window.Forge.selectedId,c.state||"Idle");
      case "animation-graph-create": return window.ForgeAnimation.createGraph(c.id||window.Forge.selectedId,c.name||"Locomotion");
      case "animation-graph-param": return window.ForgeAnimation.setParameter(c.graphId,c.key,c.value);
      case "rig-profile": return window.ForgeAnimation.createRigProfile(c.id||window.Forge.selectedId,c.name||"Humanoid");
      case "rig-validate": return window.ForgeAnimation.validateRig(c.rigId);
      case "pose-db-create": return window.ForgePoseSearch.createDatabase(c.id||"Locomotion",c.entries||[],c.options||{});
      case "pose-db-add": return window.ForgePoseSearch.addEntries(c.id||"Locomotion",c.entries||[]);
      case "pose-query": return window.ForgePoseSearch.query(c.id||"Locomotion",c.vector||[],c.options||{});
      case "motion-match": return window.ForgePoseSearch.match(c.id||"Locomotion",c.actorId||window.Forge.selectedId,c.vector||[],c.options||{});
      case "pose-status": return window.ForgePoseSearch.status();
      case "replay-stop-play": window.ForgeReplay.stop();return window.ForgeReplay.status();
      case "replay-status": return window.ForgeReplay.status();
      case "build": if(P?.build) return P.build(); return{supported:false};
      default: throw new Error("Unknown Forge command: "+c.op);
    }
  }
};
window.ForgeAgent=ForgeAgent;
ForgeAgent.connect();
