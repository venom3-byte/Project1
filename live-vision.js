(() => {
  const $=(s,r=document)=>r.querySelector(s);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const state={ws:null,stream:null,running:false,busy:false,frameSeq:0,lastFrameAt:0,frameTimer:0,captureCanvas:null,captureCtx:null,captureWidth:960,captureHeight:540};
  const serverCapable=()=>location.protocol!=='file:' && !/github\.io$/i.test(location.hostname);
  function style(){if($('#liveVisionStyle'))return;const l=document.createElement('link');l.id='liveVisionStyle';l.rel='stylesheet';l.href='./live-vision.css?v=2';document.head.appendChild(l)}
  function mount(){if($('#liveVision'))return;const el=document.createElement('section');el.id='liveVision';el.className='live-vision';el.innerHTML='<div class="live-vision-head"><div><strong>FORGE VISION</strong><small>Eyes + Hands · Spatial Core</small></div><button id="liveVisionClose">×</button></div><div class="live-vision-status"><span id="liveVisionDot" class="live-dot"></span><span id="liveVisionState">Local spatial mode</span><span id="liveVisionFps">0 fps</span></div><div class="live-vision-preview"><video id="liveVisionVideo" autoplay muted playsinline></video><canvas id="liveVisionOverlay"></canvas><div id="liveVisionCrosshair"></div></div><div class="live-vision-actions"><button id="liveVisionStart" class="primary">Start eyes</button><button id="liveVisionStop">Stop</button><button id="liveVisionAgent">Run local agent</button></div><label class="live-vision-field">Task <textarea id="liveVisionTask" rows="2" placeholder="Example: select Car then move it to the center"></textarea></label><div class="live-vision-log" id="liveVisionLog"></div><div class="live-vision-foot">Spatial mode works without a server. Server mode additionally streams frames over WebSocket.</div>';document.body.appendChild(el);$('#liveVisionClose').onclick=()=>$('#liveVision').classList.remove('open');$('#liveVisionStart').onclick=start;$('#liveVisionStop').onclick=stop;$('#liveVisionAgent').onclick=runAgent}
  function open(){mount();style();$('#liveVision').classList.add('open');connectWs()}
  function log(t,c=''){const b=$('#liveVisionLog');if(!b)return;const r=document.createElement('div');r.className='live-log-row '+c;r.textContent=new Date().toLocaleTimeString()+'  '+t;b.prepend(r);while(b.children.length>20)b.lastElementChild.remove()}
  function stateText(t,on=state.running){const s=$('#liveVisionState'),d=$('#liveVisionDot');if(s)s.textContent=t;if(d)d.classList.toggle('live-on',!!on)}
  function connectWs(){
    if(!serverCapable()||typeof WebSocket==='undefined'){
      stateText('Standalone spatial mode',true); return;
    }
    if(state.ws&&(state.ws.readyState===0||state.ws.readyState===1))return;
    try{
      const proto=location.protocol==='https:'?'wss:':'ws:';
      const ws=new WebSocket(proto+'//'+location.host+'/live');
      state.ws=ws;
      ws.onopen=()=>{
        ws.send(JSON.stringify({type:'hello',role:'vision-client',protocol:3,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1}}));
        stateText('Server bridge connected',state.running);
        log('WebSocket bridge connected','ok');
      };
      ws.onerror=()=>log('Server bridge unavailable — using local spatial mode','warn');
      ws.onclose=()=>{state.ws=null;if(state.running)stateText('Local eyes active',true)};
      ws.onmessage=async e=>{
        let m;
        try{m=JSON.parse(e.data)}catch{return}
        if(m.type!=='action')return;
        try{
          const result=await executeAction(m.action||{});
          ws.send(JSON.stringify({type:'action-result',id:m.id||null,ok:true,result}));
        }catch(err){
          ws.send(JSON.stringify({type:'action-result',id:m.id||null,ok:false,error:err.message||String(err)}));
        }
      };
    }catch(e){
      state.ws=null;stateText('Standalone spatial mode',true);
    }
  }
  function normalize(x,y,w,h){return{x:Math.max(0,Math.min(innerWidth-1,(Number(x)||0)*innerWidth/Math.max(1,w||innerWidth))),y:Math.max(0,Math.min(innerHeight-1,(Number(y)||0)*innerHeight/Math.max(1,h||innerHeight)))}}
  function pointer(type,x,y){const el=document.elementFromPoint(x,y)||document.body;const init={bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,pointerId:7,pointerType:'mouse',isPrimary:true};el.dispatchEvent(new PointerEvent(type,init));return{tag:el.tagName||'',id:el.id||''}}
  function visualHealth(){
    const canvas=document.querySelector("#viewport");if(!canvas)return{ok:false,reason:"viewport-missing"};
    let pixels=null,w=Math.min(canvas.width||0,320),h=Math.min(canvas.height||0,180);
    try{
      const gl=canvas.getContext("webgl2",{preserveDrawingBuffer:true})||canvas.getContext("webgl",{preserveDrawingBuffer:true});
      if(gl&&w>0&&h>0){
        const sx=Math.max(0,Math.floor(((canvas.width||w)-w)/2)),sy=Math.max(0,Math.floor(((canvas.height||h)-h)/2));
        pixels=new Uint8Array(w*h*4);gl.readPixels(sx,sy,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      }
    }catch{}
    if(!pixels)return{ok:true,renderer:window.Forge?.diagnostics?.().renderer||"unknown",sampling:"layout-only"};
    let nonDark=0,sum=0,sum2=0,total=w*h;
    for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;sum+=v;sum2+=v*v;if(v>9)nonDark++}
    const mean=sum/Math.max(1,total),variance=sum2/Math.max(1,total)-mean*mean,rect=canvas.getBoundingClientRect();
    return{ok:nonDark/Math.max(1,total)>.02&&variance>4,renderer:window.Forge?.diagnostics?.().renderer||"unknown",nonDarkRatio:nonDark/Math.max(1,total),mean,variance,viewport:{width:rect.width,height:rect.height},overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
  }
  async function executeAction(a){const F=window.Forge,type=a.type;if(type==='vision'||type==='scene_scan')return F.spatial?.sceneVision?.()||{};if(type==='visual_health'||type==='visual_qa')return visualHealth();if(type==='select_entity'){const r=a.id?F.select(a.id):[...F.entities.values()].find(x=>x.name.toLowerCase()===String(a.name||'').toLowerCase());if(!r)throw new Error('Entity not found');return F.spatial?.inspect?.(r)||{id:r.id,name:r.name,kind:r.kind}}if(type==='focus'){F.focus();return true}if(type==='frame'){F.frame();return true}if(type==='move_screen'){const r=F.selected();if(!r)throw new Error('No selected entity');return F.spatial?.moveToScreen?.(r.id,a.x,a.y,a.depth??.5,a.planeY??0)||false}if(type==='transform'){if(a.id)F.select(a.id);F.transform(a);return F.spatial?.inspect?.(F.selected())||null}if(type==='click'){const p=normalize(a.x,a.y,a.screenWidth,a.screenHeight);return pointer('pointerup',p.x,p.y)}if(type==='wait'){await sleep(Number(a.ms)||250);return true}throw new Error('Unsupported local action '+type)}
  async function localAgent(task){const F=window.Forge,s=String(task||'').trim(),lower=s.toLowerCase();if(/scan|inspect|vision|understand/.test(lower))return executeAction({type:'vision'});const names=[...F.entities.values()].map(r=>r.name).filter(Boolean),target=names.find(n=>lower.includes(n.toLowerCase()));if(target){await executeAction({type:'select_entity',name:target});if(/delete|remove|erase/.test(lower)){F.delete();return{ok:true,action:'delete',entity:target}}if(/duplicate|copy|clone/.test(lower)){const d=F.duplicate();return{ok:true,action:'duplicate',entity:d?.name||target}}if(/center|middle/.test(lower)){F.spatial?.moveToScreen?.(F.selectedId,innerWidth/2,innerHeight/2,.5,0);return{ok:true,action:'move-center',entity:target}}if(/focus/.test(lower)){F.focus();return{ok:true,action:'focus',entity:target}}}if(/frame all|frame/.test(lower)){F.frame();return{ok:true,action:'frame'}}if(/focus/.test(lower)){F.focus();return{ok:true,action:'focus'}}throw new Error('Local agent could not map the task to a deterministic Forge action. Try: select <name>, move <name> to center, focus, frame, duplicate or delete.')}
  async function runAgent(){mount();const task=$('#liveVisionTask')?.value?.trim();if(!task)return log('Enter a task first','error');if(state.busy)return;state.busy=true;$('#liveVisionAgent').disabled=true;try{const result=serverCapable()&&state.ws?.readyState===1?await fetch('./api/forge/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:{op:'agent-task',task}})}).then(r=>r.json()):await localAgent(task);log(JSON.stringify(result),'ok')}catch(e){log(e.message||String(e),'error')}finally{state.busy=false;$('#liveVisionAgent').disabled=false}}
  async function start(){mount();style();if(!navigator.mediaDevices?.getDisplayMedia){stateText('Spatial vision only',true);log('Browser screen capture is unavailable; spatial vision remains fully usable','warn');return}try{stop();const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:6,max:10},width:{ideal:1280,max:1920},height:{ideal:720,max:1080},displaySurface:'browser'},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'include'});state.stream=stream;state.running=true;const v=$('#liveVisionVideo');v.srcObject=stream;await v.play();stream.getVideoTracks()[0].addEventListener('ended',stop);connectWs();stateText(serverCapable()?'Live eyes + server':'Live eyes + local spatial',true);captureLoop()}catch(e){state.running=false;state.stream=null;stateText('Spatial vision only',true);log(e.message||String(e),'warn')}}
  function stop(){state.running=false;cancelAnimationFrame(state.frameTimer);if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}const v=$('#liveVisionVideo');if(v)v.srcObject=null;stateText(serverCapable()?'Bridge ready':'Standalone spatial mode',false)}
  async function captureLoop(){if(!state.running||!state.stream)return;const v=$('#liveVisionVideo');state.captureCanvas ||= document.createElement('canvas');state.captureCtx ||= state.captureCanvas.getContext('2d',{willReadFrequently:true});const tr=state.stream.getVideoTracks()[0],set=tr?.getSettings?.()||{},vw=set.width||v.videoWidth||innerWidth,vh=set.height||v.videoHeight||innerHeight,scale=Math.min(1,state.captureWidth/vw),cw=Math.max(320,Math.round(vw*scale)),ch=Math.max(180,Math.round(vh*scale));state.captureCanvas.width=cw;state.captureCanvas.height=ch;state.captureCtx.drawImage(v,0,0,cw,ch);state.frameSeq++;state.lastFrameAt=Date.now();$('#liveVisionFps').textContent='6 fps';if(state.ws?.readyState===1)state.ws.send(JSON.stringify({type:'frame',seq:state.frameSeq,createdAt:Date.now(),image:state.captureCanvas.toDataURL('image/jpeg',.6),screenWidth:innerWidth,screenHeight:innerHeight,width:cw,height:ch,dpr:devicePixelRatio||1}));state.frameTimer=requestAnimationFrame(captureLoop)}
  window.AssetForgeLiveVision={open,start,stop,runAgent,executeAction,visualHealth,status:()=>({running:state.running,connected:state.ws?.readyState===1,standalone:!serverCapable(),lastFrameAt:state.lastFrameAt,frames:state.frameSeq})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();style()},{once:true});else{mount();style()}
})();