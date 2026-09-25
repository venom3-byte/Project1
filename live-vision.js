(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const state = {ws:null,stream:null,running:false,busy:false,frameSeq:0,lastFrameAt:0,captureCanvas:null,captureCtx:null,frameTimer:0,captureWidth:960,captureHeight:540};

  function styleUi(){
    if($('#liveVisionStyle')) return;
    const link=document.createElement('link');
    link.id='liveVisionStyle'; link.rel='stylesheet'; link.href='./live-vision.css?v=1';
    document.head.appendChild(link);
  }
  function mount(){
    if($('#liveVision')) return;
    const el=document.createElement('section');
    el.id='liveVision'; el.className='live-vision';
    el.innerHTML=[
      '<div class="live-vision-head"><div><strong>LIVE VISION</strong><small>Eyes + Hands</small></div><button id="liveVisionClose" title="Close">×</button></div>',
      '<div class="live-vision-status"><span id="liveVisionDot" class="live-dot"></span><span id="liveVisionState">Disconnected</span><span id="liveVisionFps">0 fps</span></div>',
      '<div class="live-vision-preview"><video id="liveVisionVideo" autoplay muted playsinline></video><canvas id="liveVisionOverlay"></canvas><div id="liveVisionCrosshair"></div></div>',
      '<div class="live-vision-actions"><button id="liveVisionStart" class="primary">Start live vision</button><button id="liveVisionStop">Stop</button><button id="liveVisionAgent">Run agent</button></div>',
      '<label class="live-vision-field">Task <textarea id="liveVisionTask" rows="2" placeholder="Example: remove the background, crop the subject tightly, then export PNG"></textarea></label>',
      '<div class="live-vision-log" id="liveVisionLog"></div>',
      '<div class="live-vision-foot">Frames stay in memory. Agent actions are executed by this browser page.</div>'
    ].join('');
    document.body.appendChild(el);
    $('#liveVisionClose').onclick=closePanel;
    $('#liveVisionStart').onclick=start;
    $('#liveVisionStop').onclick=stop;
    $('#liveVisionAgent').onclick=runAgent;
  }
  function openPanel(){mount();styleUi();$('#liveVision').classList.add('open');connectWs()}
  function closePanel(){$('#liveVision')?.classList.remove('open')}
  function setState(text,online=state.running){
    const s=$('#liveVisionState'),d=$('#liveVisionDot');
    if(s)s.textContent=text;
    if(d)d.classList.toggle('live-on',!!online);
  }
  function log(text,cls=''){
    const box=$('#liveVisionLog');if(!box)return;
    const row=document.createElement('div');row.className='live-log-row '+cls;
    row.textContent=new Date().toLocaleTimeString()+'  '+text;
    box.prepend(row);while(box.children.length>18)box.lastElementChild.remove();
  }
  function wsUrl(){
    const proto=location.protocol==='https:'?'wss:':'ws:';
    return proto+'//'+location.host+'/live';
  }
  function connectWs(){
    if(state.ws&&(state.ws.readyState===WebSocket.OPEN||state.ws.readyState===WebSocket.CONNECTING))return;
    try{
      const ws=new WebSocket(wsUrl());state.ws=ws;ws.binaryType='arraybuffer';
      ws.onopen=()=>{
        ws.send(JSON.stringify({type:'hello',role:'vision-client',viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1}}));
        setState(state.running?'Streaming':'Bridge connected',state.running);log('Live control bridge connected','ok');
      };
      ws.onclose=()=>{setState('Bridge offline',false);setTimeout(()=>state.running&&connectWs(),1200)};
      ws.onerror=()=>setState('Bridge connection error',false);
      ws.onmessage=async ev=>{
        let d;try{d=JSON.parse(ev.data)}catch{return}
        if(d.type==='action'){
          try{
            const result=await executeAction(d.action||{});
            ws.send(JSON.stringify({type:'action-result',id:d.id||null,ok:true,result}));
            log('action: '+(d.action?.type||'unknown'),'action');
          }catch(e){
            ws.send(JSON.stringify({type:'action-result',id:d.id||null,ok:false,error:e?.message||String(e)}));
            log('action failed: '+(e?.message||e),'error');
          }
        }
      };
    }catch(e){setState('Bridge unavailable',false)}
  }
  function normalizedPoint(x,y,cw,ch){
    const px=Number(x)||0,py=Number(y)||0,sx=innerWidth/Math.max(1,cw||innerWidth),sy=innerHeight/Math.max(1,ch||innerHeight);
    return {x:Math.max(0,Math.min(innerWidth-1,px*sx)),y:Math.max(0,Math.min(innerHeight-1,py*sy))};
  }
  function dispatchPointer(type,x,y,button=0){
    const el=document.elementFromPoint(x,y)||document.body;
    const init={bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button,buttons:type==='pointerup'?0:button===0?1:0,pointerId:7,pointerType:'mouse',isPrimary:true};
    el.dispatchEvent(new PointerEvent(type,init));
    if(type==='mousedown')el.dispatchEvent(new MouseEvent('mousedown',init));
    if(type==='mouseup')el.dispatchEvent(new MouseEvent('mouseup',init));
    if(type==='click')el.dispatchEvent(new MouseEvent('click',init));
    return {tag:el.tagName||'',id:el.id||''};
  }
  async function insertText(text){
    const active=document.activeElement;
    if(active&&(active.matches('input,textarea,[contenteditable="true"]'))){
      const next=String(text??'');
      if('value' in active){
        const proto=active instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        const desc=Object.getOwnPropertyDescriptor(proto,'value');
        if(desc?.set)desc.set.call(active,next);else active.value=next;
        active.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:next}));
        active.dispatchEvent(new Event('change',{bubbles:true}));
      }else{
        active.textContent=next;
        active.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:next}));
      }
      return true;
    }
    throw new Error('No editable field is focused');
  }
  async function keypress(keys){
    const list=Array.isArray(keys)?keys:[keys],active=document.activeElement||document.body;
    for(const key of list){
      const k=String(key);
      active.dispatchEvent(new KeyboardEvent('keydown',{key:k,code:k,bubbles:true,cancelable:true}));
      active.dispatchEvent(new KeyboardEvent('keyup',{key:k,code:k,bubbles:true,cancelable:true}));
      if(k==='Enter'&&typeof active.click==='function')active.click();
      await sleep(20);
    }
    return true;
  }
  async function executeAction(action){
    const type=action.type,p=normalizedPoint(action.x,action.y,action.screenWidth,action.screenHeight);
    if(type==='click')return dispatchPointer('click',p.x,p.y,action.button==='right'?2:0);
    if(type==='double_click'){dispatchPointer('click',p.x,p.y,0);await sleep(60);return dispatchPointer('click',p.x,p.y,0)}
    if(type==='move')return dispatchPointer('pointermove',p.x,p.y,0);
    if(type==='drag'){
      const from=normalizedPoint(action.start_x??action.x,action.start_y??action.y,action.screenWidth,action.screenHeight);
      const to=normalizedPoint(action.end_x??action.x,action.end_y??action.y,action.screenWidth,action.screenHeight);
      dispatchPointer('pointerdown',from.x,from.y,0);
      for(let i=1;i<=8;i++){const x=from.x+(to.x-from.x)*i/8,y=from.y+(to.y-from.y)*i/8;dispatchPointer('pointermove',x,y,0);await sleep(12)}
      dispatchPointer('pointerup',to.x,to.y,0);return {from,to};
    }
    if(type==='scroll'){window.scrollBy({left:Number(action.scroll_x)||0,top:Number(action.scroll_y??action.dy)||0,behavior:'auto'});return true}
    if(type==='type')return insertText(action.text||'');
    if(type==='keypress')return keypress(action.keys||action.key||[]);
    if(type==='wait'){await sleep(Math.max(0,Number(action.ms)||500));return true}
    if(type==='screenshot')return {screenWidth:innerWidth,screenHeight:innerHeight};
    throw new Error('Unsupported action '+type);
  }
  let previousPixels=null,lastSent=0,fpsFrames=0,fpsStarted=performance.now();
  async function captureLoop(){
    if(!state.running||!state.stream)return;
    const v=$('#liveVisionVideo');state.captureCanvas ||= document.createElement('canvas');state.captureCtx ||= state.captureCanvas.getContext('2d',{willReadFrequently:true});
    const track=state.stream.getVideoTracks()[0],settings=track?.getSettings?.()||{},vw=settings.width||v.videoWidth||innerWidth,vh=settings.height||v.videoHeight||innerHeight;
    const scale=Math.min(1,state.captureWidth/vw),cw=Math.max(320,Math.round(vw*scale)),ch=Math.max(180,Math.round(vh*scale));
    state.captureCanvas.width=cw;state.captureCanvas.height=ch;state.captureCtx.drawImage(v,0,0,cw,ch);
    const sample=state.captureCtx.getImageData(0,0,Math.min(cw,320),Math.min(ch,180)).data;
    let motion=1;if(previousPixels&&previousPixels.length===sample.length){let sum=0,n=0;for(let i=0;i<sample.length;i+=16){sum+=Math.abs(sample[i]-previousPixels[i]);n++}motion=n?Math.min(1,sum/(n*255)):0}
    previousPixels=sample;const now=performance.now();
    if(state.ws?.readyState===WebSocket.OPEN&&(now-lastSent>420||motion>0.035)){
      const data=state.captureCanvas.toDataURL('image/jpeg',0.62);state.frameSeq++;state.lastFrameAt=Date.now();fpsFrames++;lastSent=now;
      state.ws.send(JSON.stringify({type:'frame',seq:state.frameSeq,createdAt:Date.now(),image:data,screenWidth:innerWidth,screenHeight:innerHeight,width:cw,height:ch,dpr:devicePixelRatio||1,motion:Number(motion.toFixed(4))}));
      const elapsed=(now-fpsStarted)/1000;if(elapsed>1){$('#liveVisionFps').textContent=(fpsFrames/elapsed).toFixed(1)+' fps';fpsFrames=0;fpsStarted=now}
    }
    state.frameTimer=requestAnimationFrame(captureLoop);
  }
  async function start(){
    mount();styleUi();
    if(!navigator.mediaDevices?.getDisplayMedia){setState('Screen capture not supported in this browser',false);log('getDisplayMedia is unavailable in this browser','error');return}
    try{
      stop();
      const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:6,max:10},width:{ideal:1280,max:1920},height:{ideal:720,max:1080},displaySurface:'browser'},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'include'});
      state.stream=stream;state.running=true;const v=$('#liveVisionVideo');v.srcObject=stream;await v.play();
      stream.getVideoTracks()[0].addEventListener('ended',()=>stop());connectWs();setState('Live vision active',true);log('Continuous visual stream started','ok');captureLoop();
    }catch(e){state.running=false;state.stream=null;setState('Capture cancelled or blocked',false);log(e?.message||String(e),'error')}
  }
  function stop(){
    state.running=false;cancelAnimationFrame(state.frameTimer);
    if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}
    const v=$('#liveVisionVideo');if(v)v.srcObject=null;
    if($('#liveVisionDot'))$('#liveVisionDot').classList.remove('live-on');
    if($('#liveVisionState'))$('#liveVisionState').textContent='Stopped';
  }
  async function runAgent(){
    const task=$('#liveVisionTask')?.value?.trim();if(!task){log('Enter an agent task first','error');return}
    if(!state.running){await start();await sleep(700)}
    if(state.busy){log('Agent is already running','error');return}
    state.busy=true;$('#liveVisionAgent').disabled=true;
    try{
      const r=await fetch('./api/agent/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task})});
      const data=await r.json();if(!r.ok)throw new Error(data.message||'Agent request failed');
      log(data.output||'Agent completed','ok');if(data.turns)log('completed in '+data.turns+' turns','ok');
    }catch(e){log(e?.message||String(e),'error')}finally{state.busy=false;$('#liveVisionAgent').disabled=false}
  }
  const api={open:openPanel,start,stop,runAgent,status:()=>({running:state.running,connected:state.ws?.readyState===WebSocket.OPEN,lastFrameAt:state.lastFrameAt,frames:state.frameSeq}),executeAction};
  window.AssetForgeLiveVision=api;
  function addEntryButton(){
    const host=$('#mobileDock');if(!host||$('#liveVisionDockBtn'))return;
    const b=document.createElement('button');b.id='liveVisionDockBtn';b.title='Live Vision';b.innerHTML='◉<span>Vision</span>';b.onclick=openPanel;host.insertBefore(b,host.lastElementChild);
  }
  function boot(){mount();styleUi();addEntryButton();connectWs()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();