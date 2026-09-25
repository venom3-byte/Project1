const $=id=>document.getElementById(id);
const selected=()=>canvas.getActiveObject();
const cutoutRecords=new WeakMap();
const canvas=new fabric.Canvas("editorCanvas",{preserveObjectStacking:true,selection:true,allowTouchScrolling:false,enableRetinaScaling:true,stopContextMenu:true});
let history=[],future=[],restoring=false,cropTarget=null,github=null,lastBlob=null,recentFrames=[],frameLibrary=[],backgroundRemovalError=null;
const state={name:"Untitled Asset",canvasWidth:1024,canvasHeight:1024};
const setStatus=s=>$("status").textContent=s;
const toast=s=>{const t=$("toast");t.textContent=s;t.className="show";clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.className="",2200)};
function snapshot(){if(restoring)return;const j=JSON.stringify(canvas.toJSON(["name","assetId"]));if(history.at(-1)!==j){history.push(j);if(history.length>80)history.shift();future=[]}}
async function restore(j){restoring=true;await canvas.loadFromJSON(JSON.parse(j));canvas.renderAll();syncProps();restoring=false}
function resizeEditor(){const w=+$("cw").value||1024,h=+$("ch").value||1024;state.canvasWidth=w;state.canvasHeight=h;canvas.setDimensions({width:w,height:h});$("dimensions").textContent=w+" × "+h;fit()}
function fit(){const st=$("stage"),z=Math.min((st.clientWidth-48)/canvas.width,(st.clientHeight-48)/canvas.height,1);canvas.setZoom(z);canvas.setDimensions({width:canvas.width*z,height:canvas.height*z},"cssOnly");$("zoomLabel").textContent=Math.round(z*100)+"%"}
window.addEventListener("resize",fit);

async function addRasterBlob(blob,name="asset.png"){const url=URL.createObjectURL(blob);try{return await addRasterUrl(url,name)}finally{URL.revokeObjectURL(url)}}
async function addRasterUrl(url,name="asset.png"){const img=await fabric.FabricImage.fromURL(url,{crossOrigin:"anonymous"}),w=+$("cw").value||1024,h=+$("ch").value||1024,s=Math.min((w*.82)/img.width,(h*.82)/img.height,1);img.set({left:(w-img.width*s)/2,top:(h-img.height*s)/2,scaleX:s,scaleY:s,name,angle:0,pivotX:.5,pivotY:.5,assetTags:[]});canvas.add(img);canvas.setActiveObject(img);canvas.renderAll();$("dropHint").style.display="none";snapshot();syncProps();return img}
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
function updateProps(){const o=canvas.getActiveObject();if(!o)return;o.set({left:+$("px").value||0,top:+$("py").value||0,angle:+$("prot").value||0,opacity:+$("pop").value,pivotX:Number.isFinite(+$("pivotX").value)?Math.max(0,Math.min(1,+$("pivotX").value)):.5,pivotY:Number.isFinite(+$("pivotY").value)?Math.max(0,Math.min(1,+$("pivotY").value)):.5});const w=+$("pw").value,h=+$("ph").value;if(w>0&&o.width)o.scaleX=w/o.width;if(h>0&&o.height)o.scaleY=h/o.height;canvas.requestRenderAll();snapshot()}
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
    c.set({left:(o.left||0)+20,top:(o.top||0)+20,name:(o.name||"asset")+"_copy",assetId:crypto.randomUUID(),pivotX:o.pivotX??.5,pivotY:o.pivotY??.5,angle:o.angle||0,opacity:o.opacity??1,filters:o.filters||[]});
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

async function addReplacement(blob,old,name){const url=URL.createObjectURL(blob);try{const n=await fabric.FabricImage.fromURL(url);n.set({left:old.left,top:old.top,angle:old.angle,opacity:old.opacity,scaleX:old.scaleX,scaleY:old.scaleY,name});canvas.remove(old);canvas.add(n);canvas.setActiveObject(n);canvas.renderAll();snapshot();syncProps();await vaultPut(blob,name);lastBlob=blob;return n}finally{URL.revokeObjectURL(url)}}
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
  if(!navigator.gpu||!window.isSecureContext)return {device:"wasm",dtype:"fp32"};
  try{const adapter=await navigator.gpu.requestAdapter();if(!adapter)return{device:"wasm",dtype:"fp32"};return{device:"webgpu",dtype:adapter.features?.has?.("shader-f16")?"fp16":"fp32"}}catch{return{device:"wasm",dtype:"fp32"}}
}
async function getBackgroundPipeline(){
  if(backgroundPipeline)return backgroundPipeline;
  if(backgroundPipelinePromise)return backgroundPipelinePromise;
  backgroundPipelinePromise=(async()=>{
    const {pipeline}=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm");
    const cfg=await detectInferenceConfig();
    setStatus("Loading BEN2 background-removal model ("+cfg.device+" / "+cfg.dtype+")…");
    try{
      const pipe=await pipeline("background-removal","onnx-community/BEN2-ONNX",{device:cfg.device,dtype:cfg.dtype});
      backgroundPipeline=pipe;return pipe
    }catch(e){
      if(cfg.device==="webgpu"){
        const pipe=await pipeline("background-removal","onnx-community/BEN2-ONNX",{device:"wasm",dtype:"fp32"});
        backgroundPipeline=pipe;return pipe
      }
      throw e
    }
  })().catch(e=>{backgroundPipelinePromise=null;throw e});
  return backgroundPipelinePromise
}
async function extractAlphaFromRawImage(raw){
  const rgba=typeof raw?.rgba==="function"?raw.rgba():raw;
  if(!rgba?.width||!rgba?.height||!rgba?.data)throw new Error("BEN2 returned no usable RGBA image");
  const w=rgba.width,h=rgba.height,stride=Math.max(1,Math.floor(rgba.data.length/(w*h))),data=new Uint8ClampedArray(rgba.data);
  const mask=document.createElement("canvas");mask.width=w;mask.height=h;const ctx=mask.getContext("2d",{willReadFrequently:true}),out=new ImageData(w,h),od=out.data;
  for(let i=0,p=0;i<w*h;i++,p+=4){let a=stride>=4?data[i*stride+3]:data[i*stride];if(a<=1)a*=255;a=Math.max(0,Math.min(255,a));od[p]=255;od[p+1]=255;od[p+2]=255;od[p+3]=a}
  ctx.putImageData(out,0,0);return{maskCanvas:mask,width:w,height:h}
}
async function removeBg(){
  const o=selected();if(!o||o.type!=="image")return toast("Select an image first");
  $("bgBtn").disabled=true;$("mobileBgBtn").disabled=true;setStatus("Preparing original pixels…");
  try{
    const sourceBlob=await blobFromObject(o);setStatus("BEN2 high-quality segmentation…");
    const pipe=await getBackgroundPipeline();const rawResult=await pipe(sourceBlob);const result=Array.isArray(rawResult)?rawResult[0]:rawResult;
    const {maskCanvas}=await extractAlphaFromRawImage(result);setStatus("Applying original RGB + BEN2 alpha matte…");
    const source=await createImageBitmap(sourceBlob),w=source.width,h=source.height,out=document.createElement("canvas");out.width=w;out.height=h;
    const octx=out.getContext("2d",{willReadFrequently:true}),mctx=maskCanvas.getContext("2d",{willReadFrequently:true});
    const scaled=document.createElement("canvas");scaled.width=w;scaled.height=h;const sctx=scaled.getContext("2d",{willReadFrequently:true});sctx.drawImage(maskCanvas,0,0,w,h);
    octx.drawImage(source,0,0,w,h);const od=octx.getImageData(0,0,w,h),md=sctx.getImageData(0,0,w,h).data;
    for(let i=0;i<od.data.length;i+=4)od.data[i+3]=md[i+3];
    octx.putImageData(od,0,0);source.close();
    const blob=await new Promise((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(new Error("Could not encode cutout")),"image/png",1));
    const n=await addReplacement(blob,o,(o.name||"asset").replace(/\.[^.]+$/,"")+"_cutout.png",{cutoutSource:true});
    const finalCanvas=document.createElement("canvas");finalCanvas.width=w;finalCanvas.height=h;const fc=finalCanvas.getContext("2d",{willReadFrequently:true});fc.drawImage(scaled,0,0);cutoutRecords.set(n,{sourceBlob,maskCanvas:finalCanvas});
    backgroundRemovalError=null;toast("BEN2 high-quality cutout created — original RGB preserved");setStatus("Ready")
  }catch(e){backgroundRemovalError=e?.stack||e?.message||String(e);console.error("[AssetForge BEN2]",e);toast("AI cutout failed — original kept");setStatus("Ready")}
  finally{$("bgBtn").disabled=false;$("mobileBgBtn").disabled=false}
}
$("bgBtn").onclick=removeBg;$("mobileBgBtn").onclick=removeBg;
function db(){return new Promise((res,rej)=>{const r=indexedDB.open("asset-forge-v2",1);r.onupgradeneeded=()=>r.result.createObjectStore("assets",{keyPath:"id"});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function vaultPut(blob,name,remote=false){const d=await db(),tx=d.transaction("assets","readwrite");tx.objectStore("assets").put({id:crypto.randomUUID(),name,blob,remote,created:Date.now()});tx.oncomplete=renderVault}
async function renderVault(){const d=await db(),r=d.transaction("assets","readonly").objectStore("assets").getAll();r.onsuccess=()=>{$("vault").innerHTML="";for(const a of r.result.sort((x,y)=>y.created-x.created)){const el=document.createElement("div");el.className="asset";const img=document.createElement("img");img.src=URL.createObjectURL(a.blob);const sm=document.createElement("small");sm.textContent=(a.remote?"☁ ":"")+a.name;el.append(img,sm);el.onclick=async()=>addRasterBlob(a.blob,a.name);$("vault").appendChild(el)}}}
$("clearVaultBtn").onclick=async()=>{const d=await db();d.transaction("assets","readwrite").objectStore("assets").clear();renderVault()};

async function selectedPng(){const b=await canvas.toBlob({format:"png",multiplier:1});if(!b)throw new Error("PNG export unavailable");lastBlob=b;return b}
function download(blob,name){
  const a=document.createElement("a");a.download=name;a.style.display="none";document.body.appendChild(a);
  if(blob.type==="application/json"){const textValue=typeof blob._assetForgeText==="string"?blob._assetForgeText:null;if(textValue!==null){a.href="data:application/json;charset=utf-8,"+encodeURIComponent(textValue)}else{a.href=URL.createObjectURL(blob)}}
  else{a.href=URL.createObjectURL(blob)}
  const url=a.href;window.__assetForgeLastDownload={name,href:url,type:blob.type};a.click();setTimeout(()=>{if(url.startsWith("blob:"))URL.revokeObjectURL(url);a.remove()},60000)
}
async function exportSelectedManifest(){
  const o=selected()||canvas.getObjects().at(-1);if(!o)return toast("Select an asset first");
  const el=o?.type==="image"?o.getElement():null;
  const meta={version:1,type:"game-asset",name:o.name||"asset",width:el?.naturalWidth||Math.round(o.getScaledWidth?.()||0),height:el?.naturalHeight||Math.round(o.getScaledHeight?.()||0),pivotX:o.pivotX??.5,pivotY:o.pivotY??.5,rotation:o.angle||0,opacity:o.opacity??1,tags:o.assetTags||[],sourceType:o.type};
  const json=JSON.stringify(meta,null,2);const blob=new Blob([json],{type:"application/json"});Object.defineProperty(blob,"_assetForgeText",{value:json});download(blob,"asset-manifest.json");toast("Asset manifest exported")
}
$("exportBtn").onclick=async()=>{try{const b=await selectedPng(),o=canvas.getActiveObject(),name=((o?.name||"asset").replace(/\.[^.]+$/,"")||"asset")+".png";download(b,name);await vaultPut(b,name);toast("PNG exported")}catch(e){console.error(e);toast("Export failed")}};$("assetManifestBtn").onclick=exportSelectedManifest;

async function getSelectedSourceBitmap(){const o=canvas.getActiveObject();if(!o||o.type!=="image")throw new Error("Select a sprite sheet image first");return{o,src:o.getElement()}}
$("framesInputBtn")?.addEventListener("click",()=>$("framesInput")?.click());
$("framesInput")?.addEventListener("change",e=>{frameLibrary=[...e.target.files];$("frameCount").textContent=frameLibrary.length+" animation frames loaded";toast(frameLibrary.length+" animation frames loaded")});
async function extractFrames(){
 const {o,src}=await getSelectedSourceBitmap(),cols=Math.max(1,+$("cols").value||1),rows=Math.max(1,+$("rows").value||1),cw=Math.max(1,Math.floor((src.naturalWidth||o.width)/cols)),ch=Math.max(1,Math.floor((src.naturalHeight||o.height)/rows)),base=(o.name||"frames").replace(/\.[^.]+$/,"");
 recentFrames=[];for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const out=document.createElement("canvas");out.width=cw;out.height=ch;out.getContext("2d").drawImage(src,c*cw,r*ch,cw,ch,0,0,cw,ch);const b=await new Promise(res=>out.toBlob(res,"image/png",1));recentFrames.push(b);await vaultPut(b,base+"_"+String(recentFrames.length).padStart(3,"0")+".png")}
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
 const frames=frameLibrary.length?frameLibrary:recentFrames;if(!frames.length)throw new Error("Add animation frames or extract frames first");
 const cols=Math.max(1,+$("cols").value||1),rows=Math.max(1,+$("rows").value||Math.ceil(frames.length/cols)),count=Math.min(frames.length,cols*rows),gap=Math.max(0,+$("frameGap").value||0),pad=Math.max(0,+$("framePadding").value||0);
 let cw=+$("frameW").value||0,ch=+$("frameH").value||0;const bitmaps=[];for(let i=0;i<count;i++)bitmaps.push(await loadBitmapFromRaster(frames[i]));
 if(!cw)cw=Math.max(...bitmaps.map(b=>b.width));if(!ch)ch=Math.max(...bitmaps.map(b=>b.height));
 const out=document.createElement("canvas");out.width=pad*2+cols*cw+(cols-1)*gap;out.height=pad*2+rows*ch+(rows-1)*gap;const ctx=out.getContext("2d");
 for(let i=0;i<count;i++){const b=bitmaps[i],s=Math.min(cw/b.width,ch/b.height,1),w=b.width*s,h=b.height*s,x=pad+(i%cols)*(cw+gap)+(cw-w)/2,y=pad+Math.floor(i/cols)*(ch+gap)+(ch-h)/2;ctx.drawImage(b,x,y,w,h);b.close()}
 const blob=await new Promise(res=>out.toBlob(res,"image/png",1));download(blob,"sprite-sheet.png");await vaultPut(blob,"sprite-sheet.png");const fps=Math.max(1,+$("fps").value||12);await exportSpriteManifest({version:1,type:"sprite-sheet",columns:cols,rows,frameCount:count,frameWidth:cw,frameHeight:ch,gap,padding:pad,fps,frameDurationMs:1000/fps,frames:Array.from({length:count},(_,i)=>({index:i,x:pad+(i%cols)*(cw+gap),y:pad+Math.floor(i/cols)*(ch+gap),width:cw,height:ch,durationMs:1000/fps}))});toast(count+" frames packed into raster sprite sheet")
}
async function exportSpriteManifest(meta){
  const json=JSON.stringify(meta,null,2);const blob=new Blob([json],{type:"application/json"});Object.defineProperty(blob,"_assetForgeText",{value:json});download(blob,"sprite-sheet.json")
}
$("sheetBtn").onclick=async()=>{try{await packFrames()}catch(e){console.error(e);toast(e.message||"Sprite sheet packing failed")}};
$("undoBtn").onclick=async()=>{if(history.length<2)return;future.push(history.pop());await restore(history.at(-1))};$("redoBtn").onclick=async()=>{const n=future.pop();if(n){history.push(n);await restore(n)}};
$("newBtn").onclick=()=>{canvas.clear();history=[];future=[];snapshot();$("dropHint").style.display="block";$("docName").textContent="Untitled Asset";toast("New asset")};
$("saveBtn").onclick=()=>{const data={version:2,width:+$("cw").value,height:+$("ch").value,canvas:canvas.toJSON(["name","assetId"])};download(new Blob([JSON.stringify(data)],{type:"application/json"}),"asset-forge-project.json");toast("Project saved")};
$("openBtn").onclick=()=>$("projectInput").click();$("projectInput").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const d=JSON.parse(await f.text());$("cw").value=d.width;$("ch").value=d.height;resizeEditor();await restore(JSON.stringify(d.canvas));$("dropHint").style.display="none";toast("Project opened")}catch(err){console.error(err);toast("Project file invalid")}};
$("applySize").onclick=()=>{resizeEditor();snapshot()};

function closeSheets(){document.querySelectorAll(".sidebar.open").forEach(x=>x.classList.remove("open"))}
function toggleSheet(id){$(id)?.classList.toggle("open")}
document.querySelectorAll("[data-sheet]").forEach(b=>b.onclick=()=>toggleSheet(b.dataset.sheet));
document.querySelectorAll("[data-sheet-close]").forEach(b=>b.onclick=()=>$(b.dataset.sheetClose)?.classList.remove("open"));
$("mobileCropBtn")?.addEventListener("click",()=>{if(typeof openCrop==="function")openCrop()});
$("mobileBgBtn")?.addEventListener("click",()=>removeBg());
$("mobileImportBtn")?.addEventListener("click",()=>$("fileInput").click());
$("mobileExportBtn")?.addEventListener("click",()=>exportPng());
$("mobileSpriteBtn")?.addEventListener("click",()=>{toggleSheet("toolPanel");setTimeout(()=>$("framesInput")?.click(),120)});
let maskEditor=null,maskMode="erase";
async function openMaskRefine(){
 const o=selected(),rec=o&&cutoutRecords.get(o);if(!rec)return toast("Select an AI cutout layer first");
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
$("applyMask")?.addEventListener("click",async()=>{const o=selected(),rec=o&&cutoutRecords.get(o);if(!rec||!maskEditor)return;const src=await createImageBitmap(rec.sourceBlob),m=maskEditor.mask,out=document.createElement("canvas");out.width=m.width;out.height=m.height;const ctx=out.getContext("2d",{willReadFrequently:true});ctx.drawImage(src,0,0,out.width,out.height);const od=ctx.getImageData(0,0,out.width,out.height),md=m.getContext("2d",{willReadFrequently:true}).getImageData(0,0,m.width,m.height).data;for(let i=0;i<od.data.length;i+=4)od.data[i+3]=md[i+3];ctx.putImageData(od,0,0);const blob=await new Promise(res=>out.toBlob(res,"image/png",1));const n=await addReplacement(blob,o,(o.name||"cutout").replace(/_cutout\.png$/,"")+"_refined.png",{cutoutSource:true});cutoutRecords.set(n,{sourceBlob:rec.sourceBlob,maskCanvas:m});$("maskModal").classList.add("hidden");src.close();toast("Mask refinement applied")});
function b64(blob){return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result.split(",")[1]);fr.onerror=rej;fr.readAsDataURL(blob)})}
async function githubFetch(path,options={}){if(!github)throw new Error("GitHub is not connected");const res=await fetch("https://api.github.com/repos/"+github.repo+"/contents/"+path+"?ref="+encodeURIComponent(github.branch),{...options,headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+github.token,...(options.headers||{})}});const txt=await res.text();let data=null;try{data=JSON.parse(txt)}catch{}if(!res.ok)throw new Error(data?.message||"GitHub API "+res.status);return data}
async function loadRepoAssets(){if(!github)return toast("Connect GitHub first");setStatus("Loading repository assets…");try{const data=await githubFetch(github.folder);const files=Array.isArray(data)?data.filter(x=>x.type==="file"&&/\.(png|jpe?g|webp|avif)$/i.test(x.name)):[];for(const f of files){const res=await fetch(f.download_url);if(res.ok){const blob=await res.blob();await vaultPut(blob,f.name,true)}}await renderVault();setStatus("Ready");toast(files.length+" repository assets loaded")}catch(e){console.error(e);setStatus("Ready");toast("Repository load failed: "+e.message)}}
$("repoBtn").onclick=()=>{$("githubModal").classList.remove("hidden");if(github){$("repoName").value=github.repo;$("repoBranch").value=github.branch;$("repoFolder").value=github.folder}};
$("connectRepoBtn").onclick=async()=>{const token=$("repoToken").value.trim(),repoName=$("repoName").value.trim(),branch=$("repoBranch").value.trim()||"main",folder=($("repoFolder").value.trim()||"assets").replace(/^\/+|\/+$/g,"");if(!token||!repoName)return toast("Repository and token are required");github={token,repo:repoName,branch,folder};$("repoStatus").textContent="Connected: "+repoName+" @ "+branch;$("pushBtn").disabled=false;$("githubModal").classList.add("hidden");toast("GitHub connected");await loadRepoAssets()};
$("refreshRepoBtn").onclick=async()=>{const token=$("repoToken").value.trim();if(!github&&token){github={token,repo:$("repoName").value.trim(),branch:$("repoBranch").value.trim()||"main",folder:($("repoFolder").value.trim()||"assets").replace(/^\/+|\/+$/g,"")}}if(!github)return toast("Connect GitHub first");await loadRepoAssets()};
$("pushBtn").onclick=async()=>{const o=canvas.getActiveObject();if(!o||o.type!=="image")return toast("Select an image asset first");const b=await selectedPng(),safe=((o.name||"asset").replace(/[^a-z0-9._-]+/gi,"_")||"asset").replace(/\.png$/i,"")+".png",path=github.folder+"/"+safe;setStatus("Saving to GitHub…");try{let sha;try{const old=await githubFetch(path);sha=old.sha}catch{}const body=JSON.stringify({message:"Asset Forge: save "+safe,content:await b64(b),branch:github.branch,...(sha?{sha}:{})});const res=await fetch("https://api.github.com/repos/"+github.repo+"/contents/"+path,{method:"PUT",headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+github.token,"Content-Type":"application/json"},body});const data=await res.json();if(!res.ok)throw new Error(data?.message||"Upload failed");setStatus("Ready");toast("Saved to GitHub: "+path);await loadRepoAssets()}catch(e){console.error(e);setStatus("Ready");toast("GitHub save failed: "+e.message)}};

window.AssetForgeAgent={
  status:()=>{const o=canvas.getActiveObject(),el=o?.type==="image"?o.getElement():null;return {canvas:{width:canvas.width,height:canvas.height},objects:canvas.getObjects().length,selected:o?.name||null,selectedSize:el?{width:el.naturalWidth||o.width,height:el.naturalHeight||o.height}:null,github:!!github,backgroundRemovalError};},
  upload:addRasterBlob,
  removeBackground:removeBg,
  cropSelected:async(x,y,w,h)=>{const o=canvas.getActiveObject();if(!o||o.type!=="image")throw new Error("Select image");return imageFromCrop(o,x,y,w,h)},
  trimSelected:trimTransparent,
  exportPng:selectedPng,
  getLastDownload:()=>window.__assetForgeLastDownload||null,saveSelectedToGitHub:async()=>{if(!$("pushBtn").disabled)return $("pushBtn").click();throw new Error("GitHub is not connected")},
  pixelAudit:async()=>{
    const o=selected(),rec=o&&cutoutRecords.get(o);if(!rec)return null;
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
  exportSelectedManifest,
  loadGitHubAssets:loadRepoAssets
};

function installTouchGestures(){
 const stage=$("stage"),points=new Map();let g=null;
 stage.addEventListener("pointerdown",e=>{points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===2){const p=[...points.values()];g={dist:Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),zoom:canvas.getZoom(),cx:(p[0].x+p[1].x)/2,cy:(p[0].y+p[1].y)/2,tx:canvas.viewportTransform[4],ty:canvas.viewportTransform[5]};canvas.skipTargetFind=true}}, {passive:false});
 stage.addEventListener("pointermove",e=>{if(points.has(e.pointerId))points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size!==2||!g)return;const p=[...points.values()],dist=Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),z=Math.max(.1,Math.min(4,g.zoom*dist/g.dist)),cx=(p[0].x+p[1].x)/2,cy=(p[0].y+p[1].y)/2;canvas.zoomToPoint(new fabric.Point(g.cx,g.cy),z);canvas.viewportTransform[4]=g.tx+(cx-g.cx);canvas.viewportTransform[5]=g.ty+(cy-g.cy);canvas.requestRenderAll();$("zoomLabel").textContent=Math.round(z*100)+"%";e.preventDefault()},{passive:false});
 const up=e=>{points.delete(e.pointerId);if(points.size<2){g=null;canvas.skipTargetFind=false}};stage.addEventListener("pointerup",up);stage.addEventListener("pointercancel",up);window.addEventListener("resize",fit)
}
installTouchGestures();
canvas.on("object:added",()=>{if(!restoring)snapshot();syncProps();renderLayers()});canvas.on("object:modified",()=>{if(!restoring)snapshot();syncProps();renderLayers()});canvas.on("selection:created",()=>{syncProps();renderLayers()});canvas.on("selection:updated",()=>{syncProps();renderLayers()});canvas.on("selection:cleared",()=>{syncProps();renderLayers()});canvas.on("object:removed",()=>{syncProps();renderLayers()});
document.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();$("undoBtn").click()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();$("redoBtn").click()}if(e.key==="Delete"&&document.querySelector(".modal:not(.hidden)")===null)$("deleteBtn").click()};
$("brightness").value=$("contrast").value=$("saturation").value=$("blur").value=0;
resizeEditor();snapshot();renderLayers();renderVault();