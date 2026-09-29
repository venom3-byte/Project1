
class ForgePlayerState{
  constructor(id,name="Player"){this.id=id;this.name=name;this.tags=new ForgeTags();this.score=0;this.team=null;this.connected=true;this.custom={}}
  serialize(){return{id:this.id,name:this.name,tags:this.tags.all(),score:this.score,team:this.team,connected:this.connected,custom:this.custom}}
  load(d){Object.assign(this,d||{});this.tags=new ForgeTags().add(...(d?.tags||[]))}
}
class ForgeGameState{
  constructor(){this.phase="boot";this.time=0;this.matchTime=0;this.paused=false;this.values={}}
  set(key,value){this.values[key]=value}
  get(key){return this.values[key]}
  serialize(){return{phase:this.phase,time:this.time,matchTime:this.matchTime,paused:this.paused,values:this.values}}
  load(d){Object.assign(this,d||{})}
}
class ForgeGameMode{
  constructor(){this.rules={};this.started=false}
  configure(rules={}){this.rules=structuredClone(rules);return this}
  start(session){this.started=true;session.state.phase="playing";this.onStart?.(session)}
  tick(session,dt){if(!this.started||session.state.paused)return;session.state.time+=dt;session.state.matchTime+=dt;this.onTick?.(session,dt)}
  finish(session,result={}){session.state.phase="finished";session.result=result;this.onFinish?.(session,result)}
  serialize(){return{rules:this.rules,started:this.started}}
}
class ForgeGameSession{
  constructor(){this.mode=new ForgeGameMode();this.state=new ForgeGameState();this.players=new Map();this.result=null;this.localPlayerId="local"}
  addPlayer(id,name){if(!this.players.has(id))this.players.set(id,new ForgePlayerState(id,name));return this.players.get(id)}
  removePlayer(id){const p=this.players.get(id);if(p)p.connected=false}
  start(){this.mode.start(this)}
  pause(){this.state.paused=true}
  resume(){this.state.paused=false}
  end(result={}){this.mode.finish(this,result)}
  tick(dt){this.mode.tick(this,dt)}
  serialize(){return{mode:this.mode.serialize(),state:this.state.serialize(),players:[...this.players].map(([id,p])=>[id,p.serialize()]),result:this.result,localPlayerId:this.localPlayerId}}
  load(d){this.state.load(d?.state);this.result=d?.result||null;this.localPlayerId=d?.localPlayerId||"local";this.players=new Map((d?.players||[]).map(([id,v])=>{const p=new ForgePlayerState(id,v?.name||id);p.load(v);return[id,p]}));this.mode.configure(d?.mode?.rules||{});this.mode.started=!!d?.mode?.started}
}
window.ForgeSession=new ForgeGameSession();
Forge.onPrePhysics(dt=>window.ForgeSession.tick(dt));
