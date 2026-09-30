let state=null;

async function modules(){
  const THREE=await import("three");
  const {GLTFLoader}=await import("https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/GLTFLoader.js");
  const {OrbitControls}=await import("https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/controls/OrbitControls.js");
  const {RoomEnvironment}=await import("https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/environments/RoomEnvironment.js");
  return{THREE,GLTFLoader,OrbitControls,RoomEnvironment};
}

function disposeObject(THREE,obj){
  obj?.traverse?.(node=>{
    if(!node.isMesh)return;
    node.geometry?.dispose?.();
    const materials=Array.isArray(node.material)?node.material:[node.material];
    for(const m of materials){
      for(const key of ["map","normalMap","roughnessMap","metalnessMap","aoMap","emissiveMap","clearcoatMap","clearcoatNormalMap","clearcoatRoughnessMap"]){
        if(m?.[key]?.dispose) m[key].dispose();
      }
      m?.dispose?.();
    }
  });
}

export async function openRealCarPreview({file,name="Realistic Car",meta={}}){
  const host=document.getElementById("forgeAssetPreview");
  const canvas=document.getElementById("forgeAssetPreviewCanvas");
  const close=document.getElementById("forgeAssetPreviewClose");
  if(!host||!canvas)throw new Error("Forge 3D asset preview host is missing");
  if(state){try{state.dispose()}catch{}state=null}

  const {THREE,GLTFLoader,OrbitControls,RoomEnvironment}=await modules();
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.08;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;

  const scene=new THREE.Scene();
  scene.background=new THREE.Color("#07111d");

  const camera=new THREE.PerspectiveCamera(38,1,.01,500);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=true;
  controls.dampingFactor=.07;
  controls.minDistance=2.4;
  controls.maxDistance=16;
  controls.autoRotate=true;
  controls.autoRotateSpeed=.65;
  controls.target.set(0,1,0);

  const pmrem=new THREE.PMREMGenerator(renderer);
  const environment=new RoomEnvironment(renderer);
  scene.environment=pmrem.fromScene(environment,.04).texture;

  const key=new THREE.DirectionalLight(0xffffff,3.4);
  key.position.set(5,8,6);
  key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);
  key.shadow.camera.near=.1;
  key.shadow.camera.far=40;
  scene.add(key);

  const fill=new THREE.DirectionalLight(0x8ab8ff,1.4);
  fill.position.set(-6,4,-4);
  scene.add(fill);

  const rim=new THREE.DirectionalLight(0xffd6aa,1.6);
  rim.position.set(1,5,-8);
  scene.add(rim);

  const floor=new THREE.Mesh(
    new THREE.PlaneGeometry(28,28),
    new THREE.MeshStandardMaterial({color:0x111a26,roughness:.34,metalness:.25})
  );
  floor.rotation.x=-Math.PI/2;
  floor.receiveShadow=true;
  scene.add(floor);

  const sourceBytes=new Uint8Array(await file.arrayBuffer());
  const loader=new GLTFLoader();
  const gltf=await new Promise((resolve,reject)=>loader.parse(sourceBytes.buffer,"",resolve,reject));
  const root=gltf.scene;
  root.traverse(node=>{
    if(!node.isMesh)return;
    node.castShadow=true;
    node.receiveShadow=true;
    const mats=Array.isArray(node.material)?node.material:[node.material];
    for(const m of mats){
      if("envMapIntensity" in m)m.envMapIntensity=1.15;
      if("metalness" in m&&m.metalness<0)m.metalness=.0;
      if("roughness" in m&&m.roughness<=0)m.roughness=.18;
    }
  });

  const box=new THREE.Box3().setFromObject(root);
  const size=new THREE.Vector3(),center=new THREE.Vector3();
  box.getSize(size);box.getCenter(center);
  const longest=Math.max(size.x,size.y,size.z);
  const scale=longest>0?4.8/longest:1;
  root.scale.setScalar(scale);
  root.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);
  root.rotation.y=-.35;
  scene.add(root);

  const normalizedBox=new THREE.Box3().setFromObject(root);
  const normalizedSize=new THREE.Vector3();
  normalizedBox.getSize(normalizedSize);
  const radius=Math.max(normalizedSize.x,normalizedSize.z)*.62;
  camera.position.set(radius*1.28,Math.max(1.5,normalizedSize.y*.62),radius*1.28);
  camera.lookAt(0,Math.max(.7,normalizedSize.y*.36),0);
  controls.target.set(0,Math.max(.7,normalizedSize.y*.36),0);

  const resize=()=>{
    const rect=host.getBoundingClientRect();
    const w=Math.max(1,rect.width),h=Math.max(1,rect.height);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
  };
  const onResize=()=>resize();
  window.addEventListener("resize",onResize);
  host.classList.remove("hidden");
  resize();

  let raf=0;
  const loop=()=>{
    controls.update();
    renderer.render(scene,camera);
    raf=requestAnimationFrame(loop);
  };
  loop();

  const stats={name,sourceBytes:sourceBytes.byteLength,meshes:0,vertices:0,triangles:0,materials:0,scale};
  const mats=new Set();
  root.traverse(node=>{
    if(!node.isMesh)return;
    stats.meshes++;
    const pos=node.geometry?.attributes?.position;
    if(pos)stats.vertices+=pos.count;
    const idx=node.geometry?.index;
    stats.triangles+=idx?idx.count/3:Math.floor((pos?.count||0)/3);
    const list=Array.isArray(node.material)?node.material:[node.material];
    for(const m of list)if(m)mats.add(m);
  });
  stats.materials=mats.size;

  const setText=()=>{
    const text=document.getElementById("forgeAssetPreviewMeta");
    if(text)text.textContent=`${name} · ${stats.vertices.toLocaleString()} vertices · ${Math.round(stats.triangles).toLocaleString()} triangles · ${stats.materials} materials`;
  };
  setText();

  const dispose=()=>{
    cancelAnimationFrame(raf);
    window.removeEventListener("resize",onResize);
    controls.dispose();
    pmrem.dispose();
    environment.dispose?.();
    disposeObject(THREE,root);
    floor.geometry.dispose();floor.material.dispose();
    renderer.dispose();
    host.classList.add("hidden");
    state=null;
  };
  close?.addEventListener("click",dispose,{once:true});
  state={dispose,renderer,scene,camera,controls,stats};
  window.ForgeDemoAssets=Object.assign(window.ForgeDemoAssets||{},{
    previewReady:true,previewStats:stats,closeCarPreview:dispose
  });
  return{stats,dispose};
}
