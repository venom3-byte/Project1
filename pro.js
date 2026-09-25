/* Asset Forge Studio PRO interaction/automation bridge.
   The bridge is intentionally DOM/API based so Playwright, local agents and future MCP browser
   controllers can drive the same actions a human uses. */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const q=s=>document.querySelector(s);
const qa=s=>[...document.querySelectorAll(s)];
const toastPro=s=>q("#toast")&&((q("#toast").textContent=s,q("#toast").className="show",clearTimeout(window.__toastPro),window.__toastPro=setTimeout(()=>q("#toast").className="",2400)));
const agent=()=>window.AssetForgeAgent;

function installSheetPolish(){
  qa(".sidebar .sheet-head").forEach(head=>{
    if(!head.querySelector(".sheet-grip")){
      const grip=document.createElement("div");grip.className="sheet-grip";head.prepend(grip);
    }
    if(!head.nextElementSibling?.classList.contains("sheet-scroll-shadow")){
      const shadow=document.createElement("div");shadow.className="sheet-scroll-shadow";head.after(shadow);
    }
    const panel=head.closest(".sidebar"),shadow=head.nextElementSibling;
    const update=()=>shadow.style.opacity=panel.scrollTop>8?"1":"0";
    panel.addEventListener("scroll",update,{passive:true});update();
  });
}

function installCropHandles(){
  const box=q("#cropBox"),preview=q("#cropPreview");
  if(!box||!preview||box.dataset.proReady==="1")return;
  box.dataset.proReady="1";
  ["nw","ne","sw","se"].forEach(cls=>{
    const h=document.createElement("div");h.className="crop-handle "+cls;h.dataset.handle=cls;box.appendChild(h);
    h.addEventListener("pointerdown",e=>{
      e.preventDefault();e.stopPropagation();h.setPointerCapture(e.pointerId);
      const r=preview.getBoundingClientRect(),iw=+q("#cropW").dataset.iw||1,ih=+q("#cropH").dataset.ih||1;
      const sx=preview.clientWidth/iw,sy=preview.clientHeight/ih;
      const x0=+q("#cropX").value||0,y0=+q("#cropY").value||0,w0=+q("#cropW").value||iw,h0=+q("#cropH").value||ih;
      const start={px:e.clientX,py:e.clientY,x:x0,y:y0,w:w0,h:h0};
      const move=ev=>{
        let dx=(ev.clientX-start.px)/Math.max(.0001,sx),dy=(ev.clientY-start.py)/Math.max(.0001,sy);
        let x=start.x,y=start.y,w=start.w,h=start.h;
        if(cls.includes("n")){y=Math.max(0,Math.min(ih-1,start.y+dy));h=Math.max(1,start.h-(y-start.y))}
        if(cls.includes("s")){h=Math.max(1,Math.min(ih-start.y,start.h+dy))}
        if(cls.includes("w")){x=Math.max(0,Math.min(iw-1,start.x+dx));w=Math.max(1,start.w-(x-start.x))}
        if(cls.includes("e")){w=Math.max(1,Math.min(iw-start.x,start.w+dx))}
        q("#cropX").value=Math.round(x);q("#cropY").value=Math.round(y);q("#cropW").value=Math.round(w);q("#cropH").value=Math.round(h);
        q("#cropX").dispatchEvent(new Event("input",{bubbles:true}));
      };
      const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
      window.addEventListener("pointermove",move,{passive:false});window.addEventListener("pointerup",up,{once:true});
    });
  });
  box.addEventListener("pointerdown",e=>{
    if(e.target.classList.contains("crop-handle"))return;
    e.preventDefault();box.setPointerCapture?.(e.pointerId);
    const iw=+q("#cropW").dataset.iw||1,ih=+q("#cropH").dataset.ih||1;
    const sx=preview.clientWidth/iw,sy=preview.clientHeight/ih;
    const start={px:e.clientX,py:e.clientY,x:+q("#cropX").value||0,y:+q("#cropY").value||0,w:+q("#cropW").value||iw,h:+q("#cropH").value||ih};
    const move=ev=>{
      const nx=Math.max(0,Math.min(iw-start.w,start.x+(ev.clientX-start.px)/Math.max(.0001,sx)));
      const ny=Math.max(0,Math.min(ih-start.h,start.y+(ev.clientY-start.py)/Math.max(.0001,sy)));
      q("#cropX").value=Math.round(nx);q("#cropY").value=Math.round(ny);q("#cropX").dispatchEvent(new Event("input",{bubbles:true}));
    };
    const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
    window.addEventListener("pointermove",move,{passive:false});window.addEventListener("pointerup",up,{once:true});
  });
}

function patchCropOpen(){
  const btn=q("#cropBtn");if(!btn||btn.dataset.proCrop==="1")return;
  btn.dataset.proCrop="1";
  const original=btn.onclick;
  btn.onclick=async e=>{
    if(original)await original.call(btn,e);
    await sleep(40);
    const iw=+q("#cropW").value||1,ih=+q("#cropH").value||1;
    q("#cropW").dataset.iw=iw;q("#cropH").dataset.ih=ih;
    installCropHandles();
  };
  const m=q("#mobileCropBtn");
  if(m&&!m.dataset.proCrop){
    m.dataset.proCrop="1";m.addEventListener("click",async()=>{await sleep(50);const iw=+q("#cropW").value||1,ih=+q("#cropH").value||1;q("#cropW").dataset.iw=iw;q("#cropH").dataset.ih=ih;installCropHandles()});
  }
}

function patchDuplicate(){
  const btn=q("#duplicateBtn");if(!btn||btn.dataset.proDup==="1")return;
  btn.dataset.proDup="1";
  const prior=btn.onclick;
  btn.onclick=async e=>{
    if(prior)await prior.call(btn,e);
    await sleep(90);
    const sx=q("#px"),sy=q("#py");
    if(sx&&sy&&agent()?.status()?.selected){
      sx.value=(+sx.value||0)+40;sy.value=(+sy.value||0)+40;
      sx.dispatchEvent(new Event("change",{bubbles:true}));sy.dispatchEvent(new Event("change",{bubbles:true}));
    }
    toastPro("Duplicated as a distinct layer");
  };
}

async function blobToDataUrl(blob){
  if(!blob)return null;
  return await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.onerror=reject;f.readAsDataURL(blob)});
}
async function lastSpriteSheetDataUrl(){return window.__assetForgeLastSpriteSheetDataUrl||await blobToDataUrl(window.__assetForgeLastSpriteSheet)}
async function lastDownloadDataUrl(kind=null){
  const downloads=window.__assetForgeLastDownloads||{};
  const info=kind?downloads[kind]:(downloads.spriteImage||downloads.exportImage||window.__assetForgeLastImageDownload||downloads.project||downloads.assetManifest||downloads.spriteManifest||agent()?.getLastDownload?.());if(!info?.href)return null;
  const res=await fetch(info.href),blob=await res.blob();
  return await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.onerror=reject;f.readAsDataURL(blob)});
}

const A=window.AssetForgeAgent;
if(A){
  A.getLastDownloadDataUrl=lastDownloadDataUrl;
  A.getLastExportImageDataUrl=()=>lastDownloadDataUrl("exportImage");
  A.getLastSpriteImageDataUrl=()=>lastDownloadDataUrl("spriteImage");
  A.getLastProjectDataUrl=()=>lastDownloadDataUrl("project");
  A.getLastSpriteSheetDataUrl=lastSpriteSheetDataUrl;
  A.execute=async(cmd={})=>{
    const op=cmd.op||cmd.action;
    if(op==="status")return A.status();
    if(op==="fit")return A.fit?.();
    if(op==="zoom"){return A.zoomBy?.(+cmd.mult||1.2)}
    if(op==="wait")return sleep(Math.max(0,+cmd.ms||0));
    if(op==="removeBackground"){await A.removeBackground();return A.status()}
    if(op==="trim"){await A.trimSelected();return A.status()}
    if(op==="crop"){await A.cropSelected(+cmd.x||0,+cmd.y||0,+cmd.w||1,+cmd.h||1);return A.status()}
    if(op==="export"){await A.exportPng();return A.getLastDownload?.()}
    if(op==="manifest"){await A.exportSelectedManifest();return A.getLastDownload?.()}
    if(op==="duplicate"){q("#duplicateBtn")?.click();await sleep(180);return A.status()}
    if(op==="select"){
      const name=String(cmd.name||"");
      const row=qa(".layer-row").find(r=>(r.querySelector(".layer-name")?.textContent||"").includes(name));
      if(!row)throw new Error("Layer not found: "+name);row.click();return A.status()
    }
    if(op==="openTools"){q('button[data-sheet="toolPanel"]')?.click();return true}
    if(op==="openLayers"){q('button[data-sheet="propsPanel"]')?.click();return true}
    if(op==="closeSheets"){qa(".sidebar.open").forEach(x=>x.classList.remove("open"));return true}
    if(op==="spritePack"){q("#sheetBtn")?.click();await sleep(Math.max(200,+cmd.wait||300));return A.getLastDownload?.()}
    if(op==="spriteExtract"){q("#framesBtn")?.click();await sleep(Math.max(200,+cmd.wait||300));return A.status()}
    if(op==="setCropFields"){
      for(const k of ["x","y","w","h"]){if(cmd[k]!==undefined)q("#crop"+k.toUpperCase()).value=cmd[k]}
      q("#cropX")?.dispatchEvent(new Event("input",{bubbles:true}));return true
    }
    throw new Error("Unknown AssetForgeAgent command: "+op);
  };
}

window.addEventListener("message",async e=>{
  const d=e.data;
  if(!d||d.source!=="asset-forge-studio"||!window.AssetForgeAgent?.execute)return;
  try{
    const result=await window.AssetForgeAgent.execute(d.command||d);
    e.source?.postMessage({source:"asset-forge-studio",requestId:d.requestId||null,ok:true,result},"*");
  }catch(err){
    e.source?.postMessage({source:"asset-forge-studio",requestId:d.requestId||null,ok:false,error:err?.message||String(err)},"*");
  }
});


function installMissingActions(){
  const A=window.AssetForgeAgent;
  q("#fitBtn")?.addEventListener("click",()=>A?.fit?.());
  q("#zoomInBtn")?.addEventListener("click",()=>A?.zoomBy?.(1.2));
  q("#zoomOutBtn")?.addEventListener("click",()=>A?.zoomBy?.(1/1.2));
  q("#deleteBtnInspector")?.addEventListener("click",()=>q("#deleteBtn")?.click());
  q("#mobileExportBtn")?.addEventListener("click",()=>q("#exportBtn")?.click());
  q("#refreshVaultBtn")?.addEventListener("click",()=>A?.refreshVault?.());
  q("#clearVaultBtn2")?.addEventListener("click",()=>q("#clearVaultBtn")?.click());
  q("#urlBtn")?.addEventListener("click",()=>q("#urlModal")?.classList.remove("hidden"));
  q("#loadUrlBtn")?.addEventListener("click",async()=>{
    const input=q("#imageUrl"),url=input?.value?.trim();
    if(!url)return toastPro("Paste an image URL first");
    const b=q("#loadUrlBtn");b.disabled=true;
    try{
      const res=await fetch(url,{mode:"cors"});if(!res.ok)throw new Error("HTTP "+res.status);
      const blob=await res.blob();if(!blob.type.startsWith("image/"))throw new Error("URL is not an image");
      await A.upload(blob,url.split("/").pop()?.split("?")[0]||"remote-image.png");
      q("#urlModal").classList.add("hidden");input.value="";toastPro("Raster imported from URL");
    }catch(e){toastPro("URL import failed: "+e.message)}
    finally{b.disabled=false}
  });
  A.execute= A.execute || (async(cmd)=>{throw new Error("Bridge not ready")});
}
function addAutomationPanel(){
  if(q("#proStatus"))return;
  const parent=q("#propsPanel")||q("#toolPanel");if(!parent)return;
  const card=document.createElement("div");card.className="pro-status";card.id="proStatus";
  card.innerHTML='<span class="live-dot"></span><div><strong>PRO control bridge</strong><div class="pro-badge">automation + mobile precision</div></div>';
  parent.insertBefore(card,parent.firstElementChild?.nextElementSibling||parent.firstChild);
}
function bootPro(){
  if(!window.AssetForgeAgent){setTimeout(bootPro,25);return}
  installSheetPolish();patchCropOpen();patchDuplicate();addAutomationPanel();installMissingActions();
  const mo=new MutationObserver(()=>{installSheetPolish();installCropHandles()});
  mo.observe(document.body,{subtree:true,childList:true});
}
bootPro();
