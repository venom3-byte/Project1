
class ForgeNetworkSystem{
  constructor(){
    this.ws=null;this.connected=false;this.room="default";this.peerId=crypto.randomUUID();this.peers=new Map();this.handlers=new Map();this.inputTimer=0;this.entityId=null;this.authority=false
  }
  on(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);return()=>this.handlers.get(type)?.delete(fn)}
  emit(type,data){for(const fn of this.handlers.get(type)||[]){try{fn(data)}catch(e){console.error("[ForgeNet]",e)}}}
  connect(room="default",options={}){
    if(this.ws?.readyState===1)return;
    this.room=room;this.peerId=options.peerId||this.peerId;const proto=location.protocol==="https:"?"wss:":"ws:";
    const ws=new WebSocket(proto+"//"+location.host+"/net");this.ws=ws;
    ws.onopen=()=>{this.connected=true;ws.send(JSON.stringify({type:"hello",room:this.room,peerId:this.peerId,protocol:1}));this.emit("connected",{room:this.room,peerId:this.peerId});this.startInputReplication()};
    ws.onclose=()=>{this.connected=false;this.stopInputReplication();this.emit("disconnected",{})};
    ws.onerror=e=>this.emit("error",e);
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
      if(m.type==="peer-join"){this.peers.set(m.peerId,{id:m.peerId});this.emit("peer-join",m)}
      else if(m.type==="peer-leave"){this.peers.delete(m.peerId);this.emit("peer-leave",m)}
      else if(m.type==="state"){this.peers.set(m.peerId,{id:m.peerId,state:m.state,updatedAt:performance.now()});this.emit("state",m)}
      else if(m.type==="input"){this.emit("input",m)}
      else this.emit(m.type,m)
    };
  }
  disconnect(){this.ws?.close();this.ws=null;this.connected=false;this.peers.clear()}
  send(type,data={}){if(this.ws?.readyState===1)this.ws.send(JSON.stringify({type,room:this.room,peerId:this.peerId,...data}))}
  startInputReplication(){
    if(this.inputTimer)return;
    this.inputTimer=setInterval(()=>{if(this.connected&&window.ForgeRuntime?.input)this.send("input",{input:window.ForgeRuntime.input.snapshot()})},50)
  }
  stopInputReplication(){if(this.inputTimer){clearInterval(this.inputTimer);this.inputTimer=0}}
  setAuthority(flag){this.authority=!!flag}
  bindEntity(id){this.entityId=id;this.emit("bind",{id});}
  publishEntity(){
    if(!this.entityId)return false;const r=Forge.entities.get(this.entityId);if(!r)return false;const p=r.entity.getLocalPosition(),q=r.entity.getLocalEulerAngles();this.send("state",{entityId:this.entityId,state:{position:[p.x,p.y,p.z],rotation:[q.x,q.y,q.z]}});return true
  }
  applyPeerState(peerId,state){
    const p=this.peers.get(peerId);if(!p?.entityId)return false;const r=Forge.entities.get(p.entityId);if(!r)return false;
    r.entity.setLocalPosition(...state.position);r.entity.setLocalEulerAngles(...state.rotation);return true
  }
  status(){return{connected:this.connected,room:this.room,peerId:this.peerId,peers:[...this.peers.keys()],boundEntity:this.entityId,authority:this.authority}}
}
window.ForgeNet=new ForgeNetworkSystem();
