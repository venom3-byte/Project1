import http from "node:http";
import WebSocket from "ws";

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function jsonFetch(url){
  const res=await fetch(url);
  if(!res.ok) throw new Error(`CDP discovery failed: HTTP ${res.status}`);
  return res.json();
}

export class VisionController{
  constructor({port=9222,host="127.0.0.1",broadcast=()=>{}}={}){
    this.host=host;
    this.port=Number(port);
    this.broadcast=broadcast;
    this.socket=null;
    this.target=null;
    this.pending=new Map();
    this.seq=0;
    this.connected=false;
    this.streaming=false;
    this.frames=0;
    this.startedAt=0;
    this.lastFrameAt=0;
    this.viewport={width:1280,height:720,dpr:1};
  }

  endpoint(){
    return `http://${this.host}:${this.port}`;
  }

  async listTargets(){
    const list=await jsonFetch(this.endpoint()+"/json/list");
    return Array.isArray(list)?list:[];
  }

  async connect({targetId=null,targetUrl=null}={}){
    if(this.connected)return this.status();
    const targets=await this.listTargets();
    const target=targets.find(t=>t.type==="page"&&(
      (targetId&&t.id===targetId) ||
      (targetUrl&&t.url===targetUrl) ||
      (!targetId&&!targetUrl&&/^https?:/i.test(t.url||""))
    ));
    if(!target?.webSocketDebuggerUrl)throw new Error("No Chromium page target found. Start Chromium with remote debugging and open Forge.");
    this.target=target;
    this.socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      const ws=this.socket;
      const timer=setTimeout(()=>reject(new Error("CDP websocket timeout")),8000);
      ws.once("open",()=>{clearTimeout(timer);resolve()});
      ws.once("error",e=>{clearTimeout(timer);reject(e)});
    });
    this.socket.on("message",data=>this.#onMessage(data));
    this.socket.on("close",()=>this.#reset("closed"));
    this.socket.on("error",()=>{});
    this.connected=true;
    await this.command("Page.enable");
    await this.command("Runtime.enable");
    const vp=await this.command("Runtime.evaluate",{expression:"({width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1,url:location.href,title:document.title})",returnByValue:true});
    this.viewport=vp?.result?.result?.value||this.viewport;
    this.broadcast({type:"vision-state",state:this.status()});
    return this.status();
  }

  async startStream({quality=55,maxWidth=1280,maxHeight=720,everyNthFrame=1}={}){
    if(!this.connected)await this.connect({});
    if(this.streaming)return this.status();
    this.frames=0;
    this.startedAt=Date.now();
    await this.command("Page.startScreencast",{format:"jpeg",quality:Number(quality)||55,maxWidth:Number(maxWidth)||1280,maxHeight:Number(maxHeight)||720,everyNthFrame:Number(everyNthFrame)||1});
    this.streaming=true;
    this.broadcast({type:"vision-state",state:this.status()});
    return this.status();
  }

  async stopStream(){
    if(this.connected&&this.streaming){
      try{await this.command("Page.stopScreencast")}catch{}
    }
    this.streaming=false;
    this.broadcast({type:"vision-state",state:this.status()});
    return this.status();
  }

  async disconnect(){
    try{await this.stopStream()}catch{}
    try{this.socket?.close()}catch{}
    this.#reset("manual");
    return this.status();
  }

  status(){
    const elapsed=this.startedAt?Math.max(1,Date.now()-this.startedAt):0;
    return {
      connected:this.connected,
      streaming:this.streaming,
      targetId:this.target?.id||null,
      targetUrl:this.target?.url||null,
      viewport:this.viewport,
      frames:this.frames,
      fps:elapsed?Number((this.frames*1000/elapsed).toFixed(1)):0,
      lastFrameAt:this.lastFrameAt||0,
      transport:"chromium-cdp-screencast",
      control:"chromium-cdp-input"
    };
  }

  async control(action={}){
    if(!this.connected)await this.connect({});
    const a=action||{};
    const vp=this.viewport||{width:1280,height:720};
    const point=(x,y,w=a.screenWidth,h=a.screenHeight)=>{
      const sx=Number(w)||vp.width,sy=Number(h)||vp.height;
      return {
        x:Math.max(0,Math.min(vp.width-1,(Number(x)||0)*vp.width/Math.max(1,sx))),
        y:Math.max(0,Math.min(vp.height-1,(Number(y)||0)*vp.height/Math.max(1,sy)))
      };
    };
    switch(String(a.type||"")){
      case "move":{
        const p=point(a.x,a.y,a.screenWidth,a.screenHeight);
        await this.command("Input.dispatchMouseEvent",{type:"mouseMoved",x:p.x,y:p.y,button:"none",buttons:Number(a.buttons)||0});
        return {ok:true,type:a.type,point:p};
      }
      case "mouseDown":
      case "mouseUp":{
        const p=point(a.x,a.y,a.screenWidth,a.screenHeight);
        await this.command("Input.dispatchMouseEvent",{type:a.type==="mouseDown"?"mousePressed":"mouseReleased",x:p.x,y:p.y,button:a.button||"left",buttons:a.type==="mouseDown"?1:0,clickCount:Number(a.clickCount)||1});
        return {ok:true,type:a.type,point:p};
      }
      case "click":
      case "doubleClick":{
        const p=point(a.x,a.y,a.screenWidth,a.screenHeight);
        const count=a.type==="doubleClick"?2:1;
        await this.command("Input.dispatchMouseEvent",{type:"mouseMoved",x:p.x,y:p.y,button:"none"});
        for(let i=0;i<count;i++){
          await this.command("Input.dispatchMouseEvent",{type:"mousePressed",x:p.x,y:p.y,button:a.button||"left",buttons:1,clickCount:i+1});
          await this.command("Input.dispatchMouseEvent",{type:"mouseReleased",x:p.x,y:p.y,button:a.button||"left",buttons:0,clickCount:i+1});
          if(i+1<count)await sleep(55);
        }
        return {ok:true,type:a.type,point:p,count};
      }
      case "drag":{
        const from=point(a.x,a.y,a.screenWidth,a.screenHeight);
        const to=point(a.toX,a.toY,a.screenWidth,a.screenHeight);
        const steps=Math.max(2,Math.min(60,Number(a.steps)||12));
        await this.command("Input.dispatchMouseEvent",{type:"mouseMoved",x:from.x,y:from.y,button:"none"});
        await this.command("Input.dispatchMouseEvent",{type:"mousePressed",x:from.x,y:from.y,button:a.button||"left",buttons:1,clickCount:1});
        for(let i=1;i<=steps;i++){
          const t=i/steps,x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t;
          await this.command("Input.dispatchMouseEvent",{type:"mouseMoved",x,y,button:a.button||"left",buttons:1});
          await sleep(Math.max(1,Number(a.stepMs)||8));
        }
        await this.command("Input.dispatchMouseEvent",{type:"mouseReleased",x:to.x,y:to.y,button:a.button||"left",buttons:0,clickCount:1});
        return {ok:true,type:a.type,from,to,steps};
      }
      case "wheel":{
        const p=point(a.x??vp.width/2,a.y??vp.height/2,a.screenWidth,a.screenHeight);
        await this.command("Input.dispatchMouseEvent",{type:"mouseWheel",x:p.x,y:p.y,deltaX:Number(a.deltaX)||0,deltaY:Number(a.deltaY)||0});
        return {ok:true,type:a.type,point:p};
      }
      case "keyDown":{
        await this.command("Input.dispatchKeyEvent",{type:"keyDown",key:String(a.key||""),code:a.code||undefined,text:a.text||undefined,unmodifiedText:a.text||undefined,modifiers:Number(a.modifiers)||0});
        return {ok:true,type:a.type,key:a.key};
      }
      case "keyUp":{
        await this.command("Input.dispatchKeyEvent",{type:"keyUp",key:String(a.key||""),code:a.code||undefined,modifiers:Number(a.modifiers)||0});
        return {ok:true,type:a.type,key:a.key};
      }
      case "press":{
        await this.control({type:"keyDown",key:a.key,code:a.code,text:a.text,modifiers:a.modifiers});
        await this.control({type:"keyUp",key:a.key,code:a.code,modifiers:a.modifiers});
        return {ok:true,type:a.type,key:a.key};
      }
      case "typeText":{
        await this.command("Input.insertText",{text:String(a.text??"")});
        return {ok:true,type:a.type,chars:String(a.text??"").length};
      }
      case "touchStart":
      case "touchMove":
      case "touchEnd":{
        const p=point(a.x,a.y,a.screenWidth,a.screenHeight);
        const eventType=a.type==="touchStart"?"touchStart":a.type==="touchMove"?"touchMove":"touchEnd";
        const touchPoints=eventType==="touchEnd"?[]:[{x:p.x,y:p.y,force:1,id:Number(a.id)||1,radiusX:1,radiusY:1}];
        await this.command("Input.dispatchTouchEvent",{type:eventType,touchPoints,modifiers:Number(a.modifiers)||0});
        return {ok:true,type:a.type,point:p};
      }
      case "evaluate":{
        const expression=String(a.expression||"");
        if(!expression)throw new Error("Missing expression");
        const result=await this.command("Runtime.evaluate",{expression,awaitPromise:!!a.awaitPromise,returnByValue:true});
        return {ok:true,type:a.type,value:result?.result?.result?.value};
      }
      default:throw new Error("Unsupported vision control action: "+a.type);
    }
  }

  command(method,params={}){
    if(!this.socket||this.socket.readyState!==WebSocket.OPEN)throw new Error("CDP is not connected");
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error("CDP command timeout: "+method))},15000);
      this.pending.set(id,{resolve,reject,timer});
      this.socket.send(JSON.stringify({id,method,params}));
    });
  }

  #onMessage(data){
    let m;
    try{m=JSON.parse(Buffer.isBuffer(data)?data.toString("utf8"):String(data))}catch{return}
    if(m.id&&this.pending.has(m.id)){
      const p=this.pending.get(m.id);this.pending.delete(m.id);clearTimeout(p.timer);
      if(m.error)p.reject(new Error(m.error.message||"CDP command failed"));else p.resolve(m.result||{});
      return;
    }
    if(m.method==="Page.screencastFrame"){
      const payload=m.params||{};
      this.frames++;
      this.lastFrameAt=Date.now();
      this.command("Page.screencastFrameAck",{sessionId:payload.sessionId}).catch(()=>{});
      this.broadcast({
        type:"vision-frame",
        seq:this.frames,
        at:this.lastFrameAt,
        width:payload.metadata?.deviceWidth||this.viewport.width,
        height:payload.metadata?.deviceHeight||this.viewport.height,
        data:payload.data||""
      });
      return;
    }
  }

  #reset(reason){
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error("CDP disconnected: "+reason))}
    this.pending.clear();
    this.socket=null;this.target=null;this.connected=false;this.streaming=false;
    this.broadcast({type:"vision-state",state:this.status(),reason});
  }
}
