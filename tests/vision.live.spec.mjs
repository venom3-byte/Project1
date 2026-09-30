import{test,expect}from"@playwright/test";
import{WebSocket}from"ws";
import{writeFile}from"node:fs/promises";

const BASE="http://127.0.0.1:4173";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test.describe.serial("Forge Live Vision — continuous stream + real browser input",()=>{
  test.afterEach(async({request})=>{
    try{await request.post("/api/vision/session/stop",{timeout:5000})}catch{}
  });

  test("continuous frames are pushed over one live WebSocket channel",async({request})=>{
    test.setTimeout(90000);
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
    await writeFile("test-results/vision-live-proof.jpg",proofBytes);
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
    const drawOpen=openElements.find(e=>e.selector==="#draw2dOpen"&&e.visible);
    expect(drawOpen).toBeTruthy();
    const clickDraw=await request.post("/api/vision/action",{data:{action:{type:"mouse.click",x:drawOpen.x+drawOpen.width/2,y:drawOpen.y+drawOpen.height/2}}});
    const drawStatus=await request.post("/api/vision/action",{data:{action:{type:"evaluate",expression:"JSON.stringify({api:!!window.ForgeDraw2D,ready:window.ForgeDraw2D?.status?.().ready||false,open:document.querySelector('#draw2dDialog')?.open||false})"}}});
    const drawStatusBody=await drawStatus.json();
    expect(JSON.parse(drawStatusBody.result.action.value).api).toBeTruthy();
    expect(JSON.parse(drawStatusBody.result.action.value).ready).toBeTruthy();
    expect(JSON.parse(drawStatusBody.result.action.value).open).toBeTruthy();
    expect((await clickDraw.json()).result.action.dispatched).toBeTruthy();

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
    const addResult=await request.post("/api/vision/action",{data:{action:{type:"mouse.click",x:add.x+add.width/2,y:add.y+add.height/2},options:{includeState:true}}});
    const addBody=await addResult.json();
    expect(addBody.ok).toBeTruthy();
    expect(addBody.result?.state?.selected?.name).toBe("forge-drawing.png");
    expect(addBody.result?.state?.selected?.kind).toBeTruthy();

    const data=await request.post("/api/vision/action",{data:{action:{type:"evaluate",expression:"window.ForgeDraw2D?.lastPngDataUrl || null"}}});
    const dataBody=await data.json();
    expect(typeof dataBody.result.value).toBe("string");
    const m=/^data:image\/png;base64,(.+)$/.exec(dataBody.result.value);
    expect(m).toBeTruthy();
    const pngBytes=Buffer.from(m[1],"base64");
    expect(pngBytes.slice(0,8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(pngBytes.length).toBeGreaterThan(1000);
    await writeFile("test-results/vision-drawn-asset.png",pngBytes);
  });

  test("file-input control is available for real asset import workflows",async({request})=>{
    test.setTimeout(90000);
    const start=await request.post("/api/vision/session/start",{data:{target:"/",viewport:{width:1280,height:720},touch:false,mobile:false},timeout:45000});
    expect(start.ok()).toBeTruthy();
    const input=await (await request.get("/api/vision/elements")).json();
    expect(input.elements.some(e=>e.selector==="#assetInput"&&e.visible)).toBeTruthy();
  });
});