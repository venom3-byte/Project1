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
const aircraft = [];
const targets = [];
const mixers = [];
const bombs = [];
const effects = [];
const assets = { tank: null, plane: null, tankSource: '', planeSource: '' };
const state = { command: 'select', selected: null, time: 0, missionComplete: false, paused: false, started: false, pointerDown: null, dragging: false, touchPoints: new Map(), lastPinch: 0, blenderBundle: null, blenderBundlePromise: null, activeAssetPreview: null, assetPreviewCounter: 0 };
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
const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.1, 700);
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
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -100;
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
    scene.add(tuft);
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
  scene.add(tree);
}
for (let i = 0; i < 38; i++) {
  const x = Math.sin(i * 9.71) * 82;
  const z = Math.cos(i * 7.39) * 65;
  if (Math.abs(x) < 27 && z > 2 && z < 70) continue;
  if (z < -35 && Math.abs(x) < 40) continue;
  buildTree(x, z, 0.65 + (i % 4) * 0.14);
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
  unit.visual = clone;
  unit.visualData = { imported: true, turret, wheels, tracks: [] };
  unit.turret = turret;
  unit.group.add(clone);
  tagInteractive(clone, 'rtsUnit', unit);
}
function replacePlaneVisual(plane, gltf) {
  if (plane.visual) plane.group.remove(plane.visual);
  const clone = normaliseModel(cloneGLTFScene(gltf), 11.5);
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
  const plane = {
    id: 'aircraft-' + index, type: 'aircraft', name: 'STRIKE FLIGHT ' + String(index).padStart(2, '0'),
    team: 'blue', group, visual, ring: addSelectionRing(group, TEAM.blue),
    hp: 100, maxHp: 100, status: 'READY AT BASE', state: 'ready', target: null,
    route: [], routeIndex: 0, speed: 11.5, flightHeight: 0, attackDone: false, hasLanded: true,
    selected: false, alive: true, rearmTimer: 0, mixer: null, actions: {}, initial: { x, z },
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
          ? 'Infantry archetype · asset preview only'
          : 'Tracked vehicle · Ground force')));
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
        const attackers = state.selected && state.selected.type === 'tank' ? [state.selected] : tanks.filter((t) => t.team === 'blue' && t.alive);
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
    if (state.command === 'attack' && entity.type === 'tank') {
      const attackers = state.selected && state.selected.team === 'blue' ? [state.selected] : tanks.filter((t) => t.team === 'blue' && t.alive);
      attackers.forEach((u) => { u.attackTarget = entity; u.status = 'ENGAGING HOSTILE ARMOUR'; });
      addLog('Hostile armour engaged.', 'alert');
      return;
    }
  }
  if (!hit.point) return;
  if (state.command === 'move') {
    const movers = state.selected && state.selected.team === 'blue' && state.selected.type === 'tank' ? [state.selected] : tanks.filter((t) => t.team === 'blue' && t.alive);
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
function buildRouteFor(target) {
  const x = target.group.position.x, z = target.group.position.z;
  return [
    { p: new THREE.Vector3(0, 0.22, 45), state: 'TAXI-OUT' },
    { p: new THREE.Vector3(0, 0.22, 25), state: 'LINE-UP' },
    { p: new THREE.Vector3(0, 1.3, 10), state: 'TAKEOFF' },
    { p: new THREE.Vector3(x * 0.3, 7, z + 25), state: 'CLIMB' },
    { p: new THREE.Vector3(x * 0.78, 13, z + 14), state: 'INGRESS' },
    { p: new THREE.Vector3(x, 8, z + 5), state: 'ATTACK RUN' },
    { p: new THREE.Vector3(x + (x > 0 ? -10 : 10), 14, z - 12), state: 'EGRESS' },
    { p: new THREE.Vector3(x * 0.45, 19, -6), state: 'RETURN' },
    { p: new THREE.Vector3(4, 12, 17), state: 'APPROACH' },
    { p: new THREE.Vector3(1.5, 0.5, 42), state: 'LANDING' },
    { p: new THREE.Vector3(1.5, 0.22, 51), state: 'TAXI-IN' },
    { p: new THREE.Vector3(3.1, 0.16, 53), state: 'REARM' }
  ];
}
function launchAirstrike(target) {
  if (!target || !target.alive) { toast('Choose a live hostile objective'); return; }
  const plane = state.selected && state.selected.type === 'aircraft' && state.selected.state === 'ready'
    ? state.selected : aircraft.find((p) => p.state === 'ready');
  if (!plane) { toast('No aircraft ready — wait for rearm'); addLog('Airstrike denied: no aircraft ready.', 'alert'); return; }
  selectEntity(plane);
  plane.target = target;
  plane.route = buildRouteFor(target);
  plane.routeIndex = 0;
  plane.state = 'taxi';
  plane.status = 'TAXI-OUT';
  plane.attackDone = false;
  plane.hasLanded = false;
  plane.group.position.set(plane.initial.x, 0.16, plane.initial.z);
  plane.flightHeight = 0.16;
  if (plane.mixer && plane.actions) {
    Object.keys(plane.actions).forEach((key) => {
      if (/wheel-roll/.test(key)) plane.actions[key].reset().play();
      if (/gear.*retract|retract.*gear/.test(key)) plane.actions[key].reset().play();
    });
  }
  addLog('Strike flight launched against ' + target.name + '.', 'alert');
  toast('Air tasking accepted · ' + target.name);
  setCommand('select');
}
function returnAircraft(plane) {
  if (!plane || plane.type !== 'aircraft') { toast('Select an aircraft first'); return; }
  if (plane.state === 'ready' || plane.state === 'rearm' || plane.state === 'taxi-home') { toast('Aircraft is already at base'); return; }
  plane.target = null;
  plane.route = [
    { p: new THREE.Vector3(plane.group.position.x * 0.7, Math.max(12, plane.group.position.y), plane.group.position.z + 14), state: 'RTB / EGRESS' },
    { p: new THREE.Vector3(10, 16, -4), state: 'RETURN' },
    { p: new THREE.Vector3(4, 10, 17), state: 'APPROACH' },
    { p: new THREE.Vector3(1.5, 0.5, 42), state: 'LANDING' },
    { p: new THREE.Vector3(1.5, 0.22, 51), state: 'TAXI-IN' },
    { p: new THREE.Vector3(plane.initial.x, 0.16, plane.initial.z), state: 'REARM' }
  ];
  plane.routeIndex = 0;
  plane.state = 'return';
  plane.status = 'RETURNING TO BASE';
  addLog('Return-to-base order issued to ' + plane.name + '.', 'normal');
  setCommand('select');
}
function spawnBomb(plane, target) {
  if (plane.attackDone || !target || !target.alive) return;
  plane.attackDone = true;
  const bomb = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.72, 10), material(0x28302e, 0.4, 0.5));
  bomb.rotation.x = Math.PI / 2;
  bomb.position.copy(plane.group.position);
  bomb.position.y = Math.max(7, plane.group.position.y - 0.5);
  scene.add(bomb);
  bombs.push({ mesh: bomb, target, t: 0, duration: 1.1, from: bomb.position.clone(), to: new THREE.Vector3(target.group.position.x + (Math.sin(state.time) * 1.4), 0.8, target.group.position.z + (Math.cos(state.time * 1.3) * 1.2)) });
  addLog('Weapon release confirmed. Impact solution locked.', 'alert');
}
function explodeAt(position, target) {
  const blast = new THREE.Group();
  blast.position.copy(position);
  scene.add(blast);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb94d, transparent: true, opacity: 0.92 }));
  core.position.y = 1.1;
  blast.add(core);
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0x474b43, transparent: true, opacity: 0.55 }));
  smoke.position.set(0.2, 2.2, -0.15);
  blast.add(smoke);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.65, 24), new THREE.MeshBasicMaterial({ color: 0xffd07e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2; blast.add(ring);
  effects.push({ group: blast, t: 0, target });
  if (target && target.alive) {
    target.hp = Math.max(0, target.hp - (target.kind === 'depot' ? 70 : 60));
    if (target.hp <= 0) destroyTarget(target);
    addLog('Impact confirmed on ' + target.name + ' · ' + Math.round(target.hp) + '% integrity remaining.', target.hp === 0 ? 'alert' : 'normal');
    if (state.selected === target) updateSelectionPanel();
  }
}
function destroyTarget(target) {
  target.alive = false;
  target.status = 'DESTROYED';
  target.hp = 0;
  target.group.traverse((o) => {
    if (o.isMesh && o.material && !o.material.emissive) o.material = mats.destroyed;
  });
  target.ring.visible = false;
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(2.1, 14, 10), new THREE.MeshBasicMaterial({ color: 0x454a42, transparent: true, opacity: 0.62 }));
  smoke.position.set(0, 5, 0);
  target.group.add(smoke);
  target.smoke = smoke;
  addLog(target.name + ' destroyed. Objective status updated.', 'alert');
  toast(target.name + ' destroyed');
  updateObjectives();
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
function updatePlane(plane, dt) {
  if (plane.mixer) plane.mixer.update(dt);
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
  const speed = waypoint.state === 'TAXI-OUT' || waypoint.state === 'TAXI-IN' || waypoint.state === 'LINE-UP' ? 5.2 : (waypoint.state === 'LANDING' ? 8.3 : plane.speed);
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
  const desiredPitch = -Math.atan2(dir.y, Math.max(0.01, Math.hypot(dir.x, dir.z)));
  const currentYaw = plane.group.rotation.y;
  let diff = ((desiredHeading - currentYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  plane.group.rotation.y += diff * Math.min(1, dt * 2.6);
  plane.group.rotation.x += (THREE.MathUtils.clamp(desiredPitch, -0.28, 0.25) - plane.group.rotation.x) * Math.min(1, dt * 2);
  const bank = THREE.MathUtils.clamp(-diff * 1.6, -0.55, 0.55);
  plane.group.rotation.z += (bank - plane.group.rotation.z) * Math.min(1, dt * 1.7);
  plane.status = waypoint.state;
  if (plane.state === 'taxi' && plane.routeIndex >= 2) plane.state = 'airborne';
  if (plane.routeIndex >= 6 && plane.state !== 'return' && plane.route[5] && plane.route[5].state === 'ATTACK RUN') plane.state = 'return';
}
function updateTanks(dt) {
  for (const unit of tanks) {
    if (!unit.alive) continue;
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
        unit.fireTimer -= dt;
        if (unit.fireTimer <= 0) {
          unit.fireTimer = 2.7;
          t.hp = Math.max(0, t.hp - 5);
          createTracer(unit.group.position.clone().add(new THREE.Vector3(0, 1.6, 1.3)), t.group.position.clone().add(new THREE.Vector3(0, 2.5, 0)));
          if (t.hp <= 0) destroyTarget(t);
          if (state.selected === t) updateSelectionPanel();
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
function updateBombs(dt) {
  for (let i = bombs.length - 1; i >= 0; i--) {
    const bomb = bombs[i];
    bomb.t += dt;
    const t = Math.min(1, bomb.t / bomb.duration);
    bomb.mesh.position.lerpVectors(bomb.from, bomb.to, t);
    bomb.mesh.position.y -= Math.sin(t * Math.PI) * 2.3;
    bomb.mesh.rotation.z += dt * 3;
    if (t >= 1) {
      explodeAt(bomb.to, bomb.target);
      scene.remove(bomb.mesh); bomb.mesh.geometry.dispose(); bombs.splice(i, 1);
    }
  }
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.t += dt;
    if (e.tracer) {
      if (e.t > 0.18) { scene.remove(e.group); e.group.geometry.dispose(); e.group.material.dispose(); effects.splice(i, 1); }
    } else {
      const t = Math.min(1, e.t / 1.2);
      e.group.scale.setScalar(1 + t * 1.5);
      e.group.children.forEach((child) => { if (child.material && child.material.transparent) child.material.opacity = Math.max(0, 0.9 - t * 0.9); });
      if (e.t > 1.3) { scene.remove(e.group); e.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); effects.splice(i, 1); }
    }
  }
}
function updateHUD() {
  const mins = Math.floor(state.time / 60).toString().padStart(2, '0');
  const secs = Math.floor(state.time % 60).toString().padStart(2, '0');
  $('clock').textContent = mins + ':' + secs;
  $('airCount').textContent = aircraft.filter((p) => p.state === 'ready').length.toString().padStart(2, '0') + ' / 04';
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
  ctx.fillStyle = '#1e2f29'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(190,210,192,.08)'; ctx.lineWidth = 1;
  for (let x = 10; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 10; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const px = (x) => (x + 110) / 220 * w;
  const py = (z) => (z + 95) / 190 * h;
  ctx.fillStyle = '#303d40'; ctx.fillRect(px(-8), py(58), (13.5 / 220) * w, (58 / 190) * h);
  ctx.fillStyle = '#798179'; ctx.fillRect(px(7), py(62), (28 / 220) * w, (16 / 190) * h);
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
  aircraft.forEach((p) => {
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
    const seed = unit.id === 'tank-1' ? [-18, 7] : unit.id === 'tank-2' ? [-12.8, 11.3] : unit.id === 'tank-3' ? [-24, 0.6] : unit.id === 'tank-4' ? [16, -17] : [23, -22];
    unit.group.position.set(seed[0], 0, seed[1]); unit.group.rotation.set(0, 0, 0);
    if (unit.visualData && unit.visualData.tracks) {
      unit.visualData.tracks.forEach((track) => { track.phase = 0; positionTrackSegments(track); });
    }
  }
  for (const plane of aircraft) {
    plane.hp = 100; plane.state = 'ready'; plane.status = 'READY AT BASE'; plane.target = null;
    plane.route = []; plane.routeIndex = 0; plane.attackDone = false; plane.hasLanded = false; plane.rearmTimer = 0;
    plane.group.position.set(plane.initial.x, 0.16, plane.initial.z); plane.group.rotation.set(0, Math.PI, 0);
  }
  bombs.splice(0).forEach((b) => scene.remove(b.mesh));
  effects.splice(0).forEach((e) => scene.remove(e.group));
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
  const distance = THREE.MathUtils.clamp(offset.length() * factor, 42, 205);
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
  const vehicles = Array.isArray(roster.vehicles) ? roster.vehicles : [];
  const ground = vehicles.filter((u) => u.category !== 'fixed_wing_aircraft');
  const air = vehicles.filter((u) => u.category === 'fixed_wing_aircraft');
  const infantry = roster.infantry && Array.isArray(roster.infantry.archetypes) ? roster.infantry.archetypes : [];
  $('catalogGroundCount').textContent = ground.length + ' CLASSES';
  $('catalogAirCount').textContent = air.length + ' ASSET';
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
    setAssetText('Loading repository Blender GLB · 11.1 MB', false);
    const gltf = await loadGLTF('./assets/combined-arms-r8.glb', 60000);
    if (!gltf || !gltf.scene) throw new Error('GLB loaded without a scene');
    const roots = new Map();
    gltf.scene.traverse((node) => {
      if (node.name && (/^UNIT_.*_ROOT$/.test(node.name) || /^INF_.*_ROOT$/.test(node.name))) {
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
  const targetExtent = isInfantry ? 2.25 : (rootName.includes('JET') ? 12 : 8.5);
  const factor = targetExtent / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(factor);
  model.position.set(-localCenter.x * factor, -localMinY * factor, -localCenter.z * factor);
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
  const groundVehicles = roster.vehicles.filter((unit) => unit.category !== 'fixed_wing_aircraft').length;
  const airAssets = roster.vehicles.filter((unit) => unit.category === 'fixed_wing_aircraft').length;
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
  setLoadProgress(78, 'Starting simulation; optional GLB assets load in the background…');
  // Never block the first playable frame on external CDN/CORS availability.
  state.started = true;
  setTimeout(() => {
    $('startOverlay').classList.add('hidden');
    setLoadProgress(100, 'Ready');
    addLog('Operation IRON HORIZON is ready for command.', 'normal');
    toast('Theatre online · Select a unit to begin');
    updateObjectives();
  }, 300);
  Promise.allSettled([loadRosterManifest(), loadTankAssets(), loadPlaneAssets()]).then((results) => {
    const importedTank = results[1] && results[1].status === 'fulfilled' && results[1].value;
    const importedPlane = results[2] && results[2].status === 'fulfilled' && results[2].value;
    if (results[0] && results[0].status === 'rejected') {
      console.warn('Roster manifest unavailable', results[0].reason);
      addLog('Asset roster metadata is unavailable; battlefield simulation continues.', 'alert');
    }
    if (!importedTank && !importedPlane) {
      setAssetText('Remote GLB unavailable · local models active', false);
    }
  }).catch((error) => {
    console.warn('Optional asset loading failed', error);
    setAssetText('Remote GLB unavailable · local models active', false);
  });
}
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta() || 0);
  if (state.started && !state.paused) {
    state.time += dt;
    if (state.activeAssetPreview && state.activeAssetPreview.mixer) state.activeAssetPreview.mixer.update(dt);
    updateTanks(dt);
    aircraft.forEach((p) => updatePlane(p, dt));
    updateBombs(dt);
    updateEffects(dt);
    updateHUD();
  }
  renderer.render(scene, camera);
}
setLoadProgress(12, 'Loading battlefield geometry…');
addLog('Theatre loaded. Ground assets ready.', 'normal');
animate();
initialiseAssets().catch((err) => {
  console.error(err);
  setAssetText('Asset pipeline warning · local fallbacks active', false);
  $('startOverlay').classList.add('hidden');
  state.started = true;
  addLog('Asset pipeline warning. Local fallback visuals active.', 'alert');
});
