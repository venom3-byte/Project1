import{test,expect}from"@playwright/test";
import{writeFile}from"node:fs/promises";

const FOX="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb";
const TOYCAR="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb";
const EXAMPLE_PNG="https://upload.wikimedia.org/wikipedia/commons/7/70/Example.png";
const asBytes=value=>value instanceof Uint8Array?value:new Uint8Array(value?.data||value);

async function collectErrors(page){
  const errors=[];
  page.on("pageerror",e=>errors.push("pageerror: "+String(e)));
  page.on("console",m=>{if(m.type()==="error")errors.push("console: "+m.text())});
  return errors;
}

async function waitForForge(page){
  await page.goto("/");
  await page.waitForFunction(()=>window.ForgeReady===true,{timeout:20000});
  await page.waitForFunction(()=>{const d=window.Forge?.diagnostics?.();return d?.entities===3&&d?.renderables>0},{timeout:10000});
  await expect(page.locator("#sceneCount")).toContainText("3 entities",{timeout:5000});
  await page.waitForFunction(()=>!!window.Forge&&!!window.ForgeSpatial&&!!window.ForgeExport,{timeout:10000});
  await page.waitForTimeout(120);
}

async function download(page,url){
  const r=await page.request.get(url);
  expect(r.ok()).toBeTruthy();
  return r.body();
}

async function sha(blob){return pageHash(await blob.arrayBuffer())}
async function pageHash(buf){
  const d=await crypto.subtle.digest("SHA-256",buf);
  return[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

test.describe("Forge professional acceptance",()=>{

  test("startup is deterministic, visible, and error-free",async({page})=>{
    const errors=await collectErrors(page);
    const started=Date.now();
    await waitForForge(page);
    const elapsed=Date.now()-started;
    const nav=await page.evaluate(()=>performance.getEntriesByType("navigation")[0]?.toJSON?.()||null);
    const d=await page.evaluate(()=>window.Forge.diagnostics());
    const v=await page.evaluate(()=>window.AssetForgeLiveVision.visualHealth());
    expect(d.entities).toBe(3);
    expect(d.renderables).toBeGreaterThan(0);
    expect(d.spatial).toBeTruthy();
    expect(v.ok).toBeTruthy();
    expect(errors).toEqual([]);
    expect(elapsed).toBeLessThan(12000);
    expect(Number(nav?.domContentLoadedEventEnd||0)).toBeLessThan(10000);
    await page.screenshot({path:"test-results/pro-startup-desktop.png",fullPage:true});
  });

  test("desktop editor layout follows professional viewport/hierarchy/inspector separation",async({page})=>{
    await waitForForge(page);
    const layout=await page.evaluate(()=>({
      width:innerWidth,
      overflow:document.documentElement.scrollWidth-innerWidth,
      top:document.querySelector(".topbar")?.getBoundingClientRect().toJSON(),
      left:document.querySelector(".leftpanel")?.getBoundingClientRect().toJSON(),
      viewport:document.querySelector(".viewport")?.getBoundingClientRect().toJSON(),
      right:document.querySelector(".rightpanel")?.getBoundingClientRect().toJSON(),
      hierarchy:document.querySelector(".hierarchy")?.getBoundingClientRect().toJSON(),
      inspector:document.querySelector(".inspector")?.getBoundingClientRect().toJSON()
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.left.width).toBeGreaterThan(180);
    expect(layout.right.width).toBeGreaterThan(260);
    expect(layout.viewport.width).toBeGreaterThan(500);
    expect(layout.viewport.height).toBeGreaterThan(300);
    expect(layout.hierarchy.height).toBeGreaterThan(50);
    expect(layout.inspector.height).toBeGreaterThan(120);
    expect(layout.top.width).toBeGreaterThanOrEqual(1400);
  });

  test("mobile editor keeps primary workspace inside viewport and exposes compact touch controls",async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await waitForForge(page);
    const layout=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth-innerWidth,
      viewport:document.querySelector(".viewport")?.getBoundingClientRect().toJSON(),
      quickbar:document.querySelector(".mobile-quickbar")?.getBoundingClientRect().toJSON(),
      buttons:[...document.querySelectorAll(".mobile-quickbar button")].map(b=>({x:b.getBoundingClientRect().x,y:b.getBoundingClientRect().y,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,text:b.textContent})),
      desktopTools:getComputedStyle(document.querySelector(".viewport-tools")).display,
      modeWidth:document.querySelector(".modebar")?.scrollWidth,
      modeClient:document.querySelector(".modebar")?.clientWidth
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.viewport.width).toBeGreaterThan(300);
    expect(layout.viewport.height).toBeGreaterThan(300);
    expect(layout.quickbar.width).toBeGreaterThan(300);
    expect(layout.buttons).toHaveLength(5);
    expect(layout.buttons.every(b=>b.x>=0&&b.x+b.w<=390&&b.y+b.h<=844)).toBeTruthy();
    expect(layout.desktopTools).toBe("none");
    expect(layout.modeWidth).toBeGreaterThanOrEqual(layout.modeClient);
    await page.screenshot({path:"test-results/pro-mobile-editor.png",fullPage:true});
  });

  test("screen picking selects the rendered object at its measured visual center",async({page})=>{
    await waitForForge(page);
    await page.click('[data-add="box"]');
    const target=await page.evaluate(()=>{
      const r=window.Forge.selected(),rect=window.ForgeSpatial.screenRect(r);
      return{name:r.name,rect,viewport:document.querySelector(".viewport").getBoundingClientRect().toJSON()};
    });
    const vp=target.viewport;const x=vp.x+target.rect.x+target.rect.width/2,y=vp.y+target.rect.y+target.rect.height/2;
    await page.mouse.click(x,y);
    expect(await page.locator("#selected").textContent()).toBe(target.name);
  });

  test("spatial vision control can move a selected object to the visual center",async({page})=>{
    await waitForForge(page);
    await page.click('[data-add="box"]');
    const result=await page.evaluate(()=>{
      const r=window.Forge.selected();
      const vp=document.querySelector(".viewport").getBoundingClientRect();
      window.ForgeSpatial.moveToScreen(r.id,vp.left+vp.width/2,vp.top+vp.height/2,.5,0);
      const rect=window.ForgeSpatial.screenRect(r);
      return{rect,centerX:vp.width/2,centerY:vp.height/2,viewport:vp.toJSON()};
    });
    const actualX=result.rect.x+result.rect.width/2;
    const actualY=result.rect.y+result.rect.height/2;
    expect(Math.abs(actualX-result.centerX)).toBeLessThan(24);
    expect(Math.abs(actualY-result.centerY)).toBeLessThan(24);
  });

  test("gizmo mode, space switching, snapping, undo, and redo remain deterministic",async({page})=>{
    await waitForForge(page);
    await page.click('[data-add="box"]');
    const result=await page.evaluate(()=>{
      const before=window.Forge._transformState(window.Forge.selected());
      window.ForgeGizmo.setMode("translate");
      window.ForgeGizmo.setSpace("local");
      window.Forge.snapEnabled=true;
      window.Forge.snapSize=.5;
      window.Forge.transform({x:1.24,y:2.26,z:-.74});
      const changed=window.Forge._transformState(window.Forge.selected());
      const undo=window.Forge.undo();
      const undone=window.Forge._transformState(window.Forge.selected());
      const redo=window.Forge.redo();
      const redone=window.Forge._transformState(window.Forge.selected());
      return{before,changed,undone,redone,undo,redo,space:window.ForgeGizmo.state.space,mode:window.ForgeGizmo.state.mode};
    });
    expect(result.mode).toBe("translate");
    expect(result.space).toBe("local");
    expect(result.changed.p.map(v=>v%0.5)).toEqual([0,0,0]);
    expect(result.undo).toBeTruthy();
    expect(result.redo).toBeTruthy();
    expect(result.undone).toEqual(result.before);
    expect(result.redone).toEqual(result.changed);
  });

  test("real 2D PNG survives source round-trip, validates dimensions, and generates a real viewport PNG",async({page})=>{
    await waitForForge(page);
    const png=await download(page,EXAMPLE_PNG);
    expect(png.length).toBeGreaterThan(100);
    const result=await page.evaluate(async(bytes)=>{
      const file=new File([asBytes(bytes)],"developer-reference.png",{type:"image/png"});
      await window.ForgeProduction.assets.storeFile(file);
      const imported=await window.Forge.importFile(file);
      const check=await window.ForgeExport.validateSelected();
      const source=await window.ForgeExport.exportSource({download:false});
      const preview=await window.ForgeExport.exportPreview({download:false,name:"developer-reference-preview.png"});
      const info=window.ForgeSpatial.inspect(imported.record);
      return{
        name:window.Forge.selected()?.name,
        check,
        sourceSha:await window.ForgeExport.sha256(source.blob),
        previewSha:await window.ForgeExport.sha256(preview.blob),
        sourceBytes:file.size,
        exportedBytes:source.blob.size,
        previewBytes:preview.blob.size,
        info
      };
    },png);
    expect(result.name).toBe("developer-reference.png");
    expect(result.check.ok).toBeTruthy();
    expect(result.check.quality.hasBounds).toBeTruthy();
    expect(result.check.quality.sourceBytes).toBe(result.sourceBytes);
    expect(result.sourceSha).toBe(await sha(new Blob([png])));
    expect(result.exportedBytes).toBe(result.sourceBytes);
    expect(result.previewBytes).toBeGreaterThan(50);
    expect(await page.locator(".asset-row .asset-thumb").evaluate(img=>img.complete&&img.naturalWidth>0)).toBeTruthy();
    expect(await page.locator("#assetMeta").textContent()).toContain("developer-reference.png");
    await writeFile("test-results/pro-2d-source.png",png);
    await page.screenshot({path:"test-results/pro-2d-import.png",fullPage:true});
  });

  test("real animated Fox GLB imports with animation clips and exact source export",async({page})=>{
    test.setTimeout(120000);
    const glb=await download(page,FOX);
    expect(glb.length).toBeGreaterThan(100000);
    const originalSha=await sha(new Blob([glb]));
    await waitForForge(page);
    const result=await page.evaluate(async({bytes,originalSha})=>{
      const file=new File([asBytes(bytes)],"Fox.glb",{type:"model/gltf-binary"});
      await window.ForgeProduction.assets.storeFile(file);
      const imported=await window.Forge.importFile(file);
      const check=await window.ForgeExport.validateSelected();
      const source=await window.ForgeExport.exportSource({download:false});
      const spatial=window.ForgeSpatial.inspect(imported.record);
      const scene=await window.ForgeExport.exportSceneGLB({download:false,name:"Fox-derived.glb"});
      const derivedFile=new File([scene.blob],"Fox-derived.glb",{type:"model/gltf-binary"});
      const round=await window.Forge.importFile(derivedFile);
      const roundSpatial=window.ForgeSpatial.inspect(round.record);
      return{
        name:imported.record.name,
        clips:imported.record.components.animation?.clips||[],
        playing:!!imported.record.entity.anim?.playing,
        check,
        sourceBytes:file.size,
        exportedBytes:source.blob.size,
        sourceSha:await window.ForgeExport.sha256(source.blob),
        originalSha,
        spatial,
        derived:scene.validation,
        round:{name:round.record.name,spatial:roundSpatial}
      };
    },{bytes:glb,originalSha});
    expect(result.name).toBe("Fox");
    expect(result.clips.length).toBeGreaterThanOrEqual(3);
    expect(result.playing).toBeTruthy();
    expect(result.check.ok).toBeTruthy();
    expect(result.exportedBytes).toBe(result.sourceBytes);
    expect(result.sourceSha).toBe(result.originalSha);
    expect(result.clips).toEqual(expect.arrayContaining(["Survey","Walk","Run"]));
    expect(result.spatial.geometry.animations).toBeGreaterThanOrEqual(3);
    expect(result.spatial.geometry.vertices).toBeGreaterThan(0);
    expect(result.spatial.geometry.triangles).toBeGreaterThan(0);
    expect(result.derived.ok).toBeTruthy();
    expect(result.round.spatial.geometry.vertices).toBeGreaterThan(0);
    expect(result.round.spatial.geometry.triangles).toBeGreaterThan(0);
    await writeFile("test-results/pro-fox-source.glb",glb);
    await page.screenshot({path:"test-results/pro-fox-editor.png",fullPage:true});
  });

  test("real textured ToyCar GLB preserves geometry/material data through derived export",async({page})=>{
    test.setTimeout(120000);
    const glb=await download(page,TOYCAR);
    expect(glb.length).toBeGreaterThan(5000000);
    const originalSha=await sha(new Blob([glb]));
    await waitForForge(page);
    const result=await page.evaluate(async(bytes)=>{
      const file=new File([asBytes(bytes)],"ToyCar.glb",{type:"model/gltf-binary"});
      const imported=await window.Forge.importFile(file);
      const before=window.ForgeSpatial.inspect(imported.record);
      const qa=await window.ForgeExport.runExportQA();
      const source=await window.ForgeExport.exportSource({download:false});
      const derived=await window.ForgeExport.exportSceneGLB({download:false,name:"ToyCar-derived.glb"});
      const derivedFile=new File([derived.blob],"ToyCar-derived.glb",{type:"model/gltf-binary"});
      const round=await window.Forge.importFile(derivedFile);
      const after=window.ForgeSpatial.inspect(round.record);
      return{before,qa,sourceSha:await window.ForgeExport.sha256(source.blob),derived:derived.validation,after};
    },glb);
    expect(result.qa.ok).toBeTruthy();
    expect(result.sourceSha).toBe(originalSha);
    expect(result.before.geometry.vertices).toBeGreaterThan(0);
    expect(result.before.geometry.triangles).toBeGreaterThan(0);
    expect(result.before.geometry.materials).toBeGreaterThan(0);
    expect(result.derived.ok).toBeTruthy();
    expect(result.after.geometry.vertices).toBeGreaterThan(0);
    expect(result.after.geometry.triangles).toBeGreaterThan(0);
    expect(result.after.geometry.materials).toBeGreaterThan(0);
    await page.screenshot({path:"test-results/pro-toycar-editor.png",fullPage:true});
  });

  test("manifest is provenance-complete for real 2D and 3D assets",async({page})=>{
    test.setTimeout(120000);
    const glb=await download(page,FOX);
    await waitForForge(page);
    const result=await page.evaluate(async(bytes)=>{
      const file=new File([asBytes(bytes)],"Fox.glb",{type:"model/gltf-binary"});
      const imported=await window.Forge.importFile(file);
      const m=await window.ForgeExport.exportManifest({download:false});
      return{manifest:JSON.parse(await m.blob.text()),asset:imported.record};
    },glb);
    expect(result.manifest.schema).toBe("forge-asset-manifest-v1");
    expect(result.manifest.asset.sourceName).toBe("Fox.glb");
    expect(result.manifest.asset.bytes).toBeGreaterThan(100000);
    expect(result.manifest.quality.sourcePreserved).toBeTruthy();
    expect(result.manifest.quality.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest.spatial.geometry.vertices).toBeGreaterThan(0);
    expect(result.manifest.spatial.geometry.triangles).toBeGreaterThan(0);
    await writeFile("test-results/pro-fox-manifest.json",JSON.stringify(result.manifest,null,2));
  });
});
