import{test,expect}from"@playwright/test";

async function pixelHealth(page){
  return page.evaluate(async()=>{
    const source=document.getElementById("viewport");
    if(!source)return{ok:false,reason:"no-viewport"};
    const rect=source.getBoundingClientRect();
    const width=Math.min(320,Math.max(1,source.width||Math.round(rect.width)));
    const height=Math.min(180,Math.max(1,source.height||Math.round(rect.height)));
    try{
      const dataUrl=source.toDataURL("image/png");
      const blob=await (await fetch(dataUrl)).blob();
      const bmp=await createImageBitmap(blob);
      const probe=document.createElement("canvas");
      probe.width=width;probe.height=height;
      const ctx=probe.getContext("2d",{willReadFrequently:true});
      ctx.drawImage(bmp,0,0,width,height);
      bmp.close?.();
      const px=ctx.getImageData(0,0,width,height).data;
      let nonDark=0,total=0,sum=0,sum2=0;
      for(let i=0;i<px.length;i+=4){
        const v=(px[i]+px[i+1]+px[i+2])/3;
        sum+=v;sum2+=v*v;total++;
        if(v>9)nonDark++;
      }
      const mean=sum/Math.max(1,total),variance=sum2/Math.max(1,total)-mean*mean;
      return{ok:true,nonDarkRatio:nonDark/Math.max(1,total),variance,mean,width:rect.width,height:rect.height,method:"canvas-image-data"};
    }catch(error){
      return{ok:false,reason:String(error?.message||error)};
    }
  });
}

test("desktop visual QA has a rendered scene and disciplined editor layout",async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/");
  await page.waitForFunction(()=>window.ForgeReady===true,{timeout:20000});
  await page.waitForFunction(()=>{const d=window.Forge?.diagnostics?.();return d?.entities===3&&d?.renderables>0},{timeout:10000});
  await page.waitForTimeout(120);
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
  await page.waitForFunction(()=>{const d=window.Forge?.diagnostics?.();return d?.entities===3&&d?.renderables>0},{timeout:10000});
  await page.waitForTimeout(120);
  await page.screenshot({path:"test-results/forge-mobile-proof.png",fullPage:true});
  await expect(page.locator(".mobile-quickbar")).toBeVisible();
  await expect(page.locator(".mobile-quickbar button")).toHaveCount(5);
  await expect(page.locator("#viewport")).toBeVisible();
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
