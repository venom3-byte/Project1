
import {pc} from "./forge-engine.js";

class ForgeVFXSystem{
  constructor(){this.effects=new Map();this.instances=new Set()}
  register(name,config){this.effects.set(name,structuredClone(config));return this.effects.get(name)}
  spawn(name,position={x:0,y:0,z:0},options={}){
    const cfg=this.effects.get(name)||this.effects.get("burst");if(!cfg)throw new Error("VFX preset not found: "+name);
    const e=new pc.Entity("VFX_"+name+"_"+crypto.randomUUID().slice(0,6));Forge.root.addChild(e);e.setLocalPosition(position.x,position.y,position.z);
    try{
      e.addComponent("particlesystem",Object.assign({numParticles:cfg.numParticles||80,lifetime:cfg.lifetime||1,rate:cfg.rate||.02,rate2:cfg.rate2||.05,loop:false,autoPlay:false,emitterExtents:new pc.Vec3(cfg.extents?.x||.6,cfg.extents?.y||.6,cfg.extents?.z||.6)},cfg.props||{}));
      e.particlesystem.reset();e.particlesystem.play();
    }catch(error){
      const r=Forge.primitive("sphere","VFXFallback");r.entity.setLocalPosition(position.x,position.y,position.z);r.entity.setLocalScale(.25,.25,.25);this.instances.add(r.id);setTimeout(()=>{const q=Forge.entities.get(r.id);if(q){q.entity.destroy();Forge.entities.delete(r.id)}this.instances.delete(r.id)},cfg.lifetime*1000);
      return r
    }
    const id="vfx-"+crypto.randomUUID();this.instances.add(id);setTimeout(()=>{try{e.destroy()}catch{}this.instances.delete(id)},(cfg.duration||cfg.lifetime||1)*1000);return e
  }
  explosion(position,scale=1){return this.spawn("explosion",position,{scale})}
  muzzle(position){return this.spawn("muzzle",position)}
  dust(position){return this.spawn("dust",position)}
  rain(position={x:0,y:5,z:0}){return this.spawn("rain",position)}
  status(){return{presets:[...this.effects.keys()],active:this.instances.size}}
  serialize(){return{presets:[...this.effects.entries()]}}
  load(d){if(d?.presets)this.effects=new Map(d.presets)}
}
const vfx=new ForgeVFXSystem();
vfx.register("burst",{numParticles:64,lifetime:.55,rate:.01,rate2:.03,extents:{x:.25,y:.25,z:.25},duration:.65});
vfx.register("explosion",{numParticles:140,lifetime:.8,rate:.01,rate2:.02,extents:{x:.5,y:.5,z:.5},duration:1});
vfx.register("muzzle",{numParticles:35,lifetime:.18,rate:.005,rate2:.01,extents:{x:.08,y:.08,z:.08},duration:.25});
vfx.register("dust",{numParticles:50,lifetime:1.1,rate:.02,rate2:.04,extents:{x:.35,y:.05,z:.35},duration:1.2});
vfx.register("rain",{numParticles:300,lifetime:3,rate:.01,rate2:.03,extents:{x:12,y:1,z:12},duration:4,props:{localSpace:false}});
window.ForgeVFX=vfx;
