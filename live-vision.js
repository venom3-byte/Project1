(() => {
  const $=(s,r=document)=>r.querySelector(s);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const state={
    ws:null,running:false,busy:false,frameSeq:0,lastFrameAt:0,frameCount:0,frameWindowStart:0,
    remoteUrl:null,mode:"idle"
  };

  const serverCapable=()=>location.protocol!=="file:"&&!/github\.io$/i.test(location.hostname);
  const wsUrl=()=>((location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+"/vision");

  function style(){
    if($("#liveVisionStyle"))return;
    const link=document.createElement("link");
    link.id="liveVisionStyle";link.rel="stylesheet";link.href="./live-vision.css?v=4";
    document.head.appendChild(link);
  }

  function mount(){
    if($("#liveVision"))return;
    const el=document.createElement("section");
    el.id="liveVision";el.className="live-vision";
    el.innerHTML=[
      '<div class="live-vision-head"><div><strong>FORGE VISION</strong><small>Continuous eyes + real browser hands</small></div><button id="liveVisionClose">×</button></div>',
      '<div class="live-vision-status"><span id="liveVisionDot" class="live-dot"></span><span id="liveVisionState">Idle</span><span id="liveVisionFps">0 fps</span><span id="liveVisionTransport">—</span></div>',
      '<div class="live-vision-preview" id="liveVisionPreview"><video id="liveVisionVideo" autoplay muted playsinline></video><img id="liveVisionRemote" alt="Forge continuous live vision"><div id="liveVisionCrosshair"></div></div>',
      '<div class="live-vision-actions"><button id="liveVisionStart" class="primary">Start live eyes</button><button id="liveVisionPro">Restart session</button><button id="liveVisionStop">Stop</button><button id="liveVisionAgent">Run task</button></div>',
      '<div class="live-vision-actions compact"><button id="liveVisionMove">Move cursor</button><button id="liveVisionDown">Mouse down</button><button id="liveVisionUp">Mouse up</button><button id="liveVisionWheel">Wheel</button></div>',
      '<label class="live-vision-field">Task <textarea id="liveVisionTask" rows="2" placeholder="Example: add box, play, rotate, scan"></textarea></label>',
      '<div class="live-vision-log" id="liveVisionLog"></div>',
      '<div class="live-vision-foot"><strong>Live mode:</strong> Playwright continuous screencast over WebSocket. Actions are real Chromium mouse, keyboard, touch and file-input events, followed by a frame receipt.</div>'
    ].join("");
    document.body.appendChild(el);
    $("#liveVisionClose").onclick=()=>el.classList.remove("open");
    $("#liveVisionStart").onclick=start;
    $("#liveVisionPro").onclick=restart;
    $("#liveVisionStop").onclick=stop;
    $("#liveVisionAgent").onclick=runAgent;
    $("#liveVisionMove").onclick=()=>runManual({type:"mouse.move",x:innerWidth/2,y:innerHeight/2,steps:4});
    $("#liveVisionDown").onclick=()=>runManual({type:"mouse.down",button:"left"});
    $("#liveVisionUp").onclick=()=>runManual({type:"mouse.up",button:"left"});
    $("#liveVisionWheel").onclick=()=>runManual({type:"mouse.wheel",deltaY:360});
  }

  function open(){mount();style();$("#liveVision").classList.add("open");connectWs()}

  function log(t,c=""){
    const b=$("#liveVisionLog");if(!b)return;
    const row=document.createElement("div");row.className="live-log-row "+c;
    row.textContent=new Date().toLocaleTimeString()+"  "+t;b.prepend(row);
    while(b.children.length>24)b.lastElementChild.remove();
  }

  function stateText(t,on=state.running){
    const s=$("#liveVisionState"),d=$("#liveVisionDot");
    if(s)s.textContent=t;if(d)d.classList.toggle("live-on",!!on);
  }

  function setTransport(t){const e=$("#liveVisionTransport");if(e)e.textContent=t||"—"}

  function setRemoteFrame(data){
    const img=$("#liveVisionRemote");if(!img)return;
    const url=URL.createObjectURL(new Blob([data],{type:"image/jpeg"}));
    const old=state.remoteUrl;state.remoteUrl=url;
    img.onload=()=>{if(old)URL.revokeObjectURL(old)};
    img.src=url;
    $("#liveVisionPreview").classList.add("remote");
    $("#liveVisionPreview").classList.remove("local");
  }

  function onFramePacket(data){
    if(!(data instanceof ArrayBuffer))return;
    if(data.byteLength<16)return;
    const dv=new DataView(data),magic=dv.getUint32(0);
    if(magic!==0x46563337)return;
    const seq=dv.getUint32(4),width=dv.getUint16(8),height=dv.getUint16(10);
    const jpeg=data.slice(16);
    state.frameSeq=Math.max(state.frameSeq,seq);state.lastFrameAt=Date.now();state.frameCount++;
    if(!state.frameWindowStart)state.frameWindowStart=Date.now();
    const now=Date.now();
    if(now-state.frameWindowStart>=1000){
      const fps=state.frameCount*1000/(now-state.frameWindowStart);
      $("#liveVisionFps").textContent=fps.toFixed(1)+" fps";
      state.frameCount=0;state.frameWindowStart=now;
    }
    setRemoteFrame(jpeg);
    $("#liveVisionRemote").setAttribute("data-size",width+"x"+height);
  }

  function onMessage(event){
    if(typeof event.data!=="string"){onFramePacket(event.data);return}
    let msg;try{msg=JSON.parse(event.data)}catch{return}
    if(msg.type==="vision-status"||msg.type==="vision-state"){
      const s=msg.state||msg;
      const running=!!s.running;
      state.running=running;state.mode=running?"server":"idle";
      state.frameSeq=Math.max(state.frameSeq,Number(s.frameSeq)||0);
      state.lastFrameAt=Number(s.lastFrameAt)||state.lastFrameAt;
      if(s.fps!=null)$("#liveVisionFps").textContent=Number(s.fps).toFixed(1)+" fps";
      stateText(running?"Live Chromium stream":"Idle",running);
      setTransport(running?"WebSocket / Playwright":"—");
    }
    if(msg.type==="session-result"&&msg.ok){
      state.running=true;state.mode="server";stateText("Live Chromium stream",true);setTransport("WebSocket / Playwright");
      log("Vision session started","ok");
    }
    if(msg.type==="action-result"&&!msg.ok)log(msg.error||"Vision action failed","error");
  }

  function connectWs(){
    if(!serverCapable()||typeof WebSocket==="undefined")return;
    if(state.ws&&(state.ws.readyState===0||state.ws.readyState===1))return;
    try{
      const ws=new WebSocket(wsUrl());ws.binaryType="arraybuffer";state.ws=ws;
      ws.onopen=()=>{ws.send(JSON.stringify({type:"hello",role:"vision-ui",protocol:5,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1}}));log("Live vision channel connected","ok")};
      ws.onmessage=onMessage;
      ws.onerror=()=>log("Vision WebSocket error","error");
      ws.onclose=()=>{state.ws=null;if(state.running){state.running=false;stateText("Disconnected",false)}};
    }catch(e){log(e.message||String(e),"error")}
  }

  async function post(path,body){
    const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
    let j={};try{j=await r.json()}catch{}
    if(!r.ok||j.ok===false)throw new Error(j.error||"Vision request failed");
    return j;
  }

  async function start(){
    mount();style();connectWs();
    if(!serverCapable())return log("Live server mode requires the local Forge server","warn");
    if(state.running)return log("Live vision is already running","ok");
    try{
      await post("./api/vision/session/start",{target:"/",viewport:{width:Math.max(320,innerWidth),height:Math.max(240,innerHeight)},touch:matchMedia("(pointer:coarse)").matches,mobile:innerWidth<700,streamFps:30});
      state.running=true;state.mode="server";stateText("Live Chromium stream",true);setTransport("WebSocket / Playwright");
    }catch(e){state.running=false;state.mode="idle";stateText("Idle",false);log(e.message||String(e),"error")}
  }

  async function restart(){
    try{await stop();await sleep(150);await start()}catch(e){log(e.message||String(e),"error")}
  }

  async function stop(){
    try{if(serverCapable())await post("./api/vision/session/stop",{})}catch(e){log(e.message||String(e),"error")}
    state.running=false;state.mode="idle";stateText("Idle",false);setTransport("—");
    const img=$("#liveVisionRemote");
    if(img)img.removeAttribute("src");
    if(state.remoteUrl){URL.revokeObjectURL(state.remoteUrl);state.remoteUrl=null}
    $("#liveVisionPreview")?.classList.remove("remote","local");
  }

  async function control(action,options={}){
    if(!serverCapable())throw new Error("Server vision is unavailable");
    return (await post("./api/vision/action",{action,options})).result;
  }

  async function runManual(action){
    try{const result=await control(action);log(JSON.stringify(result),"ok")}
    catch(e){log(e.message||String(e),"error")}
  }

  async function getState(){const r=await fetch("./api/vision/state",{cache:"no-store"});if(!r.ok)throw new Error("Vision state unavailable");return r.json()}
  async function getElements(){const r=await fetch("./api/vision/elements",{cache:"no-store"});if(!r.ok)throw new Error("Vision elements unavailable");return r.json()}

  async function clickSelector(selector){
    const data=await getElements();
    const e=data.elements.find(x=>x.selector===selector&&x.visible);
    if(!e)throw new Error("Visible element not found: "+selector);
    return control({type:"mouse.click",x:e.x+e.width/2,y:e.y+e.height/2});
  }

  async function executeAction(a){
    if(a.type==="vision"||a.type==="scene_scan")return getState();
    if(a.type==="visual_health")return window.Forge?.diagnostics?.()?window.Forge.diagnostics():{ok:true};
    return control(a);
  }

  async function executeTask(task){
    const s=String(task||"").trim().toLowerCase();
    if(!s)throw new Error("Task is empty");
    if(s.includes("scan")||s.includes("vision")||s.includes("inspect"))return getState();
    if(s.includes("add box"))return clickSelector('[data-add="box"]');
    if(s.includes("add sphere"))return clickSelector('[data-add="sphere"]');
    if(s.includes("play"))return clickSelector("#play");
    if(s.includes("stop")||s.includes("pause"))return clickSelector("#play");
    if(s.includes("rotate"))return control({type:"keyboard.press",key:"2"});
    if(s.includes("scale"))return control({type:"keyboard.press",key:"3"});
    if(s.includes("move"))return control({type:"keyboard.press",key:"1"});
    if(s.includes("frame"))return clickSelector("#frame");
    if(s.includes("focus"))return clickSelector("#focus");
    throw new Error("Task not mapped; use concrete vision actions for exact control");
  }

  async function runAgent(){
    mount();
    const task=$("#liveVisionTask")?.value?.trim();
    if(!task||state.busy)return;
    state.busy=true;$("#liveVisionAgent").disabled=true;
    try{const result=await executeTask(task);log(JSON.stringify(result),"ok")}
    catch(e){log(e.message||String(e),"error")}
    finally{state.busy=false;$("#liveVisionAgent").disabled=false}
  }

  function visualHealth(){
    const canvas=document.querySelector("#viewport");
    if(!canvas)return{ok:false,reason:"viewport-missing"};
    const rect=canvas.getBoundingClientRect();
    return{ok:rect.width>300&&rect.height>300,viewport:{width:rect.width,height:rect.height},overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
  }

  const api={open,start,stop,restart,runAgent,executeAction,executeTask,visualHealth,control,status:()=>({mode:state.mode,running:state.running,connected:state.ws?.readyState===1,frames:state.frameSeq,lastFrameAt:state.lastFrameAt,transport:state.mode==="server"?"playwright-screencast-websocket":"idle"})};
  window.AssetForgeLiveVision=api;
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{mount();style()},{once:true});
  else{mount();style()}
})();