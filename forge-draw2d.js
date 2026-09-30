(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    canvas: null,
    ctx: null,
    drawing: false,
    last: null,
    erasing: false,
    brush: 18,
    color: "#ffffff",
    history: [],
    redo: [],
    maxHistory: 24,
    ready: false,
    lastPngDataUrl: null
  };

  function dialog(){ return $("draw2dDialog"); }

  function status(text){
    const el = $("draw2dStatus");
    if(el) el.textContent = text;
  }

  function capture(){
    if(!state.ctx || !state.canvas) return;
    state.history.push(state.ctx.getImageData(0,0,state.canvas.width,state.canvas.height));
    if(state.history.length > state.maxHistory) state.history.shift();
    state.redo.length = 0;
    syncButtons();
  }

  function syncButtons(){
    $("drawUndo")?.toggleAttribute("disabled", state.history.length < 2);
    $("drawRedo")?.toggleAttribute("disabled", state.redo.length === 0);
    $("drawEraser")?.classList.toggle("active", state.erasing);
  }

  function point(event){
    const r=state.canvas.getBoundingClientRect();
    return {
      x:(event.clientX-r.left)*state.canvas.width/r.width,
      y:(event.clientY-r.top)*state.canvas.height/r.height
    };
  }

  function begin(event){
    if(!state.ctx) return;
    event.preventDefault();
    capture();
    state.drawing=true;
    state.last=point(event);
    state.canvas.setPointerCapture?.(event.pointerId);
    state.ctx.save();
    state.ctx.globalCompositeOperation=state.erasing?"destination-out":"source-over";
    state.ctx.strokeStyle=state.color;
    state.ctx.lineWidth=state.brush;
    state.ctx.lineCap="round";
    state.ctx.lineJoin="round";
    state.ctx.beginPath();
    state.ctx.arc(state.last.x,state.last.y,state.brush/2,0,Math.PI*2);
    state.ctx.fillStyle=state.color;
    if(state.erasing) state.ctx.fillStyle="rgba(0,0,0,1)";
    state.ctx.fill();
    state.ctx.restore();
    status("Drawing…");
  }

  function move(event){
    if(!state.drawing || !state.ctx) return;
    event.preventDefault();
    const p=point(event),a=state.last;
    state.ctx.save();
    state.ctx.globalCompositeOperation=state.erasing?"destination-out":"source-over";
    state.ctx.strokeStyle=state.color;
    state.ctx.lineWidth=state.brush;
    state.ctx.lineCap="round";
    state.ctx.lineJoin="round";
    state.ctx.beginPath();
    state.ctx.moveTo(a.x,a.y);
    state.ctx.lineTo(p.x,p.y);
    state.ctx.stroke();
    state.ctx.restore();
    state.last=p;
  }

  function end(event){
    if(!state.drawing) return;
    event?.preventDefault?.();
    state.drawing=false;
    state.last=null;
    try{state.canvas.releasePointerCapture?.(event?.pointerId)}catch{}
    status("Ready");
  }

  function clear(){
    if(!state.ctx) return;
    capture();
    state.ctx.clearRect(0,0,state.canvas.width,state.canvas.height);
    status("Canvas cleared");
  }

  function undo(){
    if(state.history.length<=1 || !state.ctx)return;
    const current=state.ctx.getImageData(0,0,state.canvas.width,state.canvas.height);
    state.redo.push(current);
    const previous=state.history.pop();
    state.ctx.putImageData(previous,0,0);
    syncButtons();
    status("Undo");
  }

  function redo(){
    if(!state.redo.length || !state.ctx)return;
    const current=state.ctx.getImageData(0,0,state.canvas.width,state.canvas.height);
    state.history.push(current);
    const next=state.redo.pop();
    state.ctx.putImageData(next,0,0);
    syncButtons();
    status("Redo");
  }

  function dataUrl(){
    if(!state.canvas) return null;
    return state.canvas.toDataURL("image/png");
  }

  function download(){
    const url=dataUrl();
    if(!url)return;
    state.lastPngDataUrl=url;
    const a=document.createElement("a");
    a.href=url;
    a.download="forge-drawing.png";
    a.click();
    status("PNG exported");
  }

  async function addToScene(){
    if(!state.canvas || !window.Forge?.importFile) throw new Error("Forge runtime is not ready");
    const blob=await new Promise(resolve=>state.canvas.toBlob(resolve,"image/png"));
    if(!blob)throw new Error("PNG encoding failed");
    const file=new File([blob],"forge-drawing.png",{type:"image/png"});
    state.lastPngDataUrl=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||""));
      reader.onerror=()=>reject(reader.error||new Error("PNG preview read failed"));
      reader.readAsDataURL(blob);
    });
    await window.ForgeProduction?.assets?.storeFile?.(file);
    const result=await window.Forge.importFile(file);
    window.ForgeRefreshUI?.();
    if(result?.record) window.Forge.select?.(result.record.id);
    dialog()?.close();
    status("Imported into Forge");
    window.dispatchEvent(new CustomEvent("forge-drawing-imported",{detail:{name:file.name,bytes:file.size}}));
    return {name:file.name,bytes:file.size,type:file.type};
  }

  function open(){
    dialog()?.showModal();
    status("Ready");
    syncButtons();
  }

  function init(){
    if(state.ready)return;
    state.canvas=$("drawCanvas");
    state.ctx=state.canvas?.getContext("2d");
    if(!state.canvas||!state.ctx)return;
    state.canvas.style.touchAction="none";
    state.canvas.addEventListener("pointerdown",begin);
    state.canvas.addEventListener("pointermove",move);
    state.canvas.addEventListener("pointerup",end);
    state.canvas.addEventListener("pointercancel",end);
    state.canvas.addEventListener("pointerleave",(e)=>{if(state.drawing)move(e)});
    $("draw2dOpen")?.addEventListener("click",open);
    $("drawClose")?.addEventListener("click",()=>dialog()?.close());
    $("drawClear")?.addEventListener("click",clear);
    $("drawUndo")?.addEventListener("click",undo);
    $("drawRedo")?.addEventListener("click",redo);
    $("drawDownload")?.addEventListener("click",download);
    $("drawAddToScene")?.addEventListener("click",()=>addToScene().catch(e=>status("Import failed: "+(e?.message||String(e)))));
    $("drawColor")?.addEventListener("input",e=>{state.color=e.target.value||"#ffffff"});
    $("drawSize")?.addEventListener("input",e=>{state.brush=Math.max(1,Math.min(120,Number(e.target.value)||18));$("drawSizeValue").textContent=state.brush+" px"});
    $("drawEraser")?.addEventListener("click",()=>{state.erasing=!state.erasing;syncButtons()});
    $("drawReset")?.addEventListener("click",()=>{state.color="#ffffff";state.brush=18;state.erasing=false;$("drawColor").value="#ffffff";$("drawSize").value="18";$("drawSizeValue").textContent="18 px";syncButtons()});
    state.ctx.clearRect(0,0,state.canvas.width,state.canvas.height);
    state.ctx.fillStyle="rgba(8,20,35,0)";
    capture();
    state.ready=true;
    syncButtons();
  }

  window.ForgeDraw2D={
    open,
    clear,
    undo,
    redo,
    download,
    addToScene,
    exportDataUrl:dataUrl,
    status:()=>({ready:state.ready,drawing:state.drawing,brush:state.brush,color:state.color,erasing:state.erasing,history:state.history.length,redo:state.redo.length}),
    get lastPngDataUrl(){ return state.lastPngDataUrl; }
  };

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();