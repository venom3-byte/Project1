const ForgeAgent={
  connected:false,ws:null,commands:new Map(),
  serverCapable(){return location.protocol!=='file:'&&!/github\.io$/i.test(location.hostname)},
  connect(){
    if(!this.serverCapable()||typeof WebSocket==='undefined')return;
    if(this.ws&&(this.ws.readyState===1||this.ws.readyState===0))return;
    const proto=location.protocol==='https:'?'wss:':'ws:';
    try{
      const ws=new WebSocket(proto+'//'+location.host+'/live'); this.ws=ws;
      ws.onopen=()=>{
        this.connected=true;
        ws.send(JSON.stringify({type:'hello',role:'forge-agent',protocol:3}));
      };
      ws.onclose=()=>{this.connected=false;this.ws=null};
      ws.onerror=()=>{this.connected=false};
      ws.onmessage=async e=>{
        let m;
        try{m=JSON.parse(e.data)}catch{return}
        if(m.type!=='forge-command')return;
        try{
          const result=await this.execute(m.command||{});
          ws.send(JSON.stringify({type:'forge-result',id:m.id||null,ok:true,result}));
        }catch(err){
          ws.send(JSON.stringify({type:'forge-result',id:m.id||null,ok:false,error:err.message||String(err)}));
        }
      };
    }catch{
      this.connected=false;this.ws=null;
    }
  },
  async execute(c){const F=window.Forge,P=window.ForgeProduction;switch(c.op){
    case 'agent-task': return this.serverCapable()?{accepted:true,task:String(c.task||''),mode:'server-control-plane'}:await window.AssetForgeLiveVision?.executeAction?.({type:'vision'});
    case 'diagnostics':return F.diagnostics();
    case 'entities':return[...F.entities.values()].map(r=>({id:r.id,name:r.name,kind:r.kind,components:r.components}));
    case 'vision':return F.spatial?.sceneVision?.()||{};
    case 'inspect':{const r=c.id?F.select(c.id):[...F.entities.values()].find(x=>x.name===c.name);if(!r)throw new Error('Entity not found');return F.spatial?.inspect?.(r)||null}
    case 'select':{const r=c.id?F.select(c.id):[...F.entities.values()].find(x=>x.name===c.name);if(!r)throw new Error('Entity not found');return{id:r.id,name:r.name,kind:r.kind}}
    case 'create':{let r;if(c.kind==='camera')r=F.createCamera(c.name||'Camera',{x:c.x??6,y:c.y??4,z:c.z??8});else if(c.kind==='light')r=F.createLight(c.name||'Light');else r=F.primitive(c.kind||'box',c.name);if(c.x!=null||c.y!=null||c.z!=null)r.entity.setLocalPosition(c.x||0,c.y||0,c.z||0);F.select(r.id);return{id:r.id,name:r.name,kind:r.kind}}
    case 'transform':{if(c.id)F.select(c.id);F.transform(c);return F.spatial?.inspect?.(F.selected())||null}
    case 'move-screen':{const r=F.selected();if(!r)throw new Error('No selected entity');return F.spatial?.moveToScreen?.(r.id,c.x,c.y,c.depth??.5,c.planeY??0)||false}
    case 'physics':{if(c.id)F.select(c.id);const r=F.selected();if(!r)throw new Error('Select an entity first');if(c.mode==='none')F.removePhysics(r.id);else F.setPhysics(r.id,c.mode||'dynamic',c.shape||'box');return r.components.physics||null}
    case 'duplicate':{if(c.id)F.select(c.id);const r=F.duplicate();return r?{id:r.id,name:r.name,kind:r.kind}:null}
    case 'delete':{if(c.id)F.select(c.id);F.delete();return true}
    case 'focus':F.focus();return true;case 'frame':F.frame();return true;case 'play':F.running=true;F.timelinePlaying=true;return true;case 'stop':F.running=false;F.timelinePlaying=false;return true;case 'key':F.key();return true;
    case 'pcg':{if(!P)throw new Error('Production layer unavailable');const rs=P.world.generate(c.kind||'trees',{seed:c.seed||1337,count:c.count||30,area:c.area||30});F.frame();return{created:rs.length}}
    case 'project':return F.serialize();case 'save':return{fileName:'forge-project.forge.json',data:JSON.stringify(F.serialize(),null,2)};case 'asset-registry':return P?P.assets.all():[];
    case 'qa':return window.ForgeQAPro?await window.ForgeQAPro.audit():F.diagnostics();case 'qa-baseline':return window.ForgeQAPro?await window.ForgeQAPro.saveBaseline(c.name||'default'):null;case 'qa-diff':return window.ForgeQAPro?await window.ForgeQAPro.diff(c.name||'default'):null;
    case 'screenshot':{const canvas=document.querySelector('#viewport');return{dataUrl:canvas?.toDataURL('image/png')||null}}
    case 'runtime':return window.ForgeRuntime?.snapshot?.()||{};
    case 'nav-bake':{window.ForgeRuntime.nav.bakeFromScene(F);return{width:window.ForgeRuntime.nav.width,height:window.ForgeRuntime.nav.height,cell:window.ForgeRuntime.nav.cell}}
    case 'nav-path':return window.ForgeRuntime.nav.path(c.start,c.goal);
    case 'save-slot':window.ForgeRuntime.save.save(String(c.slot||'default'),c.data||F.serialize());return true;case 'load-slot':return window.ForgeRuntime.save.load(String(c.slot||'default'));
    case 'prefab-spawn':{const r=window.ForgeRuntime.prefabs.spawn(c.name||'Player',{x:c.x||0,y:c.y||0,z:c.z||0});if(!r)throw new Error('Prefab not found');return{id:r.id,name:r.name,kind:r.kind}}
    case 'template-third-person':return window.ForgeGameplay.createThirdPersonTemplate();case 'template-racing':return window.ForgeGameplay.createRacingTemplate();case 'template-showcase':return window.ForgeGameplay.createShowcaseGame();case 'gameplay-status':return{runtime:window.ForgeGameplay.status()};
    case 'animation-state':return window.Forge.setAnimationState(c.id||window.Forge.selectedId,c.state||'Idle');case 'animation-graph-create':return window.ForgeAnimation.createGraph(c.id||window.Forge.selectedId,c.name||'Locomotion');case 'animation-graph-param':return window.ForgeAnimation.setParameter(c.graphId,c.key,c.value);case 'rig-profile':return window.ForgeAnimation.createRigProfile(c.id||window.Forge.selectedId,c.name||'Humanoid');case 'rig-validate':return window.ForgeAnimation.validateRig(c.rigId);
    case 'terrain-generate':return window.ForgeTerrain.generate(c.name||'Terrain',c.options||{}).id;case 'shader-apply':window.ForgeShaders.applyPreset(c.preset||'dissolve');return F.diagnostics();case 'replay-status':return window.ForgeReplay.status();
    default:throw new Error('Unknown Forge command: '+c.op);
  }}
};window.ForgeAgent=ForgeAgent;ForgeAgent.connect();