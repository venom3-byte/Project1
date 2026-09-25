import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {join,normalize,extname} from "node:path";
import {fileURLToPath} from "node:url";
const root=normalize(fileURLToPath(new URL(".",import.meta.url)));
const port=Number(process.env.PORT||4173);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".avif":"image/avif"};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://127.0.0.1");
    let rel=decodeURIComponent(url.pathname);
    if(rel==="/")rel="/index.html";
    const file=normalize(join(root,rel));
    if(!file.startsWith(root))throw new Error("forbidden");
    const s=await stat(file);
    if(!s.isFile())throw new Error("not-file");
    const body=await readFile(file);
    res.writeHead(200,{"Content-Type":types[extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});
    res.end(body);
  }catch(e){res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});res.end("Not Found");}
});
server.listen(port,"127.0.0.1",()=>console.log("Asset Forge server listening on "+port));
