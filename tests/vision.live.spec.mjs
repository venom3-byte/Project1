import{test,expect}from"@playwright/test";

const BASE="http://127.0.0.1:4173";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function stopVision(request){
  try{await request.post("/api/vision/session/stop",{timeout:5000})}catch{}
}

async function startVision(request,options={}){
  await stopVision(request);
  const r=await request.post("/api/vision/session/start",{
    data:{target:"/",viewport:{width:1440,height:900},touch:false,mobile:false,...options},
    timeout:45000
  });
  expect(r.ok()).toBeTruthy();
  const body=await r.json();
  expect(body.ok).toBeTruthy();
  expect(body.session.running).toBeTruthy();
  await expect.poll(async()=>((await request.get("/api/vision/status")).json()).then(j=>j.vision.frameSeq),{timeout:20000}).toBeGreaterThan(3);
  return body.session;
}

async function getJson(request,path){
  const r=await request.get(path,{cache:"no-store"});
  expect(r.ok()).toBeTruthy();
  return r.json();
}

test.describe.serial("Forge Live Vision — real continuous vision + input",()=>{
  test.afterEach(async({request})=>{await stopVision(request)});

  test("publishes a continuous screencast stream rather than one-shot screenshots",async({page,request})=>{
    test.setTimeout(60000);
    const initial=await startVision(request);
    await sleep(1200);
    const later=await getJson(request,"/api/vision/status");
    expect(later.vision.frameSeq).toBeGreaterThan(initial.frameSeq);
    expect(later.vision.frame?.bytes).toBeGreaterThan(1000);
    expect(later.vision.lastFrameAt).toBeGreaterThan(0);
    expect(later.vision.transport).toContain("Playwright Screencast");

    const controller=new AbortController();
    const res=await fetch(BASE+"/api/vision/stream?proof="+Date.now(),{signal:controller.signal});
    expect(res.ok).toBeTruthy();
    expect(res.headers.get("content-type")).toContain("multipart/x-mixed-replace");
    const reader=res.body.getReader();
    let payload="";
    for(let i=0;i<4&&payload.length<4000;i++){
      const part=await reader.read();
      if(part.done)break;
      payload+=new TextDecoder().decode(part.value);
    }
    controller.abort();
    expect(payload).toContain("--forge-frame");
    expect(payload).toContain("Content-Type: image/jpeg");

  });

  test("drives Forge through real pointer coordinates and verifies the resulting engine state",async({request})=>{
    test.setTimeout(90000);
    await startVision(request);
    const elements=await getJson(request,"/api/vision/elements");
    const box=elements.elements.find(e=>e.selector==='[data-add="box"]'&&e.visible);
    expect(box).toBeTruthy();

    const x=box.x+box.width/2,y=box.y+box.height/2;
    const down=await request.post("/api/vision/action",{data:{action:{type:"mouse.move",x,y,steps:4}}});
    expect((await down.json()).ok).toBeTruthy();
    const press=await request.post("/api/vision/action",{data:{action:{type:"mouse.down",button:"left"}}});
    expect((await press.json()).ok).toBeTruthy();
    const release=await request.post("/api/vision/action",{data:{action:{type:"mouse.up",button:"left"}}});
    const released=await release.json();
    expect(released.ok).toBeTruthy();
    expect(released.action.dispatched).toBeTruthy();

    const state=await getJson(request,"/api/vision/state");
    expect(state.forgeReady).toBeTruthy();
    expect(state.diagnostics.entities).toBeGreaterThanOrEqual(4);
    expect(state.selected?.name||"").toMatch(/box/i);
    expect(state.selectedScreenRect).toBeTruthy();
    expect(state.canvasRect).toBeTruthy();

    const moved=await request.post("/api/vision/action",{data:{action:{
      type:"mouse.drag",
      from:{x:box.x+box.width/2,y:box.y+box.height/2},
      to:{x:box.x+box.width/2+30,y:box.y+box.height/2+10},
      steps:8
    }}});
    expect((await moved.json()).action.dispatched).toBeTruthy();
    const wheel=await request.post("/api/vision/action",{data:{action:{type:"mouse.wheel",deltaX:0,deltaY:180}}});
    expect((await wheel.json()).action.dispatched).toBeTruthy();
  });

  test("drives the real browser keyboard and proves a visible editor mode change",async({request})=>{
    test.setTimeout(90000);
    await startVision(request);
    const before=await getJson(request,"/api/vision/state");
    expect(before.forgeReady).toBeTruthy();
    expect(before.diagnostics.entities).toBeGreaterThanOrEqual(3);

    const keyRotate=await request.post("/api/vision/action",{data:{action:{type:"keyboard.press",key:"2"}}});
    const kr=await keyRotate.json();
    expect(kr.ok).toBeTruthy();
    const rotate=await getJson(request,"/api/vision/state");
    expect(rotate.gizmoMode).toBe("rotate");

    const keyTranslate=await request.post("/api/vision/action",{data:{action:{type:"keyboard.press",key:"1"}}});
    const kt=await keyTranslate.json();
    expect(kt.ok).toBeTruthy();
    const translate=await getJson(request,"/api/vision/state");
    expect(translate.gizmoMode).toBe("translate");
  });

  test("executes real touch start/move/end through CDP on a touch-capable Forge session",async({request})=>{
    test.setTimeout(90000);
    const session=await startVision(request,{viewport:{width:390,height:844},touch:true,mobile:true});
    expect(session.viewport.width).toBe(390);
    const elements=await getJson(request,"/api/vision/elements");
    const box=elements.elements.find(e=>e.selector==='[data-add="box"]'&&e.visible);
    expect(box).toBeTruthy();
    const bx=box.x+box.width/2,by=box.y+box.height/2;
    const start=await request.post("/api/vision/action",{data:{action:{type:"touch.start",points:[{id:1,x:bx,y:by,force:1}]}}});
    const sr=await start.json();
    expect(sr.ok).toBeTruthy();
    expect(sr.action.dispatched).toBeTruthy();

    const move=await request.post("/api/vision/action",{data:{action:{type:"touch.move",points:[{id:1,x:bx+2,y:by+2,force:1}]}}});
    const mr=await move.json();
    expect(mr.ok).toBeTruthy();

    const end=await request.post("/api/vision/action",{data:{action:{type:"touch.end"}}});
    const er=await end.json();
    expect(er.ok).toBeTruthy();
    expect(er.action.dispatched).toBeTruthy();

    const tap=await request.post("/api/vision/action",{data:{action:{type:"touch.tapSelector",selector:'[data-gizmo="rotate"]'}}});
    const tr=await tap.json();
    expect(tr.ok).toBeTruthy();
    expect(tr.action.dispatched).toBeTruthy();

    const afterTouch=await getJson(request,"/api/vision/state");
    expect(afterTouch.gizmoMode).toBe("rotate");

    const status=await getJson(request,"/api/vision/status");
    expect(status.vision.frameSeq).toBeGreaterThan(3);
    expect(status.capabilities.touch).toBeTruthy();
  });
});
