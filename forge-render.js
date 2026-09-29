
import {pc} from "./forge-engine.js";

class ForgeRenderSystem{
  constructor(){this.profile="high";this.profiles={
    mobile:{renderScale:.75,exposure:1,toneMapping:pc.TONEMAP_FILMIC,shadows:false,shadowDistance:24,fog:false},
    balanced:{renderScale:.9,exposure:1,toneMapping:pc.TONEMAP_ACES2,shadows:true,shadowDistance:40,fog:false},
    high:{renderScale:1,exposure:1,toneMapping:pc.TONEMAP_ACES2,shadows:true,shadowDistance:80,fog:true},
    cinematic:{renderScale:1,exposure:1.05,toneMapping:pc.TONEMAP_ACES,shadows:true,shadowDistance:150,fog:true}
  };this.materialGraphs=new Map()}
  apply(profile=this.profile){
    this.profile=profile;const p=this.profiles[profile]||this.profiles.high,app=window.Forge.app;if(!app)return;
    app.scene.exposure=p.exposure;
    for(const r of window.Forge.entities.values()){
      if(r.entity.camera){r.entity.camera.toneMapping=p.toneMapping;r.entity.camera.gammaCorrection=pc.GAMMA_SRGB}
      if(r.entity.light){r.entity.light.castShadows=p.shadows;r.entity.light.shadowDistance=p.shadowDistance}
    }
    const canvas=window.Forge.canvas;if(canvas){canvas.style.width=(100*p.renderScale)+"%";canvas.style.height=(100*p.renderScale)+"%";canvas.style.margin=p.renderScale<1?"auto":""}
    return p
  }
  quality(){return{profile:this.profile,config:this.profiles[this.profile]}}
  createMaterialGraph(name="PBR Material"){
    const graph={id:crypto.randomUUID(),name,nodes:[
      {id:"color",type:"Color",value:[.22,.62,.9,1],x:40,y:40},
      {id:"metal",type:"Scalar",value:.05,x:40,y:140},
      {id:"rough",type:"Scalar",value:.5,x:40,y:220},
      {id:"output",type:"PBROutput",x:280,y:110}
    ],links:[
      {from:"color",to:"output.baseColor"},
      {from:"metal",to:"output.metalness"},
      {from:"rough",to:"output.roughness"}
    ]};
    this.materialGraphs.set(graph.id,graph);return graph
  }
  applyGraph(graphId){
    const g=this.materialGraphs.get(graphId);if(!g)throw new Error("Material graph not found");
    const color=g.nodes.find(n=>n.id==="color")?.value||[.22,.62,.9,1],metal=g.nodes.find(n=>n.id==="metal")?.value??.05,rough=g.nodes.find(n=>n.id==="rough")?.value??.5;
    return window.Forge.applyMaterial({color:color.slice(0,3),metalness:metal,roughness:rough,opacity:color[3]??1})
  }
  serialize(){return{profile:this.profile,profiles:this.profiles,materialGraphs:[...this.materialGraphs.values()]}}
  load(d){if(!d)return;this.profile=d.profile||this.profile;this.materialGraphs=new Map((d.materialGraphs||[]).map(g=>[g.id,g]));this.apply(this.profile)}
}
window.ForgeRender=new ForgeRenderSystem();window.ForgeRender.apply("high");

class ForgeCinematicSystem{
  constructor(){this.sequence={version:1,name:"Main Sequence",duration:10,tracks:[]};this.playing=false;this.time=0}
  addTrack(entityId,type="transform"){
    const t={id:crypto.randomUUID(),entityId,type,keys:[]};this.sequence.tracks.push(t);return t
  }
  key(trackId,time,value){const t=this.sequence.tracks.find(x=>x.id===trackId);if(!t)throw new Error("Track not found");t.keys.push({time,value});t.keys.sort((a,b)=>a.time-b.time);return t}
  evaluate(time){
    for(const t of this.sequence.tracks){const r=Forge.entities.get(t.entityId);if(!r||t.type!=="transform"||!t.keys.length)continue;let a=t.keys[0],b=t.keys.at(-1);for(let i=0;i<t.keys.length-1;i++)if(time>=t.keys[i].time&&time<=t.keys[i+1].time){a=t.keys[i];b=t.keys[i+1];break}const f=a===b?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));const v=a.value.map((x,i)=>x+(b.value[i]-x)*f);r.entity.setLocalPosition(v[0],v[1],v[2])}
  }
  play(){this.playing=true}
  stop(){this.playing=false}
  update(dt){if(!this.playing)return;this.time=Math.min(this.sequence.duration,this.time+dt);this.evaluate(this.time);if(this.time>=this.sequence.duration)this.stop()}
  serialize(){return this.sequence}
  load(d){if(d)this.sequence=d}
}
window.ForgeCinematics=new ForgeCinematicSystem();
Forge.onPrePhysics(dt=>window.ForgeCinematics.update(dt));
