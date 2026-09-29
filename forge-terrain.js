import {pc} from "./forge-engine.js";

class ForgeTerrainSystem{
  constructor(){this.terrains=new Map()}
  noise(x,z,seed){let n=Math.sin(x*127.1+z*311.7+seed*74.7)*43758.5453;return n-Math.floor(n)}
  height(x,z,seed,amplitude){
    let h=0,amp=amplitude,freq=.045;
    for(let o=0;o<4;o++){const a=this.noise(x*freq,z*freq,seed+o*17);h+=(a*2-1)*amp;freq*=2.05;amp*=.5}
    return h
  }
  generate(name="Terrain",{size=60,subdivisions=96,seed=1337,height=7,materialColor=[.18,.36,.12]}={}){
    const n=Math.max(4,Math.min(192,subdivisions));const positions=[],uvs=[],indices=[],heights=new Float32Array((n+1)*(n+1));
    for(let z=0;z<=n;z++){for(let x=0;x<=n;x++){const wx=x/n*size-size/2,wz=z/n*size-size/2,hy=this.height(wx,wz,seed,height);positions.push(wx,hy,wz);uvs.push(x/n,z/n);heights[z*(n+1)+x]=hy/Math.max(1,height)}}
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=z*(n+1)+x,b=a+1,c=a+(n+1),d=c+1;indices.push(a,c,b,b,c,d)}
    const normals=pc.calculateNormals(positions,indices),mesh=new pc.Mesh(Forge.app.graphicsDevice);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setUvs(0,uvs);mesh.setIndices(indices);mesh.update();
    const r=Forge.add("terrain",name);const mat=Forge.material(materialColor);r.entity.addComponent("render",{meshInstances:[new pc.MeshInstance(mesh,mat)]});r.components.terrain={size,subdivisions,seed,height};
    if(Forge.world&&Forge.rapier){const body=Forge.world.createRigidBody(Forge.rapier.RigidBodyDesc.fixed());const desc=Forge.rapier.ColliderDesc.heightfield(n+1,n+1,new Float32Array(heights),{x:size,y:height,z:size});desc.setActiveEvents(Forge.rapier.ActiveEvents.COLLISION_EVENTS);const collider=Forge.world.createCollider(desc,body);Forge.physics.set(r.id,{body,collider,mode:"fixed",shape:"heightfield",colliderHandle:collider.handle});Forge.colliderEntityMap.set(collider.handle,r.id);r.components.physics={mode:"fixed",shape:"heightfield"}}
    this.terrains.set(r.id,{id:r.id,name:r.name,mesh,heights,config:r.components.terrain});Forge.select(r.id);return r
  }
  remove(id){const t=this.terrains.get(id);if(t){t.mesh.destroy();this.terrains.delete(id)}Forge.removePhysics(id);const r=Forge.entities.get(id);if(r){r.entity.destroy();Forge.entities.delete(id)}}
  status(){return{terrains:[...this.terrains.values()].map(t=>({id:t.id,name:t.name,config:t.config}))}}
  serialize(){return this.status()}
}
window.ForgeTerrain=new ForgeTerrainSystem();