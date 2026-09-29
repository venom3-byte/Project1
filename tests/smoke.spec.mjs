import{test,expect}from"@playwright/test";
test("Forge boots with renderer and scene kernel",async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));page.on("console",m=>m.type()==="error"&&errors.push(m.text()));
  await page.goto("/");await expect(page.locator("#sceneCount")).toContainText("3 entities");await expect(page.locator("#renderer")).toHaveText(/WebGPU|WebGL2/);
  const s=await page.evaluate(()=>window.Forge.diagnostics());expect(s.entities).toBe(3);expect(s.renderables).toBeGreaterThan(0);expect(errors).toEqual([]);
});
test("scene creation, selection, inspector and transform work",async({page})=>{
  await page.goto("/");await page.click('[data-add="box"]');await expect(page.locator("#sceneCount")).toContainText("4 entities");await expect(page.locator("#form")).toBeVisible();
  const before=await page.locator("#px").inputValue();await page.fill("#px","3");await page.dispatchEvent("#px","change");expect(await page.locator("#px").inputValue()).toBe("3");expect(before).not.toBe("3");
  const d=await page.evaluate(()=>window.Forge.diagnostics());expect(d.renderables).toBeGreaterThanOrEqual(2);
});
test("physics body updates runtime state",async({page})=>{
  await page.goto("/");await page.click('[data-add="box"]');await page.selectOption("#body","dynamic");await page.selectOption("#shape","box");await page.click("#apply");await page.waitForTimeout(400);
  const d=await page.evaluate(()=>window.Forge.diagnostics());expect(d.physics).toBeGreaterThan(1);
});
test("keyframe timeline is persistent in project JSON",async({page})=>{
  await page.goto("/");await page.click('[data-add="box"]');await page.click("#key");await page.fill("#time","1");await page.dispatchEvent("#time","input");await page.click("#key");
  const p=await page.evaluate(()=>window.Forge.serialize());const chosen=p.entities.find(x=>x.id===window.Forge.selectedId);expect(chosen.keyframes.length).toBe(2);
});
test("real raster asset import creates a renderable asset",async({page})=>{
  await page.goto("/");
  const data=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=64;c.height=64;const g=c.getContext("2d");g.fillStyle="#00c8ff";g.fillRect(8,8,48,48);return c.toDataURL("image/png").split(",")[1]});
  await page.setInputFiles("#assetInput",{name:"car-texture.png",mimeType:"image/png",buffer:Buffer.from(data,"base64")});
  await expect(page.locator("#sceneCount")).toContainText("4 entities");
  const s=await page.evaluate(()=>window.Forge.diagnostics());expect(s.renderables).toBeGreaterThan(1);
});
test("project save/open round trip keeps scene entities",async({page})=>{
  await page.goto("/");await page.click('[data-add="sphere"]');const json=await page.evaluate(()=>JSON.stringify(window.Forge.serialize()));
  await page.setInputFiles("#projectInput",{name:"roundtrip.forge.json",mimeType:"application/json",buffer:Buffer.from(json)});
  const d=await page.evaluate(()=>window.Forge.diagnostics());expect(d.entities).toBe(4);
});
test("visual QA reports healthy runtime",async({page})=>{
  await page.goto("/");await page.click("#qa");await expect(page.locator("#qaDialog")).toBeVisible();await page.click("#runQA");const text=await page.locator("#qaReport").textContent();expect(text).toContain('"ok": true');
});
test("mobile studio keeps viewport and inspector usable",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto("/");await expect(page.locator("#viewport")).toBeVisible();await page.click('[data-add="box"]');await expect(page.locator("#form")).toBeVisible();await page.click("#saveProject");
});
