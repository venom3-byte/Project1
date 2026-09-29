
import { NodeIO } from "@gltf-transform/core";
import { dedup, prune, resample, simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const io=new NodeIO();

export async function cookGLB(input,{lods=[1,0.5,0.2,0.05]}={}){
  const source=new Uint8Array(input);
  const results=[];
  for(const ratio of lods){
    const doc=await io.readBinary(source);
    await doc.transform(resample(),prune(),dedup());
    if(ratio<1){
      try{await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio,error:0.0001,lockBorder:true,cleanup:true}));}
      catch(error){doc.getLogger().warn("LOD simplification failed at ratio "+ratio+": "+error.message)}
    }
    const bytes=await io.writeBinary(doc);
    const suffix=ratio===1?"lod0":"lod"+Math.round((1-ratio)*100);
    results.push({name:suffix+".glb",bytes});
  }
  return {
    files:results.map(x=>({name:x.name,base64:Buffer.from(x.bytes).toString("base64"),bytes:x.bytes.byteLength})),
    manifest:{
      version:1,
      sourceBytes:source.byteLength,
      lods:lods.map((ratio,i)=>({index:i,ratio,file:results[i].name})),
      collision:{strategy:"auto-box",status:"recommended"},
      material:{workflow:"PBR metallic-roughness",status:"preserve"},
      notes:["Lossless prune/dedup/resample applied before LOD generation","LOD simplification is lossy and should be visually reviewed"]
    }
  };
}
