import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const loader = new GLTFLoader();
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cameraTarget = new THREE.Vector3(0, 0, 0);
const interactables = [];
const units = [];
const tanks = [];
const soldiers = [];
const aircraft = [];
const targets = [];
const mixers = [];
const bombs = [];
const projectiles = [];
const debris = [];
const impactMarks = [];
const effects = [];
const assets = { tank: null, plane: null, tankSource: '', planeSource: '' };
const state = { command: 'select', selected: null, time: 0, missionComplete: false, paused: false, started: false, mapId: 'pine-valley', pointerDown: null, dragging: false, touchPoints: new Map(), lastPinch: 0, blenderBundle: null, blenderBundlePromise: null, activeAssetPreview: null, activeBlenderMap: null, mapLayout: null, rotorcraftCreated: false, assetPreviewCounter: 0 };
const TEAM = { blue: 0x9fca9c, red: 0xdc7265, amber: 0xeab86b };
const PACKS = {
  tank: 'https://3dassets.dev/api/v1/packs/armoured-column-and-field-camp',
  aircraft: 'https://3dassets.dev/api/v1/packs/aircraft-fleet-and-airfield'
};
const DIRECT = {
  armourScene: 'https://cdn.3dassets.dev/assets/23739/v1/model.glb',
  aircraftFallback: 'https://cdn.3dassets.dev/assets/32595/v1/model.glb',
  f15: 'https://www.innerscene.com/api/library/f-15-eagle-fighter-jet-e1d11142/download'
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7e928b);
scene.fog = new THREE.FogExp2(0x7e928b, 0.0032);
const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.1, 1400);
camera.position.set(0, 104, 126);
camera.lookAt(cameraTarget);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xd9e5d7, 0x364035, 2.05));
const sun = new THREE.DirectionalLight(0xfff0d7, 3.25);
sun.position.set(-55, 100, 52);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -260;
sun.shadow.camera.right = 260;
sun.shadow.camera.top = 240;
sun.shadow.camera.bottom = -240;
sun.shadow.bias = -0.00035;
scene.add(sun);

const material = (color, roughness, metalness, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: roughness === undefined ? 0.82 : roughness, metalness: metalness === undefined ? 0.02 : metalness }, extra || {}));
const mats = {
  ground: material(0x53654a, 1, 0),
  grass: material(0x627353, 1, 0),
  road: material(0x303a3c, 0.98, 0),
  concrete: material(0x8d9289, 0.95, 0),
  line: material(0xd5d5bd, 0.75, 0),
  olive: material(0x485845, 0.86, 0.18),
  oliveLight: material(0x627258, 0.82, 0.16),
  track: material(0x252c2d, 0.92, 0.35),
  steel: material(0x333d40, 0.58, 0.48),
  glass: material(0x27464b, 0.22, 0.25, { transparent: true, opacity: 0.88 }),
  roof: material(0x555e57, 0.92, 0.05),
  hangarWall: material(0x9b9f92, 0.9, 0.05),
  window: material(0x24383a, 0.28, 0.18, { emissive: 0x1d383a, emissiveIntensity: 0.42 }),
  enemy: material(0x76604b, 0.88, 0.12),
  enemyLight: material(0xa58d6b, 0.86, 0.08),
  red: material(0x803e39, 0.75, 0.08),
  target: material(0x706b58, 0.9, 0.06),
  targetRoof: material(0x555a51, 0.9, 0.08),
  destroyed: material(0x343936, 1, 0),
  emissive: material(0xffcc7d, 0.4, 0.04, { emissive: 0xe79a45, emissiveIntensity: 1.5 }),
  blueGlow: new THREE.MeshBasicMaterial({ color: 0x9fca9c, transparent: true, opacity: 0.17, side: THREE.DoubleSide }),
  redGlow: new THREE.MeshBasicMaterial({ color: 0xdc7265, transparent: true, opacity: 0.17, side: THREE.DoubleSide })
};

function addBox(parent, name, size, pos, mat, cast, receive) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = cast !== false;
  mesh.receiveShadow = receive !== false;
  parent.add(mesh);
  return mesh;
}
function addCylinder(parent, name, radiusTop, radiusBottom, height, pos, mat, radial) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial || 12), mat);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function addGroundPlane() {
  const geom = new THREE.PlaneGeometry(220, 190, 100, 84);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const hill = Math.sin(x * 0.045) * 0.9 + Math.cos(z * 0.038) * 0.8 + Math.sin((x + z) * 0.025) * 1.1;
    pos.setY(i, Math.max(-0.3, hill * 0.4));
    const n = (Math.sin(x * 0.7 + z * 0.3) + Math.cos(z * 0.9 - x * 0.21)) * 0.025;
    colors.push(0.31 + n, 0.38 + n * 0.8, 0.27 + n * 0.6);
  }
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const ground = new THREE.Mesh(geom, groundMat);
  ground.name = 'tactical-terrain';
  ground.receiveShadow = true;
  ground.userData.ground = true;
  scene.add(ground);
  interactables.push(ground);
  return ground;
}
const ground = addGroundPlane();
const mapFeatures = new THREE.Group();
mapFeatures.name = 'generated-battlefield-features';
scene.add(mapFeatures);
const MAPS = {
  'pine-valley': { label: 'PINE VALLEY · 520 × 460', root: 'MAP_PINE_VALLEY_ROOT', suffix: 'PINE_VALLEY', biome: 'forest', width: 520, depth: 460, groundTint: 0xd6e2cf, background: 0x7e928b, fog: 0x7e928b, fogDensity: 0.0014, targetPositions: [[-25,-26],[162,-138],[108,-92],[18,18]], tankStarts: [[-150,124],[-143,128],[-157,120],[150,-124],[143,-128]], soldierStarts: [[-162,110,'blue'],[-155,110,'blue'],[-148,110,'blue'],[-162,117,'blue'],[-155,117,'blue'],[-148,117,'blue'],[162,-110,'red'],[155,-110,'red'],[148,-110,'red'],[162,-117,'red'],[155,-117,'red'],[148,-117,'red']] },
  'desert-basin': { label: 'RED BASIN · 560 × 500', root: 'MAP_RED_BASIN_ROOT', suffix: 'RED_BASIN', biome: 'desert', width: 560, depth: 500, groundTint: 0xe2c28c, background: 0xb7a080, fog: 0xb7a080, fogDensity: 0.0010, targetPositions: [[-25,-26],[162,-138],[108,-92],[18,18]], tankStarts: [[-160,132],[-153,136],[-167,128],[160,-132],[153,-136]], soldierStarts: [[-172,118,'blue'],[-165,118,'blue'],[-158,118,'blue'],[-172,125,'blue'],[-165,125,'blue'],[-158,125,'blue'],[172,-118,'red'],[165,-118,'red'],[158,-118,'red'],[172,-125,'red'],[165,-125,'red'],[158,-125,'red']] },
  'river-crossing': { label: 'RIVER CROSSING · 580 × 500', root: 'MAP_RIVER_CROSSING_ROOT', suffix: 'RIVER_CROSSING', biome: 'river', width: 580, depth: 500, groundTint: 0xc8d6b6, background: 0x879b95, fog: 0x879b95, fogDensity: 0.0009, riverZ: -8, targetPositions: [[-25,-26],[162,-138],[108,-92],[18,18]], tankStarts: [[-165,132],[-158,136],[-172,128],[165,-132],[158,-136]], soldierStarts: [[-177,118,'blue'],[-170,118,'blue'],[-163,118,'blue'],[-177,125,'blue'],[-170,125,'blue'],[-163,125,'blue'],[177,-118,'red'],[170,-118,'red'],[163,-118,'red'],[177,-125,'red'],[170,-125,'red'],[163,-125,'red']] },
  'alpine-pass': { label: 'ALPINE PASS · 520 × 500', root: 'MAP_ALPINE_PASS_ROOT', suffix: 'ALPINE_PASS', biome: 'alpine', width: 520, depth: 500, groundTint: 0xcbd2c7, background: 0x89959b, fog: 0x89959b, fogDensity: 0.0012, targetPositions: [[-25,-26],[162,-138],[108,-92],[18,18]], tankStarts: [[-150,132],[-143,136],[-157,128],[150,-132],[143,-136]], soldierStarts: [[-162,118,'blue'],[-155,118,'blue'],[-148,118,'blue'],[-162,125,'blue'],[-155,125,'blue'],[-148,125,'blue'],[162,-118,'red'],[155,-118,'red'],[148,-118,'red'],[162,-125,'red'],[155,-125,'red'],[148,-125,'red']] }
};

function addTerrainDetail() {
  const patch = material(0x465640, 1, 0);
  for (let i = 0; i < 70; i++) {
    const x = (Math.sin(i * 12.71) * 0.5 + 0.5) * 190 - 95;
    const z = (Math.cos(i * 8.23) * 0.5 + 0.5) * 150 - 75;
    if (Math.abs(x) < 18 && z > -2 && z < 60) continue;
    const size = 1.2 + ((i * 7) % 6) * 0.4;
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(size, 0.08, 5), patch);
    tuft.position.set(x, 0.12, z);
    tuft.rotation.y = (i * 0.87) % Math.PI;
    tuft.receiveShadow = true;
    mapFeatures.add(tuft);
  }
}
addTerrainDetail();

function buildAirbase() {
  const base = new THREE.Group();
  base.name = 'airbase';
  scene.add(base);

  // Runway, shoulders, threshold bars and taxiway.
  addBox(base, 'runway-base', [13.5, 0.25, 58], [0, 0.12, 29], mats.road, false, true);
  addBox(base, 'runway-left-shoulder', [1.7, 0.12, 58], [-7.55, 0.05, 29], mats.concrete, false, true);
  addBox(base, 'runway-right-shoulder', [1.7, 0.12, 58], [7.55, 0.05, 29], mats.concrete, false, true);
  for (let z = 4; z < 56; z += 4.1) addBox(base, 'runway-centre-mark', [0.25, 0.025, 1.9], [0, 0.26, z], mats.line, false, false);
  for (let j = 0; j < 8; j++) {
    addBox(base, 'threshold-left', [0.34, 0.03, 3.2], [-4.1 + j * 1.17, 0.27, 54.7], mats.line, false, false);
    addBox(base, 'threshold-right', [0.34, 0.03, 3.2], [-4.1 + j * 1.17, 0.27, 3.3], mats.line, false, false);
  }
  addBox(base, 'taxiway-east', [7, 0.18, 22], [11, 0.08, 43], mats.road, false, true);
  addBox(base, 'apron', [28, 0.18, 16], [13, 0.08, 55], mats.concrete, false, true);
  addBox(base, 'taxi-link', [9, 0.18, 7], [4.7, 0.08, 42], mats.road, false, true);

  // Runway lighting.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xc0f5d0, emissive: 0x8bd8ab, emissiveIntensity: 2 });
  const blueLight = new THREE.MeshStandardMaterial({ color: 0x8baed9, emissive: 0x6284e2, emissiveIntensity: 1.5 });
  for (let z = 3; z <= 55; z += 4) {
    for (const x of [-6.25, 6.25]) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lightMat);
      light.position.set(x, 0.3, z);
      base.add(light);
    }
  }
  for (let z = 35; z <= 54; z += 3) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), blueLight);
    light.position.set(7.8, 0.22, z);
    base.add(light);
  }

  // Hangar building with a deep door recess and roof ribs.
  const hangar = new THREE.Group();
  hangar.position.set(17, 0, 52);
  base.add(hangar);
  addBox(hangar, 'hangar-volume', [19, 7.8, 12], [0, 3.9, 0], mats.hangarWall);
  addBox(hangar, 'hangar-roof', [20.4, 0.48, 13], [0, 7.9, 0], mats.roof);
  addBox(hangar, 'hangar-door-dark', [10.8, 5.7, 0.22], [0, 3, -6.13], mats.road);
  for (let x = -4.6; x <= 4.6; x += 1.15) addBox(hangar, 'hangar-door-panel', [0.08, 5.5, 0.16], [x, 3, -6.28], mats.steel);
  for (let z = -4.5; z <= 4.5; z += 2.25) addBox(hangar, 'roof-rib', [19.7, 0.12, 0.18], [0, 8.2, z], mats.steel);
  for (let x = -8.5; x <= 8.5; x += 4.2) addBox(hangar, 'hangar-facade-beam', [0.28, 7.6, 0.32], [x, 3.85, -6.21], mats.roof);
  addBox(hangar, 'hangar-service-door', [1.4, 2.6, 0.2], [7.5, 1.45, -6.22], mats.window);

  // Control tower with observation glass.
  const tower = new THREE.Group();
  tower.position.set(29, 0, 43);
  base.add(tower);
  addBox(tower, 'tower-base', [5.4, 7.8, 5.4], [0, 3.9, 0], mats.hangarWall);
  addBox(tower, 'tower-observation-room', [7.1, 2.6, 7.1], [0, 8.2, 0], mats.glass);
  addBox(tower, 'tower-roof', [7.8, 0.45, 7.8], [0, 9.75, 0], mats.roof);
  for (let y = 7.1; y <= 9.1; y += 2) {
    addBox(tower, 'tower-window-band', [7.3, 0.08, 7.3], [0, y, 0], mats.steel);
  }
  addCylinder(tower, 'tower-antenna', 0.05, 0.05, 2.6, [1.3, 11.2, 0], mats.steel, 8);
  addCylinder(tower, 'tower-radar', 0.9, 0.9, 0.35, [1.3, 12.4, 0], mats.concrete, 18);

  // Fuel points, workshops, stores and perimeter.
  const store = new THREE.Group();
  store.position.set(-15, 0, 48);
  base.add(store);
  addBox(store, 'fuel-shed', [9, 3.5, 7], [0, 1.75, 0], mats.roof);
  addBox(store, 'fuel-shed-roof', [9.8, 0.32, 7.8], [0, 3.6, 0], mats.steel);
  for (let x = -2.4; x <= 2.4; x += 2.4) {
    addCylinder(store, 'fuel-tank', 0.85, 0.85, 2.3, [x, 1.2, 5], mats.enemyLight, 14);
  }
  for (let x = -43; x <= 43; x += 5.5) {
    addBox(base, 'perimeter-post', [0.22, 1.5, 0.22], [x, 0.75, 64], mats.steel, false, true);
  }
  addBox(base, 'perimeter-line', [90, 0.12, 0.12], [0, 1.15, 64], mats.steel, false, false);
  addBox(base, 'base-access-road', [7, 0.1, 18], [-23, 0.05, 40], mats.road, false, true);
}
buildAirbase();

function buildTree(x, z, scale) {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  const trunk = addCylinder(tree, 'trunk', 0.15, 0.24, 1.5, [0, 0.75, 0], material(0x574b36, 1, 0), 7);
  trunk.castShadow = false;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.8, 7), material(0x394c38, 1, 0));
  crown.position.y = 2.4;
  crown.castShadow = true;
  tree.add(crown);
  mapFeatures.add(tree);
}
// Tree cover is generated for each chosen battlefield.


function clearImpactMarks(){
  impactMarks.splice(0).forEach((mark)=>{if(mark.parent)mark.parent.remove(mark);mark.traverse((node)=>{if(node.geometry)node.geometry.dispose();if(node.material)(Array.isArray(node.material)?node.material:[node.material]).forEach((m)=>{if(m&&m.dispose)m.dispose();});});});
}
function clearMapFeatures() {
  clearImpactMarks();
  const shared=new Set(Object.values(mats).flatMap((entry)=>Array.isArray(entry)?entry:[entry]));
  for(const child of [...mapFeatures.children]){const ownedMaterials=new Set();mapFeatures.remove(child);child.traverse((node)=>{if(node.geometry)node.geometry.dispose();if(node.material)(Array.isArray(node.material)?node.material:[node.material]).forEach((m)=>{if(m&&!shared.has(m))ownedMaterials.add(m);});});ownedMaterials.forEach((m)=>m.dispose());}
}
function addRiverFeature(width,centreZ){
  const vertices=[],indices=[],steps=Math.ceil(width/12);
  for(let i=0;i<=steps;i++){const x=-width/2+width*i/steps,z=centreZ+Math.sin(x*.018)*10+Math.sin(x*.043)*3;vertices.push(x,.18,z-9,x,.18,z+9);if(i<steps){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const water=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x397680,roughness:.24,metalness:.08,transparent:true,opacity:.94,side:THREE.DoubleSide}));water.name='wide-river-corridor';water.receiveShadow=true;mapFeatures.add(water);
  for(const x of [-65,48,160]){const z=centreZ+Math.sin(x*.018)*10+Math.sin(x*.043)*3,bridge=new THREE.Group();bridge.position.set(x,.26,z);addBox(bridge,'bridge-deck',[16,.5,25],[0,0,0],mats.concrete);addBox(bridge,'bridge-rail-a',[16,.55,.25],[0,.54,-11.8],mats.steel);addBox(bridge,'bridge-rail-b',[16,.55,.25],[0,.54,11.8],mats.steel);mapFeatures.add(bridge);}
}
function buildMapFeatures(config){
  clearMapFeatures();addTerrainDetail();const width=config.width,depth=config.depth;
  const rand=(n,o=0)=>{const v=Math.sin((n+1)*127.1+o*311.7)*43758.5453;return v-Math.floor(v);};
  if(config.biome==='river')addRiverFeature(width,config.riverZ||-8);
  if(config.biome==='forest'||config.biome==='river'){const count=config.biome==='forest'?105:64;for(let i=0;i<count;i++){const x=(rand(i,1)-.5)*(width-36),z=(rand(i,2)-.5)*(depth-36);if(Math.abs(x)<74&&z>-126&&z<86)continue;buildTree(x,z,.58+rand(i,3)*.62);}}
  else if(config.biome==='desert'){const duneMat=material(0xc5a66f,1,0),rockMat=material(0x88785e,.96,0);for(let i=0;i<54;i++){const x=(rand(i,4)-.5)*(width-30),z=(rand(i,5)-.5)*(depth-30);if(Math.abs(x)<80&&z>-126&&z<82)continue;const dune=new THREE.Mesh(new THREE.SphereGeometry(1,10,7),duneMat);dune.name='wind-carved-dune';dune.position.set(x,.18,z);dune.scale.set(7+rand(i,6)*14,.35+rand(i,7)*.7,4+rand(i,8)*8);dune.rotation.y=rand(i,9)*Math.PI;mapFeatures.add(dune);if(i%3===0){const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1.1+rand(i,10)*2,0),rockMat);rock.position.set(x+4,.7,z-2);rock.rotation.set(rand(i,11),rand(i,12),rand(i,13));rock.castShadow=true;mapFeatures.add(rock);}}}
  else if(config.biome==='alpine'){const mountainMat=material(0x66716d,.94,.02),snowMat=material(0xaaaead,.9,.02);for(let i=0;i<34;i++){const side=i%4,x=side<2?(rand(i,14)-.5)*width:(side===2?-1:1)*(width*.43+rand(i,15)*width*.06),z=side>=2?(rand(i,16)-.5)*depth:(side===0?-1:1)*(depth*.42+rand(i,17)*depth*.07);if(Math.abs(x)<95&&z>-130&&z<95)continue;const height=13+rand(i,18)*33,mountain=new THREE.Mesh(new THREE.ConeGeometry(11+rand(i,19)*15,height,5+(i%3)),i%4===0?snowMat:mountainMat);mountain.name='mountain-ridge';mountain.position.set(x,height*.47,z);mountain.rotation.y=rand(i,20)*Math.PI;mountain.castShadow=true;mapFeatures.add(mountain);}for(let i=0;i<28;i++){const x=(rand(i,21)-.5)*(width-40),z=(rand(i,22)-.5)*(depth-40);if(Math.abs(x)<90&&z>-130&&z<88)continue;buildTree(x,z,.55+rand(i,23)*.55);}}
  addBox(mapFeatures,'north-south-supply-road',[5.6,.12,depth*.72],[-width*.27,.12,0],mats.road,false,true);
  addBox(mapFeatures,'east-west-supply-road',[width*.72,.12,5.6],[width*.11,.12,depth*.23],mats.road,false,true);
  for(let i=0;i<14;i++){const x=(rand(i,30)-.5)*(width-70),z=(rand(i,31)-.5)*(depth-70);if(Math.abs(x)<100&&z>-140&&z<95)continue;const h=2+rand(i,32)*5,wreck=addBox(mapFeatures,'abandoned-structure',[3+rand(i,33)*5,h,3+rand(i,34)*5],[x,h/2,z],i%2?mats.destroyed:mats.concrete);wreck.rotation.y=rand(i,35)*Math.PI;}
}
function addSelectionRing(parent, color) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  ring.visible = false;
  parent.add(ring);
  return ring;
}
function tagInteractive(root, type, ref) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.userData[type] = ref;
      if (!o.material) o.material = mats.olive;
    }
  });
  root.userData[type] = ref;
}
function makeTrackSide(parent, x) {
  const points = [
    new THREE.Vector3(x, 0.32, -1.48), new THREE.Vector3(x, 0.83, -1.22),
    new THREE.Vector3(x, 0.9, 1.15), new THREE.Vector3(x, 0.36, 1.5),
    new THREE.Vector3(x, 0.3, -1.2)
  ];
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.18);
  const belt = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.12, 8, true), mats.track);
  belt.name = x < 0 ? 'left-track-belt' : 'right-track-belt';
  belt.castShadow = true;
  parent.add(belt);

  // Separate tread pads travel around a closed belt path instead of remaining visually frozen.
  const segments = [];
  const segmentCount = 36;
  for (let i = 0; i < segmentCount; i++) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.17), mats.track);
    pad.name = x < 0 ? 'left-track-pad' : 'right-track-pad';
    pad.castShadow = true;
    parent.add(pad);
    segments.push(pad);
  }
  const wheelPivots = [];
  for (let i = 0; i < 6; i++) {
    const z = -1.05 + i * 0.42;
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.19, 16), mats.track);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.48, z);
    wheel.castShadow = true;
    parent.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.205, 12), mats.steel);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(wheel.position);
    parent.add(hub);
    wheelPivots.push(wheel, hub);
  }
  const track = { curve, segments, wheels: wheelPivots, phase: 0, length: curve.getLength() };
  positionTrackSegments(track);
  return track;
}
function positionTrackSegments(track) {
  const count = track.segments.length;
  for (let i = 0; i < count; i++) {
    const t = (i / count + track.phase + 1) % 1;
    const point = track.curve.getPointAt(t);
    const tangent = track.curve.getTangentAt(t).normalize();
    const segment = track.segments[i];
    segment.position.copy(point);
    segment.rotation.set(Math.atan2(-tangent.y, tangent.z), 0, 0);
  }
}
function advanceTrack(track, distance) {
  if (!track.length) return;
  track.phase = (track.phase + distance / track.length + 1) % 1;
  positionTrackSegments(track);
}
function makeTankVisual(team) {
  const g = new THREE.Group();
  g.name = 'procedural-tank-fallback';
  const hullMat = team === 'blue' ? mats.olive : mats.enemy;
  const panelMat = team === 'blue' ? mats.oliveLight : mats.enemyLight;
  addBox(g, 'lower-hull', [2.25, 0.72, 3.35], [0, 0.76, 0], hullMat);
  addBox(g, 'upper-hull', [1.9, 0.54, 2.35], [0, 1.35, 0.02], panelMat);
  addBox(g, 'front-glacis', [2.05, 0.25, 0.95], [0, 1.1, 1.4], hullMat);
  addBox(g, 'engine-deck', [1.25, 0.18, 0.85], [0, 1.55, -0.9], mats.roof);
  addBox(g, 'turret-collar', [1.4, 0.22, 1.4], [0, 1.7, 0.1], mats.track);
  const turret = new THREE.Group();
  turret.name = 'TURRET_PIVOT';
  turret.position.set(0, 1.78, 0.05);
  g.add(turret);
  addBox(turret, 'turret-main', [1.42, 0.56, 1.48], [0, 0.22, 0], hullMat);
  addBox(turret, 'turret-front', [1.18, 0.36, 0.58], [0, 0.25, 0.76], panelMat);
  const barrel = addCylinder(turret, 'BARREL_PIVOT', 0.095, 0.13, 2.05, [0, 0.22, 1.9], mats.steel, 12);
  barrel.rotation.x = Math.PI / 2;
  addCylinder(turret, 'muzzle-ring', 0.145, 0.145, 0.18, [0, 0.22, 2.86], mats.track, 12).rotation.x = Math.PI / 2;
  addBox(turret, 'sight', [0.36, 0.18, 0.28], [0.45, 0.61, -0.25], mats.glass);
  const trackL = makeTrackSide(g, -1.06);
  const trackR = makeTrackSide(g, 1.06);
  for (let i = 0; i < 3; i++) {
    addBox(g, 'side-skirt', [0.13, 0.2, 0.92], [i % 2 ? 1.15 : -1.15, 1.1, -0.58 + i * 0.75], panelMat);
  }
  return { root: g, turret, wheels: trackL.wheels.concat(trackR.wheels), tracks: [trackL, trackR], barrel, imported: false };
}
function createTank(x, z, team, name) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  scene.add(root);
  const visualData = makeTankVisual(team);
  root.add(visualData.root);
  visualData.root.traverse((node)=>{if(node.isMesh)node.userData.initialMaterial=node.material;});
  const unit = {
    id: 'tank-' + (tanks.length + 1), type: 'tank', name, team, group: root, visual: visualData.root,
    visualData, ring: addSelectionRing(root, team === 'blue' ? TEAM.blue : TEAM.red),
    hp: 100, maxHp: 100, status: 'HOLDING', moveTarget: null, attackTarget: null, fireTimer: 1 + tanks.length * 0.4,
    speed: 4.3, turret: visualData.turret, selected: false, alive: true
  };
  tagInteractive(root, 'rtsUnit', unit);
  tanks.push(unit);
  units.push(unit);
  interactables.push(root);
  return unit;
}
createTank(-18, 7, 'blue', 'M1A2 MAIN BATTLE TANK');
createTank(-12.8, 11.3, 'blue', 'ARMOURED SUPPORT');
createTank(-24, 0.6, 'blue', 'MOBILE GUN PLATFORM');
createTank(16, -17, 'red', 'HOSTILE ARMOUR');
createTank(23, -22, 'red', 'HOSTILE ARMOUR');

function createInfantry(x,z,team,role,index){
  const root=new THREE.Group();root.name='INFANTRY_'+team.toUpperCase()+'_'+index;root.position.set(x,0,z);
  const uniform=material(team==='blue'?0x53694e:0x855244,.92,.01),helmetMat=material(team==='blue'?0x394938:0x574338,.82,.02),skin=material(0x9c795d,.88,0);
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.19,.48,3,7),uniform);body.position.y=.88;body.castShadow=true;root.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.16,10,8),skin);head.position.set(0,1.31,.02);head.castShadow=true;root.add(head);
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(.19,10,7),helmetMat);helmet.scale.set(1.05,.65,1.05);helmet.position.set(0,1.4,.02);root.add(helmet);
  const arms=[],legs=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.22,1.02,.02);root.add(arm);
    const upper=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.31,3,6),uniform);upper.rotation.z=side*-.28;upper.position.y=-.14;upper.castShadow=true;arm.add(upper);arms.push(arm);
    const leg=new THREE.Group();leg.position.set(side*.105,.55,0);root.add(leg);
    const lower=new THREE.Mesh(new THREE.CapsuleGeometry(.085,.32,3,6),uniform);lower.position.y=-.12;lower.castShadow=true;leg.add(lower);legs.push(leg);
  }
  const rifle=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.72),material(0x252b29,.54,.38));rifle.position.set(.13,1.02,.45);rifle.rotation.x=-.12;root.add(rifle);
  root.traverse((node)=>{if(node.isMesh)node.userData.initialMaterial=node.material;});scene.add(root);
  const soldier={id:'infantry-'+index,type:'infantry',name:role+' · '+team.toUpperCase(),team,role,group:root,hp:32,maxHp:32,status:'ADVANCING',alive:true,selected:false,moveTarget:null,attackTarget:null,fireTimer:1.2+(index%4)*.6,fallProgress:0,fallDirection:team==='blue'?-1:1,ring:addSelectionRing(root,team==='blue'?TEAM.blue:TEAM.red),arms,legs};
  tagInteractive(root,'rtsUnit',soldier);soldiers.push(soldier);units.push(soldier);interactables.push(root);return soldier;
}
[
  [-21,15,'blue','RIFLE SQUAD'],[-17,16,'blue','RIFLE SQUAD'],[-13,18,'blue','SQUAD LEADER'],
  [-30,8,'blue','MACHINE GUNNER'],[-27,12,'blue','COMBAT MEDIC'],[-20,3,'blue','ANTI-ARMOUR'],
  [14,-12,'red','RIFLE SQUAD'],[18,-13,'red','RIFLE SQUAD'],[24,-19,'red','SQUAD LEADER'],
  [28,-24,'red','MACHINE GUNNER'],[10,-22,'red','ANTI-ARMOUR'],[19,-28,'red','COMBAT MEDIC']
].forEach(([x,z,team,role],i)=>createInfantry(x,z,team,role,i+1));

function createBuildingTarget(name, x, z, kind) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  scene.add(root);
  root.name = kind;
  let main;
  if (kind === 'radar') {
    addBox(root, 'radar-slab', [10, 0.32, 8], [0, 0.16, 0], mats.concrete);
    addBox(root, 'radar-control', [5.3, 2.5, 4.4], [0, 1.4, 0], mats.hangarWall);
    addBox(root, 'radar-roof', [5.8, 0.22, 4.9], [0, 2.75, 0], mats.roof);
    addCylinder(root, 'radar-mast', 0.12, 0.18, 3.4, [0, 4.6, 0], mats.steel, 12);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.65, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), mats.concrete);
    dish.position.set(0, 6.2, 0);
    dish.rotation.x = -0.52;
    dish.castShadow = true;
    root.add(dish);
    addCylinder(root, 'radar-rim', 1.66, 1.66, 0.1, [0, 6.15, 0], mats.steel, 24);
    main = root;
  } else if (kind === 'depot') {
    addBox(root, 'depot-slab', [14, 0.35, 10], [0, 0.18, 0], mats.concrete);
    addBox(root, 'depot-main', [9, 4.7, 7], [0, 2.5, 0], mats.target);
    addBox(root, 'depot-roof', [9.8, 0.42, 7.7], [0, 4.95, 0], mats.targetRoof);
    for (let bx = -3.2; bx <= 3.2; bx += 1.6) {
      addBox(root, 'warehouse-rib', [0.13, 4.4, 0.16], [bx, 2.6, -3.62], mats.steel);
    }
    addBox(root, 'depot-door', [3.1, 2.7, 0.2], [0, 1.45, 3.61], mats.road);
    for (let sx = -7; sx <= 7; sx += 4) {
      const crate = addBox(root, 'supply-crate', [2.1, 1.3, 1.6], [sx, 0.75, 6.7], mats.enemy);
      crate.rotation.y = sx * 0.025;
    }
    main = root;
  } else {
    addBox(root, 'target-pad', [10, 0.25, 8], [0, 0.14, 0], mats.concrete);
    addBox(root, 'sam-trailer', [5.8, 1.1, 3.3], [0, 0.8, 0], mats.enemy);
    addBox(root, 'sam-launcher', [1.4, 0.28, 5.6], [0, 1.55, -0.1], mats.steel);
    for (let i = 0; i < 4; i++) {
      const missile = addCylinder(root, 'sam-missile', 0.12, 0.16, 3, [-1.7 + (i % 2) * 3.4, 2.1, -0.6 + Math.floor(i / 2) * 1.25], mats.enemyLight, 8);
      missile.rotation.x = Math.PI / 2;
    }
    addBox(root, 'radar-van', [2.8, 1.6, 2.2], [5.5, 0.9, -2.4], mats.roof);
    main = root;
  }
  root.traverse((o) => { if (o.isMesh) o.userData.initialMaterial = o.material; });
  const target = { id: 'target-' + (targets.length + 1), type: 'target', name, kind, group: root, main, hp: kind === 'depot' ? 100 : 80, maxHp: kind === 'depot' ? 100 : 80, selected: false, alive: true, ring: addSelectionRing(root, TEAM.amber) };
  target.ring.scale.setScalar(kind === 'depot' ? 4.4 : 3.2);
  target.ring.material.color.setHex(TEAM.amber);
  tagInteractive(root, 'rtsTarget', target);
  // Target marker flag.
  const flag = addBox(root, 'objective-flag', [0.14, 1.5, 0.14], [0, 7.4, 0], mats.emissive, false, false);
  const flagTop = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.55), new THREE.MeshBasicMaterial({ color: TEAM.amber, side: THREE.DoubleSide }));
  flagTop.position.set(0.55, 7.75, 0);
  root.add(flagTop);
  targets.push(target);
  interactables.push(root);
  return target;
}
createBuildingTarget('LOGISTICS DEPOT', -24, -52, 'depot');
createBuildingTarget('RADAR SITE', 15, -57, 'radar');
createBuildingTarget('SAM BATTERY', 30, -38, 'sam');
createBuildingTarget('FORWARD COMMAND', -2, -39, 'command');

function markerPositionInMap(root,name){
  if(!root||!name)return null;const marker=root.getObjectByName(name);if(!marker)return null;
  root.updateMatrixWorld(true);const p=marker.getWorldPosition(new THREE.Vector3());return {x:p.x,z:p.z};
}
function installBlenderMap(mapId){
  const config=MAPS[mapId];if(!config||!state.blenderBundle)return false;
  const source=state.blenderBundle.roots.get(config.root);if(!source)return false;
  if(state.activeBlenderMap&&state.activeBlenderMap.group)scene.remove(state.activeBlenderMap.group);
  clearMapFeatures();mapFeatures.visible=false;ground.visible=false;
  const fallbackAirbase=scene.getObjectByName('airbase');if(fallbackAirbase)fallbackAirbase.visible=false;
  const oldIndex=interactables.indexOf(ground);if(oldIndex>=0)interactables.splice(oldIndex,1);
  const group=SkeletonUtils.clone(source);group.name='ACTIVE_BLENDER_MAP_'+mapId.toUpperCase().replaceAll('-','_');
  group.position.set(0,0,0);group.rotation.set(0,0,0);group.scale.set(1,1,1);scene.add(group);group.updateMatrixWorld(true);
  state.activeBlenderMap={mapId,group,sourceRoot:config.root};return true;
}
function buildMapLayout(config,useBlender){
  const root=useBlender&&state.activeBlenderMap?state.activeBlenderMap.group:null;
  const at=(suffix)=>root?markerPositionInMap(root,suffix+'_'+config.suffix):null;
  const targetMarkers=[at('OBJECTIVE_DEPOT'),at('OBJECTIVE_RADAR'),at('OBJECTIVE_SAM'),at('OBJECTIVE_COMMAND')];
  const targetLayout=config.targetPositions.map(p=>({x:p[0],z:p[1]}));
  targetMarkers.forEach((p,i)=>{if(p)targetLayout[i]=p;});
  const blueArmour=at('SPAWN_BLUE_ARMOUR'),redArmour=at('SPAWN_RED_ARMOUR');
  const blueInfantry=at('SPAWN_BLUE_INFANTRY'),redInfantry=at('SPAWN_RED_INFANTRY');
  const offsets=[[-4,0],[0,3],[4,-2],[0,0],[4,3],[-4,3]];
  const teamTankCount={blue:0,red:0};
  const tankLayout=tanks.map((unit,i)=>{
    const base=unit.team==='blue'?blueArmour:redArmour,idx=teamTankCount[unit.team]++,d=offsets[idx%offsets.length];
    const fb=config.tankStarts[i]||config.tankStarts[0];return base?{x:base.x+d[0],z:base.z+d[1]}:{x:fb[0],z:fb[1]};
  });
  const teamInfCount={blue:0,red:0};
  const soldierLayout=soldiers.map((unit,i)=>{
    const base=unit.team==='blue'?blueInfantry:redInfantry,idx=teamInfCount[unit.team]++,dx=(idx%3-1)*4.5,dz=Math.floor(idx/3)*4.5;
    const fb=config.soldierStarts[i]||config.soldierStarts[0];return base?{x:base.x+dx,z:base.z+dz,team:unit.team}:{x:fb[0],z:fb[1],team:fb[2]};
  });
  const airbase=at('AIRBASE_BLUE'),airOffsets=[[-3,-2],[3,-2],[-5,3],[5,3],[0,5],[0,-5]];
  const aircraftLayout=aircraft.map((plane,i)=>{const o=airOffsets[i%airOffsets.length];return airbase?{x:airbase.x+o[0],z:airbase.z+o[1]}:{x:plane.initial.x,z:plane.initial.z};});
  return {targets:targetLayout,tanks:tankLayout,soldiers:soldierLayout,aircraft:aircraftLayout,airbase};
}
function applyBattlefieldMap(mapId,initial=false){
  const config=MAPS[mapId]||MAPS['pine-valley'];state.mapId=mapId in MAPS?mapId:'pine-valley';
  ground.scale.set(config.width/220,1,config.depth/190);ground.material.color.setHex(config.groundTint);
  scene.background.setHex(config.background);scene.fog.color.setHex(config.fog);scene.fog.density=config.fogDensity;
  sun.shadow.camera.left=-config.width*.46;sun.shadow.camera.right=config.width*.46;sun.shadow.camera.top=config.depth*.44;sun.shadow.camera.bottom=-config.depth*.44;sun.shadow.camera.updateProjectionMatrix();
  const usingBlender=installBlenderMap(state.mapId);
  if(!usingBlender){
    if(state.activeBlenderMap&&state.activeBlenderMap.group)scene.remove(state.activeBlenderMap.group);
    state.activeBlenderMap=null;ground.visible=true;mapFeatures.visible=true;
    const fallbackAirbase=scene.getObjectByName('airbase');if(fallbackAirbase)fallbackAirbase.visible=true;
    if(!interactables.includes(ground))interactables.push(ground);
    buildMapFeatures(config);
  }
  const layout=buildMapLayout(config,usingBlender);state.mapLayout=layout;
  targets.forEach((target,i)=>{const p=layout.targets[i]||layout.targets[0];target.group.position.set(p.x,0,p.z);});
  tanks.forEach((unit,i)=>{const p=layout.tanks[i]||{x:config.tankStarts[i][0],z:config.tankStarts[i][1]};unit.group.position.set(p.x,0,p.z);});
  soldiers.forEach((unit,i)=>{const p=layout.soldiers[i]||{x:config.soldierStarts[i][0],z:config.soldierStarts[i][1],team:unit.team};unit.group.position.set(p.x,0,p.z);unit.team=p.team||unit.team;unit.name=unit.role+' · '+unit.team.toUpperCase();});
  aircraft.forEach((plane,i)=>{const p=layout.aircraft[i];if(!p)return;plane.initial.x=p.x;plane.initial.z=p.z;plane.group.position.set(p.x,.16,p.z);});
  cameraTarget.set(0,0,0);camera.position.set(0,config.depth*.42,config.depth*.47);camera.lookAt(cameraTarget);
  const selector=$('mapSelector');if(selector&&selector.value!==state.mapId)selector.value=state.mapId;
  resetMission();addLog((usingBlender?'Blender-authored theatre loaded: ':'Fallback theatre loaded: ')+config.label,'normal');
  if(!initial)toast(config.label+' · '+(usingBlender?'Blender map loaded':'fallback map loaded'));
}

function makeJetVisual() {
  const root = new THREE.Group();
  root.name = 'procedural-fighter-fallback';
  const bodyMat = material(0x818a87, 0.42, 0.48);
  const panelMat = material(0x4d5a59, 0.48, 0.44);
  const canopyMat = new THREE.MeshPhysicalMaterial({ color: 0x273d49, roughness: 0.16, metalness: 0.35, transparent: true, opacity: 0.84, clearcoat: 1 });
  const exhaustMat = material(0x282f32, 0.28, 0.72);
  const missileMat = material(0xbbb9a8, 0.56, 0.38);
  function fuselageSection(x, y, z, rx, ry) { return { x, y, z, rx, ry }; }
  const sections = [
    fuselageSection(0, 1.12, -4.6, 0.03, 0.03),
    fuselageSection(0, 1.13, -3.4, 0.23, 0.22),
    fuselageSection(0, 1.18, -2.1, 0.52, 0.4),
    fuselageSection(0, 1.2, -0.3, 0.76, 0.57),
    fuselageSection(0, 1.18, 1.9, 0.66, 0.52),
    fuselageSection(0, 1.2, 3.6, 0.55, 0.42),
    fuselageSection(0, 1.2, 4.7, 0.46, 0.35)
  ];
  const verts = [], inds = [], uvs = [];
  const rings = 12;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    for (let r = 0; r < rings; r++) {
      const a = r / rings * Math.PI * 2;
      verts.push(s.x + Math.cos(a) * s.rx, s.y + Math.sin(a) * s.ry, s.z);
      uvs.push(r / rings, i / (sections.length - 1));
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let r = 0; r < rings; r++) {
      const a = i * rings + r, b = i * rings + (r + 1) % rings, c = (i + 1) * rings + r, d = (i + 1) * rings + (r + 1) % rings;
      inds.push(a, c, b, b, c, d);
    }
  }
  const fusGeom = new THREE.BufferGeometry();
  fusGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  fusGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  fusGeom.setIndex(inds);
  fusGeom.computeVertexNormals();
  const fuselage = new THREE.Mesh(fusGeom, bodyMat);
  fuselage.castShadow = true;
  root.add(fuselage);
  function wing(name, points, thickness, mat) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.07, bevelThickness: 0.06 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 1.24;
    mesh.name = name;
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  }
  wing('swept-main-wings', [[-6.1, -0.15], [-5.8, 0.65], [-1.05, 2.55], [1.05, 2.55], [5.8, 0.65], [6.1, -0.15], [3.1, 0.42], [0, 0.88], [-3.1, 0.42]], 0.22, bodyMat);
  wing('tailplanes', [[-3.2, 3.0], [-2.9, 3.75], [-0.45, 4.25], [0.45, 4.25], [2.9, 3.75], [3.2, 3.0], [1.5, 3.25], [-1.5, 3.25]], 0.16, bodyMat);
  const vtailL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 1.55, 1.7), panelMat);
  vtailL.position.set(-0.67, 2.02, 2.85); vtailL.rotation.z = -0.27; vtailL.rotation.x = -0.2; root.add(vtailL);
  const vtailR = vtailL.clone(); vtailR.position.x = 0.67; vtailR.rotation.z = 0.27; root.add(vtailR);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.61, 18, 10), canopyMat);
  cockpit.scale.set(0.8, 0.45, 1.45); cockpit.position.set(0, 1.65, -1.35); cockpit.castShadow = true; root.add(cockpit);
  for (const x of [-0.82, 0.82]) {
    addBox(root, 'intake', [0.36, 0.55, 1.08], [x, 0.9, 0.15], panelMat);
    const intakeDark = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.36, 0.75), exhaustMat);
    intakeDark.position.set(x * 1.02, 0.96, -0.05); root.add(intakeDark);
    const engine = addCylinder(root, 'engine-exhaust', 0.26, 0.3, 0.8, [x * 0.48, 1.14, 4.3], exhaustMat, 16);
    engine.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const pylon = addBox(root, 'weapon-pylon', [0.15, 0.22, 1.3], [x * 3.3, 0.9, 0.9], panelMat);
      pylon.rotation.y = side * 0.05;
      const missile = addCylinder(root, 'air-to-ground-store', 0.09, 0.13, 1.6, [x * 3.3, 0.73, 1.0], missileMat, 8);
      missile.rotation.x = Math.PI / 2;
      addCylinder(root, 'weapon-nose', 0, 0.09, 0.22, [x * 3.3, 0.73, 1.9], missileMat, 8).rotation.x = Math.PI / 2;
    }
  }
  for (const x of [-5.7, 5.7]) {
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: x < 0 ? 0x5baeff : 0xe86b5d }));
    nav.position.set(x, 1.28, -0.05);
    root.add(nav);
  }
  const gear = new THREE.Group();
  gear.name = 'LANDING_GEAR';
  root.add(gear);
  for (const x of [-0.8, 0.8, 0]) {
    const z = x === 0 ? 3.55 : 0.85;
    const leg = addCylinder(gear, 'gear-leg', 0.055, 0.075, 0.78, [x, 0.55, z], panelMat, 8);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12), mats.track);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.2, z); wheel.name = 'gear-wheel'; gear.add(wheel);
  }
  root.userData.fallbackGear = gear;
  // Match the glTF +Z-forward convention (the procedural fuselage nose was built at -Z).
  root.rotation.y = Math.PI;
  return root;
}
function setAssetText(text, loaded) {
  $('assetText').textContent = text;
  $('assetBadge').classList.toggle('loaded', !!loaded);
  $('assetBadge').querySelector('i').style.background = loaded ? '#c8e29b' : '#eab766';
}
function safeUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && /\.glb(?:[?#].*)?$/i.test(url);
}
async function findModelUrl(manifestUrl, pattern) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let data;
    try {
      const response = await fetch(manifestUrl, { mode: 'cors', cache: 'force-cache', signal: controller.signal });
      if (!response.ok) throw new Error('Manifest status ' + response.status);
      data = await response.json();
    } finally {
      clearTimeout(timer);
    }
    let found = '';
    const visited = new Set();
    function walk(node) {
      if (!node || found) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (typeof node !== 'object') return;
      if (visited.has(node)) return;
      visited.add(node);
      const labels = [node.name, node.title, node.slug, node.label, node.assetName, node.asset_name, node.displayName, node.display_name, node.modelName, node.model_name, node.filename].filter((v) => typeof v === 'string').join(' ');
      const urls = Object.entries(node).filter(([key, value]) => /url|href|model|file|download|cdn/i.test(key) && typeof value === 'string' && /^https?:\/\//i.test(value)).map((entry) => entry[1]);
      if (pattern.test(labels)) {
        const candidate = urls.find(safeUrl);
        if (candidate) { found = candidate; return; }
        const anyUrl = urls.find((v) => /\.glb(?:[?#].*)?$/i.test(v));
        if (anyUrl) { found = anyUrl; return; }
      }
      for (const value of Object.values(node)) walk(value);
    }
    walk(data);
    return found;
  } catch (error) {
    console.warn('Pack manifest unavailable', manifestUrl, error);
    return '';
  }
}
function loadGLTF(url, timeoutMs) {
  return Promise.race([
    loader.loadAsync(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out loading ' + url)), timeoutMs || 14000))
  ]);
}
function cloneGLTFScene(gltf) {
  return SkeletonUtils.clone(gltf.scene);
}
function normaliseModel(model, targetLength) {
  const box0 = new THREE.Box3().setFromObject(model);
  const size0 = box0.getSize(new THREE.Vector3());
  const longest = Math.max(size0.x, size0.z, size0.y);
  if (longest > 0) model.scale.setScalar(targetLength / longest);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  model.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true; }
  });
  return model;
}
function replaceTankVisual(unit, gltf) {
  const old = unit.visual;
  unit.group.remove(old);
  const clone = normaliseModel(cloneGLTFScene(gltf), 4.35);
  clone.rotation.y = 0;
  let turret = null;
  const wheels = [];
  clone.traverse((node) => {
    const name = (node.name || '').toLowerCase();
    if (!turret && !node.isMesh && /turret/.test(name)) turret = node;
    if (node.isMesh && /(road.?wheel|wheel|roller)/.test(name)) wheels.push(node);
    if (node.isMesh && node.material && unit.team === 'red') {
      const tintMaterial = (source) => {
        const tinted = source.clone();
        if (tinted.color) tinted.color.multiply(new THREE.Color(0x9d6e67));
        return tinted;
      };
      node.material = Array.isArray(node.material) ? node.material.map(tintMaterial) : tintMaterial(node.material);
    }
  });
  clone.traverse((node)=>{if(node.isMesh)node.userData.initialMaterial=node.material;});
  unit.visual = clone;
  unit.visualData = { imported: true, turret, wheels, tracks: [] };
  unit.turret = turret;
  unit.group.add(clone);
  tagInteractive(clone, 'rtsUnit', unit);
}
function replacePlaneVisual(plane, gltf) {
  if (plane.visual) plane.group.remove(plane.visual);
  const clone = normaliseModel(cloneGLTFScene(gltf), 11.5);
  clone.traverse((node)=>{if(node.isMesh)node.userData.initialMaterial=node.material;});
  plane.visual = clone;
  // Pack models are exported with their nose along local +Z; the aircraft root owns heading.
  clone.rotation.y = 0;
  plane.group.add(clone);
  tagInteractive(clone, 'rtsUnit', plane);
  if (gltf.animations && gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(clone);
    const actions = {};
    for (const clip of gltf.animations) {
      actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
      if (/prop-spin|rotor-spin|radar-turn|beacon-spin/.test(clip.name.toLowerCase())) {
        actions[clip.name.toLowerCase()].play();
      }
    }
    plane.mixer = mixer;
    plane.actions = actions;
    mixers.push(mixer);
  }
}
async function loadTankAssets() {
  const url = await findModelUrl(PACKS.tank, /main[\s_-]*battle[\s_-]*tank/i);
  if (!url) {
    console.info('No single tank URL found in manifest; keeping the detailed tank rig for M0.');
    return false;
  }
  try {
    const gltf = await loadGLTF(url, 12000);
    assets.tank = gltf;
    assets.tankSource = url;
    tanks.forEach((u) => replaceTankVisual(u, gltf));
    setAssetText('Imported main battle tank GLB · CC0 pack', true);
    addLog('Armour model imported from CC0 GLB source.', 'normal');
    return true;
  } catch (err) {
    console.warn('Tank GLB load failed', err);
    return false;
  }
}
async function loadPlaneAssets() {
  const packUrl = await findModelUrl(PACKS.aircraft, /tandem[\s_-]*seat[\s_-]*jet[\s_-]*trainer|very[\s_-]*light[\s_-]*personal[\s_-]*jet/i);
  const candidates = [];
  if (packUrl) candidates.push(packUrl);
  candidates.push(DIRECT.f15, DIRECT.aircraftFallback);
  for (const url of candidates) {
    try {
      const gltf = await loadGLTF(url, 15000);
      // A valid GLB with no meshes is not a useful game asset.
      let meshCount = 0;
      gltf.scene.traverse((o) => { if (o.isMesh) meshCount++; });
      if (!meshCount) throw new Error('GLB contains no mesh nodes');
      assets.plane = gltf;
      assets.planeSource = url;
      aircraft.forEach((p) => replacePlaneVisual(p, gltf));
      const clips = gltf.animations ? gltf.animations.length : 0;
      setAssetText('Imported aircraft GLB · ' + meshCount + ' mesh nodes · ' + clips + ' clips', true);
      addLog('Aircraft GLB loaded. Runtime sortie animation is connected.', 'normal');
      return true;
    } catch (err) {
      console.warn('Aircraft source failed', url, err);
    }
  }
  setAssetText('Aircraft asset source unavailable · detailed local fallback active', false);
  addLog('External aircraft model unavailable; local detailed fallback is active.', 'alert');
  return false;
}

function createPlane(x, z, index) {
  const group = new THREE.Group();
  group.position.set(x, 0.16, z);
  group.rotation.order = 'YXZ';
  scene.add(group);
  const visual = makeJetVisual();
  visual.scale.setScalar(0.92);
  group.add(visual);
  visual.traverse((node)=>{if(node.isMesh)node.userData.initialMaterial=node.material;});
  const plane = {
    id: 'aircraft-' + index, type: 'aircraft', name: 'STRIKE FLIGHT ' + String(index).padStart(2, '0'),
    team: 'blue', group, visual, ring: addSelectionRing(group, TEAM.blue),
    hp: 100, maxHp: 100, status: 'READY AT BASE', state: 'ready', target: null,
    route: [], routeIndex: 0, speed: 11.5, flightHeight: 0, attackDone: false, hasLanded: true,
    selected: false, alive: true, rearmTimer: 0, aaTimer: 2.6, crashVelocity: null, crashSmoke: null, mixer: null, actions: {}, initial: { x, z },
    gear: visual.userData.fallbackGear || null, fallback: true
  };
  tagInteractive(group, 'rtsUnit', plane);
  aircraft.push(plane);
  units.push(plane);
  interactables.push(group);
  return plane;
}
createPlane(3.1, 53, 1);
createPlane(-3.2, 53.5, 2);

function setLoadProgress(percent, text) {
  $('loadProgress').style.width = Math.max(0, Math.min(100, percent)) + '%';
  $('loadState').textContent = text;
}
function addLog(message, type) {
  const box = $('log');
  const line = document.createElement('div');
  line.className = 'logline' + (type === 'alert' ? ' alert' : '');
  const m = Math.floor(state.time / 60).toString().padStart(2, '0');
  const s = Math.floor(state.time % 60).toString().padStart(2, '0');
  const stamp = document.createElement('b'); stamp.textContent = m + ':' + s;
  const copy = document.createElement('span'); copy.textContent = message;
  line.append(stamp, copy);
  box.prepend(line);
  while (box.children.length > 7) box.removeChild(box.lastChild);
  $('logCount').textContent = 'LIVE';
}
let toastTimer = 0;
function toast(message) {
  const t = $('toast'); t.textContent = message; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function setCommand(command) {
  if (command === 'reset') { resetMission(); return; }
  state.command = command;
  document.querySelectorAll('.cmd[data-command]').forEach((b) => b.classList.toggle('active', b.dataset.command === command));
  const labels = { select: 'Selection mode', move: 'Move order: tap destination', attack: 'Attack order: tap hostile unit or objective', airstrike: 'Airstrike: choose an objective to attack', return: 'Return order: select an aircraft or use Return' };
  toast(labels[command] || 'Command ready');
}
document.querySelectorAll('.cmd[data-command]').forEach((button) => button.addEventListener('click', () => setCommand(button.dataset.command)));

function selectEntity(entity) {
  if (state.selected) { state.selected.selected = false; if (state.selected.ring) state.selected.ring.visible = false; }
  state.selected = entity;
  if (entity) { entity.selected = true; if (entity.ring) entity.ring.visible = true; }
  updateSelectionPanel();
}
function updateSelectionPanel() {
  const u = state.selected;
  if (!u) {
    $('selectedName').textContent = 'No unit selected';
    $('selectedMeta').textContent = 'Tap a friendly unit or hostile objective';
    $('selectedState').textContent = 'STANDBY'; $('selectedValue').textContent = '—'; $('selectedHealth').style.width = '100%';
    return;
  }
  $('selectedName').textContent = u.name;
  $('selectedMeta').textContent = u.type === 'target'
    ? 'Hostile objective · ' + String(u.kind).toUpperCase()
    : (u.type === 'aircraft'
      ? 'Fixed-wing strike asset · Air wing'
      : (u.type === 'asset_preview'
        ? 'Blender GLB model · asset preview only'
        : (u.type === 'infantry'
          ? 'Infantry squad · active movement and damage state'
          : 'Ground vehicle · active movement and weapons')));
  $('selectedState').textContent = (u.status || (u.alive ? 'ACTIVE' : 'DESTROYED')).toUpperCase();
  $('selectedValue').textContent = Math.max(0, Math.round(u.hp)) + ' HP';
  $('selectedHealth').style.width = Math.max(0, (u.hp / u.maxHp) * 100) + '%';
  $('selectedHealth').style.background = u.hp < u.maxHp * 0.35 ? '#ed7668' : '#c8e29b';
}
function getRootEntity(obj) {
  let current = obj;
  while (current) {
    if (current.userData && (current.userData.rtsUnit || current.userData.rtsTarget)) return current.userData.rtsUnit || current.userData.rtsTarget;
    current = current.parent;
  }
  return null;
}
function worldPoint(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactables, true);
  for (const hit of hits) {
    const entity = getRootEntity(hit.object);
    if (entity) return { entity, point: hit.point };
  }
  const groundHit = raycaster.intersectObject(ground, false)[0];
  return groundHit ? { entity: null, point: groundHit.point } : null;
}
function pointerCommand(hit) {
  if (!hit) return;
  const entity = hit.entity;
  if (entity) {
    if (entity.assetOnly) {
      selectEntity(entity);
      toast('Catalog preview · ' + entity.name);
      return;
    }
    if (entity.type === 'target' || entity.kind) {
      if (state.command === 'airstrike') {
        launchAirstrike(entity);
      } else if (state.command === 'attack') {
        const attackers = state.selected && ['tank','infantry'].includes(state.selected.type) ? [state.selected] : tanks.filter((t) => t.team === 'blue' && t.alive);
        attackers.forEach((u) => { u.attackTarget = entity; u.moveTarget = null; u.status = 'ENGAGING ' + entity.kind.toUpperCase(); });
        addLog('Ground group assigned to attack ' + entity.name + '.', 'normal');
      } else {
        selectEntity(entity);
      }
      return;
    }
    if (entity.team === 'blue') {
      if ((state.command === 'return') && entity.type === 'aircraft') { returnAircraft(entity); return; }
      selectEntity(entity);
      return;
    }
    if (state.command === 'attack' && ['tank','infantry'].includes(entity.type)) {
      const attackers = state.selected && state.selected.team === 'blue' && ['tank','infantry'].includes(state.selected.type) ? [state.selected] : tanks.filter((t) => t.team === 'blue' && t.alive);
      attackers.forEach((u) => { u.attackTarget = entity; u.moveTarget = null; u.status = 'ENGAGING HOSTILE UNIT'; });
      addLog('Hostile unit engaged.', 'alert');
      return;
    }
  }
  if (!hit.point) return;
  if (state.command === 'move') {
    const movers = state.selected && state.selected.team === 'blue' && ['tank','infantry'].includes(state.selected.type) ? [state.selected] : tanks.filter((t) => t.team === 'blue' && t.alive);
    movers.forEach((u, i) => {
      u.moveTarget = new THREE.Vector3(hit.point.x + (i - (movers.length - 1) / 2) * 2.7, 0, hit.point.z + (i % 2) * 2.4);
      u.attackTarget = null; u.status = 'MOVING TO WAYPOINT';
    });
    addLog('Ground movement order issued. ' + movers.length + ' unit(s) tasked.', 'normal');
  } else if (state.command === 'return' && state.selected && state.selected.type === 'aircraft') {
    returnAircraft(state.selected);
  } else if (state.command === 'select') {
    selectEntity(null);
  }
}
function buildRouteFor(target,plane){
  const x=target.group.position.x,z=target.group.position.z,bx=plane.initial.x,bz=plane.initial.z;
  if(plane.flightClass==='rotary-wing'){
    return [
      {p:new THREE.Vector3(bx,.22,bz),state:'VERTICAL LIFT'},
      {p:new THREE.Vector3(bx,7,bz+6),state:'HOVER CLIMB'},
      {p:new THREE.Vector3(bx+(x-bx)*.35,12,bz+(z-bz)*.35),state:'INGRESS'},
      {p:new THREE.Vector3(x,8,z+18),state:'ATTACK RUN'},
      {p:new THREE.Vector3(x+(x>bx?-3:3),5,z+8),state:'HOVER ATTACK'},
      {p:new THREE.Vector3(x+(x>bx?-16:16),9,z-15),state:'EGRESS'},
      {p:new THREE.Vector3(bx+(x-bx)*.38,11,bz+(z-bz)*.38),state:'RETURN'},
      {p:new THREE.Vector3(bx,7,bz+18),state:'APPROACH'},
      {p:new THREE.Vector3(bx,1.1,bz+5),state:'LANDING'},
      {p:new THREE.Vector3(bx,.22,bz),state:'REARM'}
    ];
  }
  return [
    {p:new THREE.Vector3(bx,.22,bz),state:'TAXI-OUT'},
    {p:new THREE.Vector3(bx,.22,bz-22),state:'LINE-UP'},
    {p:new THREE.Vector3(bx,1.3,bz-42),state:'TAKEOFF'},
    {p:new THREE.Vector3(bx+(x-bx)*.34,7,z+25),state:'CLIMB'},
    {p:new THREE.Vector3(bx+(x-bx)*.78,13,z+14),state:'INGRESS'},
    {p:new THREE.Vector3(x,8,z+5),state:'ATTACK RUN'},
    {p:new THREE.Vector3(x+(x>bx?-10:10),14,z-12),state:'EGRESS'},
    {p:new THREE.Vector3(bx+(x-bx)*.48,19,bz-42),state:'RETURN'},
    {p:new THREE.Vector3(bx,12,bz-22),state:'APPROACH'},
    {p:new THREE.Vector3(bx,.5,bz-8),state:'LANDING'},
    {p:new THREE.Vector3(bx,.22,bz-3),state:'TAXI-IN'},
    {p:new THREE.Vector3(bx,.16,bz),state:'REARM'}
  ];
}
function launchAirstrike(target){
  if(!target||!target.alive){toast('Choose a live hostile objective');return;}
  if(state.selected&&state.selected.type==='aircraft'&&state.selected.isTransport){toast('Transport helicopter cannot attack; return it to base or select a combat unit.');return;}
  const plane=state.selected&&state.selected.type==='aircraft'&&state.selected.state==='ready'&&!state.selected.isTransport
    ?state.selected:aircraft.find((p)=>p.state==='ready'&&!p.isTransport);
  if(!plane){toast('No combat aircraft ready — wait for rearm');addLog('Airstrike denied: no combat aircraft ready.','alert');return;}
  selectEntity(plane);plane.target=target;plane.route=buildRouteFor(target,plane);plane.routeIndex=0;plane.state='taxi';plane.status=plane.flightClass==='rotary-wing'?'VERTICAL LIFT':'TAXI-OUT';
  plane.attackDone=false;plane.hasLanded=false;plane.group.position.set(plane.initial.x,.16,plane.initial.z);plane.flightHeight=.16;
  if(plane.mixer&&plane.actions)Object.keys(plane.actions).forEach((key)=>{if(/afterburner/i.test(key)&&plane.flightClass!=='rotary-wing')plane.actions[key].reset().play();});
  addLog(plane.name+' launched against '+target.name+'.','alert');toast('Air tasking accepted · '+target.name);setCommand('select');
}
function returnAircraft(plane){
  if(!plane||plane.type!=='aircraft'){toast('Select an aircraft first');return;}
  if(plane.state==='ready'||plane.state==='rearm'||plane.state==='taxi-home'){toast('Aircraft is already at base');return;}
  const bx=plane.initial.x,bz=plane.initial.z;
  plane.target=null;
  plane.route=plane.flightClass==='rotary-wing'
    ?[
      {p:new THREE.Vector3(plane.group.position.x,Math.max(plane.group.position.y,8),plane.group.position.z+10),state:'RTB / EGRESS'},
      {p:new THREE.Vector3(bx+(plane.group.position.x-bx)*.45,10,bz+(plane.group.position.z-bz)*.45),state:'RETURN'},
      {p:new THREE.Vector3(bx,6,bz+16),state:'APPROACH'},
      {p:new THREE.Vector3(bx,1,bz+4),state:'LANDING'},
      {p:new THREE.Vector3(bx,.16,bz),state:'REARM'}
    ]
    :[
      {p:new THREE.Vector3(plane.group.position.x*.45+bx*.55,Math.max(12,plane.group.position.y),plane.group.position.z+14),state:'RTB / EGRESS'},
      {p:new THREE.Vector3(bx,16,bz-42),state:'RETURN'},
      {p:new THREE.Vector3(bx,10,bz-22),state:'APPROACH'},
      {p:new THREE.Vector3(bx,.5,bz-8),state:'LANDING'},
      {p:new THREE.Vector3(bx,.22,bz-3),state:'TAXI-IN'},
      {p:new THREE.Vector3(bx,.16,bz),state:'REARM'}
    ];
  plane.routeIndex=0;plane.state='return';plane.status='RETURNING TO BASE';addLog('Return-to-base order issued to '+plane.name+'.','normal');setCommand('select');
}
function spawnGuidedMissile(plane,target){
  const start=plane.group.localToWorld(new THREE.Vector3(plane.flightClass==='rotary-wing'?.9:1.0,.05,1.5));
  const aim=target.group.position.clone().add(new THREE.Vector3((Math.sin(state.time)*.45),1.05,Math.cos(state.time*1.3)*.4));
  const mesh=new THREE.Group();mesh.name='guided-air-to-ground-missile';
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.055,.115,.68,9),material(0xc5c6b8,.4,.28));
  const nose=new THREE.Mesh(new THREE.ConeGeometry(.075,.24,9),material(0x373e3e,.36,.4));nose.position.y=.44;mesh.add(body,nose);
  for(const side of [-1,1]){const fin=new THREE.Mesh(new THREE.BoxGeometry(.16,.11,.025),material(0x6e7772,.56,.25));fin.position.set(side*.09,-.2,0);mesh.add(fin);}
  const direction=aim.clone().sub(start);mesh.position.copy(start);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());scene.add(mesh);
  const duration=THREE.MathUtils.clamp(start.distanceTo(aim)/32,.8,2.8);
  bombs.push({mesh,target,t:0,duration,from:start.clone(),to:aim.clone(),guided:true,team:plane.team||'blue',lastTrailAt:0});
  addLog(plane.name+' launched a guided missile.','alert');
}
function spawnBomb(plane,target){
  if(plane.attackDone||!target||!target.alive)return;
  plane.attackDone=true;
  if(plane.flightClass==='rotary-wing'){spawnGuidedMissile(plane,target);return;}
  const from=plane.group.position.clone();from.y=Math.max(5,plane.group.position.y-.25);
  const to=new THREE.Vector3(target.group.position.x+Math.sin(state.time)*.8,.8,target.group.position.z+Math.cos(state.time*1.3)*.7);
  const bomb=new THREE.Mesh(new THREE.CylinderGeometry(.12,.16,.72,10),material(0x28302e,.4,.5));bomb.position.copy(from);scene.add(bomb);
  const gravity=9.81,duration=THREE.MathUtils.clamp(Math.sqrt(Math.max(.5,2*(from.y-to.y)/gravity)),.45,1.8);
  const velocity=new THREE.Vector3((to.x-from.x)/duration,(to.y-from.y+.5*gravity*duration*duration)/duration,(to.z-from.z)/duration);
  bombs.push({mesh:bomb,target,t:0,duration,from,to,velocity,gravity,ballistic:true,team:plane.team||'blue'});
  addLog('Bomb release · ballistic trajectory calculated from release height.','alert');
}
function createImpactMark(position,size=2.6){
  const mark=new THREE.Group();mark.position.set(position.x,.055,position.z);mark.name='persistent-impact-scorch';
  const soot=new THREE.Mesh(new THREE.CircleGeometry(size,20),new THREE.MeshStandardMaterial({color:0x33342f,roughness:1,transparent:true,opacity:.78,depthWrite:false}));soot.rotation.x=-Math.PI/2;soot.scale.set(1,.78,1);mark.add(soot);
  const rim=new THREE.Mesh(new THREE.RingGeometry(size*.72,size,24),new THREE.MeshStandardMaterial({color:0x777266,roughness:1,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false}));rim.rotation.x=-Math.PI/2;rim.position.y=.015;mark.add(rim);(state.activeBlenderMap?state.activeBlenderMap.group:mapFeatures).add(mark);impactMarks.push(mark);
}
function explodeAt(position,target,payload={}){
  const blast=new THREE.Group();blast.position.copy(position);scene.add(blast);
  const core=new THREE.Mesh(new THREE.SphereGeometry(payload.aerial?1.9:1.1,14,10),new THREE.MeshBasicMaterial({color:0xffa43c,transparent:true,opacity:.94,depthWrite:false}));core.position.y=.85;blast.add(core);
  const smoke=new THREE.Mesh(new THREE.SphereGeometry(payload.aerial?2.9:1.7,12,8),new THREE.MeshBasicMaterial({color:0x464a43,transparent:true,opacity:.56,depthWrite:false}));smoke.position.set(.2,1.9,-.15);blast.add(smoke);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.45,.78,32),new THREE.MeshBasicMaterial({color:0xffd07e,transparent:true,opacity:.82,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.18;blast.add(ring);
  const flash=new THREE.Mesh(new THREE.SphereGeometry(.5,10,8),new THREE.MeshBasicMaterial({color:0xffe8ad,transparent:true,opacity:.8}));flash.position.y=.75;blast.add(flash);
  effects.push({group:blast,t:0,duration:payload.aerial?1.85:1.25,target,explosion:true});
  createImpactMark(position,payload.aerial?7:(payload.shell?2.8:3.8));
  createDebris(position,payload.aerial?13:(payload.shell?5:8),payload.aerial?0x373b35:0x413c34);
  const radius=payload.radius||8,damage=payload.damage||45,team=payload.team||'blue';
  for(const entity of [...targets,...tanks,...soldiers]){
    if(!entity.alive||(entity.team&&entity.team===team))continue;
    const p=entity.group.position,dist=Math.hypot(p.x-position.x,p.z-position.z);if(dist>radius)continue;
    const falloff=Math.max(.22,1-dist/radius),base=entity===target?damage:damage*(entity.type==='infantry'?.72:.48);
    applyDamage(entity,base*falloff,team,position);
  }
  if(target&&target.alive)addLog('Impact on '+target.name+' · '+Math.round(target.hp)+' HP remaining.','alert');
}
function destroyTarget(target){
  if(!target||!target.alive)return;target.alive=false;target.status='DESTROYED';target.hp=0;
  target.group.traverse((o)=>{if(o.isMesh&&o.material&&!o.material.emissive)o.material=mats.destroyed;});
  target.ring.visible=false;
  const smoke=new THREE.Mesh(new THREE.SphereGeometry(2.1,14,10),new THREE.MeshBasicMaterial({color:0x454a42,transparent:true,opacity:.62,depthWrite:false}));
  smoke.position.set(0,5,0);target.group.add(smoke);target.smoke=smoke;
  createDebris(target.group.position.clone(),9,0x393b37);addLog(target.name+' destroyed. Objective status updated.','alert');toast(target.name+' destroyed');updateObjectives();
}
function updateObjectives() {
  const depot = targets.find((t) => t.kind === 'depot');
  const radar = targets.find((t) => t.kind === 'radar');
  const allPlaneReady = aircraft.every((p) => p.state === 'ready');
  $('objDepot').classList.toggle('done', !!depot && !depot.alive);
  $('objRadar').classList.toggle('done', !!radar && !radar.alive);
  $('objReturn').classList.toggle('done', allPlaneReady && aircraft.some((p) => p.hasLanded));
  let progress = 0;
  if (depot && !depot.alive) progress += 50;
  if (radar && !radar.alive) progress += 35;
  if (allPlaneReady && aircraft.some((p) => p.hasLanded)) progress += 15;
  $('objectiveProgress').style.width = progress + '%';
  if (progress >= 100 && !state.missionComplete) {
    state.missionComplete = true;
    addLog('Primary objectives complete. Air wing recovered.', 'alert');
    toast('MISSION COMPLETE · IRON HORIZON');
  }
}
function updatePlane(plane,dt){
  if(plane.mixer)plane.mixer.update(dt);
  if(plane.state==='crash'){
    plane.crashAge=(plane.crashAge||0)+dt;plane.crashVelocity.y-=8.8*dt;plane.group.position.addScaledVector(plane.crashVelocity,dt);plane.group.rotation.x+=dt*1.15;plane.group.rotation.z+=dt*.95;
    if(plane.crashSmoke){plane.crashSmoke.position.x=Math.sin(plane.crashAge*7)*.25;plane.crashSmoke.position.y=Math.sin(plane.crashAge*5)*.2;plane.crashSmoke.scale.setScalar(1.1+Math.sin(plane.crashAge*4)*.2);}
    if(plane.group.position.y<=.55){plane.group.position.y=.35;plane.state='crashed';plane.status='WRECK · LOST';plane.alive=false;explodeAt(plane.group.position.clone(),null,{team:'blue',damage:18,radius:11,aerial:true});plane.visual.traverse((node)=>{if(node.isMesh)node.material=mats.destroyed;});addLog(plane.name+' impacted the terrain · aircraft lost.','alert');if(state.selected===plane)updateSelectionPanel();updateObjectives();}
    return;
  }
  if(plane.state==='crashed')return;
  if (plane.state === 'ready') {
    plane.group.rotation.set(0, Math.PI, 0);
    plane.group.position.set(plane.initial.x, 0.16, plane.initial.z);
    return;
  }
  if (plane.state === 'rearm') {
    plane.rearmTimer += dt;
    plane.status = 'REARM / SERVICE ' + Math.max(0, Math.ceil(7 - plane.rearmTimer)) + 's';
    if (plane.rearmTimer >= 7) {
      plane.rearmTimer = 0; plane.state = 'ready'; plane.status = 'READY AT BASE'; plane.target = null; plane.route = []; plane.hasLanded = true;
      plane.group.position.set(plane.initial.x, 0.16, plane.initial.z);
      plane.group.rotation.set(0, Math.PI, 0);
      addLog(plane.name + ' rearmed and available.', 'normal');
      if (state.selected === plane) updateSelectionPanel();
      updateObjectives();
    }
    return;
  }
  if (!plane.route || plane.routeIndex >= plane.route.length) return;
  const waypoint = plane.route[plane.routeIndex];
  const pos = plane.group.position;
  const next = waypoint.p;
  const horizontal = Math.hypot(next.x - pos.x, next.z - pos.z);
  const dist = pos.distanceTo(next);
  const speed = plane.flightClass==='rotary-wing'
    ? (/LANDING|APPROACH/.test(waypoint.state)?4.8:(/HOVER/.test(waypoint.state)?3.8:plane.speed))
    : (waypoint.state === 'TAXI-OUT' || waypoint.state === 'TAXI-IN' || waypoint.state === 'LINE-UP' ? 5.2 : (waypoint.state === 'LANDING' ? 8.3 : plane.speed));
  const step = Math.max(0.001, speed * dt);
  if (dist <= Math.max(0.55, step)) {
    pos.copy(next);
    const oldState = plane.status;
    plane.status = waypoint.state;
    plane.routeIndex++;
    if (oldState !== plane.status) {
      addLog(plane.name + ' · ' + plane.status + '.', plane.status === 'ATTACK RUN' ? 'alert' : 'normal');
      if (state.selected === plane) updateSelectionPanel();
    }
    if (/TAKEOFF|CLIMB|INGRESS|ATTACK RUN|EGRESS|RETURN|APPROACH/.test(waypoint.state)) plane.group.position.y = Math.max(plane.group.position.y, waypoint.p.y);
    if (waypoint.state === 'ATTACK RUN') spawnBomb(plane, plane.target);
    if (waypoint.state === 'LANDING') {
      plane.hasLanded = true;
      if (plane.mixer && plane.actions) Object.keys(plane.actions).forEach((key) => { if (/gear.*retract|retract.*gear/.test(key)) plane.actions[key].stop(); });
    }
    if (waypoint.state === 'REARM') {
      plane.state = 'rearm'; plane.rearmTimer = 0; plane.status = 'REARM / SERVICE';
      plane.route = []; plane.group.position.y = 0.16;
      addLog(plane.name + ' landed safely. Turnaround started.', 'normal');
      updateObjectives();
    }
  } else {
    pos.add(next.clone().sub(pos).normalize().multiplyScalar(step));
  }
  const dir = next.clone().sub(pos);
  const desiredHeading = Math.atan2(dir.x, dir.z);
  const pathPitch=-Math.atan2(dir.y,Math.max(.01,Math.hypot(dir.x,dir.z)));
  const currentYaw=plane.group.rotation.y;
  let diff=((desiredHeading-currentYaw+Math.PI*3)%(Math.PI*2))-Math.PI;
  plane.group.rotation.y+=diff*Math.min(1,dt*(plane.flightClass==='rotary-wing'?1.9:2.6));
  if(plane.flightClass==='rotary-wing'){
    const rotorPitch=THREE.MathUtils.clamp(pathPitch*.18,-.09,.09);
    plane.group.rotation.x+=(rotorPitch-plane.group.rotation.x)*Math.min(1,dt*2.5);
    const rotorBank=THREE.MathUtils.clamp(-diff*.28,-.18,.18);
    plane.group.rotation.z+=(rotorBank-plane.group.rotation.z)*Math.min(1,dt*2.2);
  }else{
    plane.group.rotation.x+=(THREE.MathUtils.clamp(pathPitch,-.28,.25)-plane.group.rotation.x)*Math.min(1,dt*2);
    const bank=THREE.MathUtils.clamp(-diff*1.6,-.55,.55);
    plane.group.rotation.z+=(bank-plane.group.rotation.z)*Math.min(1,dt*1.7);
  }
  plane.status = waypoint.state;
  if (plane.state === 'taxi' && plane.routeIndex >= 2) plane.state = 'airborne';
  if (plane.routeIndex >= 6 && plane.state !== 'return' && plane.route[5] && plane.route[5].state === 'ATTACK RUN') plane.state = 'return';
}
function updateAircraftRigMotion(plane,dt){
  const visual=plane&&plane.visual;if(!visual||plane.flightClass==='rotary-wing')return;
  const heavy=String(plane.modelRootName||plane.airUnitKey||'').includes('HEAVY_STRIKE');
  const prefix=heavy?'HSTRIKE':'F16';
  const get=(name)=>visual.getObjectByName(name);
  const airborne=plane.state==='airborne'||plane.state==='return'||plane.status==='CLIMB'||plane.status==='INGRESS'||plane.status==='ATTACK RUN'||plane.status==='EGRESS';
  const gearOut=!airborne||/TAXI|LINE-UP|APPROACH|LANDING|REARM|READY|SERVICE/.test(String(plane.status||''));
  for(const [side,label] of [[-1,'L'],[1,'R']]){
    const flap=get(prefix+'_FLAPERON_'+label+'_PIVOT');
    if(flap){const target=airborne?(side===-1?-plane.group.rotation.z*.34:plane.group.rotation.z*.34):0;flap.rotation.x+=(target-flap.rotation.x)*Math.min(1,dt*4);}
    const elevator=get(prefix+'_ELEVATOR_'+label+'_PIVOT');
    if(elevator){const target=airborne?plane.group.rotation.x*.55:0;elevator.rotation.x+=(target-elevator.rotation.x)*Math.min(1,dt*3.5);}
    const gear=get(prefix+'_MAIN_GEAR_'+label+'_PIVOT');
    if(gear){const target=gearOut?0:1.0472;gear.rotation.x+=(target-gear.rotation.x)*Math.min(1,dt*3.6);}
  }
  const nose=get(prefix+'_NOSE_GEAR_PIVOT');
  if(nose){const target=gearOut?0:-1.012;nose.rotation.x+=(target-nose.rotation.x)*Math.min(1,dt*3.6);}
  const rudder=get(prefix+'_RUDDER_PIVOT');
  if(rudder){const target=airborne?-plane.group.rotation.z*.16:0;rudder.rotation.z+=(target-rudder.rotation.z)*Math.min(1,dt*4);}
  const thrust=['TAKEOFF','CLIMB','INGRESS'].includes(plane.status)?0.75:0.001;
  for(const name of heavy?['HSTRIKE_AFTERBURNER_L','HSTRIKE_AFTERBURNER_R']:['F16_Afterburner_Flame']){
    const flame=get(name);if(flame){flame.scale.set(THREE.MathUtils.damp(flame.scale.x,thrust,4,dt),THREE.MathUtils.damp(flame.scale.y,thrust,4,dt),THREE.MathUtils.damp(flame.scale.z,thrust,4,dt));}
  }
}
function launchShell(unit,target){
  if(!unit||!target||!target.alive)return;
  const start=unit.group.localToWorld(new THREE.Vector3(0,2.15,2.7)),end=target.group.position.clone().add(new THREE.Vector3(0,target.type==='target'?1.3:1.05,0));
  const duration=THREE.MathUtils.clamp(start.distanceTo(end)/48,.48,1.45),gravity=10.5;
  const velocity=new THREE.Vector3((end.x-start.x)/duration,(end.y-start.y+.5*gravity*duration*duration)/duration,(end.z-start.z)/duration);
  const shell=new THREE.Mesh(new THREE.SphereGeometry(.17,9,7),new THREE.MeshBasicMaterial({color:0xffd17a,transparent:true,opacity:.98}));shell.position.copy(start);scene.add(shell);
  projectiles.push({mesh:shell,start,end,velocity,gravity,duration,age:0,target,team:unit.team,damage:target.type==='target'?25:29,radius:target.type==='target'?8.5:6.5});addLog(unit.name+' fired a ballistic shell.','normal');
}
function createDebris(position,amount=6,palette=0x373b37){
  for(let i=0;i<amount;i++){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(.22+Math.random()*.45,.15+Math.random()*.32,.22+Math.random()*.42),material(palette,.92,.04));
    mesh.position.copy(position).add(new THREE.Vector3((Math.random()-.5)*2.5,.2+Math.random()*1.3,(Math.random()-.5)*2.5));mesh.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);scene.add(mesh);
    debris.push({mesh,velocity:new THREE.Vector3((Math.random()-.5)*7,2.5+Math.random()*6,(Math.random()-.5)*7),spin:new THREE.Vector3(Math.random()*5,Math.random()*5,Math.random()*5),age:0,life:2.3+Math.random()*1.7});
  }
}
function killInfantry(soldier){
  if(!soldier||!soldier.alive)return;soldier.alive=false;soldier.hp=0;soldier.status='CASUALTY';soldier.moveTarget=null;soldier.attackTarget=null;soldier.fallProgress=0;if(soldier.ring)soldier.ring.visible=false;
  addLog(soldier.name+' is down.','alert');if(state.selected===soldier)updateSelectionPanel();
}
function destroyTank(unit){
  if(!unit||!unit.alive)return;unit.alive=false;unit.hp=0;unit.status='DESTROYED';unit.moveTarget=null;unit.attackTarget=null;if(unit.ring)unit.ring.visible=false;
  unit.visual.traverse((node)=>{if(node.isMesh&&node.material&&node.userData.initialMaterial)node.material=mats.destroyed;});
  const smoke=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial({color:0x343a36,transparent:true,opacity:.55,depthWrite:false}));
  smoke.position.set(0,2.7,0);smoke.scale.set(1.3,1.8,1.3);unit.group.add(smoke);unit.wreckSmoke=smoke;
  createDebris(unit.group.position.clone(),7,0x303532);addLog(unit.name+' destroyed · burning wreck remains.','alert');if(state.selected===unit)updateSelectionPanel();
}
function crashAircraft(plane){
  if(!plane||plane.state==='crash'||plane.state==='crashed')return;plane.state='crash';plane.status='HIT · UNCONTROLLED DESCENT';plane.route=[];plane.routeIndex=0;
  plane.crashVelocity=new THREE.Vector3((Math.random()-.5)*7,-2.8,-5+Math.random()*3);plane.crashAge=0;
  plane.crashSmoke=new THREE.Mesh(new THREE.SphereGeometry(.55,9,7),new THREE.MeshBasicMaterial({color:0x3d403b,transparent:true,opacity:.62}));plane.crashSmoke.position.set(0,0,-2.7);plane.group.add(plane.crashSmoke);
  if(plane.ring)plane.ring.visible=false;addLog(plane.name+' hit by air defence · crash sequence initiated.','alert');if(state.selected===plane)updateSelectionPanel();
}
function applyDamage(entity,amount,attackerTeam,impactPoint){
  if(!entity||!entity.alive||(attackerTeam&&entity.team&&entity.team===attackerTeam))return;
  entity.hp=Math.max(0,entity.hp-amount);if(entity.hp>0){if(state.selected===entity)updateSelectionPanel();return;}
  if(entity.type==='target')destroyTarget(entity);else if(entity.type==='tank')destroyTank(entity);else if(entity.type==='infantry')killInfantry(entity);else if(entity.type==='aircraft')crashAircraft(entity);
}
function updateProjectiles(dt){
  for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i];p.age+=dt;const t=Math.min(p.age,p.duration);
    p.mesh.position.set(p.start.x+p.velocity.x*t,p.start.y+p.velocity.y*t-.5*p.gravity*t*t,p.start.z+p.velocity.z*t);
    if(p.age>=p.duration){explodeAt(p.end,p.target,{team:p.team,damage:p.damage,radius:p.radius,shell:true});scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();projectiles.splice(i,1);}
  }
}
function updateDebris(dt){
  for(let i=debris.length-1;i>=0;i--){const d=debris[i];d.age+=dt;d.velocity.y-=12*dt;d.mesh.position.addScaledVector(d.velocity,dt);d.mesh.rotation.x+=d.spin.x*dt;d.mesh.rotation.y+=d.spin.y*dt;d.mesh.rotation.z+=d.spin.z*dt;
    if(d.mesh.position.y<.13){d.mesh.position.y=.13;d.velocity.y*=-.22;d.velocity.x*=.76;d.velocity.z*=.76;}
    if(d.age>=d.life){scene.remove(d.mesh);d.mesh.geometry.dispose();d.mesh.material.dispose();debris.splice(i,1);}
  }
}
function updateInfantry(dt){
  for(const soldier of soldiers){
    if(soldier.mixer)soldier.mixer.update(dt);
    if(!soldier.alive){soldier.fallProgress=Math.min(1,soldier.fallProgress+dt*1.8);soldier.group.rotation.z=soldier.fallDirection*(Math.PI/2)*soldier.fallProgress;soldier.group.position.y=-.06*soldier.fallProgress;continue;}
    if(soldier.moveTarget){const dx=soldier.moveTarget.x-soldier.group.position.x,dz=soldier.moveTarget.z-soldier.group.position.z,dist=Math.hypot(dx,dz);
      if(dist<.7){soldier.moveTarget=null;soldier.status='HOLDING';}
      else{const step=Math.min(dist,2.7*dt);soldier.group.position.x+=dx/dist*step;soldier.group.position.z+=dz/dist*step;const heading=Math.atan2(dx,dz);soldier.group.rotation.y+=((((heading-soldier.group.rotation.y+Math.PI*3)%(Math.PI*2))-Math.PI)*Math.min(1,dt*4));soldier.arms.forEach((arm,i)=>{arm.rotation.x=Math.sin(state.time*7+i*Math.PI)*.22;});soldier.legs.forEach((leg,i)=>{leg.rotation.x=Math.sin(state.time*7+i*Math.PI)*.35;});}
    }
    if(soldier.attackTarget&&!soldier.attackTarget.alive){soldier.attackTarget=null;soldier.status='HOLDING';}
    const requested=soldier.attackTarget&&soldier.attackTarget.alive?soldier.attackTarget:null;
    const enemies=requested?[requested]:[...tanks.filter((u)=>u.alive&&u.team!==soldier.team),...soldiers.filter((u)=>u.alive&&u.team!==soldier.team)];
    let closest=null,best=requested?Infinity:25;
    for(const enemy of enemies){if(enemy===soldier||!enemy.alive||enemy.team===soldier.team)continue;const dist=soldier.group.position.distanceTo(enemy.group.position);if(dist<best){best=dist;closest=enemy;}}
    if(closest&&best<25){
      soldier.fireTimer-=dt;
      if(soldier.fireTimer<=0){soldier.fireTimer=2.4+(soldier.id.length%4)*.24;const from=soldier.group.position.clone().add(new THREE.Vector3(0,1.15,0)),to=closest.group.position.clone().add(new THREE.Vector3(0,closest.type==='tank'?1.3:.9,0));createTracer(from,to);applyDamage(closest,closest.type==='tank'?2.2:5.5,soldier.team,to);}
    } else {
      soldier.fireTimer=Math.max(0,soldier.fireTimer);
      if(requested&&!soldier.moveTarget){soldier.moveTarget=new THREE.Vector3(requested.group.position.x,0,requested.group.position.z+3);soldier.status='CLOSING ON TARGET';}
    }  }
  for(const unit of tanks)if(!unit.alive&&unit.wreckSmoke){unit.wreckSmoke.position.y=2.6+Math.sin(state.time*1.7)*.22;unit.wreckSmoke.scale.set(1.4+Math.sin(state.time)*.12,1.8+Math.sin(state.time*1.2)*.16,1.4);}
}
function updateAircraftDamage(plane,dt){
  if(!plane||plane.state==='ready'||plane.state==='rearm'||plane.state==='crash'||plane.state==='crashed')return;
  const sam=targets.find((t)=>t.kind==='sam'&&t.alive);if(!sam||plane.routeIndex>7)return;
  if(plane.group.position.distanceTo(sam.group.position)>112||plane.group.position.y<2.5)return;
  plane.aaTimer=(plane.aaTimer||0)-dt;if(plane.aaTimer<=0){plane.aaTimer=2.9;plane.hp=Math.max(0,plane.hp-14);createTracer(sam.group.position.clone().add(new THREE.Vector3(0,2,0)),plane.group.position.clone());addLog('SAM engagement · '+plane.name+' integrity '+plane.hp+'%','alert');if(plane.hp<=0)crashAircraft(plane);if(state.selected===plane)updateSelectionPanel();}
}
function updateTanks(dt) {
  for (const unit of tanks) {
    if (unit.mixer) unit.mixer.update(dt);
    if (!unit.alive) continue;
    if(unit.attackTarget&&!unit.attackTarget.alive){unit.attackTarget=null;unit.moveTarget=null;unit.status=unit.team==='red'?'DEFENDING':'HOLDING POSITION';}
    if(unit.team==='red'&&!unit.attackTarget){
      const hostiles=[...tanks.filter((candidate)=>candidate.alive&&candidate.team==='blue'),...soldiers.filter((candidate)=>candidate.alive&&candidate.team==='blue')];
      let nearest=null,nearestDistance=82;
      for(const candidate of hostiles){const d=unit.group.position.distanceTo(candidate.group.position);if(d<nearestDistance){nearest=candidate;nearestDistance=d;}}
      if(nearest){unit.attackTarget=nearest;unit.status='ENGAGING HOSTILE FORCE';}
    }
    if (unit.moveTarget) {
      const dx = unit.moveTarget.x - unit.group.position.x;
      const dz = unit.moveTarget.z - unit.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.55) { unit.moveTarget = null; unit.status = 'HOLDING POSITION'; }
      else {
        const step = Math.min(dist, unit.speed * dt);
        unit.group.position.x += dx / dist * step;
        unit.group.position.z += dz / dist * step;
        const heading = Math.atan2(dx, dz);
        let diff = ((heading - unit.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        unit.group.rotation.y += diff * Math.min(1, dt * 3.1);
        if (unit.visualData && unit.visualData.wheels) {
          unit.visualData.wheels.forEach((wheel) => {
            if (wheel.rotateY) wheel.rotateY(step * 1.6);
          });
        }
        if (unit.visualData && unit.visualData.tracks) {
          unit.visualData.tracks.forEach((track) => advanceTrack(track, step));
        }
        if (unit.visualData && unit.visualData.turret && !unit.attackTarget) {
          const current = unit.visualData.turret.rotation.y;
          const delta = ((-current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          unit.visualData.turret.rotation.y += delta * Math.min(1, dt * 1.3);
        }
      }
    }
    if (unit.attackTarget && unit.attackTarget.alive) {
      const t = unit.attackTarget;
      const distance = unit.group.position.distanceTo(t.group.position);
      if (unit.visualData && unit.visualData.turret) {
        const dx = t.group.position.x - unit.group.position.x;
        const dz = t.group.position.z - unit.group.position.z;
        const localX = dx * Math.cos(unit.group.rotation.y) - dz * Math.sin(unit.group.rotation.y);
        const localZ = dx * Math.sin(unit.group.rotation.y) + dz * Math.cos(unit.group.rotation.y);
        const desired = Math.atan2(localX, localZ);
        const current = unit.visualData.turret.rotation.y;
        const delta = ((desired - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        unit.visualData.turret.rotation.y += delta * Math.min(1, dt * 2.3);
      }
      if (distance < 35) {
        if(unit.team==='red'&&unit.moveTarget)unit.moveTarget=null;
        unit.fireTimer -= dt;
        if (unit.fireTimer <= 0) {
          unit.fireTimer = 3.0;
          launchShell(unit,t);
        }
      } else {
        unit.moveTarget = new THREE.Vector3(t.group.position.x, 0, t.group.position.z + 9);
      }
    }
  }
}
function createTracer(start, end) {
  const dir = end.clone().sub(start);
  const length = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, length, 5), new THREE.MeshBasicMaterial({ color: 0xffd79a }));
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  scene.add(mesh);
  effects.push({ group: mesh, t: 0, tracer: true });
}
function updateBombs(dt){
  for(let i=bombs.length-1;i>=0;i--){
    const bomb=bombs[i];bomb.t+=dt;const t=Math.min(1,bomb.t/bomb.duration);
    if(bomb.guided){
      const from=bomb.from,previous=bomb.mesh.position.clone();
      if(bomb.target&&bomb.target.alive)bomb.to.copy(bomb.target.group.position).add(new THREE.Vector3(0,1.05,0));
      bomb.mesh.position.lerpVectors(from,bomb.to,t);bomb.mesh.position.y+=Math.sin(t*Math.PI)*Math.min(3.5,from.distanceTo(bomb.to)*.035);
      const dir=bomb.to.clone().sub(previous);if(dir.lengthSq()>.001)bomb.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());
      if(bomb.t-(bomb.lastTrailAt||0)>.18){createTracer(previous,bomb.mesh.position.clone());bomb.lastTrailAt=bomb.t;}
    }else if(bomb.ballistic){
      const elapsed=Math.min(bomb.t,bomb.duration),v=bomb.velocity;
      bomb.mesh.position.set(bomb.from.x+v.x*elapsed,bomb.from.y+v.y*elapsed-.5*bomb.gravity*elapsed*elapsed,bomb.from.z+v.z*elapsed);
      const velocityNow=new THREE.Vector3(v.x,v.y-bomb.gravity*elapsed,v.z);
      if(velocityNow.lengthSq()>.001)bomb.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),velocityNow.normalize());
    }else{
      bomb.mesh.position.lerpVectors(bomb.from,bomb.to,t);bomb.mesh.position.y-=Math.sin(t*Math.PI)*2.3;bomb.mesh.rotation.z+=dt*3;
    }
    if(t>=1){
      const payload=bomb.guided
        ?{team:bomb.team||'blue',damage:42,radius:12,aerial:true,missile:true}
        :bomb.ballistic
          ?{team:bomb.team||'blue',damage:bomb.target&&bomb.target.kind==='depot'?70:60,radius:20,aerial:true}
          :{team:'blue',damage:60,radius:20,aerial:true};
      explodeAt(bomb.to,bomb.target,payload);scene.remove(bomb.mesh);
      bomb.mesh.traverse((node)=>{if(node.geometry)node.geometry.dispose();if(node.material)(Array.isArray(node.material)?node.material:[node.material]).forEach((m)=>m&&m.dispose&&m.dispose());});
      bombs.splice(i,1);
    }
  }
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.t += dt;
    if (e.tracer) {
      if (e.t > 0.18) { scene.remove(e.group); e.group.geometry.dispose(); e.group.material.dispose(); effects.splice(i, 1); }
    } else {
      const duration=e.duration||1.3;
      const t=Math.min(1,e.t/duration);
      e.group.scale.setScalar(1+t*(e.explosion?2.9:1.5));
      e.group.children.forEach((child) => { if (child.material && child.material.transparent) child.material.opacity = Math.max(0, 0.9 - t * 0.9); });
      if (e.t > (e.duration || 1.3)) { scene.remove(e.group); e.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); effects.splice(i, 1); }
    }
  }
}
function updateHUD() {
  const mins = Math.floor(state.time / 60).toString().padStart(2, '0');
  const secs = Math.floor(state.time % 60).toString().padStart(2, '0');
  $('clock').textContent = mins + ':' + secs;
  $('airCount').textContent = aircraft.filter((p) => p.state === 'ready').length.toString().padStart(2, '0') + ' / ' + String(aircraft.length).padStart(2, '0');
  if (state.selected) {
    $('selectedState').textContent = (state.selected.status || state.selected.state || 'ACTIVE').toUpperCase();
    $('selectedValue').textContent = Math.max(0, Math.round(state.selected.hp)) + ' HP';
    $('selectedHealth').style.width = Math.max(0, state.selected.hp / state.selected.maxHp * 100) + '%';
  }
  drawMinimap();
}
function drawMinimap() {
  const canvas = $('minimap');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const map=MAPS[state.mapId];
  ctx.fillStyle=map.biome==='desert'?'#79674c':map.biome==='alpine'?'#4f5b5b':'#1e2f29';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = 'rgba(190,210,192,.08)'; ctx.lineWidth = 1;
  for (let x = 10; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 10; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const px=(x)=>(x+map.width/2)/map.width*w;
  const py=(z)=>(z+map.depth/2)/map.depth*h;
  ctx.fillStyle='#303d40';ctx.fillRect(px(-6.75),py(58),(13.5/map.width)*w,(58/map.depth)*h);
  ctx.fillStyle='#798179';ctx.fillRect(px(7),py(62),(28/map.width)*w,(16/map.depth)*h);
  if(map.biome==='river'){ctx.strokeStyle='#4a92a0';ctx.lineWidth=Math.max(2,18/map.width*w);ctx.beginPath();for(let x=-map.width/2;x<=map.width/2;x+=8){const z=(map.riverZ||-8)+Math.sin(x*.018)*10+Math.sin(x*.043)*3;if(x===-map.width/2)ctx.moveTo(px(x),py(z));else ctx.lineTo(px(x),py(z));}ctx.stroke();}
  ctx.fillStyle = 'rgba(234,184,107,.23)';
  targets.filter((t) => t.alive).forEach((t) => {
    ctx.beginPath(); ctx.arc(px(t.group.position.x), py(t.group.position.z), t.kind === 'depot' ? 8 : 6, 0, Math.PI * 2); ctx.fill();
  });
  targets.filter((t) => t.alive).forEach((t) => {
    ctx.fillStyle = '#dc7265'; ctx.fillRect(px(t.group.position.x) - 3, py(t.group.position.z) - 3, 6, 6);
  });
  tanks.filter((u) => u.alive).forEach((u) => {
    ctx.fillStyle = u.team === 'blue' ? '#b5d99f' : '#dc7265';
    ctx.fillRect(px(u.group.position.x) - 2.5, py(u.group.position.z) - 2.5, 5, 5);
  });
  soldiers.filter((u)=>u.alive).forEach((u)=>{ctx.fillStyle=u.team==='blue'?'#c5e1a0':'#ed907d';ctx.fillRect(px(u.group.position.x)-1.2,py(u.group.position.z)-1.2,2.4,2.4);});
  aircraft.filter((p)=>p.state!=='crashed').forEach((p) => {
    ctx.fillStyle = '#9bd5ef'; ctx.beginPath(); ctx.arc(px(p.group.position.x), py(p.group.position.z), 3.5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.strokeStyle = 'rgba(200,226,155,.15)'; ctx.strokeRect(1, 1, w - 2, h - 2);
}
function resetMission() {
  state.time = 0; state.missionComplete = false; state.command = 'select';
  $('log').innerHTML = '';
  addLog('Scenario reset. All units restored to initial positions.', 'normal');
  for (const t of targets) {
    t.alive = true; t.hp = t.maxHp; t.status = 'ACTIVE';
    t.group.traverse((o) => {
      if (o.isMesh && o.userData.initialMaterial) o.material = o.userData.initialMaterial;
    });
    if (t.smoke) { t.group.remove(t.smoke); t.smoke.geometry.dispose(); t.smoke.material.dispose(); t.smoke = null; }
    if (t.ring) t.ring.visible = false;
  }
  for (const unit of tanks) {
    unit.hp = unit.maxHp; unit.alive = true; unit.status = unit.team === 'blue' ? 'HOLDING' : 'DEFENDING';
    unit.moveTarget = null; unit.attackTarget = null;
    const layoutSeed=state.mapLayout&&state.mapLayout.tanks&&state.mapLayout.tanks[tanks.indexOf(unit)];
    const fallbackSeed=MAPS[state.mapId].tankStarts[tanks.indexOf(unit)]||MAPS[state.mapId].tankStarts[0];
    unit.group.position.set(layoutSeed?layoutSeed.x:fallbackSeed[0],0,layoutSeed?layoutSeed.z:fallbackSeed[1]);unit.group.rotation.set(0,0,0);
    if(unit.wreckSmoke){unit.group.remove(unit.wreckSmoke);unit.wreckSmoke.geometry.dispose();unit.wreckSmoke.material.dispose();unit.wreckSmoke=null;}
    unit.visual.traverse((node)=>{if(node.isMesh&&node.userData.initialMaterial)node.material=node.userData.initialMaterial;});
    if (unit.visualData && unit.visualData.tracks) {
      unit.visualData.tracks.forEach((track) => { track.phase = 0; positionTrackSegments(track); });
    }
  }
  for(const soldier of soldiers){
    const layoutSeed=state.mapLayout&&state.mapLayout.soldiers&&state.mapLayout.soldiers[soldiers.indexOf(soldier)];
    const fallbackSeed=MAPS[state.mapId].soldierStarts[soldiers.indexOf(soldier)]||MAPS[state.mapId].soldierStarts[0];
    soldier.hp=soldier.maxHp;soldier.alive=true;soldier.status='ADVANCING';soldier.moveTarget=null;soldier.attackTarget=null;soldier.fallProgress=0;soldier.group.position.set(layoutSeed?layoutSeed.x:fallbackSeed[0],0,layoutSeed?layoutSeed.z:fallbackSeed[1]);soldier.group.rotation.set(0,0,0);soldier.team=layoutSeed?layoutSeed.team:(fallbackSeed[2]||soldier.team);soldier.name=soldier.role+' · '+soldier.team.toUpperCase();
    soldier.group.traverse((node)=>{if(node.isMesh&&node.userData.initialMaterial)node.material=node.userData.initialMaterial;});if(soldier.ring)soldier.ring.visible=false;
  }
  for(const plane of aircraft){
    plane.hp=100;plane.alive=true;plane.state='ready';plane.status='READY AT BASE';plane.target=null;plane.route=[];plane.routeIndex=0;plane.attackDone=false;plane.hasLanded=false;plane.rearmTimer=0;plane.aaTimer=2.6;plane.crashVelocity=null;plane.group.visible=true;
    if(plane.crashSmoke){plane.group.remove(plane.crashSmoke);plane.crashSmoke.geometry.dispose();plane.crashSmoke.material.dispose();plane.crashSmoke=null;}
    plane.group.position.set(plane.initial.x,0.16,plane.initial.z);plane.group.rotation.set(0,Math.PI,0);
    plane.visual.traverse((node)=>{if(node.isMesh&&node.userData.initialMaterial)node.material=node.userData.initialMaterial;});
  }
  bombs.splice(0).forEach((b)=>{scene.remove(b.mesh);if(b.mesh.geometry)b.mesh.geometry.dispose();if(b.mesh.material)b.mesh.material.dispose();});
  projectiles.splice(0).forEach((p)=>{scene.remove(p.mesh);if(p.mesh.geometry)p.mesh.geometry.dispose();if(p.mesh.material)p.mesh.material.dispose();});
  debris.splice(0).forEach((d)=>{scene.remove(d.mesh);if(d.mesh.geometry)d.mesh.geometry.dispose();if(d.mesh.material)d.mesh.material.dispose();});
  effects.splice(0).forEach((e)=>{scene.remove(e.group);e.group.traverse((n)=>{if(n.geometry)n.geometry.dispose();if(n.material)n.material.dispose();});});
  clearImpactMarks();
  selectEntity(null); setCommand('select'); updateObjectives(); updateHUD();
}
function panCamera(dx, dy) {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0); right.y = 0; right.normalize();
  const forward = new THREE.Vector3().crossVectors(right, new THREE.Vector3(0, 1, 0)).normalize();
  const scale = Math.max(0.08, camera.position.distanceTo(cameraTarget) * 0.0017);
  const delta = right.multiplyScalar(-dx * scale).add(forward.multiplyScalar(dy * scale));
  camera.position.add(delta); cameraTarget.add(delta); camera.lookAt(cameraTarget);
}
function zoomCamera(factor) {
  const offset = camera.position.clone().sub(cameraTarget);
  const distance = THREE.MathUtils.clamp(offset.length() * factor, 36, 580);
  offset.setLength(distance);
  camera.position.copy(cameraTarget).add(offset);
  camera.lookAt(cameraTarget);
}
function onPointerDown(e) {
  if (e.target.closest && e.target.closest('button')) return;
  renderer.domElement.setPointerCapture(e.pointerId);
  state.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
  state.pointerDown = { x: e.clientX, y: e.clientY, id: e.pointerId, time: performance.now(), count: state.touchPoints.size };
  state.dragging = false;
  if (state.touchPoints.size === 2) {
    const pts = Array.from(state.touchPoints.values());
    state.lastPinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
}
function onPointerMove(e) {
  if (!state.touchPoints.has(e.pointerId)) return;
  const prev = state.touchPoints.get(e.pointerId);
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  state.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (state.touchPoints.size >= 2) {
    const pts = Array.from(state.touchPoints.values());
    const pinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (state.lastPinch) zoomCamera(state.lastPinch / Math.max(10, pinch));
    state.lastPinch = pinch;
    state.dragging = true;
    return;
  }
  if (state.pointerDown && (Math.abs(e.clientX - state.pointerDown.x) + Math.abs(e.clientY - state.pointerDown.y) > 6)) state.dragging = true;
  if (state.dragging) panCamera(dx, dy);
}
function onPointerUp(e) {
  const wasDragging = state.dragging;
  const down = state.pointerDown;
  state.touchPoints.delete(e.pointerId);
  if (state.touchPoints.size < 2) state.lastPinch = 0;
  if (!wasDragging && down && down.id === e.pointerId && performance.now() - down.time < 600) {
    const hit = worldPoint(e);
    pointerCommand(hit);
  }
  state.pointerDown = null;
  state.dragging = false;
}
renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerup', onPointerUp);
renderer.domElement.addEventListener('pointercancel', onPointerUp);
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); zoomCamera(e.deltaY > 0 ? 1.09 : 0.92); }, { passive: false });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
$('mapSelector').addEventListener('change',(event)=>applyBattlefieldMap(event.target.value,false));
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if (key === 'm') setCommand('move');
  if (key === 'a') setCommand('attack');
  if (key === 'f') setCommand('airstrike');
  if (key === 'r') setCommand('return');
  if (key === 'escape') { selectEntity(null); setCommand('select'); }
  if (key === '+' || key === '=') zoomCamera(0.9);
  if (key === '-' || key === '_') zoomCamera(1.1);
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clock.stop(); else clock.start();
});

function catalogStatText(balance) {
  if (!balance) return 'Gameplay balance: pending';
  return 'HP ' + balance.hp + ' · Mobility ' + balance.speed + ' · Range ' + balance.range + ' · Cost ' + balance.cost;
}
function addCatalogItem(container, title, role, root, balance, status) {
  const card = document.createElement('article');
  card.className = 'catalog-item';
  const heading = document.createElement('strong'); heading.textContent = title;
  const roleNode = document.createElement('div'); roleNode.className = 'catalog-role'; roleNode.textContent = String(role || 'Unassigned role').replaceAll('_', ' ');
  const rootNode = document.createElement('div'); rootNode.className = 'catalog-root'; rootNode.textContent = root || 'No Blender root';
  const stats = document.createElement('div'); stats.className = 'catalog-stats'; stats.textContent = catalogStatText(balance);
  const flag = document.createElement('div'); flag.className = 'catalog-status'; flag.textContent = String(status || 'blender_prototype').replaceAll('_', ' ').toUpperCase();
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'catalog-preview-btn';
  preview.textContent = 'VIEW IN THEATRE';
  preview.disabled = !root;
  preview.title = root ? 'Load this named Blender object from the combined-arms GLB' : 'No Blender scene root is mapped to this role';
  preview.addEventListener('click', async () => {
    preview.disabled = true;
    const oldText = preview.textContent;
    preview.textContent = 'LOADING…';
    try {
      await previewBlenderAsset(root, title, role);
      $('catalogOverlay').classList.remove('open');
      $('catalogOverlay').setAttribute('aria-hidden', 'true');
    } catch (error) {
      console.error('Blender asset preview failed', error);
      toast('Could not load model: ' + title);
      addLog('Asset preview failed for ' + title + '.', 'alert');
    } finally {
      preview.disabled = false;
      preview.textContent = oldText;
    }
  });
  card.append(heading, roleNode, rootNode, stats, flag, preview);
  container.appendChild(card);
}
function populateRosterCatalog(roster) {
  const vehicles = Array.isArray(roster.vehicles) ? roster.vehicles.filter((u)=>!String(u.status||'').startsWith('archived')) : [];
  const airCategories = new Set(['fixed_wing_aircraft','rotary_wing_aircraft']);
  const ground = vehicles.filter((u) => !airCategories.has(u.category));
  const air = vehicles.filter((u) => airCategories.has(u.category));
  const infantry = roster.infantry && Array.isArray(roster.infantry.archetypes) ? roster.infantry.archetypes : [];
  $('catalogGroundCount').textContent = ground.length + ' CLASSES';
  $('catalogAirCount').textContent = air.length + ' AIR ASSETS';
  $('catalogInfantryCount').textContent = infantry.length + ' ROLES · ' + ((roster.infantry.instances || []).length) + ' INSTANCES';
  $('catalogMeta').textContent = ground.length + ' LAND · ' + infantry.length + ' ROLES';
  $('catalogGroundList').replaceChildren();
  $('catalogAirList').replaceChildren();
  $('catalogInfantryList').replaceChildren();
  for (const u of ground) addCatalogItem($('catalogGroundList'), u.name, u.role, u.root, u.balance, u.status);
  for (const u of air) addCatalogItem($('catalogAirList'), u.name, u.role, u.root, u.balance, u.status);
  for (const role of infantry) {
    const instance = (roster.infantry.instances || []).find((item) => item.archetype === role.id);
    addCatalogItem($('catalogInfantryList'), role.name, role.role, instance ? instance.sourceRoot : '', role.balance, 'blender_prototype');
  }
}
async function loadBlenderAssetBundle() {
  if (state.blenderBundle) return state.blenderBundle;
  if (state.blenderBundlePromise) return state.blenderBundlePromise;
  state.blenderBundlePromise = (async () => {
    setAssetText('Loading Blender scene GLB · 14.6 MB', false);
    const gltf = await loadGLTF('./assets/combined-arms-r19.glb', 90000);
    if (!gltf || !gltf.scene) throw new Error('GLB loaded without a scene');
    const roots = new Map();
    gltf.scene.traverse((node) => {
      if (node.name && (/^UNIT_.*_ROOT$/.test(node.name) || /^INF_.*_ROOT$/.test(node.name) || /^MAP_.*_ROOT$/.test(node.name))) {
        roots.set(node.name, node);
      }
    });
    if (!roots.size) throw new Error('No named Blender vehicle or infantry roots were found in the GLB');
    state.blenderBundle = { gltf, roots };
    setAssetText('Repository Blender GLB loaded · ' + roots.size + ' named roots', true);
    addLog('Blender combined-arms GLB loaded from the repository (' + roots.size + ' named roots).', 'normal');
    return state.blenderBundle;
  })();
  try {
    return await state.blenderBundlePromise;
  } finally {
    state.blenderBundlePromise = null;
  }
}
function normaliseNamedRoot(source,targetExtent=5.8,rotateToGameForward=true){
  const model=SkeletonUtils.clone(source);model.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const extent=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(extent)||extent<.001)throw new Error('Blender root has no measurable geometry: '+source.name);
  const sourcePosition=model.position.clone(),localCenter=center.clone().sub(sourcePosition),localMinY=box.min.y-sourcePosition.y;
  const factor=targetExtent/extent;
  model.scale.setScalar(factor);
  model.position.set(-localCenter.x*factor,-localMinY*factor,-localCenter.z*factor);
  if(rotateToGameForward)model.rotation.y=Math.PI;
  model.updateMatrixWorld(true);
  model.traverse((node)=>{if(node.isMesh){
    node.castShadow=true;node.receiveShadow=true;
    if(node.material){
      const tint=(m)=>{const cloned=m.clone();node.userData.initialMaterial=cloned;return cloned;};
      node.material=Array.isArray(node.material)?node.material.map(tint):tint(node.material);
    }
  }});
  return model;
}
function attachMatchingAnimations(model,unit,autoPattern=/rotor.*spin|tail.?rotor|main.?rotor/i){
  const bundle=state.blenderBundle;
  if(!bundle||!bundle.gltf.animations||!bundle.gltf.animations.length)return;
  const names=new Set();model.traverse((node)=>{if(node.name)names.add(node.name);});
  const clips=bundle.gltf.animations.filter((clip)=>clip.tracks.some((track)=>{
    const trackName=track.name.split(/[.]/)[0].split(/[\\/]/).pop();return names.has(trackName);
  }));
  if(!clips.length)return;
  const mixer=new THREE.AnimationMixer(model),actions={};
  for(const clip of clips){
    const action=mixer.clipAction(clip);actions[clip.name.toLowerCase()]=action;
    if(autoPattern.test(clip.name.toLowerCase()))action.play();
  }
  unit.mixer=mixer;unit.actions=actions;
  if(unit.type==='tank'||unit.type==='infantry')unit.animationMixer=mixer;
}
function applyTeamMaterialTint(model,team){
  if(team!=='red')return;
  model.traverse((node)=>{if(!node.isMesh||!node.material)return;
    const tint=(m)=>{const cloned=m.clone();if(cloned.color)cloned.color.multiply(new THREE.Color(0x9d6e67));node.userData.initialMaterial=cloned;return cloned;};
    node.material=Array.isArray(node.material)?node.material.map(tint):tint(node.material);
  });
}
function replaceTankWithBlenderRoot(unit,rootName){
  const source=state.blenderBundle&&state.blenderBundle.roots.get(rootName);if(!source)return false;
  const old=unit.visual;
  if(old){unit.group.remove(old);old.traverse((node)=>{if(node.geometry)node.geometry.dispose();});}
  const model=normaliseNamedRoot(source,rootName==='UNIT_SPG01_ROOT'?6.2:rootName==='UNIT_APCT01_ROOT'?6.0:5.1,true);
  model.name='RUNTIME_'+rootName;
  applyTeamMaterialTint(model,unit.team);
  const turret=model.getObjectByName('TURRET_PIVOT')||model.getObjectByName('MBT_TURRET_PIVOT')||model.getObjectByName('TANK_TURRET_PIVOT')||null;
  unit.visual=model;unit.visualData={imported:true,turret,wheels:[],tracks:[]};unit.turret=turret;unit.group.add(model);
  tagInteractive(model,'rtsUnit',unit);attachMatchingAnimations(model,unit,/driveloop|wheel.*spin|track.*loop|turret.*idle/i);
  unit.status=unit.team==='blue'?'READY · BLENDER MODEL':'HOSTILE · BLENDER MODEL';return true;
}
function replaceInfantryWithBlenderRoot(soldier,rootName){
  const source=state.blenderBundle&&state.blenderBundle.roots.get(rootName);if(!source)return false;
  const model=normaliseNamedRoot(source,1.95,true);model.name='RUNTIME_'+rootName;
  for(const child of [...soldier.group.children]){
    if(child===soldier.ring)continue;
    soldier.group.remove(child);
    child.traverse((node)=>{if(node.geometry)node.geometry.dispose();});
  }
  soldier.group.add(model);soldier.visual=model;soldier.arms=[];soldier.legs=[];tagInteractive(model,'rtsUnit',soldier);
  attachMatchingAnimations(model,soldier,/walk|run|idle|action/i);return true;
}
function replaceAircraftWithBlenderRoot(plane,rootName,displayName,targetExtent,flightClass='fixed-wing',isTransport=false){
  const source=state.blenderBundle&&state.blenderBundle.roots.get(rootName);if(!source)return false;
  const old=plane.visual;if(old){plane.group.remove(old);old.traverse((node)=>{if(node.geometry)node.geometry.dispose();});}
  const model=normaliseNamedRoot(source,targetExtent,true);model.name='RUNTIME_'+rootName;
  plane.visual=model;plane.group.add(model);plane.modelRootName=rootName;plane.name=displayName;plane.flightClass=flightClass;plane.isTransport=isTransport;
  plane.airUnitKey=rootName;plane.group.rotation.order='YXZ';tagInteractive(model,'rtsUnit',plane);
  attachMatchingAnimations(model,plane,flightClass==='rotary-wing'?/rotor.*spin|tail.?rotor|main.?rotor/i:/never-play-auto/);
  plane.status='READY AT BASE';return true;
}
function bindBlenderRuntimeAssets(){
  if(!state.blenderBundle)return false;
  const tankRoots=['UNIT_MBT_MAIN_ROOT','UNIT_APCT01_ROOT','UNIT_SPG01_ROOT','UNIT_LT01_ROOT','UNIT_MBT_MAIN_ROOT'];
  tanks.forEach((unit,i)=>replaceTankWithBlenderRoot(unit,tankRoots[i]||'UNIT_MBT_MAIN_ROOT'));
  const fixed=[
    {key:'f16c-block50',root:'UNIT_F16C_BLOCK50_ROOT',name:'F-16C BLOCK 50',extent:15.07},
    {key:'heavy-strike',root:'UNIT_HEAVY_STRIKE_ROOT',name:'HEAVY STRIKE FIGHTER',extent:19.43}
  ];
  fixed.forEach((item,i)=>{
    const plane=aircraft[i];if(!plane)return;
    plane.airUnitKey=item.key;plane.flightClass='fixed-wing';plane.speed=15;
    replaceAircraftWithBlenderRoot(plane,item.root,item.name,item.extent,'fixed-wing',false);
  });
  const rotorSpecs=[
    {key:'attack-helicopter',root:'UNIT_ATTACK_HELICOPTER_ROOT',name:'ATTACK HELICOPTER',extent:12.5,transport:false},
    {key:'transport-helicopter',root:'UNIT_TRANSPORT_HELICOPTER_ROOT',name:'TRANSPORT HELICOPTER',extent:13.5,transport:true}
  ];
  for(const item of rotorSpecs){
    let plane=aircraft.find((p)=>p.airUnitKey===item.key);
    if(!plane&&state.blenderBundle.roots.has(item.root)){
      plane=createPlane(0,0,aircraft.length+1);plane.airUnitKey=item.key;plane.flightClass='rotary-wing';plane.isTransport=item.transport;
      aircraft.push&&null;
    }
    if(plane){
      plane.flightClass='rotary-wing';plane.speed=8;plane.airUnitKey=item.key;
      replaceAircraftWithBlenderRoot(plane,item.root,item.name,item.extent,'rotary-wing',item.transport);
    }
  }
  const roster=state.rosterManifest;
  if(roster&&roster.infantry&&Array.isArray(roster.infantry.instances)){
    const roleAliases={'RIFLE SQUAD':'rifleman','SQUAD LEADER':'leader','MACHINE GUNNER':'machine_gunner','COMBAT MEDIC':'medic','ANTI-ARMOUR':'anti_armor'};
    soldiers.forEach((soldier,i)=>{
      const archetype=roleAliases[soldier.role]||'rifleman';
      const instance=roster.infantry.instances.find((v)=>v.archetype===archetype);
      if(instance&&instance.sourceRoot)replaceInfantryWithBlenderRoot(soldier,instance.sourceRoot);
    });
  }
  return true;
}
function clearAssetPreview() {
  const active = state.activeAssetPreview;
  if (!active) return;
  if (state.selected === active.unit) selectEntity(null);
  scene.remove(active.group);
  const ix = interactables.indexOf(active.group);
  if (ix >= 0) interactables.splice(ix, 1);
  if (active.pad) scene.remove(active.pad);
  if (active.marker) scene.remove(active.marker);
  state.activeAssetPreview = null;
}

function focusCameraAt(point) {
  const target = point.clone();
  cameraTarget.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(0, 48, 55));
  camera.lookAt(cameraTarget);
}

async function previewBlenderAsset(rootName, displayName, role) {
  if (!rootName || typeof rootName !== 'string') throw new Error('This catalog item has no mapped Blender root');
  toast('Loading Blender model…');
  const bundle = await loadBlenderAssetBundle();
  const original = bundle.roots.get(rootName) || bundle.gltf.scene.getObjectByName(rootName);
  if (!original) {
    throw new Error('Named root not found in combined GLB: ' + rootName);
  }
  clearAssetPreview();
  const model = SkeletonUtils.clone(original);
  model.name = 'CATALOG_PREVIEW_' + rootName;
  model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = true;
    }
  });
  model.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(model);
  const size = initialBox.getSize(new THREE.Vector3());
  const center = initialBox.getCenter(new THREE.Vector3());
  if (!Number.isFinite(size.x + size.y + size.z) || Math.max(size.x, size.y, size.z) < 0.001) {
    throw new Error('Named Blender root has no visible mesh geometry: ' + rootName);
  }
  // The source scene contains both centred hero collections and world-positioned unit roots.
  // Compute the mesh bounds in the root's local space, then apply scale and offset in the correct order.
  const originalPosition = model.position.clone();
  const localCenter = center.clone().sub(originalPosition);
  const localMinY = initialBox.min.y - originalPosition.y;
  const isInfantry = rootName.startsWith('INF_');
  const targetExtent = isInfantry ? 2.0 : (rootName==='UNIT_F16C_BLOCK50_ROOT' ? 15.07 : rootName==='UNIT_HEAVY_STRIKE_ROOT' ? 19.43 : rootName.includes('HELICOPTER') ? 12 : rootName.startsWith('MAP_') ? 1 : 5.8);
  const factor = targetExtent / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(factor);
  model.position.set(-localCenter.x * factor, -localMinY * factor, -localCenter.z * factor);
  if(!isInfantry && rootName.startsWith('UNIT_'))model.rotation.y=Math.PI;
  model.updateMatrixWorld(true);

  const slotIndex = state.assetPreviewCounter++ % 6;
  const x = 58 + (slotIndex % 3) * 14;
  const z = 22 + Math.floor(slotIndex / 3) * 13;
  const group = new THREE.Group();
  group.name = 'CATALOG_PREVIEW_GROUP_' + rootName;
  group.position.set(x, 0, z);
  group.add(model);
  const pad = addBox(scene, 'CATALOG_PREVIEW_PAD_' + slotIndex, [11, 0.18, 11], [x, 0.08, z], mats.concrete, false, true);
  const marker = addBox(scene, 'CATALOG_PREVIEW_ID_' + slotIndex, [0.10, 0.025, 3.0], [x - 4.8, 0.20, z], mats.emissive, false, false);
  const unit = {
    id: 'asset-preview-' + slotIndex,
    type: isInfantry ? 'infantry' : 'asset_preview',
    name: displayName,
    team: 'blue',
    group,
    visual: model,
    ring: addSelectionRing(group, TEAM.blue),
    hp: 100,
    maxHp: 100,
    status: 'BLENDER MODEL PREVIEW',
    selected: false,
    alive: true,
    role,
    rootName,
    assetOnly: true
  };
  group.position.set(x, 0, z);
  tagInteractive(group, 'rtsUnit', unit);
  scene.add(group);
  interactables.push(group);
  state.activeAssetPreview = { group, unit, pad, marker };
  if (bundle.gltf.animations && bundle.gltf.animations.length) {
    const modelNames = new Set();
    model.traverse((node) => { if (node.name) modelNames.add(node.name); });
    const matchingClips = bundle.gltf.animations.filter((clip) => clip.tracks.some((track) => {
      const trackName = track.name.split(/[.]/)[0].split(/[\/]/).pop();
      return modelNames.has(trackName);
    }));
    if (matchingClips.length) {
      const mixer = new THREE.AnimationMixer(model);
      for (const clip of matchingClips) mixer.clipAction(clip).play();
      state.activeAssetPreview.mixer = mixer;
    }
  }
  selectEntity(unit);
  focusCameraAt(new THREE.Vector3(x, 1, z));
  setCommand('select');
  addLog('Preview loaded: ' + displayName + ' · ' + rootName + '.', 'normal');
  toast('Loaded: ' + displayName);
  return unit;
}

async function loadRosterManifest() {
  const response = await fetch('./roster.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Roster manifest status ' + response.status);
  const roster = await response.json();
  if (!Array.isArray(roster.vehicles) || !roster.infantry || !Array.isArray(roster.infantry.archetypes)) {
    throw new Error('Roster manifest has an invalid schema');
  }
  state.rosterManifest = roster;
  populateRosterCatalog(roster);
  const groundVehicles = roster.vehicles.filter((unit) => !['fixed_wing_aircraft','rotary_wing_aircraft'].includes(unit.category)).length;
  const airAssets = roster.vehicles.filter((unit) => ['fixed_wing_aircraft','rotary_wing_aircraft'].includes(unit.category)).length;
  const roles = roster.infantry.archetypes.length;
  const instances = roster.infantry.instances ? roster.infantry.instances.length : 0;
  addLog(
    'Blender asset catalog indexed: ' + groundVehicles + ' ground vehicle classes, ' +
    airAssets + ' aircraft asset, ' + roles + ' infantry roles (' + instances +
    ' scene prototypes). Individual GLB unit imports remain pending.',
    'normal'
  );
  return roster;
}
function setupCatalogDialog() {
  const overlay = $('catalogOverlay');
  $('catalogToggle').addEventListener('click', () => {
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    $('catalogClose').focus();
  });
  const close = () => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    $('catalogToggle').focus();
  };
  $('catalogClose').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('open')) close();
  });
}
setupCatalogDialog();

function initialiseAssets() {
  setLoadProgress(70,'Loading revisioned Blender scene assets in the background…');
  state.started=true;
  setTimeout(()=>{
    $('startOverlay').classList.add('hidden');
    setLoadProgress(100,'Simulation ready · Blender assets may still be streaming');
    addLog('Operation IRON HORIZON is running. Blender-authored assets are being bound by class.','normal');
    toast('Theatre online · Select a unit to begin');updateObjectives();
  },300);
  Promise.allSettled([loadRosterManifest(),loadBlenderAssetBundle()]).then(async(results)=>{
    if(results[0]&&results[0].status==='rejected'){
      console.warn('Roster manifest unavailable',results[0].reason);
      addLog('Roster metadata unavailable; Blender geometry may still load.','alert');
    }
    if(results[1]&&results[1].status==='fulfilled'&&state.blenderBundle){
      try{
        bindBlenderRuntimeAssets();
        applyBattlefieldMap(state.mapId,true);
        setAssetText('Blender r19 loaded · '+state.blenderBundle.roots.size+' named roots',true);
        addLog('Blender revision-19 roots bound to separate land, fixed-wing, rotary-wing and infantry classes.','normal');
      }catch(error){
        console.error('Blender runtime binding failed',error);
        addLog('Blender scene loaded but a class-specific runtime binding failed.','alert');
      }
    }else{
      const reason=results[1]&&results[1].reason;
      console.warn('Blender scene GLB unavailable',reason);
      setAssetText('Blender bundle unavailable · fallback visuals active',false);
      addLog('Blender GLB could not be loaded; fallback theatre stays available.','alert');
    }
  });
}
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta() || 0);
  if (state.started && !state.paused) {
    state.time += dt;
    if (state.activeAssetPreview && state.activeAssetPreview.mixer) state.activeAssetPreview.mixer.update(dt);
    updateTanks(dt);
    updateInfantry(dt);
    aircraft.forEach((p) => { updatePlane(p, dt); updateAircraftDamage(p, dt); updateAircraftRigMotion(p,dt); });
    updateBombs(dt);
    updateProjectiles(dt);
    updateDebris(dt);
    updateEffects(dt);
    updateHUD();
  }
  renderer.render(scene, camera);
}
setLoadProgress(12, 'Loading battlefield geometry…');
applyBattlefieldMap(state.mapId,true);
addLog('Theatre loaded. Ground assets ready.', 'normal');
animate();
try {
  initialiseAssets();
} catch (err) {
  console.error(err);
  setAssetText('Asset pipeline warning · local fallbacks active', false);
  $('startOverlay').classList.add('hidden');
  state.started = true;
  addLog('Asset pipeline warning. Local fallback visuals active.', 'alert');
}
