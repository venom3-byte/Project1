(() => {
  const $=(s,r=document)=>r.querySelector(s);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const state={
    ws:null,running:false,remote:false,busy:false,stream:null,frameSeq:0,lastFrameAt:0,
    frameTimer:0,captureCanvas:null,captureCtx:null,captureWidth:960,captureHeight:540,
    session:null,actionWaiters:new Map(),previewBound:false,pendingMove:null,touchId:1
  };

  const serverCapable=()=>location.protocol!=='file:'&&!/github\.io$/i.test(location.hostname);
  const style=()=>{
    if($('#liveVisionStyle'))return;
    const l=document.createElement('link');
    l.id='liveVisionStyle';l.rel='stylesheet';l.href='./live-vision.css?v=3';
    document.head.appendChild(l)
  };

  function mount(){
    if($('#liveVision'))return;
    const el=document.createElement('section');
    el.id='liveVision';el.className='live-vision';
    el.innerHTML=
      '<div class="live-vision-head"><div><strong>FORGE VISION</strong><small>Continuous Eyes + Real Hands</small></div><button id="liveVisionClose">×</button></div>'+
      '<div class="live-vision-status"><span id="liveVisionDot" class="live-dot"></span><span id="liveVisionState">Ready</span><span id="liveVisionFps">0 fps</span><span id="liveVisionSeq">frame 0</span></div>'+
      '<div id="liveVisionPreview" class="live-vision-preview remote" tabindex="0" aria-label="Live Forge viewport">'+
        '<img id="liveVisionStream" alt="Live Forge viewport stream" draggable="false">'+
        '<video id="liveVisionVideo" autoplay muted playsinline></video><div id="liveVisionCrosshair"></div>'+
      '</div>'+
      '<div class="live-vision-actions"><button id="liveVisionStart" class="primary">Start live eyes</button><button id="liveVisionStop">Stop</button><button id="liveVisionAgent">Run task</button></div>'+
      '<label class="live-vision-field">Task <textarea id="liveVisionTask" rows="2" placeholder="Example: create a box, focus, undo, or frame"></textarea></label>'+
      '<div class="live-vision-log" id="liveVisionLog"></div>'+
      '<div class="live-vision-foot"><strong>Live transport:</strong> continuous Playwright Screencast + real mouse/keyboard/touch/wheel control. Local screen-capture remains as fallback.</div>';
    document.body.appendChild(el);
    $('#liveVisionClose').onclick=()=>el.classList.remove('open');
    $('#liveVisionStart').onclick=start;
    $('#liveVisionStop').onclick=stop;
    $('#liveVisionAgent').onclick=runAgent;
    bindPreviewControls();
  }

  function open(){mount();style();$('#liveVision').classList.add('open');connectVisionWs()}
  function log(text,kind=''){
    const box=$('#liveVisionLog');if(!box)return;
    const row=document.createElement('div');row.className='live-log-row '+kind;
    row.textContent=new Date().toLocaleTimeString()+'  '+text;
    box.prepend(row);
    while(box.children.length>30)box.lastElementChild.remove()
  }
  function stateText(text,on=state.running){
    const s=$('#liveVisionState'),d=$('#liveVisionDot');
    if(s)s.textContent=text;
    if(d)d.classList.toggle('live-on',!!on);
  }
  function setMode(mode){
    const preview=$('#liveVisionPreview');
    if(preview){preview.classList.toggle('remote',mode==='remote');preview.classList.toggle('local',mode==='local')}
  }
  function updateTelemetry(s){
    if(!s)return;
    state.session=s;
    state.frameSeq=Number(s.frameSeq||state.frameSeq||0);
    state.lastFrameAt=Number(s.lastFrameAt||state.lastFrameAt||0);
    $('#liveVisionFps').textContent=(Number(s.fps||0))+' fps';
    $('#liveVisionSeq').textContent='frame '+state.frameSeq;
    if(s.running)stateText('Live session · '+Math.max(0,Number(s.ageMs||0))+'ms',true);
  }
  function connectVisionWs(){
    if(!serverCapable()||typeof WebSocket==='undefined')return;
    if(state.ws&&(state.ws.readyState===0||state.ws.readyState===1))return;
    const proto=location.protocol==='https:'?'wss:':'ws:';
    try{
      const ws=new WebSocket(proto+'//'+location.host+'/vision');
      state.ws=ws;
      ws.onopen=()=>{
        ws.send(JSON.stringify({type:'hello',protocol:4,role:'forge-vision-panel'}));
        log('Live control channel connected','ok')
      };
      ws.onerror=()=>log('Live control channel unavailable','warn');
      ws.onclose=()=>{
        state.ws=null;
        for(const [,p] of state.actionWaiters)p.reject(new Error('Vision control channel closed'));
        state.actionWaiters.clear()
      };
      ws.onmessage=e=>{
        let m;try{m=JSON.parse(e.data)}catch{return}
        if(m.type==='vision-frame'||m.type==='vision-status')updateTelemetry(m);
        if(m.type==='vision-hello')updateTelemetry(m.session);
        if(m.type==='session-result'){updateTelemetry(m.session);log(m.ok?'Session command accepted':'Session command failed',m.ok?'ok':'error')}
        if(m.type==='action-result'){
          const waiter=state.actionWaiters.get(m.id);
          if(waiter){state.actionWaiters.delete(m.id);m.ok?waiter.resolve(m):waiter.reject(new Error(m.error||'Vision action failed'))}
          $('#liveVisionSeq').textContent='frame '+Number(m.afterFrame||state.frameSeq||0);
        }
      }
    }catch(e){state.ws=null;log(e.message||String(e),'warn')}
  }
  function sendRemoteAction(action){
    return new Promise((resolve,reject)=>{
      if(!state.ws||state.ws.readyState!==1)return reject(new Error('Live vision control is not connected'));
      const id=crypto.randomUUID();
      state.actionWaiters.set(id,{resolve,reject});
      state.ws.send(JSON.stringify({type:'action',id,action}));
      setTimeout(()=>{
        const w=state.actionWaiters.get(id);
        if(w){state.actionWaiters.delete(id);reject(new Error('Vision action timeout'))}
      },5000);
    })
  }
  function remotePoint(ev){
    const img=$('#liveVisionStream'),r=img.getBoundingClientRect(),v=state.session?.viewport||{width:innerWidth,height:innerHeight};
    const iw=img.naturalWidth||v.width,ih=img.naturalHeight||v.height;
    const scale=Math.min(r.width/Math.max(1,iw),r.height/Math.max(1,ih)),dw=iw*scale,dh=ih*scale,ox=(r.width-dw)/2,oy=(r.height-dh)/2;
    return{
      x:Math.max(0,Math.min(v.width-1,(ev.clientX-r.left-ox)/Math.max(.0001,scale))),
      y:Math.max(0,Math.min(v.height-1,(ev.clientY-r.top-oy)/Math.max(.0001,scale)))
    }
  }
  function bindPreviewControls(){
    if(state.previewBound)return;state.previewBound=true;
    const img=$('#liveVisionStream'),preview=$('#liveVisionPreview');if(!img||!preview)return;
    img.addEventListener('pointerdown',e=>{
      if(!state.remote)return;
      preview.focus();
      const p=remotePoint(e);
      if(e.pointerType==='touch')sendRemoteAction({type:'touch.start',points:[{id:state.touchId,x:p.x,y:p.y,force:1}]}).catch(err=>log(err.message,'error'));
      else sendRemoteAction({type:'mouse.down',button:e.button===2?'right':e.button===1?'middle':'left'}).catch(err=>log(err.message,'error'));
      e.preventDefault()
    });
    img.addEventListener('pointermove',e=>{
      if(!state.remote)return;
      const p=remotePoint(e);
      if(e.pointerType==='touch')sendRemoteAction({type:'touch.move',points:[{id:state.touchId,x:p.x,y:p.y,force:1}]}).catch(()=>{});
      else{
        clearTimeout(state.pendingMove);
        state.pendingMove=setTimeout(()=>sendRemoteAction({type:'mouse.move',x:p.x,y:p.y,steps:1}).catch(()=>{}),16)
      }
      e.preventDefault()
    });
    img.addEventListener('pointerup',e=>{
      if(!state.remote)return;
      const p=remotePoint(e);
      if(e.pointerType==='touch')sendRemoteAction({type:'touch.end'}).catch(err=>log(err.message,'error'));
      else sendRemoteAction({type:'mouse.up',button:e.button===2?'right':e.button===1?'middle':'left'}).catch(err=>log(err.message,'error'));
      e.preventDefault()
    });
    img.addEventListener('wheel',e=>{
      if(!state.remote)return;
      const p=remotePoint(e);
      sendRemoteAction({type:'mouse.move',x:p.x,y:p.y}).catch(()=>{});
      sendRemoteAction({type:'mouse.wheel',deltaX:e.deltaX,deltaY:e.deltaY}).catch(err=>log(err.message,'error'));
      e.preventDefault()
    },{passive:false});
    preview.addEventListener('keydown',e=>{
      if(!state.remote||['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName))return;
      if(e.key===' ')e.preventDefault();
      const modifier=e.ctrlKey?'Control+':e.metaKey?'Meta+':e.shiftKey?'Shift+':e.altKey?'Alt+':'';
      sendRemoteAction({type:'keyboard.press',key:modifier+e.key}).catch(err=>log(err.message,'error'))
    });
    preview.addEventListener('contextmenu',e=>e.preventDefault());
  }

  async function startRemote(){
    connectVisionWs();
    const start=await fetch('./api/vision/session/start',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({target:'/',viewport:{width:1280,height:800},touch:false,mobile:false})
    });
    const result=await start.json();
    if(!start.ok||!result.ok)throw new Error(result.error||'Could not start Live Vision session');
    state.remote=true;state.running=true;state.session=result.session;setMode('remote');
    const img=$('#liveVisionStream');
    img.src='./api/vision/stream?session='+encodeURIComponent(result.session.sessionId||'')+'&t='+Date.now();
    stateText('Live eyes + real input',true);log('Continuous browser screencast started','ok');
    updateTelemetry(result.session)
  }

  async function startLocal(){
    if(!navigator.mediaDevices?.getDisplayMedia)throw new Error('Browser screen capture is unavailable');
    stopLocal();
    const stream=await navigator.mediaDevices.getDisplayMedia({
      video:{frameRate:{ideal:8,max:12},width:{ideal:1280,max:1920},height:{ideal:720,max:1080},displaySurface:'browser'},
      audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'include'
    });
    state.stream=stream;state.running=true;state.remote=false;setMode('local');
    const v=$('#liveVisionVideo');v.srcObject=stream;await v.play();
    stream.getVideoTracks()[0].addEventListener('ended',stopLocal);
    stateText('Local live screen capture',true);log('Local MediaStream capture started','ok');captureLoop()
  }

  async function start(){
    mount();style();
    if(state.running)return;
    try{
      if(serverCapable())await startRemote();
      else await startLocal();
    }catch(e){
      state.remote=false;state.running=false;
      stateText('Vision stopped',false);log(e.message||String(e),'error')
    }
  }
  function stopLocal(){
    state.running=false;cancelAnimationFrame(state.frameTimer);
    if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}
    const v=$('#liveVisionVideo');if(v)v.srcObject=null
  }
  async function stopRemote(){
    try{await fetch('./api/vision/session/stop',{method:'POST'})}catch{}
    state.remote=false;state.session=null;state.running=false;
    const img=$('#liveVisionStream');if(img)img.removeAttribute('src');
  }
  async function stop(){
    if(state.remote)await stopRemote();else stopLocal();
    setMode('remote');stateText(serverCapable()?'Bridge ready':'Standalone mode',false)
  }

  async function executeAction(action){
    if(state.remote){
      return sendRemoteAction(action)
    }
    const F=window.Forge,type=action?.type;
    if(type==='vision'||type==='scene_scan')return F.spatial?.sceneVision?.()||{};
    if(type==='visual_health'||type==='visual_qa')return visualHealth();
    if(type==='select_entity'){
      const r=action.id?F.select(action.id):[...F.entities.values()].find(x=>x.name.toLowerCase()===String(action.name||'').toLowerCase());
      if(!r)throw new Error('Entity not found');
      return F.spatial?.inspect?.(r)||{id:r.id,name:r.name,kind:r.kind}
    }
    if(type==='focus'){F.focus();return true}
    if(type==='frame'){F.frame();return true}
    if(type==='move_screen'){const r=F.selected();if(!r)throw new Error('No selected entity');return F.spatial?.moveToScreen?.(r.id,action.x,action.y,action.depth??.5,action.planeY??0)||false}
    if(type==='transform'){if(action.id)F.select(action.id);F.transform(action);return F.spatial?.inspect?.(F.selected())||null}
    if(type==='click'){const p=action;return executeAction({type:'mouse.click',x:p.x,y:p.y})}
    if(type==='wait'){await sleep(Number(action.ms)||250);return true}
    throw new Error('Unsupported local action '+type)
  }

  function visualHealth(){
    const canvas=document.querySelector('#viewport');
    if(!canvas)return{ok:false,reason:'viewport-missing'};
    let pixels=null,w=Math.min(canvas.width||0,320),h=Math.min(canvas.height||0,180);
    try{
      const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true})||canvas.getContext('webgl',{preserveDrawingBuffer:true});
      if(gl&&w>0&&h>0){
        const sx=Math.max(0,Math.floor(((canvas.width||w)-w)/2)),sy=Math.max(0,Math.floor(((canvas.height||h)-h)/2));
        pixels=new Uint8Array(w*h*4);gl.readPixels(sx,sy,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
      }
    }catch{}
    if(!pixels)return{ok:true,renderer:window.Forge?.diagnostics?.().renderer||'unknown',sampling:'layout-only'};
    let nonDark=0,sum=0,sum2=0,total=w*h;
    for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;sum+=v;sum2+=v*v;if(v>9)nonDark++}
    const mean=sum/Math.max(1,total),variance=sum2/Math.max(1,total)-mean*mean,rect=canvas.getBoundingClientRect();
    return{ok:nonDark/Math.max(1,total)>.02&&variance>4,renderer:window.Forge?.diagnostics?.().renderer||'unknown',nonDarkRatio:nonDark/Math.max(1,total),mean,variance,viewport:{width:rect.width,height:rect.height},overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)}
  }

  async function runAgent(){
    mount();
    const task=$('#liveVisionTask')?.value?.trim();
    if(!task)return log('Enter a task first','error');
    if(state.busy)return;
    state.busy=true;$('#liveVisionAgent').disabled=true;
    try{
      const lower=task.toLowerCase();
      if(state.remote){
        const elRes=await fetch('./api/vision/elements',{cache:'no-store'}).then(r=>r.json());
        const els=elRes.elements||[];
        const box=els.find(e=>e.selector==='[data-add="box"]'&&e.visible);
        if(/create|add|box/.test(lower)&&box){
          const result=await executeAction({type:'mouse.click',x:box.x+box.width/2,y:box.y+box.height/2});
          log('Created Box through live vision input','ok');return result
        }
        if(/undo/.test(lower)){const r=await executeAction({type:'keyboard.press',key:'Control+z'});log('Undo dispatched through live keyboard','ok');return r}
        if(/redo/.test(lower)){const r=await executeAction({type:'keyboard.press',key:'Control+y'});log('Redo dispatched through live keyboard','ok');return r}
        if(/focus/.test(lower)){const r=await executeAction({type:'mouse.click',x:(els.find(e=>e.selector==='#focus')||{}).x||0,y:(els.find(e=>e.selector==='#focus')||{}).y||0});log('Focus action dispatched','ok');return r}
        if(/frame/.test(lower)){const r=await executeAction({type:'mouse.click',x:(els.find(e=>e.selector==='#frame')||{}).x||0,y:(els.find(e=>e.selector==='#frame')?.y||0)});log('Frame action dispatched','ok');return r}
        const stateResult=await fetch('./api/vision/state',{cache:'no-store'}).then(r=>r.json());
        log(JSON.stringify(stateResult),'ok');return stateResult
      }
      if(/scan|inspect|vision|understand/.test(lower))return executeAction({type:'vision'});
      const names=[...window.Forge.entities.values()].map(r=>r.name).filter(Boolean),target=names.find(n=>lower.includes(n.toLowerCase()));
      if(target){
        await executeAction({type:'select_entity',name:target});
        if(/delete|remove|erase/.test(lower)){window.Forge.delete();return{ok:true,action:'delete',entity:target}}
        if(/duplicate|copy|clone/.test(lower)){const d=window.Forge.duplicate();return{ok:true,action:'duplicate',entity:d?.name||target}}
        if(/center|middle/.test(lower)){const r=window.Forge.selected();window.ForgeSpatial?.moveToScreen?.(r.id,innerWidth/2,innerHeight/2,.5,0);return{ok:true,action:'move-center',entity:target}}
        if(/focus/.test(lower)){window.Forge.focus();return{ok:true,action:'focus',entity:target}}
      }
      if(/frame all|frame/.test(lower)){window.Forge.frame();return{ok:true,action:'frame'}}
      if(/focus/.test(lower)){window.Forge.focus();return{ok:true,action:'focus'}}
      throw new Error('Task is not mapped to a deterministic vision action')
    }catch(e){log(e.message||String(e),'error')}finally{state.busy=false;$('#liveVisionAgent').disabled=false}
  }

  function captureLoop(){
    if(!state.running||state.remote||!state.stream)return;
    const v=$('#liveVisionVideo');
    state.captureCanvas ||= document.createElement('canvas');
    state.captureCtx ||= state.captureCanvas.getContext('2d',{willReadFrequently:true});
    const tr=state.stream.getVideoTracks()[0],settings=tr?.getSettings?.()||{},vw=settings.width||v.videoWidth||innerWidth,vh=settings.height||v.videoHeight||innerHeight,scale=Math.min(1,state.captureWidth/vw),cw=Math.max(320,Math.round(vw*scale)),ch=Math.max(180,Math.round(vh*scale));
    state.captureCanvas.width=cw;state.captureCanvas.height=ch;state.captureCtx.drawImage(v,0,0,cw,ch);state.frameSeq++;state.lastFrameAt=Date.now();
    $('#liveVisionFps').textContent='live';$('#liveVisionSeq').textContent='frame '+state.frameSeq;
    state.frameTimer=requestAnimationFrame(captureLoop)
  }

  window.AssetForgeLiveVision={
    open,start,stop,runAgent,executeAction,visualHealth,
    status:()=>({running:state.running,remote:state.remote,connected:state.ws?.readyState===1,session:state.session,lastFrameAt:state.lastFrameAt,frames:state.frameSeq})
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();style()},{once:true});
  else{mount();style()}
})();