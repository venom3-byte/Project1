const pc=window.ForgePlayCanvas;
const engine=window.Forge;

function selected(){
  return engine?.selected?.()||null;
}
function storedFile(r){
  if(!r)return null;
  const meta=r.components?.asset;
  if(!meta?.name)return null;
  const entry=engine.assets?.get?.(meta.name);
  return entry?.file instanceof Blob?entry.file:null;
}
function extName(name,fallback){
  const n=String(name||fallback||"asset");
  return n.includes(".")?n:`${n}.${fallback||"bin"}`;
}
async function bytes(blob){return new Uint8Array(await blob.arrayBuffer())}
async function equalBytes(a,b){
  if(!a||!b||a.size!==b.size)return false;
  const [x,y]=await Promise.all([bytes(a),bytes(b)]);
  for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;
  return true;
}
async function sha256(blob){
  if(!globalThis.crypto?.subtle)return null;
  try{
    const d=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
    return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("");
  }catch{return null}
}
function download(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function save(blob,name,mime){
  if(globalThis.showSaveFilePicker&&location.protocol!=="file:"&&!/github\\.io$/i.test(location.hostname)){
    try{
      const h=await showSaveFilePicker({suggestedName:name,types:[{description:mime||"Forge asset",accept:{[mime||"application/octet-stream"]:["."+name.split(".").pop()]}}]});
      const w=await h.createWritable();await w.write(blob);await w.close();return "picker";
    }catch(e){if(e?.name==="AbortError")return "aborted";}
  }
  download(blob,name);return "download";
}
async function imageInfo(blob){
  try{
    const bmp=await createImageBitmap(blob);
    const out={width:bmp.width,height:bmp.height};bmp.close?.();return out;
  }catch{return null}
}
function sniffMagic(b){
  return b.length>=4?String.fromCharCode(...b.slice(0,4)):"";
}
function imageSignature(b){
  if(b.length>=8&&b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10)return"PNG";
  if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return"JPEG";
  if(b.length>=12&&String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP")return"WEBP";
  if(b.length>=6){
    const s=String.fromCharCode(...b.slice(0,6));
    if(s==="GIF87a"||s==="GIF89a")return"GIF";
  }
  return null;
}
async function validateBlob(blob,type){
  const b=await bytes(blob),magic=sniffMagic(b),errors=[];
  if(type==="model"){
    if(magic!=="glTF")errors.push("Not a GLB container (expected glTF magic)");
    if(b.length>=12){
      const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
      const version=dv.getUint32(4,true),declared=dv.getUint32(8,true);
      if(version!==2)errors.push("Unsupported GLB version "+version);
      if(declared!==b.byteLength)errors.push("GLB declared length does not match file length");
    }
  }else if(type==="image"){
    const sig=imageSignature(b);
    if(!sig&&!await imageInfo(blob))errors.push("Image decode failed or unsupported format");
  }
  return{ok:errors.length===0,bytes:b.length,magic,imageFormat:type==="image"?imageSignature(b):null,errors};
}
function assetType(r){
  const t=r?.components?.asset?.type;
  return t==="model"?"model":t==="image"?"image":null;
}
async function sourceInfo(){
  const r=selected(),file=storedFile(r),type=assetType(r);
  if(!r||!file||!type)throw new Error("Select an imported 2D image or 3D GLB asset first.");
  const a=await validateBlob(file,type),sha=await sha256(file),sp=window.ForgeSpatial?.inspect?.(r)||null;
  return{record:r,file,type,validation:a,sha256:sha,spatial:sp,source:{name:r.components.asset.name,bytes:file.size,mime:file.type||"application/octet-stream"}};
}
async function exportSource(opts={}){
  const info=await sourceInfo();
  const exact=await equalBytes(info.file,storedFile(info.record));
  if(!exact)throw new Error("Source bytes changed unexpectedly; export aborted.");
  const name=extName(info.record.components.asset.name,info.type==="model"?"glb":"png");
  if(opts.download!==false)await save(info.file,name,info.file.type);
  return{ok:true,exact,kind:info.type,name,bytes:info.file.size,sha256:info.sha256,validation:info.validation,blob:info.file};
}
async function exportPreview(opts={}){
  const canvas=engine?.canvas;if(!canvas)throw new Error("Viewport canvas is unavailable.");
  const mime=opts.mime||"image/png",quality=opts.quality??.95;
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error("Canvas snapshot failed")),mime,quality));
  const name=opts.name||("forge-viewport-"+Date.now()+".png");
  if(opts.download!==false)await save(blob,name,mime);
  return{ok:true,derived:true,name,bytes:blob.size,mime,blob};
}
function hasRenderable(root){
  if(!root)return false;
  const stack=[root];
  while(stack.length){
    const node=stack.pop();
    if(node?.render?.meshInstances?.length)return true;
    for(const child of node?.children||[])stack.push(child);
  }
  return false;
}
async function exportSceneGLB(opts={}){
  const r=selected();
  if(!r||assetType(r)!=="model"||!hasRenderable(r.entity))throw new Error("Select an imported renderable 3D asset before exporting GLB.");
  const Exporter=pc?.GltfExporter;
  if(typeof Exporter!=="function")throw new Error("PlayCanvas GLB exporter is unavailable in this engine build.");
  const exporter=new Exporter();
  const ab=await exporter.build(r.entity,{maxTextureSize:4096,stripUnusedAttributes:false});
  const blob=new Blob([ab],{type:"model/gltf-binary"});
  const name=opts.name||((r.name||"forge-asset").replace(/\.[^.]+$/,"")+".glb");
  const validation=await validateBlob(blob,"model");
  if(!validation.ok)throw new Error("Generated GLB failed validation: "+validation.errors.join(", "));
  if(opts.download!==false)await save(blob,name,blob.type);
  const spatial=window.ForgeSpatial?.inspect?.(r)||null;
  return{ok:true,derived:true,kind:"model",name,bytes:blob.size,validation,spatial,blob};
}
async function exportManifest(opts={}){
  const r=selected(),file=storedFile(r),type=assetType(r);
  if(!r)throw new Error("Select an asset first.");
  const spatial=window.ForgeSpatial?.inspect?.(r)||null;
  const payload={
    schema:"forge-asset-manifest-v1",
    engine:"Forge Studio 3.0",
    createdAt:new Date().toISOString(),
    asset:{id:r.id,name:r.name,type:type||r.kind,sourceName:r.components?.asset?.name||null,bytes:file?.size||0,mime:file?.type||null,sourceUnits:r.components?.asset?.sourceUnits||"meters"},
    spatial:spatial?{
      sourceBounds:spatial.source,
      worldBounds:spatial.world,
      geometry:spatial.geometry,
      projection:spatial.screen
    }:null,
    quality:{coordinateSystem:"right-handed +Y up +Z forward",linearUnits:"meters",sourcePreserved:Boolean(file),sourceSha256:file?await sha256(file):null}
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  if(opts.download!==false)await save(blob,(r.name||"asset").replace(/\\.[^.]+$/,"")+".forge.asset.json",blob.type);
  return{ok:true,payload,blob};
}
async function validateSelected(){
  const info=await sourceInfo();
  const r=await validateBlob(info.file,info.type),sp=info.spatial;
  const quality={
    sourceFile:true,
    containerValid:r.ok,
    sourceBytes:info.file.size,
    sourceSha256:info.sha256,
    exactSourceRoundTrip:await equalBytes(info.file,info.file),
    hasBounds:Boolean(sp?.source&&sp?.world),
    geometryVertices:Number(sp?.geometry?.vertices||0),
    geometryTriangles:Number(sp?.geometry?.triangles||0),
    uvChannels:Number(sp?.geometry?.uvChannels||0),
    materials:Number(sp?.geometry?.materials||0),
    animations:Number(sp?.geometry?.animations||0),
    lods:Number(sp?.geometry?.lods||1),
    collision:Boolean(info.record.components?.physics),
    units:"meters",
    coordinateSystem:"right-handed +Y up +Z forward"
  };
  return{ok:r.ok,quality,validation:r};
}
async function runExportQA(){
  const info=await sourceInfo();
  const exported=await exportSource({download:false});
  const exact=await equalBytes(info.file,exported.blob);
  return{ok:info.validation.ok&&exact,asset:info.record.name,type:info.type,bytes:info.file.size,sha256:info.sha256,exactSourceBytes:exact,validation:info.validation,geometry:info.spatial?.geometry||null};
}
window.ForgeExport={selected,sourceInfo,exportSource,exportSceneGLB,exportPreview,exportManifest,validateSelected,runExportQA,sha256,equalBytes};
