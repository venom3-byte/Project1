import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const FRAME_MAGIC=0x46563337;
const assetRoot=()=>path.resolve(process.env.VISION_ASSET_ROOT||process.cwd());

function clamp(n,min,max){
  const v=Number(n);
  return Number.isFinite(v)?Math.max(min,Math.min(max,v)):min;
}

function normalizeUrl(raw,baseUrl){
  const value=String(raw||baseUrl||'').trim();
  if(!value)return baseUrl;
  const url=new URL(value,baseUrl);
  const base=new URL(baseUrl);
  const localHost=new Set(['127.0.0.1','localhost']);
  const allowed=url.origin===base.origin || (localHost.has(url.hostname)&&localHost.has(base.hostname)&&url.protocol===base.protocol);
  if(!allowed && process.env.VISION_ALLOW_REMOTE!=='1') throw new Error('Vision target must stay on the local Forge origin');
  if(!/^https?:$/.test(url.protocol)) throw new Error('Unsupported vision target protocol');
  return url.href;
}

function buttonValue(value){
  const v=String(value||'left');
  return ['left','right','middle'].includes(v)?v:'left';
}

function keyValue(value){
  const v=String(value||'');
  if(!v)throw new Error('Keyboard action requires key');
  return v;
}

export class VisionController extends EventEmitter{
  constructor({baseUrl='http://127.0.0.1:4173'}={}){
    super();
    this.baseUrl=baseUrl;
    this.browser=null;
    this.context=null;
    this.page=null;
    this.cdp=null;
    this.sessionId=null;
    this.targetUrl=null;
    this.startedAt=0;
    this.lastFrameAt=0;
    this.frameSeq=0;
    this.framesInWindow=0;
    this.fps=0;
    this.latestFrame=null;
    this.latestMeta=null;
    this.streams=new Set();
    this.telemetry=new Set();
    this.lastActionAt=0;
    this.errors=[];
    this.frameTimer=null;
    this.streamFps=30;
    this.lastStreamFrameAt=0;
    this.frameDrops=0;
    this.inputState={mouseButtons:new Set(),keys:new Set(),touchIds:new Set()};
    this.starting=null;
  }

  async start(options={}){
    if(this.starting)return this.starting;
    const run=async()=>{
      const viewport={
        width:clamp(options.viewport?.width??1440,320,2560),
        height:clamp(options.viewport?.height??900,240,1800)
      };
      const touch=!!options.touch;
      const mobile=!!options.mobile;
      const target=normalizeUrl(options.url||options.target||this.baseUrl+'/',this.baseUrl);
      this.streamFps=clamp(options.streamFps??30,5,60);

      if(this.page && this.targetUrl===target &&
         this.page.isClosed?.()===false) return this.status();

      await this.stop();

    let chromium;
    try{
      ({chromium}=await import('@playwright/test'));
    }catch(error){
      throw new Error('Playwright runtime is unavailable; run npm install before starting Live Vision: '+error.message);
    }

    this.sessionId=randomUUID();
    this.targetUrl=target;
    this.startedAt=Date.now();
    this.errors=[];

    this.browser=await chromium.launch({
      headless:process.env.VISION_HEADLESS!=='false',
      args:[
        '--disable-dev-shm-usage',
        ...(process.env.VISION_CHROMIUM_ARGS ? String(process.env.VISION_CHROMIUM_ARGS).split(/\s+/).filter(Boolean) : [])
      ]
    });

    this.context=await this.browser.newContext({
      viewport,
      screen:viewport,
      deviceScaleFactor:1,
      hasTouch:touch,
      isMobile:mobile,
      locale:'en-US',
      colorScheme:'dark'
    });
    this.page=await this.context.newPage();
    this.cdp=await this.context.newCDPSession(this.page);

    this.page.on('pageerror',error=>this.recordError('pageerror: '+String(error?.message||error)));
    this.page.on('console',message=>{
      if(message.type()==='error') this.recordError('console: '+message.text());
    });

    await this.page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
    await this.page.waitForTimeout(50);
    await this.page.screencast.start({
      quality:72,
      size:viewport,
      onFrame:frame=>this.acceptFrame(frame)
    });
    try{
      await this.page.waitForFunction(()=>window.ForgeReady===true,{timeout:15000});
    }catch{
      // A live visual session is useful even while an application is still booting.
    }
    await this.page.waitForTimeout(250);
      this.emit('started',this.status());
      this.emitTelemetry();
      return this.status();
    };
    this.starting=run();
    try{return await this.starting}
    finally{this.starting=null}
  }

  recordError(message){
    this.errors.unshift(String(message));
    this.errors=this.errors.slice(0,20);
  }

  acceptFrame(frame){
    const data=Buffer.from(frame.data);
    const now=Date.now();
    if(!this.page || this.page.isClosed?.()) return;
    this.frameSeq+=1;
    this.latestFrame=data;
    this.latestMeta={
      seq:this.frameSeq,
      timestamp:Number(frame.timestamp||now),
      serverTime:now,
      width:Number(frame.viewportWidth||this.page?.viewportSize?.()?.width||0),
      height:Number(frame.viewportHeight||this.page?.viewportSize?.()?.height||0),
      bytes:data.length
    };
    this.lastFrameAt=now;
    this.framesInWindow+=1;

    if(!this.frameTimer){
      this.frameTimer=setTimeout(()=>{
        this.fps=this.framesInWindow;
        this.framesInWindow=0;
        this.frameTimer=null;
        this.emit('telemetry',this.status());
        this.emitTelemetry();
      },1000);
    }

    for(const res of [...this.streams]){
      try{
        if(res.destroyed){this.streams.delete(res);continue;}
        this.writeFrame(res,data,this.frameSeq,this.latestMeta);
      }catch{this.streams.delete(res)}
    }
    const interval=1000/this.streamFps;
    if(now-this.lastStreamFrameAt>=interval){
      this.lastStreamFrameAt=now;
      this.broadcastFrame(data,this.frameSeq,this.latestMeta);
    }
  }

  broadcastFrame(data,seq,meta){
    const header=Buffer.alloc(16);
    header.writeUInt32BE(FRAME_MAGIC,0);
    header.writeUInt32BE(Number(seq)||0,4);
    header.writeUInt16BE(Number(meta.width)||0,8);
    header.writeUInt16BE(Number(meta.height)||0,10);
    header.writeUInt32BE(Math.floor((Number(meta.serverTime)||Date.now())/1000),12);
    const packet=Buffer.concat([header,data]);
    for(const ws of [...this.telemetry]){
      try{
        if(ws.readyState!==1){this.telemetry.delete(ws);continue;}
        if(Number(ws.bufferedAmount||0)>2*1024*1024){this.frameDrops+=1;continue;}
        ws.send(packet);
      }catch{this.telemetry.delete(ws)}
    }
  }

  emitTelemetry(){
    const payload=JSON.stringify({type:'vision-status',...this.status()});
    for(const ws of [...this.telemetry]){
      try{
        if(ws.readyState===1) ws.send(payload);
        else this.telemetry.delete(ws);
      }catch{this.telemetry.delete(ws)}
    }
  }

  addTelemetryClient(ws){
    this.telemetry.add(ws);
    try{
      if(ws.readyState===1)ws.send(JSON.stringify({type:'vision-status',...this.status()}));
    }catch{}
  }

  removeTelemetryClient(ws){
    this.telemetry.delete(ws);
  }

  writeFrame(res,data,seq,meta){
    const header=
      '--forge-frame\r\n'+
      'Content-Type: image/jpeg\r\n'+
      'Content-Length: '+data.length+'\r\n'+
      'X-Forge-Vision-Seq: '+seq+'\r\n'+
      'X-Forge-Vision-Width: '+meta.width+'\r\n'+
      'X-Forge-Vision-Height: '+meta.height+'\r\n\r\n';
    res.write(header);
    res.write(data);
    res.write('\r\n');
  }

  stream(req,res){
    if(!this.page || !this.latestFrame){
      res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      res.end('Live Vision session is not running');
      return;
    }
    res.writeHead(200,{
      'Content-Type':'multipart/x-mixed-replace; boundary=forge-frame',
      'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma':'no-cache',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    });
    this.streams.add(res);
    res.on('close',()=>this.streams.delete(res));
    try{this.writeFrame(res,this.latestFrame,this.frameSeq,this.latestMeta)}catch{this.streams.delete(res)}
  }

  async stop(){
    try{await this.releaseAll()}catch{}
    for(const res of this.streams){try{res.end()}catch{}}
    this.streams.clear();
    if(this.frameTimer){clearTimeout(this.frameTimer);this.frameTimer=null}
    if(this.page){
      try{await this.page.screencast.stop()}catch{}
    }
    if(this.context){try{await this.context.close()}catch{}}
    if(this.browser){try{await this.browser.close()}catch{}}
    this.browser=null;
    this.context=null;
    this.page=null;
    this.cdp=null;
    this.latestFrame=null;
    this.latestMeta=null;
    this.targetUrl=null;
    this.lastFrameAt=0;
    this.frameSeq=0;
    this.fps=0;
    this.framesInWindow=0;
    this.lastStreamFrameAt=0;
    this.inputState={mouseButtons:new Set(),keys:new Set(),touchIds:new Set()};
  }

  status(){
    const page=this.page;
    const viewport=page?.viewportSize?.()||null;
    return{
      ok:!!page&&!page.isClosed?.(),
      sessionId:this.sessionId,
      running:!!page&&!page.isClosed?.(),
      targetUrl:this.targetUrl,
      startedAt:this.startedAt,
      frameSeq:this.frameSeq,
      lastFrameAt:this.lastFrameAt,
      ageMs:this.lastFrameAt?Date.now()-this.lastFrameAt:null,
      fps:this.fps,
      viewport,
      frame:this.latestMeta?{...this.latestMeta}:null,
      errors:[...this.errors],
      controls:['mouse','keyboard','touch','wheel','drag','focus','file.setInputFiles','releaseAll'],
      transport:'Playwright Screencast + WebSocket control',
      control:'real-browser-input',
      streamFps:this.streamFps,
      streamSubscribers:this.telemetry.size,
      frameDrops:this.frameDrops,
      input:{
        mouseButtons:[...this.inputState.mouseButtons],
        keys:[...this.inputState.keys],
        touchIds:[...this.inputState.touchIds]
      }
    };
  }

  async waitForFrame(afterSeq,timeout=2000){
    if(this.frameSeq>afterSeq)return this.latestMeta;
    const started=Date.now();
    while(Date.now()-started<timeout){
      if(!this.page||this.page.isClosed())throw new Error('Vision session closed');
      if(this.frameSeq>afterSeq)return this.latestMeta;
      await sleep(20);
    }
    return this.latestMeta;
  }

  async state(){
    if(!this.page||this.page.isClosed())throw new Error('Vision session is not running');
    return this.page.evaluate(()=>{
      const F=window.Forge;
      const selected=F?.selected?.();
      const diag=F?.diagnostics?.()||null;
      let selectedScreenRect=null;
      if(selected&&window.ForgeSpatial?.screenRect){
        try{selectedScreenRect=window.ForgeSpatial.screenRect(selected)}catch{}
      }
      const canvasRect=document.querySelector('#viewport')?.getBoundingClientRect?.()?.toJSON?.()||null;
      const activeGizmo=document.querySelector('[data-gizmo].active')?.dataset?.gizmo||window.ForgeGizmo?.state?.mode||null;
      const gizmoSpace=document.querySelector('#spaceToggle')?.textContent?.trim().toLowerCase()||window.ForgeGizmo?.state?.space||null;
      return{
        forgeReady:window.ForgeReady===true,
        bootState:window.ForgeBootState||null,
        selected:selected?{id:selected.id,name:selected.name,kind:selected.kind}:null,
        gizmoMode:activeGizmo,
        gizmoSpace,
        selectedScreenRect,
        canvasRect,
        diagnostics:diag,
        url:location.href,
        viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1}
      };
    });
  }

  async elements(requestedSelectors=[]){
    if(!this.page||this.page.isClosed())throw new Error('Vision session is not running');
    const defaults=[
      '[data-add="box"]','[data-add="sphere"]','[data-add="cylinder"]',
      '#assetInput','#importAssets','#play','#build','#openProject','#saveProject',
      '#focus','#frame','#duplicate','#delete','#viewport','.viewport',
      '#visionOpen','#selected','#sceneCount','#time','#draw2dOpen','#drawCanvas','#drawAddToScene','#drawClear','#drawUndo','#drawRedo','.topbar','.leftpanel','.rightpanel'
    ];
    const selectors=[...new Set(
      [...(Array.isArray(requestedSelectors)?requestedSelectors:[]),...defaults]
        .map(s=>String(s||'').trim()).filter(Boolean).slice(0,64)
    )];
    return this.page.evaluate(selectors=>({
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1},
      elements:selectors.map(selector=>{
        const el=document.querySelector(selector);
        if(!el)return null;
        const r=el.getBoundingClientRect();
        const s=getComputedStyle(el);
        return{
          selector,
          tag:el.tagName,
          id:el.id||null,
          text:(el.textContent||'').trim().slice(0,120),
          x:r.x,y:r.y,width:r.width,height:r.height,
          visible:r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none',
          disabled:!!el.disabled
        };
      }).filter(Boolean)
    }),selectors);
  }

  async touchEvent(type,points=[],modifiers=0){
    if(!this.cdp)throw new Error('Touch CDP session unavailable');
    const touchPoints=points.map(p=>({
      x:Number(p.x)||0,
      y:Number(p.y)||0,
      radiusX:Number(p.radiusX)||1,
      radiusY:Number(p.radiusY)||1,
      rotationAngle:Number(p.rotationAngle)||0,
      force:Number(p.force??1),
      id:Number(p.id??0)
    }));
    await this.cdp.send('Input.dispatchTouchEvent',{
      type,
      touchPoints:type==='touchEnd'||type==='touchCancel'?[]:touchPoints,
      modifiers:Number(modifiers)||0
    });
    if(type==='touchStart'||type==='touchMove')for(const p of touchPoints)this.inputState.touchIds.add(p.id);
    if(type==='touchEnd'||type==='touchCancel')this.inputState.touchIds.clear();
    return{dispatched:true,type,touchPoints};
  }

  async releaseAll(){
    if(!this.page||this.page.isClosed?.())return{released:true,mouseButtons:0,keys:0,touches:0};
    const mouseButtons=[...this.inputState.mouseButtons];
    const keys=[...this.inputState.keys];
    const touchCount=this.inputState.touchIds.size;
    for(const button of mouseButtons){try{await this.page.mouse.up({button})}catch{}}
    for(const key of keys){try{await this.page.keyboard.up(key)}catch{}}
    if(this.cdp&&touchCount){try{await this.touchEvent('touchCancel',[],0)}catch{}}
    this.inputState={mouseButtons:new Set(),keys:new Set(),touchIds:new Set()};
    return{released:true,mouseButtons:mouseButtons.length,keys:keys.length,touches:touchCount};
  }

  async perform(action){
    if(!this.page||this.page.isClosed())throw new Error('Vision session is not running');
    const type=String(action?.type||'');
    this.lastActionAt=Date.now();

    switch(type){
      case 'mouse.move':
      case 'mouse.hover':{
        const x=Number(action.x)||0,y=Number(action.y)||0;
        await this.page.mouse.move(x,y,{steps:Math.max(1,Number(action.steps)||1)});
        return{dispatched:true,type,x,y};
      }
      case 'mouse.down':{
        const button=buttonValue(action.button);
        await this.page.mouse.down({button});
        this.inputState.mouseButtons.add(button);
        return{dispatched:true,type,button};
      }
      case 'mouse.up':{
        const button=buttonValue(action.button);
        await this.page.mouse.up({button});
        this.inputState.mouseButtons.delete(button);
        return{dispatched:true,type,button};
      }
      case 'mouse.click':{
        const x=Number(action.x)||0,y=Number(action.y)||0,button=buttonValue(action.button);
        await this.page.mouse.click(x,y,{button,clickCount:Math.max(1,Math.min(3,Number(action.clickCount)||1)),delay:Math.max(0,Number(action.delay)||0)});
        return{dispatched:true,type,x,y,button};
      }
      case 'mouse.dblclick':{
        const x=Number(action.x)||0,y=Number(action.y)||0,button=buttonValue(action.button);
        await this.page.mouse.dblclick(x,y,{button,delay:Math.max(0,Number(action.delay)||0)});
        return{dispatched:true,type,x,y,button};
      }
      case 'mouse.wheel':
        await this.page.mouse.wheel(Number(action.deltaX)||0,Number(action.deltaY)||0);
        return{dispatched:true,type,deltaX:Number(action.deltaX)||0,deltaY:Number(action.deltaY)||0};
      case 'mouse.drag':{
        const from=action.from||{},to=action.to||{},button=buttonValue(action.button);
        await this.page.mouse.move(Number(from.x)||0,Number(from.y)||0);
        await this.page.mouse.down({button});
        this.inputState.mouseButtons.add(button);
        await this.page.mouse.move(Number(to.x)||0,Number(to.y)||0,{steps:Math.max(2,Math.min(120,Number(action.steps)||12))});
        await this.page.mouse.up({button});
        this.inputState.mouseButtons.delete(button);
        return{dispatched:true,type,from,to,steps:Math.max(2,Math.min(120,Number(action.steps)||12))};
      }
      case 'keyboard.down':{
        const key=keyValue(action.key);
        await this.page.keyboard.down(key);
        this.inputState.keys.add(key);
        return{dispatched:true,type,key};
      }
      case 'keyboard.up':{
        const key=keyValue(action.key);
        await this.page.keyboard.up(key);
        this.inputState.keys.delete(key);
        return{dispatched:true,type,key};
      }
      case 'keyboard.press':{
        const key=keyValue(action.key);
        await this.page.keyboard.press(key,{delay:Math.max(0,Number(action.delay)||0)});
        return{dispatched:true,type,key};
      }
      case 'keyboard.type':{
        const text=String(action.text??'');
        await this.page.keyboard.type(text,{delay:Math.max(0,Number(action.delay)||0)});
        return{dispatched:true,type,length:text.length};
      }
      case 'keyboard.insertText':{
        const text=String(action.text??'');
        await this.page.keyboard.insertText(text);
        return{dispatched:true,type,length:text.length};
      }
      case 'touch.tap':
        await this.page.touchscreen.tap(Number(action.x)||0,Number(action.y)||0);
        return{dispatched:true,type,x:Number(action.x)||0,y:Number(action.y)||0};
      case 'touch.tapSelector':
        if(!action.selector)throw new Error('touch.tapSelector requires selector');
        await this.page.locator(String(action.selector)).tap({timeout:10000});
        return{dispatched:true,type,selector:String(action.selector)};
      case 'touch.start':
        return this.touchEvent('touchStart',action.points||[],action.modifiers||0);
      case 'touch.move':
        return this.touchEvent('touchMove',action.points||[],action.modifiers||0);
      case 'touch.end':
        return this.touchEvent('touchEnd',[],action.modifiers||0);
      case 'touch.cancel':
        return this.touchEvent('touchCancel',[],action.modifiers||0);
      case 'touch.swipe':{
        const from=action.from||{},to=action.to||{};
        const id=Number(action.id??0);
        const steps=Math.max(2,Math.min(120,Number(action.steps)||12));
        await this.touchEvent('touchStart',[{id,x:Number(from.x)||0,y:Number(from.y)||0,force:1}],action.modifiers||0);
        for(let i=1;i<=steps;i++){
          const t=i/steps;
          await this.touchEvent('touchMove',[{id,x:(Number(from.x)||0)+(Number(to.x||0)-Number(from.x||0))*t,y:(Number(from.y)||0)+(Number(to.y||0)-Number(from.y||0))*t,force:1}],action.modifiers||0);
          await sleep(Math.max(0,Number(action.stepDelay)||8));
        }
        await this.touchEvent('touchEnd',[],action.modifiers||0);
        return{dispatched:true,type,from,to,steps};
      }
      case 'file.setInputFiles':{
        const selector=String(action.selector||'');
        if(!selector)throw new Error('file.setInputFiles requires selector');
        const raw=action.clear?[]:(Array.isArray(action.paths)?action.paths:[action.path]).filter(Boolean);
        const root=assetRoot();
        const resolved=raw.map(item=>{
          const full=path.resolve(root,String(item));
          if(full!==root&&!full.startsWith(root+path.sep))throw new Error('Asset path escapes VISION_ASSET_ROOT');
          return full;
        });
        await this.page.locator(selector).setInputFiles(resolved);
        return{dispatched:true,type,selector,files:resolved.length};
      }
      case 'releaseAll':
        return this.releaseAll();
      case 'focus':
        await this.page.bringToFront();
        return{dispatched:true,type};
      case 'evaluate':{
        const expression=String(action.expression||'');
        if(!expression)throw new Error('evaluate requires expression');
        const value=await this.page.evaluate(expression);
        return{dispatched:true,type,value};
      }
      default:
        throw new Error('Unsupported vision action type: '+type);
    }
  }

  async action(action,{waitForFrameMs=1500,includeState=false}={}){
    const before=this.frameSeq;
    const result=await this.perform(action);
    const after=await this.waitForFrame(before,waitForFrameMs);
    return{
      ok:true,
      action:result,
      beforeFrame:before,
      afterFrame:this.frameSeq,
      frameAdvanced:this.frameSeq>before,
      frame:after?{...after}:null,
      ageMs:this.lastFrameAt?Date.now()-this.lastFrameAt:null,
      inputAcceptedAt:Date.now(),
      state:includeState?await this.state():undefined
    };
  }
}

export function installVisionShutdown(controller){
  const stop=()=>controller.stop().catch(()=>{});
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
  return()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop)};
}
