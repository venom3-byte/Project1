import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {join,normalize,extname} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {WebSocketServer} from "ws";

const root=normalize(fileURLToPath(new URL(".",import.meta.url)));
const port=Number(process.env.PORT||4173);
const githubToken=()=>String(process.env.GITHUB_TOKEN||"").trim();
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".avif":"image/avif"};

function headers(extra={}){
  return {"Cache-Control":"no-store",...extra};
}
function sameOrigin(req){
  const origin=req.headers.origin;
  if(!origin)return true;
  try{
    const u=new URL(origin);
    const host=req.headers.host||"";
    const h=new URL("http://"+host);
    return u.hostname===h.hostname&&(u.port||"")===((h.port)||"");
  }catch{return false}
}
function json(res,status,data){res.writeHead(status,headers({"Content-Type":"application/json; charset=utf-8"}));res.end(JSON.stringify(data))}
function validRepo(repo){return typeof repo==="string"&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)}
function validPath(path){return typeof path==="string"&&!path.includes("..")&&!path.startsWith("/")&&path.length<=900}
function githubUrl(repo,path,query=""){if(!validRepo(repo)||!validPath(path))throw new Error("Invalid GitHub repository or path");const encoded=path.split("/").map(encodeURIComponent).join("/");return "https://api.github.com/repos/"+repo+"/contents/"+encoded+(query?"?"+query:"")}
async function githubRequest(url,options={}){
  const token=githubToken();if(!token)throw Object.assign(new Error("GITHUB_TOKEN is not configured on the Asset Forge server"),{status:503});
  const res=await fetch(url,{...options,headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json",...(options.headers||{})}});
  const txt=await res.text();let data=null;try{data=txt?JSON.parse(txt):null}catch{data={message:txt||("GitHub HTTP "+res.status)}}
  if(!res.ok)throw Object.assign(new Error(data?.message||("GitHub HTTP "+res.status)),{status:res.status,githubStatus:res.status});
  return data;
}
async function bodyJson(req){
  let raw="";for await(const chunk of req)raw+=chunk;
  if(raw.length>8_000_000)throw Object.assign(new Error("Request body too large"),{status:413});
  try{return JSON.parse(raw||"{}")}catch{throw Object.assign(new Error("Invalid JSON body"),{status:400})}
}

const liveClients=new Map();
let latestLiveFrame=null;
function broadcastAction(action){
  const id=randomUUID(),payload=JSON.stringify({type:"action",id,action});
  for(const c of liveClients.values()) if(c.role==="vision-client"&&c.ws.readyState===1) c.ws.send(payload);
  return id;
}
function waitForLiveFrame(after=0,timeout=6000){
  if(latestLiveFrame&&latestLiveFrame.createdAt>after)return Promise.resolve(latestLiveFrame);
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    const tick=()=>{if(latestLiveFrame&&latestLiveFrame.createdAt>after)return resolve(latestLiveFrame);if(Date.now()-started>timeout)return reject(Object.assign(new Error("Timed out waiting for a live vision frame"),{status:504}));setTimeout(tick,80)};
    tick();
  });
}
function frameForModel(frame){
  if(!frame?.image)return null;
  return frame.image.startsWith("data:image/")?frame.image:"data:image/jpeg;base64,"+frame.image;
}
async function runAstraTask(task){
  const key=String(process.env.OPENAI_API_KEY||"").trim();
  if(!key)throw Object.assign(new Error("OPENAI_API_KEY is not configured on the Asset Forge server"),{status:503});
  let frame=await waitForLiveFrame(0,7000),previousResponseId=null,nextInput=task,turns=0;
  for(;turns<12;turns++){
    const body={model:String(process.env.OPENAI_MODEL||"gpt-6-astra"),tools:[{type:"computer"}],input:nextInput};
    if(previousResponseId)body.previous_response_id=previousResponseId;
    const rr=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const raw=await rr.text();let data=null;try{data=JSON.parse(raw)}catch{data={error:{message:raw}}}
    if(!rr.ok)throw Object.assign(new Error(data?.error?.message||("OpenAI HTTP "+rr.status)),{status:rr.status});
    previousResponseId=data.id||null;
    const calls=(data.output||[]).filter(x=>x.type==="computer_call");
    if(!calls.length){
      const text=(data.output||[]).filter(x=>x.type==="message").flatMap(x=>x.content||[]).map(x=>x.text||"").filter(Boolean).join("\n").trim();
      return {output:text||data.output_text||"Agent completed",turns:turns+1};
    }
    const continuation=[];
    for(const call of calls){
      const actions=Array.isArray(call.actions)?call.actions:[];
      for(const action of actions){
        const normalized={...action,screenWidth:frame.screenWidth||frame.width,screenHeight:frame.screenHeight||frame.height};
        if(normalized.type==="screenshot"){frame=await waitForLiveFrame(frame.createdAt,7000);continue}
        const issuedAt=Date.now();broadcastAction(normalized);await waitForLiveFrame(issuedAt,7000).catch(()=>null);frame=latestLiveFrame||frame;
      }
      continuation.push({type:"computer_call_output",call_id:call.call_id,output:{type:"computer_screenshot",image_url:frameForModel(frame),detail:"original"}});
    }
    nextInput=continuation;
  }
  throw Object.assign(new Error("Agent reached the 12-turn safety limit"),{status:429});
}

const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://127.0.0.1");
    if(req.method==="OPTIONS"){if(!sameOrigin(req))return json(res,403,{message:"Cross-origin access denied"});res.writeHead(204,headers({"Allow":"GET,PUT,OPTIONS"}));return res.end()}
    if(url.pathname.startsWith("/api/")&&!sameOrigin(req))return json(res,403,{message:"Cross-origin access denied"});
    if(url.pathname==="/api/live/status"){
      return json(res,200,{connected:[...liveClients.values()].filter(x=>x.role==="vision-client"&&x.ws.readyState===1).length,lastFrameAt:latestLiveFrame?.createdAt||0,frameWidth:latestLiveFrame?.width||0,frameHeight:latestLiveFrame?.height||0,agentConfigured:Boolean(String(process.env.OPENAI_API_KEY||"").trim()),model:process.env.OPENAI_MODEL||"gpt-6-astra"});
    }
    if(url.pathname==="/api/agent/task"&&req.method==="POST"){
      const b=await bodyJson(req),task=String(b.task||"").trim();if(!task)return json(res,400,{message:"task is required"});const result=await runAstraTask(task);return json(res,200,result);
    }
    if(url.pathname==="/api/github/status"){
      return json(res,200,{configured:Boolean(githubToken()),provider:"github",serverSideToken:true});
    }
    if(url.pathname==="/api/github/contents" && req.method==="GET"){
      const repo=url.searchParams.get("repo")||"",branch=url.searchParams.get("branch")||"main",path=(url.searchParams.get("path")||"").replace(/^\/+|\/+$/g,"");
      if(!validRepo(repo)||!validPath(path))return json(res,400,{message:"Invalid repository or path"});
      const q="ref="+encodeURIComponent(branch);
      const data=await githubRequest(githubUrl(repo,path,q));
      return json(res,200,data);
    }
    if(url.pathname==="/api/github/file" && req.method==="PUT"){
      const b=await bodyJson(req),repo=b.repo,branch=b.branch||"main",path=String(b.path||"").replace(/^\/+|\/+$/g,"");
      if(!validRepo(repo)||!validPath(path)||!b.message||typeof b.content!=="string")return json(res,400,{message:"repo, path, message and base64 content are required"});
      const payload={message:String(b.message).slice(0,200),content:b.content,branch};
      if(b.sha)payload.sha=b.sha;
      const data=await githubRequest(githubUrl(repo,path),{method:"PUT",body:JSON.stringify(payload)});
      return json(res,200,data);
    }

    let rel=decodeURIComponent(url.pathname);
    if(rel==="/")rel="/index.html";
    const file=normalize(join(root,rel));
    if(!file.startsWith(root))throw new Error("forbidden");
    const s=await stat(file);if(!s.isFile())throw new Error("not-file");
    const body=await readFile(file);
    res.writeHead(200,headers({"Content-Type":types[extname(file).toLowerCase()]||"application/octet-stream"}));res.end(body);
  }catch(e){
    if(String(req.url||"").startsWith("/api/"))return json(res,e.status||500,{message:e.message||"Server error"});
    res.writeHead(404,headers({"Content-Type":"text/plain; charset=utf-8"}));res.end("Not Found");
  }
});
const wss=new WebSocketServer({noServer:true});
wss.on("connection",(ws)=>{
  const id=randomUUID();liveClients.set(id,{id,role:"unknown",ws});
  ws.on("message",(raw,isBinary)=>{
    if(isBinary)return;
    let d;try{d=JSON.parse(raw.toString())}catch{return}
    const c=liveClients.get(id);if(!c)return;
    if(d.type==="hello"){c.role=d.role||"unknown";return}
    if(d.type==="frame"&&c.role==="vision-client"&&typeof d.image==="string"){latestLiveFrame={...d,receivedAt:Date.now()};return}
  });
  ws.on("close",()=>liveClients.delete(id));ws.on("error",()=>liveClients.delete(id));
});
server.on("upgrade",(req,socket,head)=>{
  let u;try{u=new URL(req.url||"/","http://127.0.0.1")}catch{socket.destroy();return}
  if(u.pathname!=="/live"){socket.destroy();return}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws,req));
});
server.listen(port,"127.0.0.1",()=>console.log("Asset Forge server listening on http://127.0.0.1:"+port));
