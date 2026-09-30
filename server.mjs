import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {cookGLB} from './forge-pipeline.mjs';
import {VisionController} from './vision-controller.mjs';
import {VisionController,installVisionShutdown} from './vision-control.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4173);
const host=process.env.HOST||'127.0.0.1';
const vision=new VisionController({baseUrl:`http://127.0.0.1:${port}`});
const removeVisionShutdown=installVisionShutdown(vision);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.wasm':'application/wasm'};
const clients=new Set(),visionClients=new Set(),rooms=new Map();
const vision=new VisionController({port:Number(process.env.FORGE_CDP_PORT||9222),host:process.env.FORGE_CDP_HOST||'127.0.0.1',broadcast:message=>{const raw=JSON.stringify(message);for(const peer of visionClients)if(peer.readyState===1)peer.send(raw)}});
function json(res,o,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(o))}
function body(req,max=64*1024){return new Promise((resolve,reject)=>{let raw='';req.on('data',chunk=>{raw+=chunk;if(raw.length>max){reject(new Error('Request body too large'));req.destroy()}});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(new Error('Invalid JSON'))}});req.on('error',reject)})}
async function routeVisionAction(req,res){try{const q=await body(req);if(!q.action)return json(res,{ok:false,error:'Missing action'},400);return json(res,await vision.action(q.action,q.options||{}))}catch(e){return json(res,{ok:false,error:e.message||String(e)},500)}}
function safeFile(urlPath){let p=decodeURIComponent(urlPath||'/');if(p==='/'||p==='')p='/index.html';if(p.includes('..'))return null;const full=path.resolve(root,'.'+p);return full.startsWith(root+path.sep)?full:null}
function serve(req,res){const u=new URL(req.url,'http://localhost');const file=safeFile(u.pathname);fs.stat(file||'',(err,st)=>{if(!err&&st.isFile()){const ext=path.extname(file).toLowerCase();res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':ext==='.html'||ext==='.js'||ext==='.css'?'no-cache':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});return fs.createReadStream(file).pipe(res)}if(u.pathname!=='/'&&!path.extname(u.pathname)){const fallback=path.join(root,'index.html');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(fallback).on('error',()=>{res.writeHead(404);res.end('Not found')}).pipe(res)}res.writeHead(404);res.end('Not found')})}
const srv=http.createServer(async (req,res)=>{const u=new URL(req.url,'http://localhost');if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
  if(u.pathname==='/health'||u.pathname==='/api/health')return json(res,{ok:true,name:'Forge Studio',version:'3.7',standalone:true,server:true,ws:true,time:new Date().toISOString()});
  if(u.pathname==='/api/pipeline'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',async()=>{try{const q=JSON.parse(body);if(q.operation!=='cook-glb')return json(res,{ok:false,error:'Unsupported pipeline operation'},400);const bytes=Buffer.from(q.base64||'','base64');if(!bytes.length)return json(res,{ok:false,error:'Empty asset'},400);if(bytes.length>80*1024*1024)return json(res,{ok:false,error:'Asset exceeds 80MB pipeline limit'},413);const cooked=await cookGLB(bytes,q.options||{});return json(res,{ok:true,...cooked})}catch(e){return json(res,{ok:false,error:e.message},500)}});return}
  if(u.pathname==='/api/live/status')return json(res,{ok:true,agentConfigured:true,transport:'websocket',model:'forge-control-plane-v4',protocol:4,vision:vision.status()});
  if(u.pathname==='/api/vision/status')return json(res,{ok:true,protocol:4,vision:vision.status(),capabilities:{liveScreencast:true,mouse:true,keyboard:true,touch:true,wheel:true,drag:true}});
  if(u.pathname==='/api/vision/stream')return vision.stream(req,res);
  if(u.pathname==='/api/vision/elements')return vision.elements().then(data=>json(res,{ok:true,...data})).catch(e=>json(res,{ok:false,error:e.message||String(e)},503));
  if(u.pathname==='/api/vision/state')return vision.state().then(data=>json(res,{ok:true,...data})).catch(e=>json(res,{ok:false,error:e.message||String(e)},503));
  if(u.pathname==='/api/vision/session/start'&&req.method==='POST'){
    try{const q=await body(req);const s=await vision.start({url:q.url||q.target||undefined,viewport:q.viewport,touch:q.touch,mobile:q.mobile});return json(res,{ok:true,session:s,stream:'/api/vision/stream',websocket:'/vision'})}
    catch(e){return json(res,{ok:false,error:e.message||String(e)},500)}
  }
  if(u.pathname==='/api/vision/session/stop'&&req.method==='POST'){
    try{await vision.stop();return json(res,{ok:true,session:vision.status()})}
    catch(e){return json(res,{ok:false,error:e.message||String(e)},500)}
  }
  if(u.pathname==='/api/vision/action'&&req.method==='POST')return routeVisionAction(req,res);
  if(u.pathname==='/api/forge/command'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{let m={};try{m=JSON.parse(body)}catch{return json(res,{ok:false,error:'Invalid JSON'},400)}const msg=JSON.stringify({type:'forge-command',id:crypto.randomUUID(),command:m.command||m});for(const peer of clients)if(peer.readyState===1)peer.send(msg);return json(res,{ok:true,queued:true})});return}
  return serve(req,res);
});
const wss=new WebSocketServer({noServer:true});
wss.on('connection',ws=>{clients.add(ws);ws.on('close',()=>clients.delete(ws));ws.on('message',m=>{for(const p of clients)if(p!==ws&&p.readyState===1)p.send(m)})});
const visionWss=new WebSocketServer({noServer:true});
visionWss.on('connection',ws=>{
  vision.addTelemetryClient(ws);
  ws.on('close',()=>vision.removeTelemetryClient(ws));
  ws.on('message',async message=>{
    let m;try{m=JSON.parse(message)}catch{return}
    try{
      if(m.type==='hello'){
        ws.send(JSON.stringify({type:'vision-hello',protocol:4,session:vision.status()}));
        return;
      }
      if(m.type==='session-start'){
        const session=await vision.start(m.options||{});
        ws.send(JSON.stringify({type:'session-result',ok:true,session,stream:'/api/vision/stream'}));
        return;
      }
      if(m.type==='session-stop'){
        await vision.stop();
        ws.send(JSON.stringify({type:'session-result',ok:true,session:vision.status()}));
        return;
      }
      if(m.type==='action'){
        const result=await vision.action(m.action||{},m.options||{});
        ws.send(JSON.stringify({type:'action-result',id:m.id||null,...result}));
        return;
      }
      if(m.type==='status')ws.send(JSON.stringify({type:'vision-status',...vision.status()}));
    }catch(e){
      ws.send(JSON.stringify({type:'action-result',id:m.id||null,ok:false,error:e.message||String(e)}));
    }
  });
});
const visionWss=new WebSocketServer({noServer:true});
visionWss.on('connection',ws=>{visionClients.add(ws);ws.send(JSON.stringify({type:'vision-state',state:vision.status()}));ws.on('close',()=>visionClients.delete(ws));});
const netWss=new WebSocketServer({noServer:true});
function joinRoom(room,ws,peerId){if(!rooms.has(room))rooms.set(room,new Set());const set=rooms.get(room);for(const p of set)if(p.readyState===1)p.send(JSON.stringify({type:'peer-join',peerId}));set.add(ws);ws.__room=room;ws.__peerId=peerId}
function leaveRoom(ws){const room=ws.__room;if(!room||!rooms.has(room))return;const set=rooms.get(room);set.delete(ws);for(const p of set)if(p.readyState===1)p.send(JSON.stringify({type:'peer-leave',peerId:ws.__peerId}));if(!set.size)rooms.delete(room)}
netWss.on('connection',ws=>{ws.on('close',()=>leaveRoom(ws));ws.on('message',message=>{let m;try{m=JSON.parse(message)}catch{return}if(m.type==='hello'){joinRoom(String(m.room||'default'),ws,String(m.peerId||crypto.randomUUID()));return}const room=rooms.get(ws.__room);if(!room)return;for(const p of room)if(p!==ws&&p.readyState===1)p.send(JSON.stringify(m))})});
srv.on('upgrade',(req,socket,head)=>{const pathn=new URL(req.url,'http://localhost').pathname;if(pathn==='/live')return wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));if(pathn==='/vision')return visionWss.handleUpgrade(req,socket,head,ws=>visionWss.emit('connection',ws,req));if(pathn==='/vision')return visionWss.handleUpgrade(req,socket,head,ws=>visionWss.emit('connection',ws,req));if(pathn==='/net')return netWss.handleUpgrade(req,socket,head,ws=>netWss.emit('connection',ws,req));socket.destroy()});
srv.listen(port,host,()=>console.log('Forge Studio 3.7 listening on http://'+host+':'+port));
process.once('exit',removeVisionShutdown);