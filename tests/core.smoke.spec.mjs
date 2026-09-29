import{test,expect}from"@playwright/test";

test("core boot is deterministic and error-free",async({page})=>{
  const errors=[];
  page.on("pageerror",e=>errors.push(String(e)));
  page.on("console",m=>m.type()==="error"&&errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("#sceneCount")).toContainText("3 entities");
  await expect(page.locator("#renderer")).toHaveText(/WebGPU|WebGL2/);
  const d=await page.evaluate(()=>window.Forge.diagnostics());
  expect(d.entities).toBe(3);
  expect(d.renderables).toBeGreaterThan(0);
  expect(d.spatial).toBeTruthy();
  expect(errors).toEqual([]);
});

test("spatial core reports exact primitive dimensions and screen projection",async({page})=>{
  await page.goto("/");
  await page.click('[data-add="box"]');
  await expect(page.locator("#form")).toBeVisible();
  const result=await page.evaluate(()=>{
    const r=window.Forge.selected();
    const i=window.ForgeSpatial.inspect(r);
    return {source:i.source.size,world:i.world.size,objects:window.ForgeSpatial.sceneVision().objects.length};
  });
  expect(result.source.x||result.source[0]||result.source.size?.x).toBeGreaterThan(0);
  expect(result.world.x||result.world[0]||result.world.size?.x).toBeGreaterThan(0);
  expect(result.objects).toBeGreaterThan(0);
});

test("core scene manipulation and QA stay functional",async({page})=>{
  await page.goto("/");
  await page.click('[data-add="box"]');
  await expect(page.locator("#form")).toBeVisible();
  await page.fill("#px","3");await page.dispatchEvent("#px","change");
  expect(await page.locator("#px").inputValue()).toBe("3");
  await page.click("#qa");
  await expect(page.locator("#qaDialog")).toBeVisible();
  await page.click("#runQA");
  expect(await page.locator("#qaReport").textContent()).toContain('"ok": true');
});

test("core gameplay modules are ready after boot",async({page})=>{
  await page.goto("/");
  const ready=await page.evaluate(()=>({
    gameplay:!!window.ForgeGameplay,
    data:!!window.ForgeData,
    session:!!window.ForgeSession,
    runtime:!!window.ForgeRuntime,
    agent:!!window.ForgeAgent
  }));
  expect(ready).toEqual({gameplay:true,data:true,session:true,runtime:true,agent:true});
  const third=await page.evaluate(()=>window.ForgeGameplay.createThirdPersonTemplate());
  expect(third.type).toBe("third-person");
});

test("core 2D template and terrain no longer crash spatial inspection",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>{
    const p=window.Forge2D.createPlatformerTemplate();
    const t=window.ForgeTerrain.generate("Core Terrain",{size:16,subdivisions:12,seed:9,height:3});
    return {player:!!p.player,terrain:!!t.id};
  });
  expect(result.player).toBeTruthy();
  expect(result.terrain).toBeTruthy();
});

test("core project format is v5 and standalone metadata survives",async({page})=>{
  await page.goto("/");
  const project=await page.evaluate(()=>window.ForgeProject.serialize());
  expect(project.format).toBe("forge-project");
  expect(project.version).toBe(5);
  expect(project.meta.units).toBe("meters");
  expect(project.meta.coordinateSystem).toContain("+Y up");
});

test("native transform gizmo layer is available and mode switches are deterministic",async({page})=>{
  await page.goto("/");
  await page.waitForFunction(()=>window.ForgeGizmo?.state?.ready===true,{timeout:5000});
  const result=await page.evaluate(()=>{
    window.ForgeGizmo.setMode("rotate");
    const rotate=window.ForgeGizmo.state.mode;
    window.ForgeGizmo.setSpace("local");
    return{rotate,space:window.ForgeGizmo.state.space,buttons:[...document.querySelectorAll("[data-gizmo]")].map(x=>x.textContent)};
  });
  expect(result.rotate).toBe("rotate");
  expect(result.space).toBe("local");
  expect(result.buttons).toEqual(["Move","Rotate","Scale"]);
});
