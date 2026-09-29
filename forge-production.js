
const Forge = window.Forge;
if (!Forge) { throw new Error("Forge engine was not initialized"); }

class AssetPipeline {
  constructor() {
    this.registry = new Map(JSON.parse(localStorage.getItem("forge.assetRegistry") || "[]"));
    this.lastResults = [];
  }

  async analyze(file) {
    const base = {
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type || "application/octet-stream",
      bytes: file.size,
      modified: file.lastModified || Date.now()
    };
    if (/^image\//.test(file.type)) return Object.assign(base, await this.analyzeImage(file));
    if (/\.glb$/i.test(file.name)) return Object.assign(base, await this.analyzeGLB(file));
    if (/\.gltf$/i.test(file.name)) return Object.assign(base, { kind:"gltf", status:"package-required", warnings:["GLTF may reference external files; prefer GLB or import the full package."], optimization:[] });
    if (/^audio\//.test(file.type) || /\.(wav|mp3|ogg|m4a)$/i.test(file.name)) return Object.assign(base,{kind:"audio",status:"ready",optimization:["Normalize loudness","Generate preview waveform","Create streaming/short-clip variants"]});
    return Object.assign(base,{kind:"file",status:"ready",optimization:[]});
  }

  async analyzeImage(file) {
    const img = await createImageBitmap(file);
    const w = img.width, h = img.height;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(img,0,0);
    const data = ctx.getImageData(0,0,w,h).data;
    let minX=w,minY=h,maxX=-1,maxY=-1,alphaPixels=0;
    for(let y=0;y<h;y+=Math.max(1,Math.floor(h/768))){
      for(let x=0;x<w;x+=Math.max(1,Math.floor(w/768))){
        const a=data[(y*w+x)*4+3];
        if(a>4){alphaPixels++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      }
    }
    const alphaCoverage=(alphaPixels/Math.ceil(w/Math.max(1,Math.floor(h/768)))/Math.ceil(h/Math.max(1,Math.floor(h/768))));
    const pot2 = n => (n & (n-1)) === 0;
    const suggestions=[];
    if(Math.max(w,h)>4096) suggestions.push("Downscale for runtime or generate high/medium/low texture variants.");
    if(!pot2(w)||!pot2(h)) suggestions.push("Generate power-of-two or virtual-texture-friendly variants where required.");
    if(alphaCoverage<0.98) suggestions.push("Transparent bounds can be trimmed safely.");
    if(w>=256 && h>=256 && w%2===0 && h%2===0) suggestions.push("Candidate sprite sheet: test 2x2, 4x4 and custom cell extraction.");
    return {
      kind:"image",status:"ready",width:w,height:h,alphaCoverage:Number(alphaCoverage.toFixed(4)),
      trimBounds:maxX>=0?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null,
      optimization:suggestions
    };
  }

  async analyzeGLB(file) {
    const b=new Uint8Array(await file.arrayBuffer());
    if(b.byteLength<20 || b[0]!==0x67 || b[1]!==0x6c || b[2]!==0x54 || b[3]!==0x46)
      return {kind:"glb",status:"invalid",warnings:["Invalid GLB header."],optimization:[]};
    let p=12,json=null;
    while(p+8<=b.byteLength){
      const len=b[p]|(b[p+1]<<8)|(b[p+2]<<16)|(b[p+3]<<24);
      const type=b[p+4]|(b[p+5]<<8)|(b[p+6]<<16)|(b[p+7]<<24);
      const bytes=b.slice(p+8,p+8+len);
      if(type===0x4e4f534a) json=JSON.parse(new TextDecoder().decode(bytes));
      p+=8+len;
    }
    if(!json) return {kind:"glb",status:"invalid",warnings:["GLB JSON chunk is missing."],optimization:[]};
    const meshes=json.meshes||[],nodes=json.nodes||[],mats=json.materials||[],textures=json.textures||[],anims=json.animations||[],skins=json.skins||[];
    let triangles=0,vertices=0;
    for(const m of meshes){
      for(const prim of (m.primitives||[])){
        const pos=prim.attributes?.POSITION;
        if(pos!=null && json.accessors?.[pos]) vertices+=Number(json.accessors[pos].count||0);
        if(prim.indices!=null && json.accessors?.[prim.indices]) triangles+=Math.floor(Number(json.accessors[prim.indices].count||0)/3);
        else if(pos!=null && json.accessors?.[pos]) triangles+=Math.floor(Number(json.accessors[pos].count||0)/3);
      }
    }
    const optimization=[];
    if(triangles>500000) optimization.push("Generate LOD chain and inspect Nanite-like high-density workload.");
    if(meshes.length>25) optimization.push("Consider mesh merging/instancing for repeated environment assets.");
    if(textures.length>0) optimization.push("Generate compressed runtime texture variants and mipmaps.");
    if(anims.length>0) optimization.push("Register animation clips and skeleton/retarget metadata.");
    return {kind:"model",status:"ready",nodes:nodes.length,meshes:meshes.length,materials:mats.length,textures:textures.length,animations:anims.length,skins:skins.length,joints:skins.reduce((n,s)=>n+(s.joints||[]).length,0),vertices,triangles,optimization};
  }

  async prepare(file, options={}) {
    const a=await this.analyze(file);
    if(a.kind!=="image") return {analysis:a,output:file};
    const img=await createImageBitmap(file);
    let sx=0,sy=0,sw=img.width,sh=img.height;
    if(options.trim!==false && a.trimBounds){sx=a.trimBounds.x;sy=a.trimBounds.y;sw=a.trimBounds.width;sh=a.trimBounds.height;}
    const maxSize=Number(options.maxSize||4096);
    const scale=Math.min(1,maxSize/Math.max(sw,sh));
    const out=document.createElement("canvas");
    out.width=Math.max(1,Math.round(sw*scale));out.height=Math.max(1,Math.round(sh*scale));
    out.getContext("2d").drawImage(img,sx,sy,sw,sh,0,0,out.width,out.height);
    const blob=await new Promise(r=>out.toBlob(r,"image/png"));
    return {analysis:a,output:new File([blob],file.name.replace(/\.[^.]+$/,"")+"_prepared.png",{type:"image/png"}),transform:{source:{x:sx,y:sy,width:sw,height:sh},width:out.width,height:out.height}};
  }

  async atlas(files, columns=4, padding=2) {
    const imgs=await Promise.all(files.map(f=>createImageBitmap(f)));
    const cellW=Math.max(...imgs.map(x=>x.width)), cellH=Math.max(...imgs.map(x=>x.height)), rows=Math.ceil(imgs.length/columns);
    const c=document.createElement("canvas");c.width=columns*cellW+(columns+1)*padding;c.height=rows*cellH+(rows+1)*padding;
    const g=c.getContext("2d");g.clearRect(0,0,c.width,c.height);
    const frames=[];
    imgs.forEach((im,i)=>{const col=i%columns,row=Math.floor(i/columns),x=padding+col*cellW,y=padding+row*cellH;g.drawImage(im,x,y);frames.push({index:i,x,y,width:im.width,height:im.height,u0:x/c.width,v0:y/c.height,u1:(x+im.width)/c.width,v1:(y+im.height)/c.height})});
    const blob=await new Promise(r=>c.toBlob(r,"image/png"));
    return {file:new File([blob],"forge-atlas.png",{type:"image/png"}),width:c.width,height:c.height,frames};
  }

  async process(files) {
    const results=[];
    for(const file of files){try{const a=await this.analyze(file);this.registry.set(a.id,a);results.push(a)}catch(e){results.push({name:file.name,status:"error",error:e.message})}}
    this.persist();this.lastResults=results;return results;
  }

  persist(){localStorage.setItem("forge.assetRegistry",JSON.stringify([...this.registry.entries()]));}
  all(){return [...this.registry.values()]}
}

class WorldSystems {
  constructor(){this.seed=1337;this.cellSize=100;this.cells=new Map();this.pcgSeed=1337}
  rng(seed){let s=(seed>>>0)||1;return()=>{s=(1664525*s+1013904223)>>>0;return s/4294967296}}
  generate(kind,options={}) {
    const rand=this.rng(Number(options.seed||this.pcgSeed));const count=Math.min(250,Math.max(1,Number(options.count||30)));
    const area=Number(options.area||30);const created=[];
    for(let i=0;i<count;i++){
      const x=(rand()*2-1)*area,z=(rand()*2-1)*area;
      const t=kind==="trees"?"cylinder":kind==="rocks"?"sphere":kind==="houses"?"box":"box";
      const r=Forge.primitive(t,kind+"_"+i);
      r.entity.setLocalPosition(x,kind==="trees"?1.6:0.5,z);
      const sc=kind==="trees"?(0.5+rand()*1.4):(0.4+rand()*1.2);
      r.entity.setLocalScale(sc,kind==="trees"?1.5+rand()*2:sc,sc);
      r.components.pcg={kind,seed:Number(options.seed||this.pcgSeed),index:i};
      this.assignCell(r);
      created.push(r);
    }
    return created;
  }
  assignCell(r){
    const p=r.entity.getPosition();const cx=Math.floor(p.x/this.cellSize),cz=Math.floor(p.z/this.cellSize);
    r.components.worldCell={x:cx,z:cz,key:cx+":"+cz};
    if(!this.cells.has(cx+":"+cz))this.cells.set(cx+":"+cz,[]);this.cells.get(cx+":"+cz).push(r.id);
  }
  updateStreaming(radius=2){
    const cam=Forge.camera();if(!cam)return;
    const p=cam.getPosition(),cx=Math.floor(p.x/this.cellSize),cz=Math.floor(p.z/this.cellSize);
    for(const [id,r] of Forge.entities){const cell=r.components.worldCell;if(!cell)continue;const visible=Math.abs(cell.x-cx)<=radius&&Math.abs(cell.z-cz)<=radius;r.entity.enabled=visible}
  }
  partition(){
    const cells={};for(const r of Forge.entities.values()){if(!r.components.worldCell)continue;const k=r.components.worldCell.key;(cells[k]??=[]).push(r.name)}
    return {cellSize:this.cellSize,cells};
  }
}

class ForgeGraph {
  constructor(){this.graph={id:crypto.randomUUID(),name:"GameplayGraph",nodes:[],links:[]};}
  node(type,label){const n={id:crypto.randomUUID(),type,label:label||type,x:40+this.graph.nodes.length*180,y:80+(this.graph.nodes.length%3)*100,data:{}};this.graph.nodes.push(n);return n}
  link(a,b){this.graph.links.push({from:a.id,to:b.id});}
  run(){
    const by=new Map(this.graph.nodes.map(n=>[n.id,n]));const incoming=new Map();
    for(const l of this.graph.links){if(!incoming.has(l.to))incoming.set(l.to,[]);incoming.get(l.to).push(by.get(l.from))}
    const start=this.graph.nodes.find(n=>n.type==="OnStart")||this.graph.nodes[0];if(!start)return [];
    const q=[start],seen=new Set(),trace=[];
    while(q.length){const n=q.shift();if(!n||seen.has(n.id))continue;seen.add(n.id);trace.push(n.label);for(const l of this.graph.links.filter(x=>x.from===n.id)){const next=by.get(l.to);if(next)q.push(next)}}
    return trace;
  }
}

class ForgeProfiler {
  sample(){
    const d=Forge.diagnostics(),mem=performance.memory?{used:performance.memory.usedJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null;
    return {renderer:d.renderer,fps:d.fps,frameMs:d.frameMs||null,entities:d.entities,renderables:d.renderables,physics:d.physics,scripts:d.scripts,tracks:d.tracks,memory:mem};
  }
}

const assets=new AssetPipeline(),world=new WorldSystems(),graph=new ForgeGraph(),profiler=new ForgeProfiler();
window.ForgeProduction={assets,world,graph,profiler};

const style=document.createElement("style");
style.textContent=".forge-prod{position:fixed;right:14px;bottom:14px;z-index:90;display:flex;gap:5px;flex-wrap:wrap;max-width:430px}.forge-prod button{border:1px solid #29455f;background:#081727;color:#e8f1ff;border-radius:9px;padding:8px 10px;box-shadow:0 8px 26px #0007}.forge-modal{width:min(900px,94vw);border:1px solid #2d4e6d;background:#091523;color:#e8f1ff;border-radius:15px;padding:0}.forge-modal::backdrop{background:#000b;backdrop-filter:blur(8px)}.fm-head{display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #1b304a}.fm-body{padding:12px;max-height:70vh;overflow:auto}.fm-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fm-card{border:1px solid #1b304a;background:#0b1727;border-radius:10px;padding:10px}.fm-card h4{margin:0 0 7px}.fm-actions{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.fm-table{width:100%;border-collapse:collapse;font-size:11px}.fm-table td,.fm-table th{padding:6px;border-bottom:1px solid #162a40;text-align:left}.fm-node{position:relative;border:1px solid #315a7e;background:#0d1f33;border-radius:8px;padding:8px;margin:5px 0}.fm-code{white-space:pre-wrap;font:11px ui-monospace,monospace;background:#06101b;padding:9px;border-radius:8px}.fm-good{color:#48e28a}.fm-warn{color:#ffca66}.fm-bad{color:#ff7f8d}@media(max-width:700px){.forge-prod{left:8px;right:8px;bottom:8px}.fm-grid{grid-template-columns:1fr}}";
document.head.appendChild(style);

function modal(title,body){
  const d=document.createElement("dialog");d.className="forge-modal";d.innerHTML='<div class="fm-head"><b>'+title+'</b><button data-x>×</button></div><div class="fm-body">'+body+'</div>';d.querySelector("[data-x]").onclick=()=>d.close();document.body.appendChild(d);d.addEventListener("close",()=>d.remove(),{once:true});d.showModal();return d;
}
function openAssets(){
  const d=modal("Forge Asset Lab",'<div class="fm-grid"><div class="fm-card"><h4>Production import</h4><input id="fmFiles" type="file" multiple accept=".glb,.gltf,.png,.jpg,.jpeg,.webp,.avif,.wav,.mp3,.ogg"><div class="fm-actions"><button id="fmAnalyze">Analyze</button><button id="fmPrepare">Prepare selected raster</button><button id="fmAtlas">Pack atlas</button></div><div id="fmHint">Use Analyze to audit geometry, textures, animations, alpha, dimensions and optimization recommendations.</div></div><div class="fm-card"><h4>Registry</h4><div id="fmRegistry"></div></div></div>');
  const render=()=>{const box=d.querySelector("#fmRegistry"),list=assets.all();box.innerHTML=list.length?list.map(a=>'<div class="fm-node"><b>'+a.name+'</b><br>'+a.kind+' · '+(a.width?a.width+"×"+a.height:"")+" · "+(a.triangles?a.triangles+" triangles":"")+'<br><span class="fm-'+(a.status==="ready"?"good":"warn")+'">'+(a.optimization||[]).join(" · ")+'</span></div>').join(""):'<span class="fm-warn">Registry is empty.</span>'};
  d.querySelector("#fmAnalyze").onclick=async()=>{const fs=[...d.querySelector("#fmFiles").files];const r=await assets.process(fs);render();d.querySelector("#fmHint").textContent=r.map(x=>x.name+": "+x.status).join(" | ")||"No files selected"};
  const cook=document.createElement("button");cook.textContent="Cook GLB + LOD";cook.onclick=async()=>{const f=d.querySelector("#fmFiles").files[0];if(!f||!/\.glb$/i.test(f.name)){d.querySelector("#fmHint").textContent="Select a GLB first";return}try{const bytes=new Uint8Array(await f.arrayBuffer());let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const resp=await fetch("/api/pipeline",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"cook-glb",base64:btoa(bin),options:{lods:[1,.5,.2,.05]}})});const data=await resp.json();if(!resp.ok||!data.ok)throw new Error(data.error||"Cook failed");const ZIPMOD=window.JSZipModule||(await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm"));window.JSZipModule=ZIPMOD;const JSZip=ZIPMOD.default||ZIPMOD;const z=new JSZip();for(const item of data.files)z.file(item.name,Uint8Array.from(atob(item.base64),x=>x.charCodeAt(0)));z.file("cook-manifest.json",JSON.stringify(data.manifest,null,2));const blob=await z.generateAsync({type:"blob",compression:"DEFLATE"});const a=document.createElement("a");a.download=f.name.replace(/\.glb$/i,"")+"_cooked.zip";a.href=URL.createObjectURL(blob);a.click();d.querySelector("#fmHint").textContent="Cooked package: LOD0/LOD50/LOD80/LOD95 + manifest";toast("GLB cook completed")}catch(e){d.querySelector("#fmHint").textContent="Cook failed: "+e.message}};d.querySelector(".fm-actions").append(cook);
  const ai=document.createElement("button");ai.textContent="AI cutout";ai.onclick=async()=>{const f=d.querySelector("#fmFiles").files[0];if(!f)return;try{const out=await assets.cutout(f);const a=document.createElement("a");a.download=out.name;a.href=URL.createObjectURL(out);a.click();d.querySelector("#fmHint").textContent="AI cutout exported: "+out.name}catch(e){d.querySelector("#fmHint").textContent="AI cutout failed: "+e.message}};d.querySelector(".fm-actions").append(ai);
  d.querySelector("#fmPrepare").onclick=async()=>{const f=d.querySelector("#fmFiles").files[0];if(!f)return;const r=await assets.prepare(f,{trim:true,maxSize:4096});const a=document.createElement("a");a.download=r.output.name;a.href=URL.createObjectURL(r.output);a.click();d.querySelector("#fmHint").textContent="Prepared asset exported: "+r.output.name};
  d.querySelector("#fmAtlas").onclick=async()=>{const fs=[...d.querySelector("#fmFiles").files].filter(x=>/^image\\//.test(x.type));if(!fs.length)return;const r=await assets.atlas(fs,4,4);const a=document.createElement("a");a.download=r.file.name;a.href=URL.createObjectURL(r.file);a.click();d.querySelector("#fmHint").textContent="Atlas "+r.width+"×"+r.height+" with "+r.frames.length+" frames exported."};
  render();
}
function openPCG(){
  const d=modal("Forge World Builder",'<div class="fm-grid"><div class="fm-card"><h4>Procedural Content</h4><label>Seed <input id="pcgSeed" type="number" value="1337"></label><label>Count <input id="pcgCount" type="number" value="40" min="1" max="250"></label><label>Area <input id="pcgArea" type="number" value="30" min="1"></label><div class="fm-actions"><button data-pcg="trees">Generate forest</button><button data-pcg="rocks">Scatter rocks</button><button data-pcg="houses">Generate buildings</button></div></div><div class="fm-card"><h4>World Partition</h4><div id="wpStats"></div><div class="fm-actions"><button id="wpRefresh">Refresh cells</button><button id="wpStream">Apply streaming</button></div></div></div>');
  const render=()=>{const p=world.partition();d.querySelector("#wpStats").innerHTML='<div>Cell size: '+world.cellSize+'m</div><div>Loaded cells: '+Object.keys(p.cells).length+'</div><div>Partition is stored in scene components, so streaming can be deterministic.</div>'};
  d.querySelectorAll("[data-pcg]").forEach(b=>b.onclick=()=>{const rs=world.generate(b.dataset.pcg,{seed:+d.querySelector("#pcgSeed").value,count:+d.querySelector("#pcgCount").value,area:+d.querySelector("#pcgArea").value});Forge.frame();render();refreshHierarchy();d.querySelector("#wpStats").insertAdjacentHTML("afterbegin",'<div class="fm-good">Generated '+rs.length+' entities.</div>')});
  d.querySelector("#wpRefresh").onclick=render;d.querySelector("#wpStream").onclick=()=>{world.updateStreaming();toast("World streaming updated")};render();
}
function refreshHierarchy(){const t=document.querySelector("#tree");if(!t)return;t.innerHTML="";for(const r of Forge.entities.values()){const row=document.createElement("div");row.className="tree-row"+(r.id===Forge.selectedId?" active":"");row.innerHTML="<span>•</span><span>"+r.name+"</span><small>"+r.kind+"</small>";row.onclick=()=>{Forge.select(r.id);if(window.syncForgeInspector)window.syncForgeInspector()};t.append(row)}}
function toast(s){const e=document.createElement("div");e.textContent=s;Object.assign(e.style,{position:"fixed",bottom:"64px",left:"50%",transform:"translateX(-50%)",zIndex:120,background:"#0b1d31",border:"1px solid #31506f",padding:"10px 14px",borderRadius:"10px"});document.body.appendChild(e);setTimeout(()=>e.remove(),1600)}
function openGraph(){
  const d=modal("Forge Logic Graph",'<div class="fm-grid"><div class="fm-card"><h4>Graph authoring</h4><div class="fm-actions"><button data-node="OnStart">On Start</button><button data-node="OnUpdate">On Update</button><button data-node="Spawn">Spawn</button><button data-node="Rotate">Rotate</button><button data-node="IfDistance">If Distance</button><button data-node="Play">Play</button></div><div id="nodes"></div></div><div class="fm-card"><h4>Runtime trace</h4><div id="trace" class="fm-code">Add nodes and run the graph.</div><button id="runGraph">Run Graph</button><button id="saveGraph">Save graph JSON</button></div></div>');
  const draw=()=>{d.querySelector("#nodes").innerHTML=graph.graph.nodes.map(n=>'<div class="fm-node"><b>'+n.label+'</b><br><small>'+n.type+' · '+n.id.slice(0,8)+'</small></div>').join("")};
  d.querySelectorAll("[data-node]").forEach(b=>b.onclick=()=>{const prev=graph.graph.nodes.at(-1);const n=graph.node(b.dataset.node,b.textContent);if(prev)graph.link(prev,n);draw()});
  d.querySelector("#runGraph").onclick=()=>d.querySelector("#trace").textContent=graph.run().join(" → ")||"No entry node";
  d.querySelector("#saveGraph").onclick=()=>{const a=document.createElement("a");a.download="forge-graph.json";a.href=URL.createObjectURL(new Blob([JSON.stringify(graph.graph,null,2)],{type:"application/json"}));a.click()};
  draw();
}
function openProfiler(){modal("Forge Profiler",'<div class="fm-grid"><div class="fm-card"><h4>Runtime budget</h4><div id="profileNow"></div></div><div class="fm-card"><h4>Quality gates</h4><div class="fm-good">Renderer path required</div><div class="fm-good">Scene must render</div><div class="fm-good">Physics must update</div><div class="fm-good">No unhandled page errors in CI</div><div class="fm-good">Mobile viewport covered</div></div></div>');const box=document.querySelector(".forge-modal #profileNow");const tick=()=>{if(!box||!document.body.contains(box))return;box.textContent=JSON.stringify(profiler.sample(),null,2);setTimeout(tick,500)};tick()}


AssetPipeline.prototype.cutout = async function(file){
  if(!/^image\//.test(file.type)) throw new Error("AI cutout accepts raster images");
  const {pipeline}=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm");
  const device = navigator.gpu ? "webgpu" : "wasm";
  let pipe;
  try{pipe=await pipeline("background-removal","xrds/isnet-general-onnx-int8",{device,dtype:device==="webgpu"?"fp32":"fp32"});}
  catch(e){pipe=await pipeline("background-removal","xrds/isnet-general-onnx-int8",{device:"wasm",dtype:"fp32"});}
  const result0=await pipe(file),result=Array.isArray(result0)?result0[0]:result0;
  const rgba=typeof result?.rgba==="function"?result.rgba():result;
  if(!rgba?.width||!rgba?.height) throw new Error("Background-removal model returned no image");
  const w=rgba.width,h=rgba.height,stride=Math.max(1,Math.floor(rgba.data.length/(w*h)));
  const src=await createImageBitmap(file),out=document.createElement("canvas");out.width=w;out.height=h;
  const g=out.getContext("2d",{willReadFrequently:true});g.drawImage(src,0,0,w,h);
  const pixels=g.getImageData(0,0,w,h);
  for(let i=0;i<w*h;i++){let a=rgba.data[i*stride+(stride>=4?3:0)];if(a<=1)a*=255;pixels.data[i*4+3]=Math.max(0,Math.min(255,a));}
  g.putImageData(pixels,0,0);
  const blob=await new Promise((res,rej)=>out.toBlob(b=>b?res(b):rej(new Error("Could not encode cutout")),"image/png",1));
  src.close();
  const name=file.name.replace(/\.[^.]+$/,"")+"_cutout.png";
  this.registry.set(crypto.randomUUID(),{name,kind:"image",status:"ready",source:file.name,operation:"ISNet background removal"});
  this.persist();
  return new File([blob],name,{type:"image/png"});
};

async function openBuild(){
  if(!window.JSZipModule){
    try{window.JSZipModule=await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");}
    catch(e){toast("Build system could not load JSZip");return}
  }
  const JSZip=window.JSZipModule.default||window.JSZipModule;
  const zip=new JSZip();
  const project=Forge.serialize();
  project.meta=Object.assign(project.meta||{},{
    buildMode:"web",
    renderBackend:"PlayCanvas 2.22.6",
    physicsBackend:"Rapier 0.21.0"
  });
  zip.file("project.forge.json",JSON.stringify(project,null,2));
  const runtime='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forge Build</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{width:100%;height:100%;display:block}</style></head><body><canvas id="c"></canvas><script type="module">import * as pc from "https://cdn.jsdelivr.net/npm/playcanvas@2.22.6/build/playcanvas.mjs";import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/+esm";const P=PROJECT;const app=new pc.Application(document.querySelector("#c"),{graphicsDeviceOptions:{antialias:true,powerPreference:"high-performance"}});app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);app.setCanvasResolution(pc.RESOLUTION_AUTO);app.start();await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0}),root=new pc.Entity("ForgeRuntime");app.root.addChild(root);const records=new Map();function mat(){const m=new pc.StandardMaterial();m.diffuse=new pc.Color(.22,.62,.9);m.metalness=.05;m.gloss=.5;m.update();return m}function addPrimitive(e){const map={box:"box",sphere:"sphere",cylinder:"cylinder",capsule:"capsule",plane:"plane"};if(!map[e.kind])return null;const n=new pc.Entity(e.name);n.addComponent("render",{type:map[e.kind]});n.render.material=mat();root.addChild(n);n.setLocalPosition(...e.transform.p);n.setLocalEulerAngles(...e.transform.r);n.setLocalScale(...e.transform.s);return n}for(const e of P.entities){if(e.kind==="model"&&e.components?.asset?.name){const a=new pc.Asset(e.name,"container",{url:"assets/"+e.components.asset.name});app.assets.add(a);a.once("load",()=>{const n=a.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});n.name=e.name;root.addChild(n);n.setLocalPosition(...e.transform.p);n.setLocalEulerAngles(...e.transform.r);n.setLocalScale(...e.transform.s);records.set(e.id,n)});app.assets.load(a);continue}if(e.kind==="camera"){const n=new pc.Entity(e.name);n.addComponent("camera",{clearColor:new pc.Color(.02,.05,.09)});n.setLocalPosition(...e.transform.p);n.setLocalEulerAngles(...e.transform.r);root.addChild(n);records.set(e.id,n);continue}if(e.kind==="light"){const n=new pc.Entity(e.name);n.addComponent("light",{type:"directional",intensity:2,castShadows:true});n.setLocalPosition(...e.transform.p);n.setLocalEulerAngles(...e.transform.r);root.addChild(n);continue}const n=addPrimitive(e);if(n)records.set(e.id,n)}const cam=[...records.values()].find(n=>n.camera);if(!cam){const n=new pc.Entity("Camera");n.addComponent("camera",{clearColor:new pc.Color(.02,.05,.09)});n.setLocalPosition(7,5,9);n.lookAt(0,0,0);root.addChild(n)}<\/script></body></html>'.replace("PROJECT",JSON.stringify(project));
  zip.file("index.html",runtime);
  for(const [name,a] of Forge.assets||[]) if(a?.file) zip.file("assets/"+name,await a.file.arrayBuffer());
  const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE"});
  const a=document.createElement("a");a.download="forge-web-build.zip";a.href=URL.createObjectURL(blob);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  toast("Web build package exported");
}

window.ForgeProduction.build=openBuild;

function openMaterial(){
  const d=modal("Forge Material Lab",'<div class="fm-grid"><div class="fm-card"><h4>PBR surface</h4><label>Base color <input id="matColor" type="color" value="#3a9ee6"></label><label>Metalness <input id="matMetal" type="range" min="0" max="1" step=".01" value=".05"></label><label>Roughness <input id="matRough" type="range" min="0" max="1" step=".01" value=".5"></label><label>Opacity <input id="matOpacity" type="range" min="0" max="1" step=".01" value="1"></label><label>Emissive strength <input id="matEmit" type="range" min="0" max="5" step=".01" value="0"></label><div class="fm-actions"><button id="matApply">Apply material</button><button id="matExport">Export preset</button></div></div><div class="fm-card"><h4>Selected material data</h4><pre id="matState" class="fm-code"></pre></div></div>');
  const hex=h=>[parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255];
  const render=()=>{d.querySelector("#matState").textContent=JSON.stringify(Forge.materialState()||{hint:"Select a renderable entity"},null,2)};
  d.querySelector("#matApply").onclick=()=>{Forge.applyMaterial({color:hex(d.querySelector("#matColor").value),metalness:+d.querySelector("#matMetal").value,roughness:+d.querySelector("#matRough").value,opacity:+d.querySelector("#matOpacity").value,emissive:[1,1,1],emissiveIntensity:+d.querySelector("#matEmit").value});render();toast("PBR material applied")};
  d.querySelector("#matExport").onclick=()=>{const data=Forge.materialState()||{};const a=document.createElement("a");a.download="forge-material.json";a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.click()};
  render();
}

function openRuntime(){
  const d=modal("Forge Runtime Lab",'<div class="fm-grid"><div class="fm-card"><h4>Game Templates</h4><div class="fm-actions"><button id="tplTP">Third-Person</button><button id="tplRace">Racing</button></div><div id="tplStatus" class="fm-code">Templates generate playable physics scenes.</div></div><div class="fm-card"><h4>Input Map</h4><div id="rtInput"></div><div class="fm-actions"><button id="rtFocus">Focus viewport</button><button id="rtClear">Clear input state</button></div></div><div class="fm-card"><h4>Navigation</h4><div class="fm-actions"><button id="navBake">Bake grid</button><button id="navPath">Test path</button></div><pre id="navOut" class="fm-code"></pre></div><div class="fm-card"><h4>Save Slots</h4><input id="slotName" value="autosave"><div class="fm-actions"><button id="slotSave">Save slot</button><button id="slotLoad">Inspect slot</button></div><pre id="slotOut" class="fm-code"></pre></div><div class="fm-card"><h4>Prefabs</h4><input id="prefabName" placeholder="Prefab name"><div class="fm-actions"><button id="prefabSave">Save selected as prefab</button></div><pre id="prefabOut" class="fm-code"></pre></div></div>');
  d.querySelector("#tplTP").onclick=()=>{const r=window.ForgeGameplay.createThirdPersonTemplate();d.querySelector("#tplStatus").textContent=JSON.stringify(r,null,2);toast("Third-person template created")};d.querySelector("#tplRace").onclick=()=>{const r=window.ForgeGameplay.createRacingTemplate();d.querySelector("#tplStatus").textContent=JSON.stringify(r,null,2);toast("Racing template created")};
  const renderInput=()=>{d.querySelector("#rtInput").innerHTML=Object.entries(window.ForgeRuntime?.input.bindings||{}).map(([k,v])=>'<div>'+k+' → '+v.join(", ")+'</div>').join("")};
  d.querySelector("#rtFocus").onclick=()=>document.querySelector("#viewport")?.focus();d.querySelector("#rtClear").onclick=()=>window.ForgeRuntime?.input.down.clear();
  d.querySelector("#navBake").onclick=()=>{window.ForgeRuntime.nav.bakeFromScene(Forge);d.querySelector("#navOut").textContent=JSON.stringify({width:window.ForgeRuntime.nav.width,height:window.ForgeRuntime.nav.height,cell:window.ForgeRuntime.nav.cell},null,2)};
  d.querySelector("#navPath").onclick=()=>{const p=window.ForgeRuntime.nav.path({x:0,y:0,z:0},{x:8,y:0,z:8});d.querySelector("#navOut").textContent=JSON.stringify(p,null,2)};
  d.querySelector("#slotSave").onclick=()=>{const s=d.querySelector("#slotName").value||"autosave";window.ForgeRuntime.save.save(s,Forge.serialize());d.querySelector("#slotOut").textContent=JSON.stringify(window.ForgeRuntime.save.load(s),null,2)};
  d.querySelector("#slotLoad").onclick=()=>{const s=d.querySelector("#slotName").value||"autosave";d.querySelector("#slotOut").textContent=JSON.stringify(window.ForgeRuntime.save.load(s),null,2)};
  d.querySelector("#prefabSave").onclick=()=>{const r=Forge.selected();if(!r){toast("Select an entity first");return}const name=d.querySelector("#prefabName").value||r.name;window.ForgeRuntime.prefabs.save(name,{name:r.name,kind:r.kind,components:r.components,transform:{position:[r.entity.getLocalPosition().x,r.entity.getLocalPosition().y,r.entity.getLocalPosition().z],rotation:[r.entity.getLocalEulerAngles().x,r.entity.getLocalEulerAngles().y,r.entity.getLocalEulerAngles().z],scale:[r.entity.getLocalScale().x,r.entity.getLocalScale().y,r.entity.getLocalScale().z]}});d.querySelector("#prefabOut").textContent=JSON.stringify(window.ForgeRuntime.prefabs.list(),null,2)};
  renderInput();
}
function addBar(){
  const bar=document.createElement("div");bar.className="forge-prod";
  const buttons=[["Asset Lab",openAssets],["Material",openMaterial],["World / PCG",openPCG],["Logic Graph",openGraph],["Profiler",openProfiler],["Vision",()=>window.AssetForgeLiveVision?.open()],["Runtime",openRuntime],["Build Web",openBuild]];
  buttons.forEach(([t,f])=>{const b=document.createElement("button");b.textContent=t;b.onclick=f;bar.append(b)});document.body.append(bar);
}
addBar();
