import{test,expect}from"@playwright/test";

async function pixelHealth(page){
  return page.evaluate(()=>{
    const canvas=document.getElementById("viewport");
    const gl=canvas.getContext("webgl2",{preserveDrawingBuffer:true})||canvas.getContext("webgl",{preserveDrawingBuffer:true});
    if(!gl)return{ok:false,reason:"no-webgl"};
    const w=Math.min(canvas.width,320),h=Math.min(canvas.height,180);
    const sx=Math.max(0,Math.floor((canvas.width-w)/2)),sy=Math.max(0,Math.floor((canvas.height-h)/2));
    const px=new Uint8Array(w*h*4);gl.readPixels(sx,sy,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
    let nonDark=0,total=0,sum=0,sum2=0;
    for(let i=0;i<px.length;i+=4){
      const v=(px[i]+px[i+1]+px[i+2])/3;sum+=v;sum2+=v*v;total++;
      if(v>9)nonDark++;
    }
    const mean=sum/Math.max(1,total),variance=sum2/Math.max(1,total)-mean*mean;
    const rect=canvas.getBoundingClientRect();
    return{ok:true,nonDarkRatio:nonDark/Math.max(1,total),variance,mean,width:rect.width,height:rect.height};
  });
}

test("desktop visual QA has a rendered scene and disciplined editor layout",async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/");
  await page.waitForFunction(()=>window.ForgeReady===true,{timeout:20000});
  await page.screenshot({path:"test-results/forge-desktop-proof.png",fullPage:true});
  const h=await pixelHealth(page);
  const layout=await page.evaluate(()=>({
    viewport:document.querySelector(".viewport").getBoundingClientRect().toJSON(),
    left:document.querySelector(".leftpanel").getBoundingClientRect().width,
    right:document.querySelector(".rightpanel").getBoundingClientRect().width,
    overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    selected:document.querySelector("#selected").textContent
  }));
  expect(h.ok).toBeTruthy();
  expect(h.nonDarkRatio).toBeGreaterThan(.02);
  expect(h.variance).toBeGreaterThan(4);
  expect(layout.viewport.width).toBeGreaterThan(500);
  expect(layout.viewport.height).toBeGreaterThan(300);
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.selected).toBeTruthy();
});

test("mobile visual QA exposes touch controls without scattered full-screen buttons",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await page.waitForFunction(()=>window.ForgeReady===true,{timeout:20000});
  await page.screenshot({path:"test-results/forge-mobile-proof.png",fullPage:true});
  await expect(page.locator(".mobile-quickbar")).toBeVisible();
  await expect(page.locator(".mobile-quickbar button")).toHaveCount(5);
  await expect(page.locator(".viewport canvas")).toBeVisible();
  const layout=await page.evaluate(()=>({
    width:document.querySelector(".viewport").getBoundingClientRect().width,
    height:document.querySelector(".viewport").getBoundingClientRect().height,
    scrollWidth:document.documentElement.scrollWidth,
    innerWidth:window.innerWidth
  }));
  expect(layout.width).toBeGreaterThan(300);
  expect(layout.height).toBeGreaterThan(300);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth+1);
});
