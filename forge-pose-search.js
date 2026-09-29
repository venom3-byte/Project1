class ForgePoseSearchCore {
  constructor(){this.databases=new Map();this.version=1}
  createDatabase(id="Locomotion",entries=[],options={}){
    const db={id,name:id,features:options.features||[],entries:[],weights:options.weights||{}};
    this.databases.set(id,db);
    this.addEntries(id,entries);
    return this.summary(id);
  }
  addEntries(id,entries=[]){
    const db=this.databases.get(id);if(!db)throw new Error("Pose database not found: "+id);
    for(const e of entries){
      if(!e||!Array.isArray(e.features))continue;
      const f=e.features.map(Number);
      if(!f.length||f.some(x=>!Number.isFinite(x)))continue;
      db.entries.push({clip:String(e.clip||"Idle"),time:Number(e.time||0),features:f,metadata:e.metadata||{}});
    }
    return this.summary(id);
  }
  normalizeVector(v){
    const a=(v||[]).map(Number);const n=Math.hypot(...a)||1;return a.map(x=>x/n);
  }
  distance(a,b,weights={}){
    const n=Math.max(a.length,b.length);let d=0;
    for(let i=0;i<n;i++){
      const w=Number(weights[i]??1),x=Number(a[i]||0),y=Number(b[i]||0),q=x-y;d+=w*q*q;
    }
    return Math.sqrt(d);
  }
  query(id,vector,options={}){
    const db=this.databases.get(id);if(!db)throw new Error("Pose database not found: "+id);
    const q=this.normalizeVector(vector),limit=Math.max(1,Math.min(50,Number(options.k||5)));
    const results=db.entries.map((e,index)=>({index,clip:e.clip,time:e.time,distance:this.distance(q,this.normalizeVector(e.features),db.weights),metadata:e.metadata})).sort((a,b)=>a.distance-b.distance);
    return {database:id,query:q,k:limit,results:results.slice(0,limit)};
  }
  match(id,actorId,vector,options={}){
    const r=this.query(id,vector,{k:1}).results[0];
    if(!r)return null;
    if(options.play!==false&&window.Forge?.setAnimationState&&actorId)window.Forge.setAnimationState(actorId,r.clip);
    return {match:r,actorId:actorId||null,played:!!(options.play!==false&&actorId)};
  }
  buildFromTrajectory(id,poses=[],options={}){
    const entries=poses.map((p)=>({clip:p.clip,time:p.time,features:[...(p.position||[]),...(p.velocity||[]),...(p.facing||[]),...(p.future||[])]}));
    return this.createDatabase(id,entries,options);
  }
  summary(id){
    const db=this.databases.get(id);if(!db)return null;
    return {id:db.id,name:db.name,features:db.features,entries:db.entries.length,weights:db.weights};
  }
  status(){return {version:this.version,databases:[...this.databases.values()].map(x=>this.summary(x.id))}}
  serialize(){return [...this.databases.values()]}
  load(data=[]){this.databases=new Map((data||[]).map(x=>[x.id,x]));return this.status()}
}
const ForgePoseSearch=new ForgePoseSearchCore();
window.ForgePoseSearch=ForgePoseSearch;
export{ForgePoseSearch};
