import{test,expect,chromium}from"@playwright/test";
import{writeFile}from"node:fs/promises";

test.describe("Forge live computer vision bridge",()=>{
  test("continuous CDP vision stream and real input controls change Forge",async({request})=>{
    test.setTimeout(120000);
    const browser=await chromium.launch({
      headless:true,
      args:["--remote-debugging-port=9222","--user-data-dir=/tmp/forge-vision-cdp"]
    });
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    const page=await context.newPage();
    await page.goto("http://127.0.0.1:4173/");
    await page.waitForFunction(()=>window.ForgeReady===true,{timeout:30000});
    await expect(page.locator("#sceneCount")).toContainText("3 entities");

    const attach=await request.get("/api/vision/targets");
    expect(attach.ok()).toBeTruthy();
    const targets=(await attach.json()).targets||[];
    const target=targets.find(t=>t.type==="page"&&t.url.includes("127.0.0.1:4173"));
    expect(target?.id).toBeTruthy();

    const streamWs=new WebSocket("ws://127.0.0.1:4173/vision");
    const frames=[];
    const states=[];
    streamWs.on("message",data=>{
      try{
        const m=JSON.parse(data.toString());
        if(m.type==="vision-state")states.push(m.state);
        if(m.type==="vision-frame")frames.push(m);
      }catch{}
    });
    const connect=await request.post("/api/vision/connect",{data:{
      targetId:target.id,targetUrl:target.url,quality:55,maxWidth:960,maxHeight:540,everyNthFrame:1
    }});
    expect(connect.ok()).toBeTruthy();
    const connection=await connect.json();
    expect(connection.ok).toBeTruthy();
    expect(connection.state.connected).toBeTruthy();
    expect(connection.state.streaming).toBeTruthy();

    await expect.poll(()=>frames.length,{timeout:15000}).toBeGreaterThanOrEqual(3);
    expect(frames[0].data.length).toBeGreaterThan(1000);
    await writeFile("test-results/pro-vision-live-frame.jpg",Buffer.from(frames.at(-1).data,"base64"));

    const box=await page.locator('[data-add="box"]').boundingBox();
    expect(box).toBeTruthy();
    const click=await request.post("/api/vision/control",{data:{action:{
      type:"click",x:box.x+box.width/2,y:box.y+box.height/2,screenWidth:1440,screenHeight:900
    }}});
    expect(click.ok()).toBeTruthy();
    await expect(page.locator("#sceneCount")).toContainText("4 entities");

    const visionMode=await request.post("/api/vision/control",{data:{action:{type:"press",key:"2"}}});
    expect(visionMode.ok()).toBeTruthy();
    await expect.poll(()=>page.evaluate(()=>window.ForgeGizmo?.state?.mode),{timeout:5000}).toBe("rotate");

    const nameBox=await page.locator("#name").boundingBox();
    expect(nameBox).toBeTruthy();
    await request.post("/api/vision/control",{data:{action:{
      type:"click",x:nameBox.x+nameBox.width/2,y:nameBox.y+nameBox.height/2,screenWidth:1440,screenHeight:900
    }}});
    const typed=await request.post("/api/vision/control",{data:{action:{type:"typeText",text:"_VISION"}}});
    expect(typed.ok()).toBeTruthy();
    await expect(page.locator("#name").inputValue()).resolves.toContain("_VISION");

    const slider=await page.locator("#time").boundingBox();
    expect(slider).toBeTruthy();
    const startTime=await page.locator("#time").inputValue();
    const dragged=await request.post("/api/vision/control",{data:{action:{
      type:"drag",
      x:slider.x+6,y:slider.y+slider.height/2,
      toX:slider.x+Math.max(50,slider.width*.65),toY:slider.y+slider.height/2,
      screenWidth:1440,screenHeight:900,steps:16,stepMs:6
    }}});
    expect(dragged.ok()).toBeTruthy();
    await page.waitForTimeout(80);
    const endTime=await page.locator("#time").inputValue();
    expect(endTime).not.toBe(startTime);

    const touchProbe=await page.evaluate(()=>{
      window.__visionTouchCount=0;
      const b=document.querySelector('[data-add="sphere"]');
      b?.addEventListener("pointerdown",e=>{if(e.pointerType==="touch")window.__visionTouchCount++},{once:false});
      return b?.getBoundingClientRect().toJSON();
    });
    const touchStart=await request.post("/api/vision/control",{data:{action:{
      type:"touchStart",x:touchProbe.x+touchProbe.width/2,y:touchProbe.y+touchProbe.height/2,screenWidth:1440,screenHeight:900,id:41
    }}});
    const touchEnd=await request.post("/api/vision/control",{data:{action:{
      type:"touchEnd",x:touchProbe.x+touchProbe.width/2,y:touchProbe.y+touchProbe.height/2,screenWidth:1440,screenHeight:900,id:41
    }}});
    expect(touchStart.ok()).toBeTruthy();
    expect(touchEnd.ok()).toBeTruthy();
    await page.waitForTimeout(50);
    expect(await page.evaluate(()=>window.__visionTouchCount)).toBeGreaterThan(0);

    const status=await request.get("/api/vision/status");
    const st=await status.json();
    expect(st.connected).toBeTruthy();
    expect(st.streaming).toBeTruthy();
    expect(st.transport).toBe("chromium-cdp-screencast");
    expect(st.control).toBe("chromium-cdp-input");
    expect(frames.length).toBeGreaterThanOrEqual(3);

    await request.post("/api/vision/disconnect",{data:{}});
    streamWs.close();
    await context.close();
    await browser.close();
  });
});
