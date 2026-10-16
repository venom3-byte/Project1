import * as pc from 'https://cdn.jsdelivr.net/npm/playcanvas@2.22.6/build/playcanvas.mjs';

const F = window.Forge;
const SLOT_DEFS = {
  front: {label:'Front', view:'front', title:'Front / frontal elevation'},
  side:  {label:'Side',  view:'right', title:'Side / longitudinal elevation'},
  top:   {label:'Top',   view:'top', title:'Top / plan view'},
  back:  {label:'Rear',  view:'back', title:'Rear elevation'}
};
const SLOT_FOR_VIEW = {front:'front',right:'side',top:'top',back:'back'};
const DB_NAME = 'forge-reference-studio';
const DB_VERSION = 1;
const state = {root:null, refs:new Map(), activeSlot:'front', view:'perspective', matchViewOnly:true, db:null, dbAvailable:false, dialog:null, previewUrl:null, initialized:false};

function log(message, type='info') {
  try { F?.log?.('[Reference Studio] '+message, type); } catch {}
}
function openDb() {
  return new Promise((resolve,reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('references')) db.createObjectStore('references',{keyPath:'slot'});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the local reference database'));
  });
}
function dbRequest(mode, operation) {
  return openDb().then(db => new Promise((resolve,reject) => {
    const tx = db.transaction('references', mode);
    const store = tx.objectStore('references');
    let value;
    try {
      const req = operation(store);
      req.onsuccess = () => { value = req.result; };
      req.onerror = () => reject(req.error || new Error('Reference database request failed'));
    } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error('Reference database transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Reference database transaction was aborted'));
  }));
}
function dbRecord(record) {
  return {
    slot:record.slot, name:record.name, blob:record.blob, pixelWidth:record.pixelWidth,
    pixelHeight:record.pixelHeight, worldWidth:record.worldWidth, opacity:record.opacity,
    offset:record.offset, center:{...record.center}, enabled:record.enabled
  };
}
async function persist(record) {
  if (!state.dbAvailable) return false;
  try {
    await dbRequest('readwrite', store => store.put(dbRecord(record)));
    return true;
  } catch (error) {
    state.dbAvailable = false;
    log('Local persistence failed; references remain active until this page closes: '+error.message,'error');
    return false;
  }
}
async function removeStored(slot) {
  if (!state.dbAvailable) return;
  try { await dbRequest('readwrite', store => store.delete(slot)); }
  catch (error) { log('Could not remove stored reference: '+error.message,'error'); }
}
function ensureRoot() {
  if (state.root) return state.root;
  state.root = new pc.Entity('Forge Editor Reference Guides');
  F.root.addChild(state.root);
  return state.root;
}
function disposePlane(record) {
  try { record.entity?.destroy(); } catch {}
  try { record.texture?.destroy(); } catch {}
  try { record.material?.destroy?.(); } catch {}
  record.entity = null; record.texture = null; record.material = null;
}
function imageToTexture(blob) {
  return createImageBitmap(blob).then(bitmap => {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d',{alpha:true});
    ctx.drawImage(bitmap,0,0);
    bitmap.close?.();
    const texture = new pc.Texture(F.app.graphicsDevice,{
      width:canvas.width,height:canvas.height,format:pc.PIXELFORMAT_R8_G8_B8_A8,mipmaps:true
    });
    texture.setSource(canvas);
    texture.minFilter = pc.FILTER_LINEAR_MIPMAP_LINEAR;
    texture.magFilter = pc.FILTER_LINEAR;
    texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
    texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
    return {texture,width:canvas.width,height:canvas.height};
  });
}
function materialFor(texture,opacity) {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(1,1,1);
  material.emissive = new pc.Color(1,1,1);
  material.emissiveIntensity = 1;
  material.diffuseMap = texture;
  material.emissiveMap = texture;
  material.useLighting = false;
  material.useTonemap = false;
  material.useMetalness = false;
  material.metalness = 0;
  material.gloss = 0;
  material.specular = new pc.Color(0,0,0);
  material.cull = pc.CULLFACE_NONE;
  material.depthWrite = false;
  setOpacity(material,opacity);
  material.update();
  return material;
}
function setOpacity(material,opacity) {
  const value = Math.max(0.05,Math.min(1,Number(opacity)||0.35));
  material.opacity = value;
  material.blendType = value < 0.999 ? pc.BLEND_NORMAL : pc.BLEND_NONE;
  material.alphaTest = 0;
  material.update();
}
function posePlane(record) {
  const entity = record.entity;
  if (!entity) return;
  const width = Math.max(0.01,Number(record.worldWidth)||10);
  const height = width * record.pixelHeight / Math.max(1,record.pixelWidth);
  const c = record.center || {x:0,y:0,z:0};
  const o = Math.max(0,Math.min(10,Number(record.offset)||0.04));
  entity.setLocalScale(width,1,height);
  if (record.slot === 'front') {
    entity.setLocalEulerAngles(-90,0,0);
    entity.setLocalPosition(Number(c.x)||0,Number(c.y)||0,(Number(c.z)||0)-o);
  } else if (record.slot === 'back') {
    entity.setLocalEulerAngles(-90,0,0);
    entity.setLocalPosition(Number(c.x)||0,Number(c.y)||0,(Number(c.z)||0)+o);
  } else if (record.slot === 'side') {
    // Map the built-in XZ plane onto world Z (image horizontal) and Y (image vertical).
    entity.setLocalRotation(new pc.Quat(-0.5,-0.5,-0.5,0.5));
    entity.setLocalPosition((Number(c.x)||0)-o,Number(c.y)||0,Number(c.z)||0);
  } else {
    // The top guide lies just below the object origin, above the editor floor grid.
    entity.setLocalEulerAngles(0,0,0);
    entity.setLocalPosition(Number(c.x)||0,(Number(c.y)||0)-o,Number(c.z)||0);
  }
}
function visibleForView(record) {
  if (!record.entity?.render) return;
  record.entity.render.enabled = !!record.enabled && (!state.matchViewOnly || state.view === SLOT_DEFS[record.slot].view);
}
function updateVisibility() {
  for (const record of state.refs.values()) visibleForView(record);
}
async function buildPlane(record) {
  ensureRoot();
  const {texture,width,height} = await imageToTexture(record.blob);
  record.pixelWidth = width || record.pixelWidth;
  record.pixelHeight = height || record.pixelHeight;
  const entity = new pc.Entity('Reference · '+SLOT_DEFS[record.slot].label+' · '+record.name);
  entity.addComponent('render',{type:'plane'});
  entity.render.layers = [pc.LAYERID_WORLD];
  entity.render.frustumCulling = false;
  entity.render.castShadows = false;
  entity.render.receiveShadows = false;
  entity.render.material = materialFor(texture,record.opacity);
  state.root.addChild(entity);
  record.entity = entity;
  record.texture = texture;
  record.material = entity.render.material;
  posePlane(record);
  visibleForView(record);
}
async function normalizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1,4096/Math.max(bitmap.width,bitmap.height));
  const width = Math.max(1,Math.round(bitmap.width*scale));
  const height = Math.max(1,Math.round(bitmap.height*scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d',{alpha:true}).drawImage(bitmap,0,0,width,height);
  bitmap.close?.();
  const type = file.type === 'image/png' ? 'image/png' : (file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp');
  const blob = await new Promise((resolve,reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the reference image')),type,type==='image/jpeg'?0.94:undefined);
  });
  return {blob,width,height};
}
async function installReference(info,{save=true}={}) {
  const slot = SLOT_DEFS[info.slot] ? info.slot : 'front';
  const previous = state.refs.get(slot);
  if (previous) disposePlane(previous);
  const record = {
    slot, name:String(info.name||slot+' reference'), blob:info.blob,
    pixelWidth:Math.max(1,Number(info.pixelWidth)||1),
    pixelHeight:Math.max(1,Number(info.pixelHeight)||1),
    worldWidth:Math.max(0.01,Math.min(100000,Number(info.worldWidth)||10)),
    opacity:Math.max(0.05,Math.min(1,Number(info.opacity)||0.4)),
    offset:Math.max(0,Math.min(10,Number(info.offset??0.04))),
    center:{
      x:Number.isFinite(Number(info.center?.x))?Number(info.center.x):0,
      y:Number.isFinite(Number(info.center?.y))?Number(info.center.y):0,
      z:Number.isFinite(Number(info.center?.z))?Number(info.center.z):0
    },
    enabled:info.enabled!==false, entity:null,texture:null,material:null
  };
  state.refs.set(slot,record);
  try {
    await buildPlane(record);
    if (save) await persist(record);
    syncUI();
    window.dispatchEvent(new CustomEvent('forge-reference-changed',{detail:{slot,action:'installed',status:status()}}));
    return record;
  } catch (error) {
    state.refs.delete(slot);
    disposePlane(record);
    throw error;
  }
}
function setEditorView(mode) {
  const button = document.querySelector('[data-view="'+mode+'"]');
  if (button) button.click();
  else {
    F.setView(mode);
    viewChanged(mode);
  }
}
function viewChanged(mode) {
  state.view = SLOT_DEFS[mode] ? mode : (mode === 'right' ? 'right' : mode);
  const mapped = SLOT_FOR_VIEW[mode];
  if (mapped) state.activeSlot = mapped;
  updateVisibility();
  syncUI();
}
function status() {
  return {
    ok:!!state.root, view:state.view, activeSlot:state.activeSlot,
    matchViewOnly:state.matchViewOnly, referenceCount:state.refs.size,
    slots:[...state.refs.values()].map(r=>({
      slot:r.slot,name:r.name,pixelWidth:r.pixelWidth,pixelHeight:r.pixelHeight,
      worldWidth:r.worldWidth,worldHeight:r.worldWidth*r.pixelHeight/Math.max(1,r.pixelWidth),
      opacity:r.opacity,offset:r.offset,center:{...r.center},enabled:r.enabled,
      visible:!!r.entity?.render?.enabled,renderable:!!r.entity?.render?.meshInstances?.length
    })),
    storage:state.dbAvailable?'IndexedDB':'session only',
    isolatedFromSceneSelection:true
  };
}
function setText(id,value) {
  const node = state.dialog?.querySelector('#'+id);
  if (node) node.textContent = value;
}
function syncUI() {
  const d = state.dialog;
  if (!d) return;
  d.querySelectorAll('[data-ref-slot]').forEach(button => {
    const active = button.dataset.refSlot === state.activeSlot;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  const record = state.refs.get(state.activeSlot);
  const setValue = (id,value) => { const node=d.querySelector('#'+id); if(node) node.value=String(value); };
  setValue('refWidth',record?.worldWidth ?? 10);
  setValue('refOpacity',Math.round((record?.opacity ?? 0.4)*100));
  setValue('refOffset',record?.offset ?? 0.04);
  setValue('refX',record?.center.x ?? 0);
  setValue('refY',record?.center.y ?? 0);
  setValue('refZ',record?.center.z ?? 0);
  const enabled = d.querySelector('#refEnabled');
  if (enabled) enabled.checked = record?.enabled !== false;
  const show = d.querySelector('#refMatchView');
  if (show) show.checked = state.matchViewOnly;
  const title = d.querySelector('#refSlotTitle');
  if (title) title.textContent = SLOT_DEFS[state.activeSlot].title;
  const dimensions = d.querySelector('#refDimensions');
  if (dimensions) dimensions.textContent = record
    ? record.pixelWidth+' × '+record.pixelHeight+' px  |  '+(record.worldWidth*record.pixelHeight/record.pixelWidth).toFixed(3)+' m tall'
    : 'No image loaded for this view.';
  const name = d.querySelector('#refName');
  if (name) name.textContent = record ? record.name : 'No reference loaded';
  const preview = d.querySelector('#refPreview');
  if (preview) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = record ? URL.createObjectURL(record.blob) : null;
    preview.src = state.previewUrl || '';
    preview.classList.toggle('empty',!record);
    preview.alt = record ? record.name : 'No reference preview';
  }
  const remove = d.querySelector('#refRemove');
  if (remove) remove.disabled = !record;
  setText('refStorage',state.dbAvailable?'Saved on this device (IndexedDB)':'Session-only: browser storage unavailable');
  setText('refViewState','View: '+state.view+' · '+state.refs.size+' loaded');
}
async function selectSlot(slot) {
  if (!SLOT_DEFS[slot]) return;
  state.activeSlot = slot;
  setEditorView(SLOT_DEFS[slot].view);
  viewChanged(SLOT_DEFS[slot].view);
}
function applyCurrentFromUI() {
  const record = state.refs.get(state.activeSlot);
  if (!record) return;
  const d = state.dialog;
  record.worldWidth = Math.max(0.01,Math.min(100000,Number(d.querySelector('#refWidth').value)||10));
  record.opacity = Math.max(0.05,Math.min(1,(Number(d.querySelector('#refOpacity').value)||40)/100));
  record.offset = Math.max(0,Math.min(10,Number(d.querySelector('#refOffset').value)||0));
  record.center = {
    x:Number(d.querySelector('#refX').value)||0,
    y:Number(d.querySelector('#refY').value)||0,
    z:Number(d.querySelector('#refZ').value)||0
  };
  record.enabled = d.querySelector('#refEnabled').checked;
  posePlane(record);
  if (record.material) setOpacity(record.material,record.opacity);
  visibleForView(record);
  persist(record).then(syncUI);
  window.dispatchEvent(new CustomEvent('forge-reference-changed',{detail:{slot:record.slot,action:'updated',status:status()}}));
  syncUI();
}
async function exportBundle() {
  const records = [];
  for (const r of state.refs.values()) {
    const dataUrl = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Image read failed'));
      reader.readAsDataURL(r.blob);
    });
    records.push({
      slot:r.slot,name:r.name,dataUrl,pixelWidth:r.pixelWidth,pixelHeight:r.pixelHeight,
      worldWidth:r.worldWidth,opacity:r.opacity,offset:r.offset,center:r.center,enabled:r.enabled
    });
  }
  const bundle = {format:'forge-reference-bundle',version:1,coordinateSystem:'Y-up; units=meters',references:records};
  const blob = new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download='forge-reference-guides.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  setText('refStatus','Exported '+records.length+' calibrated reference(s). Keep this bundle with the project.');
}
function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Reference bundle contains an invalid image');
  const mime = (dataUrl.slice(0,comma).match(/^data:([^;]+)/)||[])[1] || 'image/png';
  const binary = atob(dataUrl.slice(comma+1));
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
async function importBundle(file) {
  const bundle = JSON.parse(await file.text());
  if (bundle?.format !== 'forge-reference-bundle' || !Array.isArray(bundle.references)) {
    throw new Error('Not a Forge reference bundle');
  }
  let count = 0;
  for (const item of bundle.references) {
    if (!SLOT_DEFS[item.slot] || typeof item.dataUrl !== 'string') continue;
    await installReference({
      ...item, blob:dataUrlToBlob(item.dataUrl)
    });
    count++;
  }
  setText('refStatus','Imported '+count+' reference(s). They are ready for the matching orthographic views.');
}
function ensureStyles() {
  if (document.getElementById('forge-reference-styles')) return;
  const style = document.createElement('style');
  style.id = 'forge-reference-styles';
  style.textContent = '.forge-reference-modal{width:min(980px,95vw);max-height:94vh}.forge-reference-modal .fm-body{max-height:calc(94vh - 48px);overflow:auto}.ref-disclaimer{margin:0 0 12px;padding:9px 10px;border:1px solid #3a4d60;border-radius:8px;background:#101e2b;color:#a9bacb;font-size:11px;line-height:1.55}.ref-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.ref-tabs button{min-width:62px;font-size:11px}.ref-tabs button.active{background:#1d4861;border-color:#4b91b5;color:#f0fbff}.ref-layout{align-items:start}.ref-layout .fm-card{min-width:0}.ref-field{display:grid;gap:5px;margin:10px 0;color:#afbed0;font-size:11px}.ref-field input:not([type=range]){width:100%;min-width:0;background:#07111c;color:#ecf5ff;border:1px solid #32475b;border-radius:6px;padding:8px}.ref-field input[type=file]{padding:5px;font-size:10px}.ref-field input[type=range]{width:100%;accent-color:#58b4df}.ref-preview-wrap{position:relative;width:100%;aspect-ratio:16/9;background:repeating-conic-gradient(#111e2a 0 25%,#0b1420 0 50%) 50%/18px 18px;border:1px solid #2b4054;border-radius:8px;overflow:hidden;display:grid;place-items:center}.ref-preview-wrap img{width:100%;height:100%;object-fit:contain;position:absolute;inset:0}.ref-preview-wrap img.empty{opacity:0}.ref-preview-empty{padding:10px;text-align:center;color:#617a92;font-size:10px}.ref-preview-wrap img:not(.empty)+.ref-preview-empty{display:none}.ref-name{display:block;margin:9px 0 4px;overflow-wrap:anywhere;font-size:11px;color:#e1edf9}.forge-reference-modal small{display:block;color:#7f95aa;font-size:10px;line-height:1.45}.ref-axis-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.ref-axis-row label{display:grid;gap:5px;font-size:10px;color:#a6b5c8;min-width:0}.ref-axis-row input{width:100%;min-width:0;background:#07111c;color:#ecf5ff;border:1px solid #32475b;border-radius:6px;padding:8px}.ref-check{display:flex;align-items:center;gap:8px;font-size:11px;color:#b5c4d5;margin:12px 0}.ref-check input{accent-color:#58b4df}.ref-actions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.ref-actions button{font-size:10px}.ref-actions .primary{background:#1b6e96;border-color:#348fb9}.ref-actions .danger{color:#ffa1a9}.ref-checks-note{padding:9px;border-left:2px solid #5498bb;background:#0b1723;color:#92a7bc;font-size:10px;line-height:1.5}.forge-reference-modal hr{border:0;border-top:1px solid #25394c;margin:15px 0}.ref-state{margin-top:8px;color:#8dbde0;font-size:10px}.ref-status{min-height:20px;margin:12px 0 0;color:#9bb5cb;font-size:11px;line-height:1.5}.forge-reference-modal button:disabled{opacity:.4}@media(max-width:700px){.forge-reference-modal .ref-layout{grid-template-columns:minmax(0,1fr)}.forge-reference-modal .fm-body{max-height:calc(94vh - 42px);padding:10px}.ref-tabs button{flex:1}.ref-actions button{flex:1 1 auto}.ref-axis-row{gap:4px}.ref-axis-row input{padding:6px;font-size:11px}}';
  document.head.appendChild(style);
}
function open() {
  ensureStyles();
  if (state.dialog?.isConnected) { state.dialog.showModal(); syncUI(); return; }
  const d = document.createElement('dialog');
  d.className = 'forge-modal forge-reference-modal';
  d.innerHTML = '<div class="fm-head"><b>FORGE · REFERENCE STUDIO</b><button type="button" data-ref-close aria-label="Close">×</button></div>'+
    '<div class="fm-body">'+
    '<p class="ref-disclaimer">Calibrated image guides for blockout and tracing. The guide is an editor-only plane, locked against selection and excluded from game export. It is not an automatic 3D reconstruction.</p>'+
    '<div class="ref-tabs" role="tablist" aria-label="Reference view">'+
    '<button type="button" data-ref-slot="front">Front</button><button type="button" data-ref-slot="side">Side</button><button type="button" data-ref-slot="top">Top</button><button type="button" data-ref-slot="back">Rear</button></div>'+
    '<div class="fm-grid ref-layout"><section class="fm-card"><h4 id="refSlotTitle">Front / frontal elevation</h4>'+
    '<label class="ref-field">Reference image <input id="refFile" type="file" accept="image/png,image/jpeg,image/webp,image/avif"></label>'+
    '<div class="ref-preview-wrap"><img id="refPreview" class="empty" alt="Reference preview"><div class="ref-preview-empty">Upload a front, side, top, or rear image</div></div>'+
    '<b id="refName" class="ref-name">No reference loaded</b><small id="refDimensions">No image loaded for this view.</small>'+
    '<label class="ref-field">Real dimension across image width (m)<input id="refWidth" type="number" min="0.01" max="100000" step="0.01" value="10"></label>'+
    '<label class="ref-field">Reference opacity <input id="refOpacity" type="range" min="5" max="100" step="1" value="40"></label>'+
    '<label class="ref-check"><input id="refEnabled" type="checkbox" checked> Show this reference</label>'+
    '<label class="ref-check"><input id="refMatchView" type="checkbox" checked> Show only in its matching orthographic view</label>'+
    '</section><section class="fm-card"><h4>Alignment · world coordinates</h4>'+
    '<div class="ref-axis-row"><label>X (m)<input id="refX" type="number" step="0.01" value="0"></label><label>Y (m)<input id="refY" type="number" step="0.01" value="0"></label><label>Z (m)<input id="refZ" type="number" step="0.01" value="0"></label></div>'+
    '<label class="ref-field">Separation from model (m)<input id="refOffset" type="number" min="0" max="10" step="0.01" value="0.04"></label>'+
    '<div class="ref-actions"><button type="button" id="refApply" class="primary">Apply dimensions & alignment</button><button type="button" id="refReset">Reset center</button><button type="button" id="refRemove" class="danger" disabled>Remove this guide</button></div>'+
    '<div class="ref-checks-note">Guides live in a separate editor-only root: no collider, no hierarchy selection, no effect on framing or playable scene export. The known dimension defines width; height follows the image aspect ratio.</div>'+
    '<hr><h4>Portable reference package</h4><div class="ref-actions"><button type="button" id="refExport">Export references</button><button type="button" id="refImport">Import package</button><input id="refBundleInput" type="file" accept="application/json,.json" hidden></div>'+
    '<small id="refStorage">Local storage status</small><div id="refViewState" class="ref-state"></div>'+
    '</section></div><p id="refStatus" class="ref-status" role="status" aria-live="polite">Choose a view and import a reference image.</p></div>';
  document.body.appendChild(d);
  state.dialog = d;
  d.querySelector('[data-ref-close]').onclick = () => d.close();
  d.addEventListener('close',() => {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    d.remove(); state.dialog = null;
  },{once:true});
  d.querySelectorAll('[data-ref-slot]').forEach(button => button.addEventListener('click',()=>selectSlot(button.dataset.refSlot).catch(error=>setText('refStatus',error.message))));
  d.querySelector('#refFile').addEventListener('change',async event=>{
    const file=event.target.files?.[0];
    if (!file) return;
    try {
      setText('refStatus','Preparing image and creating the calibrated reference plane…');
      const image=await normalizeImage(file);
      await installReference({
        slot:state.activeSlot,name:file.name,blob:image.blob,pixelWidth:image.width,pixelHeight:image.height,
        worldWidth:Number(d.querySelector('#refWidth').value)||10,opacity:(Number(d.querySelector('#refOpacity').value)||40)/100,
        offset:Number(d.querySelector('#refOffset').value)||0.04,center:{x:Number(d.querySelector('#refX').value)||0,y:Number(d.querySelector('#refY').value)||0,z:Number(d.querySelector('#refZ').value)||0},enabled:true
      });
      setText('refStatus','Reference plane created at real-world scale. Check its silhouette against the other views before tracing.');
    } catch (error) {
      log('Reference import failed: '+error.message,'error');
      setText('refStatus','Import failed: '+error.message);
    } finally { event.target.value=''; }
  });
  d.querySelector('#refApply').onclick=applyCurrentFromUI;
  d.querySelector('#refReset').onclick=()=>{
    const r=state.refs.get(state.activeSlot); if (!r) return;
    r.center={x:0,y:0,z:0}; r.offset=0.04; posePlane(r); persist(r).then(syncUI); syncUI();
  };
  d.querySelector('#refRemove').onclick=async()=>{
    const r=state.refs.get(state.activeSlot); if (!r) return;
    disposePlane(r); state.refs.delete(state.activeSlot); await removeStored(state.activeSlot); syncUI();
    setText('refStatus','Removed the reference from this view.');
    window.dispatchEvent(new CustomEvent('forge-reference-changed',{detail:{slot:state.activeSlot,action:'removed',status:status()}}));
  };
  d.querySelector('#refWidth').addEventListener('change',applyCurrentFromUI);
  d.querySelector('#refOpacity').addEventListener('input',applyCurrentFromUI);
  d.querySelector('#refOffset').addEventListener('change',applyCurrentFromUI);
  ['refX','refY','refZ'].forEach(id=>d.querySelector('#'+id).addEventListener('change',applyCurrentFromUI));
  d.querySelector('#refEnabled').addEventListener('change',applyCurrentFromUI);
  d.querySelector('#refMatchView').addEventListener('change',event=>{state.matchViewOnly=event.target.checked;updateVisibility();syncUI()});
  d.querySelector('#refExport').onclick=()=>exportBundle().catch(error=>setText('refStatus','Export failed: '+error.message));
  d.querySelector('#refImport').onclick=()=>d.querySelector('#refBundleInput').click();
  d.querySelector('#refBundleInput').addEventListener('change',async event=>{
    const file=event.target.files?.[0]; if (!file) return;
    try { await importBundle(file); }
    catch(error) { setText('refStatus','Package import failed: '+error.message); }
    finally { event.target.value=''; }
  });
  d.showModal();
  syncUI();
}
async function init() {
  if (!F?.app?.graphicsDevice || !F?.root) throw new Error('Forge must finish initializing before Reference Studio.');
  ensureRoot();
  state.view = F.viewMode || 'perspective';
  try {
    state.db = await openDb();
    state.dbAvailable = true;
    const records = await dbRequest('readonly',store=>store.getAll());
    for (const record of records || []) {
      if (!SLOT_DEFS[record.slot] || !record.blob) continue;
      try { await installReference(record,{save:false}); }
      catch (error) { log('Could not restore '+record.slot+' reference: '+error.message,'error'); }
    }
  } catch (error) {
    state.dbAvailable = false;
    log('Persistent local reference storage unavailable: '+error.message,'warn');
  }
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>viewChanged(button.dataset.view)));
  state.initialized = true;
  window.ForgeReferenceStudio = {open,init:()=>init(),status,viewChanged,serialize:()=>status(),setViewOnly(value){state.matchViewOnly=!!value;updateVisibility();syncUI();},remove:async slot=>{const r=state.refs.get(slot);if(!r)return false;disposePlane(r);state.refs.delete(slot);await removeStored(slot);syncUI();return true;}};
  log('Reference Studio ready; '+state.refs.size+' guide(s) restored.');
}
window.ForgeReferenceStudio = {open,status,viewChanged};
init().catch(error=>log('Initialization failed: '+error.message,'error'));
