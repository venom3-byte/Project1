import{test,expect}from"@playwright/test";

async function waitForBoot(page,testInfo){
  const errors=[];
  page.on("pageerror",e=>errors.push(String(e)));
  page.on("console",m=>m.type()==="error"&&errors.push(m.text()));
  const t0=Date.now();
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.ForgeBoot?.ok===true||window.ForgeBoot?.phase==="error",{timeout:30000});
  const boot=await page.evaluate(()=>window.ForgeBoot);
  if(!boot?.ok)throw new Error("Forge boot failed: "+JSON.stringify({phase:boot?.phase,error:boot?.error,totalMs:boot?.totalMs,timings:boot?.timings}));
  testInfo.annotations.push({type:"boot-ms",description:String(boot.totalMs)});
  testInfo.annotations.push({type:"core-ready-ms",description:String(boot.coreReadyMs)});
  expect(boot.ok).toBe(true);
  expect(boot.coreReadyMs).toBeLessThan(10000);
  expect(boot.totalMs).toBeLessThan(20000);
  expect(Date.now()-t0).toBeLessThan(30000);
  expect(errors).toEqual([]);
  return boot;
}

test("Forge cold editor boot completes with staged timing telemetry",async({page},testInfo)=>{
  const boot=await waitForBoot(page,testInfo);
  const diagnostics=await page.evaluate(()=>window.Forge.diagnostics());
  expect(diagnostics.entities).toBe(3);
  expect(diagnostics.renderables).toBeGreaterThan(0);
  expect(await page.locator("#renderer").textContent()).toMatch(/WebGPU|WebGL2/);
  console.log(JSON.stringify({bootMs:boot.totalMs,coreReadyMs:boot.coreReadyMs,gameplayReadyMs:boot.gameplayReadyMs,engineReadyMs:boot.engineReadyMs}));
});

test("Forge mobile editor boot completes without viewport errors",async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  const boot=await waitForBoot(page,testInfo);
  await expect(page.locator("#viewport")).toBeVisible();
  await expect(page.locator("#sceneCount")).toContainText("3 entities");
  expect(boot.totalMs).toBeLessThan(20000);
});
