// المتصفح السحابي: خادم HTTP + WebSocket واحد.
// - يقدم واجهة الهاتف (public/)
// - يبث الشاشة والصوت (fMP4 عبر WebSocket) بمعدل ثابت حسب الجودة المختارة
// - يستقبل أوامر التحكم (رابط، رجوع، تمرير، نقر، كتابة)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { config, validateConfig } from './lib/config.js';
import { PROFILES, DEFAULT_PROFILE, getProfile, mimeFor, expectedMbPerHour } from './lib/profiles.js';
import { ByteBudget } from './lib/budget.js';
import { StreamProcess } from './lib/stream.js';
import { InputController } from './lib/input.js';
import { BrowserController } from './lib/browser.js';
import { StreamStats } from './lib/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MB = 1e6; // نعتبر الميغابايت = مليون بايت (كما تعرضه إعدادات البيانات في أندرويد)

const errors = validateConfig(config);
if (errors.length) {
  console.error('إعدادات غير صحيحة:\n- ' + errors.join('\n- '));
  process.exit(1);
}

const keyHash = crypto.createHash('sha256').update(config.accessKey).digest();

// ---------- حماية تسجيل الدخول: 5 محاولات خاطئة كحد أقصى كل 10 دقائق لكل عنوان ----------
const failures = new Map(); // ip -> {count, first}
function isBlocked(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > 10 * 60 * 1000) { failures.delete(ip); return false; }
  return f.count >= 5;
}
function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, first: Date.now() };
  f.count++;
  failures.set(ip, f);
}
function checkKey(key) {
  const h = crypto.createHash('sha256').update(String(key || '')).digest();
  return crypto.timingSafeEqual(h, keyHash);
}

// ---------- الحالة ----------
const budget = new ByteBudget(config.limitMbPerHour * MB);
const input = new InputController({
  xdotoolBin: config.xdotoolBin, display: config.display,
  width: config.screenWidth, height: config.screenHeight,
});
const browser = new BrowserController(config);
const stats = new StreamStats();
let lastLoggedUrl = '';
let lastLoggedError = '';

let client = null; // جلسة الهاتف الوحيدة
let session = null; // {ws, quality, audio, streaming, stream}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function stopStream() {
  if (session && session.stream) {
    const s = session.stream;
    session.stream = null;
    s.stop();
  }
}

function startStream() {
  stopStream();
  if (!session || !client) return;
  const ws = session.ws;
  const profile = getProfile(session.quality) || PROFILES[DEFAULT_PROFILE];
  if (budget.exhausted()) {
    send(ws, { type: 'stream-stopped', reason: 'budget', usedMb: budget.used() / MB, limitMb: budget.limitBytes / MB });
    return;
  }
  send(ws, {
    type: 'stream-init',
    mime: mimeFor(profile, session.audio),
    profile: profile.id,
    label: profile.label,
    width: profile.width,
    height: profile.height,
    expectedMbPerHour: Number(expectedMbPerHour(profile).toFixed(1)),
  });

  const sp = new StreamProcess({
    profile, audioCodec: session.audio, captureMode: config.captureMode,
    display: config.display, screen: { width: config.screenWidth, height: config.screenHeight },
    pulseSource: config.pulseSink, ffmpegBin: config.ffmpegBin,
  });
  session.stream = sp;
  stats.streams++;
  stats.log(`stream start profile=${profile.id} audio=${session.audio} fps=${profile.fps} video=${profile.videoKbps}kbps`);

  sp.on('data', (chunk) => {
    if (session?.stream !== sp) return;
    if (budget.exhausted()) {
      stopStream();
      send(ws, { type: 'stream-stopped', reason: 'budget', usedMb: budget.used() / MB, limitMb: budget.limitBytes / MB });
      return;
    }
    if (ws.bufferedAmount > config.maxBufferedBytes) {
      // الشبكة بطيئة: نعيد التهيئة بدل إرسال أجزاء ناقصة تُفسد الفيديو
      stats.restarts++;
      stats.log('slow client: resyncing stream (bufferedAmount too high)');
      stopStream();
      setTimeout(() => { if (session && session.streaming) startStream(); }, 800);
      return;
    }
    budget.add(chunk.length);
    stats.addBytes(chunk.length);
    ws.send(chunk, { binary: true });
  });

  sp.on('error', (err) => {
    console.error('ffmpeg spawn error:', err.message);
    send(ws, { type: 'error', message: 'تعذر تشغيل ffmpeg على السيرفر' });
  });

  sp.on('exit', (info) => {
    if (session?.stream === sp) session.stream = null;
    stats.log(`ffmpeg exit code=${info.code} signal=${info.signal} expected=${info.stopping} stderr=${JSON.stringify(info.stderr)}`);
    if (!info.stopping) stats.errors++;
    if (!info.stopping && session?.streaming && client) {
      console.error('ffmpeg exited unexpectedly', info);
      send(ws, { type: 'error', message: 'توقف الترميز على السيرفر، سيُعاد التشغيل تلقائياً' });
      setTimeout(() => { if (session && session.streaming) startStream(); }, 2000);
    }
  });

  sp.start();
}

// ---------- تحديثات المتصفح ----------
let lastStateSent = 0;
let pendingState = null;
browser.on('state', (snap) => {
  if (snap.url !== lastLoggedUrl) { lastLoggedUrl = snap.url; stats.log(`browser url=${snap.url}`); }
  if (snap.error && snap.error !== lastLoggedError) { lastLoggedError = snap.error; stats.errors++; stats.log(`browser error=${snap.error}`); }
  pendingState = snap;
  const wait = Math.max(0, 200 - (Date.now() - lastStateSent));
  setTimeout(() => {
    if (!pendingState || !session) return;
    lastStateSent = Date.now();
    send(session.ws, { type: 'status', ...pendingState });
    pendingState = null;
  }, wait);
});
browser.on('crash', (code) => {
  stats.errors++;
  stats.log(`browser crashed code=${code}`);
  if (session) send(session.ws, { type: 'error', message: 'توقف المتصفح على السيرفر، جارٍ إعادة تشغيله' });
  setTimeout(() => process.exit(1), 1000); // Docker سيعيد تشغيل الحاوية
});

// ---------- معالجة الرسائل ----------
function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'start': {
      if (msg.quality && PROFILES[msg.quality]) session.quality = msg.quality;
      session.audio = msg.audio === 'aac' ? 'aac' : 'opus';
      session.streaming = true;
      startStream();
      break;
    }
    case 'quality': {
      if (!PROFILES[msg.quality]) return;
      session.quality = msg.quality;
      if (session.streaming) startStream();
      break;
    }
    case 'stop': {
      session.streaming = false;
      stopStream();
      send(ws, { type: 'stream-stopped', reason: 'user' });
      break;
    }
    case 'limit': {
      // الهاتف يستطيع خفض الحد فقط، ولا يتجاوز LIMIT_MB_PER_HOUR
      const req = Number(msg.mb);
      const mb = Math.min(config.limitMbPerHour, Math.max(0.05, Number.isFinite(req) ? Math.round(req * 100) / 100 : config.limitMbPerHour));
      budget.limitBytes = mb * MB;
      send(ws, { type: 'limit-set', limitMb: mb });
      break;
    }
    case 'navigate': {
      browser.navigate(msg.url).catch(() => {});
      break;
    }
    case 'back': browser.back(); break;
    case 'forward': browser.forward(); break;
    case 'reload': browser.reload(); break;
    case 'click': input.click(msg.x, msg.y); break;
    case 'scroll': input.scroll(msg.x, msg.y, msg.dy); break;
    case 'key': input.key(String(msg.key || '')); break;
    case 'text': input.text(msg.text); break;
    default: break;
  }
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const security = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
    'Cache-Control': 'no-cache',
  };
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...security });
    return res.end(JSON.stringify({ ok: true, client: !!client }));
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...security });
    return res.end('غير موجود');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...security });
  fs.createReadStream(file).pipe(res);
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let authed = false;

  if (isBlocked(ip)) {
    send(ws, { type: 'error', message: 'محاولات كثيرة خاطئة، انتظر 10 دقائق' });
    return ws.close();
  }

  const authTimer = setTimeout(() => { if (!authed) ws.close(); }, 10000);

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!authed) {
      if (msg.type !== 'auth') return ws.close();
      if (!checkKey(msg.key)) {
        recordFailure(ip);
        send(ws, { type: 'auth-failed', message: 'المفتاح غير صحيح' });
        return ws.close();
      }
      authed = true;
      clearTimeout(authTimer);
      stats.log(`phone authenticated ip=${ip}`);
      failures.delete(ip);
      if (client && client !== ws) {
        send(client, { type: 'replaced', message: 'تم فتح الجلسة من جهاز آخر' });
        client.close();
        stopStream();
      }
      client = ws;
      session = { ws, quality: DEFAULT_PROFILE, audio: 'opus', streaming: false, stream: null };
      send(ws, {
        type: 'welcome',
        profiles: Object.values(PROFILES).map((p) => ({ id: p.id, label: p.label, mbPerHour: Number(expectedMbPerHour(p).toFixed(1)) })),
        defaultQuality: DEFAULT_PROFILE,
        limitMb: config.limitMbPerHour,
        usedMb: budget.used() / MB,
        state: browser.snapshot(),
      });
      return;
    }
    if (ws !== client) return;
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (client === ws) stats.log('phone disconnected');
    if (client === ws) {
      stopStream();
      client = null;
      session = null;
    }
  });
});

// نبضات قلب: إغلاق الاتصالات الميتة (مثلاً عند قفل الهاتف)
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

const statsTimer = setInterval(() => {
  if (!client) return;
  console.log(stats.line({
    quality: session?.quality,
    streaming: session?.streaming ? 1 : 0,
    budgetUsedMb: (budget.used() / MB).toFixed(2),
    limitMb: budget.limitBytes / MB,
  }));
}, 10000);

// ---------- التشغيل ----------
async function main() {
  stats.log(`config capture=${config.captureMode} display=${config.display} chromium=${config.chromiumBin} ffmpeg=${config.ffmpegBin} limitMb=${config.limitMbPerHour}`);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Cloud browser listening on :${config.port} (capture=${config.captureMode}, limit=${config.limitMbPerHour}MB/h)`);
  });
  if (config.captureMode === 'x11') {
    await browser.start();
    console.log('Chromium ready');
  } else {
    console.log('CAPTURE_MODE=test: Chromium غير مُشغَّل (وضع الفحص فقط)');
  }
}

async function shutdown() {
  clearInterval(heartbeat);
  clearInterval(statsTimer);
  stopStream();
  await browser.close();
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

main().catch((e) => {
  console.error('فشل التشغيل:', e);
  process.exit(1);
});

