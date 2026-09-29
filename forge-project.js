
class ForgeProjectStore{
  constructor(){this.format="forge-project";this.version=4;this.migrations=new Map()}
  registerMigration(from,fn){this.migrations.set(from,fn)}
  serialize(){
    const F=window.Forge,P=window.ForgeProduction,R=window.ForgeRuntime,G=window.ForgeGameplay;
    return {
      format:this.format,version:this.version,
      meta:{name:"Forge Project",engine:"Forge Studio 2.0",createdAt:new Date().toISOString()},
      scene:F.serialize(),
      production:{
        assets:P?.assets?.all?.()||[],
        graph:P?.graph?.graph||null,
        world:P?.world?.partition?.()||null,
        profiler:P?.profiler?.sample?.()||null
      },
      runtime:{
        input:P?Object.fromEntries([...R.input.bindings].map(([k,v])=>[k,v])):null,
        prefabs:R?[...R.prefabs.store.entries()]:[],
        slots:R?.save?.list?.()||[]
      },
      gameplay:G?.status?.()||null,
      rendering:window.ForgeRender?.serialize?.()||null,
      cinematics:window.ForgeCinematics?.serialize?.()||null,
      ui:window.ForgeUISystem?.serialize?.()||null
    }
  }
  async normalize(data){
    if(!data||typeof data!=="object")throw new Error("Invalid Forge project");
    let d=structuredClone(data);
    if(d.format==="forge-scene"){d={format:this.format,version:2,scene:d,production:{},runtime:{},gameplay:null}}
    while((d.version||1)<this.version){
      const next=(d.version||1)+1;
      const fn=this.migrations.get(next);if(fn)d=await fn(d);else d.version=next;
    }
    return d
  }
  async load(data){
    const d=await this.normalize(data),F=window.Forge,P=window.ForgeProduction,R=window.ForgeRuntime;await P?.assets?.hydrateEngineAssets?.();
    await F.load(d.scene,d.runtime?.assetRoot?{assetRoot:d.runtime.assetRoot}:{});
    if(P?.graph&&d.production?.graph)P.graph.graph=d.production.graph;
    if(R?.prefabs&&Array.isArray(d.runtime?.prefabs)){R.prefabs.store=new Map(d.runtime.prefabs);R.prefabs.persist()}
    if(R?.input&&d.runtime?.input){for(const [k,v] of Object.entries(d.runtime.input))R.input.bind(k,v)}
    if(window.ForgeRender?.load&&d.rendering)window.ForgeRender.load(d.rendering);
    if(window.ForgeCinematics?.load&&d.cinematics)window.ForgeCinematics.load(d.cinematics);
    if(window.ForgeUISystem?.load&&d.ui)window.ForgeUISystem.load(d.ui);
    return d
  }
  download(name="forge-project.forge.json"){
    const blob=new Blob([JSON.stringify(this.serialize(),null,2)],{type:"application/json"});
    const a=document.createElement("a");a.download=name;a.href=URL.createObjectURL(blob);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  }
}
const ForgeProject=new ForgeProjectStore();
ForgeProject.registerMigration(3,d=>{d.production??={};d.runtime??={};d.version=3;return d});
ForgeProject.registerMigration(4,d=>{d.rendering??=null;d.cinematics??=null;d.ui??=null;d.version=4;return d});
window.ForgeProject=ForgeProject;
