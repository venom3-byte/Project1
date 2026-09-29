
import {pc} from "./forge-engine.js";

class Forge2DSystem{
  constructor(){this.sprites=new Map();this.animations=new Map();this.platformer=null}
  createCamera(name="2D Camera",{width=20,height=12}={}){
    const r=Forge.add("camera",name);r.entity.addComponent("camera",{projection:pc.PROJECTION_ORTHOGRAPHIC,orthoHeight:height,clearColor:new pc.Color(.04,.07,.12)});r.entity.setLocalPosition(0,0,10);r.entity.setLocalEulerAngles(0,0,0);r.components.camera={active:true,mode:"2d",width,height};this.orthoCamera=r.entity;return r
  }
  async spriteFromFile(file,name="Sprite"){
    const r=Forge.primitive("plane",name);r.entity.setEulerAngles(90,0,0);
    const bmp=await createImageBitmap(file),c=document.createElement("canvas");c.width=bmp.width;c.height=bmp.height;c.getContext("2d").drawImage(bmp,0,0);const tex=new pc.Texture(Forge.app.graphicsDevice,{width:bmp.width,height:bmp.height,format:pc.PIXELFORMAT_R8_G8_B8_A8});tex.setSource(c);const m=Forge.material([1,1,1]);m.diffuseMap=tex;m.emissiveMap=tex;m.emissive=new pc.Color(1,1,1);m.update();r.entity.render.material=m;r.components.sprite={width:bmp.width,height:bmp.height,pixelsPerUnit:100};return r
  }
  async animateSprite(name,files,fps=12){
    const frames=[];for(const f of files){frames.push(await this.spriteFromFile(f,name+"_"+frames.length))}
    const state={name,frames,fps,index:0,time:0};this.animations.set(name,state);return state
  }
  createPlatformerTemplate(){
    for(const r of [...Forge.entities.values()]){Forge.removePhysics(r.id);r.entity.destroy();Forge.entities.delete(r.id)}
    const cam=this.createCamera("2D Camera",{width:18,height:10});
    const ground=Forge.primitive("box","Ground2D");ground.entity.setLocalPosition(0,-.5,0);ground.entity.setLocalScale(14,.5,1);Forge.setPhysics(ground.id,"fixed","box");
    const p=Forge.primitive("box","2D Player");p.entity.setLocalPosition(-5,1,0);p.entity.setLocalScale(.8,1.2,.6);Forge.setPhysics(p.id,"dynamic","box");
    const platforms=[];for(const [x,y,sx] of [[-2,2,3],[3,3,2],[7,1.7,2],[0,4,2]]){const q=Forge.primitive("box","Platform");q.entity.setLocalPosition(x,y,0);q.entity.setLocalScale(sx,.35,1);Forge.setPhysics(q.id,"fixed","box");platforms.push(q.id)}
    this.platformer={player:p.id,camera:cam.id,platforms,ground:ground.id,jumpLock:false};Forge.select(p.id);Forge.frame();return this.platformer
  }
  updatePlatformer(dt){
    if(!this.platformer)return;const r=Forge.entities.get(this.platformer.player);const phys=Forge.physics.get(r?.id);if(!r||!phys)return;const input=window.ForgeRuntime?.input,body=phys.body;const mv=input?.moveVector?.()||{x:0,z:0};const v=body.linvel();body.setLinvel({x:mv.x*7,y:v.y,z:0},true);const grounded=Math.abs(v.y)<.15&&r.entity.getPosition().y<1.35;if(grounded&&input?.isDown("jump")&&!this.platformer.jumpLock){body.setLinvel({x:v.x,y:7.5,z:0},true);this.platformer.jumpLock=true}if(!input?.isDown("jump"))this.platformer.jumpLock=false;const cam=Forge.entities.get(this.platformer.camera)?.entity;if(cam){const p=r.entity.getPosition(),cp=cam.getLocalPosition();cam.setLocalPosition(cp.x+(p.x-cp.x)*.12,cp.y+(p.y-cp.y)*.12,10)}}
  status(){return{platformer:this.platformer,sprites:this.sprites.size,animations:[...this.animations.keys()]}}
}
window.Forge2D=new Forge2DSystem();
Forge.onPrePhysics(dt=>window.Forge2D.updatePlatformer(dt));
