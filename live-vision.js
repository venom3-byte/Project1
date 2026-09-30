(() => {
  const $=(s,r=document)=>r.querySelector(s);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const state={
    ws:null,stream:null,running:false,busy:false,frameSeq:0,lastFrameAt:0,frameCount:0,frameWindowStart:0,
    captureCanvas:null,captureCtx:null,captureTimer:0,remoteUrl:null,mode:"idle",pointerId:11
  };
  const serverCapable=()=>location.protocol!=='file:'&&!/github\.io$/i.test(location.hostname);
  const wsUrl=()=>((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/vision');
  function style(){if($('#liveVisionStyle'))return;const l=document.createElement('link');l.id='liveVisionStyle';l.rel='stylesheet';l.href='./live-vision.css?v=3';document.head.appendChild(l)}
  function mount(){
    if($('#liveVision'))return;
    const el=document.createElement('section');
    el.id='liveVision';
    el.className='live-vision';
    el.innerHTML=[
      '<div class="live-vision-head"><div><strong>FORGE VISION</strong><small>Live eyes + real hands · Spatial Core</small></div><button id="liveVisionClose">×</button></div>',
      '<div class="live-vision-status"><span id="liveVisionDot" class="live-dot"></span><span id="liveVisionState">Idle</span><span id="liveVisionFps">0 fps</span><span id="liveVisionTransport">—</span></div>',
      '<div class="live-vision-preview" id="liveVisionPreview"><video id="liveVisionVideo" autoplay muted playsinline></video><img id="liveVisionRemote" alt="Forge live vision stream"><div id="liveVisionCrosshair"></div></div>',
      '<div class="live-vision-actions"><button id="liveVisionStart" class="primary">Start live eyes</button><button id="liveVisionPro">Pro CDP</button><button id="liveVisionStop">Stop</button></div>',
      '<div class="live-vision-actions compact"><button id="liveVisionMove">Move</button><button id="liveVisionDown">Mouse down</button><button id="liveVisionUp">Mouse up</button><button id="liveVisionWheel">Wheel</button></div>',
      '<label class="live-vision-field">Task <textarea id="liveVisionTask" rows="2" placeholder="Example: select Car, drag it to the center, press Play"></textarea></label>',
      '<div class="live-vision-log" id="liveVisionLog"></div>',
      '<div class="live-vision-foot"><strong>Direct mode</strong> uses the live MediaStream. <strong>Pro CDP</strong> uses Chromium screencast + CDP mouse/keyboard/touch events; no screenshot request loop is used.</div>'
    ].join('');
    document.body.appendChild(el);
    $('#liveVisionClose').onclick=()=>el.classList.remove('open');
    $('#liveVisionStart').onclick=start;
    $('#liveVisionPro').onclick=connectPro;
    $('#liveVisionStop').onclick=stop;
    $('#liveVisionMove').onclick=()=>runManual({type:'move',x:innerWidth/2,y:innerHeight/2});
    $('#liveVisionDown').onclick=()=>runManual({type:'mouseDown',x:innerWidth/2,y:innerHeight/2});
    $('#liveVisionUp').onclick=()=>runManual({type:'mouseUp',x:innerWidth/2,y:innerHeight/2});
    $('#liveVisionWheel').onclick=()=>runManual({type:'wheel',x:innerWidth/2,y:innerHeight/2,deltaY:360});
  }
  function open(){mount();style();$('#liveVision').classList.add('open');connectVisionWs()}
  function log(t,c=''){const b=$('#liveVisionLog');if(!b)return;const r=document.createElement('div');r.className='live-log-row '+c;r.textContent=new Date().toLocaleTimeString()+'  '+t;b.prepend(r);while(b.children.length>24)b.lastElementChild.remove()}
  function stateText(t,on=state.running){const s=$('#liveVisionState'),d=$('#liveVisionDot');if(s)s.textContent=t;if(d)d.classList.toggle('live-on',!!on)}
  function setTransport(t){const e=$('#liveVisionTransport');if(e)e.textContent=t||'—'}
  function connectVisionWs(){
    if(!serverCapable()||typeof WebSocket==='undefined')return;
    if(state.ws&&(state.ws.readyState===0||state.ws.readyState===1))return;
    try{
      const ws=new WebSocket(wsUrl());
      state.ws=ws;
      ws.onopen=()=>{ws.send(JSON.stringify({type:'hello',role:'vision-ui',protocol:4,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1}}));log('Live vision WebSocket connected','ok')};
      ws.onerror=()=>{};
      ws.onclose=()=>{state.ws=null;if(state.mode==='cdp')stateText('CDP disconnected',false)};
      ws.onmessage=onVisionMessage;
    }catch{}
  }
  function onVisionMessage(e){
    let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==='vision-state'){
      const s=m.state||{};
      if(s.connected&&s.streaming){state.mode='cdp';state.running=true;stateText('Direct Chromium live',true);setTransport('CDP');$('#liveVisionPreview').classList.add('remote');$('#liveVisionPreview').classList.remove('local')}
      if(!s.connected&&state.mode==='cdp'){state.mode='idle';state.running=false;stateText('CDP disconnected',false)}
      if(s.fps!=null)$('#liveVisionFps').textContent=Number(s.fps).toFixed(1)+' fps';
    }
    if(m.type==='vision-frame'&&m.data){
      const img=$('#liveVisionRemote');if(!img)return;
      try{
        const bytes=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
        const old=state.remoteUrl;state.remoteUrl=url;img.onload=()=>{if(old)URL.revokeObjectURL(old)};img.src=url;
        state.frameCount++;const now=Date.now();if(!state.frameWindowStart)state.frameWindowStart=now;
        if(now-state.frameWindowStart>1000){$('#liveVisionFps').textContent=Number(state.frameCount*1000/(now-state.frameWindowStart)).toFixed(1)+' fps';state.frameCount=0;state.frameWindowStart=now}
      }catch{}
    }
  }
  function normalize(x,y,w,h){return{x:Math.max(0,Math.min(innerWidth-1,(Number(x)||0)*innerWidth/Math.max(1,w||innerWidth))),y:Math.max(0,Math.min(innerHeight-1,(Number(y)||0)*innerHeight/Math.max(1,h||innerHeight)))}}
  function dispatchPointer(type,x,y,extra={}){
    const el=document.elementFromPoint(x,y)||document.body;
    const buttons=type==='pointerup'?0:(extra.buttons??1);
    el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,screenX:x,screenY:y,button:extra.button??0,buttons,pointerId:state.pointerId,pointerType:extra.pointerType||'mouse',isPrimary:true}));
    return{tag:el.tagName||'',id:el.id||'',className:typeof el.className==='string'?el.className:''};
  }
  async function localControl(a){
    const type=String(a.type||'');
    if(type==='move'){const p=normalize(a.x,a.y,a.screenWidth,a.screenHeight);return dispatchPointer('pointermove',p.x,p.y,{buttons:a.buttons??0})}
    if(type==='mouseDown'){const p=normalize(a.x,a.y,a.screenWidth,a.screenHeight);state.pointerId++;return dispatchPointer('pointerdown',p.x,p.y,{buttons:1})}
    if(type==='mouseUp'){const p=normalize(a.x,a.y,a.screenWidth,a.screenHeight);return dispatchPointer('pointerup',p.x,p.y,{buttons:0})}
    if(type==='click'||type==='doubleClick'){
      const p=normalize(a.x,a.y,a.screenWidth,a.screenHeight);const el=document.elementFromPoint(p.x,p.y)||document.body;dispatchPointer('pointermove',p.x,p.y,{buttons:0});
      const count=type==='doubleClick'?2:1;
      for(let i=0;i<count;i++){dispatchPointer('pointerdown',p.x,p.y,{buttons:1});dispatchPointer('pointerup',p.x,p.y,{buttons:0});el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:p.x,clientY:p.y,button:a.button==='right'?2:0,detail:i+1}));if(i+1<count)await sleep(55)}
      return{ok:true,type,point:p};
    }
    if(type==='drag'){
      const a0=normalize(a.x,a.y,a.screenWidth,a.screenHeight),b0=normalize(a.toX,a.toY,a.screenWidth,a.screenHeight),steps=Math.max(2,Math.min(60,a.steps||12));
      dispatchPointer('pointermove',a0.x,a0.y,{buttons:0});dispatchPointer('pointerdown',a0.x,a0.y,{buttons:1});
      for(let i=1;i<=steps;i++){const t=i/steps;dispatchPointer('pointermove',a0.x+(b0.x-a0.x)*t,a0.y+(b0.y-a0.y)*t,{buttons:1});await sleep(a.stepMs||8)}
      dispatchPointer('pointerup',b0.x,b0.y,{buttons:0});return{ok:true,type,from:a0,to:b0,steps};
    }
    if(type==='wheel'){const p=normalize(a.x??innerWidth/2,a.y??innerHeight/2,a.screenWidth,a.screenHeight);const el=document.elementFromPoint(p.x,p.y)||document.body;el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,deltaX:a.deltaX||0,deltaY:a.deltaY||0}));return{ok:true,type,point:p}}
    if(type==='press'||type==='keyDown'||type==='keyUp'||type==='typeText'){
      const target=document.activeElement||document.body;
      if(type==='typeText'){target.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertText',data:String(a.text||'')}));if('value' in target){target.value+=String(a.text||'');target.dispatchEvent(new Event('input',{bubbles:true}))}return{ok:true,type}}
      const evName=type==='keyUp'?'keyup':'keydown';target.dispatchEvent(new KeyboardEvent(evName,{bubbles:true,cancelable:true,key:String(a.key||''),code:a.code||'',ctrlKey:!!a.ctrlKey,shiftKey:!!a.shiftKey,altKey:!!a.altKey,metaKey:!!a.metaKey}));if(type==='press')target.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:String(a.key||''),code:a.code||''}));return{ok:true,type,key:a.key};
    }
    if(type==='touchStart'||type==='touchMove'||type==='touchEnd'){
      const p=normalize(a.x,a.y,a.screenWidth,a.screenHeight),el=document.elementFromPoint(p.x,p.y)||document.body;
      const eventType=type==='touchStart'?'pointerdown':type==='touchMove'?'pointermove':'pointerup';
      return dispatchPointer(eventType,p.x,p.y,{buttons:type==='touchEnd'?0:1,pointerType:'touch'});
    }
    throw new Error('Unsupported local control action: '+type);
  }
  async function runManual(action){try{const result=await control(action);log(JSON.stringify(result),'ok')}catch(e){log(e.message||String(e),'error')}}
  async function control(action){
    if(state.mode==='cdp'&&state.ws?.readyState===1){
      const r=await fetch('./api/vision/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
      const j=await r.json();if(!j.ok)throw new Error(j.error||'CDP control failed');return j.result;
    }
    return localControl(action);
  }
  async function connectPro(){
    mount();connectVisionWs();
    if(!serverCapable())return log('Pro CDP is only available from the local/server Forge build','warn');
    try{
      const targets=await fetch('./api/vision/targets').then(r=>r.json());
      const list=targets.targets||[];
      const target=list.find(t=>t.type==='page'&&/^https?:/i.test(t.url||''));
      if(!target)throw new Error('No Chromium CDP target found on 127.0.0.1:9222');
      const result=await fetch('./api/vision/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetId:target.id,targetUrl:target.url,quality:55,maxWidth:1280,maxHeight:720,everyNthFrame:1})}).then(r=>r.json());
      if(!result.ok)throw new Error(result.error||'CDP connect failed');
      state.mode='cdp';state.running=true;stateText('Direct Chromium live',true);setTransport('CDP');log('CDP live stream started for '+target.url,'ok');
    }catch(e){state.mode='idle';state.running=false;log(e.message||String(e),'error')}
  }
  function visualHealth(){
    const canvas=document.querySelector('#viewport');if(!canvas)return{ok:false,reason:'viewport-missing'};
    const rect=canvas.getBoundingClientRect();return{ok:rect.width>300&&rect.height>300,renderer:window.Forge?.diagnostics?.().renderer||'unknown',viewport:{width:rect.width,height:rect.height},overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
  }
  async function executeAction(a){
    if(a.type==='vision'||a.type==='scene_scan')return window.Forge?.spatial?.sceneVision?.()||window.ForgeSpatial?.sceneVision?.()||{};
    if(a.type==='visual_health'||a.type==='visual_qa')return visualHealth();
    if(a.type==='select_entity'){const F=window.Forge,r=a.id?F.select(a.id):[...F.entities.values()].find(x=>x.name.toLowerCase()===String(a.name||'').toLowerCase());if(!r)throw new Error('Entity not found');return F.spatial?.inspect?.(r)||window.ForgeSpatial?.inspect?.(r)||{id:r.id,name:r.name,kind:r.kind}}
    if(a.type==='focus'){window.Forge?.focus?.();return true}
    if(a.type==='frame'){window.Forge?.frame?.();return true}
    if(a.type==='transform'){if(a.id)window.Forge?.select?.(a.id);window.Forge?.transform?.(a);return window.ForgeSpatial?.inspect?.(window.Forge.selected())||null}
    return control(a);
  }
  async function localAgent(task){
    const F=window.Forge,s=String(task||'').trim(),lower=s.toLowerCase();
    if(/scan|inspect|vision|understand/.test(lower))return executeAction({type:'vision'});
    const names=[...F.entities.values()].map(r=>r.name).filter(Boolean),target=names.find(n=>lower.includes(n.toLowerCase()));
    if(target){
      await executeAction({type:'select_entity',name:target});
      if(/delete|remove|erase/.test(lower)){F.delete();return{ok:true,action:'delete',entity:target}}
      if(/duplicate|copy|clone/.test(lower)){const d=F.duplicate();return{ok:true,action:'duplicate',entity:d?.name||target}}
      if(/center|middle/.test(lower)){F.spatial?.moveToScreen?.(F.selectedId,innerWidth/2,innerHeight/2,.5,0);return{ok:true,action:'move-center',entity:target}}
      if(/focus/.test(lower)){F.focus();return{ok:true,action:'focus',entity:target}}
    }
    if(/play/.test(lower)){F.running=true;F.timelinePlaying=true;return{ok:true,action:'play'}}
    if(/stop|pause/.test(lower)){F.running=false;F.timelinePlaying=false;return{ok:true,action:'stop'}}
    if(/frame all|frame/.test(lower)){F.frame();return{ok:true,action:'frame'}}
    if(/focus/.test(lower)){F.focus();return{ok:true,action:'focus'}}
    throw new Error('Task not mapped. Use a deterministic command or a pixel action such as click/drag/wheel/press.');
  }
  async function runAgent(){
    mount();
    const task=$('#liveVisionTask')?.value?.trim();if(!task)return log('Enter a task first','error');if(state.busy)return;
    state.busy=true;$('#liveVisionStart').disabled=true;
    try{
      let result;
      if(serverCapable()&&state.mode==='cdp')result=await fetch('./api/forge/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:{op:'agent-task',task}})}).then(r=>r.json());
      else result=await localAgent(task);
      log(JSON.stringify(result),'ok');
    }catch(e){log(e.message||String(e),'error')}finally{state.busy=false;$('#liveVisionStart').disabled=false}
  }
  async function start(){
    mount();style();connectVisionWs();
    if(state.mode==='cdp'){return log('CDP live is already active','ok')}
    if(!navigator.mediaDevices?.getDisplayMedia){stateText('Spatial fallback',true);setTransport('Local DOM');log('Screen capture unavailable; local vision/control remains active','warn');return}
    try{
      stop();
      const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30},width:{ideal:1920,max:1920},height:{ideal:1080,max:1080},displaySurface:'browser'},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'include'});
      state.stream=stream;state.running=true;state.mode='local-media';stateText('Live MediaStream',true);setTransport('MediaStream');
      const v=$('#liveVisionVideo');v.srcObject=stream;await v.play();$('#liveVisionPreview').classList.add('local');$('#liveVisionPreview').classList.remove('remote');
      stream.getVideoTracks()[0].addEventListener('ended',stop);
      sampleLiveFrames();
    }catch(e){state.running=false;state.mode='idle';state.stream=null;stateText('Spatial fallback',true);setTransport('Local DOM');log(e.message||String(e),'warn')}
  }
  function sampleLiveFrames(){
    if(!state.running||state.mode!=='local-media')return;
    const v=$('#liveVisionVideo');
    const tick=()=>{if(!state.running||state.mode!=='local-media')return;state.frameSeq++;state.lastFrameAt=Date.now();$('#liveVisionFps').textContent='live';if('requestVideoFrameCallback' in v)v.requestVideoFrameCallback(()=>setTimeout(sampleLiveFrames,120));else state.captureTimer=setTimeout(sampleLiveFrames,120)};
    tick();
  }
  async function stop(){
    try{if(serverCapable())await fetch('./api/vision/disconnect',{method:'POST'}).catch(()=>{})}catch{}
    state.running=false;state.mode='idle';if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}
    clearTimeout(state.captureTimer);const v=$('#liveVisionVideo');if(v)v.srcObject=null;
    const img=$('#liveVisionRemote');if(img)img.removeAttribute('src');if(state.remoteUrl){URL.revokeObjectURL(state.remoteUrl);state.remoteUrl=null}
    $('#liveVisionPreview')?.classList.remove('remote','local');stateText('Idle',false);setTransport('—');
  }
  window.AssetForgeLiveVision={
    open,start,stop,runAgent,executeAction,visualHealth,connectPro,control,
    status:()=>({mode:state.mode,running:state.running,connected:state.ws?.readyState===1,frames:state.frameSeq,lastFrameAt:state.lastFrameAt,transport:state.mode==='cdp'?'chromium-cdp':state.mode==='local-media'?'media-stream':'local-spatial'})
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();style()},{once:true});else{mount();style()}
})();