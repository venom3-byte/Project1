const $=id=>document.getElementById(id);
const makeId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const selected=()=>canvas.getActiveObject();
const cutoutRecordsById=new Map();
const canvas=new fabric.Canvas("editorCanvas",{preserveObjectStacking:true,selection:true,allowTouchScrolling:false,enableRetinaScaling:true,stopContextMenu:true});
let history=[],future=[],restoring=false,cropTarget=null,github=null,lastBlob=null,recentFrames=[],frameLibrary=[],activeFrameSource=null,backgroundRemovalError=null;
const state={name:"Untitled Asset",canvasWidth:1024,canvasHeight:1024};
let pivotTransformGuard=false;
const degRad=d=>d*Math.PI/180;
function pivotLocalVector(o){
  const w=o.getScaledWidth?.()||((o.width||0)*(o.scaleX||1)),h=o.getScaledHeight?.()||((o.height||0)*(o.scaleY||1));
  return {x:((o.pivotX??.5)-.5)*w,y:((o.pivotY??.5)-.5)*h};
}
function rotateVec(v,deg){const r=degRad(deg),cos=Math.cos(r),sin=Math.sin(r);return{x:v.x*cos-v.y*sin,y:v.x*sin+v.y*cos}}
function pivotWorldPoint(o,angle=o.angle||0){
  const center=o.getCenterPoint();
  const v=rotateVec(pivotLocalVector(o),angle);
  return {x:center.x+v.x,y:center.y+v.y};
}
function setPivotValues(o,px,py){o.set({pivotX:Math.max(0,Math.min(1,Number.isFinite(px)?px:.5)),pivotY:Math.max(0,Math.min(1,Number.isFinite(py)?py:.5))});o.__pivotLastAngle=o.angle||0;o.setCoords()}
function rotateAroundCustomPivot(o,newAngle){
  if(pivotTransformGuard)return;
  const oldAngle=Number.isFinite(o.__pivotLastAngle)?o.__pivotLastAngle:(o.angle||0);
  const worldPivot=pivotWorldPoint(o,oldAngle);
  const nextVec=rotateVec(pivotLocalVector(o),newAngle);
  const nextCenter={x:worldPivot.x-nextVec.x,y:worldPivot.y-nextVec.y};
  pivotTransformGuard=true;
  try{
    o.set({angle:newAngle});
    o.setPositionByOrigin(new fabric.Point(nextCenter.x,nextCenter.y),"center","center");
    o.setCoords();
    o.__pivotLastAngle=newAngle;
  }finally{pivotTransformGuard=false}
}
const setStatus=s=>$("status").textContent=s;
const toast=s=>{const t=$("toast");t.textContent=s;t.className="show";clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.className="",2200)};
function snapshot(){if(restoring)return;const j=JSON.stringify(canvas.toJSON(["name","assetId","pivotX","pivotY","assetTags","cutoutRecordId","cutoutSourceDataUrl","cutoutMaskDataUrl"]));if(history.at(-1)!==j){history.push(j);if(history.length>80)history.shift();future=[]}}
async function restore(j){
  const selectedId=selected()?.assetId||null;
  restoring=true;
  try{
    await canvas.loadFromJSON(JSON.parse(j));
    await hydrateCutoutRecords();
    if(selectedId){
      const next=canvas.getObjects().find(o=>o.assetId===selectedId);
      if(next)canvas.setActiveObject(next);
    }else if(canvas.getObjects().length===1){
      canvas.setActiveObject(canvas.getObjects()[0]);
    }
    canvas.renderAll();syncProps();renderLayers();
  }finally{restoring=false}
}
function resizeEditor(){const w=+$("cw").value||1024,h=+$("ch").value||1024;state.canvasWidth=w;state.canvasHeight=h;canvas.setDimensions({width:w,height:h});$("dimensions").textContent=w+" × "+h;fit()}
function fit(){const st=$("stage"),z=Math.min((st.clientWidth-48)/canvas.width,(st.clientHeight-48)/canvas.height,1);canvas.setZoom(z);canvas.setDimensions({width:canvas.width*z,height:canvas.height*z},"cssOnly");$("zoomLabel").textContent=Math.round(z*100)+"%"}
window.addEventListener("resize",fit);

async function blobToDataUrl(blob){return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
async function dataUrlToBlob(dataUrl){const r=await fetch(dataUrl);return r.blob()}
async function addRasterBlob(blob,name="asset.png"){return addRasterUrl(await blobToDataUrl(blob),name)}
async function addRasterUrl(url,name="asset.png"){const img=await fabric.FabricImage.fromURL(url,{crossOrigin:"anonymous"}),w=+$("cw").value||1024,h=+$("ch").value||1024,s=Math.min((w*.82)/img.width,(h*.82)/img.height,1);img.set({left:(w-img.width*s)/2,top:(h-img.height*s)/2,scaleX:s,scaleY:s,name,assetId:makeId(),angle:0,pivotX:.5,pivotY:.5,assetTags:[]});canvas.add(img);canvas.setActiveObject(img);canvas.renderAll();$("dropHint").style.display="none";snapshot();syncProps();return img}
async function upload(file){if(!file)return;setStatus("Loading image…");try{await addRasterBlob(file,file.name);setStatus("Ready")}catch(e){console.error(e);toast("Image import failed");setStatus("Ready")}}
$("uploadBtn").onclick=()=>$("fileInput").click();$("fileInput").onchange=e=>upload(e.target.files[0]);
$("stage").ondragover=e=>{e.preventDefault();$("stage").classList.add("drop-active")};$("stage").ondragleave=()=>$("stage").classList.remove("drop-active");$("stage").ondrop=e=>{e.preventDefault();$("stage").classList.remove("drop-active");upload(e.dataTransfer.files[0])};

function renderLayers(){
  const box=$("layers"),objs=canvas.getObjects();$("layerCount").textContent=objs.length;box.innerHTML="";
  [...objs].reverse().forEach(o=>{
    const row=document.createElement("div");row.className="layer-row"+(o===selected()?" active":"");
    const eye=document.createElement("button");eye.className="layer-eye";eye.textContent=o.visible===false?"○":"●";
    const name=document.createElement("div");name.className="layer-name";name.textContent=o.name||o.type||"Layer";
    const meta=document.createElement("div");meta.className="layer-meta";meta.textContent=(o.type==="image"?"Raster ":"")+Math.round(o.getScaledWidth?.()||0)+"×"+Math.round(o.getScaledHeight?.()||0);name.append(meta);
    const pick=document.createElement("button");pick.className="layer-select";pick.textContent="›";
    eye.onclick=e=>{e.stopPropagation();o.visible=!o.visible;canvas.requestRenderAll();snapshot();renderLayers()};
    const pickLayer=()=>{canvas.setActiveObject(o);canvas.requestRenderAll();syncProps();renderLayers()};
    row.onclick=pickLayer;pick.onclick=e=>{e.stopPropagation();pickLayer()};
    row.append(eye,name,pick);box.append(row)
  })
}
function syncProps(){const o=canvas.getActiveObject();$("propsEmpty").classList.toggle("hidden",!!o);$("props").classList.toggle("hidden",!o);if(!o){$("selectionInfo").textContent="No selection";return;}$("layerName").value=o.name||"";for(const [id,v] of [["px",o.left||0],["py",o.top||0],["pw",o.getScaledWidth()||0],["ph",o.getScaledHeight()||0],["prot",o.angle||0],["pop",o.opacity??1],["pivotX",o.pivotX??.5],["pivotY",o.pivotY??.5]])$(id).value=Math.round(v*1000)/1000;$("imageControls").classList.toggle("hidden",o.type!=="image")}
function updateProps(){
  const o=canvas.getActiveObject();if(!o)return;
  const nextLeft=+$("px").value||0,nextTop=+$("py").value||0,nextOpacity=Number.isFinite(+$("pop").value)?+$("pop").value:1;
  const nextPx=Number.isFinite(+$("pivotX").value)?Math.max(0,Math.min(1,+$("pivotX").value)):.5;
  const nextPy=Number.isFinite(+$("pivotY").value)?Math.max(0,Math.min(1,+$("pivotY").value)):.5;
  const nextAngle=+$("prot").value||0;
  o.set({left:nextLeft,top:nextTop,opacity:nextOpacity});
  const w=+$("pw").value,h=+$("ph").value;
  if(w>0&&o.width)o.scaleX=w/o.width;if(h>0&&o.height)o.scaleY=h/o.height;
  o.set({pivotX:nextPx,pivotY:nextPy});
  if(Math.abs((o.angle||0)-nextAngle)>0.0001)rotateAroundCustomPivot(o,nextAngle);else o.__pivotLastAngle=nextAngle;
  o.setCoords();canvas.requestRenderAll();snapshot();
}
["px","py","pw","ph","prot","pop","pivotX","pivotY"].forEach(id=>$(id).onchange=updateProps);$("layerName").onchange=()=>{const o=selected();if(!o)return;o.name=$("layerName").value.trim()||"Layer";snapshot();renderLayers()};
function deleteSelected(){
  const o=selected();if(!o)return toast("Select a layer first");
  canvas.remove(o);canvas.discardActiveObject();snapshot();syncProps();renderLayers();toast("Layer deleted")
}
$("deleteBtn").onclick=deleteSelected;
$("duplicateBtn").onclick=async()=>{
  const o=selected();if(!o)return toast("Select a layer first");
  $("duplicateBtn").disabled=true;
  try{
    let c;
    if(o.type==="image"){
      const el=o.getElement(),tmp=document.createElement("canvas");tmp.width=el.naturalWidth||el.width;tmp.height=el.naturalHeight||el.height;tmp.getContext("2d").drawImage(el,0,0);
      const dataUrl=tmp.toDataURL("image/png");
      c=await fabric.FabricImage.fromURL(dataUrl);
    }else{
      c=await o.clone(["name","assetId"]);
    }
    c.set({left:(o.left||0)+20,top:(o.top||0)+20,name:(o.name||"asset")+"_copy",assetId:makeId(),pivotX:o.pivotX??.5,pivotY:o.pivotY??.5,angle:o.angle||0,opacity:o.opacity??1,filters:o.filters||[],assetTags:Array.isArray(o.assetTags)?[...o.assetTags]:[]});c.__pivotLastAngle=c.angle||0;
    canvas.add(c);canvas.setActiveObject(c);canvas.requestRenderAll();snapshot();syncProps();renderLayers();toast("Layer duplicated")
  }catch(e){console.error(e);toast("Duplicate failed: "+e.message)}
  finally{$("duplicateBtn").disabled=false}
};

$("textBtn").onclick=()=>{const t=new fabric.IText("Game Asset",{left:100,top:100,fill:"#fff",fontSize:64,fontFamily:"Arial",fontWeight:"700"});canvas.add(t);canvas.setActiveObject(t);snapshot()};
$("rectBtn").onclick=()=>{const r=new fabric.Rect({left:100,top:100,width:240,height:160,fill:"#3b82f6",rx:16,ry:16});canvas.add(r);canvas.setActiveObject(r);snapshot()};

function stack(action){
 const o=selected();if(!o)return;
 ({front:()=>canvas.bringObjectToFront(o),back:()=>canvas.sendObjectToBack(o),up:()=>canvas.bringObjectForward(o),down:()=>canvas.sendObjectBackwards(o)}[action])();
 canvas.requestRenderAll();snapshot();renderLayers()
}
$("frontBtn").onclick=()=>stack("front");$("backBtn").onclick=()=>stack("back");$("upBtn").onclick=()=>stack("up");$("downBtn").onclick=()=>stack("down");
function applyFilters(){const o=canvas.getActiveObject();if(!o||o.type!=="image")return;const vals=[+$("brightness").value,+$("contrast").value,+$("saturation").value,+$("blur").value];o.filters=[new fabric.filters.Brightness({brightness:vals[0]}),new fabric.filters.Contrast({contrast:vals[1]}),new fabric.filters.Saturation({saturation:vals[2]}),new fabric.filters.Blur({blur:vals[3]})].filter((_,i)=>vals[i]!==0);o.applyFilters();canvas.requestRenderAll();snapshot()}
["brightness","contrast","saturation","blur"].forEach(id=>$(id).oninput=applyFilters);
$("resetFilters").onclick=()=>{const o=canvas.getActiveObject();if(o?.type!=="image")return;o.filters=[];o.applyFilters();["brightness","contrast","saturation","blur"].forEach(id=>$(id).value=0);canvas.requestRenderAll();snapshot()};

async function addReplacement(blob,old,name,meta={}){const dataUrl=await blobToDataUrl(blob),n=await fabric.FabricImage.fromURL(dataUrl);n.set({left:old.left,top:old.top,angle:old.angle,opacity:old.opacity,scaleX:old.scaleX,scaleY:old.scaleY,name,assetId:old.assetId||makeId(),pivotX:old.pivotX??.5,pivotY:old.pivotY??.5,assetTags:Array.isArray(old.assetTags)?[...old.assetTags]:[],...meta});n.__pivotLastAngle=n.angle||0;const wasRestoring=restoring;restoring=true;try{canvas.remove(old);canvas.add(n);canvas.setActiveObject(n);canvas.renderAll()}finally{restoring=wasRestoring}snapshot();syncProps();renderLayers();await vaultPut(blob,name);lastBlob=blob;return n}
async function imageFromCrop(obj,x,y,w,h){const src=obj.getElement(),out=document.createElement("canvas");out.width=w;out.height=h;out.getContext("2d").drawImage(src,x,y,w,h,0,0,w,h);const blob=await new Promise(r=>out.toBlob(r,"image/png",1));return addReplacement(blob,obj,(obj.name||"asset").replace(/\.[^.]+$/,"")+"_crop.png")}
function updateCropBox(){if(!cropTarget)return;const img=$("cropPreview"),box=$("cropBox"),x=+$("cropX").value||0,y=+$("cropY").value||0,w=+$("cropW").value||1,h=+$("cropH").value||1,iw=cropTarget.getElement().naturalWidth||cropTarget.width,ih=cropTarget.getElement().naturalHeight||cropTarget.height,rw=img.clientWidth||1,rh=img.clientHeight||1,ox=(img.parentElement.clientWidth-rw)/2,oy=(img.parentElement.clientHeight-rh)/2;box.style.left=(ox+x/iw*rw)+"px";box.style.top=(oy+y/ih*rh)+"px";box.style.width=(w/iw*rw)+"px";box.style.height=(h/ih*rh)+"px"}
function openCrop(){const o=canvas.getActiveObject();if(!o||o.type!=="image")return toast("Select an image first");cropTarget=o;const src=o.getElement();$("cropPreview").src=src.currentSrc||src.src;const iw=src.naturalWidth||o.width,ih=src.naturalHeight||o.height;$("cropX").value=0;$("cropY").value=0;$("cropW").value=iw;$("cropH").value=ih;$("cropModal").classList.remove("hidden");setTimeout(updateCropBox,50)}
["cropX","cropY","cropW","cropH"].forEach(id=>$(id).oninput=updateCropBox);$("cropBtn").onclick=openCrop;
$("applyCrop").onclick=async()=>{if(!cropTarget)return;const src=cropTarget.getElement(),maxW=src.naturalWidth||cropTarget.width,maxH=src.naturalHeight||cropTarget.height;let x=Math.max(0,Math.min(maxW-1,+$("cropX").value||0)),y=Math.max(0,Math.min(maxH-1,+$("cropY").value||0)),w=Math.max(1,Math.min(maxW-x,+$("cropW").value||maxW-x)),h=Math.max(1,Math.min(maxH-y,+$("cropH").value||maxH-y));$("applyCrop").disabled=true;try{await imageFromCrop(cropTarget,x,y,w,h);$("cropModal").classList.add("hidden");toast("Crop applied")}catch(e){console.error(e);toast("Crop failed")}finally{$("applyCrop").disabled=false;cropTarget=null}};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add("hidden"));

async function trimTransparent(){const o=canvas.getActiveObject();if(!o||o.type!=="image")return toast("Select a transparent image first");const src=o.getElement(),c=document.createElement("canvas");c.width=src.naturalWidth||o.width;c.height=src.naturalHeight||o.height;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(src,0,0,c.width,c.height);const d=ctx.getImageData(0,0,c.width,c.height).data;let minX=c.width,minY=c.height,maxX=-1,maxY=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){if(d[(y*c.width+x)*4+3]>4){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}}if(maxX<0)return toast("No visible pixels found");const out=document.createElement("canvas");out.width=maxX-minX+1;out.height=maxY-minY+1;out.getContext("2d").drawImage(c,minX,minY,out.width,out.height,0,0,out.width,out.height);const blob=await new Promise(r=>out.toBlob(r,"image/png",1));await addReplacement(blob,o,(o.name||"asset").replace(/\.[^.]+$/,"")+"_trim.png");toast("Transparent bounds trimmed")}
$("trimBtn").onclick=trimTransparent;

let backgroundPipeline=null,backgroundPipelinePromise=null;
async function blobFromObject(o){
  const el=o?.type==="image"?o.getElement():null;if(!el)throw new Error("Select a raster image first");
  const c=document.createElement("canvas");c.width=el.naturalWidth||el.width;c.height=el.naturalHeight||el.height;c.getContext("2d").drawImage(el,0,0,c.width,c.height);
  return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error("Could not encode source image")),"image/png",1))
}
async function detectInferenceConfig(){
  if(!navigator.gpu||!window.isSecureContext)return {device:"wasm",dtype:"q8"};
  try{const adapter=await navigator.gpu.requestAdapter();if(!adapter)return{device:"wasm",dtype:"q8"};return{device:"webgpu",dtype:adapter.features?.has?.("shader-f16")?"fp16":"fp32"}}catch{return{device:"wasm",dtype:"fp32"}}
}
async function getBackgroundPipeline(){
  if(backgroundPipeline)return backgroundPipeline;
  if(backgroundPipelinePromise)return backgroundPipelinePromise;
  backgroundPipelinePromise=(async()=>{
    const {pipeline}=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm");
    const cfg=await detectInferenceConfig();
    setStatus("Loading ISNet INT8 background-removal model ("+cfg.device+" / "+cfg.dtype+")…");
    try{
      const pipe=await pipeline("background-removal","xrds/isnet-general-onnx-int8",{device:cfg.device,dtype:cfg.dtype});
      backgroundPipeline=pipe;return pipe
    }catch(e){
      if(cfg.device==="webgpu"){
        const pipe=await pipeline("background-removal","xrds/isnet-general-onnx-int8",{device:"wasm",dtype:"fp32"});
        backgroundPipeline=pipe;return pipe
      }
      throw e
    }
  })().catch(e=>{backgroundPipelinePromise=null;throw e});
  return backgroundPipelinePromise
}
async function extractAlphaFromRawImage(raw){
  const rgba=typeof raw?.rgba==="function"?raw.rgba():raw;
  if(!rgba?.width||!rgba?.height||!rgba?.data)throw new Error("ISNet background-removal model returned no usable RGBA image");
  const w=rgba.width,h=rgba.height,stride=Math.max(1,Math.floor(rgba.data.length/(w*h))),data=new Uint8ClampedArray(rgba.data);
  const mask=document.createElement("canvas");mask.width=w;mask.height=h;const ctx=mask.getContext("2d",{willReadFrequently:true}),out=new ImageData(w,h),od=out.data;
  for(let i=0,p=0;i<w*h;i++,p+=4){let a=stride>=4?data[i*stride+3]:data[i*stride];if(a<=1)a*=255;a=Math.max(0,Math.min(255,a));od[p]=255;od[p+1]=255;od[p+2]=255;od[p+3]=a}
  ctx.putImageData(out,0,0);return{maskCanvas:mask,width:w,height:h}
}
function cleanAlphaMatte(maskCanvas){
  const ctx=maskCanvas.getContext("2d",{willReadFrequently:true}),img=ctx.getImageData(0,0,maskCanvas.width,maskCanvas.height),d=img.data,w=maskCanvas.width,h=maskCanvas.height;
  const alpha=new Uint8ClampedArray(w*h);
  for(let i=0,p=0;i<alpha.length;i++,p+=4){const a=d[p+3];alpha[i]=a<5?0:a}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,a=alpha[i];if(a===0||a>=28)continue;
    let n=0;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){if(!xx&&!yy)continue;const nx=x+xx,ny=y+yy;if(nx>=0&&nx<w&&ny>=0&&ny<h&&alpha[ny*w+nx]>=28)n++}
    if(n<2)alpha[i]=0;
  }
  for(let i=0,p=0;i<alpha.length;i++,p+=4)d[p+3]=alpha[i];
  ctx.putImageData(img,0,0);return maskCanvas;
}
async function removeBg(){
  const o=selected();if(!o||o.type!=="image")return toast("Select an image first");
  $("bgBtn").disabled=true;$("mobileBgBtn").disabled=true;setStatus("Preparing original pixels…");
  try{
    const sourceBlob=await blobFromObject(o);setStatus("ISNet high-quality segmentation…");
    const pipe=await getBackgroundPipeline();const rawResult=await pipe(sourceBlob);const result=Array.isArray(rawResult)?rawResult[0]:rawResult;
    const {maskCanvas}=await extractAlphaFromRawImage(result);cleanAlphaMatte(maskCanvas);setStatus("Applying original RGB + cleaned ISNet alpha matte…");
    const source=await createImageBitmap(sourceBlob),w=source.width,h=source.height,out=document.createElement("canvas");out.width=w;out.height=h;
    const octx=out.getContext("2d",{willReadFrequently:true}),mctx=maskCanvas.getContext("2d",{willReadFrequently:true});
    const scaled=document.createElement("canvas");scaled.width=w;scaled.height=h;const sctx=scaled.getContext("2d",{willReadFrequently:true});sctx.drawImage(maskCanvas,0,0,w,h);
    octx.drawImage(source,0,0,w,h);const od=octx.getImageData(0,0,w,h),md=sctx.getImageData(0,0,w,h).data;
    for(let i=0;i<od.data.length;i+=4)od.data[i+3]=md[i+3];
    octx.putImageData(od,0,0);source.close();
    const blob=await new Promise((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(new Error("Could not encode cutout")),"image/png",1));
    const n=await addReplacement(blob,o,(o.name||"asset").replace(/\.[^.]+$/,"")+"_cutout.png",{cutoutSource:true});
    const finalCanvas=document.createElement("canvas");finalCanvas.width=w;finalCanvas.height=h;const fc=finalCanvas.getContext("2d",{willReadFrequently:true});fc.drawImage(scaled,0,0);const sourceDataUrl=await blobToDataUrl(sourceBlob),maskDataUrl=finalCanvas.toDataURL("image/png"),recordId=makeId();n.set({cutoutRecordId:recordId,cutoutSourceDataUrl:sourceDataUrl,cutoutMaskDataUrl:maskDataUrl});cutoutRecordsById.set(recordId,{sourceBlob,maskCanvas:finalCanvas});snapshot();
    backgroundRemovalError=null;toast("ISNet high-quality cutout created — original RGB preserved");setStatus("Ready")
  }catch(e){backgroundRemovalError=e?.stack||e?.message||String(e);console.error("[AssetForge ISNet]",e);toast("AI cutout failed — original kept");setStatus("Ready")}
  finally{$("bgBtn").disabled=false;$("mobileBgBtn").disabled=false}
}
$("bgBtn").onclick=removeBg;$("mobileBgBtn").onclick=removeBg;
let dbPromise=null;function db(){if(dbPromise)return dbPromise;dbPromise=new Promise((res,rej)=>{const r=indexedDB.open("asset-forge-v2",1);r.onupgradeneeded=()=>r.result.createObjectStore("assets",{keyPath:"id"});r.onsuccess=()=>res(r.result);r.onerror=()=>{dbPromise=null;rej(r.error)}});return dbPromise}
async function vaultPut(blob,name,remote=false){const d=await db(),tx=d.transaction("assets","readwrite");tx.objectStore("assets").put({id:makeId(),name,blob,remote,created:Date.now()});tx.oncomplete=renderVault}
let activeVaultObjectUrls=[];async function renderVault(){const d=await db(),r=d.transaction("assets","readonly").objectStore("assets").getAll();r.onsuccess=()=>{activeVaultObjectUrls.forEach(u=>URL.revokeObjectURL(u));activeVaultObjectUrls=[];$("vault").innerHTML="";for(const a of r.result.sort((x,y)=>y.created-x.created)){const el=document.createElement("div");el.className="asset";const img=document.createElement("img"),url=URL.createObjectURL(a.blob);activeVaultObjectUrls.push(url);img.src=url;const sm=document.createElement("small");sm.textContent=(a.remote?"☁ ":"")+a.name;el.append(img,sm);el.onclick=async()=>addRasterBlob(a.blob,a.name);$("vault").appendChild(el)}}}
$("clearVaultBtn").onclick=async()=>{const d=await db();d.transaction("assets","readwrite").objectStore("assets").clear();renderVault()};

async function selectedPng(){const b=await canvas.toBlob({format:"png",multiplier:1});if(!b)throw new Error("PNG export unavailable");lastBlob=b;return b}
function download(blob,name,kind="generic"){
  const a=document.createElement("a");a.download=name;a.style.display="none";document.body.appendChild(a);
  if(blob.type==="application/json"){const textValue=typeof blob._assetForgeText==="string"?blob._assetForgeText:null;if(textValue!==null){a.href="data:application/json;charset=utf-8,"+encodeURIComponent(textValue)}else{a.href=URL.createObjectURL(blob)}}
  else{a.href=URL.createObjectURL(blob)}
  const url=a.href;const record={name,href:url,type:blob.type,kind};window.__assetForgeLastDownload=record;window.__assetForgeLastDownloads=window.__assetForgeLastDownloads||{};window.__assetForgeLastDownloads[kind]=record;if(/^image\//.test(blob.type))window.__assetForgeLastImageDownload=record;a.click();setTimeout(()=>{if(url.startsWith("blob:"))URL.revokeObjectURL(url);a.remove()},60000)
}
async function exportSelectedManifest(){
  const o=selected()||canvas.getObjects().at(-1);if(!o)return toast("Select an asset first");
  const el=o?.type==="image"?o.getElement():null;
  const meta={version:1,type:"game-asset",name:o.name||"asset",width:el?.naturalWidth||Math.round(o.getScaledWidth?.()||0),height:el?.naturalHeight||Math.round(o.getScaledHeight?.()||0),pivotX:o.pivotX??.5,pivotY:o.pivotY??.5,rotation:o.angle||0,opacity:o.opacity??1,tags:o.assetTags||[],sourceType:o.type};
  const json=JSON.stringify(meta,null,2);const blob=new Blob([json],{type:"application/json"});Object.defineProperty(blob,"_assetForgeText",{value:json});download(blob,"asset-manifest.json","assetManifest");toast("Asset manifest exported")
}
$("exportBtn").onclick=async()=>{try{const b=await selectedPng(),o=canvas.getActiveObject(),name=((o?.name||"asset").replace(/\.[^.]+$/,"")||"asset")+".png";download(b,name,"exportImage");await vaultPut(b,name);toast("PNG exported")}catch(e){console.error(e);toast("Export failed")}};$("assetManifestBtn").onclick=exportSelectedManifest;

async function getSelectedSourceBitmap(){const o=canvas.getActiveObject();if(!o||o.type!=="image")throw new Error("Select a sprite sheet image first");return{o,src:o.getElement()}}
$("framesInputBtn")?.addEventListener("click",()=>$("framesInput")?.click());
$("framesInput")?.addEventListener("change",e=>{frameLibrary=[...e.target.files];recentFrames=[];activeFrameSource=frameLibrary.length?"manual":null;$("frameCount").textContent=frameLibrary.length+" animation frames loaded";toast(frameLibrary.length+" animation frames loaded")});
async function extractFrames(){
 const {o,src}=await getSelectedSourceBitmap(),cols=Math.max(1,+$("cols").value||1),rows=Math.max(1,+$("rows").value||1),cw=Math.max(1,Math.floor((src.naturalWidth||o.width)/cols)),ch=Math.max(1,Math.floor((src.naturalHeight||o.height)/rows)),base=(o.name||"frames").replace(/\.[^.]+$/,"");
 recentFrames=[];frameLibrary=[];activeFrameSource="extracted";for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const out=document.createElement("canvas");out.width=cw;out.height=ch;out.getContext("2d").drawImage(src,c*cw,r*ch,cw,ch,0,0,cw,ch);const b=await new Promise(res=>out.toBlob(res,"image/png",1));recentFrames.push(b);await vaultPut(b,base+"_"+String(recentFrames.length).padStart(3,"0")+".png")}
 $("frameCount").textContent=recentFrames.length+" extracted frames ready";toast(recentFrames.length+" frames extracted and ready to pack")
}
$("framesBtn").onclick=async()=>{try{await extractFrames()}catch(e){console.error(e);toast(e.message||"Frame extraction failed")}};
async function loadBitmapFromRaster(blob){
  try{return await createImageBitmap(blob)}
  catch{
    const url=URL.createObjectURL(blob);try{
      const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error("The source image could not be decoded."));i.src=url});const c=document.createElement("canvas");c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;c.getContext("2d").drawImage(img,0,0);return await createImageBitmap(c)
    }finally{URL.revokeObjectURL(url)}
  }
}
async function packFrames(){
 const frames=activeFrameSource==="manual"?frameLibrary:activeFrameSource==="extracted"?recentFrames:(frameLibrary.length?frameLibrary:recentFrames);if(!frames.length)throw new Error("Add animation frames or extract frames first");
 const cols=Math.max(1,+$("cols").value||1),rows=Math.max(1,+$("rows").value||Math.ceil(frames.length/cols)),count=Math.min(frames.length,cols*rows),gap=Math.max(0,+$("frameGap").value||0),pad=Math.max(0,+$("framePadding").value||0);
 let cw=+$("frameW").value||0,ch=+$("frameH").value||0;const bitmaps=[];for(let i=0;i<count;i++)bitmaps.push(await loadBitmapFromRaster(frames[i]));
 if(!cw)cw=Math.max(...bitmaps.map(b=>b.width));if(!ch)ch=Math.max(...bitmaps.map(b=>b.height));$("frameW").value=cw;$("frameH").value=ch;$("rows").value=rows;
 const out=document.createElement("canvas");out.width=pad*2+cols*cw+(cols-1)*gap;out.height=pad*2+rows*ch+(rows-1)*gap;const ctx=out.getContext("2d");
 for(let i=0;i<count;i++){const b=bitmaps[i],s=Math.min(cw/b.width,ch/b.height,1),w=b.width*s,h=b.height*s,x=pad+(i%cols)*(cw+gap)+(cw-w)/2,y=pad+Math.floor(i/cols)*(ch+gap)+(ch-h)/2;ctx.drawImage(b,x,y,w,h);b.close()}
 const blob=await new Promise(res=>out.toBlob(res,"image/png",1));window.__assetForgeLastSpriteSheet=blob;window.__assetForgeLastSpriteSheetDataUrl=out.toDataURL("image/png");download(blob,"sprite-sheet.png","spriteImage");await vaultPut(blob,"sprite-sheet.png");const fps=Math.max(1,+$("fps").value||12);await exportSpriteManifest({version:1,type:"sprite-sheet",columns:cols,rows,frameCount:count,frameWidth:cw,frameHeight:ch,gap,padding:pad,fps,frameDurationMs:1000/fps,frames:Array.from({length:count},(_,i)=>({index:i,x:pad+(i%cols)*(cw+gap),y:pad+Math.floor(i/cols)*(ch+gap),width:cw,height:ch,durationMs:1000/fps}))});toast(count+" frames packed into raster sprite sheet")
}
async function exportSpriteManifest(meta){
  const json=JSON.stringify(meta,null,2);const blob=new Blob([json],{type:"application/json"});Object.defineProperty(blob,"_assetForgeText",{value:json});download(blob,"sprite-sheet.json","spriteManifest")
}
$("sheetBtn").onclick=async()=>{try{await packFrames()}catch(e){console.error(e);toast(e.message||"Sprite sheet packing failed")}};
$("undoBtn").onclick=async()=>{if(history.length<2)return;future.push(history.pop());await restore(history.at(-1))};$("redoBtn").onclick=async()=>{const n=future.pop();if(n){history.push(n);await restore(n)}};
$("newBtn").onclick=()=>{canvas.clear();history=[];future=[];snapshot();$("dropHint").style.display="block";$("docName").textContent="Untitled Asset";toast("New asset")};
$("saveBtn").onclick=()=>{const data={version:3,width:+$("cw").value,height:+$("ch").value,canvas:canvas.toJSON(["name","assetId","pivotX","pivotY","assetTags","cutoutRecordId","cutoutSourceDataUrl","cutoutMaskDataUrl"])};const projectBlob=new Blob([JSON.stringify(data)],{type:"application/json"});download(projectBlob,"asset-forge-project.json","project");toast("Project saved")};
$("openBtn").onclick=()=>$("projectInput").click();$("projectInput").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const d=JSON.parse(await f.text());$("cw").value=d.width;$("ch").value=d.height;resizeEditor();await restore(JSON.stringify(d.canvas));$("dropHint").style.display="none";toast("Project opened")}catch(err){console.error(err);toast("Project file invalid")}};
$("applySize").onclick=()=>{resizeEditor();snapshot()};

function closeSheets(){document.querySelectorAll(".sidebar.open").forEach(x=>x.classList.remove("open"))}
function toggleSheet(id){$(id)?.classList.toggle("open")}
document.querySelectorAll("[data-sheet]").forEach(b=>b.onclick=()=>toggleSheet(b.dataset.sheet));
document.querySelectorAll("[data-sheet-close]").forEach(b=>b.onclick=()=>$(b.dataset.sheetClose)?.classList.remove("open"));
$("mobileCropBtn")?.addEventListener("click",()=>{if(typeof openCrop==="function")openCrop()});
$("mobileBgBtn")?.addEventListener("click",()=>removeBg());
$("mobileImportBtn")?.addEventListener("click",()=>$("fileInput").click());

$("mobileSpriteBtn")?.addEventListener("click",()=>{toggleSheet("toolPanel");setTimeout(()=>$("framesInput")?.click(),120)});
let maskEditor=null,maskMode="erase";
async function hydrateCutoutRecords(){cutoutRecordsById.clear();for(const o of canvas.getObjects()){if(!o.cutoutRecordId||!o.cutoutSourceDataUrl||!o.cutoutMaskDataUrl)continue;try{const sourceBlob=await dataUrlToBlob(o.cutoutSourceDataUrl),img=await createImageBitmap(sourceBlob),maskImg=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=o.cutoutMaskDataUrl}),maskCanvas=document.createElement("canvas");maskCanvas.width=maskImg.naturalWidth||maskImg.width;maskCanvas.height=maskImg.naturalHeight||maskImg.height;maskCanvas.getContext("2d").drawImage(maskImg,0,0);img.close();cutoutRecordsById.set(o.cutoutRecordId,{sourceBlob,maskCanvas})}catch(e){console.warn("Could not restore cutout metadata",e)}}}
async function openMaskRefine(){
 const o=selected(),rec=o&&cutoutRecordsById.get(o.cutoutRecordId);if(!rec)return toast("Select an AI cutout layer first");
 const src=await createImageBitmap(rec.sourceBlob);maskEditor={source:src,mask:rec.maskCanvas,scale:1,drawing:false};
 const view=$("maskCanvas"),max=760,scale=Math.min(max/src.width,max/src.height,1);maskEditor.scale=scale;view.width=Math.max(1,Math.round(src.width*scale));view.height=Math.max(1,Math.round(src.height*scale));
 renderMaskEditor();$("maskModal").classList.remove("hidden")
}
function renderMaskEditor(){
 if(!maskEditor)return;const view=$("maskCanvas"),v=view.getContext("2d"),src=maskEditor.source,mask=maskEditor.mask,tmp=document.createElement("canvas");tmp.width=view.width;tmp.height=view.height;const tc=tmp.getContext("2d",{willReadFrequently:true});tc.drawImage(src,0,0,tmp.width,tmp.height);const a=tc.getImageData(0,0,tmp.width,tmp.height),md=mask.getContext("2d",{willReadFrequently:true}).getImageData(0,0,mask.width,mask.height).data,s=maskEditor.scale;
 for(let y=0;y<tmp.height;y++)for(let x=0;x<tmp.width;x++){const sx=Math.min(mask.width-1,Math.floor(x/s)),sy=Math.min(mask.height-1,Math.floor(y/s));a.data[(y*tmp.width+x)*4+3]=md[(sy*mask.width+sx)*4+3]}
 v.clearRect(0,0,view.width,view.height);v.putImageData(a,0,0)
}
function paintMask(e){
 if(!maskEditor)return;const r=$("maskCanvas").getBoundingClientRect(),x=(e.clientX-r.left)/maskEditor.scale,y=(e.clientY-r.top)/maskEditor.scale,ctx=maskEditor.mask.getContext("2d"),rad=(+$("maskSize").value||50)/2,soft=(+$("maskSoft").value||0)/40;
 const edge=Math.max(.01,1-soft),g=ctx.createRadialGradient(x,y,0,x,y,rad);
 if(maskMode==="erase"){g.addColorStop(0,"rgba(0,0,0,1)");g.addColorStop(edge,"rgba(0,0,0,1)");g.addColorStop(1,"rgba(0,0,0,0)");ctx.globalCompositeOperation="destination-out"}else{g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(edge,"rgba(255,255,255,1)");g.addColorStop(1,"rgba(255,255,255,0)");ctx.globalCompositeOperation="source-over"}
 ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,rad,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation="source-over";renderMaskEditor()
}
$("refineMaskBtn")?.addEventListener("click",openMaskRefine);$("maskEraseBtn")?.addEventListener("click",()=>{maskMode="erase";$("maskEraseBtn").classList.add("active");$("maskRestoreBtn").classList.remove("active")});$("maskRestoreBtn")?.addEventListener("click",()=>{maskMode="restore";$("maskRestoreBtn").classList.add("active");$("maskEraseBtn").classList.remove("active")});
$("maskCanvas")?.addEventListener("pointerdown",e=>{e.preventDefault();$("maskCanvas").setPointerCapture(e.pointerId);maskEditor.drawing=true;paintMask(e)});$("maskCanvas")?.addEventListener("pointermove",e=>{if(maskEditor?.drawing)paintMask(e)});["pointerup","pointercancel"].forEach(n=>$("maskCanvas")?.addEventListener(n,()=>{if(maskEditor)maskEditor.drawing=false}));
$("applyMask")?.addEventListener("click",async()=>{const o=selected(),rec=o&&cutoutRecordsById.get(o.cutoutRecordId);if(!rec||!maskEditor)return;const src=await createImageBitmap(rec.sourceBlob),m=maskEditor.mask,out=document.createElement("canvas");out.width=m.width;out.height=m.height;const ctx=out.getContext("2d",{willReadFrequently:true});ctx.drawImage(src,0,0,out.width,out.height);const od=ctx.getImageData(0,0,out.width,out.height),md=m.getContext("2d",{willReadFrequently:true}).getImageData(0,0,m.width,m.height).data;for(let i=0;i<od.data.length;i+=4)od.data[i+3]=md[i+3];ctx.putImageData(od,0,0);const blob=await new Promise(res=>out.toBlob(res,"image/png",1));const n=await addReplacement(blob,o,(o.name||"cutout").replace(/_cutout\.png$/,"")+"_refined.png",{cutoutSource:true});const sourceDataUrl=await blobToDataUrl(rec.sourceBlob),maskDataUrl=m.toDataURL("image/png"),recordId=makeId();n.set({cutoutRecordId:recordId,cutoutSourceDataUrl:sourceDataUrl,cutoutMaskDataUrl:maskDataUrl});cutoutRecordsById.set(recordId,{sourceBlob:rec.sourceBlob,maskCanvas:m});snapshot();$("maskModal").classList.add("hidden");src.close();toast("Mask refinement applied")});
function b64(blob){return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result.split(",")[1]);fr.onerror=rej;fr.readAsDataURL(blob)})}
async function githubBridgeRequest(path,options={}){
  const base=(window.__ASSET_FORGE_GITHUB_BRIDGE||"/api/github").replace(/\/$/,"");
  const res=await fetch(base+path,{...options,headers:{"Accept":"application/json","Content-Type":"application/json",...(options.headers||{})}});
  const txt=await res.text();let data=null;try{data=txt?JSON.parse(txt):null}catch{data={message:txt||("HTTP "+res.status)}}
  if(!res.ok)throw new Error(data?.message||"GitHub bridge HTTP "+res.status);
  return data;
}
async function githubBridgeStatus(){try{return await githubBridgeRequest("/status")}catch{return {configured:false}}}
async function loadRepoAssets(){
  if(!github)return toast("Configure GitHub bridge first");
  setStatus("Loading repository assets…");
  try{
    const data=await githubBridgeRequest("/contents?repo="+encodeURIComponent(github.repo)+"&branch="+encodeURIComponent(github.branch)+"&path="+encodeURIComponent(github.folder));
    const files=Array.isArray(data)?data.filter(x=>x.type==="file"&&/\.(png|jpe?g|webp|avif)$/i.test(x.name)):[];
    for(const f of files){const res=await fetch(f.download_url);if(res.ok){const blob=await res.blob();await vaultPut(blob,f.name,true)}}
    await renderVault();setStatus("Ready");toast(files.length+" repository assets loaded")
  }catch(e){console.error(e);setStatus("Ready");toast("Repository load failed: "+e.message)}
}
$("repoBtn").onclick=async()=>{
  $("githubModal").classList.remove("hidden");
  if(github){$("repoName").value=github.repo;$("repoBranch").value=github.branch;$("repoFolder").value=github.folder}
  const s=await githubBridgeStatus();
  $("repoStatus").textContent=s.configured?"GitHub bridge ready":"GitHub bridge not configured";
};
$("connectRepoBtn").onclick=async()=>{
  const repoName=$("repoName").value.trim(),branch=$("repoBranch").value.trim()||"main",folder=($("repoFolder").value.trim()||"assets").replace(/^\/+|\/+$/g,"");
  if(!repoName)return toast("Repository is required");
  try{
    const s=await githubBridgeStatus();if(!s.configured)throw new Error("Set GITHUB_TOKEN on the local Asset Forge server first");
    github={repo:repoName,branch,folder};$("repoStatus").textContent="Connected: "+repoName+" @ "+branch;$("pushBtn").disabled=false;$("githubModal").classList.add("hidden");toast("GitHub bridge connected");await loadRepoAssets()
  }catch(e){$("repoStatus").textContent="Bridge unavailable";toast("GitHub connection failed: "+e.message)}
};
$("refreshRepoBtn").onclick=async()=>{
  if(!github){const repoName=$("repoName").value.trim();if(repoName)github={repo:repoName,branch:$("repoBranch").value.trim()||"main",folder:($("repoFolder").value.trim()||"assets").replace(/^\/+|\/+$/g,"")}}
  if(!github)return toast("Configure repository first");await loadRepoAssets();
};
$("pushBtn").onclick=async()=>{
  const o=canvas.getActiveObject();if(!o||o.type!=="image")return toast("Select an image asset first");
  const b=await selectedPng(),safe=((o.name||"asset").replace(/[^a-z0-9._-]+/gi,"_")||"asset").replace(/\.png$/i,"")+".png",path=github.folder+"/"+safe;
  setStatus("Saving to GitHub…");
  try{
    let sha;
    try{
      const old=await githubBridgeRequest("/contents?repo="+encodeURIComponent(github.repo)+"&branch="+encodeURIComponent(github.branch)+"&path="+encodeURIComponent(path));
      sha=old?.sha;
    }catch(e){
      if(!/404|not found/i.test(e?.message||""))throw new Error("Could not verify existing GitHub file before save: "+(e?.message||e));
    }
    await githubBridgeRequest("/file",{method:"PUT",body:JSON.stringify({repo:github.repo,branch:github.branch,path,message:"Asset Forge: save "+safe,content:await b64(b),...(sha?{sha}:{})})});
    setStatus("Ready");toast("Saved to GitHub: "+path);await loadRepoAssets()
  }catch(e){console.error(e);setStatus("Ready");toast("GitHub save failed: "+e.message)}
};

function fitCanvas(){fit();canvas.requestRenderAll();return {zoom:canvas.getZoom()}}
function zoomBy(mult){
  const z=Math.max(.1,Math.min(4,canvas.getZoom()*mult));
  const st=$("stage"),p=new fabric.Point(st.clientWidth/2,st.clientHeight/2);
  canvas.zoomToPoint(p,z);canvas.requestRenderAll();$("zoomLabel").textContent=Math.round(z*100)+"%";return {zoom:z}
}
function refreshVault(){return renderVault()}
window.AssetForgeAgent={
  status:()=>{const o=canvas.getActiveObject(),el=o?.type==="image"?o.getElement():null;return {canvas:{width:canvas.width,height:canvas.height},objects:canvas.getObjects().length,selected:o?.name||null,selectedType:o?.type||null,selectedSize:el?{width:el.naturalWidth||o.width,height:el.naturalHeight||o.height}:null,selectedAssetId:o?.assetId||null,zoom:canvas.getZoom(),github:!!github,backgroundRemovalError,frameSource:activeFrameSource,historyDepth:history.length};},
  upload:addRasterBlob,
  removeBackground:removeBg,
  cropSelected:async(x,y,w,h)=>{const o=canvas.getActiveObject();if(!o||o.type!=="image")throw new Error("Select image");return imageFromCrop(o,x,y,w,h)},
  trimSelected:trimTransparent,
  exportPng:selectedPng,
  getLastDownload:()=>window.__assetForgeLastDownload||null,saveSelectedToGitHub:async()=>{if(!$("pushBtn").disabled)return $("pushBtn").click();throw new Error("GitHub is not connected")},
  pixelAudit:async()=>{
    const o=selected(),rec=o&&cutoutRecordsById.get(o.cutoutRecordId);if(!rec)return null;
    const src=await createImageBitmap(rec.sourceBlob),out=o.getElement(),w=Math.min(src.width,out.width),h=Math.min(src.height,out.height),a=document.createElement("canvas"),b=document.createElement("canvas");
    a.width=b.width=w;a.height=b.height=h;
    const ac=a.getContext("2d",{willReadFrequently:true}),bc=b.getContext("2d",{willReadFrequently:true});ac.drawImage(src,0,0,w,h);bc.drawImage(out,0,0,w,h);
    const A=ac.getImageData(0,0,w,h).data,B=bc.getImageData(0,0,w,h).data;
    let sum=0,count=0,opaque=0,transparent=0,soft=0,maxAlpha=0,alphaSum=0,nonzero=0;
    for(let i=0;i<A.length;i+=4){
      const alpha=B[i+3];maxAlpha=Math.max(maxAlpha,alpha);alphaSum+=alpha;if(alpha>0)nonzero++;
      if(alpha>240){sum+=Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2]);count++;opaque++}
      else if(alpha<20)transparent++;else soft++;
    }
    src.close();
    return{meanRgbDelta:count?sum/(count*3):999,opaqueFraction:opaque/(w*h),transparentFraction:transparent/(w*h),softEdgeFraction:soft/(w*h),nonzeroFraction:nonzero/(w*h),meanAlpha:alphaSum/(w*h),maxAlpha,width:w,height:h}
  },
  rasterSignature:async()=>{
    const o=selected(),el=o?.type==="image"?o.getElement():null;if(!el)return null;
    const w=el.naturalWidth||el.width,h=el.naturalHeight||el.height,c=document.createElement("canvas");c.width=w;c.height=h;
    const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(el,0,0,w,h);const d=ctx.getImageData(0,0,w,h).data;
    let hash=2166136261>>>0,nonZero=0,alphaSum=0;
    for(let i=0;i<d.length;i++){hash^=d[i];hash=Math.imul(hash,16777619)>>>0;if(i%4===3){if(d[i])nonZero++;alphaSum+=d[i]}}
    return {width:w,height:h,hash,nonZeroPixels:nonZero,meanAlpha:alphaSum/(w*h)};
  },
  pivotWorldPoint:(name)=>{const o=name?canvas.getObjects().find(x=>(x.name||"")===name):selected();return o?pivotWorldPoint(o):null},
  exportSelectedManifest,fit:fitCanvas,zoomBy,refreshVault,deleteSelected,
  loadGitHubAssets:loadRepoAssets
};

function installTouchGestures(){
 const stage=$("stage"),points=new Map();let g=null;
 stage.addEventListener("pointerdown",e=>{points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===2){const p=[...points.values()];g={dist:Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),zoom:canvas.getZoom(),cx:(p[0].x+p[1].x)/2,cy:(p[0].y+p[1].y)/2,tx:canvas.viewportTransform[4],ty:canvas.viewportTransform[5]};canvas.skipTargetFind=true}}, {passive:false});
 stage.addEventListener("pointermove",e=>{if(points.has(e.pointerId))points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size!==2||!g)return;const p=[...points.values()],dist=Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),z=Math.max(.1,Math.min(4,g.zoom*dist/g.dist)),cx=(p[0].x+p[1].x)/2,cy=(p[0].y+p[1].y)/2;canvas.zoomToPoint(new fabric.Point(g.cx,g.cy),z);canvas.viewportTransform[4]=g.tx+(cx-g.cx);canvas.viewportTransform[5]=g.ty+(cy-g.cy);canvas.requestRenderAll();$("zoomLabel").textContent=Math.round(z*100)+"%";e.preventDefault()},{passive:false});
 const up=e=>{points.delete(e.pointerId);if(points.size<2){g=null;canvas.skipTargetFind=false}};stage.addEventListener("pointerup",up);stage.addEventListener("pointercancel",up);window.addEventListener("resize",fit)
}
installTouchGestures();
canvas.on("object:added",e=>{if(e.target){e.target.__pivotLastAngle=e.target.angle||0}if(!restoring)snapshot();syncProps();renderLayers()});
canvas.on("object:rotating",e=>{
  const o=e.target;if(!o||restoring||pivotTransformGuard)return;
  const prev=Number.isFinite(o.__pivotLastAngle)?o.__pivotLastAngle:(o.angle||0);
  if(Math.abs((o.angle||0)-prev)<0.0001)return;
  const worldPivot=pivotWorldPoint(o,prev),nextVec=rotateVec(pivotLocalVector(o),o.angle||0);
  const nextCenter={x:worldPivot.x-nextVec.x,y:worldPivot.y-nextVec.y};
  pivotTransformGuard=true;try{o.setPositionByOrigin(new fabric.Point(nextCenter.x,nextCenter.y),"center","center");o.setCoords();o.__pivotLastAngle=o.angle||0}finally{pivotTransformGuard=false}
  if(!restoring)snapshot();
});canvas.on("object:modified",()=>{if(!restoring)snapshot();syncProps();renderLayers()});canvas.on("selection:created",()=>{syncProps();renderLayers()});canvas.on("selection:updated",()=>{syncProps();renderLayers()});canvas.on("selection:cleared",()=>{syncProps();renderLayers()});canvas.on("object:removed",()=>{syncProps();renderLayers()});
document.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();$("undoBtn").click()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();$("redoBtn").click()}if(e.key==="Delete"&&document.querySelector(".modal:not(.hidden)")===null)$("deleteBtn").click()};
$("brightness").value=$("contrast").value=$("saturation").value=$("blur").value=0;
resizeEditor();snapshot();renderLayers();renderVault();