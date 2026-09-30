import{test,expect}from"@playwright/test";

async function pixelHealth(page){
  const shot=await page.screenshot({type:"png"});
  const {PNG}=await import("pngjs");
  const png=PNG.sync.read(shot);
  const box=await page.locator("#viewport").boundingBox();
  const viewport=page.viewportSize();
  if(!box||!viewport)return{ok:false,reason:"viewport-box-unavailable"};
  const sx=png.width/viewport.width,sy=png.height/viewport.height;
  const x0=Math.max(0,Math.floor(box.x*sx)),y0=Math.max(0,Math.floor(box.y*sy));
  const x1=Math.min(png.width,Math.ceil((box.x+box.width)*sx)),y1=Math.min(png.height,Math.ceil((box.y+box.height)*sy));
  let nonDark=0,total=0,sum=0,sum2=0;
  for(let y=y0;y<y1;y+=2){
    for(let x=x0;x<x1;x+=2){
      const i=(y*png.width+x)*4;
      const v=(png.data[i]+png.data[i+1]+png.data[i+2])/3;
      sum+=v;sum2+=v*v;total++;
      if(v>9)nonDark++;
    }
  }
  const mean=sum/Math.max(1,total),variance=sum2/Math.max(1,total)-mean*mean;
  return{ok:true,nonDarkRatio:nonDark/Math.max(1,total),variance,mean,width:box.width,height:box.height,method:"viewport-screenshot-png"};
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
