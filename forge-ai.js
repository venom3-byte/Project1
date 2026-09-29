
class BTNode{
  constructor(type="Node"){this.type=type;this.status="idle";this.children=[]}
  tick(bb,dt){this.status="success";return this.status}
}
class BTSequence extends BTNode{
  constructor(children=[]){super("Sequence");this.children=children;this.index=0}
  tick(bb,dt){while(this.index<this.children.length){const s=this.children[this.index].tick(bb,dt);if(s==="running")return this.status="running";if(s==="failure"){this.index=0;return this.status="failure"}this.index++}this.index=0;return this.status="success"}
}
class BTSelector extends BTNode{
  constructor(children=[]){super("Selector");this.children=children;this.index=0}
  tick(bb,dt){while(this.index<this.children.length){const s=this.children[this.index].tick(bb,dt);if(s==="running")return this.status="running";if(s==="success"){this.index=0;return this.status="success"}this.index++}this.index=0;return this.status="failure"}
}
class BTCondition extends BTNode{
  constructor(fn){super("Condition");this.fn=fn}
  tick(bb){this.status=this.fn(bb)?"success":"failure";return this.status}
}
class BTAction extends BTNode{
  constructor(fn){super("Action");this.fn=fn}
  tick(bb,dt){const r=this.fn(bb,dt);this.status=r===false?"failure":r==="running"?"running":"success";return this.status}
}
class BTWait extends BTNode{
  constructor(seconds){super("Wait");this.seconds=seconds;this.left=seconds}
  tick(bb,dt){this.left-=dt;if(this.left>0)return this.status="running";this.left=this.seconds;return this.status="success"}
}

class ForgeBehaviorTreeSystem{
  constructor(){this.trees=new Map();this.debugTraces=new Map()}
  register(id,root){this.trees.set(id,{root,blackboard:{},last:"idle",trace:[]});return id}
  set(id,key,value){const t=this.trees.get(id);if(t)t.blackboard[key]=value}
  tick(id,dt){const t=this.trees.get(id);if(!t)return "failure";t.trace=[];const status=t.root.tick(new Proxy(t.blackboard,{get:(obj,k)=>obj[k],set:(obj,k,v)=>(obj[k]=v,true)}),dt);t.last=status;t.trace.push(status);this.debugTraces.set(id,t.trace);return status}
  trace(id){return this.debugTraces.get(id)||[]}
  remove(id){this.trees.delete(id);this.debugTraces.delete(id)}
}
window.ForgeAI={BTNode,BTSequence,BTSelector,BTCondition,BTAction,BTWait,trees:new ForgeBehaviorTreeSystem()};
