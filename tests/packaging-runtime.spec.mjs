import{test,expect}from"@playwright/test";
import{createServer}from"node:http";
import{readFile,stat}from"node:fs/promises";
import path from"path";
import{fileURLToPath}from"url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","dist","forge-web");
let server;
let base;

test.beforeAll(async()=>{
  server=createServer(async(req,res)=>{
    try{
      const clean=(req.url||"/").split("?")[0];
      const rel=clean==="/"?"index.html":clean.replace(/^\/+/,"");
      const file=path.resolve(root,rel);
      if(!file.startsWith(root+path.sep)&&file!==root)throw new Error("path escape");
      const s=await stat(file);
      if(!s.isFile())throw new Error("not file");
      const data=await readFile(file);
      const types={".html":"text/html",".js":"text/javascript",".json":"application/json",".webmanifest":"application/manifest+json",".png":"image/png",".jpg":"image/jpeg",".glb":"model/gltf-binary"};
      res.writeHead(200,{"Content-Type":types[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});
      res.end(data);
    }catch{res.writeHead(404);res.end("not found")}
  });
  await new Promise(resolve=>server.listen(4174,"127.0.0.1",resolve));
  base="http://127.0.0.1:4174/";
});
test.afterAll(async()=>{if(server)await new Promise(r=>server.close(r))});

test("packaged Forge runtime boots and renders the packaged project",async({page})=>{
  test.setTimeout(60000);
  const errors=[];
  page.on("pageerror",e=>errors.push("pageerror: "+String(e)));
  page.on("console",m=>{if(m.type()==="error")errors.push("console: "+m.text())});
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>!!window.Forge&&!!window.Forge.diagnostics,{timeout:30000});
  await page.waitForFunction(()=>{
    const d=window.Forge.diagnostics();
    return d?.entities===4&&d?.renderables>0&&!!document.querySelector("canvas");
  },{timeout:30000});
  const d=await page.evaluate(()=>window.Forge.diagnostics());
  expect(d.entities).toBe(4);
  expect(d.renderables).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.screenshot({path:"test-results/packaged-runtime-proof.png",fullPage:true});
});