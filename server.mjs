import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {cookGLB} from './forge-pipeline.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.wasm':'application/wasm'};
const clients=new Set(),rooms=new Map();
function json(res,o,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(o))}
function safeFile(urlPath){let p=decodeURIComponent(urlPath||'/');if(p==='/'||p==='')p='/index.html';if(p.includes('..'))return null;const full=path.resolve(root,'.'+p);return full.startsWith(root+path.sep)?full:null}
function serve(req,res){const u=new URL(req.url,'http://localhost');const file=safeFile(u.pathname);fs.stat(file||'',(err,st)=>{if(!err&&st.isFile()){const ext=path.extname(file).toLowerCase();res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':ext==='.html'||ext==='.js'||ext==='.css'?'no-cache':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});return fs.createReadStream(file).pipe(res)}if(u.pathname!=='/'&&!path.extname(u.pathname)){const fallback=path.join(root,'index.html');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(fallback).on('error',()=>{res.writeHead(404);res.end('Not found')}).pipe(res)}res.writeHead(404);res.end('Not found')})}
const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
  if(u.pathname==='/health'||u.pathname==='/api/health')return json(res,{ok:true,name:'Forge Studio',version:'3.0',standalone:true,server:true,ws:true,time:new Date().toISOString()});
  if(u.pathname==='/api/pipeline'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',async()=>{try{const q=JSON.parse(body);if(q.operation!=='cook-glb')return json(res,{ok:false,error:'Unsupported pipeline operation'},400);const bytes=Buffer.from(q.base64||'','base64');if(!bytes.length)return json(res,{ok:false,error:'Empty asset'},400);if(bytes.length>80*1024*1024)return json(res,{ok:false,error:'Asset exceeds 80MB pipeline limit'},413);const cooked=await cookGLB(bytes,q.options||{});return json(res,{ok:true,...cooked})}catch(e){return json(res,{ok:false,error:e.message},500)}});return}
  if(u.pathname==='/api/live/status')return json(res,{ok:true,agentConfigured:true,transport:'websocket',model:'forge-control-plane-v3',protocol:3});
  if(u.pathname==='/api/forge/command'&&req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{let m={};try{m=JSON.parse(body)}catch{return json(res,{ok:false,error:'Invalid JSON'},400)}const msg=JSON.stringify({type:'forge-command',id:crypto.randomUUID(),command:m.command||m});for(const peer of clients)if(peer.readyState===1)peer.send(msg);return json(res,{ok:true,queued:true})});return}
  return serve(req,res);
});
const wss=new WebSocketServer({noServer:true});
wss.on('connection',ws=>{clients.add(ws);ws.on('close',()=>clients.delete(ws));ws.on('message',m=>{for(const p of clients)if(p!==ws&&p.readyState===1)p.send(m)})});
const netWss=new WebSocketServer({noServer:true});
function joinRoom(room,ws,peerId){if(!rooms.has(room))rooms.set(room,new Set());const set=rooms.get(room);for(const p of set)if(p.readyState===1)p.send(JSON.stringify({type:'peer-join',peerId}));set.add(ws);ws.__room=room;ws.__peerId=peerId}
function leaveRoom(ws){const room=ws.__room;if(!room||!rooms.has(room))return;const set=rooms.get(room);set.delete(ws);for(const p of set)if(p.readyState===1)p.send(JSON.stringify({type:'peer-leave',peerId:ws.__peerId}));if(!set.size)rooms.delete(room)}
netWss.on('connection',ws=>{ws.on('close',()=>leaveRoom(ws));ws.on('message',message=>{let m;try{m=JSON.parse(message)}catch{return}if(m.type==='hello'){joinRoom(String(m.room||'default'),ws,String(m.peerId||crypto.randomUUID()));return}const room=rooms.get(ws.__room);if(!room)return;for(const p of room)if(p!==ws&&p.readyState===1)p.send(JSON.stringify(m))})});
srv.on('upgrade',(req,socket,head)=>{const pathn=new URL(req.url,'http://localhost').pathname;if(pathn==='/live')return wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));if(pathn==='/net')return netWss.handleUpgrade(req,socket,head,ws=>netWss.emit('connection',ws,req));socket.destroy()});
srv.listen(port,()=>console.log('Forge Studio 3.0 listening on '+port));