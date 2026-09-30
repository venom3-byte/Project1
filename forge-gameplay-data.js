
class ForgeTags{
  constructor(){this.tags=new Set()}
  add(...tags){for(const t of tags)if(typeof t==="string"&&t.trim())this.tags.add(t.trim());return this}
  remove(tag){this.tags.delete(tag);return this}
  has(tag){return this.tags.has(tag)}
  matches(prefix){return [...this.tags].some(t=>t===prefix||t.startsWith(prefix+".")||prefix.startsWith(t+"."))}
  all(){return [...this.tags].sort()}
  serialize(){return this.all()}
  load(tags=[]){this.tags=new Set(tags)}
}
class ForgeAttributes{
  constructor(){this.data=new Map()}
  define(name,base,min=0,max=Infinity){this.data.set(name,{base,current:base,min,max})}
  get(name){return this.data.get(name)?.current??0}
  base(name){return this.data.get(name)?.base??0}
  set(name,value){const a=this.data.get(name);if(!a)return; a.current=Math.max(a.min,Math.min(a.max,value))}
  modify(name,delta){this.set(name,this.get(name)+delta)}
  serialize(){return Object.fromEntries(this.data)}
  load(data){this.data=new Map(Object.entries(data||{}))}
}
class ForgeEffect{
  constructor(id,config={}){this.id=id;this.duration=Number(config.duration||0);this.remaining=this.duration;this.modifiers=config.modifiers||{};this.tags=new ForgeTags().add(...(config.tags||[]))}
  apply(target){
    for(const [name,v] of Object.entries(this.modifiers)){if(v?.op==="add")target.attributes.modify(name,Number(v.value)||0);else if(v?.op==="set")target.attributes.set(name,Number(v.value)||0)}
  }
  tick(target,dt){if(this.duration<=0)return false;this.remaining=Math.max(0,this.remaining-dt);return this.remaining>0}
}
class ForgeAbility{
  constructor(id,config={}){this.id=id;this.cooldown=Number(config.cooldown||0);this.remaining=0;this.cost=config.cost||{};this.effects=config.effects||[];this.tags=new ForgeTags().add(...(config.tags||[]));this.onExecute=config.onExecute||null}
  canActivate(actor){if(this.remaining>0)return false;for(const [a,v] of Object.entries(this.cost))if(actor.attributes.get(a)<Number(v))return false;return true}
  activate(actor,ctx={}){
    if(!this.canActivate(actor))return false;
    for(const [a,v] of Object.entries(this.cost))actor.attributes.modify(a,-Number(v));
    for(const e of this.effects)actor.effects.push(new ForgeEffect(e.id||crypto.randomUUID(),e));
    if(this.onExecute)this.onExecute(actor,ctx);
    this.remaining=this.cooldown;return true
  }
  tick(dt){this.remaining=Math.max(0,this.remaining-dt)}
  serialize(){return{id:this.id,cooldown:this.cooldown,remaining:this.remaining,cost:this.cost,effects:this.effects,tags:this.tags.all()}}
}
class ForgeActorData{
  constructor(id){
    this.id=id;this.tags=new ForgeTags();this.attributes=new ForgeAttributes();this.abilities=new Map();this.effects=[];this.inventory=new Map();this.state={};
    this.attributes.define("Health",100,0,100);this.attributes.define("Mana",50,0,50);this.attributes.define("Stamina",100,0,100)
  }
  addAbility(id,config){this.abilities.set(id,new ForgeAbility(id,config));return this.abilities.get(id)}
  grantItem(id,count=1){this.inventory.set(id,(this.inventory.get(id)||0)+count)}
  consumeItem(id,count=1){const n=this.inventory.get(id)||0;if(n<count)return false;this.inventory.set(id,n-count);return true}
  tick(dt){for(const a of this.abilities.values())a.tick(dt);this.effects=this.effects.filter(e=>e.tick(this,dt))}
  serialize(){return{id:this.id,tags:this.tags.serialize(),attributes:this.attributes.serialize(),inventory:Object.fromEntries(this.inventory),state:this.state,abilities:[...this.abilities.values()].map(a=>a.serialize())}}
  load(d){this.tags.load(d?.tags||[]);this.attributes.load(d?.attributes||{});this.inventory=new Map(Object.entries(d?.inventory||{}));this.state=d?.state||{};this.abilities=new Map((d?.abilities||[]).map(x=>{const a=new ForgeAbility(x.id,x);a.remaining=x.remaining||0;return[x.id,a]}))}
}
class ForgeDataRegistry{
  constructor(){this.assets=new Map()}
  register(type,id,data){this.assets.set(type+":"+id,{type,id,data:structuredClone(data)});return this.get(type,id)}
  get(type,id){return this.assets.get(type+":"+id)?.data||null}
  list(type){return [...this.assets.values()].filter(x=>!type||x.type===type)}
  queryTags(tags=[]){return [...this.assets.values()].filter(x=>(tags||[]).every(t=>(x.data.tags||[]).includes(t)))}
  serialize(){return [...this.assets.values()]}
  load(items=[]){this.assets=new Map(items.map(x=>[x.type+":"+x.id,x]))}
}
class ForgeQuestSystem{
  constructor(){this.quests=new Map()}
  define(id,data){this.quests.set(id,{id,title:data.title||id,objectives:(data.objectives||[]).map(o=>({...o,current:0,complete:false})),rewards:data.rewards||{},state:"active"});return this.quests.get(id)}
  progress(id,objectiveId,amount=1){const q=this.quests.get(id);if(!q)return false;const o=q.objectives.find(x=>x.id===objectiveId);if(!o||o.complete)return false;o.current=Math.min(o.target||1,o.current+amount);o.complete=o.current>=(o.target||1);if(q.objectives.every(x=>x.complete))q.state="complete";return true}
  status(id){return id?[this.quests.get(id)].filter(Boolean):[...this.quests.values()]}
  serialize(){return[...this.quests.values()]}
  load(items=[]){this.quests=new Map(items.map(q=>[q.id,q]))}
}
const actorMap=new Map();
function actor(id){if(!actorMap.has(id))actorMap.set(id,new ForgeActorData(id));return actorMap.get(id)}
window.ForgeTags=ForgeTags;
window.ForgeData={
  registry:new ForgeDataRegistry(),
  quests:new ForgeQuestSystem(),
  actors:actorMap,
  actor
};
Forge.onPrePhysics(dt=>{for(const a of actorMap.values())a.tick(dt)});
