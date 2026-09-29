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


test("GLB cook pipeline produces deterministic LOD package",async({request})=>{
  const json=JSON.stringify({
    asset:{version:"2.0"},
    scene:0,
    scenes:[{nodes:[0]}],
    nodes:[{mesh:0}],
    meshes:[{name:"Triangle",primitives:[{attributes:{POSITION:0},indices:1}]}],
    buffers:[{byteLength:44}],
    bufferViews:[
      {buffer:0,byteOffset:0,byteLength:36,target:34962},
      {buffer:0,byteOffset:36,byteLength:6,target:34963}
    ],
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:"VEC3",min:[0,0,0],max:[1,1,0]},
      {bufferView:1,componentType:5123,count:3,type:"SCALAR"}
    ]
  });
  const jb=Buffer.from(json);
  const jpad=Buffer.concat([jb,Buffer.alloc((4-jb.length%4)%4,0x20)]);
  const pos=Buffer.alloc(36);
  const fv=new Float32Array(pos.buffer,pos.byteOffset,9);
  fv.set([0,0,0,1,0,0,0,1,0]);
  const ib=Buffer.alloc(8);const iv=new Uint16Array(ib.buffer,ib.byteOffset,3);iv.set([0,1,2]);
  const header=Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);
  const total=12+8+jpad.length+8+ib.length;header.writeUInt32LE(total,8);
  const jh=Buffer.alloc(8);jh.writeUInt32LE(jpad.length,0);jh.writeUInt32LE(0x4e4f534a,4);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(ib.length,0);bh.writeUInt32LE(0x004e4942,4);
  const glb=Buffer.concat([header,jh,jpad,bh,Buffer.concat([pos,ib])]);
  const response=await request.post("/api/pipeline",{data:{operation:"cook-glb",base64:glb.toString("base64"),options:{lods:[1,.5,.2]}}});
  expect(response.ok()).toBeTruthy();
  const result=await response.json();
  expect(result.ok).toBeTruthy();
  expect(result.files.length).toBe(3);
  expect(result.files[0].name).toBe("lod0.glb");
  expect(result.files[1].name).toBe("lod50.glb");
  expect(result.files[2].name).toBe("lod80.glb");
  expect(result.manifest.collision.strategy).toBe("auto-box");
});

test("Forge HTTP command endpoint accepts structured engine commands",async({request})=>{
  const response=await request.post("/api/forge/command",{data:{command:{op:"diagnostics"}}});
  expect(response.ok()).toBeTruthy();
  const result=await response.json();
  expect(result.ok).toBeTruthy();
  expect(result.queued).toBeTruthy();
});
