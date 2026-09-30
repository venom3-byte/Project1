
const Forge = window.Forge;
if (!Forge) { throw new Error("Forge engine was not initialized"); }

class AssetPipeline {
  constructor() {
    this.registry = new Map(JSON.parse(localStorage.getItem("forge.assetRegistry") || "[]"));
    this.lastResults = [];
  }

  async analyze(file) {
    const base={id:crypto.randomUUID(),name:file.name,type:file.type||"application/octet-stream",bytes:file.size,modified:file.lastModified||Date.now(),extension:String(file.name).split(".").pop()?.toLowerCase()||""};
    const n=String(file.name).toLowerCase();
    const model=/\.(glb|gltf|fbx|obj|dae|3ds|stl|ply|off|3mf|dxf|ase|b3d|lwo|lxo|m3d|md2|md3|md5mesh|ms3d|smd|vta|x|x3d)$/i.test(n);
    if(/^image\//.test(file.type)||/\.(png|jpe?g|webp|avif|gif|bmp|tga|tif|tiff)$/i.test(n))return Object.assign(base,await this.analyzeImage(file));
    if(/\.glb$/i.test(n))return Object.assign(base,await this.analyzeGLB(file));
    if(/\.gltf$/i.test(n))return Object.assign(base,{kind:"gltf",status:"package-or-single-file",warnings:["External buffers/textures are automatically packaged when supplied together."],optimization:["Prefer GLB for portable delivery"]});
    if(model)return Object.assign(base,{kind:"model-source",status:"conversion-capable",optimization:["Convert to GLB for native runtime","Preserve original source for re-export","Inspect materials, skeletons, animations and topology after conversion"]});
    if(/^audio\//.test(file.type)||/\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(n))return Object.assign(base,{kind:"audio",status:"ready",optimization:["Generate streaming and short-clip variants","Analyze loudness and loop points"]});
    if(/\.(ttf|ttc|otf)$/i.test(n))return Object.assign(base,{kind:"font",status:"source-ready",optimization:["Generate MSDF/SDF runtime atlas"]});
    if(/\.(glsl|vert|frag|shader)$/i.test(n))return Object.assign(base,{kind:"shader",status:"source-ready",optimization:["Validate shader source","Generate platform variants"]});
    if(/\.(json|xml|csv|txt|css|js|mjs|wasm)$/i.test(n))return Object.assign(base,{kind:"data",status:"source-ready",optimization:["Validate syntax/schema before runtime use"]});
    return Object.assign(base,{kind:"source",status:"source-ready",optimization:["Preserve exact source bytes and provenance"]});
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
    return {kind:"model",status:"ready",nodes:nodes.length,meshes:meshes.length,materials:mats.length,textures:textures.length,animations:anims.length,animationNames:anims.map(a=>a?.name).filter(Boolean),skins:skins.length,joints:skins.reduce((n,s)=>n+(s.joints||[]).length,0),vertices,triangles,optimization};
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


  async storeFile(file){
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open("forge-content-v1",1);q.onupgradeneeded=()=>q.result.createObjectStore("files",{keyPath:"name"});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
    return new Promise((resolve,reject)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").put({name:file.name,type:file.type,size:file.size,lastModified:file.lastModified||Date.now(),blob:file});tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)})
  }
  async listStored(){
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open("forge-content-v1",1);q.onupgradeneeded=()=>q.result.createObjectStore("files",{keyPath:"name"});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
    return new Promise((resolve,reject)=>{const q=db.transaction("files","readonly").objectStore("files").getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})
  }
  async getStored(name){
    const all=await this.listStored();return all.find(x=>x.name===name)||null
  }
  async hydrateEngineAssets(){
    const items=await this.listStored();
    for(const item of items){if(!Forge.assets.has(item.name))Forge.assets.set(item.name,{type:item.type||"application/octet-stream",file:item.blob,url:URL.createObjectURL(item.blob)})}
    return items.length
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
style.textContent=".forge-modal{width:min(900px,94vw);border:1px solid #2d4e6d;background:#091523;color:#e8f1ff;border-radius:15px;padding:0}.forge-modal::backdrop{background:#000b;backdrop-filter:blur(8px)}.fm-head{display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #1b304a}.fm-body{padding:12px;max-height:70vh;overflow:auto}.fm-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fm-card{border:1px solid #1b304a;background:#0b1727;border-radius:10px;padding:10px}.fm-card h4{margin:0 0 7px}.fm-actions{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.fm-table{width:100%;border-collapse:collapse;font-size:11px}.fm-table td,.fm-table th{padding:6px;border-bottom:1px solid #162a40;text-align:left}.fm-node{position:relative;border:1px solid #315a7e;background:#0d1f33;border-radius:8px;padding:8px;margin:5px 0}.fm-code{white-space:pre-wrap;font:11px ui-monospace,monospace;background:#06101b;padding:9px;border-radius:8px}.fm-good{color:#48e28a}.fm-warn{color:#ffca66}.fm-bad{color:#ff7f8d}@media(max-width:700px){.fm-grid{grid-template-columns:1fr}}";
document.head.appendChild(style);

function modal(title,body){
  const d=document.createElement("dialog");d.className="forge-modal";d.innerHTML='<div class="fm-head"><b>'+title+'</b><button data-x>×</button></div><div class="fm-body">'+body+'</div>';d.querySelector("[data-x]").onclick=()=>d.close();document.body.appendChild(d);d.addEventListener("close",()=>d.remove(),{once:true});d.showModal();return d;
}
function openAssets(){
  const d=modal("Forge Asset Lab",'<div class="fm-grid"><div class="fm-card"><h4>Production import</h4><input id="fmFiles" type="file" multiple accept=".glb,.gltf,.png,.jpg,.jpeg,.webp,.avif,.wav,.mp3,.ogg"><div class="fm-actions"><button id="fmAnalyze">Analyze</button><button id="fmPrepare">Prepare selected raster</button><button id="fmVariants">Texture variants</button><button id="fmAtlas">Pack atlas</button></div><div id="fmHint">Use Analyze to audit geometry, textures, animations, alpha, dimensions and optimization recommendations.</div></div><div class="fm-card"><h4>Registry</h4><div id="fmRegistry"></div></div></div>');
  const render=()=>{const box=d.querySelector("#fmRegistry"),list=assets.all();box.innerHTML=list.length?list.map(a=>'<div class="fm-node"><b>'+a.name+'</b><br>'+a.kind+' · '+(a.width?a.width+"×"+a.height:"")+" · "+(a.triangles?a.triangles+" triangles":"")+'<br><span class="fm-'+(a.status==="ready"?"good":"warn")+'">'+(a.optimization||[]).join(" · ")+'</span></div>').join(""):'<span class="fm-warn">Registry is empty.</span>'};
  d.querySelector("#fmAnalyze").onclick=async()=>{const fs=[...d.querySelector("#fmFiles").files];const r=await assets.process(fs);render();d.querySelector("#fmHint").textContent=r.map(x=>x.name+": "+x.status).join(" | ")||"No files selected"};
  const cook=document.createElement("button");cook.textContent="Cook GLB + LOD";cook.onclick=async()=>{const f=d.querySelector("#fmFiles").files[0];if(!f||!/\.glb$/i.test(f.name)){d.querySelector("#fmHint").textContent="Select a GLB first";return}try{const bytes=new Uint8Array(await f.arrayBuffer());let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const resp=await fetch("/api/pipeline",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"cook-glb",base64:btoa(bin),options:{lods:[1,.5,.2,.05]}})});const data=await resp.json();if(!resp.ok||!data.ok)throw new Error(data.error||"Cook failed");const ZIPMOD=window.JSZipModule||(await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm"));window.JSZipModule=ZIPMOD;const JSZip=ZIPMOD.default||ZIPMOD;const z=new JSZip();for(const item of data.files)z.file(item.name,Uint8Array.from(atob(item.base64),x=>x.charCodeAt(0)));z.file("cook-manifest.json",JSON.stringify(data.manifest,null,2));const blob=await z.generateAsync({type:"blob",compression:"DEFLATE"});const a=document.createElement("a");a.download=f.name.replace(/\.glb$/i,"")+"_cooked.zip";a.href=URL.createObjectURL(blob);a.click();d.querySelector("#fmHint").textContent="Cooked package: LOD0/LOD50/LOD80/LOD95 + manifest";toast("GLB cook completed")}catch(e){d.querySelector("#fmHint").textContent="Cook failed: "+e.message}};d.querySelector(".fm-actions").append(cook);
  const ai=document.createElement("button");ai.textContent="AI cutout";ai.onclick=async()=>{const f=d.querySelector("#fmFiles").files[0];if(!f)return;try{const out=await assets.cutout(f);const a=document.createElement("a");a.download=out.name;a.href=URL.createObjectURL(out);a.click();d.querySelector("#fmHint").textContent="AI cutout exported: "+out.name}catch(e){d.querySelector("#fmHint").textContent="AI cutout failed: "+e.message}};d.querySelector(".fm-actions").append(ai);
  d.querySelector("#fmVariants").onclick=async()=>{const f=d.querySelector("#fmFiles").files[0];if(!f||!String(f.type||"").startsWith("image/")){d.querySelector("#fmHint").textContent="Select a raster image first";return}try{const r=await assets.textureVariants(f);for(const v of r.variants){const a=document.createElement("a");a.download=v.name;a.href=URL.createObjectURL(v.blob);a.click()}d.querySelector("#fmHint").textContent="Generated "+r.variants.length+" texture variants"}catch(e){d.querySelector("#fmHint").textContent="Variant generation failed: "+e.message}};
  d.querySelector("#fmPrepare").onclick=async()=>{const f=d.querySelector("#fmFiles").files[0];if(!f)return;const r=await assets.prepare(f,{trim:true,maxSize:4096});const a=document.createElement("a");a.download=r.output.name;a.href=URL.createObjectURL(r.output);a.click();d.querySelector("#fmHint").textContent="Prepared asset exported: "+r.output.name};
  d.querySelector("#fmAtlas").onclick=async()=>{const fs=[...d.querySelector("#fmFiles").files].filter(x=>String(x.type||"").startsWith("image/"));if(!fs.length)return;const r=await assets.atlas(fs,4,4);const a=document.createElement("a");a.download=r.file.name;a.href=URL.createObjectURL(r.file);a.click();d.querySelector("#fmHint").textContent="Atlas "+r.width+"×"+r.height+" with "+r.frames.length+" frames exported."};
  render();
}
function openPCG(){
  const d=modal("Forge World Builder",'<div class="fm-grid"><div class="fm-card"><h4>Procedural Content</h4><label>Seed <input id="pcgSeed" type="number" value="1337"></label><label>Count <input id="pcgCount" type="number" value="40" min="1" max="250"></label><label>Area <input id="pcgArea" type="number" value="30" min="1"></label><div class="fm-actions"><button data-pcg="trees">Generate forest</button><button data-pcg="rocks">Scatter rocks</button><button data-pcg="houses">Generate buildings</button></div></div><div class="fm-card"><h4>Terrain</h4><div class="fm-actions"><button id="genTerrain">Generate Terrain</button></div><pre id="terrainOut" class="fm-code"></pre></div><div class="fm-card"><h4>World Partition</h4><div id="wpStats"></div><div class="fm-actions"><button id="wpRefresh">Refresh cells</button><button id="wpStream">Apply streaming</button></div></div></div>');
  const render=()=>{const p=world.partition();d.querySelector("#wpStats").innerHTML='<div>Cell size: '+world.cellSize+'m</div><div>Loaded cells: '+Object.keys(p.cells).length+'</div><div>Partition is stored in scene components, so streaming can be deterministic.</div>'};
  d.querySelectorAll("[data-pcg]").forEach(b=>b.onclick=()=>{const rs=world.generate(b.dataset.pcg,{seed:+d.querySelector("#pcgSeed").value,count:+d.querySelector("#pcgCount").value,area:+d.querySelector("#pcgArea").value});Forge.frame();render();refreshHierarchy();d.querySelector("#wpStats").insertAdjacentHTML("afterbegin",'<div class="fm-good">Generated '+rs.length+' entities.</div>')});
  d.querySelector("#genTerrain").onclick=()=>{const r=window.ForgeTerrain?.generate("Terrain",{size:+d.querySelector("#pcgArea").value*2,subdivisions:96,seed:+d.querySelector("#pcgSeed").value,height:7});d.querySelector("#terrainOut").textContent=JSON.stringify(r?.components?.terrain||{},null,2);toast("Terrain generated with heightfield collision");};
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
  const project=window.ForgeProject?.serialize?.()||{format:"forge-project",version:4,meta:{engine:"Forge Studio 2.0"},scene:Forge.serialize(),production:{},runtime:{},gameplay:window.ForgeGameplay?.serialize?.()||null};
  project.runtime=project.runtime||{};project.runtime.assetRoot="./";
  project.meta=Object.assign(project.meta||{},{buildMode:"web",renderBackend:"PlayCanvas 2.22.6",physicsBackend:"Rapier 0.21.0"});
  zip.file("project.forge.json",JSON.stringify(project,null,2));
  const runtimeFiles=["forge-engine.js","forge-runtime.js","forge-gameplay.js","forge-project.js","forge-render.js","forge-ui-system.js","forge-vfx.js","forge-2d.js","forge-ai.js","forge-gameplay-data.js","forge-network.js","forge-replay.js","forge-session.js","forge-shader.js","forge-terrain.js","forge-qa.js","forge-animation.js"];
  for(const path of runtimeFiles){const resp=await fetch("./"+path);if(!resp.ok)throw new Error("Cannot package runtime module: "+path);zip.file(path,await resp.text())}
  const runtimeHtml = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><meta name=\"theme-color\" content=\"#06101d\"><title>Forge Game Build</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{width:100%;height:100%;display:block}#boot{position:fixed;inset:0;display:grid;place-items:center;background:#06101d;color:#bcd0e5;font:14px system-ui;z-index:20}</style></head><body><div id=\"boot\">Forge Runtime loading…</div><canvas id=\"c\"></canvas><script type=\"module\">import{ForgeEngine}from\"./forge-engine.js\";const boot=document.getElementById(\"boot\"),canvas=document.getElementById(\"c\");const engine=new ForgeEngine(canvas,m=>console.log(\"[Forge]\",m));await engine.init();window.Forge=engine;await import(\"./forge-runtime.js\");await import(\"./forge-ui-system.js\");await import(\"./forge-render.js\");await import(\"./forge-vfx.js\");await import(\"./forge-2d.js\");await import(\"./forge-ai.js\");await import(\"./forge-gameplay-data.js\");await import(\"./forge-network.js\");await import(\"./forge-replay.js\");await import(\"./forge-session.js\");await import(\"./forge-shader.js\");await import(\"./forge-terrain.js\");await import(\"./forge-qa.js\");await import(\"./forge-gameplay.js\");await import(\"./forge-project.js\");const project=await fetch(\"./project.forge.json\").then(r=>{if(!r.ok)throw new Error(\"Project file missing\");return r.json()});project.runtime=project.runtime||{};project.runtime.assetRoot=\"./\";await window.ForgeProject.load(project);engine.running=true;boot.remove();window.addEventListener(\"error\",e=>console.error(e.error||e.message));<\\/script></body></html>";
  zip.file("index.html",runtimeHtml);
  zip.file("manifest.webmanifest",JSON.stringify({name:"Forge Game",short_name:"ForgeGame",start_url:"./",display:"fullscreen",background_color:"#000000",theme_color:"#06101d"},null,2));
  zip.file("sw.js",'self.addEventListener("install",e=>e.waitUntil(caches.open("forge-v1").then(c=>c.addAll(["./","./index.html","./project.forge.json","./forge-engine.js","./forge-runtime.js","./forge-gameplay.js","./forge-project.js","./forge-render.js","./forge-ui-system.js","./forge-vfx.js","./forge-2d.js","./forge-ai.js","./forge-gameplay-data.js","./forge-network.js","./forge-replay.js","./forge-session.js","./forge-shader.js","./forge-terrain.js","./forge-qa.js","./forge-animation.js"]))));self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request))))');
  for(const [name,a] of Forge.assets||[]) if(a?.file) zip.file("assets/"+name,await a.file.arrayBuffer());
  const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE"});
  const a=document.createElement("a");a.download="forge-web-build.zip";a.href=URL.createObjectURL(blob);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  toast("Full Forge Web build exported");
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

function openAnimationGraph(){
  const r=Forge.selected();const d=modal("Forge Animation Graph + Rig",'<div class="fm-grid"><div class="fm-card"><h4>State Graph</h4><div class="fm-actions"><button id="agNew">Create graph</button><button id="agRun">Evaluate</button></div><pre id="agOut" class="fm-code"></pre></div><div class="fm-card"><h4>Rig Profile</h4><div class="fm-actions"><button id="rigMake">Auto-map humanoid rig</button></div><pre id="rigOut" class="fm-code"></pre></div></div>');
  let graph=null,rig=null;
  d.querySelector("#agNew").onclick=()=>{if(!r){toast("Select an animated entity first");return}graph=window.ForgeAnimation.createGraph(r.id);if(graph.states.length>1)for(let i=0;i<graph.states.length-1;i++)window.ForgeAnimation.addTransition(graph.id,graph.states[i].name,graph.states[i+1].name,{speed:i+1});d.querySelector("#agOut").textContent=JSON.stringify(graph,null,2)};
  d.querySelector("#agRun").onclick=()=>{if(!graph){toast("Create the graph first");return}window.ForgeAnimation.setParameter(graph.id,"speed",1);d.querySelector("#agOut").textContent=JSON.stringify(graph,null,2)};
  d.querySelector("#rigMake").onclick=()=>{if(!r){toast("Select a model first");return}rig=window.ForgeAnimation.createRigProfile(r.id);d.querySelector("#rigOut").textContent=JSON.stringify({profile:rig,validation:window.ForgeAnimation.validateRig(rig.id)},null,2)};
  d.querySelector("#agOut").textContent="No graph yet.";d.querySelector("#rigOut").textContent="No rig profile yet.";
}
function openAnimation(){
  const r=Forge.selected(),clips=r?.components?.animation?.clips||[];
  const d=modal("Forge Animation Lab",'<div class="fm-grid"><div class="fm-card"><h4>Imported Clips</h4><div id="animClips"></div><div class="fm-actions"><button id="animPlay">Play</button><button id="animPause">Pause</button></div></div><div class="fm-card"><h4>State</h4><pre id="animState" class="fm-code"></pre></div></div>');
  const box=d.querySelector("#animClips");box.innerHTML=clips.length?clips.map(x=>'<button data-clip="'+x+'">'+x+'</button>').join(" "):"<span>No imported GLB animation clips on the selected entity.</span>";
  d.querySelectorAll("[data-clip]").forEach(b=>b.onclick=()=>{if(r?.entity?.anim)r.entity.anim.baseLayer.play(b.dataset.clip);d.querySelector("#animState").textContent=JSON.stringify({active:r?.entity?.anim?.baseLayer?.activeState,clips},null,2)});
  d.querySelector("#animPlay").onclick=()=>{if(r?.entity?.anim)r.entity.anim.playing=true;};d.querySelector("#animPause").onclick=()=>{if(r?.entity?.anim)r.entity.anim.playing=false};
  d.querySelector("#animState").textContent=JSON.stringify({clips,active:r?.entity?.anim?.baseLayer?.activeState||null},null,2);
}
function openCinematics(){
  const r=Forge.selected();const d=modal("Forge Sequencer",'<div class="fm-grid"><div class="fm-card"><h4>Track</h4><div class="fm-actions"><button id="seqTrack">Add transform track</button><button id="seqPlay">Play</button><button id="seqStop">Stop</button></div><label>Time <input id="seqTime" type="number" step=".01" value="0"></label><div class="fm-actions"><button id="seqKey">Insert key</button></div></div><div class="fm-card"><h4>Sequence</h4><pre id="seqOut" class="fm-code"></pre></div></div>');
  let track=null;const draw=()=>d.querySelector("#seqOut").textContent=JSON.stringify(window.ForgeCinematics?.serialize?.()||{},null,2);
  d.querySelector("#seqTrack").onclick=()=>{if(!r){toast("Select an entity first");return}track=window.ForgeCinematics.addTrack(r.id,"transform");draw()};
  d.querySelector("#seqKey").onclick=()=>{if(!track){toast("Create a track first");return}const t=+d.querySelector("#seqTime").value||0;const p=r.entity.getLocalPosition();window.ForgeCinematics.key(track.id,t,[p.x,p.y,p.z]);draw()};
  d.querySelector("#seqPlay").onclick=()=>window.ForgeCinematics.play();d.querySelector("#seqStop").onclick=()=>window.ForgeCinematics.stop();draw();
}
function openRuntime(){
  const d=modal("Forge Runtime Lab",'<div class="fm-grid"><div class="fm-card"><h4>Game Templates</h4><div class="fm-actions"><button id="tplTP">Third-Person</button><button id="tplRace">Racing</button><button id="tplShow">AAA Showcase</button></div><div id="tplStatus" class="fm-code">Templates generate playable physics scenes.</div></div><div class="fm-card"><h4>Input Map</h4><div id="rtInput"></div><div class="fm-actions"><button id="rtFocus">Focus viewport</button><button id="rtClear">Clear input state</button></div></div><div class="fm-card"><h4>Navigation</h4><div class="fm-actions"><button id="navBake">Bake grid</button><button id="navPath">Test path</button></div><pre id="navOut" class="fm-code"></pre></div><div class="fm-card"><h4>Save Slots</h4><input id="slotName" value="autosave"><div class="fm-actions"><button id="slotSave">Save slot</button><button id="slotLoad">Inspect slot</button></div><pre id="slotOut" class="fm-code"></pre></div><div class="fm-card"><h4>Prefabs</h4><input id="prefabName" placeholder="Prefab name"><div class="fm-actions"><button id="prefabSave">Save selected as prefab</button></div><pre id="prefabOut" class="fm-code"></pre></div><div class="fm-card"><h4>Network / Replay</h4><input id="netRoom" value="default"><div class="fm-actions"><button id="netConnect">Connect</button><button id="netPublish">Publish state</button><button id="replayRec">Record</button><button id="replayStop">Stop</button><button id="replayPlay">Replay</button></div><pre id="netOut" class="fm-code"></pre></div><div class="fm-card"><h4>Gameplay Data</h4><div class="fm-actions"><button id="dataPlayer">Create Player Data</button><button id="dataQuest">Create Quest</button></div><pre id="dataOut" class="fm-code"></pre></div></div>');
  d.querySelector("#tplTP").onclick=()=>{const r=window.ForgeGameplay.createThirdPersonTemplate();d.querySelector("#tplStatus").textContent=JSON.stringify(r,null,2);toast("Third-person template created")};d.querySelector("#tplRace").onclick=()=>{const r=window.ForgeGameplay.createRacingTemplate();d.querySelector("#tplStatus").textContent=JSON.stringify(r,null,2);toast("Racing template created")};d.querySelector("#tplShow").onclick=()=>{const r=window.ForgeGameplay.createShowcaseGame();d.querySelector("#tplStatus").textContent=JSON.stringify(r,null,2);toast("AAA Showcase created")};
  const renderInput=()=>{d.querySelector("#rtInput").innerHTML=[...(window.ForgeRuntime?.input.bindings||new Map())].map(([k,v])=>'<div>'+k+' → '+v.join(", ")+'</div>').join("")};
  d.querySelector("#rtFocus").onclick=()=>document.querySelector("#viewport")?.focus();d.querySelector("#rtClear").onclick=()=>window.ForgeRuntime?.input.down.clear();
  d.querySelector("#navBake").onclick=()=>{window.ForgeRuntime.nav.bakeFromScene(Forge);d.querySelector("#navOut").textContent=JSON.stringify({width:window.ForgeRuntime.nav.width,height:window.ForgeRuntime.nav.height,cell:window.ForgeRuntime.nav.cell},null,2)};
  d.querySelector("#navPath").onclick=()=>{const p=window.ForgeRuntime.nav.path({x:0,y:0,z:0},{x:8,y:0,z:8});d.querySelector("#navOut").textContent=JSON.stringify(p,null,2)};
  d.querySelector("#slotSave").onclick=()=>{const s=d.querySelector("#slotName").value||"autosave";window.ForgeRuntime.save.save(s,window.ForgeProject?.serialize?.()||Forge.serialize());d.querySelector("#slotOut").textContent=JSON.stringify(window.ForgeRuntime.save.load(s),null,2)};
  d.querySelector("#slotLoad").onclick=()=>{const s=d.querySelector("#slotName").value||"autosave";d.querySelector("#slotOut").textContent=JSON.stringify(window.ForgeRuntime.save.load(s),null,2)};
  d.querySelector("#prefabSave").onclick=()=>{const r=Forge.selected();if(!r){toast("Select an entity first");return}const name=d.querySelector("#prefabName").value||r.name;window.ForgeRuntime.prefabs.save(name,r.id);d.querySelector("#prefabOut").textContent=JSON.stringify(window.ForgeRuntime.prefabs.list(),null,2)};
  d.querySelector("#netConnect").onclick=()=>{window.ForgeNet.connect(d.querySelector("#netRoom").value||"default");d.querySelector("#netOut").textContent=JSON.stringify(window.ForgeNet.status(),null,2)};d.querySelector("#netPublish").onclick=()=>{const r=Forge.selected();if(r)window.ForgeNet.bindEntity(r.id);window.ForgeNet.publishEntity();d.querySelector("#netOut").textContent=JSON.stringify(window.ForgeNet.status(),null,2)};d.querySelector("#replayRec").onclick=()=>{window.ForgeReplay.startRecord();d.querySelector("#netOut").textContent="Replay recording started"};d.querySelector("#replayStop").onclick=()=>{d.querySelector("#netOut").textContent=JSON.stringify(window.ForgeReplay.stopRecord(),null,2)};d.querySelector("#replayPlay").onclick=()=>{window.ForgeReplay.play();d.querySelector("#netOut").textContent=JSON.stringify(window.ForgeReplay.status(),null,2)};
  d.querySelector("#dataPlayer").onclick=()=>{const a=window.ForgeData.actor("editor-player");a.tags.add("Character.Player");a.attributes.set("Health",100);d.querySelector("#dataOut").textContent=JSON.stringify(a.serialize(),null,2)};d.querySelector("#dataQuest").onclick=()=>{const q=window.ForgeData.quests.define("editor-quest",{title:"New Quest",objectives:[{id:"objective",target:3}]});d.querySelector("#dataOut").textContent=JSON.stringify(q,null,2)};
  renderInput();
}

function openShader(){
  const d=modal("Forge Shader Lab",'<div class="fm-grid"><div class="fm-card"><h4>Cross-platform shader presets</h4><div class="fm-actions"><button data-shader="dissolve">Dissolve</button><button data-shader="energy">Energy</button><button data-shader="hologram">Hologram</button><button data-shader="damage">Damage</button></div></div><div class="fm-card"><h4>Runtime</h4><pre id="shaderOut" class="fm-code"></pre></div></div>');
  d.querySelectorAll("[data-shader]").forEach(b=>b.onclick=()=>{try{ForgeShaders.applyPreset(b.dataset.shader);d.querySelector("#shaderOut").textContent=JSON.stringify({preset:b.dataset.shader,diagnostics:Forge.diagnostics()},null,2);toast("Shader applied: "+b.dataset.shader)}catch(e){d.querySelector("#shaderOut").textContent=e.message}});
  d.querySelector("#shaderOut").textContent=JSON.stringify(window.ForgeShaders?.serialize?.()||{},null,2);
}
function openRender(){
  const d=modal("Forge Render Lab",'<div class="fm-grid"><div class="fm-card"><h4>Quality profile</h4><div class="fm-actions"><button data-profile="mobile">Mobile</button><button data-profile="balanced">Balanced</button><button data-profile="high">High</button><button data-profile="cinematic">Cinematic</button></div><pre id="renderState" class="fm-code"></pre></div><div class="fm-card"><h4>Material Graph</h4><div class="fm-actions"><button id="newMatGraph">New PBR graph</button><button id="applyMatGraph">Apply selected graph</button></div><pre id="graphState" class="fm-code"></pre></div></div>');
  const render=()=>d.querySelector("#renderState").textContent=JSON.stringify(window.ForgeRender?.quality?.()||{},null,2);
  d.querySelectorAll("[data-profile]").forEach(b=>b.onclick=()=>{window.ForgeRender?.apply?.(b.dataset.profile);render();toast("Render profile: "+b.dataset.profile)});
  d.querySelector("#newMatGraph").onclick=()=>{const g=window.ForgeRender?.createMaterialGraph?.("PBR "+Date.now());d.querySelector("#graphState").textContent=JSON.stringify(g,null,2)};
  d.querySelector("#applyMatGraph").onclick=()=>{const g=[...(window.ForgeRender?.materialGraphs?.values?.()||[])].at(-1);if(!g){toast("Create a graph first");return}window.ForgeRender.applyGraph(g.id);d.querySelector("#graphState").textContent=JSON.stringify(g,null,2);toast("Material graph applied")};
  render();
}
function openVFX(){
  const d=modal("Forge VFX Lab",'<div class="fm-grid"><div class="fm-card"><h4>Runtime emitters</h4><div class="fm-actions"><button data-vfx="burst">Burst</button><button data-vfx="explosion">Explosion</button><button data-vfx="dust">Dust</button><button data-vfx="rain">Rain</button></div><pre id="vfxState" class="fm-code"></pre></div><div class="fm-card"><h4>Selected entity</h4><div class="fm-actions"><button id="vfxAtSelected">Emit at selected</button></div><div class="fm-code">VFX is runtime data and can be triggered from gameplay or the agent.</div></div></div>');
  const pos=()=>{const r=Forge.selected();if(!r)return{x:0,y:1,z:0};const p=r.entity.getPosition();return{x:p.x,y:p.y,z:p.z}};
  d.querySelectorAll("[data-vfx]").forEach(b=>b.onclick=()=>{window.ForgeVFX?.spawn?.(b.dataset.vfx,pos());d.querySelector("#vfxState").textContent=JSON.stringify(window.ForgeVFX?.status?.(),null,2)});
  d.querySelector("#vfxAtSelected").onclick=()=>{window.ForgeVFX?.explosion?.(pos());d.querySelector("#vfxState").textContent=JSON.stringify(window.ForgeVFX?.status?.(),null,2)};
  d.querySelector("#vfxState").textContent=JSON.stringify(window.ForgeVFX?.status?.(),null,2);
}
function open2D(){
  const d=modal("Forge 2D Lab",'<div class="fm-grid"><div class="fm-card"><h4>2D templates</h4><div class="fm-actions"><button id="platformer2D">Platformer</button></div><pre id="twoDState" class="fm-code"></pre></div><div class="fm-card"><h4>Sprite pipeline</h4><input id="spriteFiles2D" type="file" multiple accept="image/png,image/jpeg,image/webp"><div class="fm-actions"><button id="spriteImport2D">Import sprite</button></div></div></div>');
  d.querySelector("#platformer2D").onclick=()=>{const r=window.Forge2D?.createPlatformerTemplate?.();d.querySelector("#twoDState").textContent=JSON.stringify(r,null,2);toast("2D platformer template created")};
  d.querySelector("#spriteImport2D").onclick=async()=>{const fs=[...d.querySelector("#spriteFiles2D").files];if(!fs.length)return;const r=await window.Forge2D.spriteFromFile(fs[0],"Sprite");Forge.select(r.id);refreshHierarchy();toast("Sprite imported")};
  d.querySelector("#twoDState").textContent=JSON.stringify(window.Forge2D?.status?.(),null,2);
}
function openEditors(){
  const d=modal("Forge Editors",'<div class="fm-grid">'+[
    ["Asset Lab",openAssets,"Import, inspect and process source assets."],
    ["Material Lab",openMaterial,"PBR material parameters and presets."],
    ["Shader Lab",openShader,"Cross-platform shader presets and diagnostics."],
    ["Animation",openAnimation,"Imported clips and playback."],
    ["Animation Graph + Rig",openAnimationGraph,"State graphs and rig profiles."],
    ["Sequencer",openCinematics,"Transform tracks and keyframes."],
    ["Render",openRender,"Quality profiles and material graphs."],
    ["VFX",openVFX,"Runtime particle/VFX controls."],
    ["2D",open2D,"Raster/sprite authoring and import."],
    ["World / PCG",openPCG,"Terrain and world generation systems."],
    ["Logic Graph",openGraph,"Gameplay logic graph."],
    ["Profiler",openProfiler,"Runtime performance diagnostics."],
    ["Vision",()=>window.AssetForgeLiveVision?.open?.(),"Live browser vision and real input control."],
    ["Runtime",openRuntime,"Game runtime, navigation, saves and networking."],
    ["Build Web",openBuild,"Portable web runtime build."]
  ].map(([t,f,desc])=>'<div class="fm-card"><h4>'+t+'</h4><div class="subtle">'+desc+'</div><div class="fm-actions"><button data-editor-tool="'+t+'">Open</button></div></div>').join("")+'</div>');
  const map=new Map([
    ["Asset Lab",openAssets],["Material Lab",openMaterial],["Shader Lab",openShader],["Animation",openAnimation],
    ["Animation Graph + Rig",openAnimationGraph],["Sequencer",openCinematics],["Render",openRender],["VFX",openVFX],
    ["2D",open2D],["World / PCG",openPCG],["Logic Graph",openGraph],["Profiler",openProfiler],
    ["Vision",()=>window.AssetForgeLiveVision?.open?.()],["Runtime",openRuntime],["Build Web",openBuild]
  ]);
  d.querySelectorAll("[data-editor-tool]").forEach(b=>b.onclick=()=>{
    const fn=map.get(b.dataset.editorTool);if(!fn)return;
    d.close();setTimeout(()=>{try{fn()}catch(e){toast("Editor failed: "+e.message)}},0);
  });
  return d;
}
window.ForgeProduction.openEditors=openEditors;
