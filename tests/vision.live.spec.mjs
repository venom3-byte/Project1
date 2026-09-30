import{test,expect}from"@playwright/test";
import{WebSocket}from"ws";
import{mkdir,writeFile}from"node:fs/promises";

const BASE="http://127.0.0.1:4173";
const FOX="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test.describe.serial("Forge Live Vision — continuous stream + real browser input",()=>{
  test.afterEach(async({request})=>{
    try{await request.post("/api/vision/session/stop",{timeout:5000})}catch{}
  });

  test("continuous frames are pushed over one live WebSocket channel",async({request})=>{
    test.setTimeout(90000);
    await mkdir("vision-proof",{recursive:true});
    const socket=new WebSocket(BASE.replace("http","ws")+"/vision");
    const frames=[];
    const open=new Promise((resolve,reject)=>{
      socket.once("open",resolve);socket.once("error",reject);
    });
    await open;
    socket.on("message",data=>{
      if(!Buffer.isBuffer(data)||data.length<16)return;
      if(data.readUInt32BE(0)!==0x46563337)return;
      frames.push({seq:data.readUInt32BE(4),width:data.readUInt16BE(8),height:data.readUInt16BE(10),bytes:data.length-16});
    });

    const start=await request.post("/api/vision/session/start",{data:{
      target:"/",viewport:{width:1280,height:720},touch:false,mobile:false,streamFps:30
    },timeout:45000});
    expect(start.ok()).toBeTruthy();
    const body=await start.json();
    expect(body.session.running).toBeTruthy();

    await expect.poll(()=>frames.length,{timeout:20000}).toBeGreaterThanOrEqual(5);
    const proof=await request.get("/api/vision/frame");
    expect(proof.ok()).toBeTruthy();
    const proofBytes=await proof.body();
    expect(proofBytes.slice(0,2).toString("hex")).toBe("ffd8");
    await writeFile("vision-proof/vision-live-proof.jpg",proofBytes);
    expect(frames.at(-1).seq).toBeGreaterThan(frames[0].seq);
    expect(frames[0].width).toBeGreaterThan(300);
    expect(frames[0].height).toBeGreaterThan(200);
    expect(frames[0].bytes).toBeGreaterThan(1000);

    const status=await request.get("/api/vision/status");
    const st=await status.json();
    expect(st.vision.transport).toContain("WebSocket control");
    expect(st.vision.streamFps).toBe(30);
    expect(st.vision.streamSubscribers).toBeGreaterThanOrEqual(1);

    socket.close();
  });

  test("mouse, keyboard, drag and touch modify real Forge state",async({request})=>{
    test.setTimeout(120000);
    const start=await request.post("/api/vision/session/start",{data:{
      target:"/",viewport:{width:1440,height:900},touch:true,mobile:true,streamFps:24
    },timeout:45000});
    expect(start.ok()).toBeTruthy();

    const elements=(await (await request.get("/api/vision/elements")).json()).elements;
    const box=elements.find(e=>e.selector==='[data-add="box"]'&&e.visible);
    expect(box).toBeTruthy();

    const click=await request.post("/api/vision/action",{data:{action:{
      type:"mouse.click",x:box.x+box.width/2,y:box.y+box.height/2
    },options:{includeState:true}}});
    const clickBody=await click.json();
    expect(clickBody.ok).toBeTruthy();
    expect(clickBody.result?.action?.dispatched).toBeTruthy();
    expect(clickBody.result?.state?.diagnostics?.entities||0).toBeGreaterThanOrEqual(4);

    const rotate=await request.post("/api/vision/action",{data:{action:{type:"keyboard.press",key:"2"},options:{includeState:true}}});
    expect((await rotate.json()).result.state.gizmoMode).toBe("rotate");

    const slider=(await (await request.get("/api/vision/elements")).json()).elements.find(e=>e.selector==='#time'&&e.visible);
    expect(slider).toBeTruthy();
    const drag=await request.post("/api/vision/action",{data:{action:{
      type:"mouse.drag",from:{x:slider.x+5,y:slider.y+slider.height/2},to:{x:slider.x+Math.max(55,slider.width*0.7),y:slider.y+slider.height/2},steps:16
    }}});
    expect((await drag.json()).result.action.dispatched).toBeTruthy();

    const touchTarget=(await (await request.get("/api/vision/elements")).json()).elements.find(e=>e.selector==='[data-add="sphere"]'&&e.visible);
    expect(touchTarget).toBeTruthy();
    const touched=await request.post("/api/vision/action",{data:{action:{
      type:"touch.swipe",
      from:{x:touchTarget.x+touchTarget.width/2,y:touchTarget.y+touchTarget.height/2},
      to:{x:touchTarget.x+touchTarget.width/2+8,y:touchTarget.y+touchTarget.height/2+8},id:7,steps:6
    }}});
    expect((await touched.json()).result.action.dispatched).toBeTruthy();

    const release=await request.post("/api/vision/action",{data:{action:{type:"releaseAll"}}});
    expect((await release.json()).result.action.released).toBeTruthy();

    const finalState=await (await request.get("/api/vision/state")).json();
    expect(finalState.forgeReady).toBeTruthy();
    expect(finalState.canvasRect).toBeTruthy();

    const open=await request.get("/api/vision/elements");
    const openElements=(await open.json()).elements;
    let drawOpen=openElements.find(e=>e.selector==="#draw2dOpen"&&e.visible);
    expect(drawOpen).toBeTruthy();
    for(let i=0;i<3&&drawOpen.y>850;i++){
      const scroll=await request.post("/api/vision/action",{data:{action:{type:"mouse.wheel",x:110,y:450,deltaY:700}}});
      expect((await scroll.json()).result.action.dispatched).toBeTruthy();
      const refreshed=(await (await request.get("/api/vision/elements")).json()).elements;
      drawOpen=refreshed.find(e=>e.selector==="#draw2dOpen"&&e.visible);
      expect(drawOpen).toBeTruthy();
    }
    expect(drawOpen.y).toBeLessThan(900);
    const clickDraw=await request.post("/api/vision/action",{data:{action:{type:"mouse.click",x:drawOpen.x+drawOpen.width/2,y:drawOpen.y+drawOpen.height/2}}});
    const clickDrawBody=await clickDraw.json();
    expect(clickDrawBody.result.action.target).toMatchObject({id:"draw2dOpen"});
    expect(clickDrawBody.result.action.target.width).toBeGreaterThan(0);
    const drawStatus=await request.post("/api/vision/action",{data:{action:{type:"evaluate",expression:"JSON.stringify({api:!!window.ForgeDraw2D,ready:window.ForgeDraw2D?.status?.().ready||false,open:document.querySelector('#draw2dDialog')?.open||false})"}}});
    const drawStatusBody=await drawStatus.json();
    expect(JSON.parse(drawStatusBody.result.action.value).api).toBeTruthy();
    expect(JSON.parse(drawStatusBody.result.action.value).ready).toBeTruthy();
    expect(JSON.parse(drawStatusBody.result.action.value).open).toBeTruthy();
    expect(clickDrawBody.result.action.dispatched).toBeTruthy();

    await expect.poll(async()=>((await (await request.get("/api/vision/elements")).json()).elements.some(e=>e.selector==="#drawCanvas"&&e.visible)),{timeout:5000}).toBeTruthy();
    const drawingEls=(await (await request.get("/api/vision/elements")).json()).elements;
    const canvas=drawingEls.find(e=>e.selector==="#drawCanvas"&&e.visible);
    const add=drawingEls.find(e=>e.selector==="#drawAddToScene"&&e.visible);
    expect(canvas).toBeTruthy(); expect(add).toBeTruthy();

    const lines=[
      {from:{x:canvas.x+canvas.width*.20,y:canvas.y+canvas.height*.25},to:{x:canvas.x+canvas.width*.80,y:canvas.y+canvas.height*.25}},
      {from:{x:canvas.x+canvas.width*.20,y:canvas.y+canvas.height*.75},to:{x:canvas.x+canvas.width*.80,y:canvas.y+canvas.height*.75}},
      {from:{x:canvas.x+canvas.width*.20,y:canvas.y+canvas.height*.25},to:{x:canvas.x+canvas.width*.20,y:canvas.y+canvas.height*.75}},
      {from:{x:canvas.x+canvas.width*.80,y:canvas.y+canvas.height*.25},to:{x:canvas.x+canvas.width*.80,y:canvas.y+canvas.height*.75}}
    ];
    for(const line of lines){
      const rr=await request.post("/api/vision/action",{data:{action:{type:"mouse.drag",from:line.from,to:line.to,steps:18}}});
      expect((await rr.json()).result.action.dispatched).toBeTruthy();
    }
    const canvasProof=await request.get("/api/vision/frame");
    expect(canvasProof.ok()).toBeTruthy();
    const canvasProofBytes=await canvasProof.body();
    expect(canvasProofBytes.slice(0,2).toString("hex")).toBe("ffd8");
    await writeFile("vision-proof/vision-drawing-canvas-proof.jpg",canvasProofBytes);
    const addResult=await request.post("/api/vision/action",{data:{action:{type:"mouse.click",x:add.x+add.width/2,y:add.y+add.height/2},options:{includeState:true}}});
    const addBody=await addResult.json();
    expect(addBody.ok).toBeTruthy();
    expect(addBody.result.action.target).toMatchObject({id:"drawAddToScene"});
    await expect.poll(async()=>{
      const st=await (await request.get("/api/vision/state")).json();
      return st.selected?.name||"";
    },{timeout:12000}).toBe("forge-drawing.png");
    const importedState=await (await request.get("/api/vision/state")).json();
    expect(importedState.selected?.name).toBe("forge-drawing.png");
    expect(importedState.selected?.kind).toBeTruthy();
    const importedProof=await request.get("/api/vision/frame");
    expect(importedProof.ok()).toBeTruthy();
    await writeFile("vision-proof/vision-imported-asset-proof.jpg",await importedProof.body());

    const data=await request.post("/api/vision/action",{data:{action:{type:"evaluate",expression:"window.ForgeDraw2D?.lastPngDataUrl || null"}}});
    const dataBody=await data.json();
    expect(typeof dataBody.result.action.value).toBe("string");
    const m=/^data:image\/png;base64,(.+)$/.exec(dataBody.result.action.value);
    expect(m).toBeTruthy();
    const pngBytes=Buffer.from(m[1],"base64");
    expect(pngBytes.slice(0,8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(pngBytes.length).toBeGreaterThan(1000);
    await writeFile("vision-proof/vision-drawn-asset.png",pngBytes);
  });

  test("real 3D model is imported and visibly rendered under live Vision control",async({request})=>{
    test.setTimeout(120000);
    await mkdir("vision-proof",{recursive:true});
    const fox=await request.get(FOX,{timeout:30000});
    expect(fox.ok()).toBeTruthy();
    const foxBytes=await fox.body();
    expect(foxBytes.slice(0,4).toString()).toBe("glTF");
    await writeFile("vision-proof/Fox.glb",foxBytes);

    const start=await request.post("/api/vision/session/start",{data:{
      target:"/",viewport:{width:1440,height:900},touch:true,mobile:true,streamFps:30
    },timeout:45000});
    expect(start.ok()).toBeTruthy();

    const controls=await request.post("/api/vision/action",{data:{action:{
      type:"evaluate",
      expression:"JSON.stringify({visible:(()=>{const e=document.querySelector('#forgeMobileControls');return !!e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'})(),buttons:[...document.querySelectorAll('#forgeMobileControls [data-mobile]')].map(x=>x.textContent)})"
    }}}); 
    const controlsState=JSON.parse((await controls.json()).result.action.value);
    expect(controlsState.visible).toBeFalsy();
    const editorChrome=await request.post("/api/vision/action",{data:{action:{
      type:"evaluate",
      expression:"JSON.stringify({floatingTools:!!document.querySelector('.forge-prod'),editorButton:!!document.querySelector('#openEditors')})"
    }}});
    const editorChromeState=JSON.parse((await editorChrome.json()).result.action.value);
    expect(editorChromeState.floatingTools).toBeFalsy();
    expect(editorChromeState.editorButton).toBeTruthy();

    const input=await request.post("/api/vision/action",{data:{action:{
      type:"file.setInputFiles",selector:"#assetInput",paths:["vision-proof/Fox.glb"]
    },options:{includeState:true}}});
    const inputBody=await input.json();
    expect(inputBody.ok).toBeTruthy();

    await expect.poll(async()=>{
      const st=await (await request.get("/api/vision/state")).json();
      return st.selected?.kind||"";
    },{timeout:30000}).toBe("model");

    const imported=await request.post("/api/vision/action",{data:{action:{
      type:"evaluate",
      expression:"JSON.stringify((()=>{const r=window.Forge?.selected?.();const stack=r?.entity?[r.entity]:[];let meshes=0;while(stack.length){const n=stack.pop();meshes+=(n?.render?.meshInstances?.length||0);for(const c of n?.children||[])stack.push(c)}return{name:r?.components?.asset?.name,kind:r?.kind,assetType:r?.components?.asset?.type,meshInstances:meshes,entities:window.Forge?.diagnostics?.()?.entities||0}})())"
    },options:{includeState:true}}});
    const importedBody=await imported.json();
    const importedState=JSON.parse(importedBody.result.action.value);
    expect(importedState.name).toBe("Fox.glb");
    expect(importedState.kind).toBe("model");
    expect(importedState.assetType).toBe("model");
    expect(importedState.meshInstances).toBeGreaterThan(0);
    expect(importedState.entities).toBeGreaterThanOrEqual(4);

    const frame=(await (await request.get("/api/vision/elements")).json()).elements.find(e=>e.selector==="#frame"&&e.visible);
    expect(frame).toBeTruthy();
    const frameClick=await request.post("/api/vision/action",{data:{action:{
      type:"mouse.click",x:frame.x+frame.width/2,y:frame.y+frame.height/2
    }}});
    expect((await frameClick.json()).result.action.target.id).toBe("frame");

    await sleep(700);
    const proof=await request.get("/api/vision/frame");
    expect(proof.ok()).toBeTruthy();
    const bytes=await proof.body();
    expect(bytes.slice(0,2).toString("hex")).toBe("ffd8");
    await writeFile("vision-proof/vision-real-3d-asset-proof.jpg",bytes);
  });

  test("file-input control is available for real asset import workflows",async({request})=>{
    test.setTimeout(90000);
    const start=await request.post("/api/vision/session/start",{data:{target:"/",viewport:{width:1280,height:720},touch:false,mobile:false},timeout:45000});
    expect(start.ok()).toBeTruthy();
    const input=await (await request.get("/api/vision/elements")).json();
    expect(input.elements.some(e=>e.selector==="#assetInput"&&e.visible)).toBeTruthy();
  });
});