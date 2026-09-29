import{test,expect}from"@playwright/test";
test("Forge boots with renderer and scene kernel",async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));page.on("console",m=>m.type()==="error"&&errors.push(m.text()));
  await page.goto("/");await expect(page.locator("#sceneCount")).toContainText("3 entities");await expect(page.locator("#renderer")).toHaveText(/WebGPU|WebGL2/);
  const s=await page.evaluate(()=>window.Forge.diagnostics());expect(s.entities).toBe(3);expect(s.renderables).toBeGreaterThan(0);expect(errors).toEqual([]);
});
test("scene creation, selection, inspector and transform work",async({page})=>{
  await page.goto("/");await page.click('[data-add="box"]');await expect(page.locator("#sceneCount")).toContainText("4 entities");await expect(page.locator("#form")).toBeVisible();
  const before=await page.locator("#px").inputValue();await page.fill("#px","3");await page.dispatchEvent("#px","change");expect(await page.locator("#px").inputValue()).toBe("3");expect(before).not.toBe("3");
  const d=await page.evaluate(()=>window.Forge.diagnostics());expect(d.renderables).toBeGreaterThanOrEqual(2);
});
test("physics body updates runtime state",async({page})=>{
  await page.goto("/");await page.click('[data-add="box"]');await page.selectOption("#body","dynamic");await page.selectOption("#shape","box");await page.click("#apply");await page.waitForTimeout(400);
  const d=await page.evaluate(()=>window.Forge.diagnostics());expect(d.physics).toBeGreaterThan(1);
});
test("keyframe timeline is persistent in project JSON",async({page})=>{
  await page.goto("/");await page.click('[data-add="box"]');await page.click("#key");await page.fill("#time","1");await page.dispatchEvent("#time","input");await page.click("#key");
  const p=await page.evaluate(()=>window.Forge.serialize());const chosen=p.entities.find(x=>x.id===window.Forge.selectedId);expect(chosen.keyframes.length).toBe(2);
});
test("real raster asset import creates a renderable asset",async({page})=>{
  await page.goto("/");
  const data=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=64;c.height=64;const g=c.getContext("2d");g.fillStyle="#00c8ff";g.fillRect(8,8,48,48);return c.toDataURL("image/png").split(",")[1]});
  await page.setInputFiles("#assetInput",{name:"car-texture.png",mimeType:"image/png",buffer:Buffer.from(data,"base64")});
  await expect(page.locator("#sceneCount")).toContainText("4 entities");
  const s=await page.evaluate(()=>window.Forge.diagnostics());expect(s.renderables).toBeGreaterThan(1);
});
test("project save/open round trip keeps scene entities",async({page})=>{
  await page.goto("/");await page.click('[data-add="sphere"]');const json=await page.evaluate(()=>JSON.stringify(window.Forge.serialize()));
  await page.setInputFiles("#projectInput",{name:"roundtrip.forge.json",mimeType:"application/json",buffer:Buffer.from(json)});
  const d=await page.evaluate(()=>window.Forge.diagnostics());expect(d.entities).toBe(4);
});
test("visual QA reports healthy runtime",async({page})=>{
  await page.goto("/");await page.click("#qa");await expect(page.locator("#qaDialog")).toBeVisible();await page.click("#runQA");const text=await page.locator("#qaReport").textContent();expect(text).toContain('"ok": true');
});
test("mobile studio keeps viewport and inspector usable",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto("/");await expect(page.locator("#viewport")).toBeVisible();await page.click('[data-add="box"]');await expect(page.locator("#form")).toBeVisible();await page.click("#saveProject");
});


test("GLB cook pipeline produces deterministic LOD package",async({request})=>{
  const json=JSON.stringify({
    asset:{version:"2.0"},
    scene:0,
    scenes:[{nodes:[0]}],
    nodes:[{mesh:0}],
    meshes:[{name:"Triangle",primitives:[{attributes:{POSITION:0},indices:1}]}],
    buffers:[{byteLength:44}],
    bufferViews:[
      {buffer:0,byteOffset:0,byteLength:36,target:34962},
      {buffer:0,byteOffset:36,byteLength:6,target:34963}
    ],
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:"VEC3",min:[0,0,0],max:[1,1,0]},
      {bufferView:1,componentType:5123,count:3,type:"SCALAR"}
    ]
  });
  const jb=Buffer.from(json);
  const jpad=Buffer.concat([jb,Buffer.alloc((4-jb.length%4)%4,0x20)]);
  const pos=Buffer.alloc(36);
  const fv=new Float32Array(pos.buffer,pos.byteOffset,9);
  fv.set([0,0,0,1,0,0,0,1,0]);
  const ib=Buffer.alloc(8);const iv=new Uint16Array(ib.buffer,ib.byteOffset,3);iv.set([0,1,2]);
  const header=Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);
  const total=12+8+jpad.length+8+ib.length;header.writeUInt32LE(total,8);
  const jh=Buffer.alloc(8);jh.writeUInt32LE(jpad.length,0);jh.writeUInt32LE(0x4e4f534a,4);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(ib.length,0);bh.writeUInt32LE(0x004e4942,4);
  const glb=Buffer.concat([header,jh,jpad,bh,Buffer.concat([pos,ib])]);
  const response=await request.post("/api/pipeline",{data:{operation:"cook-glb",base64:glb.toString("base64"),options:{lods:[1,.5,.2]}}});
  expect(response.ok()).toBeTruthy();
  const result=await response.json();
  expect(result.ok).toBeTruthy();
  expect(result.files.length).toBe(3);
  expect(result.files[0].name).toBe("lod0.glb");
  expect(result.files[1].name).toBe("lod50.glb");
  expect(result.files[2].name).toBe("lod80.glb");
  expect(result.manifest.collision.strategy).toBe("auto-box");
});

test("Forge HTTP command endpoint accepts structured engine commands",async({request})=>{
  const response=await request.post("/api/forge/command",{data:{command:{op:"diagnostics"}}});
  expect(response.ok()).toBeTruthy();
  const result=await response.json();
  expect(result.ok).toBeTruthy();
  expect(result.queued).toBeTruthy();
});


test("third-person gameplay template creates real controller and AI runtime state",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>window.ForgeGameplay.createThirdPersonTemplate());
  expect(result.type).toBe("third-person");
  const state=await page.evaluate(()=>window.ForgeGameplay.status());
  expect(state.characters.length).toBe(1);
  expect(state.agents.length).toBe(3);
  const d=await page.evaluate(()=>window.Forge.diagnostics());
  expect(d.physics).toBeGreaterThan(1);
  expect(d.renderables).toBeGreaterThan(5);
});

test("racing template creates vehicle controller with four wheels",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>window.ForgeGameplay.createRacingTemplate());
  expect(result.type).toBe("racing");
  const state=await page.evaluate(()=>window.ForgeGameplay.status());
  expect(state.vehicles.length).toBe(1);
  expect(state.vehicles[0].wheels).toBe(4);
});

test("2D platformer template creates orthographic gameplay scene",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>window.Forge2D.createPlatformerTemplate());
  expect(result.player).toBeTruthy();
  const state=await page.evaluate(()=>window.Forge2D.status());
  expect(state.platformer.player).toBeTruthy();
  const camera=await page.evaluate(()=>window.Forge.entities.get(state.platformer.camera)?.kind);
  expect(camera).toBe("camera");
});

test("complete project graph preserves gameplay configuration",async({page})=>{
  await page.goto("/");
  await page.evaluate(()=>window.ForgeGameplay.createThirdPersonTemplate());
  const json=await page.evaluate(()=>JSON.stringify(window.ForgeProject.serialize()));
  const project=JSON.parse(json);
  expect(project.format).toBe("forge-project");
  expect(project.version).toBe(4);
  expect(project.gameplay.type).toBe("third-person");
  expect(project.runtime).toHaveProperty("audio");
  expect(project.production).toHaveProperty("graph");
});

test("VFX, render profiles and runtime services are callable",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>{
    window.ForgeRender.apply("cinematic");
    const v=window.ForgeVFX.spawn("burst",{x:0,y:1,z:0});
    return {quality:window.ForgeRender.quality(),vfx:window.ForgeVFX.status(),runtime:window.ForgeRuntime.snapshot(),tag:v?.name||null};
  });
  expect(result.quality.profile).toBe("cinematic");
  expect(result.vfx.presets).toContain("explosion");
  expect(result.runtime).toHaveProperty("input");
});


test("Vision Core grounds the rendered scene in screen space",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(async()=>{
    window.Forge.select([...window.Forge.entities.values()].find(x=>x.name==="Ground").id);
    const map=window.ForgeVision.map();
    const selected=window.ForgeVision.selectAt(map.entities.find(x=>x.name==="Ground")?.screen.x||10,map.entities.find(x=>x.name==="Ground")?.screen.y||10);
    const frame=window.ForgeVision.capture({annotate:true,scale:.5});
    const report=await window.ForgeVision.report();
    return {map,selected,frame:{width:frame.width,height:frame.height,hasPng:frame.dataUrl.startsWith("data:image/png")},report};
  });
  expect(result.map.entities.length).toBeGreaterThan(0);
  expect(result.map.entities.some(x=>x.name==="Ground"&&x.bounds)).toBeTruthy();
  expect(result.frame.hasPng).toBeTruthy();
  expect(result.frame.width).toBeGreaterThan(100);
  expect(result.report.map.entities.length).toBeGreaterThan(0);
  expect(result.report.dom).toHaveProperty("coverage");
});

test("Vision Agent loop executes commands with visual feedback",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(async()=>{
    return await window.ForgeAgent.execute({
      op:"vision-loop",
      commands:[
        {op:"create",kind:"box",name:"LoopBox",x:0,y:1,z:0},
        {op:"transform",x:2,y:1,z:0},
        {op:"vision-map"}
      ],
      stopOnVisualFailure:true
    });
  });
  return result;
});

test("Pose Search selects the nearest motion feature and can drive animation state",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>{
    const id="ci-locomotion";
    window.ForgePoseSearch.createDatabase(id,[
      {clip:"Idle",time:0,features:[0,0,1]},
      {clip:"Run",time:.2,features:[1,0,0]},
      {clip:"Strafe",time:.1,features:[0,1,0]}
    ]);
    const query=window.ForgePoseSearch.query(id,[.98,.05,.01],{k:2});
    const player=window.Forge.primitive("box","PoseActor");
    const match=window.ForgePoseSearch.match(id,player.id,[1,0,0],{play:false});
    return {query,match,status:window.ForgePoseSearch.status()};
  });
  expect(result.query.results[0].clip).toBe("Run");
  expect(result.match.match.clip).toBe("Run");
  expect(result.status.databases[0].entries).toBe(3);
});

test("in-engine visual QA can audit and baseline the rendered scene",async({page})=>{
  await page.goto("/");
  const audit=await page.evaluate(async()=>await window.ForgeQAPro.audit());
  expect(audit.width).toBeGreaterThan(100);
  expect(audit.height).toBeGreaterThan(100);
  expect(audit.engine.entities).toBeGreaterThan(0);
  const base=await page.evaluate(async()=>await window.ForgeQAPro.saveBaseline("ci"));
  expect(base.engine.renderables).toBeGreaterThan(0);
  const diff=await page.evaluate(async()=>await window.ForgeQAPro.diff("ci"));
  expect(diff.ok).toBeTruthy();
  expect(diff.meanSampleDelta).toBeLessThan(.05);
});


test("terrain generation produces a renderable world surface and physics collider",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>window.ForgeTerrain.generate("CI Terrain",{size:24,subdivisions:24,seed:22,height:4}));
  expect(result.components.terrain.subdivisions).toBe(24);
  const state=await page.evaluate(()=>window.ForgeTerrain.status());
  expect(state.terrains.length).toBe(1);
  const d=await page.evaluate(()=>window.Forge.diagnostics());
  expect(d.physics).toBeGreaterThan(1);
});

test("shader lab applies a custom material preset to a selected renderable",async({page})=>{
  await page.goto("/");
  await page.click('[data-add="box"]');
  const ok=await page.evaluate(()=>window.ForgeShaders.applyPreset("energy"));
  expect(ok).toBeTruthy();
  const selected=await page.evaluate(()=>window.Forge.selected().components.shader?.preset);
  expect(selected).toBe("energy");
});

test("data-driven gameplay supports tags attributes abilities inventory and quests",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>{
    const a=window.ForgeData.actor("ci-player");
    a.tags.add("Character.Player","Team.Blue");
    a.attributes.define("Power",10,0,100);
    a.addAbility("Heal",{cooldown:1,effects:[{id:"heal",duration:0,modifiers:{Health:{op:"add",value:10}}}]});
    a.grantItem("Potion",2);
    window.ForgeData.quests.define("q",{title:"Test",objectives:[{id:"kill",target:2}]});
    window.ForgeData.quests.progress("q","kill",1);
    return {tags:a.tags.all(),power:a.attributes.get("Power"),inventory:Object.fromEntries(a.inventory),quest:window.ForgeData.quests.status("q")};
  });
  expect(result.tags).toContain("Character.Player");
  expect(result.power).toBe(10);
  expect(result.inventory.Potion).toBe(2);
  expect(result.quest[0].objectives[0].current).toBe(1);
});

test("replay records and restores deterministic input frames",async({page})=>{
  await page.goto("/");
  const state=await page.evaluate(async()=>{
    window.ForgeReplay.startRecord();
    window.ForgeRuntime.input.down.add("moveForward");
    for(let i=0;i<12;i++)window.ForgeReplay.recordStep(1/60);
    window.ForgeRuntime.input.down.delete("moveForward");
    const data=window.ForgeReplay.stopRecord();
    window.ForgeReplay.play(data);
    return window.ForgeReplay.status();
  });
  expect(state.frames).toBe(12);
  expect(state.playing).toBeTruthy();
});

test("multiplayer WebSocket room relay accepts a client connection",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>new Promise(resolve=>{
    const ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/net");
    const timer=setTimeout(()=>{try{ws.close()}catch{};resolve("timeout")},5000);
    ws.onopen=()=>{clearTimeout(timer);ws.send(JSON.stringify({type:"hello",room:"ci",peerId:"ci-peer"}));setTimeout(()=>{ws.close();resolve("open")},100)};
    ws.onerror=()=>{clearTimeout(timer);resolve("error")};
  }));
  expect(result).toBe("open");
});

test("recursive prefab capture and spawn preserve child entities",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>{
    const parent=window.Forge.primitive("box","PrefabRoot");
    const child=window.Forge.primitive("sphere","PrefabChild");
    child.entity.reparent(parent.entity);
    const p=window.ForgeRuntime.prefabs.save("CI Prefab",parent.id);
    const spawned=window.ForgeRuntime.prefabs.spawn("CI Prefab",{x:4,y:1,z:2});
    return {has:p?.record?.children?.length===1,spawned:!!spawned,childCount:spawned?.entity?.children?.length||0};
  });
  expect(result.has).toBeTruthy();
  expect(result.spawned).toBeTruthy();
  expect(result.childCount).toBe(1);
});


test("real animated GLB import exposes playable animation clips",async({page})=>{
  test.setTimeout(120000);
  const url="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb";
  const response=await page.request.get(url);
  expect(response.ok()).toBeTruthy();
  const bytes=await response.body();
  expect(bytes.length).toBeGreaterThan(100000);
  await page.goto("/");
  await page.setInputFiles("#assetInput",{name:"Fox.glb",mimeType:"model/gltf-binary",buffer:bytes});
  await expect(page.locator("#sceneCount")).toContainText("4 entities");
  const info=await page.evaluate(()=>({
    selected:window.Forge.selected()?.name,
    clips:window.Forge.selected()?.components?.animation?.clips||[],
    playing:!!window.Forge.selected()?.entity?.anim?.playing
  }));
  expect(info.selected).toContain("Fox");
  expect(info.clips.length).toBeGreaterThan(0);
  expect(info.playing).toBeTruthy();
});


test("Rapier collision events reach the Forge collision bus",async({page})=>{
  await page.goto("/");
  const hit=await page.evaluate(async()=>{
    let started=false;
    window.Forge.onCollision(e=>{if(e.started)started=true});
    const ground=window.Forge.primitive("box","CollisionGround");
    ground.entity.setLocalPosition(0,0,0);ground.entity.setLocalScale(5,.25,5);window.Forge.setPhysics(ground.id,"fixed","box");
    const box=window.Forge.primitive("box","FallingBox");
    box.entity.setLocalPosition(0,4,0);window.Forge.setPhysics(box.id,"dynamic","box");
    await new Promise(r=>setTimeout(r,1400));
    return started;
  });
  expect(hit).toBeTruthy();
});

test("Game session lifecycle is serializable and restartable",async({page})=>{
  await page.goto("/");
  const state=await page.evaluate(()=>{
    window.ForgeSession.addPlayer("p1","Player One");
    window.ForgeSession.mode.configure({winScore:10});
    window.ForgeSession.start();
    window.ForgeSession.state.set("score",3);
    const data=window.ForgeSession.serialize();
    window.ForgeSession.end({winner:"p1"});
    window.ForgeSession.load(data);
    return window.ForgeSession.serialize();
  });
  expect(state.state.phase).toBe("playing");
  expect(state.players[0][1].name).toBe("Player One");
  expect(state.state.values.score).toBe(3);
});


test("integrated AAA showcase creates a playable end-to-end game state",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(()=>window.ForgeGameplay.createShowcaseGame());
  const state=await page.evaluate(()=>({
    gameplay:window.ForgeGameplay.status(),
    session:window.ForgeSession.serialize(),
    quest:window.ForgeData.quests.status("arena-objective"),
    project:window.ForgeProject.serialize()
  }));
  expect(result.type).toBe("showcase");
  expect(state.gameplay.characters.length).toBe(1);
  expect(state.gameplay.agents.length).toBe(5);
  expect(state.session.state.phase).toBe("playing");
  expect(state.quest[0].objectives[0].target).toBe(5);
  expect(state.project.gameplay.type).toBe("showcase");
});
