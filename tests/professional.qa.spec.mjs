import{test,expect}from"@playwright/test";
import{writeFile}from"node:fs/promises";
import{PNG}from"pngjs";

const FOX="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb";
const TOYCAR="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb";
const EXAMPLE_PNG="https://upload.wikimedia.org/wikipedia/commons/7/70/Example.png";

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
async function importViaInput(page,buffer,name,mimeType,{renderable=false}={}){
  await page.locator("#assetInput").setInputFiles({name,mimeType,buffer});
  await page.waitForFunction(expected=>{
    const r=window.Forge?.selected?.();
    return r?.components?.asset?.name===expected;
  },name,{timeout:30000});
  if(renderable){
    await page.waitForFunction(()=>{
      const root=window.Forge?.selected?.()?.entity;
      if(!root)return false;
      const stack=[root];
      while(stack.length){
        const node=stack.pop();
        if(node?.render?.meshInstances?.length)return true;
        for(const child of node?.children||[])stack.push(child);
      }
      return false;
    },{timeout:30000});
  }
}

function wavSilence(seconds=.25,sampleRate=8000){
  const frames=Math.floor(seconds*sampleRate),bytes=44+frames*2,b=Buffer.alloc(bytes);
  b.write("RIFF",0);b.writeUInt32LE(bytes-8,4);b.write("WAVE",8);b.write("fmt ",12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(frames*2,40);
  return b;
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

  test("editor chrome stays docked and advanced tools do not float over the viewport",async({page})=>{
    await waitForForge(page);
    await expect(page.locator(".forge-prod")).toHaveCount(0);
    await expect(page.locator("#openEditors")).toBeVisible();
    await page.click("#openEditors");
    await expect(page.locator(".forge-modal")).toBeVisible();
    await expect(page.locator('[data-editor-tool="Asset Lab"]')).toBeVisible();
    await expect(page.locator('[data-editor-tool="Material Lab"]')).toBeVisible();
    await expect(page.locator('[data-editor-tool="Animation Graph + Rig"]')).toBeVisible();
    await page.locator(".forge-modal [data-x]").click();
    await expect(page.locator(".forge-modal")).toHaveCount(0);
    await expect(page.locator("#forgeMobileControls")).toHaveCount(0);
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
    expect(result.changed.p.every(v=>Math.abs(v/0.5-Math.round(v/0.5))<1e-9)).toBeTruthy();
    expect(result.undo).toBeTruthy();
    expect(result.redo).toBeTruthy();
    expect(result.undone).toEqual(result.before);
    expect(result.redone).toEqual(result.changed);
  });

  test("real audio WAV imports as an Engine Audio Asset with a Sound Slot and listener",async({page})=>{
    await waitForForge(page);
    const wav=wavSilence();
    await importViaInput(page,wav,"forge-proof.wav","audio/wav");
    const info=await page.evaluate(()=>{
      const r=window.Forge.selected();
      const slot=r?.entity?.sound?.slot?.("main");
      const cam=window.Forge.camera();
      return{
        kind:r?.kind,
        asset:r?.components?.asset?.type,
        assetName:r?.components?.asset?.name,
        sound:!!r?.entity?.sound,
        slot:!!slot,
        slotLoaded:!!slot?.isLoaded,
        listener:!!cam?.audiolistener,
        registry:window.Forge.assets.has("forge-proof.wav")
      };
    });
    expect(info.kind).toBe("audio");
    expect(info.asset).toBe("audio");
    expect(info.assetName).toBe("forge-proof.wav");
    expect(info.sound).toBeTruthy();
    expect(info.slot).toBeTruthy();
    expect(info.listener).toBeTruthy();
    expect(info.registry).toBeTruthy();
    await page.click("#assetPlay");
    await page.waitForTimeout(120);
    expect(await page.locator("#assetPlay").isEnabled()).toBeTruthy();
  });

  test("real 2D PNG survives source round-trip, validates dimensions, and generates a real viewport PNG",async({page})=>{
    await waitForForge(page);
    const png=await download(page,EXAMPLE_PNG);
    expect(png.length).toBeGreaterThan(100);
    await importViaInput(page,png,"developer-reference.png","image/png");
    const bytesLength=png.length;
    const result=await page.evaluate(async(bytesLength)=>{
      const imported=window.Forge.selected();
      const check=await window.ForgeExport.validateSelected();
      const source=await window.ForgeExport.exportSource({download:false});
      const preview=await window.ForgeExport.exportPreview({download:false,name:"developer-reference-preview.png"});
      const info=window.ForgeSpatial.inspect(imported);
      return{
        name:window.Forge.selected()?.name,
        check,
        sourceSha:await window.ForgeExport.sha256(source.blob),
        previewSha:await window.ForgeExport.sha256(preview.blob),
        sourceBytes:source.blob.size,
        exportedBytes:source.blob.size,
        previewBytes:preview.blob.size,
        sourceBytes:source.blob.size,
        info
      };
    },bytesLength);
    expect(result.name).toBe("developer-reference.png");
    expect(result.check.ok).toBeTruthy();
    expect(result.check.quality.hasBounds).toBeTruthy();
    expect(result.check.quality.sourceBytes).toBe(result.sourceBytes);
    expect(result.sourceSha).toBe(await sha(new Blob([png])));
    expect(result.exportedBytes).toBe(result.sourceBytes);
    expect(result.previewBytes).toBeGreaterThan(50);
    expect(result.info.world.size.y).toBeGreaterThan(0.1);
    expect(result.info.world.size.y).toBeLessThan(4);
    const screen=await page.evaluate(()=>window.ForgeSpatial.screenRect(window.Forge.selected()));
    expect(screen.height).toBeGreaterThan(220);
    expect(await page.locator(".asset-row .asset-thumb").evaluate(img=>img.complete&&img.naturalWidth>0)).toBeTruthy();
    expect(await page.locator("#assetMeta").textContent()).toContain("developer-reference.png");
    await writeFile("test-results/pro-2d-source.png",png);
    await page.screenshot({path:"test-results/pro-2d-import.png",fullPage:true});
  });

  test("legacy OBJ imports through the real browser conversion adapter and produces a renderable 3D asset",async({page})=>{
    test.setTimeout(120000);
    const obj=Buffer.from([
      "o ForgeProof","v -0.7 0 -0.5","v 0.7 0 -0.5","v 0 1.4 -0.5","v -0.7 0 0.5","v 0.7 0 0.5","v 0 1.4 0.5",
      "f 1 2 3","f 4 6 5","f 1 4 5 2","f 2 5 6 3","f 3 6 4 1"
    ].join("\n"),"utf8");
    await waitForForge(page);
    await importViaInput(page,obj,"forge-proof.obj","model/obj",{renderable:true});
    const result=await page.evaluate(()=>{const r=window.Forge.selected(),spatial=window.ForgeSpatial.inspect(r);const stack=[r?.entity],meshes=[];while(stack.length){const n=stack.pop();for(const mi of n?.render?.meshInstances||[])meshes.push(mi);for(const c of n?.children||[])stack.push(c)}const m=meshes[0]?.material;return{name:r?.components?.asset?.name,converted:r?.components?.asset?.converted===true,converter:r?.components?.asset?.converter,sourcePreserved:r?.components?.asset?.sourcePreserved===true,vertices:spatial?.geometry?.vertices||0,triangles:spatial?.geometry?.triangles||0,renderables:meshes.length,diffuse:m?.diffuse?[m.diffuse.r,m.diffuse.g,m.diffuse.b]:[0,0,0]}});
    expect(result.name).toBe("forge-proof.obj");expect(result.converted).toBeTruthy();expect(result.converter).toBe("AssimpJS");expect(result.sourcePreserved).toBeTruthy();expect(result.vertices).toBeGreaterThan(0);expect(result.triangles).toBeGreaterThan(0);expect(result.renderables).toBeGreaterThan(0);
    expect(result.diffuse.reduce((a,b)=>a+b,0)).toBeGreaterThan(.3);
    await page.screenshot({path:"test-results/pro-legacy-obj-editor.png",fullPage:true});
  });
  test("universal STL source converts through the same production 3D pipeline",async({page})=>{
    test.setTimeout(120000);
    const stl=Buffer.from([
      "solid ForgeSTL",
      "facet normal 0 0 1",
      " outer loop",
      "  vertex 0 0 0",
      "  vertex 1 0 0",
      "  vertex 0 1 0",
      " endloop",
      "endfacet",
      "facet normal 0 0 -1",
      " outer loop",
      "  vertex 0 0 0",
      "  vertex 0 1 0",
      "  vertex 1 0 0",
      " endloop",
      "endfacet",
      "endsolid ForgeSTL"
    ].join("\n"),"utf8");
    await waitForForge(page);
    await importViaInput(page,stl,"forge-proof.stl","model/stl",{renderable:true});
    const result=await page.evaluate(()=>{
      const r=window.Forge.selected(),s=window.ForgeSpatial.inspect(r);
      return{name:r?.components?.asset?.name,converted:r?.components?.asset?.converted===true,converter:r?.components?.asset?.converter,sourcePreserved:r?.components?.asset?.sourcePreserved===true,hash:r?.components?.asset?.sourceSha256||"",vertices:s?.geometry?.vertices||0,triangles:s?.geometry?.triangles||0};
    });
    expect(result.name).toBe("forge-proof.stl");
    expect(result.converted).toBeTruthy();
    expect(result.converter).toBe("AssimpJS");
    expect(result.sourcePreserved).toBeTruthy();
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.vertices).toBeGreaterThan(0);
    expect(result.triangles).toBeGreaterThan(0);
    await page.screenshot({path:"test-results/pro-universal-stl-editor.png",fullPage:true});
  });

  test("universal source fallback preserves arbitrary non-renderable files in the asset vault",async({page})=>{
    await waitForForge(page);
    const source=Buffer.from("Forge arbitrary source asset\nversion=1\n","utf8");
    await importViaInput(page,source,"forge-proof.custom","application/octet-stream");
    const result=await page.evaluate(()=>{const e=window.Forge.assets.get("forge-proof.custom");return{entry:!!e,sourceOnly:e?.sourceOnly===true,bytes:e?.file?.size||0,extension:e?.extension||"",hash:e?.sourceSha256||""}});
    expect(result.entry).toBeTruthy();
    expect(result.sourceOnly).toBeTruthy();
    expect(result.bytes).toBe(source.length);
    expect(result.extension).toBe("custom");
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(page.locator("#assetList .asset-row")).toHaveCount(1);
  });

  test("built-in high-fidelity Car Concept imports as a native 3D asset in the Forge viewport",async({page})=>{
    test.setTimeout(150000);
    await waitForForge(page);
    await expect(page.locator("#importRealCar")).toBeVisible();
    await page.click("#importRealCar");
    await page.waitForFunction(()=>window.Forge?.selected?.()?.components?.asset?.remoteSource?.includes("sceneview.github.io/models/platforms/CarConcept.glb"),{timeout:90000});
    const result=await page.evaluate(()=>{
      const r=window.Forge.selected();
      const stack=[r?.entity],meshes=[];
      while(stack.length){
        const n=stack.pop();
        for(const mi of n?.render?.meshInstances||[])meshes.push(mi);
        for(const c of n?.children||[])stack.push(c);
      }
      const spatial=window.ForgeSpatial.inspect(r);
      const materials=new Set(meshes.map(mi=>mi.material?.name||mi.material).filter(Boolean));
      return{
        name:r?.components?.asset?.name,
        remoteSource:r?.components?.asset?.remoteSource,
        sourceSha256:r?.components?.asset?.sourceSha256,
        license:r?.components?.asset?.license,
        attribution:r?.components?.asset?.attribution,
        catalogSource:r?.components?.asset?.catalogSource,
        viewportSanitized:r?.components?.asset?.viewportSanitized===true,
        sanitizedExtensions:r?.components?.asset?.sanitizedExtensions||[],
        vertices:spatial?.geometry?.vertices||0,
        triangles:spatial?.geometry?.triangles||0,
        spatialMaterials:spatial?.geometry?.materials||0,
        materials:Math.max(spatial?.geometry?.materials||0,materials.size),
        renderables:meshes.length,
        textured:meshes.filter(mi=>!!mi.material?.diffuseMap).length,
        world:spatial?.world?.size||null,
        screen:window.ForgeSpatial.screenRect(r)
      };
    });
    expect(result.name).toBe("Forge-CarConcept-Khronos.glb");
    expect(result.remoteSource).toContain("sceneview.github.io/models/platforms/CarConcept.glb");
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.license).toBe("CC BY 4.0");
    expect(result.attribution).toContain("Darmstadt Graphics Group GmbH");
    expect(result.catalogSource).toContain("KhronosGroup/glTF-Sample-Assets");
    expect(result.vertices).toBeGreaterThan(5000);
    expect(result.triangles).toBeGreaterThan(5000);
    expect(result.materials).toBeGreaterThanOrEqual(3);
    expect(result.renderables).toBeGreaterThan(0);
    expect(result.textured).toBeGreaterThan(0);
    expect(result.world?.y).toBeGreaterThan(0.5);
    expect(result.screen?.width).toBeGreaterThan(250);
    expect(result.screen?.height).toBeGreaterThan(140);
    const shot=await page.locator("#viewport").screenshot();
    expect(shot.length).toBeGreaterThan(12000);
    const png=PNG.sync.read(shot);
    let active=0,total=0;
    for(let y=0;y<png.height;y+=8)for(let x=0;x<png.width;x+=8){
      const i=(y*png.width+x)*4,r=png.data[i],g=png.data[i+1],b=png.data[i+2];
      const spread=Math.max(r,g,b)-Math.min(r,g,b);
      if((r+g+b)/3>28&&spread>10)active++;
      total++;
    }
    expect(active/Math.max(1,total)).toBeGreaterThan(0.01);
    await page.screenshot({path:"test-results/pro-high-fidelity-car-editor.png",fullPage:true});
  });

  test("real animated Fox GLB imports with animation clips and exact source export",async({page})=>{
    test.setTimeout(120000);
    const glb=await download(page,FOX);
    expect(glb.length).toBeGreaterThan(100000);
    const originalSha=await sha(new Blob([glb]));
    await waitForForge(page);
    await importViaInput(page,glb,"Fox.glb","model/gltf-binary",{renderable:true});
    const bytesLength=glb.length;
    const result=await page.evaluate(async({originalSha,bytesLength})=>{
      const imported=window.Forge.selected();

      const check=await window.ForgeExport.validateSelected();
      const source=await window.ForgeExport.exportSource({download:false});
      const spatial=window.ForgeSpatial.inspect(imported);
      const scene=await window.ForgeExport.exportSceneGLB({download:false,name:"Fox-derived.glb"});
      const derivedFile=new File([scene.blob],"Fox-derived.glb",{type:"model/gltf-binary"});
      const round=await window.Forge.importFile(derivedFile);
      const roundSpatial=window.ForgeSpatial.inspect(round.record);
      return{
        name:imported.name,
        clips:imported.components.animation?.clips||[],
        playing:!!imported.entity.anim?.playing,
        check,
        sourceBytes:source.blob.size,
        exportedBytes:source.blob.size,
        sourceSha:await window.ForgeExport.sha256(source.blob),
        originalSha,
        spatial,
        derived:scene.validation,
        round:{name:round.record.name,spatial:roundSpatial}
      };
    },{originalSha,bytesLength});
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
    await importViaInput(page,glb,"ToyCar.glb","model/gltf-binary",{renderable:true});
    const result=await page.evaluate(async()=>{
      const imported=window.Forge.selected();
      const before=window.ForgeSpatial.inspect(imported);
      const qa=await window.ForgeExport.runExportQA();
      const source=await window.ForgeExport.exportSource({download:false});
      const derived=await window.ForgeExport.exportSceneGLB({download:false,name:"ToyCar-derived.glb"});
      const derivedFile=new File([derived.blob],"ToyCar-derived.glb",{type:"model/gltf-binary"});
      const round=await window.Forge.importFile(derivedFile);
      const after=window.ForgeSpatial.inspect(round.record);
      return{before,qa,sourceSha:await window.ForgeExport.sha256(source.blob),derived:derived.validation,after};
    });
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
    await importViaInput(page,glb,"Fox.glb","model/gltf-binary",{renderable:true});
    const result=await page.evaluate(async()=>{
      const imported=window.Forge.selected();
      const m=await window.ForgeExport.exportManifest({download:false});
      return{manifest:JSON.parse(await m.blob.text()),asset:imported.record};
    });
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
