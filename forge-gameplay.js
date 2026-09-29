
const ForgeGameplay = {
  characters:new Map(),
  vehicles:new Map(),
  agents:new Map(),
  projectiles:[],
  running:false,
  unsubscribePre:null,
  unsubscribePost:null,

  init(){
    if(this.running) return this;
    this.running=true;
    this.unsubscribePre=Forge.onPrePhysics(dt=>this.prePhysics(dt));
    this.unsubscribePost=Forge.onPostPhysics(dt=>this.postPhysics(dt));
    window.ForgeGameplay=this;
    return this;
  },

  clear(){
    for(const [id] of this.characters){const r=Forge.entities.get(id);if(r){Forge.removePhysics(id);r.entity.destroy();Forge.entities.delete(id)}}
    for(const [id] of this.vehicles){const r=Forge.entities.get(id);if(r){Forge.removePhysics(id);r.entity.destroy();Forge.entities.delete(id)}}
    for(const p of this.projectiles){const r=Forge.entities.get(p.id);if(r){Forge.removePhysics(p.id);r.entity.destroy();Forge.entities.delete(p.id)}}
    this.characters.clear();this.vehicles.clear();this.agents.clear();this.projectiles=[];
  },

  createCharacter(name="Player", position={x:0,y:1.2,z:0}){
    const r=Forge.primitive("capsule",name);
    r.entity.setLocalPosition(position.x,position.y,position.z);
    r.entity.setLocalScale(.55,1,.55);
    Forge.setPhysics(r.id,"kinematic","capsule");
    const p=Forge.physics.get(r.id);
    const controller=Forge.rapier ? new Forge.rapier.KinematicCharacterController(
      .02, Forge.world.integrationParameters, Forge.world.broadPhase, Forge.world.narrowPhase,
      Forge.world.bodies, Forge.world.colliders
    ) : null;
    if(controller){
      controller.enableAutostep(.45,.2,true);
      controller.enableSnapToGround(.2);
      controller.setApplyImpulsesToDynamicBodies(true);
      controller.setCharacterMass(80);
    }
    const record={
      id:r.id,entity:r.entity,body:p?.body,collider:p?.collider,controller,
      speed:5.5,sprintSpeed:8.5,jumpSpeed:6.2,gravity:-18,verticalVelocity:0,grounded:false,
      cameraDistance:6,cameraHeight:2.8,damage:20,hp:100,target:null
    };
    this.characters.set(r.id,record);
    Forge.select(r.id);
    return record;
  },

  createEnemy(name="Enemy",position={x:6,y:1,z:4}){
    const r=Forge.primitive("box",name);
    r.entity.setLocalPosition(position.x,position.y,position.z);
    r.entity.setLocalScale(.8,1.1,.8);
    Forge.setPhysics(r.id,"kinematic","box");
    const p=Forge.physics.get(r.id);
    const controller=Forge.rapier ? new Forge.rapier.KinematicCharacterController(
      .02,Forge.world.integrationParameters,Forge.world.broadPhase,Forge.world.narrowPhase,
      Forge.world.bodies,Forge.world.colliders
    ):null;
    if(controller) controller.enableSnapToGround(.2);
    const state={id:r.id,entity:r.entity,body:p?.body,collider:p?.collider,controller,state:"idle",speed:2.3,attackRange:1.6,detectionRange:14,damageCooldown:0,hp:60};
    this.agents.set(r.id,state);
    return state;
  },

  createVehicle(name="Vehicle",position={x:0,y:1,z:-4}){
    const r=Forge.primitive("box",name);
    r.entity.setLocalPosition(position.x,position.y,position.z);
    r.entity.setLocalScale(1.1,.45,2.1);
    Forge.setPhysics(r.id,"dynamic","box");
    const phys=Forge.physics.get(r.id);
    if(!phys||!Forge.rapier) throw new Error("Physics backend unavailable");
    const v=new Forge.rapier.DynamicRayCastVehicleController(
      phys.body,Forge.world.broadPhase,Forge.world.narrowPhase,Forge.world.bodies,Forge.world.colliders
    );
    v.setIndexUpAxis(1);
    v.setIndexForwardAxis(2);
    const wheelRadius=.34,track=.92,wheelBase=1.3;
    const wheelPositions=[
      {x:-track,z:wheelBase},{x:track,z:wheelBase},
      {x:-track,z:-wheelBase},{x:track,z:-wheelBase}
    ];
    for(const w of wheelPositions){
      v.addWheel({x:w.x,y:-.18,z:w.z},{x:0,y:-1,z:0},{x:1,y:0,z:0},.35,wheelRadius);
    }
    for(let i=0;i<4;i++){
      v.setWheelSuspensionStiffness(i,28);
      v.setWheelSuspensionCompression(i,4.0);
      v.setWheelSuspensionRelaxation(i,6.0);
      v.setWheelMaxSuspensionTravel(i,.25);
      v.setWheelFrictionSlip(i,4.0);
      v.setWheelSideFrictionStiffness(i,1.2);
    }
    const record={id:r.id,entity:r.entity,body:phys.body,vehicle:v,maxEngineForce:1250,maxBrakeForce:90,maxSteer:.45,drive:[0,1],steer:[0,1]};
    this.vehicles.set(r.id,record);Forge.select(r.id);return record;
  },

  spawnProjectile(origin,velocity,damage=25){
    const r=Forge.primitive("sphere","Projectile_"+(this.projectiles.length+1));
    r.entity.setLocalPosition(origin.x,origin.y,origin.z);r.entity.setLocalScale(.12,.12,.12);
    Forge.setPhysics(r.id,"dynamic","ball");const p=Forge.physics.get(r.id);p.body.setLinvel(velocity,true);
    const q={id:r.id,entity:r.entity,body:p.body,damage,life:4};this.projectiles.push(q);return q;
  },

  updateCharacter(c,dt){
    if(!c.body||!c.collider||!c.controller) return;
    const inp=window.ForgeRuntime?.input;
    const cam=Forge.camera();
    let ix=(inp?.isDown("moveRight")?1:0)-(inp?.isDown("moveLeft")?1:0);
    let iz=(inp?.isDown("moveForward")?1:0)-(inp?.isDown("moveBack")?1:0);
    let fwd={x:0,z:-1},right={x:1,z:0};
    if(cam){
      const cf=cam.forward,cr=cam.right;
      fwd={x:cf.x,z:cf.z};right={x:cr.x,z:cr.z};
      const fl=Math.hypot(fwd.x,fwd.z)||1,rl=Math.hypot(right.x,right.z)||1;
      fwd.x/=fl;fwd.z/=fl;right.x/=rl;right.z/=rl;
    }
    let dx=fwd.x*iz+right.x*ix,dz=fwd.z*iz+right.z*ix;
    const len=Math.hypot(dx,dz);if(len>1){dx/=len;dz/=len}
    const sprint=inp?.isDown("sprint");const speed=sprint?c.sprintSpeed:c.speed;
    if(c.grounded&&inp?.isDown("jump"))c.verticalVelocity=c.jumpSpeed;
    c.verticalVelocity=Math.max(-30,c.verticalVelocity+c.gravity*dt);
    const desired={x:dx*speed*dt,y:c.verticalVelocity*dt,z:dz*speed*dt};
    c.controller.computeColliderMovement(c.collider,desired);
    const move=c.controller.computedMovement();
    const t=c.body.translation();c.body.setNextKinematicTranslation({x:t.x+move.x,y:t.y+move.y,z:t.z+move.z});
    c.grounded=c.controller.computedGrounded();
    if(len>.08){
      const yaw=Math.atan2(dx,dz)*180/Math.PI;
      c.entity.setEulerAngles(0,yaw,0);
    }
  },

  updateEnemy(a,dt){
    const player=[...this.characters.values()][0];if(!player||!a.body||!a.collider||!a.controller)return;
    const p=player.entity.getPosition(),e=a.entity.getPosition(),dx=p.x-e.x,dz=p.z-e.z,dist=Math.hypot(dx,dz);
    if(dist<=a.detectionRange&&dist>a.attackRange){a.state="chase";const l=dist||1;const desired={x:dx/l*a.speed*dt,y:-2.5*dt,z:dz/l*a.speed*dt};a.controller.computeColliderMovement(a.collider,desired);const move=a.controller.computedMovement();const t=a.body.translation();a.body.setNextKinematicTranslation({x:t.x+move.x,y:t.y+move.y,z:t.z+move.z});a.entity.setEulerAngles(0,Math.atan2(dx,dz)*180/Math.PI,0);}
    else if(dist<=a.attackRange){a.state="attack";a.damageCooldown=Math.max(0,a.damageCooldown-dt);if(a.damageCooldown===0){player.hp=Math.max(0,player.hp-a.damage);a.damageCooldown=1.0;}}
    else a.state="idle";
    if(a.hp<=0){Forge.removePhysics(a.id);a.entity.destroy();Forge.entities.delete(a.id);this.agents.delete(a.id)}
  },

  updateVehicle(v,dt){
    const inp=window.ForgeRuntime?.input;
    const throttle=(inp?.isDown("moveForward")?1:0)-(inp?.isDown("moveBack")?1:0);
    const steer=(inp?.isDown("moveRight")?1:0)-(inp?.isDown("moveLeft")?1:0);
    const brake=inp?.isDown("jump")||inp?.isDown("fire");
    const engine=throttle*v.maxEngineForce;
    for(const i of v.drive)v.vehicle.setWheelEngineForce(i,engine);
    for(const i of [2,3])v.vehicle.setWheelEngineForce(i,engine);
    for(const i of v.steer)v.vehicle.setWheelSteering(i,steer*v.maxSteer);
    for(let i=0;i<4;i++)v.vehicle.setWheelBrake(i,brake?v.maxBrakeForce:0);
    v.vehicle.updateVehicle(dt,Forge.rapier.QueryFilterFlags.EXCLUDE_DYNAMIC);
  },

  updateCamera(){
    const player=[...this.characters.values()][0];const cam=Forge.camera();if(!player||!cam)return;
    const p=player.entity.getPosition();const yaw=player.entity.getEulerAngles().y*Math.PI/180;
    const target={x:p.x,y:p.y+1.1,z:p.z};const desired={x:p.x-Math.sin(yaw)*player.cameraDistance,y:p.y+player.cameraHeight,z:p.z-Math.cos(yaw)*player.cameraDistance};
    const cp=cam.getLocalPosition();const k=.12;cam.setLocalPosition(cp.x+(desired.x-cp.x)*k,cp.y+(desired.y-cp.y)*k,cp.z+(desired.z-cp.z)*k);cam.lookAt(target);
  },

  prePhysics(dt){
    if(!this.running)return;
    for(const c of this.characters.values())this.updateCharacter(c,dt);
    for(const a of this.agents.values())this.updateEnemy(a,dt);
    for(const v of this.vehicles.values())this.updateVehicle(v,dt);
  },

  postPhysics(dt){
    if(!this.running)return;
    this.updateCamera();
    for(const p of this.projectiles){p.life-=dt;if(p.life<=0){const r=Forge.entities.get(p.id);if(r){Forge.removePhysics(p.id);r.entity.destroy();Forge.entities.delete(p.id)}}}
    this.projectiles=this.projectiles.filter(x=>x.life>0);
  },

  createThirdPersonTemplate(){
    this.init();this.clear();
    Forge.createPlane("Ground",40,40);const light=Forge.createLight("Sun");const player=this.createCharacter("Player",{x:0,y:1.2,z:0});
    const enemy1=this.createEnemy("Enemy_A",{x:7,y:1,z:6}),enemy2=this.createEnemy("Enemy_B",{x:-7,y:1,z:4}),enemy3=this.createEnemy("Enemy_C",{x:4,y:1,z:-8});
    for(let i=0;i<8;i++){const r=Forge.primitive("box","Cover_"+i);r.entity.setLocalPosition((i%4)*4-6,.75,Math.floor(i/4)*6-3);r.entity.setLocalScale(1.5,1.5,1.5);Forge.setPhysics(r.id,"fixed","box");}
    Forge.frame();Forge.select(player.id);window.ForgeUISystem?.hudForThirdPerson(()=>({hp:player.hp,state:player.grounded?"GROUNDED":"AIRBORNE"}));
    return{type:"third-person",player:player.id,enemies:[enemy1.id,enemy2.id,enemy3.id]};
  },

  createRacingTemplate(){
    this.init();this.clear();
    Forge.createPlane("TrackGround",80,80);Forge.createLight("Sun");const car=this.createVehicle("PlayerCar",{x:0,y:1,z:0});
    for(let i=0;i<10;i++){const edge=Forge.primitive("box","TrackEdge_"+i);edge.entity.setLocalPosition(-6,1,-30+i*7);edge.entity.setLocalScale(.5,1,3);Forge.setPhysics(edge.id,"fixed","box");}
    for(let i=0;i<10;i++){const edge=Forge.primitive("box","TrackEdgeR_"+i);edge.entity.setLocalPosition(6,1,-30+i*7);edge.entity.setLocalScale(.5,1,3);Forge.setPhysics(edge.id,"fixed","box");}
    Forge.frame();Forge.select(car.id);
    return{type:"racing",vehicle:car.id};
  },

  status(){
    return{
      characters:[...this.characters.values()].map(c=>({id:c.id,hp:c.hp,grounded:c.grounded})),
      agents:[...this.agents.values()].map(a=>({id:a.id,state:a.state,hp:a.hp})),
      vehicles:[...this.vehicles.values()].map(v=>({id:v.id,speed:v.vehicle.currentVehicleSpeed(),wheels:v.vehicle.numWheels()})),
      projectiles:this.projectiles.length
    };
  }
};
ForgeGameplay.init();
window.ForgeGameplay=ForgeGameplay;

const oldSnapshot=window.ForgeRuntime?.snapshot;
if(window.ForgeRuntime){
  window.ForgeRuntime.snapshot=()=>Object.assign(oldSnapshot?oldSnapshot():{}, {gameplay:ForgeGameplay.status()});
}
