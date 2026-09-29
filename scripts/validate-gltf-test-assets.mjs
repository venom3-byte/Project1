import{readdir,readFile,writeFile}from"node:fs/promises";
import{join,relative,resolve}from"node:path";
import * as ValidatorNS from"gltf-validator";

const validator=ValidatorNS.default||ValidatorNS;
const root=resolve("test-results");
const reportPath="gltf-validation-report.json";

async function walk(dir){
  const out=[];
  let entries=[];
  try{entries=await readdir(dir,{withFileTypes:true})}catch{return out}
  for(const e of entries){
    const p=join(dir,e.name);
    if(e.isDirectory())out.push(...await walk(p));
    else if(/\.glb$/i.test(e.name))out.push(p);
  }
  return out;
}

const files=await walk(root);
const results=[];
for(const file of files){
  try{
    const bytes=new Uint8Array(await readFile(file));
    const report=await validator.validateBytes(bytes,{uri:relative(process.cwd(),file),writeTimestamp:false,maxIssues:0});
    results.push({
      file:relative(process.cwd(),file),
      bytes:bytes.byteLength,
      errors:report.issues?.numErrors||0,
      warnings:report.issues?.numWarnings||0,
      hints:report.issues?.numHints||0,
      infos:report.issues?.numInfos||0,
      valid:!(report.issues?.numErrors>0)
    });
  }catch(error){
    results.push({file:relative(process.cwd(),file),valid:false,error:error?.message||String(error)});
  }
}
const summary={
  ok:files.length>0&&results.every(x=>x.valid&&!(x.errors>0)),
  filesChecked:results.length,
  results,
  validatorVersion:typeof validator.version==="function"?validator.version():null
};
await writeFile(reportPath,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
if(!summary.ok)process.exit(1);
