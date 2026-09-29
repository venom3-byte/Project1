import{test,expect}from"@playwright/test";
import{writeFile}from"node:fs/promises";

function makeTriangleGlb(){
  const positions=new Float32Array([0,0,0,1,0,0,0,1,0]);
  const indices=new Uint16Array([0,1,2]);
  const bin=Buffer.alloc(positions.byteLength+indices.byteLength);
  Buffer.from(positions.buffer).copy(bin,0);
  Buffer.from(indices.buffer).copy(bin,positions.byteLength);
  const json=JSON.stringify({
    asset:{version:"2.0",generator:"Forge QA Fixture"},
    scene:0,
    scenes:[{nodes:[0]}],
    nodes:[{mesh:0,name:"TestTriangle"}],
    meshes:[{name:"TestMesh",primitives:[{attributes:{POSITION:0},indices:1,mode:4}]}],
    buffers:[{byteLength:bin.length}],
    bufferViews:[
      {buffer:0,byteOffset:0,byteLength:positions.byteLength,target:34962},
      {buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength,target:34963}
    ],
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:"VEC3",min:[0,0,0],max:[1,1,0]},
      {bufferView:1,componentType:5123,count:3,type:"SCALAR"}
    ]
  });
  const pad=n=>(n+3)&~3;
  const jb=Buffer.from(json);
  const jp=Buffer.alloc(pad(jb.length));jb.copy(jp);
  const bp=Buffer.alloc(pad(bin.length));bin.copy(bp);
  const total=12+8+jp.length+8+bp.length;
  const out=Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67,0);
  out.writeUInt32LE(2,4);
  out.writeUInt32LE(total,8);
  let o=12;
  out.writeUInt32LE(jp.length,o);out.writeUInt32LE(0x4e4f534a,o+4);jp.copy(out,o+8);o+=8+jp.length;
  out.writeUInt32LE(bp.length,o);out.writeUInt32LE(0x004e4942,o+4);bp.copy(out,o+8);
  return [...out];
}

test("2D image source survives exact export and validation",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(async()=>{
    const c=document.createElement("canvas");c.width=4;c.height=4;
    const x=c.getContext("2d");x.fillStyle="#ff3366";x.fillRect(0,0,4,4);
    const blob=await new Promise(r=>c.toBlob(r,"image/png"));
    const file=new File([blob],"qa-texture.png",{type:"image/png"});
    await window.ForgeProduction.assets.storeFile(file);
    await window.Forge.importFile(file);
    const check=await window.ForgeExport.validateSelected();
    const exp=await window.ForgeExport.exportSource({download:false});
    const same=await window.ForgeExport.equalBytes(file,exp.blob);
    const out=new Uint8Array(await exp.blob.arrayBuffer());
    return{check,exportOk:exp.ok,exportName:exp.name,exportBytes:exp.bytes,exportSha:exp.sha256,bytesArray:[...out],same,selected:window.Forge.selected()?.name};
  });
  expect(result.check.ok).toBeTruthy();
  expect(result.check.quality.hasBounds).toBeTruthy();
  expect(result.same).toBeTruthy();
  expect(result.selected).toBe("qa-texture.png");
  await writeFile("test-results/qa-texture.export.png",Buffer.from(result.bytesArray));
});

test("3D GLB source survives exact export with spatial geometry stats",async({page})=>{
  await page.goto("/");
  const bytes=makeTriangleGlb();
  const result=await page.evaluate(async(bytes)=>{
    const file=new File([new Uint8Array(bytes)],"qa-triangle.glb",{type:"model/gltf-binary"});
    await window.ForgeProduction.assets.storeFile(file);
    const imported=await window.Forge.importFile(file);
    const check=await window.ForgeExport.validateSelected();
    const exp=await window.ForgeExport.exportSource({download:false});
    const same=await window.ForgeExport.equalBytes(file,exp.blob);
    const spatial=window.ForgeSpatial.inspect(imported.record);
    const out=new Uint8Array(await exp.blob.arrayBuffer());
    return{check,exportOk:exp.ok,exportName:exp.name,exportBytes:exp.bytes,exportSha:exp.sha256,bytesArray:[...out],same,spatial};
  },bytes);
  expect(result.check.ok).toBeTruthy();
  expect(result.same).toBeTruthy();
  expect(result.spatial.geometry.vertices).toBeGreaterThan(0);
  expect(result.spatial.geometry.triangles).toBeGreaterThan(0);
  expect(result.spatial.world.size.x).toBeGreaterThan(0);
  await writeFile("test-results/qa-triangle.export.glb",Buffer.from(result.exp.bytesArray));
});

test("asset manifest records professional pipeline metadata",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(async()=>{
    const c=document.createElement("canvas");c.width=8;c.height=2;
    const blob=await new Promise(r=>{c.getContext("2d").fillRect(0,0,8,2);c.toBlob(r,"image/png")});
    const file=new File([blob],"manifest.png",{type:"image/png"});
    await window.Forge.importFile(file);
    const m=await window.ForgeExport.exportManifest({download:false});
    return {...m.payload,manifestText:await m.blob.text()};
  });
  expect(result.schema).toBe("forge-asset-manifest-v1");
  expect(result.quality.linearUnits).toBe("meters");
  expect(result.quality.coordinateSystem).toContain("+Y up");
  expect(result.spatial.geometry).toBeTruthy();
  expect(result.spatial.sourceBounds).toBeTruthy();
  await writeFile("test-results/qa-manifest.json",result.manifestText);
});


test("edited 3D scene can be cooked to GLB and re-imported",async({page})=>{
  await page.goto("/");
  await page.click('[data-add="box"]');
  const result=await page.evaluate(async()=>{
    const before=window.ForgeSpatial.inspect(window.Forge.selected());
    const exported=await window.ForgeExport.exportSceneGLB({download:false,name:"qa-box.glb"});
    const file=new File([exported.blob],"qa-box.glb",{type:"model/gltf-binary"});
    const imported=await window.Forge.importFile(file);
    const after=window.ForgeSpatial.inspect(imported.record);
    const out=new Uint8Array(await exported.blob.arrayBuffer());
    return{exported:{ok:exported.ok,name:exported.name,bytes:exported.bytes,validation:exported.validation,bytesArray:[...out]},sourceTriangles:before.geometry.triangles,sourceVertices:before.geometry.vertices,roundtripTriangles:after.geometry.triangles,roundtripVertices:after.geometry.vertices};
  });
  expect(result.exported.ok).toBeTruthy();
  expect(result.exported.validation.ok).toBeTruthy();
  expect(result.roundtripTriangles).toBeGreaterThan(0);
  expect(result.roundtripVertices).toBeGreaterThan(0);
  expect(result.roundtripTriangles).toBe(result.sourceTriangles);
  expect(result.roundtripVertices).toBe(result.sourceVertices);
  await writeFile("test-results/qa-box.cooked.glb",Buffer.from(result.exported.bytesArray));
});
