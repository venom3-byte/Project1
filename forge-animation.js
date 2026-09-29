const ForgeAnimation={
  graphs:new Map(),
  rigs:new Map(),
  normalize(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"")},
  createGraph(entityId,name="Locomotion"){
    const r=Forge.entities.get(entityId);if(!r)throw new Error("Entity not found");
    const clips=r.components.animation?.clips||[];const states=clips.map((clip,i)=>({name:clip,clip,loop:true,speed:1}));
    const graph={id:crypto.randomUUID(),entityId,name,states,transitions:[],active:states[0]?.name||null,parameters:{speed:0,grounded:true}};
    this.graphs.set(graph.id,graph);return graph
  },
  addTransition(graphId,from,to,condition={}){const g=this.graphs.get(graphId);if(!g)throw new Error("Graph not found");g.transitions.push({from,to,condition});return g}
  setParameter(graphId,key,value){const g=this.graphs.get(graphId);if(!g)throw new Error("Graph not found");g.parameters[key]=value;this.evaluate(graphId);return g.parameters[key]},
  evaluate(graphId){
    const g=this.graphs.get(graphId);if(!g)return null;
    for(const t of g.transitions){if(t.from!==g.active)continue;const c=t.condition||{};let pass=true;for(const [k,v] of Object.entries(c)){const actual=g.parameters[k];if(typeof v==="number"&&typeof actual==="number"&&actual<v)pass=false;else if(typeof v==="boolean"&&actual!==v)pass=false;else if(typeof v==="string"&&actual!==v)pass=false}if(pass){g.active=t.to;break}}
    const r=Forge.entities.get(g.entityId);if(r?.entity?.anim?.baseLayer&&g.active){try{r.entity.anim.baseLayer.play(g.active)}catch{}}return g.active
  },
  play(graphId,state){const g=this.graphs.get(graphId);if(!g)return false;g.active=state;const r=Forge.entities.get(g.entityId);if(r?.entity?.anim?.baseLayer){try{r.entity.anim.baseLayer.play(state);return true}catch{}}return false},
  createRigProfile(entityId,name="Humanoid"){
    const r=Forge.entities.get(entityId);if(!r)throw new Error("Entity not found");
    const bones=[];const walk=e=>{bones.push(e.name);for(const c of e.children)walk(c)};walk(r.entity);
    const aliases={pelvis:["pelvis","hips","hip"],spine:["spine","spine1","spine2","chest"],head:["head"],leftUpperArm:["leftupperarm","leftarm","upperarm_l","lupperarm"],leftLowerArm:["leftlowerarm","leftforearm","lowerarm_l","lforearm"],leftHand:["lefthand","hand_l","lhand"],rightUpperArm:["rightupperarm","rightarm","upperarm_r","rupperarm"],rightLowerArm:["rightlowerarm","rightforearm","lowerarm_r","rforearm"],rightHand:["righthand","hand_r","rhand"],leftUpperLeg:["leftupleg","leftthigh","thigh_l","lthigh"],leftLowerLeg:["leftlowerleg","leftcalf","calf_l","lcalf"],leftFoot:["leftfoot","foot_l","lfoot"],rightUpperLeg:["rightupleg","rightthigh","thigh_r","rthigh"],rightLowerLeg:["rightlowerleg","rightcalf","calf_r","rcalf"],rightFoot:["rightfoot","foot_r","rfoot"]};
    const map={};for(const [role,list] of Object.entries(aliases)){const hit=bones.find(b=>list.includes(this.normalize(b)) || list.includes(this.normalize(b).replace(/^mixamorig/,"")));if(hit)map[role]=hit}
    const profile={id:crypto.randomUUID(),name,entityId,bones,humanoid:map,coverage:Number((Object.keys(map).length/Object.keys(aliases).length).toFixed(3))};this.rigs.set(profile.id,profile);return profile
  },
  validateRig(id){const r=this.rigs.get(id);if(!r)return null;return{coverage:r.coverage,valid:r.coverage>=.7,missing:["pelvis","spine","head","leftHand","rightHand","leftFoot","rightFoot"].filter(k=>!r.humanoid[k])}},
  serialize(){return{graphs:[...this.graphs.values()],rigs:[...this.rigs.values()]}},
  load(data){this.graphs=new Map((data?.graphs||[]).map(g=>[g.id,g]));this.rigs=new Map((data?.rigs||[]).map(r=>[r.id,r]))}
};
window.ForgeAnimation=ForgeAnimation;